// LIVE session trend -- the candles forming right now, read as they form.
//
// The overnight study next to this one answers a HISTORICAL question: when the
// gap was this size, what usually happened afterwards. Useful before 9:00 AM,
// useless at 11:40 AM when you are already in a trade and want to know whether
// the move you are riding is still pushing or quietly dying.
//
// This answers that second question, and only that one. It takes today's bars
// from the 9:00 AM open onwards and reports three things:
//
//   1. Which way the session has gone since the open.
//   2. Whether that move is STILL EXTENDING -- making new session highs (or
//      lows) with bars that still have size behind them.
//   3. Whether it is WEAKENING (stalled, giving the run back, bars shrinking)
//      or has TURNED BACK through the opening price.
//
// WHAT IT IS NOT. Every figure here describes what has ALREADY happened. A
// trend that stops making new highs for 45 minutes has, as a matter of record,
// stopped making new highs -- that is a fact. Whether it resumes or reverses
// next is not knowable, and this module never claims it is. The wording is
// chosen so that a tired trend reads as "the push has faded, decide what to do
// with your position", never as "it will now fall".
//
// COST. It reads the same 15-minute candle series every other page already
// pulls, in the browser, so it adds no Worker CPU and no extra Upstox call --
// which matters while the 1015 rate limit is live.

import type { Candle } from "../types";
import { atr } from "./indicators";
import { istDateOf } from "./overnightFollowThrough";

export type LiveTrendState =
  /** No usable candles at all. */
  | "no_session"
  /** The session has only just opened -- too few bars to read anything. */
  | "too_early"
  /** Price is moving, but by less than this instrument's own normal bar range. */
  | "no_direction"
  /** Direction intact and still pushing. */
  | "extending"
  /** Direction intact, but the push has faded. */
  | "weakening"
  /** Price has come back through the open, or given most of the run back. */
  | "turned";

export interface LiveCheck {
  id: string;
  /** Short name of the thing being checked. */
  label: string;
  ok: boolean;
  /** Plain sentence saying what the check actually found. */
  detail: string;
}

export interface LiveSessionTrend {
  state: LiveTrendState;
  headline: string;
  /** What this means for a position, hedged honestly. */
  advice: string;
  /** "Opened 9,020, ran up to 9,085 by 11:15, now 9,058." */
  story: string;
  date: string | null;
  direction: 1 | -1 | 0;
  directionWord: "up" | "down" | "sideways";
  openPrice: number | null;
  lastPrice: number | null;
  /** Yesterday's close, when the series reaches back that far. */
  prevClose: number | null;
  gapPct: number | null;
  /** Move since the open, signed. */
  movePct: number | null;
  /** High-to-low of the session so far, as a percentage of the open. */
  rangePct: number | null;
  /** Furthest point reached IN the session's direction. */
  extremePrice: number | null;
  extremeTime: string | null;
  barsSinceExtreme: number;
  minutesSinceExtreme: number;
  /** How much of the run from open to extreme has been handed back, 0-100+. */
  givebackPct: number | null;
  bars: number;
  barMinutes: number;
  /** The last bar is still being built and can still change. */
  forming: boolean;
  /** This is a finished past session, not today's live one. */
  stale: boolean;
  checks: LiveCheck[];
  /** How many of the checks above are still passing. */
  healthy: number;
  /** The failing checks, condensed for a warning strip. */
  warnings: string[];
}

/** Below this many bars since the open there is nothing honest to say. */
export const MIN_BARS = 3;
/** Bars without a new session extreme before the move counts as stalled. */
const STALL_BARS = 3;
/** Giving back this much of the run is the first real warning. */
const GIVEBACK_WEAK = 35;
/** Giving back this much means the move is effectively over. */
const GIVEBACK_TURN = 70;
/** The session move must clear this many ATRs to be called a direction. */
const DIRECTION_ATR_FLOOR = 0.5;
/** Fallback when there is no ATR yet: a move worth naming, in percent. */
const DIRECTION_PCT_FLOOR = 0.15;
/** Recent bars smaller than this fraction of the earlier ones = drying up. */
const CONTRACTION_RATIO = 0.6;
/** Recent volume below this fraction of the session average = no size behind it. */
const VOLUME_RATIO = 0.7;

/**
 * The clock time off an Upstox stamp, read straight from the text.
 *
 * Deliberately not `new Date(...).getHours()`: this app runs on a UTC Worker
 * and the stamps carry +05:30, so a Date round-trip would report every bar
 * five and a half hours early.
 */
