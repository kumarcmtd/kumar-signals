// Ai20-20 v3 phone alerts: the exact order when a call comes, then one alert
// per step of the trade (T1 -> move the stop, T2, stop hit, target 3, closed
// at the bell), and a short summary when the day's window ends.

import type { TradeLogEntry } from "../tradeLogCore";
import { exitPriceFor } from "../tradeLogPnl";
import { DEFAULT_PLAN, lotsFor, perTradeRs } from "./riskPlan";
import { SETUP_NAMES, type V3SetupId } from "./setups";
import type { V3Ticket } from "./ticket";

const inr = (n: number) => `Rs ${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${inr(n)}`;

export function v3CallPushText(p: { displayName: string; t: V3Ticket; setup: V3SetupId; regime: string | null; record: { trades: number; avgRs: number | null } | null }): { title: string; body: string } {
  const { t } = p;
  const lots = lotsFor(DEFAULT_PLAN, t.riskPerLot, t.premiumPerLot);
  const lines = [
    `BUY ${p.displayName} ${t.strike} ${t.side} @ Rs ${t.entry} (don't pay above Rs ${t.maxPay}) · 1 lot = ${t.lotSize}`,
    `Stop Rs ${t.stop} (${signed(-t.riskPerLot)}/lot) | T1 Rs ${t.targets[0]} (${signed(t.targetRsPerLot[0])}/lot) | T2 Rs ${t.targets[1]} | T3 Rs ${t.targets[2]}`,
    `Size: ${lots.lots > 0 ? `${lots.lots} lot${lots.lots > 1 ? "s" : ""}` : "skip (stop too wide)"} for a Rs 1,00,000 account risking 1% (${inr(perTradeRs(DEFAULT_PLAN))}) — the app uses your own plan.`,
    `Setup: ${SETUP_NAMES[p.setup]}. ${t.strikeWhy}`,
    p.regime ? `Market: ${p.regime}.` : "",
    p.record && p.record.trades > 0 && p.record.avgRs !== null ? `Live setups on recent MCX candles: ${p.record.trades} test calls, average ${signed(p.record.avgRs)}/lot (a test, not live fills).` : "",
    "At T1 move the stop to your entry. Sell before MCX close — never overnight.",
  ];
  return { title: `⚡ Ai20-20 v3: ${p.displayName} ${t.strike} ${t.side} @ Rs ${t.entry}`, body: lines.filter(Boolean).join("\n") };
}

export type V3Step = "t1" | "t2" | "closed";

/** Steps of a call that deserve an alert and have happened. */
export function stepsOf(e: TradeLogEntry): V3Step[] {
  const out: V3Step[] = [];
  if (e.targetsHit[0]) out.push("t1");
  if (e.targetsHit[1]) out.push("t2");
  if (e.closed) out.push("closed");
  return out;
}

export function v3StepPushText(displayName: string, e: TradeLogEntry, step: V3Step, lotSize: number): { title: string; body: string; priority: "urgent" | "high" } {
  const name = `${displayName} ${e.strike} ${e.optSide}`;
  if (step === "t1") return { title: `✅ T1 hit: ${name}`, body: `Premium reached T1 Rs ${e.targets[0]} (${signed((e.targets[0] - e.entry) * lotSize)}/lot).\nMOVE YOUR STOP UP TO YOUR ENTRY Rs ${e.entry} — no loss possible from here.\nNext: T2 Rs ${e.targets[1]}.`, priority: "urgent" };
  if (step === "t2") return { title: `✅ T2 hit: ${name}`, body: `Premium reached T2 Rs ${e.targets[1]}.\nMove your stop to T1 Rs ${e.targets[0]} — profit locked. Last target T3 Rs ${e.targets[2]}.`, priority: "urgent" };
  const exit = exitPriceFor(e);
  const pnl = (exit - e.entry) * lotSize;
  const what =
    e.status === "sl_hit"
      ? `STOP HIT — sell now if you still hold it. Exit near Rs ${exit}.`
      : e.status === "stopped_breakeven"
        ? `Back to your entry after T1 — out at about breakeven.`
        : e.status === "stopped_after_t1"
          ? `Fell back to T1 after T2 — out with profit locked.`
          : e.status === "target3_hit"
            ? `TARGET 3 reached — sell everything.`
            : `Closed at the bell (Rs ${exit}). Sell if you still hold it — never carry it overnight.`;
  return { title: `${pnl >= 0 ? "🟢" : "🔴"} Ai20-20 call closed: ${name} ${signed(pnl)}/lot`, body: `${what}\nResult: ${signed(pnl)} per lot (entry Rs ${e.entry}, exit Rs ${exit}).`, priority: e.status === "sl_hit" ? "urgent" : "high" };
}

export function v3DaySummaryText(displayName: string, today: TradeLogEntry[], lotSize: number): { title: string; body: string } {
  const closed = today.filter((e) => e.closed);
  const net = closed.reduce((a, e) => a + (exitPriceFor(e) - e.entry) * lotSize, 0);
  const wins = closed.filter((e) => exitPriceFor(e) > e.entry).length;
  if (!today.length) return { title: `Ai20-20 ${displayName}: no call today`, body: "No setup fired inside today's window — no trade is a good trade when nothing qualifies. Same time tomorrow." };
  return {
    title: `Ai20-20 ${displayName} today: ${signed(net)}/lot`,
    body: `${today.length} call${today.length > 1 ? "s" : ""}, ${wins} winner${wins === 1 ? "" : "s"}, net ${signed(net)} per lot.\n${closed.map((e) => `${e.strike} ${e.optSide}: ${signed((exitPriceFor(e) - e.entry) * lotSize)}`).join(" · ")}\nStick to the plan: same rules tomorrow, same size.`,
  };
}
