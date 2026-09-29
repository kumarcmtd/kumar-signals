// Trade logs stored in pieces ("sharded") instead of one big value.
//
// WHY. The whole history used to live in one KV value, trade_logs_v1 -- over
// 1 MB with a few hundred closed calls per page. The 5-minute cron parsed all
// of it to advance two or three running trades, and every save from the app
// sent all of it, parsed it, merged it against all of it and wrote all of it
// back: ~5 ms and ~13 ms of CPU, against the free plan's 10 ms per call.
//
// LAYOUT
//   tl2:keys        every trade-log key, as a JSON array (the index GET uses)
//   tl2:k:<key>     that key's full history, as a JSON array
//   tl2:hot         only the RUNNING trades: { key: [entry] }, a few hundred
//                   bytes. The cron reads and writes nothing else while a
//                   trade is merely progressing, so it is still ONE KV write
//                   per changed tick, as before.
//
// A key's true history is always merge(hot[key], shard[key]) using the SAME
// mergeTradeLogEntryLists the app uses -- closed beats running, the first close
// wins, progress only ever moves forward -- so no matter which copy is ahead,
// every reader gets the same answer the single blob would have given.
//
// MIGRATION. Until tl2:keys exists everything runs on trade_logs_v1 exactly as
// before. The cron copies v1 into shards over a few runs, and writes tl2:keys
// LAST, so a migration cut off halfway simply carries on. v1 is then left untouched as a
// frozen backup; nothing reads it again.

import { isMinorProgress, mergeTradeLogEntryLists, mergeTradeLogs, MINOR_PROGRESS_SAVE_MS, type TradeLogEntry } from "../frontend/src/utils/tradeLogCore";
import type { Env } from "./env";
import { getTradeLogsFromKv, getTradeLogsWithRev, saveTradeLogsToKv, tradeLogRevision } from "./storage";

const KEYS_KEY = "tl2:keys";
const HOT_KEY = "tl2:hot";
const shardKey = (key: string) => `tl2:k:${key}`;

type Logs = Record<string, TradeLogEntry[]>;