export function timeLabelOf(stamp: string): string {
  return stamp.slice(11, 16);
}

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's IST calendar date, e.g. "2026-09-23" -- the session being traded. */
export function istToday(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

/** Prices here run from ~250 (Natural Gas) to ~9,000 (Crude), so precision varies. */
export function fmtPrice(n: number): string {
  const dp = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 100 ? 1 : 2;
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function empty(state: LiveTrendState, headline: string, advice: string): LiveSessionTrend {
  return {
    state,
    headline,
    advice,
    story: "",
    date: null,
    direction: 0,
    directionWord: "sideways",
    openPrice: null,
    lastPrice: null,
    prevClose: null,
    gapPct: null,
    movePct: null,
    rangePct: null,
    extremePrice: null,
    extremeTime: null,
    barsSinceExtreme: 0,
    minutesSinceExtreme: 0,
    givebackPct: null,
    bars: 0,
    barMinutes: 0,
    forming: false,
    stale: false,
    checks: [],
    healthy: 0,
    warnings: [],
  };
}

export interface LiveTrendOptions {
  /** True while MCX is open. Drives the "still forming" wording only. */
  marketOpen?: boolean;
  /** The calendar date the live session should be, e.g. "2026-09-23". */
  today?: string | null;
}

/**
 * Reads today's session out of a normal multi-day candle series.
 *
 * The series is whatever the rest of the app already has -- typically 15-minute
 * bars stitched across several days -- so the last calendar date in it is the
 * session being traded, and the date before it supplies the previous close.
 */
export function readLiveSessionTrend(
  candles: Candle[] | undefined | null,
  options: LiveTrendOptions = {}
): LiveSessionTrend {
  if (!candles || candles.length === 0) {
    return empty("no_session", "No candles yet", "Nothing has been received for this session, so nothing is shown rather than a guess.");
  }

  const byDate = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = istDateOf(c.date);
    const list = byDate.get(d);
    if (list) list.push(c);
    else byDate.set(d, [c]);
  }
  const dates = [...byDate.keys()].sort();
  const date = dates[dates.length - 1];
  const bars = byDate.get(date)!;
  const prevBars = dates.length > 1 ? byDate.get(dates[dates.length - 2])! : null;
  const prevClose = prevBars && prevBars.length ? prevBars[prevBars.length - 1].close : null;

  // A session that is not today is a finished one. It still reads usefully
  // (how did yesterday's trend end), but it must not be presented as live.
  const stale = Boolean(options.today) && date !== options.today;
  const forming = Boolean(options.marketOpen) && !stale;

  if (bars.length < MIN_BARS) {
    const base = empty(
      "too_early",
      "Too early to read the session",
      `Only ${bars.length} ${bars.length === 1 ? "bar has" : "bars have"} formed since the open. A direction read off one or two bars is noise, so nothing is claimed yet.`
    );
    return { ...base, date, bars: bars.length, forming, stale, prevClose };
  }

  const open = bars[0].open;
  const last = bars[bars.length - 1];
  const lastPrice = last.close;
  if (!(open > 0)) {
    return empty("no_session", "Opening price missing", "The opening bar did not carry a usable price, so the session cannot be measured.");
  }

  // Bar spacing is taken from the data rather than assumed, so this still
  // reads correctly if the card is ever pointed at 5- or 30-minute candles.
  const barMinutes = bars.length > 1 ? Math.max(1, Math.round(minutesBetween(bars[0].date, bars[1].date))) : 15;

  const move = lastPrice - open;
  const movePct = (move / open) * 100;

  const sessionHigh = Math.max(...bars.map((b) => b.high));
  const sessionLow = Math.min(...bars.map((b) => b.low));
  const rangePct = ((sessionHigh - sessionLow) / open) * 100;

  // A move has to clear the instrument's own normal bar range before it is
  // called a direction, otherwise every quiet morning reads as a trend: Crude
  // near Rs.9,000 and Natural Gas near Rs.250 cannot share a fixed threshold.
  //
  // The percentage is a floor UNDER that, not an alternative to it. On a very
  // quiet stretch the ATR itself collapses, and an ATR-only gate would then
  // promote a two-rupee wobble in Crude to a trend simply because the bars
  // around it were even smaller.
  const atrValue = atr(candles, 14);
  const floor = Math.max(atrValue && atrValue > 0 ? DIRECTION_ATR_FLOOR * atrValue : 0, (open * DIRECTION_PCT_FLOOR) / 100);

  const direction = firstExcursion(bars, open, floor);

  if (direction === 0) {
    const base = empty(
      "no_direction",
      "No clear direction yet",
      "Price is close to where it opened, by less than this contract's own normal bar range. There is no trend here to ride or to exit — a move this small is noise."
    );
    return {
      ...base,
      date,
      openPrice: open,
      lastPrice,
      prevClose,
      gapPct: prevClose ? Number((((open - prevClose) / prevClose) * 100).toFixed(2)) : null,
      movePct: Number(movePct.toFixed(2)),
      rangePct: Number(rangePct.toFixed(2)),
      bars: bars.length,
      barMinutes,
      forming,
      stale,
      story: `Opened ${fmtPrice(open)}, now ${fmtPrice(lastPrice)} — ${fmtPrice(Math.abs(move))} ${move >= 0 ? "up" : "down"} in ${bars.length} bars.`,
    };
  }

  const directionWord = direction > 0 ? "up" : "down";

  // Furthest point reached IN the direction: the high for an up session, the
  // low for a down one. Everything after this is measured against it.
  let extremeIndex = 0;
  let extremePrice = direction > 0 ? bars[0].high : bars[0].low;
  for (let i = 0; i < bars.length; i += 1) {
    const p = direction > 0 ? bars[i].high : bars[i].low;
    if (direction > 0 ? p > extremePrice : p < extremePrice) {
      extremePrice = p;
      extremeIndex = i;
    }
  }
  const extremeTime = timeLabelOf(bars[extremeIndex].date);
  const barsSinceExtreme = bars.length - 1 - extremeIndex;
  const minutesSinceExtreme = barsSinceExtreme * barMinutes;

  const run = Math.abs(extremePrice - open);
  const givenBack = direction > 0 ? extremePrice - lastPrice : lastPrice - extremePrice;
  const givebackPct = run > 0 ? Number(((givenBack / run) * 100).toFixed(0)) : null;

  // Back through the OPEN is judged on the closing price, not a wick. Price
  // pokes through the opening level constantly in the first hour; a bar that
  // CLOSES on the wrong side of it is a different statement.
  const closedBackThroughOpen = direction > 0 ? lastPrice < open : lastPrice > open;
  const wickedThroughOpen = bars.slice(1).some((b) => (direction > 0 ? b.low < open : b.high > open));

  // --- The checks. Each one is a fact about bars that have already printed. ---
  const checks: LiveCheck[] = [];

  checks.push({
    id: "new_extreme",
    label: `New session ${direction > 0 ? "high" : "low"}`,
    ok: barsSinceExtreme < STALL_BARS,
    detail:
      barsSinceExtreme === 0
        ? `At the session ${direction > 0 ? "high" : "low"} on the current bar.`
        : `No new ${direction > 0 ? "high" : "low"} for ${barsSinceExtreme} ${barsSinceExtreme === 1 ? "bar" : "bars"} (about ${minutesSinceExtreme} minutes). The ${direction > 0 ? "high" : "low"} was ${fmtPrice(extremePrice)} at ${extremeTime}.`,
  });

  checks.push({
    id: "above_open",
    label: `Holding ${direction > 0 ? "above" : "below"} the open`,
    ok: !closedBackThroughOpen,
    detail: closedBackThroughOpen
      ? `Price has closed back ${direction > 0 ? "below" : "above"} the ${fmtPrice(open)} opening price. The move since the open is gone.`
      : `Still ${direction > 0 ? "above" : "below"} the ${fmtPrice(open)} open${wickedThroughOpen ? ", though it dipped through it earlier and recovered" : ""}.`,
  });

  checks.push({
    id: "keeping_run",
    label: "Keeping the run",
    ok: givebackPct === null ? true : givebackPct < GIVEBACK_WEAK,
    detail:
      givebackPct === null
        ? "No measurable run away from the open yet."
        : givebackPct <= 0
          ? `Holding at the ${direction > 0 ? "highs" : "lows"} — nothing given back.`
          : `Given back ${givebackPct}% of the move from ${fmtPrice(open)} to ${fmtPrice(extremePrice)}.`,
  });

  const contraction = rangeContraction(bars);
  checks.push({
    id: "bar_size",
    label: "Bars still have size",
    ok: contraction === null ? true : contraction >= CONTRACTION_RATIO,
    detail:
      contraction === null
        ? "Not enough bars yet to compare recent bar size against earlier ones."
        : contraction >= CONTRACTION_RATIO
          ? `Recent bars are still ${Math.round(contraction * 100)}% the size of the earlier ones.`
          : `Recent bars have shrunk to ${Math.round(contraction * 100)}% of the earlier ones — the move is running out of range, not just pausing.`,
  });

  const recent = bars.slice(-3);
  const agreeing = recent.filter((b) => (direction > 0 ? b.close > b.open : b.close < b.open)).length;
  checks.push({
    id: "recent_bars",
    label: "Last bars agree",
    ok: agreeing >= 2,
    detail: `${agreeing} of the last ${recent.length} bars closed ${directionWord}${forming ? " (the newest one is still forming)" : ""}.`,
  });

  const volRatio = volumeRatio(bars);
  if (volRatio !== null) {
    checks.push({
      id: "volume",
      label: "Size behind it",
      ok: volRatio >= VOLUME_RATIO,
      detail:
        volRatio >= VOLUME_RATIO
          ? `Recent volume is ${Math.round(volRatio * 100)}% of the session average.`
          : `Recent volume has dropped to ${Math.round(volRatio * 100)}% of the session average — fewer people are pushing it.`,
    });
  }

  const failed = checks.filter((c) => !c.ok);
  const healthy = checks.length - failed.length;
  const stalled = barsSinceExtreme >= STALL_BARS;

  let state: LiveTrendState;
  if (closedBackThroughOpen || (givebackPct !== null && givebackPct >= GIVEBACK_TURN)) {
    state = "turned";
  } else if (stalled || (givebackPct !== null && givebackPct >= GIVEBACK_WEAK) || failed.length >= 2) {
    state = "weakening";
  } else {
    state = "extending";
  }

  const { headline, advice } = wording(state, direction, {
    stale,
    givebackPct,
    barsSinceExtreme,
    minutesSinceExtreme,
    open,
    extremePrice,
    closedBackThroughOpen,
  });

  const story = buildStory({ open, extremePrice, extremeTime, lastPrice, direction, bars: bars.length, barsSinceExtreme, forming });

  return {
    state,
    headline,
    advice,
    story,
    date,
    direction,
    directionWord,
    openPrice: open,
    lastPrice,
    prevClose,
    gapPct: prevClose ? Number((((open - prevClose) / prevClose) * 100).toFixed(2)) : null,
    movePct: Number(movePct.toFixed(2)),
    rangePct: Number(rangePct.toFixed(2)),
    extremePrice,
    extremeTime,
    barsSinceExtreme,
    minutesSinceExtreme,
    givebackPct,
    bars: bars.length,
    barMinutes,
    forming,
    stale,
    checks,
    healthy,
    warnings: failed.map((c) => c.detail),
  };
}

/**
 * Which way the session went FIRST, once it had gone far enough to count.
 *
 * The obvious definition -- last close against the open -- is wrong in exactly
 * the case this whole card exists for. A session that opens, runs 150 points
 * up and then reverses 190 points back through the open would be relabelled a
 * DOWN session: its low, printed on the newest bar, would read as a fresh low,
 * and the state would come out "trending down, still pushing". That is the
 * precise opposite of the warning a trader holding the morning's CE needs.
 *
 * So direction is fixed by the first excursion that clears the noise floor and
 * does not un-happen afterwards. "It opened and went up" stays true for the
 * rest of the day; what changes is whether the move is still working.
 */
function firstExcursion(bars: Candle[], open: number, floor: number): 1 | -1 | 0 {
  for (const b of bars) {
    const up = b.high - open;
    const down = open - b.low;
    const upOk = up >= floor;
    const downOk = down >= floor;
    // A single bar that cleared the floor BOTH ways is a wide opening bar; the
    // bigger side is the one that set the tone.
    if (upOk && downOk) return up >= down ? 1 : -1;
    if (upOk) return 1;
    if (downOk) return -1;
  }
  return 0;
}

/** Recent bar range against the earlier session bars. Null when too few bars. */
function rangeContraction(bars: Candle[]): number | null {
  if (bars.length < 6) return null;
  const recent = bars.slice(-3);
  const earlier = bars.slice(0, -3);
  const avg = (list: Candle[]) => list.reduce((s, b) => s + (b.high - b.low), 0) / list.length;
  const earlierAvg = avg(earlier);
  if (!(earlierAvg > 0)) return null;
  return avg(recent) / earlierAvg;
}

/** Recent volume against the session average. Null when volume is missing. */
function volumeRatio(bars: Candle[]): number | null {
  if (bars.length < 6) return null;
  if (!bars.every((b) => typeof b.volume === "number" && (b.volume ?? 0) > 0)) return null;
  const all = bars.reduce((s, b) => s + (b.volume ?? 0), 0) / bars.length;
  if (!(all > 0)) return null;
  const recent = bars.slice(-3);
  return recent.reduce((s, b) => s + (b.volume ?? 0), 0) / recent.length / all;
}

/** Minutes between two IST stamps, read off the text rather than via Date. */
function minutesBetween(a: string, b: string): number {
  const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  return Math.abs(mins(b) - mins(a));
}

function buildStory(x: {
  open: number;
  extremePrice: number;
  extremeTime: string;
  lastPrice: number;
  direction: 1 | -1;
  bars: number;
  barsSinceExtreme: number;
  forming: boolean;
}): string {
  const ran = x.direction > 0 ? "ran up to" : "fell to";
  const now = x.forming ? "now trading" : "finished at";
  if (x.barsSinceExtreme === 0) {
    return `Opened ${fmtPrice(x.open)}, ${ran} ${fmtPrice(x.extremePrice)} over ${x.bars} bars, and is at that level right now.`;
  }
  return `Opened ${fmtPrice(x.open)}, ${ran} ${fmtPrice(x.extremePrice)} by ${x.extremeTime}, ${now} ${fmtPrice(x.lastPrice)}.`;
}

function wording(
  state: LiveTrendState,
  direction: 1 | -1,
  x: {
    stale: boolean;
    givebackPct: number | null;
    barsSinceExtreme: number;
    minutesSinceExtreme: number;
    open: number;
    extremePrice: number;
    closedBackThroughOpen: boolean;
  }
): { headline: string; advice: string } {
  const up = direction > 0;
  const word = up ? "up" : "down";
  const side = up ? "CE" : "PE";
  const past = x.stale ? " (this is the last completed session, not live)" : "";

  if (state === "extending") {
    return {
      headline: `Trending ${word}, still pushing${past}`,
      advice:
        `The session is ${word} from the open and still making new ${up ? "highs" : "lows"}, with bars that still have size behind them. ` +
        `A ${side} position bought with this move is working. That describes what has happened so far — it is not a promise about the next hour, so keep your stop where it is rather than removing it.`,
    };
  }

  if (state === "weakening") {
    const bits: string[] = [];
    if (x.barsSinceExtreme > 0) bits.push(`no new ${up ? "high" : "low"} for about ${x.minutesSinceExtreme} minutes`);
    if (x.givebackPct !== null && x.givebackPct >= GIVEBACK_WEAK) bits.push(`${x.givebackPct}% of the move already handed back`);
    return {
      headline: `Trending ${word}, but the push is fading${past}`,
      advice:
        `Price is still ${up ? "above" : "below"} the ${fmtPrice(x.open)} open, so the direction has not flipped — but ${bits.join(" and ") || "the recent bars have stopped confirming it"}. ` +
        `This is the point where a ${side} position is worth reviewing: taking part off, or tightening the stop toward ${fmtPrice(x.extremePrice)} territory, both cost less than watching it round-trip. ` +
        `A fading push often resumes; this is a warning, not a forecast.`,
    };
  }

  if (state === "turned") {
    return {
      headline: x.closedBackThroughOpen ? `Turned back through the open${past}` : `The ${word} move has been given back${past}`,
      advice: x.closedBackThroughOpen
        ? `Price has closed back ${up ? "below" : "above"} the ${fmtPrice(x.open)} opening price. Everything the session gained ${word} is gone, and a ${side} bought on this move is now on the wrong side of where the day started. ` +
          `Whether it is a full reversal or a shakeout cannot be known from here — but the reason for holding a ${side} on the opening move no longer exists.`
        : `Price has handed back ${x.givebackPct}% of the run from ${fmtPrice(x.open)} to ${fmtPrice(x.extremePrice)}. The move is effectively over even though it has not crossed the open yet. ` +
          `Treat what is left of a ${side} position as a decision to be made now rather than one to postpone.`,
    };
  }

  return { headline: "No clear direction", advice: "There is no session trend to read." };
}
