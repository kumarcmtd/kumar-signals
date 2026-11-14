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
