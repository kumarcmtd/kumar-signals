// CPU cost of each cron job, measured on the REAL worker code.
//
// Cloudflare's free plan allows 10 ms of CPU per invocation, and every job the
// cron starts shares that one budget. This runs each job against a fake Upstox,
// Yahoo, RSS and KV that return realistically SIZED data, with the clock set
// to a weekday afternoon, and reports CPU time per job -- cold (fresh isolate)
// and warm (caches filled, as on most ticks).
//
// Network time is not counted by Cloudflare and is instant here; only CPU is.
// Absolute numbers vary by machine -- compare them against each other and
// against the 10 ms budget, not to the microsecond.
//
// Run from the repo root:   npx tsx scripts/bench-cron.ts

// ---- Clock: Wednesday 23 Sep 2026, 14:00 IST (MCX open) -------------------
const FAKE_NOW = Date.UTC(2026, 8, 23, 8, 30);
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FAKE_NOW);
    else super(...(args as [number]));
  }
  static now() {
    return FAKE_NOW;
  }
}
(globalThis as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;

// ---- Synthetic market data ---------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date, min: number) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+05:30`;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

/** Upstox candle rows [date,o,h,l,c,v,oi], NEWEST first, as Upstox sends them. */
function rows(days: number, stepMin: number, endDayUtc: number, fromMin = 540, toMin = 1410, start = 9000): unknown[][] {
  const out: unknown[][] = [];
  let p = start;
  let d = new RealDate(endDayUtc - (days * 7 / 5 + 3) * 86_400_000);
  let made = 0;
  while (made < days) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      for (let m = fromMin; m < toMin; m += stepMin) {
        const o = p;
        p = Math.max(1, p + rnd() * 6 * Math.sqrt(stepMin));
        out.push([stamp(d, m), o, Math.max(o, p) + 1, Math.min(o, p) - 1, p, 1000, 50000]);
      }
      made++;
    }
    d = new RealDate(d.getTime() + 86_400_000);
  }
  return out.reverse();
}
const TODAY = RealDate.UTC(2026, 8, 23);
const YESTERDAY = RealDate.UTC(2026, 8, 22);
const candleJson = (r: unknown[][]) => JSON.stringify({ status: "success", data: { candles: r } });
const DATA = {
  today1m: candleJson(rows(1, 1, TODAY + 86_400_000, 540, 840)),
  prior1m: candleJson(rows(14, 1, YESTERDAY)),
  day: candleJson(rows(190, 1440, YESTERDAY, 540, 541)),
  m30: candleJson(rows(62, 30, YESTERDAY)),
};

function contracts(withExpiry: boolean) {
  const out: unknown[] = [];
  for (const expiry of withExpiry ? ["2026-10-15", "2026-11-17"] : ["2026-10-15"]) {
    for (let s = 8000; s <= 11000; s += 50) {
      for (const t of ["CE", "PE"]) out.push({ expiry, strike_price: s, instrument_type: t, instrument_key: `MCX_FO|${s}${t}${expiry}` });
    }
  }
  return JSON.stringify({ status: "success", data: out });
}
const CONTRACTS_ALL = contracts(true);
const CONTRACTS_ONE = contracts(false);

let FIXED_PREMIUM: number | null = null;
export function setFixedPremium(p: number | null) {
  FIXED_PREMIUM = p;
}
function quotes(url: string) {
  const keys = decodeURIComponent(new URL(url).searchParams.get("instrument_key") ?? "").split(",");
  const data: Record<string, unknown> = {};
  // FIXED_PREMIUM pins every premium between the seeded trades' stop (90) and
  // T1 (110), so open trades stay open and the full advance path is measured.
  for (const k of keys) data[k.replace("|", ":")] = { instrument_token: k, last_price: FIXED_PREMIUM ?? 50 + Math.abs(rnd() * 100), oi: 10000, volume: 500, ohlc: { close: 60 } };
  return JSON.stringify({ status: "success", data });
}