function parseList(raw: string | null): TradeLogEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function readKeys(env: Env): Promise<string[] | null> {
  const raw = await env.COMMODITY_KV.get(KEYS_KEY);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export async function readHot(env: Env): Promise<Logs> {
  return (await readHotWithTime(env)).hot;
}

/** hot plus when it was last written (KV metadata; 0 when unknown). */
async function readHotWithTime(env: Env): Promise<{ hot: Logs; at: number }> {
  const { value: raw, metadata } = await env.COMMODITY_KV.getWithMetadata<{ at?: number }>(HOT_KEY, "text");
  const at = typeof metadata?.at === "number" ? metadata.at : 0;
  if (!raw) return { hot: {}, at };
  try {
    const v = JSON.parse(raw);
    return { hot: v && typeof v === "object" && !Array.isArray(v) ? v : {}, at };
  } catch {
    return { hot: {}, at };
  }
}

const putHot = (env: Env, hot: Logs) => env.COMMODITY_KV.put(HOT_KEY, JSON.stringify(hot), { metadata: { at: Date.now() } });

async function readShard(env: Env, key: string): Promise<{ raw: string | null; list: TradeLogEntry[] }> {
  const raw = await env.COMMODITY_KV.get(shardKey(key));
  return { raw, list: parseList(raw) };
}

/** True once the migration has committed. Checked without parsing anything. */
export async function isSharded(env: Env): Promise<boolean> {
  const { value } = await env.COMMODITY_KV.getWithMetadata(KEYS_KEY, "stream");
  if (!value) return false;
  await value.cancel().catch(() => undefined);
  return true;
}

/** The running entry of a list, as a one-item list, or [] when none runs. */
function openTail(list: TradeLogEntry[]): TradeLogEntry[] {
  let last: TradeLogEntry | undefined;
  for (const e of list) if (!last || e.openedAt >= last.openedAt) last = e;
  return last && !last.closed ? [last] : [];
}

function setHot(hot: Logs, key: string, list: TradeLogEntry[]): void {
  const tail = openTail(list);
  if (tail.length) hot[key] = tail;
  else delete hot[key];
}

// ---------------------------------------------------------------------------
// Migration (cron only)
// ---------------------------------------------------------------------------

const MIGRATE_KEY = "tl2:migrating";
/**
 * Keys copied per run. Parsing the old blob is ~5 ms by itself, so each run
 * writes only a few keys on top; ~40 keys take ~7 runs, about half an hour.
 */
const MIGRATE_KEYS_PER_RUN = 6;

/**
 * Copies trade_logs_v1 into shards, a few keys per run, recording progress in
 * tl2:migrating against the blob's revision. Returns true when it did work,
 * so the caller spends the rest of the run on nothing else.
 *
 * Done in one go it measured 10-13 ms -- and a run Cloudflare cuts off for CPU
 * would be retried, and cut off, forever. If the app saves meanwhile, the
 * revision changes and the copy starts again, so no save can be missed.
 */
export async function migrateTradeLogs(env: Env): Promise<boolean> {
  if (await isSharded(env)) return false;
  const { logs, rev } = await getTradeLogsWithRev(env);
  const keys = Object.keys(logs).filter((k) => Array.isArray(logs[k])).sort();

  let done: string[] = [];
  try {
    const p = JSON.parse((await env.COMMODITY_KV.get(MIGRATE_KEY)) ?? "null") as { rev: string | null; done: string[] } | null;
    if (p && p.rev === rev && Array.isArray(p.done)) done = p.done;
  } catch {
    // unreadable progress -- start over
  }
  const doneSet = new Set(done);
  const batch = keys.filter((k) => !doneSet.has(k)).slice(0, MIGRATE_KEYS_PER_RUN);
  await Promise.all(batch.map((k) => env.COMMODITY_KV.put(shardKey(k), JSON.stringify(logs[k]))));
  done = [...done, ...batch];

  if (done.length < keys.length) {
    await env.COMMODITY_KV.put(MIGRATE_KEY, JSON.stringify({ rev, done }));
    return true;
  }
  const hot: Logs = {};
  for (const k of keys) setHot(hot, k, logs[k] as TradeLogEntry[]);
  await putHot(env, hot);
  // The app saved while we copied: our shards may miss that save. Leave the
  // switch uncommitted and start again next run.
  if (rev !== null && (await tradeLogRevision(env)) !== rev) return true;
  await env.COMMODITY_KV.put(KEYS_KEY, JSON.stringify(keys));
  await env.COMMODITY_KV.delete(MIGRATE_KEY);
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/trade-logs
// ---------------------------------------------------------------------------

/**
 * The whole log as a JSON string, identical in shape to the old single blob.
 * Shards are spliced in as they are stored, never parsed, except the few
 * keys that have a running trade in hot.
 */
export async function readAllTradeLogsJson(env: Env): Promise<string> {
  const keys = await readKeys(env);
  if (keys === null) return JSON.stringify(await getTradeLogsFromKv(env));
  const hot = await readHot(env);
  const all = [...new Set([...keys, ...Object.keys(hot)])];
  const raws = await Promise.all(all.map((k) => env.COMMODITY_KV.get(shardKey(k))));
  const parts = all.map((k, i) => {
    const raw = raws[i];
    const body = hot[k]?.length ? JSON.stringify(mergeTradeLogEntryLists(hot[k], parseList(raw))) : raw && raw.startsWith("[") ? raw : "[]";
    return `${JSON.stringify(k)}:${body}`;
  });
  return `{${parts.join(",")}}`;
}

// ---------------------------------------------------------------------------
// POST /api/trade-logs
// ---------------------------------------------------------------------------

/**
 * Merges a push from the app. The body may hold every key (an older app, or a
 * backup restore) or only the keys that changed (the current app); either
 * way only keys whose merged history actually differs are written.
 */
export async function pushTradeLogs(env: Env, body: Record<string, unknown>): Promise<void> {
  const keys = await readKeys(env);
  if (keys === null) {
    // Not migrated yet: exactly the old behaviour.
    const existing = (await getTradeLogsFromKv(env)) as Logs;
    await saveTradeLogsToKv(env, mergeTradeLogs(body as Logs, existing));
    return;
  }
  const known = new Set(keys);
  const hot = await readHot(env);
  const hotChanges = new Map<string, TradeLogEntry[]>();
  const newKeys: string[] = [];

  await Promise.all(
    Object.entries(body).map(async ([key, list]) => {
      if (!Array.isArray(list)) return;
      const shard = await readShard(env, key);
      const existing = hot[key]?.length ? mergeTradeLogEntryLists(hot[key], shard.list) : shard.list;
      // incoming = "local", stored = "server": the same roles as before.
      const merged = mergeTradeLogEntryLists(list as TradeLogEntry[], existing);
      if (merged.length === 0 && shard.raw === null) return;
      const json = JSON.stringify(merged);
      if (json !== shard.raw) await env.COMMODITY_KV.put(shardKey(key), json);
      if (!known.has(key)) newKeys.push(key);
      // hot only needs to know WHICH trade is running. Its progress can lag
      // the shard -- the cron merges the two before it acts.
      const want = openTail(merged)[0]?.id ?? null;
      const have = openTail(hot[key] ?? [])[0]?.id ?? null;
      if (want !== have) hotChanges.set(key, merged.slice(-1));
    })
  );

  if (hotChanges.size) {
    // Re-read right before writing, so a cron write since our read is kept.
    const fresh = await readHot(env);
    for (const [key, tail] of hotChanges) setHot(fresh, key, mergeTradeLogEntryLists(tail, fresh[key] ?? []));
    await putHot(env, fresh);
  }
  if (newKeys.length) {
    const fresh = (await readKeys(env)) ?? keys;
    await env.COMMODITY_KV.put(KEYS_KEY, JSON.stringify([...new Set([...fresh, ...newKeys])]));
  }
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export interface OpenTrades {
  /** Each running trade as a one-entry list -- the shape the advance code takes. */
  logs: Logs;
  /** Keys hot still lists but whose trade the app has already closed. */
  stale: Map<string, string>;
}

/** The running trades, each merged with its shard so its progress is current. */
export async function loadOpenTrades(env: Env): Promise<OpenTrades> {
  const hot = await readHot(env);
  const keys = Object.keys(hot).filter((k) => openTail(hot[k] ?? []).length);
  const shards = await Promise.all(keys.map((k) => readShard(env, k)));
  const logs: Logs = {};
  const stale = new Map<string, string>();
  keys.forEach((k, i) => {
    const hotEntry = openTail(hot[k])[0];
    const merged = mergeTradeLogEntryLists(hot[k], shards[i].list);
    const current = merged.find((e) => e.id === hotEntry.id) ?? hotEntry;
    if (current.closed) stale.set(k, current.id);
    else logs[k] = [current];
  });
  return { logs, stale };
}

/**
 * Writes back what the cron changed. A trade still running goes to hot only;
 * a trade the cron closed is merged into its shard and leaves hot.
 */
export async function saveCronResult(env: Env, before: Logs, after: Logs, stale: Map<string, string>): Promise<void> {
  const progressed = new Map<string, TradeLogEntry>();
  const leaving = new Map(stale);
  let onlyMinor = true;
  for (const key of Object.keys(before)) {
    const was = before[key][before[key].length - 1];
    const now = after[key]?.[after[key].length - 1];
    if (!now || now === was) continue;
    if (now.closed) {
      const shard = await readShard(env, key);
      // Fresh shard = "local", the cron's copy = "server": as before.
      await env.COMMODITY_KV.put(shardKey(key), JSON.stringify(mergeTradeLogEntryLists(shard.list, [now])));
      leaving.set(key, now.id);
    } else {
      progressed.set(key, now);
      if (!isMinorProgress(was, now)) onlyMinor = false;
    }
  }
  if (!progressed.size && !leaving.size) return;
  const { hot: fresh, at } = await readHotWithTime(env);
  // Only new highs on running trades: save them on the slow clock.
  if (!leaving.size && onlyMinor && Date.now() - at < MINOR_PROGRESS_SAVE_MS) return;
  for (const [key, entry] of progressed) setHot(fresh, key, mergeTradeLogEntryLists(fresh[key] ?? [], [entry]));
  for (const [key, id] of leaving) setHot(fresh, key, (fresh[key] ?? []).filter((e) => e.id !== id));
  await putHot(env, fresh);
}
