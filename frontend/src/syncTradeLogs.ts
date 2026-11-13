import { create } from "zustand";
import { useAppStore, type TradeLogEntry } from "./store/appStore";
import { api } from "./api/client";
// The merge lives in the pure tradeLogCore so the browser and the Cloudflare
// Worker's Cron merge trade logs by the exact same "closed version always
// wins" rule -- that shared rule is what lets the Cron close a trade
// server-side and have that close survive a browser later pushing its own
// still-open copy of the same id.
import { isMinorListChange, mergeTradeLogs, MINOR_PROGRESS_SAVE_MS, sweepStaleRunning } from "./utils/tradeLogCore";

/**
 * Whether this phone's call record is actually syncing with the server. Sync
 * used to fail silently -- e.g. the server asks for the app key and this
 * phone has none -- and then the server's day-end closes, and the calls it
 * records with the app shut, never reached the phone. Pages show a warning.
 */
export interface SyncStatus {
  pull: "ok" | "failed" | null;
  push: "ok" | "failed" | null;
  error: string | null;
  at: number | null;
}
export const useSyncStatus = create<SyncStatus>(() => ({ pull: null, push: null, error: null, at: null }));

/** How often the phone checks for calls left "running" from an earlier session. */
const SWEEP_EVERY_MS = 15 * 60_000;

// This app has no login, so trade/signal history has exactly one shared
// home on the server (same trust level as every other endpoint here) rather
// than a per-user one -- opening the app from a different browser or device
// previously showed nothing at all, since Zustand's persist middleware only
// ever wrote to that one browser's own localStorage.
const PUSH_DEBOUNCE_MS = 8000;

// Only the keys whose history changed since the last successful push are
// sent. Sending the whole dictionary (over 1 MB) on every change made the
// Worker parse, merge and rewrite all of it each time -- more CPU than the
// free plan allows per request. The Worker merges whatever subset arrives.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushed = new Map<string, string>();
// The lists as last pushed, to tell a new high (minor) from a real change.
let lastPushedList = new Map<string, TradeLogEntry[]>();
let lastPushAt = 0;
let minorTimer: ReturnType<typeof setTimeout> | null = null;
// The store replaces only the arrays that change, so an array seen before
// needs no re-stringify to know it is unchanged.
const checkedRefs = new WeakMap<TradeLogEntry[], string>();

function changedKeys(logs: Record<string, TradeLogEntry[]>): Record<string, TradeLogEntry[]> {
  const out: Record<string, TradeLogEntry[]> = {};
  for (const [key, list] of Object.entries(logs)) {
    let json = checkedRefs.get(list);
    if (json === undefined) {
      json = JSON.stringify(list);
      checkedRefs.set(list, json);
    }
    if (lastPushed.get(key) !== json) out[key] = list;
  }
  return out;
}

// Each push is a KV write on the Worker, and the free plan allows 1,000 a
// day. A rising trade sets a new high on nearly every poll, and pushing each
// one (8 s after it, from every open page) is what used the limit up. So a
// push made ONLY of new highs waits until MINOR_PROGRESS_SAVE_MS after the
// last push; any real change -- a new trade, a target hit, a close -- still
// goes up within seconds, carrying the pending highs with it.
function pushChanged(logs: Record<string, TradeLogEntry[]>): void {
  const diff = changedKeys(logs);
  const keys = Object.keys(diff);
  if (keys.length === 0) return; // nothing actually changed
  const onlyMinor = keys.every((k) => isMinorListChange(lastPushedList.get(k), diff[k]));
  const wait = lastPushAt + MINOR_PROGRESS_SAVE_MS - Date.now();
  if (onlyMinor && wait > 0) {
    if (!minorTimer) {
      minorTimer = setTimeout(() => {
        minorTimer = null;
        lastPushAt = 0; // due now
        pushChanged(useAppStore.getState().tradeLogs);
      }, wait);
    }
    return;
  }
  if (minorTimer) {
    clearTimeout(minorTimer);
    minorTimer = null;
  }
  api.saveTradeLogs(diff).then(
    () => {
      useSyncStatus.setState({ push: "ok", at: Date.now(), ...(useSyncStatus.getState().pull !== "failed" ? { error: null } : {}) });
      lastPushAt = Date.now();
      for (const [key, list] of Object.entries(diff)) {
        lastPushed.set(key, JSON.stringify(list));
        lastPushedList.set(key, list);
      }
    },
    (e: unknown) => {
      // Best-effort: a network hiccup here must never break the rest of the
      // app. The keys stay "changed", so the next push retries them.
      useSyncStatus.setState({ push: "failed", error: e instanceof Error ? e.message : "could not save to the server", at: Date.now() });
    }
  );
}

function schedulePush(logs: Record<string, TradeLogEntry[]>) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushChanged(logs), PUSH_DEBOUNCE_MS);
}

function remember(logs: Record<string, TradeLogEntry[]>): Map<string, string> {
  return new Map(Object.entries(logs).map(([k, v]) => [k, JSON.stringify(v)] as const));
}

// One-time bootstrap, called once from main.tsx: pulls whatever's already on
// the server, merges it with this browser's own local history, writes the
// merged result back into the store, seeds the server immediately if the
// merge produced anything new, then watches for further local changes and
// pushes them up (debounced, so 15-20s polling across a dozen pages doesn't
// hammer the server on every tick). Entirely best-effort -- this app worked
// fine as browser-local-only before this existed, so any failure here just
// falls back to that, never a crash.
export async function initTradeLogSync(): Promise<void> {
  let server: Record<string, TradeLogEntry[]> = {};
  try {
    server = await api.getTradeLogs();
    useSyncStatus.setState({ pull: "ok", at: Date.now() });
  } catch (e) {
    // Offline, or the server refused -- proceed with local-only history, and say so.
    useSyncStatus.setState({ pull: "failed", error: e instanceof Error ? e.message : "could not reach the server", at: Date.now() });
  }

  const local = useAppStore.getState().tradeLogs;
  // Any call still "running" from an earlier session is closed at that
  // session's bell -- whether or not the server ever saw it.
  const merged = sweepStaleRunning(mergeTradeLogs(local, server), Date.now()).logs;
  useAppStore.getState().hydrateTradeLogs(merged);

  // What the server already holds counts as pushed; only what the merge
  // added on this device goes up.
  lastPushed = remember(server);
  lastPushedList = new Map(Object.entries(server));
  pushChanged(merged);

  useAppStore.subscribe((state, prevState) => {
    if (state.tradeLogs !== prevState.tradeLogs) schedulePush(state.tradeLogs);
  });

  // An app left open overnight: the same sweep, now and then.
  setInterval(() => {
    const { logs, closedKeys } = sweepStaleRunning(useAppStore.getState().tradeLogs, Date.now());
    const set = useAppStore.getState().setTradeLog;
    for (const k of closedKeys) set(k, logs[k]);
  }, SWEEP_EVERY_MS);
}