const RSS = `<?xml version="1.0"?><rss><channel>${Array.from({ length: 25 }, (_, i) =>
  `<item><title>Crude oil prices ${i % 2 ? "rise" : "fall"} as OPEC weighs output cut ${i}</title><link>https://example.com/a${i}</link><pubDate>Wed, 23 Sep 2026 0${i % 9}:00:00 GMT</pubDate><description>Oil futures moved on inventory data and supply concerns across the Middle East, traders said.</description></item>`).join("")}</channel></rss>`;

function yahoo() {
  return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 90, previousClose: 89, chartPreviousClose: 88, currency: "USD", marketState: "REGULAR", regularMarketTime: 1_790_000_000 }, indicators: { quote: [{ close: Array.from({ length: 22 }, (_, i) => 85 + i * 0.2) }] } }] } });
}

const json = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("instruments/search")) return json(JSON.stringify({ status: "success", data: [{ instrument_key: "MCX_FO|FUT1", expiry: "2026-10-19", trading_symbol: "CRUDEOIL FUT OCT" }, { instrument_key: "MCX_FO|FUT2", expiry: "2026-11-19", trading_symbol: "CRUDEOIL FUT NOV" }] }));
  if (url.includes("/intraday/")) return json(DATA.today1m);
  if (url.includes("/1minute/")) return json(DATA.prior1m);
  if (url.includes("/day/")) return json(DATA.day);
  if (url.includes("/30minute/")) return json(DATA.m30);
  if (url.includes("option/contract")) return json(url.includes("expiry_date=") ? CONTRACTS_ONE : CONTRACTS_ALL);
  if (url.includes("market-quote/")) return json(quotes(url));
  if (url.includes("finance.yahoo.com/v8")) return json(yahoo());
  if (url.includes("ntfy.sh")) return new Response("ok");
  if (/rss|feed|news\.google|\.xml/i.test(url)) return new Response(RSS, { headers: { "Content-Type": "application/rss+xml" } });
  return json(JSON.stringify({ error: "not mocked" }), 404);
}) as typeof fetch;

// ---- KV and env --------------------------------------------------------------
export function tradeLogs() {
  const logs: Record<string, unknown[]> = {};
  const keys = ["TWENTY20-CRUDEOIL-LIVE", "TWENTY20-NATURALGAS-LIVE", "BEST-CRUDEOIL", "BEST-NATURALGAS", "LEVELX-CRUDEOIL", "LEVELX-NATURALGAS", "AIUP-CRUDEOIL", "AIUP-NATURALGAS"];
  for (const tf of ["15", "30", "60", "240"]) for (const s of ["CRUDEOIL", "NATURALGAS"]) keys.push(`SHOOT-${s}-${tf}`, `AITEST-${s}-${tf}`);
  for (const k of keys) {
    logs[k] = Array.from({ length: 120 }, (_, i) => ({
      id: `${k}-${i}`, strike: 9000 + (i % 10) * 50, optSide: i % 2 ? "CE" : "PE", entry: 100, targets: [110, 120, 130], stop: 90,
      targetsHit: [true, false, false], status: "sl_hit", closed: true, openedAt: FAKE_NOW - (i + 1) * 3_600_000, closedAt: FAKE_NOW - i * 3_600_000, exitPrice: 95,
      meta: { label: "AI Elite", reasons: ["EMA stack aligned", "RSI above 55 and rising", "Volume 1.4x average"], confirmingTimeframes: ["15", "60"] },
      highWaterMark: 112, targetTouches: [1, 0, 0],
    }));
  }
  // Three trades still open.
  for (const k of ["TWENTY20-CRUDEOIL-LIVE", "BEST-NATURALGAS", "SHOOT-CRUDEOIL-15"]) {
    const last = logs[k][logs[k].length - 1] as Record<string, unknown>;
    // No target hit yet, so the stop is the original 90 and a premium of 100
    // keeps the trade open across runs.
    Object.assign(last, { closed: false, closedAt: null, status: "running", exitPrice: undefined, openedAt: FAKE_NOW - 3_600_000, targetsHit: [false, false, false], targetTouches: [0, 0, 0], highWaterMark: 100 });
  }
  return logs;
}

