import { afterEach, expect, test, vi } from "vitest";
import { flashText, majorFlashes } from "../../src/newsFlash";
import { scoreArticle } from "../../frontend/src/utils/newsScoring";

afterEach(() => vi.unstubAllGlobals());
const NOW = Date.parse("2026-10-14T17:00:00+05:30");
const art = (headline: string, minsAgo: number) => scoreArticle({ headline, summary: "", source: "Reuters", url: headline, publishedAt: new Date(NOW - minsAgo * 60_000).toISOString() }, NOW);

test("only fresh, major stories flash -- newest first", () => {
  const list = [
    art("Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia", 5),
    art("Drone strike sets Ras Tanura oil terminal ablaze", 2),
    art("Drone strike sets Abqaiq oil facility ablaze", 45), // too old
    art("Viking opens well completions facility in Saudi Arabia", 1), // not major
  ];
  const f = majorFlashes(list, NOW);
  expect(f.map((a) => a.headline)).toEqual(["Drone strike sets Ras Tanura oil terminal ablaze", "Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia"]);
});

test("the push says direction, market, time and the risk advice", () => {
  const m = flashText(art("Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia", 5), NOW);
  expect(m.title).toBe("NEWS FLASH: STRONG BULLISH Crude");
  expect(m.body).toContain("5 min ago");
  expect(m.body).toContain("Don't chase the first spike");
  expect(m.body).not.toContain("\\n"); // real line breaks, not a literal backslash-n
  expect(m.body.split("\n").length).toBeGreaterThan(3);
});

test("each story is pushed once", async () => {
  const store = new Map<string, string>([["ntfy_topic", "t"]]);
  const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) };
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => {
    if (String(u).includes("ntfy.sh")) sent.push(new Headers(init.headers).get("Title")!);
    return new Response("", { status: 200 });
  }));
  const fresh = new Date(Date.now() - 3 * 60_000).toISOString();
  const articles = [scoreArticle({ headline: "Drone strike sets Ras Tanura oil terminal ablaze", summary: "", source: "Reuters", url: "u1", publishedAt: fresh })];
  store.set("news:combined:v6", JSON.stringify({ available: true, articles, events: [], sourceStatus: [], builtAt: fresh }));
  const { runNewsFlashCheck } = await import("../../src/newsFlash");
  expect(await runNewsFlashCheck({ COMMODITY_KV: kv } as any)).toBe(1);
  expect(await runNewsFlashCheck({ COMMODITY_KV: kv } as any)).toBe(0);
  expect(sent).toEqual(["NEWS FLASH: STRONG BULLISH Crude"]);
});
