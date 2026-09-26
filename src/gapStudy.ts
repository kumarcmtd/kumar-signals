// Morning-window gap study (9:00-11:00 AM IST) over 30-minute history.

import { type Candle, type Env, type Symbol, UPSTOX_HIST_URL, upstoxJson } from "./env";
import { getYahooQuote, GLOBAL_INSTRUMENTS } from "./globalMarkets";
import { getCandlesForTF } from "./signals";
import { getIntradayCandles, getNearestFuture, sortByTime } from "./upstox";

// ---- Morning-window gap study (9:00-11:00 AM IST) ----
// The overnight-impact card originally scored a gap by where the session
// CLOSED, ~14 hours after the open. That answered the wrong question for an
// options trader who is in and out in the morning, so this measures only the
// first two hours: open at 9:00 against the price at 11:00.
//
// That window cannot come from daily candles, which carry a single OHLC for
// the whole session, so this pulls 30-minute history -- exactly four bars
// (9:00, 9:30, 10:00, 10:30) span 9:00 to 11:00. Upstox allows a wider date
// range at 30-minute resolution than at 1-minute, which is what makes a
// usable sample affordable in one request.
//
// Note the real limit on sample size is not this range: MCX futures roll
// monthly, so a contract only ever has as much history as it has existed.
// The response reports how many sessions were actually found and the client
// shows that number rather than implying a fixed lookback.
export const GAP_STUDY_DAYS = 90;
const GAP_STUDY_CACHE_TTL_SECONDS = 6 * 60 * 60;
const MORNING_START_HOUR = 9;
const MORNING_END_HOUR = 11;

interface MorningGapSession {
  date: string;
  gapPct: number;
  openPrice: number;
  closePrice: number;
  movePct: number;
  highPct: number;
  lowPct: number;
}

interface GapStudyResponse {
  available: boolean;
  windowLabel: string;
  latest: { date: string; gapPct: number; open: number; prevClose: number; live: boolean } | null;
  /** The global benchmark this symbol tracks, for a like-for-like comparison. */
  global: { name: string; changePct: number | null } | null;
  sessions: MorningGapSession[];
  error?: string;
}

// Exchange-local hour straight off Upstox's own +05:30 stamp -- the Worker
// runs in UTC, so parsing to a Date and reading getHours() would silently
// shift every bar by 5.5 hours and put the whole morning in the wrong window.
// Fast path reads "YYYY-MM-DDTHH:MM" by position, as Upstox always sends it;
// anything shaped differently falls through to the original regex, so the
// result is the same for every input. Called once per half-hour bar.
const isDigit = (c: number) => c >= 48 && c <= 57;
export function istHourOfStamp(date: string): number | null {
  // With "-" at 4, "T" at 10 and ":" at 13, no earlier "T\d\d:\d\d" can
  // exist in the string, so this is exactly the regex's first match.
  if (
    date.length >= 16 && date.charCodeAt(4) === 45 /* - */ && date.charCodeAt(10) === 84 /* T */ && date.charCodeAt(13) === 58 /* : */ &&
    isDigit(date.charCodeAt(11)) && isDigit(date.charCodeAt(12)) && isDigit(date.charCodeAt(14)) && isDigit(date.charCodeAt(15))
  ) {
    return (date.charCodeAt(11) - 48) * 10 + (date.charCodeAt(12) - 48) + ((date.charCodeAt(14) - 48) * 10 + (date.charCodeAt(15) - 48)) / 60;
  }
  const m = /T(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** Today's cache key for the 30-minute history (UTC date, as it always was). */
export function hist30mCacheKey(instrumentKey: string): string {
  return `hist30m:${instrumentKey}:${new Date().toISOString().slice(0, 10)}`;
}

export async function getHistorical30mCandles(env: Env, token: string, instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(to);
  const cacheKey = hist30mCacheKey(instrumentKey);

  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      // fall through and refetch on a corrupt cache entry
    }
  }

  try {
    const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/30minute/${toStr}/${fmt(from)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json: any = await upstoxJson(res, "prior-day price history");
    if (json.status !== "success" || !json.data || !json.data.candles) return [];
    const candles: Candle[] = json.data.candles.map((c: any[]) => ({
      date: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] ?? 0, oi: c[6] ?? 0,
    }));
    sortByTime(candles);
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(candles), { expirationTtl: GAP_STUDY_CACHE_TTL_SECONDS });
    return candles;
  } catch {
    return [];
  }
}

