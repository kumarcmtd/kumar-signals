// What the v3 rules lab measured (scripts/twenty-lab-v3.ts on GitHub Actions,
// 14 Nov 2026). Rupees per lot after costs (Rs 150 crude / Rs 200 gas a call +
// ~Rs 50 an hour of time decay), option at delta 0.5, 5-minute candles in MCX
// hours, each year's approximate USDINR. A test on past prices, not a promise.
//
// Crude was tested twice: 2022-2026 (where every rule was chosen) and
// 2017-2021, five older years no rule was ever chosen on (the holdout).

import type { V3SetupId } from "./setups";

export interface PeriodFact {
  trades: number;
  winPct: number;
  avgRs: number;
  pf: number;
}

export interface SetupFact {
  /** 2022-2026. */
  recent: PeriodFact;
  /** 2017-2021, never used to choose anything. */
  holdout?: PeriodFact;
}

const f = (trades: number, winPct: number, avgRs: number, pf: number): PeriodFact => ({ trades, winPct, avgRs, pf });

export const V3_LAB = {
  ranAt: "14 Nov 2026",
  crude: {
    trend: { recent: f(1071, 41, -9, 0.99), holdout: f(1098, 36, -131, 0.77) },
    noise: { recent: f(1080, 25, -163, 0.81), holdout: f(1041, 23, -126, 0.75) },
    noise30: { recent: f(872, 32, -230, 0.8), holdout: f(858, 30, -95, 0.85) },
    orb: { recent: f(1188, 30, -183, 0.85), holdout: f(1211, 29, -169, 0.74) },
    orbTrend: { recent: f(598, 28, -246, 0.8), holdout: f(592, 28, -199, 0.71) },
    drive: { recent: f(266, 30, 174, 1.13), holdout: f(300, 31, 13, 1.02) },
    drive60: { recent: f(293, 30, -283, 0.81), holdout: f(287, 36, 62, 1.08) },
    vwapPull: { recent: f(634, 33, -164, 0.84), holdout: f(665, 33, -137, 0.76) },
    eia: { recent: f(96, 32, -29, 0.98), holdout: f(142, 32, -256, 0.66) },
    eiaFade: { recent: f(65, 34, -97, 0.92), holdout: f(119, 31, -208, 0.72) },
    driveTrend: { recent: f(159, 28, 80, 1.05), holdout: f(186, 30, 10, 1.01) },
    driveBusy: { recent: f(71, 39, 1204, 1.82), holdout: f(84, 26, -225, 0.75) },
    driveSteps: { recent: f(266, 26, 28, 1.02), holdout: f(300, 31, -116, 0.82) },
    driveStrict: { recent: f(214, 34, 441, 1.32), holdout: f(235, 30, -10, 0.99) },
  } as Partial<Record<V3SetupId, SetupFact>>,
  /** Gas, 2022-2026 (no holdout needed: nothing came close). */
  gas: {
    trend: { recent: f(1115, 37, -244, 0.78) },
    noise: { recent: f(1059, 24, -191, 0.78) },
    noise30: { recent: f(840, 33, -197, 0.83) },
    orb: { recent: f(1147, 30, -258, 0.8) },
    orbTrend: { recent: f(573, 31, -284, 0.78) },
    drive: { recent: f(294, 36, -34, 0.98) },
    drive60: { recent: f(302, 41, 4, 1) },
    vwapPull: { recent: f(653, 31, -369, 0.67) },
    eia: { recent: f(52, 29, -937, 0.39) },
    eiaFade: { recent: f(19, 58, 1648, 2.87) },
  } as Partial<Record<V3SetupId, SetupFact>>,
  /** The v2 rules (the calls before v3) over all ten years of crude. */
  v2TenYears: { calls: 2169, netRs: -154015, avgRs: -71, y2025Rs: -86491, y2026Rs: 106000, last50DaysAvgRs: 1498 },
  /** The practice setup over all ten years. */
  bigDriveTenYears: { calls: 449, netRs: 92045, avgRs: 205, recentAvgRs: 441, holdoutAvgRs: -10, winningMonths: "26 of 56" },
};

/**
 * Ai20-20 all day -- the v2 rule (fresh 5-minute strength turn + 1-hour trend)
 * on every MCX hour, 9:00 AM IST to 30 minutes before the bell. Same lab,
 * 16 Nov 2026. It lost money in every one of the ten years.
 */
