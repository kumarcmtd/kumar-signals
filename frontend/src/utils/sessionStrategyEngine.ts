import type { TimeframeAnalysis } from "./timeframeEngine";
import type { PriceSpeedReading } from "./priceSpeed";

// "AI Own" -- a session-timing strategy for MCX Crude Oil & Natural Gas.
//
// The premise (confirmed by how these markets actually trade): MCX energy is a
// price-taker off global oil/gas, so it moves hardest around specific GLOBAL
// events, not evenly through the 9am-11:30pm IST day. The morning is thin and
// mostly digests the overnight US move; the real volatility clusters in the
// European session (~2-6:30pm IST) and the US session (~7-11:30pm IST), and
// spikes on the weekly EIA reports (~8pm IST -- Crude on Wednesday, Natural Gas
// on Thursday). These are verifiable market-structure edges, NOT social-media
// tips -- the strategy only looks for a trade DURING these windows, and even
// then only takes a genuine momentum breakout (never just "it's 8pm, buy").

export type Impact = "very-high" | "high" | "moderate";

export interface SessionWindow {
  id: string;
  label: string;
  driver: string; // the real global event behind this window
  startMin: number; // IST minutes from midnight
  endMin: number;
  impact: Impact;
  // If set, this window is an EIA inventory report and is only "very-high"
  // on that IST weekday (1=Mon .. 4=Thu), for that symbol.
  eiaWeekday?: number;
  eiaSymbol?: "CRUDEOIL" | "NATURALGAS";
}

const HM = (h: number, m: number) => h * 60 + m;

// Ordered through the trading day. Times are IST. Windows deliberately bracket
// the event (a few minutes before, through the burst after).
export const POWER_WINDOWS: SessionWindow[] = [
  { id: "eu-open", label: "European Open", driver: "London/EU desks come in and set the session's early direction after the thin Asian morning.", startMin: HM(12, 30), endMin: HM(13, 30), impact: "moderate" },
  { id: "eu-momentum", label: "Afternoon Europe Push", driver: "European session in full swing — the first reliably liquid trend of the MCX day.", startMin: HM(15, 45), endMin: HM(16, 30), impact: "moderate" },
  { id: "eu-peak", label: "Europe Peak + US Pre-Market Data", driver: "Peak European volume overlapping US pre-open economic data (often 6:00pm IST / 8:30am ET).", startMin: HM(17, 30), endMin: HM(18, 30), impact: "high" },
  { id: "us-open", label: "US Market Open", driver: "US equities + NYMEX pit open (7:00pm IST / 9:30am ET) — risk-on/off flows spill straight into energy.", startMin: HM(19, 0), endMin: HM(19, 45), impact: "high" },
  { id: "eia-crude", label: "EIA Crude Inventory", driver: "US EIA weekly petroleum report (8:00pm IST / 10:30am ET) — the single biggest scheduled crude mover; a small surprise can move MCX ₹50–150 in seconds.", startMin: HM(19, 55), endMin: HM(20, 45), impact: "high", eiaWeekday: 3, eiaSymbol: "CRUDEOIL" },
  { id: "eia-natgas", label: "EIA Natural Gas Storage", driver: "US EIA weekly natural-gas storage report (8:00pm IST / 10:30am ET) — the single biggest scheduled gas mover.", startMin: HM(19, 55), endMin: HM(20, 45), impact: "high", eiaWeekday: 4, eiaSymbol: "NATURALGAS" },
  { id: "us-trend", label: "US Session Trend", driver: "Full US overlap (NYMEX/COMEX live) — the day's strongest sustained trends and best follow-through.", startMin: HM(21, 0), endMin: HM(22, 30), impact: "high" },
];

export interface SessionState {
  istMinutes: number;
  istWeekday: number; // 0=Sun .. 6=Sat
  active: SessionWindow | null;
  next: SessionWindow | null;
  minutesToNext: number | null; // minutes until `next` opens (0 if active)
  // Effective impact right now, upgraded to very-high when an EIA window is
  // live on its own report day for its own symbol.
  activeImpact: Impact | null;
  eiaTodayFor: "CRUDEOIL" | "NATURALGAS" | null; // which symbol has an EIA report today
  // Non-null when the market is closed (weekend, outside MCX hours, or the
  // live market-status API says so). No window is ever "active" while set --
  // a window is a time-of-day edge, but only when the market is actually open.
  closedReason: string | null;
}

