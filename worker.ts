// Kumar Signals Pro API worker.
// Serves JSON under /api/* and falls back to the built React SPA (frontend/dist)
// for everything else via the ASSETS binding.

export interface Env {
  COMMODITY_KV: KVNamespace;
  ASSETS: Fetcher;
}

const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_HIST_URL = "https://api.upstox.com/v2/historical-candle";
const UPSTOX_INTRADAY_URL = "https://api.upstox.com/v2/historical-candle/intraday";
const UPSTOX_OPTION_CHAIN_URL = "https://api.upstox.com/v2/option/chain";

// All price-card instruments. Only CRUDEOIL/NATURALGAS have the options-based
// BUY/SELL signal logic wired up so far (OPTION_SYMBOLS) -- Gold/Silver/Copper/
// Aluminium show live price data only until that's extended.
const ALL_SYMBOLS = ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER"] as const;
const OPTION_SYMBOLS = ["CRUDEOIL", "NATURALGAS"] as const;
type Symbol = (typeof ALL_SYMBOLS)[number];

type Direction = "bullish" | "bearish" | "neutral";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

// MCX commodity trading session, approximated (actual close varies 23:30-23:55
// IST depending on day/DST-linked international session). Good enough for a
// LIVE/CLOSED indicator, not a precise exchange calendar (doesn't know holidays).
function getMarketStatus() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && minutes >= 9 * 60 && minutes < 23 * 60 + 30;
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return {
    isOpen,
    timeLabel: `${hh}:${mm} IST`,
    mcxStatus: isOpen ? "MCX session is live." : "MCX session resumes ~9:00 AM IST on the next trading day.",
  };
}

// Approximate historical success rates commonly cited in technical-analysis
// literature (e.g. Bulkowski-style pattern studies). Educational reference
// figures only -- NOT a backtest of this instrument, NOT a guarantee.
const PATTERN_RELIABILITY: Record<string, number> = {
  "Double Top": 65,
  "Double Bottom": 66,
  "Head and Shoulders": 83,
  "Inverse Head and Shoulders": 84,
  "Ascending Triangle": 72,
  "Descending Triangle": 71,
  "Symmetrical Triangle": 60,
  "Rising Wedge": 62,
  "Falling Wedge": 68,
  "Bullish Flag / Pennant": 68,
  "Bearish Flag / Pennant": 67,
  "Bullish Rectangle": 60,
  "Bearish Rectangle": 60,
};

function pct(a: number, b: number) {
  return Math.abs(a - b) / ((a + b) / 2);
}
function r2(x: number) {
  return Math.round(x * 100) / 100;
}

interface Swing {
  i: number;
  price: number;
  date: string;
}

function findSwings(candles: Candle[], look = 2) {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  for (let i = look; i < candles.length - look; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - look; j <= i + look; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isH = false;
      if (candles[j].low <= candles[i].low) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].high, date: candles[i].date });
    if (isL) lows.push({ i, price: candles[i].low, date: candles[i].date });
  }
  return { highs, lows };
}

interface PatternResult {
  pattern: string;
  direction: Direction;
  entry: number | string;
  stop: number | string;
  target: number | string;
  note: string;
  reliability?: number | null;
}

function detectDoubleTop(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 2) return null;
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  if (pct(h1.price, h2.price) > 0.025) return null;
  const between = lows.filter((l) => l.i > h1.i && l.i < h2.i);
  if (!between.length) return null;
  const neckline = Math.min(...between.map((l) => l.price));
  const height = (h1.price + h2.price) / 2 - neckline;
  if (height <= 0) return null;
  return {
    pattern: "Double Top",
    direction: "bearish",
    entry: r2(neckline * 0.998),
    stop: r2(Math.max(h1.price, h2.price) * 1.01),
    target: r2(neckline - height),
    note: `Twin peaks near ${r2(h1.price)} & ${r2(h2.price)}, neckline support around ${r2(neckline)}.`,
  };
}

function detectDoubleBottom(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (lows.length < 2) return null;
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  if (pct(l1.price, l2.price) > 0.025) return null;
  const between = highs.filter((h) => h.i > l1.i && h.i < l2.i);
  if (!between.length) return null;
  const neckline = Math.max(...between.map((h) => h.price));
  const height = neckline - (l1.price + l2.price) / 2;
  if (height <= 0) return null;
  return {
    pattern: "Double Bottom",
    direction: "bullish",
    entry: r2(neckline * 1.002),
    stop: r2(Math.min(l1.price, l2.price) * 0.99),
    target: r2(neckline + height),
    note: `Twin troughs near ${r2(l1.price)} & ${r2(l2.price)}, neckline resistance around ${r2(neckline)}.`,
  };
}

