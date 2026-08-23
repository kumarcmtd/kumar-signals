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

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushedJson = "";

function schedulePush(logs: Record<string, TradeLogEntry[]>) {
  const json = JSON.stringify(logs);
  if (json === lastPushedJson) return; // nothing actually changed since the last successful push
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    api.saveTradeLogs(logs).then(
      () => {
        lastPushedJson = json;
      },
      () => {
        // Best-effort: a network hiccup here must never break the rest of
        // the app. Leave lastPushedJson stale so the next real change (or a
        // future retry) has another go at pushing.
      }
    );
  }, PUSH_DEBOUNCE_MS);
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

  const mergedJson = JSON.stringify(merged);
  lastPushedJson = JSON.stringify(server);
  if (mergedJson !== lastPushedJson) {
    api.saveTradeLogs(merged).then(
      () => {
        lastPushedJson = mergedJson;
      },
      () => {
        lastPushedJson = "";
      }
    );
  }

  useAppStore.subscribe((state, prevState) => {
    if (state.tradeLogs !== prevState.tradeLogs) schedulePush(state.tradeLogs);
  });
}