export const DAY_LAB = {
  ranAt: "16 Nov 2026",
  crude: { trendDay: { recent: f(4952, 29, -193, 0.81), holdout: f(5082, 28, -194, 0.65) } } as Record<"trendDay", SetupFact>,
  gas: { trendDay: { recent: f(4867, 29, -232, 0.76) } } as Partial<Record<V3SetupId, SetupFact>>,
  /** Crude, Rs a call, each year. */
  byYear: [
    ["2017", -207],
    ["2018", -172],
    ["2019", -239],
    ["2020", -159],
    ["2021", -192],
    ["2022", -210],
    ["2023", -122],
    ["2024", -200],
    ["2025", -268],
    ["2026", -156],
  ] as [string, number][],
  /** As the line runs (one call at a time, at most 2 stops / 3 calls / -Rs 3,000 a day), crude. */
  line: { callsPerMonth: 52, recentAvgRs: -247, holdoutAvgRs: -215 },
  /** Both Ai20-20 lines added up, crude 2022-26: profitable months. */
  bothLines: { avgRs: -203, winningMonths: "12 of 59" },
  /** The all-day signal on the last 50 days of real NYMEX futures. */
  last50: { calls: 179, avgRs: -18 },
};

/** Ai-Super Fast (Speed 70+), same lab, 15 Nov 2026. */
export const FAST_LAB = {
  ranAt: "15 Nov 2026",
  crude: {
    fastTurnUS: { recent: f(880, 35, -65, 0.94), holdout: f(1069, 31, -201, 0.7) },
    fastTurnDay: { recent: f(1238, 34, 5, 1), holdout: f(1386, 28, -236, 0.65) },
    fastBreakUS: { recent: f(908, 33, -153, 0.87), holdout: f(992, 31, -148, 0.78) },
    fastBreakDay: { recent: f(1431, 33, -49, 0.96), holdout: f(1529, 30, -141, 0.78) },
    fastNoiseUS: { recent: f(753, 33, -209, 0.84), holdout: f(865, 34, -126, 0.82) },
  } as Partial<Record<V3SetupId, SetupFact>>,
  gas: {
    fastTurnUS: { recent: f(866, 36, -217, 0.83) },
    fastTurnDay: { recent: f(1654, 31, -173, 0.85) },
    fastBreakUS: { recent: f(817, 37, -112, 0.91) },
    fastBreakDay: { recent: f(1693, 31, -160, 0.86) },
    fastNoiseUS: { recent: f(701, 38, -108, 0.91) },
  } as Partial<Record<V3SetupId, SetupFact>>,
  /** How often the Speed gauge read 70+ (share of 5-minute candles), crude 2022-26. */
  speed70Share: 21,
  /** The live setup on the last 50 days of real NYMEX futures. */
  liveLast50: { calls: 16, avgRs: 510 },
  /** The live setup by year, crude 2022-26 (Rs a call). */
  liveByYear: [
    ["2022", -125],
    ["2023", 48],
    ["2024", -250],
    ["2025", -342],
    ["2026", 975],
  ] as [string, number][],
};

/**
 * Smart Ai20-20 lab (scripts/smart-lab.ts, 18 Nov 2026), crude. The live line:
 * the v2 trend calls + the trader's "care at the high" check (no call within
 * 1 ATR of the 3-hour high / low unless a candle closed through it) + the
 * season switch (rest while the last 10 trading days clearly lost). Chosen on
 * 2022-26, then checked on 2017-21.
 */
export const SMART_LAB = {
  ranAt: "18 Nov 2026",
  line: { recent: f(455, 46, 228, 1.24), holdout: f(306, 35, -124, 0.8) },
  lineByYear: [
    ["2017", -240],
    ["2018", -58],
    ["2019", -366],
    ["2020", -4],
    ["2021", -60],
    ["2022", 112],
    ["2023", 49],
    ["2024", 160],
    ["2025", -306],
    ["2026", 824],
  ] as [string, number][],
  /** Ten years together (both periods). */
  tenYears: { calls: 761, netRs: 65731, avgRs: 86 },
  /** The v2 calls always on, no checks: ten years. */
  v2Always: { calls: 2170, netRs: -156926, avgRs: -72 },
  /** The line's rule (before the season switch) on the last 50 days of real NYMEX futures, and the app's own MCX candles. */
  last50: { calls: 33, avgRs: 1008 },
  mcx15: { calls: 7, avgRs: 1457 },
  /** The trader's run-to-the-high idea as calls of its own: every version lost, both periods. */
  gapRun: { recent: f(6917, 29, -151, 0.8), holdout: f(7265, 27, -206, 0.53), versions: 48 },
  gapBreak: { recent: f(4238, 26, -137, 0.79), holdout: f(4465, 26, -155, 0.59), versions: 24 },
};
