// Kumar Signals Pro API worker.
// Serves JSON under /api/* and falls back to the built React SPA (frontend/dist)
// for everything else via the ASSETS binding.
//
// These are the exact same pure, React-free scoring engines the frontend
// itself imports for the Best Call page -- reused here (not reimplemented)
// so the Cron-triggered background notification check can never drift from
// what the app actually displays.
import { analyzeTimeframe } from "./frontend/src/utils/timeframeEngine";
import { findEliteSignal } from "./frontend/src/utils/eliteSignal";
import { evaluateDirectionalGate } from "./frontend/src/utils/directionalGateEngine";
import { scanAllSetups } from "./frontend/src/utils/kimiScanner";
import { eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall, type BestCallPick } from "./frontend/src/utils/bestCallSelector";

export interface Env {
  COMMODITY_KV: KVNamespace;
  ASSETS: Fetcher;
  AI: Ai;
}

// The TradingView widget (frontend/src/components/TradingViewWidget.tsx) is
// the only third-party origin this app ever loads anything from -- its
// script dynamically creates its own embed iframe/data connections on
// whichever tradingview.com subdomain it currently uses internally, which
// isn't pinned down in their public docs, so this allows the whole domain
// rather than guessing a specific subdomain and having it silently break.
// Every other resource (JS bundle, CSS, fonts, images, API calls) is
// same-origin. Everything below is additive to what Workers Assets already
// serves, applied to every response this Worker returns.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://s3.tradingview.com",
  // React sets color/layout via the inline `style` DOM attribute on
  // thousands of elements throughout this app -- CSP has no nonce/hash
  // mechanism for the style="" attribute itself (only for <style> blocks),
  // so avoiding 'unsafe-inline' here would mean rewriting every dynamic
  // color in the app into static stylesheet classes, a large UI-risking
  // change well beyond a headers hardening pass. script-src (the actual
  // XSS vector) stays fully locked down with no 'unsafe-inline'/'unsafe-eval'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tradingview.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.tradingview.com wss://*.tradingview.com",
  "frame-src https://*.tradingview.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

// Applied to every response this Worker returns -- API JSON, the SPA's
// index.html, and every static asset -- so there's exactly one place that
// defines this app's security posture instead of it depending on every
// individual route remembering to set headers correctly.
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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

// The next few upcoming futures contracts (nearest first), for when the
// NEAREST one's own option series has nothing listed at all (seen live: MCX
// Natural Gas returning zero contracts AND zero discoverable expiries for
// its nearest future the day before that future's own expiry -- its options
// had already stopped listing even though the future itself hadn't expired
// yet). Reuses the same search query as getNearestFuture.
async function getUpcomingFutures(token: string, query: string, count: number): Promise<FutureInfo[]> {
  const usp = new URLSearchParams({ query, exchanges: "MCX", instrument_types: "FUT", records: "10" });
  const res = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json: any = await res.json();
  if (json.status !== "success" || !json.data || !json.data.length) return [];
  const contracts = [...json.data].sort((a: any, b: any) => +new Date(a.expiry) - +new Date(b.expiry));
  return contracts.slice(0, count).map((c: any) => ({ instrument_key: c.instrument_key, expiry: c.expiry, trading_symbol: c.trading_symbol }));
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

const HIST_INTRADAY_CACHE_TTL_SECONDS = 4 * 60 * 60;

// 1-minute candles for the days BEFORE today, fetched from the historical
// (not intraday) endpoint and cached in KV -- this data is frozen the
// moment the trading day ends, so there is no reason to re-fetch it from
// Upstox on every poll. Only today's slice (getIntradayCandles) needs to
// stay live. A cache miss or an Upstox error here degrades gracefully to an
// empty array rather than failing the whole request, so the caller falls
// back to today-only behavior instead of breaking.
async function getHistoricalIntradayCandles(env: Env, token: string, instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(to);
  const cacheKey = `hist1m:${instrumentKey}:${toStr}`;

  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      // fall through and refetch on a corrupt cache entry
    }
  }

  try {
    const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/1minute/${toStr}/${fmt(from)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json: any = await res.json();
    if (json.status !== "success" || !json.data || !json.data.candles) return [];
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
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(candles), { expirationTtl: HIST_INTRADAY_CACHE_TTL_SECONDS });
    return candles;
  } catch {
    return [];
  }
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