const store = new Map<string, string>();
const meta = new Map<string, unknown>();
const asType = (v: string | null, type?: string) =>
  v === null ? null : type === "json" ? JSON.parse(v) : type === "stream" ? new Response(v).body : v;
const KV = {
  meta,
  async get(key: string, type?: string) {
    return asType(store.get(key) ?? null, type);
  },
  async getWithMetadata(key: string, type?: string) {
    return { value: asType(store.get(key) ?? null, type), metadata: meta.get(key) ?? null };
  },
  async put(key: string, value: string, opts?: { metadata?: unknown }) {
    store.set(key, value);
    if (opts?.metadata !== undefined) meta.set(key, opts.metadata);
  },
  async delete(key: string) {
    store.delete(key);
  },
};
const env = { COMMODITY_KV: KV, AI: { run: async () => ({ response: "{}" }) }, ASSETS: { fetch: async () => new Response("") } } as never;

// ---- Measure ----------------------------------------------------------------
async function cpu(fn: () => Promise<unknown>): Promise<number> {
  const t = process.cpuUsage();
  await fn();
  const u = process.cpuUsage(t);
  return (u.user + u.system) / 1000;
}

/** Seeds KV and binds the shared cache; returns the fake env. */
export async function setup() {
  store.set("access_token", "tok");
  const [upstox, notify] = await Promise.all([import("../src/upstox"), import("../src/notify")]);
  store.set(notify.NTFY_TOPIC_KV_KEY, "bench-topic");
  // Must match src/storage.ts TRADE_LOGS_KV_KEY.
  store.set("trade_logs_v1", JSON.stringify(tradeLogs()));
  upstox.bindSharedCache(env as never);
  return env;
}

