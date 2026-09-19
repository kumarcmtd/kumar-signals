// Ai-News -- every news feature in the app, on one page, with the chart's
// opinion attached.
//
// This replaces four separate news pages (GPT News, AI Flash, News Based Trade
// AI, Claude News) as the one place to look. Those routes still work; they are
// simply no longer four different answers to the same question.
//
// WHY ONE PAGE IS ALSO THE CHEAPER PAGE. Each of the old pages opened its own
// set of queries and polled on its own clock. One page means one shared news
// query, one shared chart read, and one poll -- and every piece of analysis
// below runs IN THE BROWSER over data already fetched, so this adds no Worker
// CPU (the free plan allows 10ms per request) and no extra upstream calls.
//
// The headline feature is the combined verdict: news and chart together, with
// an explicit "they disagree, wait" state rather than picking the more
// exciting of the two.

import { useMemo, useState } from "react";
import {
  Newspaper, RefreshCw, Radio, Activity, Server, ChevronDown, ChevronUp,
  ExternalLink, Target,
} from "lucide-react";
import { useNewsFeed, useNewsTrade, useMarketStatus, usePullback } from "../api/hooks";
import {
  computeTilt, rankMovers, breakingSince, bucketThemes, summariseSourceHealth, readFreshness, relativeAge,
  type NewsCommodity,
} from "../utils/claudeNewsAnalytics";
import { analyzeFlash } from "../utils/aiFlashEngine";
import { EiaPanel, EconCalendarCardV2, TopEventsList } from "../components/NewsDashboardKit";
import { NewsTradeDecisionCard } from "../components/NewsTradeDecisionCard";
import { useNewsTradeAI } from "../hooks/useNewsTradeAI";
import type { NewsTradeSymbol } from "../utils/newsTradeEngine";
import type { ScoredNewsArticle } from "../utils/newsScoring";
import type { InstrumentSymbol } from "../types";

const SYMBOLS: { key: InstrumentSymbol; news: NewsCommodity; label: string; short: string }[] = [
  { key: "CRUDEOIL", news: "CRUDE", label: "Crude Oil", short: "Crude" },
  { key: "NATURALGAS", news: "NG", label: "Natural Gas", short: "Gas" },
];

const TIER_LABEL: Record<number, string> = { 1: "Official", 2: "Major wire", 3: "Trade press", 4: "Other" };

function impactChip(impactScale: number) {
  if (impactScale >= 2) return { text: "Bullish", bg: "#DCFCE7", ink: "#15803D" };
  if (impactScale > 0.5) return { text: "Mildly bullish", bg: "#F0FDF4", ink: "#16A34A" };
  if (impactScale <= -2) return { text: "Bearish", bg: "#FEE2E2", ink: "#B91C1C" };
  if (impactScale < -0.5) return { text: "Mildly bearish", bg: "#FEF2F2", ink: "#DC2626" };
  return { text: "Neutral", bg: "#F1F5F9", ink: "#64748B" };
}

function TiltBar({ score, sampleSize }: { score: number; sampleSize: number }) {
  const ink = score > 5 ? "#15803D" : score < -5 ? "#B91C1C" : "#64748B";
  const pos = ((score + 100) / 200) * 100;
  return (
    <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg,#FEE2E2,#F1F5F9,#DCFCE7)" }}>
      <div className="absolute top-0 bottom-0 w-[1px] bg-slate-300" style={{ left: "50%" }} />
      {sampleSize > 0 && (
        <div
          className="absolute -top-[3px] h-[14px] w-[3px] rounded-full"
          style={{ left: `${pos}%`, transform: "translateX(-50%)", background: ink, transition: "left 600ms ease-out" }}
        />
      )}
    </div>
  );
}

function ArticleRow({ article, now }: { article: ScoredNewsArticle; now: number }) {
  const chip = impactChip(article.impactScale);
  return (
    <a href={article.url || undefined} target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 border-b last:border-b-0 border-slate-100 active:bg-slate-50">
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md" style={{ background: chip.bg, color: chip.ink }}>{chip.text}</span>
        <span className="text-[9px] font-bold text-slate-500">
          {article.affectedMarket === "BOTH" ? "Crude + Gas" : article.affectedMarket === "CRUDE" ? "Crude" : "Gas"}
        </span>
        <span className="text-[9px] text-slate-400">· {TIER_LABEL[article.sourceTier] ?? "Other"}</span>
        <span className="text-[9px] text-slate-400 ml-auto tabular-nums">{relativeAge(article.publishedAt, now)}</span>
      </div>
      <p className="text-[11.5px] font-bold text-slate-800 leading-snug">{article.headline}</p>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[9px] text-slate-400 truncate">{article.source}</span>
        {article.url && <ExternalLink size={9} className="text-slate-300 shrink-0" />}
      </div>
    </a>
  );
}

