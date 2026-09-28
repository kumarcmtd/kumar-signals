// Capital Guard -- the maths of staying in the game.
//
// Signals decide WHAT to buy. This decides HOW MUCH, and WHEN TO STOP, which
// is what actually decides whether a small account survives. Everything here
// is plain arithmetic on numbers the trader enters or the live option chain
// returns; none of it predicts price.

export type GuardSymbol = "CRUDEOIL" | "NATURALGAS";

/** MCX option lot sizes (units per lot). Check the contract spec if MCX changes them. */
export const LOT_SIZE: Record<GuardSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

/** Never put more than this share of capital into one position's premium. */
export const MAX_COST_PCT = 20;

// ---- Position size ------------------------------------------------------------

export interface SizeInput {
  capital: number;
  riskPct: number; // max loss per trade, % of capital
  premium: number; // entry premium per unit
  stopPremium: number; // exit if the premium falls to this
  lotSize: number;
}

export interface SizeResult {
  riskBudget: number; // ₹ you may lose on this trade
  riskPerLot: number; // ₹ lost per lot if the stop is hit
  costPerLot: number; // ₹ paid per lot
  lotsByRisk: number;
  lotsByCost: number;
  lots: number; // the smaller of the two
  riskPctOfOneLot: number; // what ONE lot risks, % of capital
  /** When not even one lot fits: the stop that WOULD fit one lot. */
  stopForOneLot: number | null;
  verdict: "ok" | "too-big" | "invalid";
  why: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function sizePosition(i: SizeInput): SizeResult {
  const riskBudget = (i.capital * i.riskPct) / 100;
  const perUnitRisk = i.premium - i.stopPremium;
  const costPerLot = i.premium * i.lotSize;
  const empty = { riskBudget, riskPerLot: 0, costPerLot, lotsByRisk: 0, lotsByCost: 0, lots: 0, riskPctOfOneLot: 0, stopForOneLot: null };
  if (!(i.capital > 0) || !(i.premium > 0) || !(perUnitRisk > 0) || !(i.lotSize > 0)) {
    return { ...empty, verdict: "invalid", why: "Enter a premium and a stop below it." };
  }
  const riskPerLot = perUnitRisk * i.lotSize;
  const lotsByRisk = Math.floor(riskBudget / riskPerLot);
  const lotsByCost = Math.floor(((i.capital * MAX_COST_PCT) / 100) / costPerLot);
  const lots = Math.max(0, Math.min(lotsByRisk, lotsByCost));
  const riskPctOfOneLot = (riskPerLot / i.capital) * 100;
  const stop1 = i.premium - riskBudget / i.lotSize;
  const stopForOneLot = lots === 0 && stop1 > 0 ? Math.round(stop1 * 100) / 100 : null;

  let why: string;
  if (lots > 0) {
    why = `${lots} lot${lots > 1 ? "s" : ""} risks ${inr(riskPerLot * lots)} if the stop is hit — within your ${inr(riskBudget)} limit.`;
  } else if (lotsByCost === 0) {
    why = `One lot costs ${inr(costPerLot)} — more than ${MAX_COST_PCT}% of your capital in a single option. Skip this one.`;
  } else {
    why = `One lot risks ${inr(riskPerLot)} (${riskPctOfOneLot.toFixed(1)}% of capital) — more than your ${inr(riskBudget)} limit. ${
      stopForOneLot !== null ? `Only a stop at ₹${stopForOneLot} would fit, which is usually too tight to survive normal swings. Skip it.` : "Skip it."
    }`;
  }
  return { riskBudget, riskPerLot, costPerLot, lotsByRisk, lotsByCost, lots, riskPctOfOneLot, stopForOneLot, verdict: lots > 0 ? "ok" : "too-big", why };
}

// ---- Open positions ------------------------------------------------------------

export interface GuardPosition {
  id: string;
  symbol: GuardSymbol;
  strike: number;
  side: "CE" | "PE";
  lots: number;
  avg: number;
  addedAt: number;
}

export interface PositionCheck {
  id: string;
  ltp: number | null;
  pnl: number | null; // ₹
  pnlPctOfCapital: number | null;
  premiumChangePct: number | null;
  exposure: number; // ₹ currently in the premium (at ltp, else avg)
  /** Premium at which this position's loss reaches the per-trade rule. */
  ruleStop: number;
  pastRuleStop: boolean;
  decayPerDay: number | null; // ₹ lost per day from time alone
  chart: "supports" | "against" | "unclear";
  flags: { tone: "bad" | "warn" | "ok"; text: string }[];
}

export interface LiveLeg {
  ltp: number | null;
  theta: number | null; // per unit per calendar day
}

export function checkPosition(
  p: GuardPosition,
  leg: LiveLeg | null,
  capital: number,
  riskPct: number,
  chartSide: "CE" | "PE" | null,
  siblings: GuardPosition[]
): PositionCheck {
  const lotSize = LOT_SIZE[p.symbol];
  const units = p.lots * lotSize;
  const ltp = leg?.ltp ?? null;
  const pnl = ltp !== null ? (ltp - p.avg) * units : null;
  const riskBudget = (capital * riskPct) / 100;
  const ruleStop = Math.max(0.05, Math.round((p.avg - riskBudget / units) * 100) / 100);
  const pastRuleStop = ltp !== null && ltp <= ruleStop;
  const decayPerDay = leg?.theta != null ? Math.abs(leg.theta) * units : null;
  const chart = chartSide === null ? "unclear" : chartSide === p.side ? "supports" : "against";

  const flags: PositionCheck["flags"] = [];
  if (pastRuleStop) flags.push({ tone: "bad", text: `Past your rule stop (₹${ruleStop}). The loss is already bigger than one trade should cost. The rule says exit; a recovery is not guaranteed.` });
  if (pnl !== null && capital > 0 && -pnl / capital >= 0.1) flags.push({ tone: "bad", text: `This one position has lost ${((-pnl / capital) * 100).toFixed(0)}% of your capital.` });
  const sameSide = siblings.filter((s) => s.id !== p.id && s.symbol === p.symbol && s.side === p.side);
  if (sameSide.length) {
    const cheaper = sameSide.some((s) => s.avg < p.avg);
    flags.push({
      tone: "warn",
      text: cheaper
        ? `You also hold ${sameSide.map((s) => `${s.strike} ${s.side}`).join(", ")} bought cheaper — that looks like averaging down: adding to a losing idea makes one wrong view cost double.`
        : `Also holding ${sameSide.map((s) => `${s.strike} ${s.side}`).join(", ")} on the same side — all of it rides on one view.`,
    });
  }
  if (chart === "against") flags.push({ tone: "warn", text: `The chart read (AI Verify Pro) leans ${chartSide} — against this ${p.side}.` });
  if (decayPerDay !== null && decayPerDay > 0) flags.push({ tone: "warn", text: `Time decay costs about ₹${Math.round(decayPerDay).toLocaleString("en-IN")} a day even if price doesn't move.` });
  if (!flags.length) flags.push({ tone: "ok", text: "Within your rules." });

  return {
    id: p.id,
    ltp,
    pnl,
    pnlPctOfCapital: pnl !== null && capital > 0 ? (pnl / capital) * 100 : null,
    premiumChangePct: ltp !== null ? ((ltp - p.avg) / p.avg) * 100 : null,
    exposure: (ltp ?? p.avg) * units,
    ruleStop,
    pastRuleStop,
    decayPerDay,
    chart,
    flags,
  };
}

// ---- Daily loss limit -----------------------------------------------------------

export interface DayStatus {
  limit: number; // ₹
  used: number; // ₹ lost today (>= 0)
  usedPct: number; // of the limit
  state: "ok" | "careful" | "stop";
}

export function dayStatus(capital: number, dailyLossPct: number, todaysPnl: number): DayStatus {
  const limit = (capital * dailyLossPct) / 100;
  const used = Math.max(0, -todaysPnl);
  const usedPct = limit > 0 ? (used / limit) * 100 : 0;
  return { limit, used, usedPct, state: usedPct >= 100 ? "stop" : usedPct >= 60 ? "careful" : "ok" };
}

// ---- Journal review -------------------------------------------------------------

export interface ReviewTrade {
  entryDate: string;
  exitDate?: string;
  pnl?: number;
  status: "OPEN" | "CLOSED";
}

export interface Review {
  closed: number;
  wins: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null; // avg win / avg loss
  total: number;
  biggestLoss: number | null;
  overnight: { count: number; pnl: number };
  sameDay: { count: number; pnl: number };
  lessons: string[];
}

const istDate = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);

