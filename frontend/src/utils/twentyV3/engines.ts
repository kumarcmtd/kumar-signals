// The pages that run on the v3 engine. Each one picks its setups (from the
// lab), which of them are practice-only, its trade-log key and its live-only
// checks. Since 18 Nov 2026 only Ai-Super Fast (ENGINE_FAST) runs: the trader
// asked for the original Ai20-20 page back (aiTwentyTwentyEngine.ts), so the
// Ai20-20 lines below are no longer scheduled -- kept for their logs and tests. Everything else -- reading candles, sizing, the order ticket, trade
// management, alerts, the journal -- is the same tested code for both pages.

import type { LabSym } from "../twentyLab";
import { DAY_LAB } from "./labFacts";
import type { V3SetupId } from "./setups";

export type EngineId = "v3" | "fast" | "day" | "season";

export interface EngineDef {
  id: EngineId;
  /** Shown on calls and alerts, e.g. "Ai20-20 v3". */
  name: string;
  route: string;
  key: (sym: LabSym) => string;
  /** Setups that run, best first. */
  active: Record<LabSym, V3SetupId[]>;
  /** Active setups that are practice only (not proven on the holdout years). */
  practice: ReadonlySet<V3SetupId>;
  /** Live-only checks before a call opens -- they cannot be replayed on old years. */
  gates: { liquidity: boolean; news: boolean };
  /** Earlier logs whose still-running calls this page keeps managing. */
  olderKeys: (sym: LabSym) => string[];
  /** Why a market has no setups. */
  offText: string;
  /** When a call can come, in a few words (shown under the window). */
  callsWhen: string;
  /** The line's name on its call card when a page runs two lines (e.g. "All day"). */
  cardLabel?: string;
  /** A standing warning on the line's card. */
  cardNote?: string;
  /** Server alert marks (KV) are named after this, e.g. "TWENTY3". */
  tag: string;
  /** The name in phone alerts. */
  pushName: string;
  /** Live while the rule's own last 10 trading days did not clearly lose; practice while resting (season.ts). */
  season?: boolean;
}

export const ENGINE_SEASON: EngineDef = {
  id: "season",
  name: "Ai20-20",
  route: "/ai-20-20",
  key: (sym) => `TWENTY20-${sym}-SEASON`,
  // Smart lab (18 Nov 2026): the v2 trend calls -- the ones the trader earned
  // from -- plus the trader's own "care at the high" check, traded with the
  // season switch. Gas: the v2 calls lost on years of gas prices.
  active: { CRUDEOIL: ["trendGap"], NATURALGAS: [] },
  practice: new Set<V3SetupId>(),
  season: true,
  gates: { liquidity: false, news: false },
  olderKeys: () => [],
  offText: "The v2 calls lost money on years of gas prices — no gas calls.",
  callsWhen: "10:30 AM – 1:15 PM New York on a fresh strength turn with the 1-hour trend — never right under the recent high",
  cardLabel: "Main line",
  tag: "TWENTY20S",
  pushName: "Ai20-20",
};

export const ENGINE_V3: EngineDef = {
  id: "v3",
  name: "Ai20-20 v3",
  route: "/ai-20-20",
  key: (sym) => `TWENTY20-${sym}-V3`,
  // 10-year lab: nothing proven after costs; the big opening drive runs as practice.
  active: { CRUDEOIL: ["driveStrict"], NATURALGAS: [] },
  practice: new Set<V3SetupId>(["driveStrict"]),
  gates: { liquidity: false, news: false },
  olderKeys: (sym) => [`TWENTY20-${sym}-LIVE`, `TWENTY20-${sym}-V2`],
  offText: "Every setup lost money on years of gas prices — no gas calls.",
  callsWhen: "only on days with a big opening move",
  cardLabel: "Opening drive",
  tag: "TWENTY3",
  pushName: "Ai20-20",
};

export const ENGINE_DAY: EngineDef = {
  id: "day",
  name: "Ai20-20 all day",
  route: "/ai-20-20",
  key: (sym) => `TWENTY20-${sym}-DAY`,
  // The owner asked for calls through the whole MCX day (9:00 AM - 11:55 PM IST).
  // 10-year lab: the v2 rule over every MCX hour lost money in all ten years
  // (about -Rs 190 a call after costs), so it is PRACTICE only -- and its own
  // line (own log, one call at a time, own day limits) so it can never block
  // the big opening drive.
  active: { CRUDEOIL: ["trendDay"], NATURALGAS: [] },
  practice: new Set<V3SetupId>(["trendDay"]),
  gates: { liquidity: false, news: false },
  olderKeys: () => [],
  offText: "Every setup lost money on years of gas prices — no gas calls.",
  callsWhen: "a fresh 5-minute strength turn with the 1-hour trend",
  cardLabel: "All day",
  cardNote: `Practice only — on ten years of crude prices this all-day signal lost money in every year (about ₹${Math.abs(DAY_LAB.crude.trendDay.recent.avgRs)} a call after costs). Learn from it; do not trade it with money.`,
  tag: "TWENTY3DAY",
  pushName: "Ai20-20 all day",
};

export const ENGINE_FAST: EngineDef = {
  id: "fast",
  name: "Ai-Super Fast",
  route: "/ai-super-fast",
  key: (sym) => `SUPERFAST-${sym}-FAST`,
  // The trader's rule as written: Ai20-20's signal (strength turn + 1-hour trend,
  // US session, step exits) only at Speed 70+, plus live liquidity and news
  // checks. 10-year lab: Speed 70+ alone lost money in every version tested, so
  // it runs as PRACTICE until its live record -- news and liquidity included --
  // shows otherwise.
  active: { CRUDEOIL: ["fastTurnUS"], NATURALGAS: [] },
  practice: new Set<V3SetupId>(["fastTurnUS"]),
  gates: { liquidity: true, news: true },
  olderKeys: () => [],
  offText: "No Speed 70+ setup made money on years of gas prices — no gas calls.",
  callsWhen: "only when Speed is 70+, the strike is liquid and the news agrees",
  tag: "SUPERFAST",
  pushName: "Ai-Super Fast",
};

export const ENGINES: readonly EngineDef[] = [ENGINE_SEASON, ENGINE_V3, ENGINE_DAY, ENGINE_FAST];
export const engineById = (id: EngineId): EngineDef => (id === "fast" ? ENGINE_FAST : id === "day" ? ENGINE_DAY : id === "season" ? ENGINE_SEASON : ENGINE_V3);
/** Practice-only anywhere (setup ids are unique across pages). */
export const isPracticeAnywhere = (id: V3SetupId) => ENGINES.some((e) => e.practice.has(id));