// MCX commodity options commonly expire a few trading days *before* the
// underlying futures contract they're written on, so the futures contract's
// own expiry date is not a safe stand-in for the options series' expiry --
// querying with the wrong date returns a valid response with zero strikes.
// This discovers the real listed option expiry dates for an underlying via
// Upstox's option/contract endpoint.
async function getOptionExpiries(token: string, instrumentKey: string): Promise<string[] | null> {
  const usp = new URLSearchParams({ instrument_key: instrumentKey });
  const res = await fetch(`https://api.upstox.com/v2/option/contract?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (json.status !== "success" || !Array.isArray(json.data) || !json.data.length) return null;
  const expiries = Array.from(new Set<string>(json.data.map((c: any) => c.expiry).filter(Boolean))).sort(
    (a, b) => +new Date(a) - +new Date(b)
  );
  return expiries.length ? expiries : null;
}

// Every upcoming real option expiry for a future, nearest first; falls back
// to a single-entry list with the future's own expiry if the
// contract-discovery lookup fails or returns nothing, so an unexpected
// response shape doesn't regress prior behavior.
async function resolveOptionExpiryCandidates(token: string, fut: FutureInfo): Promise<string[]> {
  const expiries = await getOptionExpiries(token, fut.instrument_key);
  if (!expiries) return [fut.expiry];
  const now = Date.now();
  const upcoming = expiries.filter((e) => +new Date(e) >= now);
  return upcoming.length ? upcoming : [expiries[expiries.length - 1]];
}

// Confirmed via a live diagnostic call that Upstox's /v2/option/chain
// endpoint returns HTTP 200 "success" with an always-empty data array for
// MCX, regardless of instrument_key/expiry -- it just doesn't support this
// exchange. option/contract (strikes + per-contract instrument_key) and
// market-quote/quotes (live LTP/OI/volume, keyed by each object's own
// instrument_token) both work fine for MCX, so the chain is assembled from
// those two instead, into the same { strike_price, call_options: { market_data
// }, put_options: { market_data } } row shape the rest of this file already
// expects -- so analyzeChain/nearestStrikes/computeMaxPain/Greeks are
// untouched.
async function getOptionChain(token: string, instrumentKey: string, expiryDate: string, spot: number | null, pinnedStrikes: number[] = []): Promise<{ chain?: any[]; error?: string }> {
  const contractUsp = new URLSearchParams({ instrument_key: instrumentKey, expiry_date: expiryDate });
  const contractRes = await fetch(`https://api.upstox.com/v2/option/contract?${contractUsp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  let contractJson: any;
  try {
    contractJson = await contractRes.json();
  } catch {
    return { error: `Option contract request failed (HTTP ${contractRes.status} ${contractRes.statusText}): response was not valid JSON` };
  }
  if (contractJson.errors && contractJson.errors.length) {
    const msg = contractJson.errors.map((e: any) => e.message || e.errorCode || JSON.stringify(e)).join("; ");
    return { error: `Upstox rejected the option-contract request (HTTP ${contractRes.status}): ${msg} -- if this mentions auth/token, the Upstox access token likely needs a fresh login` };
  }
  if (contractJson.status !== "success" || !Array.isArray(contractJson.data) || !contractJson.data.length) {
    return { error: `Upstox returned no option contracts for expiry ${expiryDate} (HTTP ${contractRes.status})` };
  }

  const allContracts: any[] = contractJson.data;
  const allStrikes = Array.from(new Set<number>(allContracts.map((c) => c.strike_price))).sort((a, b) => a - b);

  // Narrow to strikes near spot before fetching quotes -- MCX chains can
  // list 100+ strikes across a huge range, and there's no reason to spend
  // subrequest/rate-limit budget quoting deep ITM/OTM strikes nobody trades.
  const WINDOW = 10;
  let keepStrikes = new Set(allStrikes);
  if (spot !== null && allStrikes.length > WINDOW * 2 + 1) {
    const nearestIdx = allStrikes.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(allStrikes[best] - spot) ? i : best), 0);
    keepStrikes = new Set(allStrikes.slice(Math.max(0, nearestIdx - WINDOW), nearestIdx + WINDOW + 1));
  }
  // A strike the client already has an open trade tracked against must never
  // silently stop getting live quotes just because the underlying has since
  // moved far enough that it falls outside the spot-centered window -- pin
  // it back in regardless of distance, or that trade's premium (and target
  // hit/close detection, which reads this same quote) freezes forever.
  for (const s of pinnedStrikes) if (allStrikes.includes(s)) keepStrikes.add(s);
  const contracts = allContracts.filter((c) => keepStrikes.has(c.strike_price));

  const quotesByToken = new Map<string, any>();
  const CHUNK = 200;
  const instrumentKeys = contracts.map((c) => c.instrument_key);
  for (let i = 0; i < instrumentKeys.length; i += CHUNK) {
    const chunk = instrumentKeys.slice(i, i + CHUNK);
    const quoteUsp = new URLSearchParams({ instrument_key: chunk.join(",") });
    const quoteRes = await fetch(`https://api.upstox.com/v2/market-quote/quotes?${quoteUsp.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    let quoteJson: any;
    try {
      quoteJson = await quoteRes.json();
    } catch {
      continue; // best-effort -- those contracts just end up with no market_data below
    }
    if (quoteJson.status === "success" && quoteJson.data) {
      for (const q of Object.values(quoteJson.data) as any[]) {
        if (q?.instrument_token) quotesByToken.set(q.instrument_token, q);
      }
    }
  }

  const rowsByStrike = new Map<number, any>();
  for (const c of contracts) {
    if (!rowsByStrike.has(c.strike_price)) rowsByStrike.set(c.strike_price, { strike_price: c.strike_price, call_options: null, put_options: null });
    const row = rowsByStrike.get(c.strike_price);
    const quote = quotesByToken.get(c.instrument_key);
    const marketData = quote
      ? { ltp: quote.last_price ?? null, oi: quote.oi ?? null, volume: quote.volume ?? null, close_price: quote.ohlc?.close ?? null }
      : {};
    if (c.instrument_type === "CE") row.call_options = { market_data: marketData };
    else if (c.instrument_type === "PE") row.put_options = { market_data: marketData };
  }

  return { chain: Array.from(rowsByStrike.values()) };
}

// Upstox's expiry-discovery call (getOptionExpiries, no expiry_date filter)
// and its per-expiry contract lookup (getOptionChain, with expiry_date set)
// can disagree right around a rollover -- discovery lists an expiry as
// available, but querying that exact expiry_date comes back with zero
// contracts (seen live: MCX Natural Gas's near-month expiry returning empty
// at market open while the next expiry already had live contracts). Rather
// than surface that as a dead end, this tries every candidate expiry
// (nearest first) until one actually has contracts, and reports whichever
// expiry it actually used -- not just the first guess -- so downstream
// Greeks/expiry display stay consistent with the chain that was returned.
async function resolveOptionChain(token: string, fut: FutureInfo, spot: number | null, pinnedStrikes: number[] = []): Promise<{ expiry: string; chain?: any[]; error?: string }> {
  const candidates = await resolveOptionExpiryCandidates(token, fut);
  let lastError: string | undefined;
  for (const expiry of candidates) {
    const res = await getOptionChain(token, fut.instrument_key, expiry, spot, pinnedStrikes);
    if (res.chain) return { expiry, chain: res.chain };
    lastError = res.error;
  }
  return { expiry: candidates[0], error: lastError };
}

// When the nearest future's own option series has NOTHING discoverable at
// all (getOptionExpiries found zero expiries, so resolveOptionChain only had
// the future's own -- often wrong -- expiry date to try), there is no
// expiry left to fall back to within that one future. This widens the
// search to the next couple of upcoming futures contracts and tries each
// one's own option chain in turn, so a near-month future whose options
// already stopped listing a day or two before its own expiry doesn't leave
// the page with nothing. Falls back to the primary future's own result
// (including its error) if every alternative also comes up empty, so the
// error message still describes a real attempt.
async function resolveOptionChainAcrossFutures(
  token: string,
  query: string,
  primaryFut: FutureInfo,
  spot: number | null,
  pinnedStrikes: number[] = []
): Promise<{ fut: FutureInfo; expiry: string; chain?: any[]; error?: string }> {
  const primary = await resolveOptionChain(token, primaryFut, spot, pinnedStrikes);
  if (primary.chain) return { fut: primaryFut, ...primary };

  const upcoming = await getUpcomingFutures(token, query, 3);
  for (const altFut of upcoming) {
    if (altFut.instrument_key === primaryFut.instrument_key) continue;
    const alt = await resolveOptionChain(token, altFut, spot, pinnedStrikes);
    if (alt.chain) return { fut: altFut, ...alt };
  }
  return { fut: primaryFut, ...primary };
}

function nearestStrikes(chain: any[], spot: number, sideCount = 6, pinnedStrikes: number[] = []) {
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
  const windowRows = sorted.slice(start, end);

  // A strike the client has an open trade tracked against must always come
  // back, even once the underlying has moved far enough that it falls
  // outside the normal ATM-centered display window -- otherwise that one
  // trade's live premium (and its target-hit/close detection) silently
  // freezes at whatever it last was while everything else keeps updating.
  const windowStrikes = new Set(windowRows.map((r) => r.strike_price));
  const pinnedRows = pinnedStrikes.length ? sorted.filter((r) => pinnedStrikes.includes(r.strike_price) && !windowStrikes.has(r.strike_price)) : [];
  const rows = pinnedRows.length ? [...windowRows, ...pinnedRows].sort((a, b) => a.strike_price - b.strike_price) : windowRows;

  return { rows, atmStrike: sorted.length ? sorted[atmIdx].strike_price : null };
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

// ---- Options Greeks (Black-76, for options on futures) ----
// MCX commodity options are options on the futures contract (not the spot),
// so Black-76 is the correct model (vs. plain Black-Scholes, which assumes
// a spot underlying with a dividend yield). r is a flat approximation of
// India's risk-free rate; it mainly affects discounting, not direction.
const RISK_FREE_RATE = 0.065;

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normCDF(x: number) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function normPDF(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 vol point (1%)
  rho: number; // per 1 rate point (1%)
}

function black76Price(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0) return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const df = Math.exp(-r * T);
  return isCall ? df * (F * normCDF(d1) - K * normCDF(d2)) : df * (K * normCDF(-d2) - F * normCDF(-d1));
}

function black76Greeks(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): Greeks {
  if (T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * T);
  const price = black76Price(F, K, T, r, sigma, isCall);

  const delta = isCall ? df * normCDF(d1) : -df * normCDF(-d1);
  const gamma = (df * normPDF(d1)) / (F * sigma * sqrtT);
  const vega = (F * df * normPDF(d1) * sqrtT) / 100; // per 1 vol point
  const thetaAnnual = isCall
    ? -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) + r * df * (F * normCDF(d1)) - r * df * (K * normCDF(d2))
    : -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) - r * df * (F * normCDF(-d1)) + r * df * (K * normCDF(-d2));
  const theta = thetaAnnual / 365;
  const rho = (-T * price) / 100; // per 1 rate point

  // Gamma especially needs more than 2 decimal places at these underlying
  // price scales (often 0.0001-0.001) -- r2 would round it straight to 0.
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { delta: r6(delta), gamma: r6(gamma), theta: r6(theta), vega: r6(vega), rho: r6(rho) };
}

// Solves for implied volatility from a market premium via bisection --
// slower than Newton-Raphson but immune to the divergence issues Newton's
// method has near expiry / deep ITM-OTM strikes, which matters more here
// than raw speed for a handful of strikes per request.
function impliedVolatility(marketPrice: number, F: number, K: number, T: number, r: number, isCall: boolean): number | null {
  if (marketPrice <= 0 || T <= 0) return null;
  let lo = 0.001;
  let hi = 5.0;
  const intrinsic = isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  if (marketPrice < intrinsic * Math.exp(-r * T)) return null; // below intrinsic, no valid IV
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const price = black76Price(F, K, T, r, mid, isCall);
    if (Math.abs(price - marketPrice) < 1e-4) return r2(mid * 100);
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return r2(((lo + hi) / 2) * 100);
}

function yearsToExpiry(expiry: string): number {
  const ms = new Date(expiry).getTime() - Date.now();
  return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 0);
}

// The strike where option writers (sellers) collectively owe the least if
// the underlying settles there at expiry -- a common (not guaranteed) magnet
// for price to drift toward as expiry approaches, since option sellers are
// typically the better-capitalized side of the trade.
function computeMaxPain(chain: any[]): number | null {
  if (!chain.length) return null;
  const strikes = chain.map((r) => r.strike_price);
  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const r of chain) {
      const callOI = r.call_options?.market_data?.oi || 0;
      const putOI = r.put_options?.market_data?.oi || 0;
      pain += callOI * Math.max(settle - r.strike_price, 0);
      pain += putOI * Math.max(r.strike_price - settle, 0);
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
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
// Days of prior 1-minute history to stitch onto today's live feed. 30 bars
// at 4 hours each needs 5 trading days' worth; 20 calendar days comfortably
// covers that even accounting for weekends/holidays.
const PRIOR_HISTORY_DAYS = 20;

async function getCandlesForTF(env: Env, token: string, fut: FutureInfo, tf: string): Promise<Candle[] | { error: string }> {
  if (tf === "1D") {
    const candles = await getHistoricalCandles(token, fut.instrument_key);
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
  const priorDays = await getHistoricalIntradayCandles(env, token, fut.instrument_key, PRIOR_HISTORY_DAYS);
  const todayStart = oneMinToday.length ? +new Date(oneMinToday[0].date) : Infinity;
  const combined = [...priorDays.filter((c) => +new Date(c.date) < todayStart), ...oneMinToday];

  const candles = tfMinutes === 1 ? combined : resampleCandles(combined, tfMinutes);
  if (candles.length < 15) return { error: "Not enough bars yet at this timeframe — try again later in the session" };
  return candles;
}

async function computeScan(env: Env, token: string, symbol: Symbol, tf: string): Promise<(SignalCard & { timeframe: string }) | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(env, token, fut, tf);
  if ("error" in candles) return candles;
  const signal = await buildSignalCard(token, symbol, fut, candles);
  return { ...signal, timeframe: tf };
}

async function computeCandles(env: Env, token: string, symbol: Symbol, tf: string): Promise<{ tradingSymbol: string; timeframe: string; candles: Candle[] } | { error: string }> {
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

// ---- Global reference markets (overseas benchmarks MCX contracts track) ----
// MCX Crude Oil settles off a basket referencing WTI/Brent; MCX Natural Gas
// settles off Henry Hub. Those overseas markets trade on NYMEX/ICE well past
// MCX's ~23:30 IST close, so this is how a trader sees which way things are
// likely to gap when MCX reopens. Uses Yahoo Finance's public (unofficial,
// unauthenticated) chart endpoint, independent of the Upstox/KV token -- this
// works even when the user hasn't logged in via the main worker.
const GLOBAL_INSTRUMENTS: { symbol: string; name: string; tracksMCX: string }[] = [
  { symbol: "CL=F", name: "WTI Crude Oil (NYMEX)", tracksMCX: "CRUDEOIL" },
  { symbol: "BZ=F", name: "Brent Crude Oil (ICE)", tracksMCX: "CRUDEOIL" },
  { symbol: "NG=F", name: "Henry Hub Natural Gas (NYMEX)", tracksMCX: "NATURALGAS" },
];

interface GlobalQuote {
  symbol: string;
  name: string;
  tracksMCX: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string | null;
  error?: string;
}

async function getYahooQuote(symbol: string, name: string, tracksMCX: string): Promise<GlobalQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KumarSignalsPro/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { symbol, name, tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: `Yahoo Finance returned ${res.status}` };
  }
  const json: any = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    const errMsg = json?.chart?.error?.description || "No quote data returned";
    return { symbol, name, tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: errMsg };
  }
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = prevClose !== null ? r2(price - prevClose) : null;
  const changePercent = prevClose ? r2((change! / prevClose) * 100) : null;
  return {
    symbol,
    name,
    tracksMCX,
    price: r2(price),
    change,
    changePercent,
    currency: meta.currency ?? null,
    marketState: meta.marketState ?? null,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

async function computeGlobalMarkets(): Promise<GlobalQuote[]> {
  const results = await Promise.all(
    GLOBAL_INSTRUMENTS.map(async (inst) => {
      try {
        return await getYahooQuote(inst.symbol, inst.name, inst.tracksMCX);
      } catch (e: any) {
        return { symbol: inst.symbol, name: inst.name, tracksMCX: inst.tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: e.message };
      }
    })
  );
  return results;
}

// ---- Market depth (Level 2 order book) for the underlying future ----
// Reuses the exact same /v2/market-quote/quotes endpoint the option chain
// already calls (see getOptionChain above) -- Upstox's full quote response
// already includes a `depth` object (5 bid/ask levels) alongside the
// last_price/oi/volume fields this file was already reading, so this is one
// more read of an endpoint already in use, not a new upstream integration.
// Some accounts/plans may not carry L2 depth entitlement for MCX -- returns
// { error } rather than fabricating levels when Upstox sends none back, so
// the frontend can show an honest "unavailable" state instead of fake data.
interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface MarketDepthSnapshot {
  tradingSymbol: string;
  bestBid: number | null;
  bestAsk: number | null;
  buyDepth: DepthLevel[];
  sellDepth: DepthLevel[];
  totalBuyQuantity: number;
  totalSellQuantity: number;
  volume: number | null;
  averagePrice: number | null;
  asOf: string;
}

async function getFuturesDepth(token: string, instrumentKey: string, tradingSymbol: string): Promise<MarketDepthSnapshot | { error: string }> {
  const usp = new URLSearchParams({ instrument_key: instrumentKey });
  const res = await fetch(`https://api.upstox.com/v2/market-quote/quotes?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    return { error: `Depth request failed (HTTP ${res.status} ${res.statusText}): response was not valid JSON` };
  }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e: any) => e.message || e.errorCode || JSON.stringify(e)).join("; ");
    return { error: `Upstox rejected the depth request (HTTP ${res.status}): ${msg}` };
  }
  if (json.status !== "success" || !json.data) return { error: `Upstox returned no quote data for this instrument (HTTP ${res.status})` };
  const quote: any = Object.values(json.data)[0];
  if (!quote) return { error: "No quote returned for this instrument" };
  const depth = quote.depth;
  if (!depth || !Array.isArray(depth.buy) || !Array.isArray(depth.sell) || (!depth.buy.length && !depth.sell.length)) {
    return { error: "This account doesn't appear to have Level 2 market depth entitlement for MCX -- Upstox returned no depth levels" };
  }
  const toLevels = (levels: any[]): DepthLevel[] => levels.filter((l) => l && l.price).map((l) => ({ price: l.price, quantity: l.quantity ?? 0, orders: l.orders ?? 0 }));
  const buyDepth = toLevels(depth.buy);
  const sellDepth = toLevels(depth.sell);
  return {
    tradingSymbol,
    bestBid: buyDepth[0]?.price ?? null,
    bestAsk: sellDepth[0]?.price ?? null,
    buyDepth,
    sellDepth,
    totalBuyQuantity: quote.total_buy_quantity ?? buyDepth.reduce((s, l) => s + l.quantity, 0),
    totalSellQuantity: quote.total_sell_quantity ?? sellDepth.reduce((s, l) => s + l.quantity, 0),
    volume: quote.volume ?? null,
    averagePrice: quote.average_price ?? null,
    asOf: new Date().toISOString(),
  };
}

