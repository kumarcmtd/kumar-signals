// The technical reference table.
//
// One place to read every standard indicator with its plain interpretation,
// so the app's numbers can be checked against the public analysis sites that
// quote these by name (Moneycontrol, Investing.com, TradingView).
//
// TWO RULES THIS MODULE ENFORCES
//
// 1. NOTHING HERE FEEDS A SIGNAL SCORE. These are reference readings. RSI,
//    Stochastic, CCI, Williams %R and ROC all measure momentum over a similar
//    lookback, so they agree with each other most of the time by construction.
//    A "6 of 6 indicators are bullish" summary is really one or two
//    independent readings counted six times, and it makes a score look far
//    more confident than the evidence behind it. The signal engines keep using
//    one momentum input; this table exists to be verified, not to vote.
//
// 2. A SUMMARY COUNT IS REPORTED WITH THAT CAVEAT ATTACHED. People will count
//    the green rows whatever we do, so the count is provided -- together with
//    how many genuinely independent FAMILIES agree, which is the number that
//    actually matters.
//
// Thresholds follow the conventional public definitions so the readings match
// what those sites display, rather than being retuned to look better here.

import type { Candle } from "../types";
import {
  sma, rsi, macd, stochastic, roc, cci, williamsR, mfi, atr, adx,
  bollingerBands, keltnerChannels, donchianChannels, emaLast,
} from "./indicators";

export type Indication = "bullish" | "bearish" | "neutral" | "info" | "unavailable";

/**
 * Which indicators move together. Used to report how many INDEPENDENT groups
 * agree, not just how many rows are green.
 */
export type IndicatorFamily = "momentum" | "trend" | "volume" | "volatility" | "range";

export interface TechnicalRow {
  key: string;
  label: string;
  /** Formatted for display, or null when the input was missing. */
  value: string | null;
  indication: Indication;
  /** Short plain-language reading. */
  note: string;
  family: IndicatorFamily;
}

export interface MovingAverageRow {
  period: number;
  sma: number | null;
  ema: number | null;
  indication: Indication;
}

export interface CrossoverRow {
  term: "Short term" | "Medium term" | "Long term";
  label: string;
  indication: Indication;
}

