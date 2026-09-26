// Energy news: trusted RSS feeds plus NewsAPI, scored, clustered and cached.

import { clusterEvents, type NewsEvent, type RawNewsArticle, scoreArticles, type ScoredNewsArticle, stripPublisherSuffix } from "../frontend/src/utils/newsScoring";
import type { Env } from "./env";

// ---- News Based Trade AI: news + EIA inventory/storage + econ calendar ----
// The app must be fully useful with ZERO secrets configured: news comes
// from a curated allowlist of official/public RSS feeds by default, and
// NEWSAPI_KEY (when present) only ADDS to that feed, it never gates it.
// EIA_API_KEY/FRED_API_KEY unlock their own extra panels but their absence
// never breaks news or the rest of the page. Everything here fails
// gracefully per-source (never throws past its own function) and never
// fabricates a headline, price, or date -- a source that's down just
// contributes nothing rather than being backfilled with invented data.
// Series/release IDs below are EIA's and FRED's own documented identifiers.

export interface NewsFetchResult {
  available: boolean;
  articles: ScoredNewsArticle[];
  events: NewsEvent[];
  sourceStatus: { source: string; ok: boolean; count: number; error?: string }[];
  /** When the Cron last rebuilt this payload. Absent on an all-sources-down result. */
  builtAt?: string;
  error?: string;
}

// Only these exact, hand-verified official/public RSS endpoints are ever
// fetched -- the frontend can never submit an arbitrary URL for the Worker
// to fetch (no such endpoint exists), which closes off SSRF entirely.
// Deliberately spans more than one domain: eia.gov alone is a single point
// of failure (a WAF/bot-protection block on that one domain would silently
// zero out the entire feed, which is exactly what production showed --
// every eia.gov feed failing together), so oilprice.com is included as an
// independent Tier-3 fallback source.
// AI Flash's whole premise is that a headline reaches the trader while the
// move is still tradable, and the four EIA feeds below -- authoritative as
// they are -- publish on a government cadence (daily/weekly), so on their own
// they are structurally incapable of being fast. The fast market wires below
// are what actually make an intraday flash feed possible; EIA remains the
// Tier-1 anchor for accuracy. Every feed is independently optional: a source
// that 404s, rate-limits, or changes its URL contributes zero articles and
// reports its own failure in sourceStatus (surfaced on the AI Flash page), so
// a dead feed degrades the page rather than breaking it.
interface RssFeedConfig {
  url: string;
  source: string;
  /** Strip Google News's " - Publisher" headline suffix. See stripPublisherSuffix. */
  stripPublisherSuffix?: boolean;
}