export function reviewTrades(trades: ReviewTrade[], capital: number): Review {
  const closed = trades.filter((t) => t.status === "CLOSED" && typeof t.pnl === "number" && t.exitDate);
  const wins = closed.filter((t) => t.pnl! > 0);
  const losses = closed.filter((t) => t.pnl! < 0);
  const sum = (xs: ReviewTrade[]) => xs.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const avgWin = wins.length ? sum(wins) / wins.length : null;
  const avgLoss = losses.length ? Math.abs(sum(losses) / losses.length) : null;
  const over = closed.filter((t) => istDate(t.entryDate) !== istDate(t.exitDate!));
  const same = closed.filter((t) => istDate(t.entryDate) === istDate(t.exitDate!));
  const biggestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl!)) : null;

  const lessons: string[] = [];
  if (avgWin !== null && avgLoss !== null && avgLoss > avgWin) lessons.push(`Your average loss (₹${Math.round(avgLoss).toLocaleString("en-IN")}) is bigger than your average win (₹${Math.round(avgWin).toLocaleString("en-IN")}). Cutting losers earlier fixes this more than finding better calls.`);
  if (over.length >= 2 && sum(over) < 0 && sum(over) < sum(same)) lessons.push(`Trades held overnight lost ₹${Math.round(-sum(over)).toLocaleString("en-IN")} in total — worse than same-day trades. Overnight gaps and time decay are working against you.`);
  if (biggestLoss !== null && capital > 0 && -biggestLoss / capital > 0.05) lessons.push(`Your biggest single loss was ${((-biggestLoss / capital) * 100).toFixed(0)}% of capital. With a 2% rule it could not have been more than 2%.`);
  if (!lessons.length && closed.length >= 5) lessons.push("No big leak found in the logged trades. Keep following the sizing rule.");

  return {
    closed: closed.length,
    wins: wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss ? avgWin / avgLoss : null,
    total: sum(closed),
    biggestLoss,
    overnight: { count: over.length, pnl: sum(over) },
    sameDay: { count: same.length, pnl: sum(same) },
    lessons,
  };
}
