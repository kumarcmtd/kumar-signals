// GPT News macro backdrop (dollar, rates, gold) and the "Why Today"
// plain-language read.

import { resolvePrevClose } from "../frontend/src/utils/globalMarketHours";
import type { ScoredNewsArticle } from "../frontend/src/utils/newsScoring";
import { classifyNewsDuration, leanFromScore, type WhyCommodity, type WhyDriver } from "../frontend/src/utils/whyTodaySummary";
import { type Env, r2 } from "./env";
import { fetchEnergyNews } from "./news";

// ---- GPT News macro backdrop (dollar, rates, gold) ----
// GPT News asks for the macro context that sits behind every energy move:
// USD/INR (what an MCX rupee contract actually settles in), the dollar index
// and US 10-year yield (both push dollar-priced commodities around), and gold
// as the other big risk-sentiment commodity. These are DELIBERATELY a separate
// endpoint from /api/global-markets rather than extra entries in
// GLOBAL_INSTRUMENTS -- the Global Markets page renders every quote that route
// returns, so adding rows there would silently redesign an existing page.
//
// Same public Yahoo chart endpoint as the energy benchmarks, but over a 1-month
// daily range so each card can draw a REAL sparkline from actual closes. No
// point is ever interpolated or invented; a series that comes back short just
// draws a shorter line.
const MACRO_INSTRUMENTS: { symbol: string; name: string; short: string; unit: "usd" | "inr" | "index" | "pct" }[] = [
  { symbol: "INR=X", name: "US Dollar / Indian Rupee", short: "USD/INR", unit: "inr" },
  { symbol: "DX-Y.NYB", name: "US Dollar Index", short: "DXY", unit: "index" },
  { symbol: "GC=F", name: "Gold (COMEX)", short: "Gold", unit: "usd" },
  { symbol: "^TNX", name: "US 10-Year Treasury Yield", short: "US 10Y", unit: "pct" },
];

interface MacroQuote {
  symbol: string;
  name: string;
  short: string;
  unit: "usd" | "inr" | "index" | "pct";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Real daily closes, oldest first -- for the sparkline. Never synthesized. */
  spark: number[];
  asOf: string | null;
  error?: string;
}

const MACRO_CACHE_TTL_SECONDS = 120;
const MACRO_CACHE_KV_KEY = "gptnews:macro:v1";

async function getYahooMacroQuote(inst: (typeof MACRO_INSTRUMENTS)[number]): Promise<MacroQuote> {
  const base: MacroQuote = { ...inst, price: null, change: null, changePercent: null, spark: [], asOf: null };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KumarSignalsPro/1.0)", Accept: "application/json" } });
  if (!res.ok) return { ...base, error: `Yahoo Finance returned ${res.status}` };
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    return { ...base, error: json?.chart?.error?.description || "No quote data returned" };
  }
  const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((c: any) => typeof c === "number");
  const price = meta.regularMarketPrice;
  const prevClose = resolvePrevClose({
    previousClose: typeof meta.previousClose === "number" ? meta.previousClose : null,
    secondLastDailyClose: closes.length >= 2 ? closes[closes.length - 2] : null,
    chartPreviousClose: typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null,
  });
  return {
    ...base,
    price: r2(price),
    change: prevClose !== null ? r2(price - prevClose) : null,
    changePercent: prevClose ? r2(((price - prevClose) / prevClose) * 100) : null,
    spark: closes.slice(-30).map((c) => r2(c)),
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

export async function computeMacroMarkets(env: Env): Promise<{ quotes: MacroQuote[]; fetchedAt: string }> {
  const cached = await env.COMMODITY_KV.get(MACRO_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as { quotes: MacroQuote[]; fetchedAt: string };
    } catch {
      // fall through and refetch
    }
  }
  const quotes = await Promise.all(
    MACRO_INSTRUMENTS.map(async (inst) => {
      try {
        return await getYahooMacroQuote(inst);
      } catch (e: any) {
        return { ...inst, price: null, change: null, changePercent: null, spark: [], asOf: null, error: e.message ?? "fetch failed" } as MacroQuote;
      }
    })
  );
  const payload = { quotes, fetchedAt: new Date().toISOString() };
  // Only cache a generation that actually carries data -- caching an all-failed
  // response would pin the page to "unavailable" for the full TTL.
  if (quotes.some((q) => q.price !== null)) {
    await env.COMMODITY_KV.put(MACRO_CACHE_KV_KEY, JSON.stringify(payload), { expirationTtl: MACRO_CACHE_TTL_SECONDS });
  }
  return payload;
}

