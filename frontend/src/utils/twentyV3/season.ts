// The season switch: the v2 calls make money in some stretches and lose in
// others (crude 2026: +Rs 515 a call; 2025: -Rs 368). So a rule like this is
// traded the way a fund manager runs a strategy -- live while it is working,
// resting (practice calls only) once its own recent record clearly turns bad.
//
// The rule, exactly as the lab tested it (scripts/smart-lab.ts, gateTrades
// with pauseOnlyOnEvidence): replay the rule over the last 10 trading days
// before today; REST only if that replay made 5+ calls and they averaged below
// zero after costs. Fewer calls than that is no evidence, so it stays live.

import type { Candle } from "../../types";
import { prepare, type LabSym, type LabTrade, type Prepared } from "../twentyLab";
import { computeFeatures } from "./features";
import type { V3SetupId } from "./setups";
import { simulateV3 } from "./sim";

export const SEASON = { lookbackDays: 10, minCalls: 5, floorRs: 0 } as const;

export interface Season {
  resting: boolean;
  /** Replayed calls in the window and their average / net Rs per lot after costs. */
  calls: number;
  avgRs: number | null;
  netRs: number;
  /** Net Rs per lot for each of those trading days, oldest first (IST dates). */
  days: { date: string; netRs: number; calls: number }[];
}

const IST_MS = 5.5 * 3600_000;
const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);
const dateOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** The switch on a replay `trades` over prepared candles `p`, for the day that contains `now`. */
export function seasonOf(trades: LabTrade[], p: Prepared, now: number): Season {
  const today = istDay(now);
  const prior = [...new Set(p.day)].filter((d) => d < today).sort((a, b) => a - b);
  const window = prior.slice(-SEASON.lookbackDays);
  const inWin = new Set(window);
  const sel = trades.filter((t) => inWin.has(p.day[t.closeIdx]));
  const netRs = sel.reduce((a, t) => a + t.rs, 0);
  const avgRs = sel.length ? Math.round(netRs / sel.length) : null;
  const days = window.map((d) => {
    const xs = sel.filter((t) => p.day[t.closeIdx] === d);
    return { date: dateOf(d), netRs: Math.round(xs.reduce((a, t) => a + t.rs, 0)), calls: xs.length };
  });
  const resting = sel.length >= SEASON.minCalls && netRs / sel.length < SEASON.floorRs;
  return { resting, calls: sel.length, avgRs, netRs: Math.round(netRs), days };
}

/** Replay `setup` on recent 5-minute candles (prior days count) and read the switch. */
export function measureSeason(history: Candle[], sym: LabSym, setup: V3SetupId, now: number): Season | null {
  if (history.length < 650) return null;
  // The v2 strength score is only needed in its New York window.
  const p = prepare(history, { etFrom: 10 * 60 + 30, etTo: 13 * 60 + 15 });
  const trades = simulateV3({ p, f: computeFeatures(p) }, [setup], { sym });
  return seasonOf(trades, p, now);
}