function detectHeadShoulders(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3) return null;
  const [L, H, R] = highs.slice(-3);
  if (!(H.price > L.price * 1.008 && H.price > R.price * 1.008)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftT = lows.filter((l) => l.i > L.i && l.i < H.i);
  const rightT = lows.filter((l) => l.i > H.i && l.i < R.i);
  if (!leftT.length || !rightT.length) return null;
  const neckline = (leftT[leftT.length - 1].price + rightT[0].price) / 2;
  const height = H.price - neckline;
  if (height <= 0) return null;
  return {
    pattern: "Head and Shoulders",
    direction: "bearish",
    entry: r2(neckline * 0.997),
    stop: r2(R.price * 1.012),
    target: r2(neckline - height),
    note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.`,
  };
}

function detectInverseHeadShoulders(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (lows.length < 3) return null;
  const [L, H, R] = lows.slice(-3);
  if (!(H.price < L.price * 0.992 && H.price < R.price * 0.992)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftP = highs.filter((h) => h.i > L.i && h.i < H.i);
  const rightP = highs.filter((h) => h.i > H.i && h.i < R.i);
  if (!leftP.length || !rightP.length) return null;
  const neckline = (leftP[leftP.length - 1].price + rightP[0].price) / 2;
  const height = neckline - H.price;
  if (height <= 0) return null;
  return {
    pattern: "Inverse Head and Shoulders",
    direction: "bullish",
    entry: r2(neckline * 1.003),
    stop: r2(R.price * 0.988),
    target: r2(neckline + height),
    note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.`,
  };
}

function detectAscendingTriangle(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const flatRes = pct(h[0].price, h[1].price) < 0.015 && pct(h[1].price, h[2].price) < 0.015;
  const risingLows = l[0].price < l[1].price * 0.999 && l[1].price < l[2].price * 0.999;
  if (!flatRes || !risingLows) return null;
  const resistance = (h[0].price + h[1].price + h[2].price) / 3;
  const height = resistance - l[0].price;
  if (height <= 0) return null;
  return {
    pattern: "Ascending Triangle",
    direction: "bullish",
    entry: r2(resistance * 1.003),
    stop: r2(l[2].price * 0.99),
    target: r2(resistance + height),
    note: `Flat resistance near ${r2(resistance)} with rising swing lows — bullish breakout setup.`,
  };
}

function detectDescendingTriangle(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const flatSup = pct(l[0].price, l[1].price) < 0.015 && pct(l[1].price, l[2].price) < 0.015;
  const fallingHighs = h[0].price > h[1].price * 1.001 && h[1].price > h[2].price * 1.001;
  if (!flatSup || !fallingHighs) return null;
  const support = (l[0].price + l[1].price + l[2].price) / 3;
  const height = h[0].price - support;
  if (height <= 0) return null;
  return {
    pattern: "Descending Triangle",
    direction: "bearish",
    entry: r2(support * 0.997),
    stop: r2(h[2].price * 1.01),
    target: r2(support - height),
    note: `Flat support near ${r2(support)} with falling swing highs — bearish breakdown setup.`,
  };
}

function detectRisingWedge(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price < h[1].price && h[1].price < h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const widthStart = h[0].price - l[0].price;
  const widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  return {
    pattern: "Rising Wedge",
    direction: "bearish",
    entry: r2(l[2].price * 0.995),
    stop: r2(h[2].price * 1.01),
    target: r2(l[2].price - widthStart),
    note: `Converging rising channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bearish reversal risk.`,
  };
}

function detectFallingWedge(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price > l[1].price && l[1].price > l[2].price)) return null;
  const widthStart = h[0].price - l[0].price;
  const widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  return {
    pattern: "Falling Wedge",
    direction: "bullish",
    entry: r2(h[2].price * 1.005),
    stop: r2(l[2].price * 0.99),
    target: r2(h[2].price + widthStart),
    note: `Converging falling channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bullish reversal setup.`,
  };
}