async function main() {
  await setup();
  const tl = store.get("trade_logs_v1")!;
  // Load every module BEFORE measuring, so import cost is not billed to a job.
  const [, notify, tradeLogCron, expiryAlerts, profiles, news, globalMarkets] = await Promise.all([
    import("../src/upstox"), import("../src/notify"), import("../src/tradeLogCron"), import("../src/expiryAlerts"),
    import("../src/profiles"), import("../src/news"), import("../src/globalMarkets"),
  ]);

  const jobs: [string, () => Promise<unknown>][] = [
    ["Best Call (both symbols)", () => notify.runBestCallNotificationCheck(env)],
    ["Ai20-20 (both symbols)", () => notify.runTwentyTwentyNotificationCheck(env)],
    ["Trade-log advance", () => tradeLogCron.runTradeLogAdvanceCheck(env)],
    ["Expiry alerts", () => expiryAlerts.runExpiryAlertCheck(env)],
    ["Time profile warm", () => profiles.warmTimeProfiles(env)],
    ["News warm", () => news.warmEnergyNews(env)],
    ["Overnight anchor", () => globalMarkets.captureOvernightAnchor(env)],
  ];

  console.log(`trade logs in KV: ${(tl.length / 1024).toFixed(0)} KB\n`);

  const results: [string, number, number][] = [];
  for (const [name, fn] of jobs) {
    const cold = await cpu(fn);
    const warm = await cpu(fn);
    results.push([name, cold, warm]);
  }
  const kvWrites = [...store.keys()];
  console.log("job                         cold ms   warm ms");
  let totalWarm = 0;
  for (const [name, cold, warm] of results) {
    totalWarm += warm;
    console.log(`${name.padEnd(26)}${cold.toFixed(1).padStart(8)}${warm.toFixed(1).padStart(10)}${warm > 10 ? "   OVER the 10 ms limit alone" : ""}`);
  }
  // ---- Per trigger, as the split cron actually runs them ----
  const cron = await import("../src/cron");
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as never;
  const trigger = async (c: string) => { waits.length = 0; await cron.runScheduled(env as never, ctx, c); await Promise.all(waits); };
  console.log("\nPER TRIGGER (each is its own invocation, own 10 ms)   warm ms");
  // Re-seed with three genuinely open trades, written through the real save
  // path so the open-trade metadata is set, and hold premiums inside the range.
  FIXED_PREMIUM = 100;
  await (await import("../src/storage")).saveTradeLogsToKv(env as never, tradeLogs());
  for (const [label, c] of [["FAST    */5      (Ai20-20, expiry, anchor)", cron.CRON_FAST], ["TRADES  1-59/5   (3 trades open)", cron.CRON_TRADES], ["WARM    2-59/10  (news fresh, profile built)", cron.CRON_WARM]] as const) {
    await trigger(c);
    const w = await cpu(() => trigger(c));
    console.log(`${label.padEnd(50)}${w.toFixed(1).padStart(8)}${w > 10 ? "   OVER" : ""}`);
  }
  // No trades open: the common case outside market hours.
  const storage = await import("../src/storage");
  const logs = JSON.parse(store.get("trade_logs_v1")!);
  for (const list of Object.values(logs) as { closed: boolean }[][]) list[list.length - 1].closed = true;
  await storage.saveTradeLogsToKv(env as never, logs);
  const stillOpen = (await storage.openTradeCountFromKv(env as never)) ?? -1;
  console.log(`  (open trades before the "nothing open" run: ${stillOpen})`);
  console.log(`${"TRADES  1-59/5   (nothing open)".padEnd(50)}${(await cpu(() => trigger(cron.CRON_TRADES))).toFixed(1).padStart(8)}`);
  // News stale -> WARM rebuilds news, and nothing else in that run.
  meta.set("news:combined:v6", { builtAt: Date.now() - 60 * 60 * 1000 });
  console.log(`${"WARM    2-59/10  (news stale -> rebuild)".padEnd(50)}${(await cpu(() => trigger(cron.CRON_WARM))).toFixed(1).padStart(8)}`);

  console.log(`\n${"ONE TICK, all jobs (warm)".padEnd(26)}${"".padStart(8)}${totalWarm.toFixed(1).padStart(10)}   budget: 10 ms`);
  // ---- The endpoints the live pages poll (each request is its own 10 ms) ----
  const { handleRequest } = await import("../src/routes");
  const routes = [
    "/api/market-status", "/api/prices", "/api/candles?symbol=CRUDEOIL&tf=15", "/api/candles?symbol=CRUDEOIL&tf=60",
    "/api/candles?symbol=CRUDEOIL&tf=240", "/api/candles?symbol=CRUDEOIL&tf=1D", "/api/options/CRUDEOIL", "/api/depth/CRUDEOIL",
    "/api/pullback?symbol=CRUDEOIL", "/api/signals", "/api/scan?symbol=CRUDEOIL&tf=15", "/api/time-profile?symbol=CRUDEOIL",
    "/api/history-30m?symbol=CRUDEOIL", "/api/gap-study?symbol=CRUDEOIL", "/api/overnight-tracker", "/api/news", "/api/news-trade", "/api/why-today",
  ];
  console.log("\nHTTP route                                  cold ms   warm ms");
  for (const r of routes) {
    const call = () => handleRequest(new Request(`https://x${r}`, { headers: { "CF-Connecting-IP": "1.1.1.1" } }), env as never).then((res) => res.text());
    const cold = await cpu(call);
    const warm = await cpu(call);
    console.log(`${r.padEnd(42)}${cold.toFixed(1).padStart(8)}${warm.toFixed(1).padStart(10)}${warm > 10 ? "   OVER" : ""}`);
  }

  console.log(`\nKV keys after run: ${kvWrites.length}; largest: ${kvWrites.map((k) => [k, store.get(k)!.length] as const).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}KB`).join(", ")}`);
}

if (!process.env.BENCH_NO_MAIN) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
