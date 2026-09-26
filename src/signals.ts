// Signal cards: pattern -> option trade construction, per-symbol and
// per-timeframe scans, candle serving, and the live price cards.

import { resampleCandles } from "../frontend/src/utils/candleResample";
import { analyzeCommodity, type PatternResult } from "../frontend/src/utils/chartPatterns";
import { ALL_SYMBOLS, type Candle, type Env, type FutureInfo, OPTION_SYMBOLS, r2, type Symbol } from "./env";
import { analyzeChain, nearestStrikes, resolveOptionChainAcrossFutures } from "./optionChain";
import { getHistoricalCandles, getHistoricalIntradayCandles, getIntradayCandles, getNearestFuture, getPriorDayBars } from "./upstox";

interface TradeSignal {
  action: string;
  optSide?: "CE" | "PE";
  strike?: number;
  premiumEntry?: number;
  premiumTarget?: number;
  premiumStop?: number;
  confidence?: string;
  pcr?: number | null;
  note: string;
}

// Combines the chart-pattern direction (from the future's price action) with
// the option chain's PCR/OI bias into one actionable ATM option buy call.
// Premium target/stop are a rough delta≈0.5 (ATM) projection off the pattern's
// underlying target/stop -- not a pricing model. Theta decay & IV moves mean
// actual premiums can diverge; always track the live quote.
function buildTradeSignal(pattern: PatternResult, spot: number, chainAnalysis: ReturnType<typeof analyzeChain>, atmRow: any): TradeSignal {
  if (pattern.direction === "neutral" || typeof pattern.entry !== "number" || typeof pattern.stop !== "number" || typeof pattern.target !== "number") {
    return { action: "NO TRADE", note: "No clear directional pattern yet — wait for a breakout before buying an option." };
  }
  if (!atmRow) {
    return { action: "NO TRADE", note: "Option chain strikes unavailable near spot." };
  }

  const isBullish = pattern.direction === "bullish";
  const optSide: "CE" | "PE" = isBullish ? "CE" : "PE";
  const optData = isBullish ? atmRow.call_options?.market_data : atmRow.put_options?.market_data;
  const premium = optData?.ltp;
  if (!premium || premium <= 0) {
    return { action: "NO TRADE", note: "No live premium quote for the ATM strike right now." };
  }

  // A pattern match with the option chain's own OI/PCR bias actively
  // pointing the OTHER way is a real contradiction, not just "no extra
  // confirmation" -- previously this only downgraded a caption ("Low
  // confidence") while still returning the exact same clickable BUY action
  // as a fully-agreeing signal. Block it outright instead, matching how
  // AI Elite treats a contradicting veto: no trade shown at all rather than
  // a weak one with full-strength UI.
  if (chainAnalysis.bias !== "neutral" && chainAnalysis.bias !== pattern.direction) {
    return {
      action: "NO TRADE",
      pcr: chainAnalysis.pcr,
      note: `${pattern.pattern} suggests ${pattern.direction}, but the option chain's OI/PCR bias points ${chainAnalysis.bias} instead -- pattern and positioning disagree, so no trade is issued until they align.`,
    };
  }

  const favMove = isBullish ? pattern.target - spot : spot - pattern.target;
  const riskMove = isBullish ? spot - pattern.stop : pattern.stop - spot;
  const DELTA = 0.5;
  const premiumTarget = r2(premium + DELTA * favMove);
  const premiumStop = r2(Math.max(premium * 0.35, premium - DELTA * riskMove));

  const confidence = chainAnalysis.bias === pattern.direction ? "High (pattern + OI agree)" : "Medium (pattern only, OI neutral)";

  return {
    action: `BUY ${atmRow.strike_price} ${optSide}`,
    optSide,
    strike: atmRow.strike_price,
    premiumEntry: premium,
    premiumTarget,
    premiumStop,
    confidence,
    note: `${isBullish ? "Call" : "Put"} bought near ATM strike ${atmRow.strike_price}, premium ~₹${premium}. Premium target/SL are a rough delta-based estimate off the ${pattern.pattern} target/stop — track the live premium, don't rely on this alone.`,
  };
}

interface SignalCard {
  symbol: Symbol;
  tradingSymbol: string;
  expiry: string;
  currentPrice: number;
  lastDate: string;
  pattern: PatternResult;
  trade: TradeSignal;
  error?: string;
}

async function buildSignalCard(token: string, symbol: Symbol, fut: FutureInfo, candles: Candle[]): Promise<SignalCard> {
  const pattern = analyzeCommodity(candles);
  const spot = candles[candles.length - 1].close;

  let trade: TradeSignal = { action: "NO TRADE", note: "Option chain unavailable." };
  const { fut: optionFut, expiry: optionExpiry, chain, error } = await resolveOptionChainAcrossFutures(token, symbol, fut, spot);
  const chainRes = { chain, error };
  if (!chainRes.error && chainRes.chain) {
    const chainAnalysis = analyzeChain(chainRes.chain);
    const { atmStrike } = nearestStrikes(chainRes.chain, spot, 1);
    const atmRow = chainRes.chain.find((r) => r.strike_price === atmStrike);
    trade = buildTradeSignal(pattern, spot, chainAnalysis, atmRow);
    trade.pcr = chainAnalysis.pcr;
  } else {
    trade = { action: "NO TRADE", note: chainRes.error ?? "Option chain unavailable." };
  }

  return {
    symbol,
    tradingSymbol: optionFut.trading_symbol,
    expiry: optionExpiry,
    currentPrice: spot,
    lastDate: candles[candles.length - 1].date,
    pattern,
    trade,
  };
}