function detectFlagPennant(candles: Candle[]): PatternResult | null {
  const n = candles.length;
  if (n < 25) return null;
  const poleStart = candles[n - 20];
  const poleEnd = candles[n - 8];
  const poleMove = poleEnd.close - poleStart.close;
  const poleRange = Math.abs(poleMove);
  if (poleRange / poleStart.close < 0.03) return null;
  const recent = candles.slice(n - 7);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  if (recentHigh - recentLow > poleRange * 0.5) return null;
  if (poleMove > 0) {
    return {
      pattern: "Bullish Flag / Pennant",
      direction: "bullish",
      entry: r2(recentHigh * 1.003),
      stop: r2(recentLow * 0.99),
      target: r2(recentHigh + poleRange),
      note: `Sharp rally of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.`,
    };
  }
  return {
    pattern: "Bearish Flag / Pennant",
    direction: "bearish",
    entry: r2(recentLow * 0.997),
    stop: r2(recentHigh * 1.01),
    target: r2(recentLow - poleRange),
    note: `Sharp decline of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.`,
  };
}

function detectRectangle(highs: Swing[], lows: Swing[], candles: Candle[]): PatternResult | null {
  if (highs.length < 2 || lows.length < 2) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (h.length < 2 || l.length < 2) return null;
  const flatRes = h.every((x, idx) => idx === 0 || pct(x.price, h[0].price) < 0.015);
  const flatSup = l.every((x, idx) => idx === 0 || pct(x.price, l[0].price) < 0.015);
  if (!flatRes || !flatSup) return null;
  const resistance = h.reduce((s, x) => s + x.price, 0) / h.length;
  const support = l.reduce((s, x) => s + x.price, 0) / l.length;
  const height = resistance - support;
  if (height <= 0 || height / support > 0.15) return null;
  const startIdx = Math.min(h[0].i, l[0].i);
  const prior = candles.slice(Math.max(0, startIdx - 15), startIdx);
  const priorUp = prior.length > 2 ? prior[prior.length - 1].close > prior[0].close : true;
  if (priorUp) {
    return {
      pattern: "Bullish Rectangle",
      direction: "bullish",
      entry: r2(resistance * 1.003),
      stop: r2(support * 0.99),
      target: r2(resistance + height),
      note: `Range-bound between ${r2(support)} and ${r2(resistance)} after an uptrend — continuation setup on an upside break.`,
    };
  }
  return {
    pattern: "Bearish Rectangle",
    direction: "bearish",
    entry: r2(support * 0.997),
    stop: r2(resistance * 1.01),
    target: r2(support - height),
    note: `Range-bound between ${r2(support)} and ${r2(resistance)} after a downtrend — continuation setup on a downside break.`,
  };
}

function detectSymmetricalTriangle(highs: Swing[], lows: Swing[]): PatternResult | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const height = h[0].price - l[0].price;
  return {
    pattern: "Symmetrical Triangle",
    direction: "neutral",
    entry: `${r2(h[2].price * 1.003)} (bullish break) / ${r2(l[2].price * 0.997)} (bearish break)`,
    stop: "Opposite side of whichever breakout triggers",
    target: `± ${r2(height)} projected from the breakout price`,
    note: `Converging highs & lows — wait for confirmation above ${r2(h[2].price)} or below ${r2(l[2].price)}.`,
  };
}

function analyzeCommodity(candles: Candle[]): PatternResult {
  const { highs, lows } = findSwings(candles, 2);
  const detectors = [
    () => detectHeadShoulders(highs, lows),
    () => detectInverseHeadShoulders(highs, lows),
    () => detectDoubleTop(highs, lows),
    () => detectDoubleBottom(highs, lows),
    () => detectAscendingTriangle(highs, lows),
    () => detectDescendingTriangle(highs, lows),
    () => detectRisingWedge(highs, lows),
    () => detectFallingWedge(highs, lows),
    () => detectFlagPennant(candles),
    () => detectRectangle(highs, lows, candles),
    () => detectSymmetricalTriangle(highs, lows),
  ];
  for (const d of detectors) {
    const res = d();
    if (res) {
      res.reliability = PATTERN_RELIABILITY[res.pattern] ?? null;
      return res;
    }
  }
  return {
    pattern: "No Clear Pattern",
    direction: "neutral",
    entry: "-",
    stop: "-",
    target: "-",
    reliability: null,
    note: "Price action doesn't currently match a well-defined chart pattern. Best to wait for clearer structure.",
  };
}