export interface TechnicalTable {
  price: number | null;
  movingAverages: MovingAverageRow[];
  crossovers: CrossoverRow[];
  indicators: TechnicalRow[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  unavailableCount: number;
  /** Independent families leaning bullish / bearish. The honest headline. */
  familiesBullish: number;
  familiesBearish: number;
  familiesCounted: number;
  summaryLabel: string;
  summaryNote: string;
}

const MA_PERIODS = [5, 10, 20, 50, 100, 200];

function fmt(v: number | null, digits = 2): string | null {
  return v === null || !Number.isFinite(v) ? null : v.toFixed(digits);
}

/** Price above the average is the conventional bullish reading. */
function maIndication(price: number | null, avg: number | null): Indication {
  if (price === null || avg === null) return "unavailable";
  if (price > avg) return "bullish";
  if (price < avg) return "bearish";
  return "neutral";
}

function crossIndication(fast: number | null, slow: number | null): Indication {
  if (fast === null || slow === null) return "unavailable";
  if (fast > slow) return "bullish";
  if (fast < slow) return "bearish";
  return "neutral";
}

export function buildTechnicalTable(candles: Candle[]): TechnicalTable {
  const closes = candles.map((c) => c.close);
  const price = closes.length ? closes[closes.length - 1] : null;

  const movingAverages: MovingAverageRow[] = MA_PERIODS.map((period) => {
    const s = sma(closes, period);
    return { period, sma: s, ema: emaLast(closes, period), indication: maIndication(price, s) };
  });

  const smaOf = (p: number) => movingAverages.find((m) => m.period === p)?.sma ?? null;
  const crossovers: CrossoverRow[] = [
    { term: "Short term", label: "5 & 20", indication: crossIndication(smaOf(5), smaOf(20)) },
    { term: "Medium term", label: "20 & 50", indication: crossIndication(smaOf(20), smaOf(50)) },
    { term: "Long term", label: "50 & 200", indication: crossIndication(smaOf(50), smaOf(200)) },
  ];

  const indicators: TechnicalRow[] = [];
  const push = (r: TechnicalRow) => indicators.push(r);

  // --- Momentum family. These five largely agree by construction. ---------
  const rsiValue = rsi(closes, 14);
  push({
    key: "rsi",
    label: "RSI (14)",
    value: fmt(rsiValue),
    indication:
      rsiValue === null ? "unavailable" : rsiValue > 75 ? "bearish" : rsiValue >= 55 ? "bullish" : rsiValue > 45 ? "neutral" : rsiValue >= 25 ? "bearish" : "bullish",
    note:
      rsiValue === null
        ? "Not enough bars yet."
        : rsiValue > 75
          ? "Overbought — stretched, and stretched can stay stretched."
          : rsiValue >= 55
            ? "Momentum is on the buyers' side."
            : rsiValue > 45
              ? "Neither side has momentum."
              : rsiValue >= 25
                ? "Momentum is on the sellers' side."
                : "Oversold — often bounces, but falling markets get oversold and stay there.",
    family: "momentum",
  });

  const stoch = stochastic(candles, 20, 3);
  push({
    key: "stochastic",
    label: "Stochastic (20,3)",
    value: stoch ? fmt(stoch.k) : null,
    indication: !stoch ? "unavailable" : stoch.k > 80 ? "bearish" : stoch.k >= 55 ? "bullish" : stoch.k > 45 ? "neutral" : stoch.k >= 20 ? "bearish" : "bullish",
    note: !stoch
      ? "Not enough bars yet."
      : stoch.k > 80
        ? "Overbought — closing near the top of its recent range."
        : stoch.k < 20
          ? "Oversold — closing near the bottom of its recent range."
          : `Closing ${Math.round(stoch.k)}% of the way up its recent range.`,
    family: "momentum",
  });

  const cciValue = cci(candles, 20);
  push({
    key: "cci",
    label: "CCI (20)",
    value: fmt(cciValue),
    indication: cciValue === null ? "unavailable" : cciValue > 200 ? "bearish" : cciValue >= 50 ? "bullish" : cciValue > -50 ? "neutral" : cciValue >= -200 ? "bearish" : "bullish",
    note:
      cciValue === null
        ? "Not enough bars yet."
        : Math.abs(cciValue) > 200
          ? "Far from its average — an extreme reading."
          : "How far price sits from its own recent average.",
    family: "momentum",
  });

  const wr = williamsR(candles, 14);
  push({
    key: "williamsR",
    label: "Williams %R (14)",
    value: fmt(wr),
    indication: wr === null ? "unavailable" : wr > -20 ? "bearish" : wr >= -50 ? "bullish" : wr > -80 ? "bearish" : "bullish",
    note:
      wr === null
        ? "Not enough bars yet."
        : wr > -20
          ? "Overbought — trading right at the top of its 14-bar range."
          : wr < -80
            ? "Oversold — trading right at the bottom of its 14-bar range."
            : "Where the close sits inside its recent high-low range.",
    family: "momentum",
  });

  const rocValue = roc(closes, 20);
  push({
    key: "roc",
    label: "ROC (20)",
    value: rocValue === null ? null : `${rocValue > 0 ? "+" : ""}${rocValue.toFixed(2)}%`,
    indication: rocValue === null ? "unavailable" : rocValue > 0 ? "bullish" : rocValue < 0 ? "bearish" : "neutral",
    note: rocValue === null ? "Not enough bars yet." : "Percentage move against the close 20 bars ago.",
    family: "momentum",
  });

  // --- Trend family -------------------------------------------------------
  const macdValue = macd(closes);
  push({
    key: "macd",
    label: "MACD (12,26,9)",
    value: macdValue ? fmt(macdValue.line) : null,
    indication: !macdValue ? "unavailable" : macdValue.line > macdValue.signal ? "bullish" : macdValue.line < macdValue.signal ? "bearish" : "neutral",
    note: !macdValue
      ? "Not enough bars yet."
      : macdValue.line > macdValue.signal
        ? "MACD is above its signal line."
        : "MACD is below its signal line.",
    family: "trend",
  });

  const adxValue = adx(candles, 14);
  push({
    key: "adx",
    label: "ADX (14)",
    value: fmt(adxValue),
    // ADX measures STRENGTH, not direction -- calling it bullish would be wrong.
    indication: adxValue === null ? "unavailable" : "info",
    note:
      adxValue === null
        ? "Not enough bars yet."
        : adxValue >= 25
          ? "Strong trend — but this says nothing about which way."
          : "Weak or no trend. Direction readings are less reliable here.",
    family: "trend",
  });

  // --- Volume family ------------------------------------------------------
  const mfiValue = mfi(candles, 14);
  push({
    key: "mfi",
    label: "MFI (14)",
    value: fmt(mfiValue),
    indication: mfiValue === null ? "unavailable" : mfiValue > 80 ? "bearish" : mfiValue >= 55 ? "bullish" : mfiValue > 45 ? "neutral" : mfiValue >= 20 ? "bearish" : "bullish",
    note:
      mfiValue === null
        ? "Volume data isn't available for these bars, so this cannot be calculated."
        : "RSI weighted by volume — buying and selling pressure, not just price.",
    family: "volume",
  });

  // --- Volatility family. Direction-free by nature. -----------------------
  const atrValue = atr(candles, 14);
  push({
    key: "atr",
    label: "ATR (14)",
    value: fmt(atrValue),
    indication: atrValue === null ? "unavailable" : "info",
    note:
      atrValue === null
        ? "Not enough bars yet."
        : `Typical bar range. Useful for sizing a stop — a stop inside ${atrValue.toFixed(2)} is inside the noise.`,
    family: "volatility",
  });

  // --- Range family -------------------------------------------------------
  const bb = bollingerBands(closes, 20, 2);
  push({
    key: "bollinger",
    label: "Bollinger (20,2)",
    value: bb ? `${bb.lower.toFixed(2)} – ${bb.upper.toFixed(2)}` : null,
    indication: !bb || price === null ? "unavailable" : price > bb.upper ? "bearish" : price < bb.lower ? "bullish" : "neutral",
    note:
      !bb || price === null
        ? "Not enough bars yet."
        : price > bb.upper
          ? "Above the upper band — a stretched reading, not a sell signal on its own."
          : price < bb.lower
            ? "Below the lower band — a stretched reading, not a buy signal on its own."
            : "Inside the normal range.",
    family: "range",
  });

  const kc = keltnerChannels(candles, 20, 2);
  push({
    key: "keltner",
    label: "Keltner (20, 2×ATR)",
    value: kc ? `${kc.lower.toFixed(2)} – ${kc.upper.toFixed(2)}` : null,
    indication: !kc || price === null ? "unavailable" : price > kc.upper ? "bullish" : price < kc.lower ? "bearish" : "neutral",
    note:
      !kc || price === null
        ? "Not enough bars yet."
        : price > kc.upper
          ? "Closing above the channel — a breakout reading."
          : price < kc.lower
            ? "Closing below the channel — a breakdown reading."
            : "Inside the channel. Bands widen and narrow with this instrument's own volatility.",
    family: "range",
  });

  const dc = donchianChannels(candles, 20);
  push({
    key: "donchian",
    label: "Donchian (20)",
    value: dc ? `${dc.lower.toFixed(2)} – ${dc.upper.toFixed(2)}` : null,
    indication: !dc ? "unavailable" : dc.position >= 80 ? "bullish" : dc.position <= 20 ? "bearish" : "neutral",
    note: !dc
      ? "Not enough bars yet."
      : `Price is ${Math.round(dc.position)}% of the way up its 20-bar range. The original commodity breakout channel.`,
    family: "range",
  });

  // --- Counts -------------------------------------------------------------
  const scored = indicators.filter((r) => r.indication === "bullish" || r.indication === "bearish" || r.indication === "neutral");
  const bullishCount = scored.filter((r) => r.indication === "bullish").length + movingAverages.filter((m) => m.indication === "bullish").length + crossovers.filter((c) => c.indication === "bullish").length;
  const bearishCount = scored.filter((r) => r.indication === "bearish").length + movingAverages.filter((m) => m.indication === "bearish").length + crossovers.filter((c) => c.indication === "bearish").length;
  const neutralCount = scored.filter((r) => r.indication === "neutral").length + movingAverages.filter((m) => m.indication === "neutral").length + crossovers.filter((c) => c.indication === "neutral").length;
  const unavailableCount =
    indicators.filter((r) => r.indication === "unavailable").length +
    movingAverages.filter((m) => m.indication === "unavailable").length +
    crossovers.filter((c) => c.indication === "unavailable").length;

  // Families, which is the number that actually carries information. Moving
  // averages and crossovers are folded into "trend" -- six averages of the
  // same price series are not six independent opinions.
  const families: IndicatorFamily[] = ["momentum", "trend", "volume", "volatility", "range"];
  let familiesBullish = 0;
  let familiesBearish = 0;
  let familiesCounted = 0;
  for (const family of families) {
    const rows = indicators.filter((r) => r.family === family && (r.indication === "bullish" || r.indication === "bearish"));
    const extra = family === "trend" ? [...movingAverages, ...crossovers].filter((m) => m.indication === "bullish" || m.indication === "bearish") : [];
    const all = [...rows.map((r) => r.indication), ...extra.map((m) => m.indication)];
    if (all.length === 0) continue;
    familiesCounted += 1;
    const bulls = all.filter((i) => i === "bullish").length;
    const bears = all.filter((i) => i === "bearish").length;
    if (bulls > bears) familiesBullish += 1;
    else if (bears > bulls) familiesBearish += 1;
  }

  let summaryLabel: string;
  if (familiesCounted === 0) summaryLabel = "Not enough data";
  else if (familiesBullish > familiesBearish) summaryLabel = `${familiesBullish} of ${familiesCounted} groups bullish`;
  else if (familiesBearish > familiesBullish) summaryLabel = `${familiesBearish} of ${familiesCounted} groups bearish`;
  else summaryLabel = "Groups are split";

  const summaryNote =
    familiesCounted === 0
      ? "Not enough bars to read anything yet."
      : `${bullishCount} readings bullish, ${bearishCount} bearish. That raw count overstates the case — RSI, Stochastic, CCI, Williams %R and ROC all measure the same thing, and six moving averages of one price series are not six opinions. The group count above is the honest version.`;

  return {
    price,
    movingAverages,
    crossovers,
    indicators,
    bullishCount,
    bearishCount,
    neutralCount,
    unavailableCount,
    familiesBullish,
    familiesBearish,
    familiesCounted,
    summaryLabel,
    summaryNote,
  };
}