export async function computeSignal(env: Env, token: string, symbol: Symbol): Promise<SignalCard> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) {
    return {
      symbol,
      tradingSymbol: "",
      expiry: "",
      currentPrice: 0,
      lastDate: "",
      pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
      trade: { action: "NO TRADE", note: "No instrument found" },
      error: "No instrument found",
    };
  }
  const candles = await getHistoricalCandles(env, token, fut.instrument_key);
  if (!candles || candles.length < 40) {
    return {
      symbol,
      tradingSymbol: fut.trading_symbol,
      expiry: fut.expiry,
      currentPrice: 0,
      lastDate: "",
      pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
      trade: { action: "NO TRADE", note: "Not enough historical data yet" },
      error: "Not enough historical data yet",
    };
  }
  return buildSignalCard(token, symbol, fut, candles);
}

export async function computeSignals(env: Env, token: string): Promise<SignalCard[]> {
  const out: SignalCard[] = [];
  for (const symbol of OPTION_SYMBOLS) {
    try {
      out.push(await computeSignal(env, token, symbol));
    } catch (e: any) {
      out.push({
        symbol,
        tradingSymbol: "",
        expiry: "",
        currentPrice: 0,
        lastDate: "",
        pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
        trade: { action: "NO TRADE", note: e.message },
        error: e.message,
      });
    }
  }
  return out;
}

// Shared by /api/scan and /api/candles: tf is "1D" (daily candles) or a
// minute count (5/15/30) resampled from 1-minute intraday candles, which
// only exist for the current session.
// Days of prior 1-minute history to stitch onto today's live feed. 30 bars
// at 4 hours each needs 5 trading days' worth; 20 calendar days comfortably
// covers that even accounting for weekends/holidays.
const PRIOR_HISTORY_DAYS = 20;

export async function getCandlesForTF(env: Env, token: string, fut: FutureInfo, tf: string): Promise<Candle[] | { error: string }> {
  if (tf === "1D") {
    const candles = await getHistoricalCandles(env, token, fut.instrument_key);
    if (!candles || candles.length < 40) return { error: "Not enough historical data yet" };
    return candles;
  }
  const tfMinutes = parseInt(tf, 10);
  const oneMinToday = await getIntradayCandles(token, fut.instrument_key);
  if (!oneMinToday || oneMinToday.length < 20) return { error: "Not enough intraday data yet — market may be closed" };

  // Higher timeframes (30m/60m/240m especially) can't accumulate 30 bars
  // from a single session alone -- 30 bars of 4-hour candles would need 5
  // trading days. Stitch recent 1-minute history from prior days onto
  // today's live feed so every timeframe has real multi-day context, the
  // way an actual chart works, instead of restarting from zero every
  // morning. A failure here just falls back to today-only data, same as
  // the previous behavior, rather than breaking the request.
  const todayStart = oneMinToday.length ? +new Date(oneMinToday[0].date) : Infinity;
  let candles: Candle[];
  const priorBars = await getPriorDayBars(env, token, fut.instrument_key, PRIOR_HISTORY_DAYS, tfMinutes);
  if (priorBars) {
    // The fast path: past days arrive already bucketed (see getPriorDayBars),
    // so only today's minutes are bucketed here. Identical output to
    // bucketing everything together, at a fraction of the CPU.
    candles = [...priorBars.filter((b) => +new Date(b.date) < todayStart), ...resampleCandles(oneMinToday, tfMinutes)];
  } else {
    const priorDays = await getHistoricalIntradayCandles(env, token, fut.instrument_key, PRIOR_HISTORY_DAYS);
    const combined = [...priorDays.filter((c) => +new Date(c.date) < todayStart), ...oneMinToday];
    candles = tfMinutes === 1 ? combined : resampleCandles(combined, tfMinutes);
  }
  if (candles.length < 15) return { error: "Not enough bars yet at this timeframe — try again later in the session" };
  return candles;
}

export async function computeScan(env: Env, token: string, symbol: Symbol, tf: string): Promise<(SignalCard & { timeframe: string }) | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(env, token, fut, tf);
  if ("error" in candles) return candles;
  const signal = await buildSignalCard(token, symbol, fut, candles);
  return { ...signal, timeframe: tf };
}

export async function computeCandles(env: Env, token: string, symbol: Symbol, tf: string): Promise<{ tradingSymbol: string; timeframe: string; candles: Candle[] } | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(env, token, fut, tf);
  if ("error" in candles) return candles;
  return { tradingSymbol: fut.trading_symbol, timeframe: tf, candles };
}

interface PriceCard {
  symbol: Symbol;
  tradingSymbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number | null;
  oi: number | null;
  high: number | null;
  low: number | null;
  lastUpdated: string;
}

async function computePriceCard(env: Env, token: string, symbol: Symbol): Promise<PriceCard | { symbol: Symbol; error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { symbol, error: "No instrument found" };
  const candles = await getHistoricalCandles(env, token, fut.instrument_key);
  if (!candles || candles.length < 2) return { symbol, error: "Not enough historical data yet" };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = r2(last.close - prev.close);
  const changePercent = r2((change / prev.close) * 100);
  return {
    symbol,
    tradingSymbol: fut.trading_symbol,
    ltp: last.close,
    change,
    changePercent,
    volume: last.volume || null,
    oi: last.oi || null,
    high: last.high,
    low: last.low,
    lastUpdated: last.date,
  };
}

export async function computePrices(env: Env, token: string) {
  const out = [];
  for (const symbol of ALL_SYMBOLS) {
    try {
      out.push(await computePriceCard(env, token, symbol));
    } catch (e: any) {
      out.push({ symbol, error: e.message });
    }
  }
  return out;
}