async function computeMarketDepth(token: string, symbol: Symbol): Promise<MarketDepthSnapshot | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  return getFuturesDepth(token, fut.instrument_key, fut.trading_symbol);
}

interface OptionLegAnalytics {
  ltp: number | null;
  oi: number | null;
  iv: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
}

interface OptionRowAnalytics {
  strike: number;
  call: OptionLegAnalytics & Partial<Greeks>;
  put: OptionLegAnalytics & Partial<Greeks>;
}

interface OptionsAnalytics {
  symbol: Symbol;
  tradingSymbol: string;
  expiry: string;
  spot: number;
  atmStrike: number | null;
  pcr: number | null;
  bias: Direction;
  support: number | null;
  resistance: number | null;
  maxPain: number | null;
  rows: OptionRowAnalytics[];
}

async function computeOptionsAnalytics(token: string, symbol: Symbol, pinnedStrikes: number[] = []): Promise<OptionsAnalytics | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };

  const candles = await getHistoricalCandles(token, fut.instrument_key);
  const spot = candles && candles.length ? candles[candles.length - 1].close : null;

  const { fut: optionFut, expiry: optionExpiry, chain, error } = await resolveOptionChainAcrossFutures(token, symbol, fut, spot, pinnedStrikes);
  const chainRes = { chain, error };
  if (chainRes.error || !chainRes.chain) return { error: chainRes.error ?? "Option chain unavailable" };

  const refSpot = spot ?? chainRes.chain[0]?.underlying_spot_price ?? 0;
  const { rows, atmStrike } = nearestStrikes(chainRes.chain, refSpot, 8, pinnedStrikes);
  const analysis = analyzeChain(chainRes.chain);
  const maxPain = computeMaxPain(chainRes.chain);
  const T = yearsToExpiry(optionExpiry);

  const analyticsRows: OptionRowAnalytics[] = rows.map((r: any) => {
    const callLtp = r.call_options?.market_data?.ltp || null;
    const putLtp = r.put_options?.market_data?.ltp || null;
    const callIV = callLtp ? impliedVolatility(callLtp, refSpot, r.strike_price, T, RISK_FREE_RATE, true) : null;
    const putIV = putLtp ? impliedVolatility(putLtp, refSpot, r.strike_price, T, RISK_FREE_RATE, false) : null;
    const callGreeks = callIV ? black76Greeks(refSpot, r.strike_price, T, RISK_FREE_RATE, callIV / 100, true) : null;
    const putGreeks = putIV ? black76Greeks(refSpot, r.strike_price, T, RISK_FREE_RATE, putIV / 100, false) : null;
    const callClose = r.call_options?.market_data?.close_price || null;
    const putClose = r.put_options?.market_data?.close_price || null;
    return {
      strike: r.strike_price,
      call: {
        ltp: callLtp,
        oi: r.call_options?.market_data?.oi || null,
        iv: callIV,
        volume: r.call_options?.market_data?.volume ?? null,
        change: callLtp && callClose ? r2(callLtp - callClose) : null,
        changePercent: callLtp && callClose ? r2(((callLtp - callClose) / callClose) * 100) : null,
        ...(callGreeks ?? {}),
      },
      put: {
        ltp: putLtp,
        oi: r.put_options?.market_data?.oi || null,
        iv: putIV,
        volume: r.put_options?.market_data?.volume ?? null,
        change: putLtp && putClose ? r2(putLtp - putClose) : null,
        changePercent: putLtp && putClose ? r2(((putLtp - putClose) / putClose) * 100) : null,
        ...(putGreeks ?? {}),
      },
    };
  });

  return {
    symbol,
    tradingSymbol: optionFut.trading_symbol,
    expiry: optionExpiry,
    spot: refSpot,
    atmStrike,
    pcr: analysis.pcr,
    bias: analysis.bias,
    support: analysis.support,
    resistance: analysis.resistance,
    maxPain,
    rows: analyticsRows,
  };
}

