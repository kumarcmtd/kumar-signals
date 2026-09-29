// The sharded trade-log store must give every reader exactly what the old
// single blob would have, and the cron must touch only the running trades.

import { afterEach, expect, test, vi } from "vitest";
import { mergeTradeLogs, type TradeLogEntry } from "../../frontend/src/utils/tradeLogCore";
import { getTradeLogsFromKv, saveTradeLogsToKv } from "../../src/storage";
import { isSharded, loadOpenTrades, migrateTradeLogs, pushTradeLogs, readAllTradeLogsJson, readHot, saveCronResult } from "../../src/tradeLogStore";

function makeKv() {
  const store = new Map<string, string>();
  const meta = new Map<string, unknown>();
  const reads: string[] = [];
  const puts: string[] = [];
  let onPut: ((key: string) => void) | null = null;
  const asType = (v: string | null, type?: string) => (v === null ? null : type === "json" ? JSON.parse(v) : type === "stream" ? new Response(v).body : v);
  return {
    store, meta, reads, puts,
    set onPut(f: ((key: string) => void) | null) { onPut = f; },
    async get(key: string, type?: string) { reads.push(key); return asType(store.get(key) ?? null, type); },
    async getWithMetadata(key: string, type?: string) { reads.push(key); return { value: asType(store.get(key) ?? null, type), metadata: meta.get(key) ?? null }; },
    async put(key: string, value: string, opts?: { metadata?: unknown }) { puts.push(key); store.set(key, value); if (opts?.metadata !== undefined) meta.set(key, opts.metadata); onPut?.(key); },
    async delete(key: string) { store.delete(key); meta.delete(key); },
  };
}
type Kv = ReturnType<typeof makeKv>;
const envWith = (kv: Kv) => ({ COMMODITY_KV: kv }) as never;
const getAll = async (kv: Kv) => JSON.parse(await readAllTradeLogsJson(envWith(kv))) as Record<string, TradeLogEntry[]>;

afterEach(() => vi.useRealTimers());

let n = 0;
function entry(over: Partial<TradeLogEntry> = {}): TradeLogEntry {
  n += 1;
  return {
    id: `t${n}`, strike: 9000 + n * 50, optSide: "CE", entry: 100, targets: [110, 120, 130], stop: 90,
    targetsHit: [false, false, false], status: "sl_hit", closed: true, openedAt: n * 1000, closedAt: n * 1000 + 500, exitPrice: 90,
    ...over,
  } as TradeLogEntry;
}
const running = (over: Partial<TradeLogEntry> = {}) => entry({ status: "running", closed: false, closedAt: null, exitPrice: undefined, ...over });

function history(): Record<string, TradeLogEntry[]> {
  return {
    "BEST-CRUDEOIL": [entry(), entry(), running()],
    "BEST-NATURALGAS": [entry(), entry()],
    "SHOOT-CRUDEOIL-15": [entry(), running()],
    "AITEST-NATURALGAS-60": [entry()],
  };
}

async function migrated(logs = history()) {
  const kv = makeKv();
  await saveTradeLogsToKv(envWith(kv), logs);
  for (let i = 0; i < 10 && !(await isSharded(envWith(kv))); i++) expect(await migrateTradeLogs(envWith(kv))).toBe(true);
  expect(await isSharded(envWith(kv))).toBe(true);
  return kv;
}

// ---------------------------------------------------------------------------

test("migration: GET returns exactly the old log, and hot holds only the running trades", async () => {
  const logs = history();
  const kv = await migrated(logs);
  expect(await getAll(kv)).toEqual(logs);
  const hot = await readHot(envWith(kv));
  expect(Object.keys(hot).sort()).toEqual(["BEST-CRUDEOIL", "SHOOT-CRUDEOIL-15"]);
  expect(await migrateTradeLogs(envWith(kv))).toBe(false); // once only
});

test("a big log migrates a few keys per run, and a save mid-way restarts it", async () => {
  const logs: Record<string, TradeLogEntry[]> = {};
  for (let i = 0; i < 30; i++) logs[`K${String(i).padStart(2, "0")}-CRUDEOIL`] = [entry(), i % 7 ? entry() : running()];
  const kv = makeKv();
  await saveTradeLogsToKv(envWith(kv), logs);
  let runs = 0;
  kv.puts.length = 0;
  while (!(await isSharded(envWith(kv))) && runs < 10) { await migrateTradeLogs(envWith(kv)); runs++; }
  expect(runs).toBe(5); // 30 keys, 6 per run
  expect(kv.puts.filter((k) => k.startsWith("tl2:k:"))).toHaveLength(30); // each key copied once
  expect(await getAll(kv)).toEqual(logs);

  // Restart case: a save between runs changes the revision.
  const kv2 = makeKv();
  await saveTradeLogsToKv(envWith(kv2), logs);
  await migrateTradeLogs(envWith(kv2));
  const changed = { ...logs, "K00-CRUDEOIL": [...logs["K00-CRUDEOIL"], running()] };
  await saveTradeLogsToKv(envWith(kv2), changed);
  for (let i = 0; i < 10 && !(await isSharded(envWith(kv2))); i++) await migrateTradeLogs(envWith(kv2));
  expect(await getAll(kv2)).toEqual(changed);
  expect(kv2.store.has("tl2:migrating")).toBe(false);
});

