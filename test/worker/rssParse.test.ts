// The faster RSS parser must produce exactly what the old one did.
import { expect, test } from "vitest";
import { parseRssFeed, xmlUnescape } from "../../src/news";
import { stripPublisherSuffix } from "../../frontend/src/utils/newsScoring";

// ---- The original implementation, verbatim, as the reference ---------------
function oldXmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}
function oldParse(xml: string, sourceName: string, stripSuffix = false) {
  const items: unknown[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!title) continue;
    const desc = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    const link = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? block.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const pubDate = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? block.match(/<(?:published|updated)\b[^>]*>([\s\S]*?)<\/(?:published|updated)>/i)?.[1] ?? "";
    const parsedDate = pubDate ? new Date(pubDate) : new Date();
    const cleanTitle = oldXmlUnescape(title);
    items.push({
      headline: stripSuffix ? stripPublisherSuffix(cleanTitle) : cleanTitle,
      summary: oldXmlUnescape(desc).slice(0, 400),
      source: sourceName,
      publishedAt: Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
      url: oldXmlUnescape(link),
    });
  }
  return items;
}

const TRICKY = [
  "plain text",
  "<![CDATA[Crude <b>jumps</b> &amp; gas falls]]>",
  "Tom &amp; Jerry",
  "&amp;lt;not a tag&amp;gt;",
  "&lt;b&gt;encoded bold&lt;/b&gt; and &quot;quotes&quot; and it&#39;s &apos;fine&apos;",
  "  <p>Para one</p><ul><li>list</li></ul> &amp;amp; ",
  "",
];

test("xmlUnescape matches the chained-replace original on tricky input", () => {
  for (const s of TRICKY) expect(xmlUnescape(s)).toBe(oldXmlUnescape(s));
});

function rss(n: number, extra = ""): string {
  const items = Array.from({ length: n }, (_, i) =>
    i === 3
      ? `<item><description>no title here</description></item>` // skipped, must not count
      : `<item><title>${TRICKY[i % TRICKY.length] || "Oil " + i} ${i} - Reuters</title><link>https://e.com/${i}?a=1&amp;b=2</link>` +
        `<pubDate>Wed, 23 Sep 2026 0${i % 9}:00:00 GMT</pubDate><description>${"&lt;p&gt;" + "word ".repeat(150) + i + "&lt;/p&gt;"}</description></item>`
  ).join("");
  return `<?xml version="1.0"?><rss><channel>${extra}${items}</channel></rss>`;
}
const atom = (n: number) =>
  `<feed>${Array.from({ length: n }, (_, i) => `<entry><title>Atom ${i}</title><link href="https://a.com/${i}"/><updated>2026-09-2${i % 9}T10:00:00Z</updated><summary>Sum &amp; ${i}</summary></entry>`).join("")}</feed>`;

test("RSS feeds over the 25-item cap: identical first 25, title-less items skipped", () => {
  for (const n of [0, 5, 25, 26, 60, 100]) {
    const xml = rss(n);
    expect(parseRssFeed(xml, "S", true, 25)).toEqual(oldParse(xml, "S", true).slice(0, 25));
    expect(parseRssFeed(xml, "S", false, 25)).toEqual(oldParse(xml, "S", false).slice(0, 25));
  }
});

test("Atom feeds (entry/summary/href) parse identically", () => {
  for (const n of [1, 30]) expect(parseRssFeed(atom(n), "A", false, 25)).toEqual(oldParse(atom(n), "A").slice(0, 25));
});

test("with no limit, every item is returned as before", () => {
  expect(parseRssFeed(rss(40), "S")).toEqual(oldParse(rss(40), "S"));
});

// ---- istHourOfStamp fast path == the original regex --------------------------
import { istHourOfStamp } from "../../src/gapStudy";
function oldIstHour(date: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}
test("istHourOfStamp matches the regex on normal and malformed stamps", () => {
  const cases = [
    "2026-09-23T09:30:00+05:30", "2026-09-23T23:55:00+05:30", "2026-09-23T00:00:00Z", "2026-09-23T1:30:00",
    "2026-09-23 09:30", "garbageT12:34", "2026-09-23TAB:CD", "", "T", "2026-09-23T09:3",
  ];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 7) cases.push(`2026-01-0${(h % 9) + 1}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
  for (const c of cases) expect(istHourOfStamp(c)).toBe(oldIstHour(c));
});

// ---- Cached formatters give the same labels and events ----------------------
import { istLabelOf, scheduledEvents } from "../../frontend/src/utils/timeProfileEngine";
test("istLabelOf and scheduledEvents match toLocaleTimeString / the uncached weekday", () => {
  const start = Date.UTC(2026, 0, 1);
  for (let t = start; t < start + 400 * 86_400_000; t += 86_400_000 * 0.37) {
    expect(istLabelOf(t)).toBe(`${new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`);
    for (const e of scheduledEvents(t)) {
      const at = Date.parse(e.atIso);
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(at));
      expect(wd).toBe(e.id === "eia-crude" ? "Wed" : "Thu");
      expect(at).toBeGreaterThan(t);
      expect(at - t).toBeLessThanOrEqual(7 * 86_400_000);
    }
  }
});
