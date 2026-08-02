import { useAppStore, type TradeLogEntry } from "./store/appStore";
import { api } from "./api/client";
import { MAX_HISTORY } from "./hooks/useTradeLog";
import { dedupeOverlappingEntries } from "./utils/dedupeTradeLog";

// This app has no login, so trade/signal history has exactly one shared
// home on the server (same trust level as every other endpoint here) rather
// than a per-user one -- opening the app from a different browser or device
// previously showed nothing at all, since Zustand's persist middleware only
// ever wrote to that one browser's own localStorage.
const PUSH_DEBOUNCE_MS = 8000;

// Merges one key's two entry lists by id (a real union, not a
// whole-array pick) -- an earlier version of this function picked
// whichever SIDE's last entry was newer and discarded the other side's
// array entirely, which could wipe out a whole morning of local-only
// history the instant the server happened to have one fresher entry.
// For an id both sides have, the closed/more-advanced version wins;
// otherwise local wins (it's what's actually running in this browser
// right now). Capped to the same MAX_HISTORY every page's own rolling
// window already uses, keeping the newest entries by open time.
function mergeEntryLists(local: TradeLogEntry[], server: TradeLogEntry[]): TradeLogEntry[] {
  const byId = new Map<string, TradeLogEntry>();
  for (const e of server) byId.set(e.id, e);
  for (const e of local) {
    const existing = byId.get(e.id);
    if (!existing || !existing.closed || e.closed) byId.set(e.id, e);
  }
  const merged = Array.from(byId.values()).sort((a, b) => a.openedAt - b.openedAt);
  const deduped = dedupeOverlappingEntries(merged);
  return deduped.length > MAX_HISTORY ? deduped.slice(deduped.length - MAX_HISTORY) : deduped;
}

function mergeTradeLogs(local: Record<string, TradeLogEntry[]>, server: Record<string, TradeLogEntry[]>): Record<string, TradeLogEntry[]> {
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const out: Record<string, TradeLogEntry[]> = {};
  for (const key of keys) {
    out[key] = mergeEntryLists(local[key] ?? [], server[key] ?? []);
  }
  return out;
}

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