const TRUSTED_RSS_FEEDS: RssFeedConfig[] = [
  // Tier 1 -- official/government. Slow but authoritative.
  { url: "https://www.eia.gov/rss/todayinenergy.xml", source: "EIA - Today in Energy" },
  { url: "https://www.eia.gov/rss/petroleum.xml", source: "EIA - This Week in Petroleum" },
  { url: "https://www.eia.gov/rss/natural_gas.xml", source: "EIA - Natural Gas Weekly" },
  { url: "https://www.eia.gov/rss/press_rss.xml", source: "EIA - Press Releases" },
  // Tier 2 -- major financial wires, the fast movers.
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=CL%3DF&region=US&lang=en-US", source: "Yahoo Finance - WTI Crude" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NG%3DF&region=US&lang=en-US", source: "Yahoo Finance - Natural Gas" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BZ%3DF&region=US&lang=en-US", source: "Yahoo Finance - Brent Crude" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19836134", source: "CNBC - Energy" },
  // MarketWatch is Dow Jones-owned and carries the same "Market Talk" desk
  // copy that shows up on broker terminals, which is the closest a free feed
  // gets to Dow Jones Newswires itself (a licensed, paywalled wire).
  { url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", source: "MarketWatch - Market Pulse" },
  { url: "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/", source: "MarketWatch - Real-time Headlines" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch - Top Stories" },
  // Trading Economics publishes an RSS index at /rss/feeds.aspx; these are its
  // documented news endpoints. If the query-string form is wrong they simply
  // report as down in the page's source-health panel rather than breaking it.
  { url: "https://tradingeconomics.com/rss/news.aspx", source: "Trading Economics - News" },
  { url: "https://tradingeconomics.com/rss/news.aspx?i=crude+oil", source: "Trading Economics - Crude Oil" },
  { url: "https://tradingeconomics.com/rss/news.aspx?i=natural+gas", source: "Trading Economics - Natural Gas" },
  // Reuters retired its public RSS feeds in 2020 and offers no free
  // replacement; the remaining options are paid third-party feed generators
  // (an extra dependency and an extra point of failure in the hot path) or
  // Google News, which is itself a free public RSS endpoint and indexes
  // Reuters within minutes. site: narrows it to Reuters only, when:2d bounds
  // it to the same 48h window the scorer already discards past.
  {
    url: "https://news.google.com/rss/search?q=%28oil+OR+crude+OR+WTI+OR+Brent+OR+OPEC%29+site%3Areuters.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Reuters - Oil (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22natural+gas%22+OR+LNG+OR+%22Henry+Hub%22%29+site%3Areuters.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Reuters - Natural Gas (via Google News)",
    stripPublisherSuffix: true,
  },
  { url: "https://www.investing.com/rss/commodities_Oil.rss", source: "Investing.com - Crude Oil" },
  { url: "https://www.investing.com/rss/commodities_Gas.rss", source: "Investing.com - Natural Gas" },
  { url: "https://www.investing.com/rss/news_11.rss", source: "Investing.com - Commodities" },
  // Tier 3 -- energy trade press. Often first on outages/pipeline/LNG news.
  { url: "https://oilprice.com/rss/main", source: "OilPrice.com" },
  { url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", source: "Rigzone" },
  { url: "https://www.naturalgasintel.com/feed/", source: "Natural Gas Intelligence" },
  { url: "https://www.hellenicshippingnews.com/feed/", source: "Hellenic Shipping News" },
  { url: "https://worldoil.com/rss?feed=news", source: "World Oil" },
  { url: "https://www.spglobal.com/commodity-insights/en/news-research/rss-feed", source: "S&P Global Commodity Insights" },
  { url: "https://www.offshore-energy.biz/feed/", source: "Offshore Energy" },
  { url: "https://lngprime.com/feed/", source: "LNG Prime" },
  { url: "https://www.naturalgasworld.com/rss", source: "Natural Gas World" },
  { url: "https://www.opec.org/opec_web/en/press_room/28.htm?rss=1", source: "OPEC - Press Releases" },

  // ---------------------------------------------------------------------
  // Aggregated topic feeds. These matter more than they look.
  //
  // Most energy trade sites either never published RSS, moved it, or sit
  // behind bot protection that answers a datacentre IP with a 403 -- which
  // is indistinguishable from a dead URL from in here. Google News is a
  // single well-known endpoint that indexes ALL of those publishers within
  // minutes, so one feed that works is worth more than six site feeds that
  // might not. The site:-restricted ones below name the publishers the
  // trader specifically asked for; the unrestricted ones are the safety net
  // that keeps the page populated even when every direct feed is blocked.
  //
  // when:1d bounds each query to the last 24h, inside the 48h window the
  // scorer already discards past, so nothing stale is pulled in.
  // ---------------------------------------------------------------------
  {
    url: "https://news.google.com/rss/search?q=%28%22crude+oil%22+OR+WTI+OR+Brent+OR+OPEC%29+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Crude Oil headlines (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22natural+gas%22+OR+LNG+OR+%22Henry+Hub%22%29+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Natural Gas headlines (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22crude+inventories%22+OR+%22oil+inventories%22+OR+%22gas+storage%22+OR+EIA%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Inventory & storage (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aoilprice.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "OilPrice.com (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aworldoil.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "World Oil (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aspglobal.com+%28oil+OR+gas+OR+LNG+OR+crude%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "S&P Global (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22Strait+of+Hormuz%22+OR+%22Red+Sea%22+OR+sanctions+OR+refinery+OR+pipeline%29+%28oil+OR+gas%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Supply disruption watch (via Google News)",
    stripPublisherSuffix: true,
  },
];

// Per-feed item cap. An aggregator feed can return 100 items; parsing and
// scoring all of them across ~35 feeds is CPU this Worker does not have.
// The scorer sorts by recency anyway, so the tail is discarded regardless.
const MAX_ITEMS_PER_FEED = 25;
// Tightened from 8s: with a wider feed list these run in parallel, so the
// slowest single feed sets the floor on how fast a flash can surface.
const RSS_FETCH_TIMEOUT_MS = 6000;

function xmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// Minimal, tolerant RSS 2.0 / Atom item extractor -- Workers have no DOM
// parser, and pulling in a full XML library for this would be overkill.
// Regex-based on purpose: malformed/partial XML just yields fewer or zero
// matched items rather than throwing, which is exactly the "never crash
// the whole dashboard on a bad feed" behavior this needs.
function parseRssFeed(xml: string, sourceName: string, stripSuffix = false): RawNewsArticle[] {
  const items: RawNewsArticle[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!title) continue;
    const desc = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    const link =
      block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ??
      block.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const pubDate = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? block.match(/<(?:published|updated)\b[^>]*>([\s\S]*?)<\/(?:published|updated)>/i)?.[1] ?? "";
    const parsedDate = pubDate ? new Date(pubDate) : new Date();
    const cleanTitle = xmlUnescape(title);
    items.push({
      headline: stripSuffix ? stripPublisherSuffix(cleanTitle) : cleanTitle,
      summary: xmlUnescape(desc).slice(0, 400),
      source: sourceName,
      publishedAt: Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
      url: xmlUnescape(link),
    });
  }
  return items;
}

async function fetchOneRssFeed(feed: RssFeedConfig): Promise<{ source: string; ok: boolean; count: number; error?: string; articles: RawNewsArticle[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
    // A generic-looking, standards-compliant browser UA -- some public feeds
    // sit behind bot-protection that blocks unfamiliar/non-browser UA
    // strings outright, which reads identically to a dead URL from here
    // (both come back non-ok) unless the UA itself is ruled out first.
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { source: feed.source, ok: false, count: 0, error: `HTTP ${res.status} ${res.statusText}`.trim(), articles: [] };
    const xml = await res.text();
    const articles = parseRssFeed(xml, feed.source, feed.stripPublisherSuffix === true).slice(0, MAX_ITEMS_PER_FEED);
    return { source: feed.source, ok: true, count: articles.length, articles };
  } catch (e: any) {
    return { source: feed.source, ok: false, count: 0, error: e?.name === "AbortError" ? "Timed out" : (e?.message ?? "Fetch failed"), articles: [] };
  }
}

async function fetchNewsApiArticles(apiKey: string): Promise<{ source: string; ok: boolean; count: number; error?: string; articles: RawNewsArticle[] }> {
  const ENERGY_NEWS_QUERY =
    '(crude OR "oil price" OR OPEC OR "natural gas" OR "Henry Hub" OR WTI OR Brent OR "Strait of Hormuz" OR "Red Sea" OR pipeline OR refinery OR "EIA storage" OR "EIA inventory") AND (oil OR gas OR energy OR crude)';
  try {
    const usp = new URLSearchParams({ q: ENERGY_NEWS_QUERY, language: "en", sortBy: "publishedAt", pageSize: "40" });
    const res = await fetch(`https://newsapi.org/v2/everything?${usp.toString()}`, { headers: { "X-Api-Key": apiKey, "User-Agent": "KumarSignalsPro/1.0" } });
    if (!res.ok) return { source: "NewsAPI", ok: false, count: 0, error: `HTTP ${res.status}`, articles: [] };
    const json: any = await res.json();
    const articles: RawNewsArticle[] = (json?.articles ?? [])
      .filter((a: any) => a?.title && a.title !== "[Removed]")
      .map((a: any) => ({
        headline: a.title as string,
        summary: (a.description ?? "") as string,
        source: (a.source?.name ?? "Unknown") as string,
        publishedAt: (a.publishedAt ?? new Date().toISOString()) as string,
        url: (a.url ?? "") as string,
      }));
    return { source: "NewsAPI (additive)", ok: true, count: articles.length, articles };
  } catch (e: any) {
    return { source: "NewsAPI (additive)", ok: false, count: 0, error: e.message ?? "Fetch failed", articles: [] };
  }
}

// 60s is Cloudflare KV's hard minimum for expirationTtl -- anything lower is
// rejected outright -- so this is as fresh as a KV-cached feed can legally be,
// which is what AI Flash wants. The key is versioned because the feed list
// above changed: a v2 payload cached from the old five-source list would
// otherwise keep serving until it aged out.
// The Cron fires every 5 minutes and refreshes this, so a 30-minute TTL keeps
// the key warm with a wide safety margin while a request-path rebuild becomes
// the rare exception rather than the norm.
//
// WHY THIS IS NOT 60 SECONDS ANY MORE. A 60s TTL meant a browser polling the
// news was, most minutes, the thing that paid for rebuilding it: ~35 parallel
// feed fetches plus regex-parsing every one of their XML bodies, inside a
// request that gets 10ms of CPU on this plan. That is how a news page ends up
// showing nothing -- not because the feeds are dead, but because the request
// rebuilding them runs out of CPU and fails. It also wrote KV ~1,440 times a
// day against a 1,000/day free limit. Cron-warming at 5 minutes costs ~288
// writes a day and moves the expensive part somewhere it has room to run.
const NEWS_CACHE_TTL_SECONDS = 30 * 60;
const NEWS_CACHE_KV_KEY = "news:combined:v6";

/**
 * Rebuilds the news cache from every feed. Expensive by nature -- call it
 * from scheduled(), not from a request, unless the cache is genuinely empty.
 */
async function buildEnergyNews(env: Env): Promise<NewsFetchResult> {
  const rssResults = await Promise.all(TRUSTED_RSS_FEEDS.map(fetchOneRssFeed));
  const sourceStatus = rssResults.map(({ articles, ...status }) => status);
  const rawArticles: RawNewsArticle[] = rssResults.flatMap((r) => r.articles);

  if (env.NEWSAPI_KEY) {
    const napi = await fetchNewsApiArticles(env.NEWSAPI_KEY);
    sourceStatus.push({ source: napi.source, ok: napi.ok, count: napi.count, error: napi.error });
    rawArticles.push(...napi.articles);
  }

  const anySourceOk = sourceStatus.some((s) => s.ok);
  if (!anySourceOk) {
    const result: NewsFetchResult = { available: false, articles: [], events: [], sourceStatus, error: "All news sources are temporarily unavailable" };
    return result;
  }

  // De-dupe identical URLs (the same wire story often appears verbatim
  // across two of our own RSS feeds) before scoring/clustering.
  const seenUrls = new Set<string>();
  const deduped = rawArticles.filter((a) => {
    const key = a.url || a.headline;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  const now = Date.now();
  const scored = scoreArticles(deduped, now).filter((a) => now - new Date(a.publishedAt).getTime() < 48 * 60 * 60 * 1000);
  const events = clusterEvents(scored);
  const result: NewsFetchResult = { available: true, articles: scored, events, sourceStatus, builtAt: new Date(now).toISOString() };
  await env.COMMODITY_KV.put(NEWS_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: NEWS_CACHE_TTL_SECONDS });
  return result;
}

/**
 * What every request path calls. Reads the cache the Cron keeps warm and only
 * rebuilds inline when there is genuinely nothing cached (first request after
 * a deploy, or after a 30-minute gap in Cron delivery) -- so the 10ms-CPU
 * request path almost never does the expensive work.
 */
export async function fetchEnergyNews(env: Env): Promise<NewsFetchResult> {
  const cached = await env.COMMODITY_KV.get(NEWS_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as NewsFetchResult;
    } catch {
      // fall through and rebuild on a corrupt cache entry
    }
  }
  return buildEnergyNews(env);
}

/**
 * Cron entry point. Refreshes the news cache every tick so the feeds are at
 * most ~5 minutes old and no browser request ever pays to rebuild them.
 * Failures are swallowed: a bad tick leaves the previous cache in place.
 */
export async function warmEnergyNews(env: Env): Promise<void> {
  try {
    await buildEnergyNews(env);
  } catch {
    // A failed warm is not worth failing the whole Cron run for -- the
    // previous cached payload keeps serving until the next tick.
  }
}
