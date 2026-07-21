import type { PortfolioTrade } from "../types";

export function computePortfolioSummary(trades: PortfolioTrade[]) {
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status === "CLOSED" && t.pnl !== undefined);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null;
  const avgWin = wins.length ? grossWin / wins.length : null;
  const avgLoss = losses.length ? -grossLoss / losses.length : null;
  const best = closed.reduce((b, t) => (b === null || (t.pnl ?? 0) > b ? t.pnl ?? 0 : b), null as number | null);
  const worst = closed.reduce((w, t) => (w === null || (t.pnl ?? 0) < w ? t.pnl ?? 0 : w), null as number | null);

  const todayStr = new Date().toDateString();
  const todayPnl = closed
    .filter((t) => t.exitDate && new Date(t.exitDate).toDateString() === todayStr)
    .reduce((s, t) => s + (t.pnl ?? 0), 0);

  return { openCount: open.length, closedCount: closed.length, totalPnl, winRate, profitFactor, avgWin, avgLoss, best, worst, todayPnl };
}