// MCX energy trades Mon-Fri, ~9:00am-11:55pm IST.
const MCX_OPEN_MIN = 9 * 60;
const MCX_CLOSE_MIN = 23 * 60 + 55;
export function isTradingDay(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function effectiveImpact(w: SessionWindow, weekday: number): Impact {
  if (w.eiaWeekday != null) return w.eiaWeekday === weekday ? "very-high" : "moderate";
  return w.impact;
}

// Pure: given IST minutes-of-day, weekday, and (optionally) the live
// market-status flag, resolve the session state. marketOpen is authoritative
// when provided (so it also catches MCX holidays the calendar rules can't);
// when it's undefined, the weekend + trading-hours rules stand in.
export function sessionStateFor(istMinutes: number, istWeekday: number, marketOpen?: boolean): SessionState {
  const eiaTodayFor = isTradingDay(istWeekday) ? POWER_WINDOWS.find((w) => w.eiaWeekday === istWeekday)?.eiaSymbol ?? null : null;

  let closedReason: string | null = null;
  if (marketOpen === false) closedReason = "Market is closed right now — no live windows.";
  else if (marketOpen === undefined) {
    if (!isTradingDay(istWeekday)) closedReason = "Weekend — MCX is closed. Windows resume Monday morning.";
    else if (istMinutes < MCX_OPEN_MIN || istMinutes >= MCX_CLOSE_MIN) closedReason = "Outside MCX trading hours (9:00 AM–11:55 PM IST).";
  }
  if (closedReason) {
    return { istMinutes, istWeekday, active: null, next: null, minutesToNext: null, activeImpact: null, eiaTodayFor, closedReason };
  }

  let active: SessionWindow | null = null;
  for (const w of POWER_WINDOWS) {
    // An EIA window only "counts" as active on its report weekday.
    if (w.eiaWeekday != null && w.eiaWeekday !== istWeekday) continue;
    if (istMinutes >= w.startMin && istMinutes < w.endMin) {
      active = w;
      break;
    }
  }

  let next: SessionWindow | null = null;
  let minutesToNext: number | null = null;
  if (!active) {
    for (const w of POWER_WINDOWS) {
      if (w.eiaWeekday != null && w.eiaWeekday !== istWeekday) continue;
      if (w.startMin > istMinutes) {
        next = w;
        minutesToNext = w.startMin - istMinutes;
        break;
      }
    }
  } else {
    minutesToNext = 0;
  }

  return {
    istMinutes,
    istWeekday,
    active,
    next,
    minutesToNext,
    activeImpact: active ? effectiveImpact(active, istWeekday) : null,
    eiaTodayFor,
    closedReason: null,
  };
}

// Wall-clock wrapper: derives IST minutes + weekday via Intl (correct
// regardless of the device/runner timezone), then delegates to the pure fn.
// Pass the live market-status isOpen flag so holidays are respected too.
export function sessionStateNow(now: Date = new Date(), marketOpen?: boolean): SessionState {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wdName);
  return sessionStateFor(hour * 60 + minute, weekday < 0 ? 0 : weekday, marketOpen);
}

export interface SessionSetup {
  decision: "STRONG BUY" | "BUY" | "STRONG SELL" | "SELL" | "WAIT";
  direction: "bullish" | "bearish" | null;
  optSide: "CE" | "PE" | null;
  confidence: number | null; // 0-100
  reasons: string[];
  waitingReason: string | null; // set when decision is WAIT, explains why
}

const IMPACT_BONUS: Record<Impact, number> = { "very-high": 14, high: 8, moderate: 4 };
// Below this Price Speed the market isn't actually moving yet -- a window is a
// necessary condition, not a sufficient one, so a calm window is still a WAIT.
const MIN_SPEED_SCORE = 38;

// The strategy: only take a trade when (a) we're inside a high-movement window,
// and (b) there is a genuine, moving, directional break -- the timeframe read
// is directional with no vetoes AND price is actually moving (Price Speed).
// Confidence is the technical read boosted by how strong the window's own
// edge is, so the same setup ranks higher during the EIA report than during a
// quiet European open.
export function evaluateSessionSetup(state: SessionState, analysis: TimeframeAnalysis, speed: PriceSpeedReading | null): SessionSetup {
  const base: SessionSetup = { decision: "WAIT", direction: null, optSide: null, confidence: null, reasons: [], waitingReason: null };

  if (state.closedReason) {
    return { ...base, waitingReason: state.closedReason };
  }
  if (!state.active) {
    const nextLabel = state.next ? `${state.next.label} (~${state.minutesToNext} min)` : "tomorrow's first window";
    return { ...base, waitingReason: `Outside a high-movement window. Next: ${nextLabel}. No trade until then, by design.` };
  }
  if (analysis.insufficient) return { ...base, waitingReason: `In the ${state.active.label} window, but not enough candles yet for a reliable read.` };
  if (analysis.bias === "neutral" || analysis.vetoes.length > 0) {
    return { ...base, waitingReason: `In the ${state.active.label} window, but no clean directional break yet${analysis.vetoes.length ? ` (${analysis.vetoes[0]})` : ""}.` };
  }
  if (!speed || speed.score < MIN_SPEED_SCORE) {
    return { ...base, waitingReason: `In the ${state.active.label} window and leaning ${analysis.bias}, but price isn't moving with conviction yet (Price Speed ${speed?.score ?? "—"}). Waiting for the move to fire.` };
  }

  const impact = state.activeImpact ?? state.active.impact;
  const bull = analysis.bias === "bullish";
  const rawConfidence = (analysis.hitProbability ?? 50) + IMPACT_BONUS[impact] + (speed.score >= 55 ? 5 : 0);
  const confidence = Math.max(20, Math.min(97, Math.round(rawConfidence)));
  const decision: SessionSetup["decision"] = confidence >= 80 ? (bull ? "STRONG BUY" : "STRONG SELL") : bull ? "BUY" : "SELL";

  const reasons = [
    `${state.active.label} window is live (${impact.replace("-", " ")} impact) — ${state.active.driver}`,
    `Price is moving: ${speed.label} (Price Speed ${speed.score}).`,
    ...analysis.reasons.slice(0, 3),
  ];

  return { decision, direction: analysis.bias, optSide: bull ? "CE" : "PE", confidence, reasons, waitingReason: null };
}
