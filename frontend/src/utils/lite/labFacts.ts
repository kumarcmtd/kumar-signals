// What the Ai Lite lab measured (scripts/lite-lab.ts on GitHub Actions,
// 18 Nov 2026): the rules exactly as live, Rs per lot after costs (Rs 150
// crude / Rs 200 gas a call + ~Rs 50 an hour of time decay), option at delta
// 0.5. A test on past prices, not a promise.

export const LITE_LAB = {
  ranAt: "18 Nov 2026",
  crude: {
    /** 2022-2026. */
    recent: { calls: 3618, perMonth: 60, winPct: 34, avgRs: -179, pf: 0.71, goalDays: 236, callDays: 1251, winMonths: "9 of 59" },
    /** 2017-2021, never used to choose anything. */
    holdout: { calls: 3054, winPct: 33, avgRs: -271, pf: 0.58, winMonths: "1 of 60" },
    /** The last 50 trading days of real NYMEX futures. */
    last50: { calls: 157, avgRs: -16 },
    /** The app's own MCX candles, last 15 trading days. */
    mcx15: { calls: 34, avgRs: 77 },
  },
  gas: {
    recent: { calls: 3374, perMonth: 56, winPct: 34, avgRs: -240, pf: 0.64, goalDays: 179, callDays: 1250, winMonths: "6 of 59" },
    last50: { calls: 125, avgRs: -425 },
    mcx15: { calls: 40, avgRs: -219 },
  },
};