interface FutureInfo {
  instrument_key: string;
  expiry: string;
  trading_symbol: string;
}

async function getNearestFuture(token: string, query: string): Promise<FutureInfo | null> {
  const usp = new URLSearchParams({ query, exchanges: "MCX", instrument_types: "FUT", records: "10" });
  const res = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json: any = await res.json();
  if (json.status !== "success" || !json.data || !json.data.length) return null;
  const contracts = [...json.data].sort((a, b) => +new Date(a.expiry) - +new Date(b.expiry));
  const nearest = contracts[0];
  return { instrument_key: nearest.instrument_key, expiry: nearest.expiry, trading_symbol: nearest.trading_symbol };
}

async function getHistoricalCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 270);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/day/${fmt(to)}/${fmt(from)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json: any = await res.json();
  if (json.status !== "success" || !json.data || !json.data.candles) return null;
  const candles: Candle[] = json.data.candles.map((c: any[]) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] ?? 0,
    oi: c[6] ?? 0,
  }));
  candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return candles;
}

async function getIntradayCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
  const url = `${UPSTOX_INTRADAY_URL}/${encodeURIComponent(instrumentKey)}/1minute`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json: any = await res.json();
  if (json.status !== "success" || !json.data || !json.data.candles) return null;
  const candles: Candle[] = json.data.candles.map((c: any[]) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] ?? 0,
    oi: c[6] ?? 0,
  }));
  candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return candles;
}

