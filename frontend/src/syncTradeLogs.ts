import { useAppStore, type TradeLogEntry } from "./store/appStore";
import { api } from "./api/client";
// The merge lives in the pure tradeLogCore so the browser and the Cloudflare
// Worker's Cron merge trade logs by the exact same "closed version always
// wins" rule -- that shared rule is what lets the Cron close a trade
// server-side and have that close survive a browser later pushing its own
// still-open copy of the same id.
import { mergeTradeLogs } from "./utils/tradeLogCore";

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

function pushChanged(logs: Record<string, TradeLogEntry[]>): void {
  const diff = changedKeys(logs);
  if (Object.keys(diff).length === 0) return; // nothing actually changed
  api.saveTradeLogs(diff).then(
    () => {
      for (const [key, list] of Object.entries(diff)) lastPushed.set(key, JSON.stringify(list));
    },
    () => {
      // Best-effort: a network hiccup here must never break the rest of the
      // app. The keys stay "changed", so the next push retries them.
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
  } catch {
    // Offline or the API is unreachable -- proceed with local-only history.
  }

  const local = useAppStore.getState().tradeLogs;
  const merged = mergeTradeLogs(local, server);
  useAppStore.getState().hydrateTradeLogs(merged);

  // What the server already holds counts as pushed; only what the merge
  // added on this device goes up.
  lastPushed = remember(server);
  pushChanged(merged);

  useAppStore.subscribe((state, prevState) => {
    if (state.tradeLogs !== prevState.tradeLogs) schedulePush(state.tradeLogs);
  });
}