test("migration is not committed if the app saved while it was copying", async () => {
  const kv = makeKv();
  await saveTradeLogsToKv(envWith(kv), history());
  let saved = false;
  kv.onPut = (key) => {
    if (!saved && key.startsWith("tl2:k:")) { saved = true; void saveTradeLogsToKv(envWith(kv), { ...history(), NEW: [entry()] }); }
  };
  expect(await migrateTradeLogs(envWith(kv))).toBe(true);
  expect(await isSharded(envWith(kv))).toBe(false);
  kv.onPut = null;
  expect(await migrateTradeLogs(envWith(kv))).toBe(true); // redone next run
  expect(await isSharded(envWith(kv))).toBe(true);
  expect(Object.keys(await getAll(kv))).toContain("NEW");
});

test("before migration, GET and POST behave exactly as the old blob code", async () => {
  const kv = makeKv();
  const logs = history();
  await saveTradeLogsToKv(envWith(kv), logs);
  const body = { "BEST-NATURALGAS": [...logs["BEST-NATURALGAS"], running()] };
  await pushTradeLogs(envWith(kv), body);
  expect(await getAll(kv)).toEqual(mergeTradeLogs(body, logs));
  expect(await getTradeLogsFromKv(envWith(kv))).toEqual(mergeTradeLogs(body, logs));
});

test("a push of only the changed keys gives the same result as the old whole-blob merge", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const openCrude = logs["BEST-CRUDEOIL"][2];
  const body = {
    // the app closed the running crude trade
    "BEST-CRUDEOIL": [...logs["BEST-CRUDEOIL"].slice(0, 2), { ...openCrude, closed: true, status: "target1_hit" as never, closedAt: openCrude.openedAt + 900, exitPrice: 111 }],
    // a new trade opened on NG
    "BEST-NATURALGAS": [...logs["BEST-NATURALGAS"], running()],
    // a brand-new key
    "KIMI-CRUDEOIL-15": [entry(), running()],
  };
  kv.puts.length = 0;
  await pushTradeLogs(envWith(kv), body);
  expect(await getAll(kv)).toEqual(mergeTradeLogs(body, logs));
  // Untouched keys were not rewritten.
  expect(kv.puts).not.toContain("tl2:k:SHOOT-CRUDEOIL-15");
  expect(kv.puts).not.toContain("tl2:k:AITEST-NATURALGAS-60");
  const hot = await readHot(envWith(kv));
  expect(Object.keys(hot).sort()).toEqual(["BEST-NATURALGAS", "KIMI-CRUDEOIL-15", "SHOOT-CRUDEOIL-15"]);
});

test("a full push from an older app (or a backup restore) matches the old merge too", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const body = history(); // different ids: all new entries
  await pushTradeLogs(envWith(kv), body);
  expect(await getAll(kv)).toEqual(mergeTradeLogs(body, logs));
});

test("pushing an unchanged key writes nothing", async () => {
  const logs = history();
  const kv = await migrated(logs);
  kv.puts.length = 0;
  await pushTradeLogs(envWith(kv), { "BEST-CRUDEOIL": logs["BEST-CRUDEOIL"] });
  expect(kv.puts).toEqual([]);
});

test("the cron reads only the running trades, never the closed history", async () => {
  const kv = await migrated();
  kv.reads.length = 0;
  const { logs } = await loadOpenTrades(envWith(kv));
  expect(Object.keys(logs).sort()).toEqual(["BEST-CRUDEOIL", "SHOOT-CRUDEOIL-15"]);
  expect(kv.reads.filter((k) => k.startsWith("tl2:k:")).sort()).toEqual(["tl2:k:BEST-CRUDEOIL", "tl2:k:SHOOT-CRUDEOIL-15"]);
});