interface PortfolioTrade {
  id: string;
  symbol: Symbol;
  optSide?: "CE" | "PE";
  strike?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number; // number of lots
  lotSize: number;
  stopLoss?: number;
  target?: number;
  entryDate: string;
  exitDate?: string;
  status: "OPEN" | "CLOSED";
  pnl?: number;
  notes?: string;
  mistakes?: string;
  lessons?: string;
  emotion?: string;
  source?: "manual" | "master-ai" | "signal";
}

const PORTFOLIO_KV_KEY = "portfolio_trades";

async function getPortfolioTrades(env: Env): Promise<PortfolioTrade[]> {
  const raw = await env.COMMODITY_KV.get(PORTFOLIO_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePortfolioTrades(env: Env, trades: PortfolioTrade[]): Promise<void> {
  await env.COMMODITY_KV.put(PORTFOLIO_KV_KEY, JSON.stringify(trades));
}

function computePnl(trade: PortfolioTrade): number | undefined {
  if (trade.exitPrice === undefined) return undefined;
  return r2((trade.exitPrice - trade.entryPrice) * trade.quantity * trade.lotSize);
}

async function createPortfolioTrade(env: Env, body: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  if (!body.symbol || !ALL_SYMBOLS.includes(body.symbol as Symbol)) throw new Error("symbol is required");
  if (typeof body.entryPrice !== "number") throw new Error("entryPrice is required");
  if (typeof body.quantity !== "number" || body.quantity <= 0) throw new Error("quantity is required");
  if (typeof body.lotSize !== "number" || body.lotSize <= 0) throw new Error("lotSize is required");

  // Logging a trade that's already closed (e.g. importing real broker
  // history) needs entry AND exit set in the same call -- the existing
  // OPEN-then-PATCH-to-close flow always stamps exitDate as "now", which is
  // wrong for a trade that actually closed days ago.
  const hasExit = typeof body.exitPrice === "number";

  const trade: PortfolioTrade = {
    id: crypto.randomUUID(),
    symbol: body.symbol as Symbol,
    optSide: body.optSide,
    strike: body.strike,
    entryPrice: body.entryPrice,
    quantity: body.quantity,
    lotSize: body.lotSize,
    stopLoss: body.stopLoss,
    target: body.target,
    entryDate: body.entryDate ?? new Date().toISOString(),
    status: hasExit ? "CLOSED" : "OPEN",
    notes: body.notes,
    mistakes: body.mistakes,
    lessons: body.lessons,
    emotion: body.emotion,
    source: body.source ?? "manual",
  };
  if (hasExit) {
    trade.exitPrice = body.exitPrice;
    trade.exitDate = body.exitDate ?? new Date().toISOString();
    trade.pnl = computePnl(trade);
  }

  const trades = await getPortfolioTrades(env);
  trades.unshift(trade);
  await savePortfolioTrades(env, trades);
  return trade;
}

async function updatePortfolioTrade(env: Env, id: string, patch: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  const trades = await getPortfolioTrades(env);
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error("Trade not found");

  const updated: PortfolioTrade = { ...trades[idx], ...patch, id: trades[idx].id };
  if (patch.exitPrice !== undefined && !patch.status) updated.status = "CLOSED";
  if (updated.status === "CLOSED") {
    updated.exitDate = updated.exitDate ?? new Date().toISOString();
    updated.pnl = computePnl(updated);
  }
  trades[idx] = updated;
  await savePortfolioTrades(env, trades);
  return updated;
}

async function deletePortfolioTrade(env: Env, id: string): Promise<void> {
  const trades = await getPortfolioTrades(env);
  const next = trades.filter((t) => t.id !== id);
  await savePortfolioTrades(env, next);
}

// Every page's own signal/call history (Best Call, AI-Risk, AI-Test V2/Pro,
// Kumar AI, Elite, Kimi, Directional Gate) previously lived only in each
// browser's own localStorage -- opening the app on a different browser or
// device showed nothing, since it was never sent anywhere. This app has no
// login, so there's exactly one shared history (same as every other piece
// of data this Worker already serves) rather than a per-user one. The
// client is responsible for merging/debouncing before it pushes here -- this
// is a deliberately simple whole-blob get/put, no per-entry validation,
// matching the same trust level as the portfolio trades KV store above.
const TRADE_LOGS_KV_KEY = "trade_logs_v1";

async function getTradeLogsFromKv(env: Env): Promise<Record<string, unknown>> {
  const raw = await env.COMMODITY_KV.get(TRADE_LOGS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveTradeLogsToKv(env: Env, logs: Record<string, unknown>): Promise<void> {
  await env.COMMODITY_KV.put(TRADE_LOGS_KV_KEY, JSON.stringify(logs));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---- Kumar AI: Workers AI reasoning layer for the Kumar AI page ----
// The entry/stop/target/decision/confidence numbers are ALWAYS computed by
// the same deterministic, already-verified rule-based engine the rest of
// this app uses (analyzeTimeframe on the frontend) -- they are sent HERE
// already decided, and the model is explicitly instructed never to change
// them. Its only job is the qualitative layer this app can't compute on its
// own: plain-language reasoning, bullish/bearish factor lists, risk
// factors, expected movement, and a holding-duration suggestion. If the
// model call fails or returns unparseable output, this returns an honest
// error/empty result rather than fabricating a narrative.
interface KumarAiIndicatorSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  vwap: number | null;
  atr14: number | null;
  adx14: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  superTrend: { value: number; direction: string } | null;
  volumeRatio: number | null;
}

interface KumarAiAnalyzeRequest {
  symbol: string;
  timeframeLabel: string;
  decision: string;
  bias: string;
  optSide: string | null;
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number | null;
  confidencePct: number | null;
  indicators: KumarAiIndicatorSnapshot;
  structureLabel: string | null;
  patternLabel: string | null;
  supportResistanceNote: string | null;
  reasons: string[];
}

interface KumarAiAnalyzeResult {
  reasoning: string;
  bullishReasons: string[];
  bearishReasons: string[];
  riskFactors: string[];
  expectedMovement: string;
  holdingDuration: string;
  bestTimeframeNote: string;
  error?: string;
}

function buildKumarAiPrompt(body: KumarAiAnalyzeRequest): string {
  const ind = body.indicators;
  return `Symbol: ${body.symbol}
Timeframe: ${body.timeframeLabel}
Decision already determined by the rule-based engine: ${body.decision} (bias: ${body.bias})
Option side: ${body.optSide ?? "n/a"}
Entry: ${body.entry}
Stop Loss: ${body.stop}
Targets: ${body.targets.join(", ")}
Risk:Reward: ${body.rr ?? "n/a"}
Confidence: ${body.confidencePct ?? "n/a"}%
EMA9/20/50/200: ${ind.ema9 ?? "n/a"} / ${ind.ema20 ?? "n/a"} / ${ind.ema50 ?? "n/a"} / ${ind.ema200 ?? "n/a"}
RSI(14): ${ind.rsi14 ?? "n/a"}
MACD: line=${ind.macd?.line ?? "n/a"} signal=${ind.macd?.signal ?? "n/a"} histogram=${ind.macd?.histogram ?? "n/a"}
VWAP: ${ind.vwap ?? "n/a"}
ATR(14): ${ind.atr14 ?? "n/a"}
ADX(14): ${ind.adx14 ?? "n/a"}
Bollinger Bands: upper=${ind.bollinger?.upper ?? "n/a"} middle=${ind.bollinger?.middle ?? "n/a"} lower=${ind.bollinger?.lower ?? "n/a"}
SuperTrend: ${ind.superTrend?.value ?? "n/a"} (${ind.superTrend?.direction ?? "n/a"})
Volume vs 10-bar average: ${ind.volumeRatio ?? "n/a"}x
Market structure: ${body.structureLabel ?? "n/a"}
Candle pattern: ${body.patternLabel ?? "n/a"}
Support/Resistance note: ${body.supportResistanceNote ?? "n/a"}
Reasons the rule-based engine already identified: ${body.reasons.join("; ") || "none"}

Do NOT invent, change, or second-guess the entry/stop/target/decision numbers above -- treat them as fixed facts. Return ONLY this JSON shape, no markdown fences, no extra keys:
{
  "reasoning": "2-3 sentence plain-language summary of why this call was generated",
  "bullishReasons": ["short bullet", "..."],
  "bearishReasons": ["short bullet", "..."],
  "riskFactors": ["short bullet", "..."],
  "expectedMovement": "short phrase describing expected price behavior",
  "holdingDuration": "short suggested holding time range",
  "bestTimeframeNote": "one sentence on whether this timeframe suits this setup"
}`;
}

// Accepts `unknown`, not `string` -- with response_format:"json_object", the
// Workers AI binding sometimes hands back an already-parsed object under
// `.response` instead of a JSON string (shape varies by model/binding
// version), and calling .trim() on that used to throw "raw.trim is not a
// function", surfacing as a broken AI-reasoning panel instead of a graceful
// fallback.
function parseKumarAiResponse(raw: unknown): KumarAiAnalyzeResult {
  const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const fromObj = (obj: Record<string, unknown>): KumarAiAnalyzeResult => ({
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    bullishReasons: strArray(obj.bullishReasons),
    bearishReasons: strArray(obj.bearishReasons),
    riskFactors: strArray(obj.riskFactors),
    expectedMovement: typeof obj.expectedMovement === "string" ? obj.expectedMovement : "",
    holdingDuration: typeof obj.holdingDuration === "string" ? obj.holdingDuration : "",
    bestTimeframeNote: typeof obj.bestTimeframeNote === "string" ? obj.bestTimeframeNote : "",
  });

  if (raw && typeof raw === "object") {
    return fromObj(raw as Record<string, unknown>);
  }

  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: "AI returned an empty response",
    };
  }

  try {
    const cleaned = text
      .trim()
      .replace(/^```(json)?/i, "")
      .replace(/```$/, "")
      .trim();
    return fromObj(JSON.parse(cleaned));
  } catch {
    // Model didn't return valid JSON -- surface the raw text as the
    // reasoning rather than silently dropping it or fabricating structure.
    return {
      reasoning: text.trim().slice(0, 800),
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
    };
  }
}

async function computeKumarAiAnalysis(env: Env, body: KumarAiAnalyzeRequest): Promise<KumarAiAnalyzeResult> {
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a professional commodity trading analyst. You are given REAL, already-computed technical indicator readings and a REAL entry/stop/target/decision already decided by a deterministic rule-based engine -- you must NEVER invent or change any of these numbers. Your only job is to explain, in strict JSON, why these readings support (or don't fully support) this call: bullish/bearish factors, risk factors, expected movement, and a holding-duration suggestion. Reply with ONLY a single JSON object, no markdown, no commentary outside the JSON.",
        },
        { role: "user", content: buildKumarAiPrompt(body) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 700,
    });
    return parseKumarAiResponse((result as { response?: unknown }).response);
  } catch (err: unknown) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: err instanceof Error ? err.message : "AI reasoning unavailable right now",
    };
  }
}

