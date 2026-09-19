// Claude News -- energy news with the impact read attached.
//
// Built because the existing news pages were arriving empty. Two things were
// wrong and both are fixed here: the Worker was rebuilding ~35 RSS feeds
// inside a request that gets 10ms of CPU (it now happens on the Cron), and
// most of the good energy trade sites either moved their feed or block
// datacentre IPs (there are now aggregated topic feeds that reach the same
// publishers, and a Source Health panel that shows exactly which ones answer).
//
// All the analysis on this page runs in the browser. It adds no Worker CPU
// and no upstream calls -- it reads the same cached feed the other pages read.

import { useMemo, useState } from "react";
import { Newspaper, RefreshCw, AlertTriangle, ExternalLink, Activity, Radio, Server, ChevronDown, ChevronUp } from "lucide-react";
import { useNewsFeed } from "../api/hooks";
import {
  computeTilt, rankMovers, breakingSince, bucketThemes, summariseSourceHealth, readFreshness, relativeAge,
  type NewsCommodity,
} from "../utils/claudeNewsAnalytics";
import type { ScoredNewsArticle } from "../utils/newsScoring";

const TABS: { key: NewsCommodity | "ALL"; label: string }[] = [
  { key: "ALL", label: "Both" },
  { key: "CRUDE", label: "Crude Oil" },
  { key: "NG", label: "Natural Gas" },
];

const TIER_LABEL: Record<number, string> = { 1: "Official", 2: "Major wire", 3: "Trade press", 4: "Other" };

function impactChip(impactScale: number) {
  if (impactScale >= 2) return { text: "Bullish", bg: "#DCFCE7", ink: "#15803D" };
  if (impactScale > 0.5) return { text: "Mildly bullish", bg: "#F0FDF4", ink: "#16A34A" };
  if (impactScale <= -2) return { text: "Bearish", bg: "#FEE2E2", ink: "#B91C1C" };
  if (impactScale < -0.5) return { text: "Mildly bearish", bg: "#FEF2F2", ink: "#DC2626" };
  return { text: "Neutral", bg: "#F1F5F9", ink: "#64748B" };
}

function TiltMeter({ tilt }: { tilt: ReturnType<typeof computeTilt> }) {
  const ink = tilt.direction === "bullish" ? "#15803D" : tilt.direction === "bearish" ? "#B91C1C" : "#64748B";
  // -100..+100 mapped onto the bar, with the centre line at 50%.
  const pos = ((tilt.score + 100) / 200) * 100;
  const thin = tilt.sampleSize > 0 && tilt.sampleSize < 6;

  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-black" style={{ color: ink }}>{tilt.label}</p>
        <span className="text-[13px] font-black tabular-nums shrink-0" style={{ color: ink }}>
          {tilt.score > 0 ? "+" : ""}{tilt.score}
        </span>
      </div>

      <div className="relative h-2 rounded-full mt-2" style={{ background: "linear-gradient(90deg,#FEE2E2,#F1F5F9,#DCFCE7)" }}>
        <div className="absolute top-0 bottom-0 w-[1px] bg-slate-300" style={{ left: "50%" }} />
        {tilt.sampleSize > 0 && (
          <div
            className="absolute -top-[3px] h-[14px] w-[3px] rounded-full"
            style={{ left: `${pos}%`, transform: "translateX(-50%)", background: ink, transition: "left 600ms ease-out" }}
          />
        )}
      </div>

      <div className="flex items-center gap-2 mt-2 text-[9.5px] font-bold">
        <span style={{ color: "#15803D" }}>{tilt.bullishCount} bullish</span>
        <span className="text-slate-400">{tilt.neutralCount} neutral</span>
        <span style={{ color: "#B91C1C" }}>{tilt.bearishCount} bearish</span>
        {thin && <span className="ml-auto px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-700">Thin sample</span>}
      </div>

      <p className="text-[9.5px] text-slate-500 leading-snug mt-1.5">{tilt.note}</p>
    </div>
  );
}

