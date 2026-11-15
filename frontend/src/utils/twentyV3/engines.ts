// The pages that run on the v3 engine. Each one picks its setups (from the
// lab), which of them are practice-only, its trade-log key and its live-only
// checks. Everything else -- reading candles, sizing, the order ticket, trade
// management, alerts, the journal -- is the same tested code for both pages.

import type { LabSym } from "../twentyLab";
import type { V3SetupId } from "./setups";

export type EngineId = "v3" | "fast";

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
}

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
};

export const ENGINES: readonly EngineDef[] = [ENGINE_V3, ENGINE_FAST];
export const engineById = (id: EngineId): EngineDef => (id === "fast" ? ENGINE_FAST : ENGINE_V3);
/** Practice-only anywhere (setup ids are unique across pages). */
export const isPracticeAnywhere = (id: V3SetupId) => ENGINES.some((e) => e.practice.has(id));
