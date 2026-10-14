import { expect, test } from "vitest";
import { settlePublishTimes, storyKey } from "../../src/news";

const A = (headline: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({ headline, summary: "", source: "S", url: `${headline}-${publishedAt}-${Math.random()}`, publishedAt, ...extra });

test("an undated copy takes the dated copy's earliest time; all copies are kept", () => {
  const out = settlePublishTimes(
    [
      A("Aramco’s Dhahran headquarters hit during Houthi missile attack on Saudi Arabia", "2026-10-14T02:21:00.000Z", { dateKnown: false }),
      A("Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia", "2026-10-13T23:22:00.000Z"),
      A("Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia", "2026-10-13T23:40:00.000Z"),
    ],
    [],
  );
  expect(out).toHaveLength(3);
  for (const a of out) {
    expect(a.publishedAt).toBe("2026-10-13T23:22:00.000Z");
    expect(a.dateKnown).toBeUndefined();
  }
});

test("a story no feed dated keeps when it was first seen, flagged", () => {
  const prev = [A("Undated story about OPEC", "2026-10-14T00:30:00.000Z", { dateKnown: false })];
  const out = settlePublishTimes([A("Undated story about OPEC", "2026-10-14T02:21:00.000Z", { dateKnown: false })], prev);
  expect(out[0].publishedAt).toBe("2026-10-14T00:30:00.000Z");
  expect(out[0].dateKnown).toBe(false);
});

test("story keys ignore quotes, case and punctuation", () => {
  expect(storyKey("Aramco’s HQ hit!")).toBe(storyKey("aramco's hq hit"));
});

test("the parser flags an item with no usable date instead of calling it new; reads dc:date", async () => {
  const { parseRssFeed } = await import("../../src/news");
  const xml = `<rss><channel>
    <item><title>No date story</title><link>u1</link></item>
    <item><title>Bad date story</title><link>u2</link><pubDate>sometime</pubDate></item>
    <item><title>DC date story</title><link>u3</link><dc:date>2026-10-13T23:22:00Z</dc:date></item>
  </channel></rss>`;
  const [a, b, c] = parseRssFeed(xml, "S");
  expect(a.dateKnown).toBe(false);
  expect(b.dateKnown).toBe(false);
  expect(c.dateKnown).toBeUndefined();
  expect(c.publishedAt).toBe("2026-10-13T23:22:00.000Z");
});