// ---- Best Call background push notifications (ntfy.sh) ----
// A Cron Trigger (see wrangler.jsonc) calls runBestCallNotificationCheck on a
// schedule, independent of anyone having the app open -- unlike the
// browser-notification alert engine on the frontend (which only runs while a
// tab is open), this is what lets a call reach the user even with the site
// fully closed. Deliberately built on ntfy.sh (a free, no-signup push relay:
// just an HTTPS POST to a topic URL) instead of hand-rolling the raw Web
// Push protocol -- that would need per-subscription VAPID/AES-GCM crypto
// this environment has no way to verify end-to-end against a real device,
// and a broken crypto path could break at runtime in ways that are very
// hard to diagnose. ntfy trades a small amount of trust in a third-party
// relay for something that's simple, free, and immediately testable by the
// user via the "Send test notification" button in Settings.
const NTFY_TOPIC_KV_KEY = "ntfy_topic";

const CRON_TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];
// Same "next higher timeframe confirms the trend" mapping the Directional
// Gate page's own useDirectionalGateSuite hook uses on the frontend.
const CRON_TREND_TF: Record<string, string> = { "15": "60", "30": "60", "60": "240", "240": "1D" };

function bestCallSignature(pick: BestCallPick): string {
  return `${pick.strike}-${pick.optSide}-${pick.source}`;
}