function ArticleRow({ article, now }: { article: ScoredNewsArticle; now: number }) {
  const chip = impactChip(article.impactScale);
  return (
    <a
      href={article.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-3 py-2.5 border-b last:border-b-0 border-slate-100 active:bg-slate-50"
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md" style={{ background: chip.bg, color: chip.ink }}>
          {chip.text}
        </span>
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

export function ClaudeNews() {
  const [tab, setTab] = useState<NewsCommodity | "ALL">("ALL");
  const [showSources, setShowSources] = useState(false);
  const feed = useNewsFeed();

  const articles = useMemo(() => feed.data?.articles ?? [], [feed.data]);
  // One timestamp for the whole render, so every "12 min ago" on the page is
  // measured from the same instant instead of drifting row by row. Re-stamped
  // whenever a new payload lands, never on an unrelated re-render.
  const now = useMemo(() => Date.now(), [feed.dataUpdatedAt]);

  const crudeTilt = useMemo(() => computeTilt(articles, "CRUDE", now), [articles, now]);
  const ngTilt = useMemo(() => computeTilt(articles, "NG", now), [articles, now]);
  const movers = useMemo(() => rankMovers(articles, tab, 15), [articles, tab]);
  const breaking = useMemo(() => breakingSince(articles, 60, now), [articles, now]);
  const themes = useMemo(() => bucketThemes(articles, tab), [articles, tab]);
  const health = useMemo(() => summariseSourceHealth(feed.data?.sourceStatus ?? []), [feed.data]);
  const freshness = useMemo(() => readFreshness(articles, now), [articles, now]);

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center gap-2">
        <Newspaper size={20} className="text-indigo-600" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-black leading-none text-slate-900">Claude News</h1>
          <p className="text-[9.5px] text-slate-500 mt-0.5">Energy news with the impact read attached</p>
        </div>
        <button
          type="button"
          onClick={() => feed.refetch()}
          disabled={feed.isFetching}
          className="shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-black flex items-center gap-1 disabled:opacity-50"
          style={{ background: "var(--color-surface-soft)", color: "#475569" }}
        >
          <RefreshCw size={11} className={feed.isFetching ? "motion-safe:animate-spin" : ""} />
          Update
        </button>
      </header>

      {/* Freshness first. The complaint that created this page was stale news,
          so the age of the feed is stated before any headline. */}
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-2"
        style={{
          background: freshness.stale ? "#FEF2F2" : "#F0FDF4",
          border: `1px solid ${freshness.stale ? "#FECACA" : "#BBF7D0"}`,
        }}
      >
        <Radio size={13} className="shrink-0" style={{ color: freshness.stale ? "#B91C1C" : "#15803D" }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-black" style={{ color: freshness.stale ? "#B91C1C" : "#15803D" }}>
            {freshness.label}
          </p>
          <p className="text-[9px] text-slate-500">
            {freshness.withinLastHour} in the last hour · {freshness.withinLastSixHours} in the last 6h · {freshness.older} older
          </p>
        </div>
      </div>

      {feed.isLoading && <div className="h-24 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />}

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
            {feed.data.error ?? "No source answered."} Open Source Health below to see exactly which ones failed and why — that list is what gets them fixed.
          </p>
        </div>
      )}

      {/* Both tilt meters, always, regardless of the tab -- you hold positions
          in both and one commodity's news does not describe the other. */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-black text-slate-800">Which way is the news leaning?</h2>
        <TiltMeter tilt={crudeTilt} />
        <TiltMeter tilt={ngTilt} />
        <p className="text-[9px] text-slate-400 leading-snug px-0.5">
          Each score is a weighted average, not a count — twenty small sites rewriting one story cannot outvote one EIA release. Weighted by how recent each story is and how
          reliable its source is. This is background context for a decision, never an entry signal.
        </p>
      </section>

      <div className="flex gap-1.5">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="flex-1 py-2 rounded-xl text-[11.5px] font-black"
            style={tab === key ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}
          >
            {label}
          </button>
        ))}
      </div>

      {breaking.length > 0 && (
        <section>
          <h2 className="text-[13px] font-black text-slate-800 flex items-center gap-1.5">
            <Activity size={13} className="text-rose-500" />
            Last hour ({breaking.length})
          </h2>
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden mt-1.5">
            {breaking.slice(0, 8).map((a) => (
              <ArticleRow key={`${a.url}-${a.headline}`} article={a} now={now} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-black text-slate-800">Most likely to move price</h2>
        <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">
          Ranked by how big the story is, scaled down by age and by how reliable the source is — so a large story from yesterday sits below a moderate one from ten minutes ago.
        </p>
        {movers.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-4 text-center">
            <p className="text-[11px] text-slate-500">Nothing scored high enough to list here.</p>
            <p className="text-[9.5px] text-slate-400 mt-1">An empty list means no qualifying stories arrived — not that the market is quiet.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
            {movers.map((a) => (
              <ArticleRow key={`${a.url}-${a.headline}`} article={a} now={now} />
            ))}
          </div>
        )}
      </section>

      {themes.length > 0 && (
        <section>
          <h2 className="text-[13px] font-black text-slate-800">What the news is about</h2>
          <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">The subjects driving the flow right now, and which way each one leans.</p>
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
            {themes.map((t) => {
              const ink = t.net > 5 ? "#15803D" : t.net < -5 ? "#B91C1C" : "#64748B";
              return (
                <div key={t.key} className="px-3 py-2 border-b last:border-b-0 border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-700">{t.label}</span>
                    <span className="text-[9px] text-slate-400">{t.count}</span>
                    <span className="text-[10px] font-black tabular-nums ml-auto" style={{ color: ink }}>
                      {t.net > 0 ? "+" : ""}{t.net}
                    </span>
                  </div>
                  {t.topHeadline && <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{t.topHeadline}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Source Health. A first-class feature, not a debug panel: when this
          page looks empty, this list is the only thing that explains why. */}
      <section>
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="w-full rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5 flex items-center gap-2"
        >
          <Server size={13} className="text-slate-400 shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[11.5px] font-black text-slate-800">Source health</p>
            <p className="text-[9.5px] text-slate-500">
              {health.liveCount} of {health.totalCount} sources delivering · {health.articlesFromLive} stories
            </p>
          </div>
          {showSources ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>

        {showSources && (
          <div className="mt-2 space-y-2">
            <p className="text-[9.5px] text-slate-500 leading-snug px-0.5">
              Many energy sites either moved their feed or block requests from data centres, which looks identical to a dead link from the server. This list separates the two so
              the broken ones can actually be replaced.
            </p>

            {health.live.length > 0 && (
              <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                <p className="px-3 py-1.5 text-[9px] font-black uppercase text-emerald-700 bg-emerald-50">Delivering ({health.live.length})</p>
                {health.live.map((s) => (
                  <div key={s.source} className="flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 border-slate-100">
                    <span className="text-[10px] text-slate-700 truncate flex-1">{s.source}</span>
                    <span className="text-[10px] font-black tabular-nums text-emerald-600 shrink-0">{s.count}</span>
                  </div>
                ))}
              </div>
            )}

            {health.empty.length > 0 && (
              <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                <p className="px-3 py-1.5 text-[9px] font-black uppercase text-amber-700 bg-amber-50">Answered but sent nothing ({health.empty.length})</p>
                {health.empty.map((s) => (
                  <div key={s.source} className="px-3 py-1.5 border-b last:border-b-0 border-slate-100">
                    <span className="text-[10px] text-slate-700">{s.source}</span>
                    <p className="text-[9px] text-slate-400">Usually means the feed URL moved.</p>
                  </div>
                ))}
              </div>
            )}

            {health.failing.length > 0 && (
              <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                <p className="px-3 py-1.5 text-[9px] font-black uppercase text-rose-700 bg-rose-50">Failing ({health.failing.length})</p>
                {health.failing.map((s) => (
                  <div key={s.source} className="px-3 py-1.5 border-b last:border-b-0 border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={10} className="text-rose-400 shrink-0" />
                      <span className="text-[10px] text-slate-700 truncate">{s.source}</span>
                    </div>
                    {s.error && <p className="text-[9px] text-rose-500/80 mt-0.5 pl-[18px]">{s.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <p className="text-[9.5px] text-slate-400 leading-relaxed px-1">
        Every headline here is a real item from a named source with its own published time and a link to the original — nothing on this page is written or summarised by the app.
        Bullish and bearish labels are the app's own reading of the headline text and can be wrong; open the story before acting on one. News moves price, but it does not
        decide it, and a strong tilt is not a trade.
        {feed.data?.builtAt && ` Feed last rebuilt ${relativeAge(feed.data.builtAt, now)}.`}
      </p>
    </div>
  );
}
