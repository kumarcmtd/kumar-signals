// Cron: advances open trades against live premiums, closes them at the
// bell (EOD), sweeps orphans, and records a throttled heartbeat.

import { lastMcxClose, mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { advanceOpenEntry, closeRunningAtSessionEnd, runningBeforeClose, symbolOfTradeLogKey, TRADE_LOG_SYMBOLS, type TradeLogEntry } from "../frontend/src/utils/tradeLogCore";
import { cachePut, type Env, type Symbol } from "./env";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { loadOpenTrades, migrateTradeLogs, saveCronResult } from "./tradeLogStore";

// ---- Server-side trade-log advancement (Cron) ----
// The browser only advances/closes trades while a tab is open (see
// useTradeLog.ts). This runs the SAME pure advanceOpenEntry logic on the
// Cron schedule so a call's target/stop is detected -- and the trade closed
// at the real observed premium -- even with the app fully shut. It never
// OPENS a trade (that stays the browser's job, driven by each page's own
// engine); it only advances and closes the ones already open, so the two
// sides can never fight over what qualifies.
// An open trade this old whose strike no longer appears in a successfully
// fetched, strike-pinned option chain has an EXPIRED/delisted contract -- it
// can never resolve on live quotes again, so it would sit "running" forever.
// The age guard keeps a fresh intraday trade (whose strike might briefly fall
// outside the window on a transient fetch) from being swept.
const ORPHAN_SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const CRON_STATUS_KV_KEY = "cron:trade_log_last_run";
/** The heartbeat is refreshed at most this often when nothing changed. */
const HEARTBEAT_OPEN_INTERVAL_MS = 30 * 60 * 1000;
const HEARTBEAT_IDLE_INTERVAL_MS = 60 * 60 * 1000;

interface AdvanceCounts {
  opensChecked: number;
  advanced: number; // ticked or closed against a live premium
  swept: number; // orphaned (expired-contract) trades closed as manual/breakeven
  eodClosed: number; // still running at the bell, closed at the last premium
}

async function advanceOpenTradesForSymbol(
  env: Env,
  token: string,
  symbol: Symbol,
  logs: Record<string, TradeLogEntry[]>,
  now: number,
  counts: AdvanceCounts
): Promise<boolean> {
  // Gather every open strike for this symbol across all of its keys, so the
  // one chain fetch pins them all in and none freeze for being far from ATM.
  const openStrikes = new Set<number>();
  for (const [key, entries] of Object.entries(logs)) {
    if (symbolOfTradeLogKey(key) !== symbol) continue;
    const last = entries[entries.length - 1];
    if (last && !last.closed) openStrikes.add(last.strike);
  }
  if (openStrikes.size === 0) return false;

  const analytics = await computeOptionsAnalytics(env, token, symbol, Array.from(openStrikes));
  if ("error" in analytics) return false; // no live quotes -> never fabricate a close

  const ltpByStrikeSide = new Map<string, number>();
  const strikesInChain = new Set<number>();
  for (const row of analytics.rows) {
    strikesInChain.add(row.strike);
    if (row.call?.ltp != null) ltpByStrikeSide.set(`${row.strike}-CE`, row.call.ltp);
    if (row.put?.ltp != null) ltpByStrikeSide.set(`${row.strike}-PE`, row.put.ltp);
  }

  let changed = false;
  for (const [key, entries] of Object.entries(logs)) {
    if (symbolOfTradeLogKey(key) !== symbol) continue;
    const last = entries[entries.length - 1];
    if (!last || last.closed) continue;
    counts.opensChecked += 1;

    const ltp = ltpByStrikeSide.get(`${last.strike}-${last.optSide}`) ?? null;
    if (ltp !== null) {
      const advanced = advanceOpenEntry(last, ltp, now);
      if (advanced !== last) {
        logs[key] = [...entries.slice(0, -1), advanced];
        counts.advanced += 1;
        changed = true;
      }
      continue;
    }

    // No live quote for this strike. If the strike is genuinely absent from a
    // chain we DID fetch (so it's not a transient fetch miss) and the trade is
    // old enough that its contract has expired, close it honestly as manual:
    // status closed_manual, no exitPrice, so P&L books it at breakeven rather
    // than inventing an outcome we can't know.
    const expired = !strikesInChain.has(last.strike);
    const stale = now - last.openedAt >= ORPHAN_SWEEP_MIN_AGE_MS;
    if (expired && stale) {
      logs[key] = [...entries.slice(0, -1), { ...last, closed: true, closedAt: now, status: "closed_manual" }];
      counts.swept += 1;
      changed = true;
    }
  }
  return changed;
}

/**
 * Returns true when there were open trades to work on, so the TRADES trigger
 * knows whether this run still has CPU to spare for other work.
 */
export async function runTradeLogAdvanceCheck(env: Env): Promise<boolean> {
  const token = await env.COMMODITY_KV.get("access_token");
  const now = Date.now();
  const counts: AdvanceCounts = { opensChecked: 0, advanced: 0, swept: 0, eodClosed: 0 };

  // Heartbeat: always record that the Cron ran (and what it did), even when
  // nothing changed and even when there's no token, so "/api/cron-status" can
  // prove the schedule is actually firing.
  //
  // At most every 30 minutes during market hours and hourly outside them. It
  // was writing KV every five minutes around the clock -- 288 writes a day,
  // over a quarter of the free 1,000/day -- to prove nothing new; the news
  // refresh needs those writes now. Anything that actually changed (a trade
  // advanced or closed) still writes immediately.
  const marketOpen = mcxSessionAt(now).isOpen;
  const writeHeartbeat = async (note?: string) => {
    const changedSomething = counts.advanced + counts.swept + counts.eodClosed > 0;
    if (!changedSomething) {
      const interval = marketOpen ? HEARTBEAT_OPEN_INTERVAL_MS : HEARTBEAT_IDLE_INTERVAL_MS;
      const prev = await env.COMMODITY_KV.get(CRON_STATUS_KV_KEY).catch(() => null);
      try {
        const at = prev ? (JSON.parse(prev) as { at?: number }).at : undefined;
        if (typeof at === "number" && now - at < interval) return;
      } catch {
        // unreadable -- rewrite it
      }
    }
    await cachePut(env.COMMODITY_KV, CRON_STATUS_KV_KEY, JSON.stringify({ at: now, ...counts, note: note ?? "ok" }));
  };

  // One-time copy of the old single-value log into shards (src/tradeLogStore).
  // It is the whole of this run when it happens.
  if (await migrateTradeLogs(env)) {
    await writeHeartbeat("trade logs moved to per-key storage");
    return true;
  }

  if (!token) {
    await writeHeartbeat("no access token in KV");
    return false;
  }

  // Only the running trades are read -- a few hundred bytes, however long the
  // history grows. Nothing running -> nothing to advance or close at the bell.
  const { logs: open, stale } = await loadOpenTrades(env);
  if (Object.keys(open).length === 0) {
    if (stale.size) await saveCronResult(env, {}, {}, stale);
    await writeHeartbeat("no open trades");
    return false;
  }

  const result = await advanceLogs(env, token, { ...open }, marketOpen, now, counts);
  if (result.changed || stale.size) await saveCronResult(env, open, result.logs, stale);
  await writeHeartbeat();
  return true;
}

async function advanceLogs(
  env: Env,
  token: string,
  logs: Record<string, TradeLogEntry[]>,
  marketOpen: boolean,
  now: number,
  counts: AdvanceCounts
): Promise<{ logs: Record<string, TradeLogEntry[]>; changed: boolean }> {
  let anyChanged = false;
  if (!marketOpen) {
    // MCX is shut. The only job left is the end-of-day close, and it only
    // needs a quote fetch when something is actually still running from
    // before the last bell.
    const { closeAt } = lastMcxClose(now);
    for (const symbol of TRADE_LOG_SYMBOLS) {
      const running = runningBeforeClose(logs, symbol, closeAt);
      if (running.length === 0) continue;
      try {
        const analytics = await computeOptionsAnalytics(env, token, symbol as Symbol, running.map((r) => r.entry.strike));
        // A failed fetch closes nothing -- the next tick retries. Closing at
        // breakeven because Upstox blinked would invent an outcome.
        if ("error" in analytics) {
          // Same token, same limit: the other symbol would fail identically.
          if (analytics.rateLimited) break;
          continue;
        }
        const ltp = new Map<string, number>();
        for (const row of analytics.rows) {
          if (row.call?.ltp != null) ltp.set(`${row.strike}-CE`, row.call.ltp);
          if (row.put?.ltp != null) ltp.set(`${row.strike}-PE`, row.put.ltp);
        }
        const result = closeRunningAtSessionEnd(logs, symbol, closeAt, (strike, side) => ltp.get(`${strike}-${side}`) ?? null);
        if (result.closed > 0) {
          logs = result.logs;
          counts.eodClosed += result.closed;
          anyChanged = true;
        }
      } catch {
        // best-effort -- one symbol failing must not block the other
      }
    }
  } else {
    for (const symbol of TRADE_LOG_SYMBOLS) {
      try {
        const changed = await advanceOpenTradesForSymbol(env, token, symbol as Symbol, logs, now, counts);
        anyChanged = anyChanged || changed;
      } catch {
        // best-effort -- one symbol failing must not block the other
      }
    }
  }
  return { logs, changed: anyChanged };
}

export async function getCronStatus(env: Env): Promise<Record<string, unknown>> {
  const raw = await env.COMMODITY_KV.get(CRON_STATUS_KV_KEY);
  if (!raw) return { lastRunAt: null, note: "the trade-log Cron has not recorded a run yet" };
  try {
    const p = JSON.parse(raw) as { at?: number; opensChecked?: number; advanced?: number; swept?: number; eodClosed?: number; note?: string };
    return {
      lastRunAt: p.at ? new Date(p.at).toISOString() : null,
      ageSeconds: p.at ? Math.round((Date.now() - p.at) / 1000) : null,
      opensChecked: p.opensChecked ?? null,
      advanced: p.advanced ?? null,
      swept: p.swept ?? null,
      eodClosed: p.eodClosed ?? null,
      note: p.note ?? null,
    };
  } catch {
    return { lastRunAt: null, note: "unreadable cron status" };
  }
}