export function AiNews() {
  const [symbolKey, setSymbolKey] = useState<InstrumentSymbol>("CRUDEOIL");
  const [showSources, setShowSources] = useState(false);

  const active = SYMBOLS.find((s) => s.key === symbolKey) ?? SYMBOLS[0];

  // One shared news query for the whole page -- this used to be four pages
  // each opening their own.
  const feed = useNewsFeed();
  // /news-trade already carries the EIA payload and the economic calendar, so
  // there is no separate energy query here -- one fetch, both panels.
  const newsTrade = useNewsTrade();
  const status = useMarketStatus();
  // Confirmation / invalidation levels. Already memoised on the Worker and
  // shared with the six main tabs, so this is effectively free.
  const pullback = usePullback(symbolKey);
  // The Final Decision engine: news, technical, momentum, options and
  // liquidity combined into one weighted score. Reuses the candle, options and
  // depth queries other pages already open rather than adding its own.
  const decision = useNewsTradeAI(symbolKey as NewsTradeSymbol);

  const articles = useMemo(() => feed.data?.articles ?? [], [feed.data]);
  const now = useMemo(() => Date.now(), [feed.dataUpdatedAt]);

  const crudeTilt = useMemo(() => computeTilt(articles, "CRUDE", now), [articles, now]);
  const ngTilt = useMemo(() => computeTilt(articles, "NG", now), [articles, now]);

  const flash = useMemo(() => analyzeFlash(articles, active.news, now), [articles, active.news, now]);
  const movers = useMemo(() => rankMovers(articles, active.news, 12, now), [articles, active.news, now]);
  const breaking = useMemo(() => breakingSince(articles, 60, now), [articles, now]);
  const themes = useMemo(() => bucketThemes(articles, active.news, now), [articles, active.news, now]);
  const health = useMemo(() => summariseSourceHealth(feed.data?.sourceStatus ?? []), [feed.data]);
  const freshness = useMemo(() => readFreshness(articles, now), [articles, now]);

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center gap-2">
        <Newspaper size={20} className="text-indigo-600" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-black leading-none text-slate-900">Ai-News</h1>
          <p className="text-[9.5px] text-slate-500 mt-0.5">News, impact and the chart's opinion — in one place</p>
        </div>
        <button
          type="button"
          onClick={() => { feed.refetch(); pullback.refetch(); newsTrade.refetch(); }}
          disabled={feed.isFetching}
          className="shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-black flex items-center gap-1 disabled:opacity-50"
          style={{ background: "var(--color-surface-soft)", color: "#475569" }}
        >
          <RefreshCw size={11} className={feed.isFetching ? "motion-safe:animate-spin" : ""} />
          Update
        </button>
      </header>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSymbolKey(s.key)}
            className="flex-1 py-2 rounded-xl text-[11.5px] font-black"
            style={symbolKey === s.key ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Freshness before anything else -- stale news presented as news is the
          failure this whole area of the app was rebuilt to stop. */}
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-2"
        style={{ background: freshness.stale ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${freshness.stale ? "#FECACA" : "#BBF7D0"}` }}
      >
        <Radio size={13} className="shrink-0" style={{ color: freshness.stale ? "#B91C1C" : "#15803D" }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-black" style={{ color: freshness.stale ? "#B91C1C" : "#15803D" }}>{freshness.label}</p>
          <p className="text-[9px] text-slate-500">
            {freshness.withinLastHour} in the last hour · {freshness.withinLastSixHours} in the last 6h · {freshness.older} older
            {status.data ? ` · MCX ${status.data.isOpen ? "open" : "closed"}` : ""}
          </p>
        </div>
      </div>

      {feed.isLoading && <div className="h-32 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />}

      {feed.error && (
        <div className="rounded-2xl px-3 py-2.5 bg-red-50 border border-red-200">
          <p className="text-[11.5px] font-black text-red-700">Couldn't load the news feed</p>
          <p className="text-[10px] text-red-700/80 mt-0.5">{(feed.error as Error).message}</p>
        </div>
      )}

      {feed.data && !feed.data.available && (
        <div className="rounded-2xl px-3 py-2.5 bg-amber-50 border border-amber-200">
          <p className="text-[11.5px] font-black text-amber-800">Every news source is currently unreachable</p>
          <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
            {feed.data.error ?? "No source answered."} Open Source health below — that list is what gets the dead feeds replaced.
          </p>
        </div>
      )}

      {/* ---- THE VERDICT ----
          Five weighted inputs -- news, technical, momentum, options and
          liquidity -- combined into one score, with an explicit WAIT state when
          they conflict. Any input that is unavailable says so on its own row
          rather than quietly scoring zero and dragging the total toward
          neutral. */}
      <section>
        <h2 className="text-[13px] font-black text-slate-800 mb-1.5">The read on {active.label}</h2>
        <NewsTradeDecisionCard result={decision.result} label={`${active.label} Final Decision`} />

        {/* The levels that would confirm or kill it. The decision card scores
            the evidence; this says what price has to do about it. */}
        {pullback.data && (
          <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5 mt-2">
            <p className="text-[10px] font-black text-slate-700 flex items-center gap-1.5">
              <Target size={12} className="text-indigo-500" />
              Levels to watch
            </p>
            <div className="mt-1.5 space-y-1">
              <p className="text-[10px] text-slate-600 leading-snug">
                <span className="font-bold text-emerald-700">Confirms up:</span> {pullback.data.bullishConfirmation}
              </p>
              <p className="text-[10px] text-slate-600 leading-snug">
                <span className="font-bold text-rose-700">Confirms down:</span> {pullback.data.bearishConfirmation}
              </p>
              <p className="text-[10px] text-slate-600 leading-snug">
                <span className="font-bold text-amber-700">Wrong if:</span> {pullback.data.invalidation}
              </p>
            </div>
          </div>
        )}

        {decision.candlesError && (
          <p className="text-[9.5px] text-amber-700 mt-1.5 leading-snug">
            Price data unavailable ({decision.candlesError}), so the technical, momentum, options and liquidity rows above are not scored. The news side is unaffected.
          </p>
        )}
        <p className="text-[9px] text-slate-400 mt-1.5 leading-snug px-0.5">
          A reading of current conditions, not a prediction. A high score means the evidence currently agrees — it is never a chance of profit, and conditions can change fast.
        </p>
      </section>

      {/* ---- Both tilt meters ---- */}
      <section className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-3 space-y-3">
        <h2 className="text-[13px] font-black text-slate-800">Which way is the news leaning?</h2>
        {[{ tilt: crudeTilt, name: "Crude Oil" }, { tilt: ngTilt, name: "Natural Gas" }].map(({ tilt, name }) => {
          const ink = tilt.direction === "bullish" ? "#15803D" : tilt.direction === "bearish" ? "#B91C1C" : "#64748B";
          return (
            <div key={name}>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className="text-[11px] font-black" style={{ color: ink }}>{tilt.label}</p>
                <span className="text-[12px] font-black tabular-nums shrink-0" style={{ color: ink }}>
                  {tilt.score > 0 ? "+" : ""}{tilt.score}
                </span>
              </div>
              <TiltBar score={tilt.score} sampleSize={tilt.sampleSize} />
              <div className="flex items-center gap-2 mt-1.5 text-[9px] font-bold">
                <span style={{ color: "#15803D" }}>{tilt.bullishCount} bullish</span>
                <span className="text-slate-400">{tilt.neutralCount} neutral</span>
                <span style={{ color: "#B91C1C" }}>{tilt.bearishCount} bearish</span>
                {tilt.sampleSize > 0 && tilt.sampleSize < 6 && (
                  <span className="ml-auto px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-700">Thin</span>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-[9px] text-slate-400 leading-snug">
          A weighted average, not a count — twenty small sites rewriting one story cannot outvote one EIA release. Weighted by how recent each story is and how reliable its source is.
        </p>
      </section>

      {/* ---- Flash pulse (from AI Flash) ---- */}
      {!flash.pulse.quiet && flash.pulse.totalCount > 0 && (
        <section className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-black text-slate-800 flex items-center gap-1.5">
              <Activity size={13} className="text-rose-500" />
              {active.short} flash pulse
            </h2>
            <span className="text-[11px] font-black" style={{ color: flash.pulse.score >= 58 ? "#15803D" : flash.pulse.score <= 42 ? "#B91C1C" : "#64748B" }}>
              {flash.pulse.biasLabel}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug mt-1">
            {flash.pulse.totalCount} scored {flash.pulse.totalCount === 1 ? "item" : "items"} ({flash.pulse.freshCount} in the last 30 min), weighted hardest toward the newest. This is the fast read; the verdict above is the considered one.
          </p>
        </section>
      )}

      {/* ---- Last hour ---- */}
      {breaking.length > 0 && (
        <section>
          <h2 className="text-[13px] font-black text-slate-800">Last hour ({breaking.length})</h2>
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden mt-1.5">
            {breaking.slice(0, 6).map((a) => <ArticleRow key={`${a.url}-${a.headline}`} article={a} now={now} />)}
          </div>
        </section>
      )}

      {/* ---- Movers ---- */}
      <section>
        <h2 className="text-[13px] font-black text-slate-800">Most likely to move {active.short}</h2>
        <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">
          Ranked by size of story, scaled down by age and source reliability — so a big story from yesterday sits below a moderate one from ten minutes ago.
        </p>
        {movers.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-4 text-center">
            <p className="text-[11px] text-slate-500">Nothing scored high enough to list.</p>
            <p className="text-[9.5px] text-slate-400 mt-1">An empty list means no qualifying stories arrived — not that the market is quiet.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
            {movers.map((a) => <ArticleRow key={`${a.url}-${a.headline}`} article={a} now={now} />)}
          </div>
        )}
      </section>

      {/* ---- Themes ---- */}
      {themes.length > 0 && (
        <section>
          <h2 className="text-[13px] font-black text-slate-800">What the news is about</h2>
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden mt-1.5">
            {themes.map((t) => {
              const ink = t.net > 5 ? "#15803D" : t.net < -5 ? "#B91C1C" : "#64748B";
              return (
                <div key={t.key} className="px-3 py-2 border-b last:border-b-0 border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-700">{t.label}</span>
                    <span className="text-[9px] text-slate-400">{t.count}</span>
                    <span className="text-[10px] font-black tabular-nums ml-auto" style={{ color: ink }}>{t.net > 0 ? "+" : ""}{t.net}</span>
                  </div>
                  {t.topHeadline && <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{t.topHeadline}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Clustered events (from News Based Trade AI) ---- */}
      {feed.data && feed.data.events.length > 0 && (
        <section>
          <h2 className="text-[13px] font-black text-slate-800 mb-1.5">Stories being reported by more than one source</h2>
          <TopEventsList events={feed.data.events} available={feed.data.available} error={feed.data.error} />
        </section>
      )}

      {/* ---- EIA + calendar (from News Based Trade AI / GPT News) ---- */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-black text-slate-800">Scheduled data</h2>
        <EiaPanel eia={newsTrade.data?.eia ?? null} />
        <EconCalendarCardV2
          events={newsTrade.data?.calendar.events ?? []}
          available={newsTrade.data?.calendar.available ?? false}
          error={newsTrade.data?.calendar.error}
          symbol={symbolKey as "CRUDEOIL" | "NATURALGAS"}
        />
      </section>

      {/* ---- Source health ---- */}
      <section>
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="w-full rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5 flex items-center gap-2"
        >
          <Server size={13} className="text-slate-400 shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[11.5px] font-black text-slate-800">Source health</p>
            <p className="text-[9.5px] text-slate-500">{health.liveCount} of {health.totalCount} sources delivering · {health.articlesFromLive} stories</p>
          </div>
          {showSources ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>

        {showSources && (
          <div className="mt-2 space-y-2">
            <p className="text-[9.5px] text-slate-500 leading-snug px-0.5">
              Many energy sites moved their feed or block requests from data centres, which looks identical to a dead link from the server. These are separated so the broken ones
              can actually be replaced.
            </p>
            {[
              { rows: health.live, title: `Delivering (${health.live.length})`, ink: "text-emerald-700", bg: "bg-emerald-50", showCount: true },
              { rows: health.empty, title: `Answered but sent nothing (${health.empty.length})`, ink: "text-amber-700", bg: "bg-amber-50", showCount: false },
              { rows: health.failing, title: `Failing (${health.failing.length})`, ink: "text-rose-700", bg: "bg-rose-50", showCount: false },
            ].filter((g) => g.rows.length > 0).map((g) => (
              <div key={g.title} className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                <p className={`px-3 py-1.5 text-[9px] font-black uppercase ${g.ink} ${g.bg}`}>{g.title}</p>
                {g.rows.map((s) => (
                  <div key={s.source} className="px-3 py-1.5 border-b last:border-b-0 border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-700 truncate flex-1">{s.source}</span>
                      {g.showCount && <span className="text-[10px] font-black tabular-nums text-emerald-600 shrink-0">{s.count}</span>}
                    </div>
                    {s.error && <p className="text-[9px] text-rose-500/80 mt-0.5">{s.error}</p>}
                    {!s.error && !g.showCount && <p className="text-[9px] text-slate-400">Usually means the feed URL moved.</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-[9.5px] text-slate-400 leading-relaxed px-1">
        Every headline is a real item from a named source with its own published time and a link to the original — nothing here is written or summarised by the app. Bullish and
        bearish labels are the app's reading of the headline text and can be wrong; open the story before acting on one. News moves price but does not decide it, and a strong
        reading is not a trade.
        {feed.data?.builtAt && ` Feed last rebuilt ${relativeAge(feed.data.builtAt, now)}.`}
      </p>
    </div>
  );
}
