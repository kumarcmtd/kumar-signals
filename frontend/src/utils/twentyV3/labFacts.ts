// What the v3 rules lab measured (scripts/twenty-lab-v3.ts, GitHub Actions),
// shown on the page's setups board. Rupees per lot after costs, option at
// delta 0.5 -- a test on past prices, not a promise.

import type { V3SetupId } from "./setups";

export interface SetupFact {
  trades: number;
  perMonth: number;
  winPct: number;
  avgRs: number;
  pf: number;
  halves: [number, number];
  /** Passed the pick rule fixed before the run. */
  picked: boolean;
}

export interface MarketFacts {
  setups: Partial<Record<V3SetupId, SetupFact>>;
  /** The picked setups traded together with the day guards. */
  together: { trades: number; winPct: number; avgRs: number; worstMonth: number; winningMonths: string } | null;
}

export const V3_LAB = {
  ranAt: "",
  from: "",
  to: "",
  days: 0,
  crude: { setups: {}, together: null } as MarketFacts,
  gas: { setups: {}, together: null } as MarketFacts,
};
