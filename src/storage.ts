// KV-backed portfolio trades and synced trade logs.

import { ALL_SYMBOLS, type Env, r2, type Symbol } from "./env";

export interface PortfolioTrade {
  id: string;
  symbol: Symbol;
  optSide?: "CE" | "PE";
  strike?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number; // number of lots
  lotSize: number;
  stopLoss?: number;
  target?: number;
  entryDate: string;
  exitDate?: string;
  status: "OPEN" | "CLOSED";
  pnl?: number;
  notes?: string;
  mistakes?: string;
  lessons?: string;
  emotion?: string;
  source?: "manual" | "master-ai" | "signal";
}

const PORTFOLIO_KV_KEY = "portfolio_trades";

export async function getPortfolioTrades(env: Env): Promise<PortfolioTrade[]> {
  const raw = await env.COMMODITY_KV.get(PORTFOLIO_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePortfolioTrades(env: Env, trades: PortfolioTrade[]): Promise<void> {
  await env.COMMODITY_KV.put(PORTFOLIO_KV_KEY, JSON.stringify(trades));
}

function computePnl(trade: PortfolioTrade): number | undefined {
  if (trade.exitPrice === undefined) return undefined;
  return r2((trade.exitPrice - trade.entryPrice) * trade.quantity * trade.lotSize);
}

export async function createPortfolioTrade(env: Env, body: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  if (!body.symbol || !ALL_SYMBOLS.includes(body.symbol as Symbol)) throw new Error("symbol is required");
  if (typeof body.entryPrice !== "number") throw new Error("entryPrice is required");
  if (typeof body.quantity !== "number" || body.quantity <= 0) throw new Error("quantity is required");
  if (typeof body.lotSize !== "number" || body.lotSize <= 0) throw new Error("lotSize is required");

  // Logging a trade that's already closed (e.g. importing real broker
  // history) needs entry AND exit set in the same call -- the existing
  // OPEN-then-PATCH-to-close flow always stamps exitDate as "now", which is
  // wrong for a trade that actually closed days ago.
  const hasExit = typeof body.exitPrice === "number";

  const trade: PortfolioTrade = {
    id: crypto.randomUUID(),
    symbol: body.symbol as Symbol,
    optSide: body.optSide,
    strike: body.strike,
    entryPrice: body.entryPrice,
    quantity: body.quantity,
    lotSize: body.lotSize,
    stopLoss: body.stopLoss,
    target: body.target,
    entryDate: body.entryDate ?? new Date().toISOString(),
    status: hasExit ? "CLOSED" : "OPEN",
    notes: body.notes,
    mistakes: body.mistakes,
    lessons: body.lessons,
    emotion: body.emotion,
    source: body.source ?? "manual",
  };
  if (hasExit) {
    trade.exitPrice = body.exitPrice;
    trade.exitDate = body.exitDate ?? new Date().toISOString();
    trade.pnl = computePnl(trade);
  }

  const trades = await getPortfolioTrades(env);
  trades.unshift(trade);
  await savePortfolioTrades(env, trades);
  return trade;
}

export async function updatePortfolioTrade(env: Env, id: string, patch: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  const trades = await getPortfolioTrades(env);
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error("Trade not found");

  const updated: PortfolioTrade = { ...trades[idx], ...patch, id: trades[idx].id };
  if (patch.exitPrice !== undefined && !patch.status) updated.status = "CLOSED";
  if (updated.status === "CLOSED") {
    updated.exitDate = updated.exitDate ?? new Date().toISOString();
    updated.pnl = computePnl(updated);
  }
  trades[idx] = updated;
  await savePortfolioTrades(env, trades);
  return updated;
}

export async function deletePortfolioTrade(env: Env, id: string): Promise<void> {
  const trades = await getPortfolioTrades(env);
  const next = trades.filter((t) => t.id !== id);
  await savePortfolioTrades(env, next);
}

// Every page's own signal/call history (Best Call, AI-Risk, AI-Test V2/Pro,
// Kumar AI, Elite, Kimi, Directional Gate) previously lived only in each
// browser's own localStorage -- opening the app on a different browser or
// device showed nothing, since it was never sent anywhere. This app has no
// login, so there's exactly one shared history (same as every other piece
// of data this Worker already serves) rather than a per-user one. The
// client is responsible for merging/debouncing before it pushes here -- this
// is a deliberately simple whole-blob get/put, no per-entry validation,
// matching the same trust level as the portfolio trades KV store above.
const TRADE_LOGS_KV_KEY = "trade_logs_v1";

export async function getTradeLogsFromKv(env: Env): Promise<Record<string, unknown>> {
  const raw = await env.COMMODITY_KV.get(TRADE_LOGS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveTradeLogsToKv(env: Env, logs: Record<string, unknown>): Promise<void> {
  await env.COMMODITY_KV.put(TRADE_LOGS_KV_KEY, JSON.stringify(logs));
}
