import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySourceTier } from "../utils/newsScoring";

// Every feed configured in worker.ts's TRUSTED_RSS_FEEDS, with the tier it is
// meant to score at. A source that isn't matched by the tier table falls
// through to Tier 4, which halves its bullish/bearish magnitude and caps its
// confidence -- so a legitimate wire missing from the table is silently
// discounted to near-nothing. That is exactly the bug this guards: the Yahoo
// Finance feeds were added to the worker without being added to the tier
// table, and scored as unverified blogs until this test existed.
const CONFIGURED_FEEDS: { source: string; sampleUrl: string; expected: 1 | 2 | 3 }[] = [
  { source: "EIA - Today in Energy", sampleUrl: "https://www.eia.gov/todayinenergy/detail.php?id=1", expected: 1 },
  { source: "EIA - This Week in Petroleum", sampleUrl: "https://www.eia.gov/petroleum/weekly/", expected: 1 },
  { source: "EIA - Natural Gas Weekly", sampleUrl: "https://www.eia.gov/naturalgas/weekly/", expected: 1 },
  { source: "EIA - Press Releases", sampleUrl: "https://www.eia.gov/pressroom/releases/press1.php", expected: 1 },
  { source: "Yahoo Finance - WTI Crude", sampleUrl: "https://finance.yahoo.com/news/oil-rises-1.html", expected: 2 },
  { source: "Yahoo Finance - Natural Gas", sampleUrl: "https://finance.yahoo.com/news/gas-slips-2.html", expected: 2 },
  { source: "Yahoo Finance - Brent Crude", sampleUrl: "https://finance.yahoo.com/news/brent-3.html", expected: 2 },
  { source: "CNBC - Energy", sampleUrl: "https://www.cnbc.com/2026/09/08/oil.html", expected: 2 },
  { source: "MarketWatch - Market Pulse", sampleUrl: "https://www.marketwatch.com/story/oil-1", expected: 2 },
  { source: "MarketWatch - Real-time Headlines", sampleUrl: "https://www.marketwatch.com/story/oil-2", expected: 2 },
  { source: "MarketWatch - Top Stories", sampleUrl: "https://www.marketwatch.com/story/oil-3", expected: 2 },
  { source: "Trading Economics - News", sampleUrl: "https://tradingeconomics.com/articles/1", expected: 2 },
  { source: "Trading Economics - Crude Oil", sampleUrl: "https://tradingeconomics.com/commodity/crude-oil", expected: 2 },
  { source: "Trading Economics - Natural Gas", sampleUrl: "https://tradingeconomics.com/commodity/natural-gas", expected: 2 },
  { source: "Investing.com - Crude Oil", sampleUrl: "https://www.investing.com/news/commodities-news/1", expected: 3 },
  { source: "Investing.com - Natural Gas", sampleUrl: "https://www.investing.com/news/commodities-news/2", expected: 3 },
  { source: "Investing.com - Commodities", sampleUrl: "https://www.investing.com/news/commodities-news/3", expected: 3 },
  { source: "OilPrice.com", sampleUrl: "https://oilprice.com/Energy/Crude-Oil/1.html", expected: 3 },
  { source: "Rigzone", sampleUrl: "https://www.rigzone.com/news/1", expected: 3 },
  { source: "Natural Gas Intelligence", sampleUrl: "https://www.naturalgasintel.com/news/1", expected: 3 },
  { source: "Hellenic Shipping News", sampleUrl: "https://www.hellenicshippingnews.com/1", expected: 3 },
];

for (const feed of CONFIGURED_FEEDS) {
  test(`${feed.source} is classified Tier ${feed.expected}, not discounted as Tier 4`, () => {
    assert.equal(classifySourceTier(feed.source, feed.sampleUrl), feed.expected);
  });
}

test("a feed name alone is enough, even when the article carries no link", () => {
  // RSS items regularly arrive with an empty <link>; the source name has to
  // carry the classification on its own or the item silently drops to Tier 4.
  for (const feed of CONFIGURED_FEEDS) {
    assert.equal(classifySourceTier(feed.source, ""), feed.expected, `${feed.source} must classify from its name alone`);
  }
});

test("a genuinely unknown source still falls through to Tier 4", () => {
  assert.equal(classifySourceTier("Some Random Oil Blog", "https://randomoilblog.example/1"), 4);
});
