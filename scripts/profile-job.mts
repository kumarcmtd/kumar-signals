// Profiles one cron job, warm, with the V8 sampling profiler, and prints the
// functions with the most self-time. Reuses bench-cron.ts's fake world.
//
// Run from the repo root:  npx tsx scripts/profile-job.ts bestcall|twenty
import { Session } from "node:inspector/promises";

process.env.BENCH_NO_MAIN = "1";
const { setup } = await import("./bench-cron.ts");
const env = await setup();
const notify = await import("../src/notify.ts");
const news = await import("../src/news.ts");
const kv = (env as any).COMMODITY_KV;
const job = process.argv[2] === "news" ? async () => { kv.meta?.delete?.("news:combined:v6"); await news.warmEnergyNews(env); } : process.argv[2] === "twenty" ? () => notify.runTwentyTwentyNotificationCheck(env) : () => notify.runBestCallNotificationCheck(env);

await job(); // warm caches
await job();

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.setSamplingInterval", { interval: 50 });
await session.post("Profiler.start");
for (let i = 0; i < 20; i++) await job();
const { profile } = await session.post("Profiler.stop");

const self = new Map<string, number>();
const dt = profile.timeDeltas ?? [];
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
(profile.samples ?? []).forEach((id, i) => {
  const n = byId.get(id)!;
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"}  ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`self time over 20 warm runs (${(total / 1000 / 20).toFixed(1)} ms per run):`);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