// ---- "Why Today": a grounded, plain-language read of why crude / NG is
// moving, built from the SAME scored news the News AI page uses. The drivers
// (real headlines) and the direction/duration are deterministic; the AI only
// writes the prose, strictly from those headlines -- it can never introduce an
// event, price, or number that isn't in the fetched news.
const WHYTODAY_CACHE_KV_KEY = "whytoday:v1";
const WHYTODAY_CACHE_TTL_SECONDS = 300;

function buildWhyDrivers(articles: ScoredNewsArticle[], market: "CRUDE" | "NG"): { drivers: WhyDriver[]; leanScore: number; rules: string[] } {
  const relevant = articles
    .filter((a) => a.affectedMarket === market || a.affectedMarket === "BOTH")
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);
  const drivers: WhyDriver[] = relevant.map((a) => ({
    headline: a.headline,
    source: a.source,
    url: a.url,
    impact: leanFromScore(a.impactScale),
    timeImpact: a.timeImpact,
  }));
  const leanScore = Number(relevant.reduce((s, a) => s + a.impactScale, 0).toFixed(2));
  const rules = relevant.flatMap((a) => a.matchedRules);
  return { drivers, leanScore, rules };
}

async function aiWhySummaries(env: Env, crude: WhyDriver[], ng: WhyDriver[]): Promise<{ crude: string; naturalGas: string }> {
  if (!crude.length && !ng.length) return { crude: "", naturalGas: "" };
  const fmt = (d: WhyDriver[]) => (d.length ? d.map((x) => `- [${x.impact}] "${x.headline}" (${x.source})`).join("\n") : "(no relevant headlines)");
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are an energy market analyst. You are given REAL, already-fetched news headlines about crude oil and natural gas. Summarize ONLY what these headlines say -- NEVER invent an event, price, number, or cause that is not present in them. For each commodity give a 2-3 sentence plain-English summary of why the market is moving today, based only on the headlines provided. If a commodity has no relevant headlines, say exactly that its move looks technical/positioning with no major news catalyst. Reply with ONLY a single JSON object of the form {\"crude\":\"...\",\"naturalGas\":\"...\"}, no markdown.",
        },
        { role: "user", content: `CRUDE OIL headlines:\n${fmt(crude)}\n\nNATURAL GAS headlines:\n${fmt(ng)}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    const raw = (result as { response?: unknown }).response;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw as { crude?: string; naturalGas?: string });
    return { crude: typeof obj?.crude === "string" ? obj.crude : "", naturalGas: typeof obj?.naturalGas === "string" ? obj.naturalGas : "" };
  } catch {
    return { crude: "", naturalGas: "" }; // the deterministic drivers still stand on their own
  }
}

function assembleWhyCommodity(drivers: WhyDriver[], leanScore: number, rules: string[], aiSummary: string): WhyCommodity {
  const duration = classifyNewsDuration(rules);
  return {
    available: drivers.length > 0,
    lean: leanFromScore(leanScore),
    leanScore,
    drivers,
    aiSummary,
    durationRead: duration.read,
    durationWhy: duration.why,
  };
}

export async function computeWhyToday(env: Env): Promise<{ crude: WhyCommodity; naturalGas: WhyCommodity; newsAvailable: boolean; fetchedAt: string }> {
  const cached = await env.COMMODITY_KV.get(WHYTODAY_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // refetch on a corrupt entry
    }
  }
  const news = await fetchEnergyNews(env);
  const cl = buildWhyDrivers(news.articles, "CRUDE");
  const ng = buildWhyDrivers(news.articles, "NG");
  const ai = news.available ? await aiWhySummaries(env, cl.drivers, ng.drivers) : { crude: "", naturalGas: "" };

  const out = {
    crude: assembleWhyCommodity(cl.drivers, cl.leanScore, cl.rules, ai.crude),
    naturalGas: assembleWhyCommodity(ng.drivers, ng.leanScore, ng.rules, ai.naturalGas),
    newsAvailable: news.available,
    fetchedAt: new Date().toISOString(),
  };
  await env.COMMODITY_KV.put(WHYTODAY_CACHE_KV_KEY, JSON.stringify(out), { expirationTtl: WHYTODAY_CACHE_TTL_SECONDS });
  return out;
}