async function sendNtfyNotification(topic: string, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title, Priority: "high", Tags: "chart_with_upwards_trend" },
      body,
    });
    if (!res.ok) return { ok: false, error: `ntfy.sh responded HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "ntfy.sh request failed" };
  }
}

// Runs the exact same 3-engine comparison (AI Elite + Directional Gate +
// Kimi playbook -> pickBestCall) the frontend's Best Call page displays,
// entirely server-side so it can run on a schedule with nobody's browser
// open. Returns null the same way the frontend does when nothing currently
// qualifies -- never fabricates a pick just to have something to notify.
async function computeBestCallForSymbol(env: Env, token: string, symbol: Symbol): Promise<BestCallPick | null> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return null;
  const commodity: "NG" | "CL" = symbol === "NATURALGAS" ? "NG" : "CL";

  const candlesByTf: Record<string, Candle[]> = {};
  for (const { tf } of CRON_TIMEFRAMES) {
    const c = await getCandlesForTF(env, token, fut, tf);
    candlesByTf[tf] = "error" in c ? [] : c;
  }
  const daily = await getCandlesForTF(env, token, fut, "1D");
  candlesByTf["1D"] = "error" in daily ? [] : daily;

  const optionsResult = await computeOptionsAnalytics(token, symbol);
  const options = "error" in optionsResult ? undefined : optionsResult;

  const analyses = CRON_TIMEFRAMES.map(({ tf, label }) =>
    analyzeTimeframe({ tf, label, candles: candlesByTf[tf], dailyCandles: candlesByTf["1D"], options, journalWinRate: null })
  );
  const eliteEntries = analyses.map((a) => ({ symbol, analysis: a, options }));
  const elite = findEliteSignal(eliteEntries);
  const elitePick = elite ? eliteToBestCallPick(elite) : null;

  const gatePicks: BestCallPick[] = [];
  for (const direction of ["bullish", "bearish"] as const) {
    for (const { tf, label } of CRON_TIMEFRAMES) {
      const evaluation = evaluateDirectionalGate(direction, candlesByTf[tf], candlesByTf[CRON_TREND_TF[tf]] ?? []);
      if (evaluation.status !== "qualified") continue;
      const p = gateToBestCallPick(evaluation, direction, label, options);
      if (p) gatePicks.push(p);
    }
  }

  const kimiTimeframes = CRON_TIMEFRAMES.map(({ tf, label }) => ({ tf, label, candles: candlesByTf[tf] }));
  const kimiResults = scanAllSetups(commodity, kimiTimeframes);
  const kimiPicks = kimiResults.map((r) => kimiToBestCallPick(r, commodity, options)).filter((p): p is BestCallPick => p !== null);

  const allPicks = [...(elitePick ? [elitePick] : []), ...gatePicks, ...kimiPicks];
  return pickBestCall(allPicks);
}

// Only notifies when the pick actually CHANGES (tracked via a per-symbol
// "last notified" signature in KV) -- otherwise the same still-running call
// would re-notify every single Cron tick.
async function runBestCallNotificationCheck(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  for (const symbol of OPTION_SYMBOLS) {
    try {
      const pick = await computeBestCallForSymbol(env, token, symbol as Symbol);
      if (!pick) continue;
      const lastSigKey = `notified:BEST-${symbol}`;
      const lastSig = await env.COMMODITY_KV.get(lastSigKey);
      const sig = bestCallSignature(pick);
      if (sig === lastSig) continue;
      await env.COMMODITY_KV.put(lastSigKey, sig);

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const title = `Best Call: ${displayName} ${pick.strike} ${pick.optSide}`;
      const body = [
        `BUY ${displayName} ${pick.strike} ${pick.optSide}`,
        "",
        `Entry: Rs ${pick.entry}`,
        `Targets: ${pick.targets.join(" / ")}`,
        `Stop: Rs ${pick.stop}`,
        "",
        `Source: ${pick.source} (${Math.round(pick.confidence)}% confidence)`,
      ].join("\n");
      await sendNtfyNotification(topic, title, body);
    } catch {
      // best-effort -- one symbol failing shouldn't block the other
    }
  }
}

async function requireToken(env: Env): Promise<string | Response> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return json({ error: "No token found in KV. Log in via the main kumarcmtd worker's /login first." }, 400);
  return token;
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/market-status") {
          return json(getMarketStatus());
        }

        if (url.pathname === "/api/global-markets") {
          return json(await computeGlobalMarkets());
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
          return json(await computeScan(env, token, symbol, tf));
        }

        if (url.pathname === "/api/candles") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "1D";
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeCandles(env, token, symbol, tf));
        }

        if (url.pathname === "/api/kumar-ai/analyze") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const body = (await request.json().catch(() => null)) as KumarAiAnalyzeRequest | null;
          if (!body || !body.symbol || !body.timeframeLabel || typeof body.entry !== "number") {
            return json({ error: "Invalid request body" }, 400);
          }
          return json(await computeKumarAiAnalysis(env, body));
        }

        const optionsMatch = url.pathname.match(/^\/api\/options\/([A-Z]+)$/);
        if (optionsMatch) {
          const symbol = optionsMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          // Strikes the client currently has an open trade tracked against --
          // always kept in the response even if the underlying has since
          // moved far enough that they'd otherwise fall outside the normal
          // ATM-centered window (see nearestStrikes/getOptionChain).
          const pinnedStrikes = (url.searchParams.get("strikes") ?? "")
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
          return json(await computeOptionsAnalytics(token, symbol, pinnedStrikes));
        }

        const depthMatch = url.pathname.match(/^\/api\/depth\/([A-Z]+)$/);
        if (depthMatch) {
          const symbol = depthMatch[1] as Symbol;
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeMarketDepth(token, symbol));
        }

        if (url.pathname === "/api/notify/topic") {
          if (request.method === "GET") {
            const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
            return json({ topic: topic ?? null });
          }
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as { topic?: string };
            const topic = (body.topic ?? "").trim();
            if (!topic || topic.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(topic)) {
              return json({ error: "Topic must be 1-64 characters: letters, numbers, dashes, or underscores only" }, 400);
            }
            await env.COMMODITY_KV.put(NTFY_TOPIC_KV_KEY, topic);
            return json({ ok: true, topic });
          }
          if (request.method === "DELETE") {
            await env.COMMODITY_KV.delete(NTFY_TOPIC_KV_KEY);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/notify/test") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
          if (!topic) return json({ error: "No ntfy topic saved yet -- save one first" }, 400);
          const result = await sendNtfyNotification(topic, "Kumar Signals Pro test", "If you can see this, background push notifications are working.");
          if (!result.ok) return json({ error: result.error ?? "Failed to send test notification" }, 502);
          return json({ ok: true });
        }

        if (url.pathname === "/api/notify/check-now") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          await runBestCallNotificationCheck(env);
          return json({ ok: true });
        }

        if (url.pathname === "/api/portfolio") {
          if (request.method === "GET") return json(await getPortfolioTrades(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await createPortfolioTrade(env, body), 201);
          }
          return json({ error: "Method not allowed" }, 405);
        }

        const portfolioMatch = url.pathname.match(/^\/api\/portfolio\/([a-zA-Z0-9-]+)$/);
        if (portfolioMatch) {
          const id = portfolioMatch[1];
          if (request.method === "PATCH") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await updatePortfolioTrade(env, id, body));
          }
          if (request.method === "DELETE") {
            await deletePortfolioTrade(env, id);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/trade-logs") {
          if (request.method === "GET") return json(await getTradeLogsFromKv(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
            if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body must be an object keyed by trade-log id" }, 400);
            await saveTradeLogsToKv(env, body);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        return json({ error: "Not found" }, 404);
      } catch (err: any) {
        // Full detail (including anything a stack trace would show) goes to
        // Cloudflare's own logs (wrangler tail / dashboard) only -- the
        // client only ever sees a short, capped message, never a trace.
        console.error("API error:", err);
        const message = typeof err?.message === "string" && err.message.length > 0 ? err.message.slice(0, 300) : "Internal server error";
        return json({ error: message }, 500);
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
}

export default {
  // Every response this Worker can return -- API JSON, index.html, and every
  // static asset -- passes through withSecurityHeaders exactly once here,
  // so no individual route can accidentally ship without the app's security
  // headers by forgetting to set them itself.
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handleRequest(request, env));
  },

  // Cloudflare Cron Trigger (see wrangler.jsonc "triggers.crons") -- runs
  // independent of any browser tab being open, which is what makes push
  // notifications actually reach the user with the app fully closed.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runBestCallNotificationCheck(env));
  },
};