test("a new high alone waits for the 30-minute clock; a target hit saves at once, to hot only", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const { logs: open, stale } = await loadOpenTrades(envWith(kv));
  const e = open["BEST-CRUDEOIL"][0];

  kv.puts.length = 0;
  await saveCronResult(envWith(kv), open, { ...open, "BEST-CRUDEOIL": [{ ...e, highWaterMark: 108 }] }, stale);
  expect(kv.puts).toEqual([]); // hot was written moments ago by the migration

  await saveCronResult(envWith(kv), open, { ...open, "BEST-CRUDEOIL": [{ ...e, highWaterMark: 112, targetsHit: [true, false, false] }] }, stale);
  expect(kv.puts).toEqual(["tl2:hot"]);
  expect((await getAll(kv))["BEST-CRUDEOIL"].at(-1)!.targetsHit).toEqual([true, false, false]);

  vi.useFakeTimers({ now: Date.now() + 31 * 60_000, toFake: ["Date"] });
  kv.puts.length = 0;
  await saveCronResult(envWith(kv), open, { ...open, "BEST-CRUDEOIL": [{ ...e, highWaterMark: 115 }] }, stale);
  expect(kv.puts).toEqual(["tl2:hot"]);
  expect((await getAll(kv))["BEST-CRUDEOIL"].at(-1)!.highWaterMark).toBe(115);
});

test("a trade the cron closes moves into its history and out of hot", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const { logs: open, stale } = await loadOpenTrades(envWith(kv));
  const e = open["SHOOT-CRUDEOIL-15"][0];
  const closed = { ...e, closed: true, status: "sl_hit" as never, closedAt: e.openedAt + 700, exitPrice: 89 };
  await saveCronResult(envWith(kv), open, { ...open, "SHOOT-CRUDEOIL-15": [closed] }, stale);
  expect((await getAll(kv))["SHOOT-CRUDEOIL-15"]).toEqual(mergeTradeLogs({ "SHOOT-CRUDEOIL-15": [closed] }, logs)["SHOOT-CRUDEOIL-15"]);
  expect(Object.keys(await readHot(envWith(kv)))).toEqual(["BEST-CRUDEOIL"]);
});

test("the cron uses the app's progress from the shard, not a stale copy in hot", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const e = logs["BEST-CRUDEOIL"][2];
  // The app saw T1 hit; that goes to the shard, hot still has the old copy.
  await pushTradeLogs(envWith(kv), { "BEST-CRUDEOIL": [...logs["BEST-CRUDEOIL"].slice(0, 2), { ...e, targetsHit: [true, false, false] }] });
  const { logs: open } = await loadOpenTrades(envWith(kv));
  expect(open["BEST-CRUDEOIL"][0].targetsHit).toEqual([true, false, false]);
});

test("a new trade the app opens while the cron is closing the old one survives", async () => {
  const logs = history();
  const kv = await migrated(logs);
  const { logs: open, stale } = await loadOpenTrades(envWith(kv));
  const x = open["BEST-CRUDEOIL"][0];
  // Mid-run, the app closes X and opens Y.
  const y = running({ openedAt: x.openedAt + 5000 });
  await pushTradeLogs(envWith(kv), { "BEST-CRUDEOIL": [...logs["BEST-CRUDEOIL"].slice(0, 2), { ...x, closed: true, status: "stopped_breakeven" as never, closedAt: x.openedAt + 1000, exitPrice: 100 }, y] });
  // Then the cron writes ITS close of X, which came later.
  const cronClose = { ...x, closed: true, status: "sl_hit" as never, closedAt: x.openedAt + 2000, exitPrice: 88 };
  await saveCronResult(envWith(kv), open, { ...open, "BEST-CRUDEOIL": [cronClose] }, stale);
  const all = await getAll(kv);
  const list = all["BEST-CRUDEOIL"];
  expect(list.find((e) => e.id === x.id)!.status).toBe("stopped_breakeven"); // first close wins
  expect(list.at(-1)!.id).toBe(y.id);
  expect((await readHot(envWith(kv)))["BEST-CRUDEOIL"].map((e) => e.id)).toEqual([y.id]);
});

test("the full cron run with nothing open reads no history at all", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-26T03:00:00+05:30"), toFake: ["Date"] });
  const { runTradeLogAdvanceCheck } = await import("../../src/tradeLogCron");
  const kv = await migrated({ A: [entry()], B: [entry()] });
  kv.store.set("access_token", "tok");
  kv.reads.length = 0;
  expect(await runTradeLogAdvanceCheck(envWith(kv))).toBe(false);
  expect(kv.reads.filter((k) => k.startsWith("tl2:k:") || k === "trade_logs_v1")).toEqual([]);
});

test("the first cron run migrates and does nothing else", async () => {
  const { runTradeLogAdvanceCheck } = await import("../../src/tradeLogCron");
  const kv = makeKv();
  kv.store.set("access_token", "tok");
  await saveTradeLogsToKv(envWith(kv), history());
  expect(await runTradeLogAdvanceCheck(envWith(kv))).toBe(true);
  expect(await isSharded(envWith(kv))).toBe(true);
});
