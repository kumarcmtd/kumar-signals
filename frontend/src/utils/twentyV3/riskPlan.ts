// Ai20-20 v3 money rules -- the part a trade manager decides BEFORE any call.
//
// The common professional rules, as found in trading-risk guides: risk about
// 1% of the account on one trade (0.5-1% while learning), stop for the day
// at about 3% lost (roughly three full losses), and do not keep trading after
// the limit -- no exceptions. Ten losses in a row at 1% cost about 10% of the
// account, which is survivable; at 5% a trade it is half the account.
//
// Pure functions; the settings live on the phone (see useMyPlan).

import type { TradeLogEntry } from "../tradeLogCore";
import { exitPriceFor } from "../tradeLogPnl";

export interface MyPlan {
  capitalRs: number;
  /** % of capital one trade may lose at its stop. */
  riskPct: number;
  /** % of capital lost in a day that ends trading for the day. */
  dayLossPct: number;
  maxTradesPerDay: number;
  /** Never more lots than this, whatever the maths says. */
  maxLots: number;
}

export const DEFAULT_PLAN: MyPlan = { capitalRs: 100_000, riskPct: 1, dayLossPct: 3, maxTradesPerDay: 3, maxLots: 2 };

/** No more than this share of capital in option premium at once. */
export const MAX_PREMIUM_SHARE = 0.5;

const clampNum = (x: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function sanitizePlan(x: Partial<MyPlan> | null | undefined): MyPlan {
  const d = DEFAULT_PLAN;
  return {
    capitalRs: Math.round(clampNum(x?.capitalRs, 10_000, 1_00_00_000, d.capitalRs)),
    riskPct: Math.round(clampNum(x?.riskPct, 0.25, 3, d.riskPct) * 4) / 4,
    dayLossPct: Math.round(clampNum(x?.dayLossPct, 1, 10, d.dayLossPct) * 2) / 2,
    maxTradesPerDay: Math.round(clampNum(x?.maxTradesPerDay, 1, 5, d.maxTradesPerDay)),
    maxLots: Math.round(clampNum(x?.maxLots, 1, 20, d.maxLots)),
  };
}

export const perTradeRs = (p: MyPlan) => Math.round((p.capitalRs * p.riskPct) / 100);
export const dayLimitRs = (p: MyPlan) => Math.round((p.capitalRs * p.dayLossPct) / 100);

export interface LotAdvice {
  lots: number;
  /** Rupees lost at the stop with that many lots. */
  riskRs: number;
  premiumRs: number;
  /** Why the number is what it is, in one line. */
  why: string;
}

/**
 * How many lots this call allows. riskPerLotRs: loss per lot at the stop;
 * premiumPerLotRs: cost of one lot. 0 lots means the stop is wider than the
 * plan allows -- the call is shown, marked "too big for your plan".
 */
export function lotsFor(plan: MyPlan, riskPerLotRs: number, premiumPerLotRs: number): LotAdvice {
  const budget = perTradeRs(plan);
  const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  if (!(riskPerLotRs > 0)) return { lots: 0, riskRs: 0, premiumRs: 0, why: "No stop distance yet." };
  const byRisk = Math.floor(budget / riskPerLotRs);
  const byCash = premiumPerLotRs > 0 ? Math.floor((plan.capitalRs * MAX_PREMIUM_SHARE) / premiumPerLotRs) : byRisk;
  const lots = Math.max(0, Math.min(byRisk, byCash, plan.maxLots));
  if (lots === 0) {
    return { lots: 0, riskRs: 0, premiumRs: 0, why: byRisk === 0 ? `One lot risks ${rs(riskPerLotRs)} at the stop — more than your ${rs(budget)} per-trade limit. Skip, or raise your risk % knowingly.` : `One lot costs ${rs(premiumPerLotRs)} — more than half your capital.` };
  }
  const limiter = lots === plan.maxLots && byRisk > lots && byCash > lots ? "your max-lots setting" : byCash < byRisk ? "keeping premium under half your capital" : `your ${rs(budget)} per-trade risk`;
  return { lots, riskRs: Math.round(lots * riskPerLotRs), premiumRs: Math.round(lots * premiumPerLotRs), why: `${lots} lot${lots > 1 ? "s" : ""} — set by ${limiter}.` };
}

const IST_MS = 5.5 * 3600_000;
const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);

export interface DayBudget {
  tradesToday: number;
  stopsToday: number;
  /** Booked profit/loss today in rupees for `lots` lots (negative = loss). */
  bookedRs: number;
  limitRs: number;
  tradesLeft: number;
  /** Why no new trade today, or null. */
  stopped: string | null;
}

/** Today's calls against the plan: booked P&L, trades used, and whether the day is over. */
export function dayBudget(plan: MyPlan, log: TradeLogEntry[], lotSize: number, lots: number, now: number): DayBudget {
  const today = log.filter((e) => istDay(e.openedAt) === istDay(now));
  const closed = today.filter((e) => e.closed);
  const bookedRs = Math.round(closed.reduce((a, e) => a + (exitPriceFor(e) - e.entry) * lotSize * Math.max(1, lots), 0));
  const stopsToday = today.filter((e) => e.status === "sl_hit").length;
  const limitRs = dayLimitRs(plan);
  const tradesLeft = Math.max(0, plan.maxTradesPerDay - today.length);
  const rs = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
  const stopped =
    bookedRs <= -limitRs
      ? `Day's loss limit reached (−${rs(bookedRs)} of ${rs(limitRs)}). No more trades today — this rule protects your capital.`
      : tradesLeft === 0
        ? `${today.length} trades today — your daily maximum. Done for today.`
        : null;
  return { tradesToday: today.length, stopsToday, bookedRs, limitRs, tradesLeft, stopped };
}