export function buildMorningSessions(daily: Candle[], bars30m: Candle[]): MorningGapSession[] {
  // Previous session's close, keyed by the session it gaps into.
  const prevCloseByDate = new Map<string, number>();
  for (let i = 1; i < daily.length; i++) {
    prevCloseByDate.set(daily[i].date.slice(0, 10), daily[i - 1].close);
  }

  const morningByDate = new Map<string, Candle[]>();
  for (const c of bars30m) {
    const hour = istHourOfStamp(c.date);
    if (hour === null || hour < MORNING_START_HOUR || hour >= MORNING_END_HOUR) continue;
    const day = c.date.slice(0, 10);
    const list = morningByDate.get(day);
    if (list) list.push(c);
    else morningByDate.set(day, [c]);
  }

  const out: MorningGapSession[] = [];
  for (const [date, bars] of morningByDate) {
    const prevClose = prevCloseByDate.get(date);
    if (prevClose === undefined || !(prevClose > 0) || bars.length === 0) continue;
    const openPrice = bars[0].open;
    if (!(openPrice > 0)) continue;
    const closePrice = bars[bars.length - 1].close;
    const high = Math.max(...bars.map((b) => b.high));
    const low = Math.min(...bars.map((b) => b.low));
    out.push({
      date,
      gapPct: Number((((openPrice - prevClose) / prevClose) * 100).toFixed(2)),
      openPrice,
      closePrice,
      movePct: Number((((closePrice - openPrice) / openPrice) * 100).toFixed(2)),
      highPct: Number((((high - openPrice) / openPrice) * 100).toFixed(2)),
      lowPct: Number((((openPrice - low) / openPrice) * 100).toFixed(2)),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function computeGapStudy(env: Env, token: string, symbol: Symbol): Promise<GapStudyResponse> {
  const empty = { available: false, windowLabel: "9:00-11:00 AM", latest: null, global: null, sessions: [] as MorningGapSession[] };
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { ...empty, error: "No instrument found" };

  const daily = await getCandlesForTF(env, token, fut, "1D");
  if ("error" in daily) return { ...empty, error: daily.error };

  const bars30m = await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
  const sessions = buildMorningSessions(daily, bars30m);

  // Upstox's historical DAILY endpoint only returns completed sessions, so at
  // 9:18 AM the newest daily candle is still yesterday's -- which made the card
  // show yesterday's gap at exactly the moment the overnight move matters most.
  // Today's real open comes from the live intraday feed instead: its first
  // 1-minute bar IS the 9:00 open, measured against the last completed daily
  // close. The daily-only path stays as the fallback for outside market hours.
  let latest: GapStudyResponse["latest"] = null;
  const lastDaily = daily.length ? daily[daily.length - 1] : null;
  const todayBars = await getIntradayCandles(token, fut.instrument_key);
  const firstBar = todayBars && todayBars.length ? todayBars[0] : null;

  if (firstBar && lastDaily && lastDaily.close > 0 && firstBar.open > 0 && firstBar.date.slice(0, 10) !== lastDaily.date.slice(0, 10)) {
    latest = {
      date: firstBar.date,
      gapPct: Number((((firstBar.open - lastDaily.close) / lastDaily.close) * 100).toFixed(2)),
      open: firstBar.open,
      prevClose: lastDaily.close,
      live: true,
    };
  } else if (daily.length >= 2) {
    const prev = daily[daily.length - 2];
    const cur = daily[daily.length - 1];
    if (prev.close > 0 && cur.open > 0) {
      latest = { date: cur.date, gapPct: Number((((cur.open - prev.close) / prev.close) * 100).toFixed(2)), open: cur.open, prevClose: prev.close, live: false };
    }
  }

  // The global benchmark MCX is following. Yahoo reports this against the
  // benchmark's OWN previous close, which is a near but not identical window
  // to "since MCX shut" -- the card says so rather than implying they are the
  // same measurement.
  const wanted = symbol === "CRUDEOIL" ? "CL=F" : "NG=F";
  const inst = GLOBAL_INSTRUMENTS.find((g) => g.symbol === wanted);
  let globalQuote: GapStudyResponse["global"] = null;
  if (inst) {
    try {
      const q = await getYahooQuote(inst.symbol, inst.name, inst.tracksMCX);
      globalQuote = { name: inst.name, changePct: q.changePercent };
    } catch {
      globalQuote = null;
    }
  }

  return {
    available: sessions.length > 0,
    windowLabel: "9:00-11:00 AM",
    latest,
    global: globalQuote,
    sessions,
    error: sessions.length === 0 ? "No 30-minute morning history available for this contract yet" : undefined,
  };
}