// Upstox's intraday endpoint only serves 1-minute (or 30-minute) candles, so
// 5m/15m/30m scans are built by bucketing 1-minute candles ourselves.
function resampleCandles(candles: Candle[], minutesPerBucket: number): Candle[] {
  if (!candles.length) return [];
  const bucketMs = minutesPerBucket * 60 * 1000;
  const out: Candle[] = [];
  let bucketStart: number | null = null;
  let cur: Candle | null = null;
  for (const c of candles) {
    const t = Math.floor(new Date(c.date).getTime() / bucketMs) * bucketMs;
    if (t !== bucketStart) {
      if (cur) out.push(cur);
      bucketStart = t;
      cur = { date: new Date(t).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, oi: c.oi };
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// MCX commodity options are options on the futures contract, so the option
// chain is queried with the same instrument_key/expiry as the nearest future.
async function getOptionChain(token: string, instrumentKey: string, expiryDate: string): Promise<{ chain?: any[]; error?: string }> {
  const usp = new URLSearchParams({ instrument_key: instrumentKey, expiry_date: expiryDate });
  const res = await fetch(`${UPSTOX_OPTION_CHAIN_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json: any = await res.json();
  if (json.status !== "success" || !json.data || !json.data.length) {
    const msg = json.errors ? json.errors.map((e: any) => e.message).join("; ") : "No strikes returned";
    return { error: msg };
  }
  return { chain: json.data };
}

function nearestStrikes(chain: any[], spot: number, sideCount = 6) {
  const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
  let atmIdx = 0;
  let atmDiff = Infinity;
  sorted.forEach((row, i) => {
    const diff = Math.abs(row.strike_price - spot);
    if (diff < atmDiff) {
      atmDiff = diff;
      atmIdx = i;
    }
  });
  const start = Math.max(0, atmIdx - sideCount);
  const end = Math.min(sorted.length, atmIdx + sideCount + 1);
  return { rows: sorted.slice(start, end), atmStrike: sorted.length ? sorted[atmIdx].strike_price : null };
}

function analyzeChain(chain: any[]) {
  let maxCallOI: { strike: number; oi: number } | null = null;
  let maxPutOI: { strike: number; oi: number } | null = null;
  let totalCallOI = 0;
  let totalPutOI = 0;
  for (const r of chain) {
    const callOI = r.call_options?.market_data?.oi || 0;
    const putOI = r.put_options?.market_data?.oi || 0;
    totalCallOI += callOI;
    totalPutOI += putOI;
    if (!maxCallOI || callOI > maxCallOI.oi) maxCallOI = { strike: r.strike_price, oi: callOI };
    if (!maxPutOI || putOI > maxPutOI.oi) maxPutOI = { strike: r.strike_price, oi: putOI };
  }
  const pcr = totalCallOI > 0 ? r2(totalPutOI / totalCallOI) : null;
  const bias: Direction = pcr == null ? "neutral" : pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral";
  return {
    pcr,
    resistance: maxCallOI ? maxCallOI.strike : null,
    support: maxPutOI ? maxPutOI.strike : null,
    bias,
  };
}

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

  const favMove = isBullish ? pattern.target - spot : spot - pattern.target;
  const riskMove = isBullish ? spot - pattern.stop : pattern.stop - spot;
  const DELTA = 0.5;
  const premiumTarget = r2(premium + DELTA * favMove);
  const premiumStop = r2(Math.max(premium * 0.35, premium - DELTA * riskMove));

  let confidence = "Medium (pattern only, OI neutral)";
  if (chainAnalysis.bias === pattern.direction) confidence = "High (pattern + OI agree)";
  else if (chainAnalysis.bias !== "neutral" && chainAnalysis.bias !== pattern.direction) confidence = "Low (OI data conflicts with pattern)";

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
  const chainRes = await getOptionChain(token, fut.instrument_key, fut.expiry);
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
    tradingSymbol: fut.trading_symbol,
    expiry: fut.expiry,
    currentPrice: spot,
    lastDate: candles[candles.length - 1].date,
    pattern,
    trade,
  };
}

async function computeSignal(token: string, symbol: Symbol): Promise<SignalCard> {
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
  const candles = await getHistoricalCandles(token, fut.instrument_key);
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

async function computeSignals(token: string): Promise<SignalCard[]> {
  const out: SignalCard[] = [];
  for (const symbol of OPTION_SYMBOLS) {
    try {
      out.push(await computeSignal(token, symbol));
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
async function getCandlesForTF(token: string, fut: FutureInfo, tf: string): Promise<Candle[] | { error: string }> {
  if (tf === "1D") {
    const candles = await getHistoricalCandles(token, fut.instrument_key);
    if (!candles || candles.length < 40) return { error: "Not enough historical data yet" };
    return candles;
  }
  const tfMinutes = parseInt(tf, 10);
  const oneMin = await getIntradayCandles(token, fut.instrument_key);
  if (!oneMin || oneMin.length < 20) return { error: "Not enough intraday data yet — market may be closed" };
  const candles = tfMinutes === 1 ? oneMin : resampleCandles(oneMin, tfMinutes);
  if (candles.length < 15) return { error: "Not enough bars yet at this timeframe — try again later in the session" };
  return candles;
}

async function computeScan(token: string, symbol: Symbol, tf: string): Promise<(SignalCard & { timeframe: string }) | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(token, fut, tf);
  if ("error" in candles) return candles;
  const signal = await buildSignalCard(token, symbol, fut, candles);
  return { ...signal, timeframe: tf };
}

async function computeCandles(token: string, symbol: Symbol, tf: string): Promise<{ tradingSymbol: string; timeframe: string; candles: Candle[] } | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(token, fut, tf);
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

async function computePriceCard(token: string, symbol: Symbol): Promise<PriceCard | { symbol: Symbol; error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { symbol, error: "No instrument found" };
  const candles = await getHistoricalCandles(token, fut.instrument_key);
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

async function computePrices(token: string) {
  const out = [];
  for (const symbol of ALL_SYMBOLS) {
    try {
      out.push(await computePriceCard(token, symbol));
    } catch (e: any) {
      out.push({ symbol, error: e.message });
    }
  }
  return out;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function requireToken(env: Env): Promise<string | Response> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return json({ error: "No token found in KV. Log in via the main kumarcmtd worker's /login first." }, 400);
  return token;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/market-status") {
          return json(getMarketStatus());
        }

        if (url.pathname === "/api/prices") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computePrices(token));
        }

        if (url.pathname === "/api/signals") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeSignals(token));
        }

        const signalMatch = url.pathname.match(/^\/api\/signals\/([A-Z]+)$/);
        if (signalMatch) {
          const symbol = signalMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeSignal(token, symbol));
        }

        if (url.pathname === "/api/scan") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "15";
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await computeScan(token, symbol, tf));
        }

        if (url.pathname === "/api/candles") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "1D";
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeCandles(token, symbol, tf));
        }

        return json({ error: "Not found" }, 404);
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    }

    // Static SPA assets. Anything not matching a built file (client-side
    // routes like /charts, /options) falls back to index.html.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      const indexRequest = new Request(new URL("/index.html", url), request);
      return env.ASSETS.fetch(indexRequest);
    }
    return assetResponse;
  },
};
