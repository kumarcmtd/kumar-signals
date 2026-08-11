import { useMemo, useState } from "react";
import { Clock, ExternalLink, Filter, Gauge, Radio } from "lucide-react";
import type { ScoredNewsArticle, NewsEvent, AffectedMarket } from "../utils/newsScoring";
import type { EconCalendarEvent, EiaFetchResponse, MarketStatus } from "../types";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function istClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + " IST";
}

// ---- Data freshness indicator ----
// Spec-exact color bands: green <5min, yellow 5-20min, red >20min, and the
// label itself must say STALE rather than LIVE once it's actually stale.
export function DataFreshnessBadge({ fetchedAt }: { fetchedAt: string | null }) {
  if (!fetchedAt) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40">
        <Radio size={11} /> Connecting…
      </div>
    );
  }
  const ageMin = (Date.now() - new Date(fetchedAt).getTime()) / 60_000;
  const color = ageMin < 5 ? "#00E676" : ageMin < 20 ? "#FFC107" : "#FF4D4F";
  const label = ageMin < 5 ? "LIVE DATA" : "STALE DATA";
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-black" style={{ color }}>
      <span className="relative flex h-2 w-2">
        {ageMin < 5 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
      </span>
      {label} · Last updated {istClock(fetchedAt)}
    </div>
  );
}

// ---- Market status banner ----
export function MarketStatusBanner({ marketStatus }: { marketStatus: MarketStatus | null }) {
  if (!marketStatus) return null;
  const visual =
    marketStatus.session === "OPEN"
      ? { emoji: "🟢", label: "MARKET STATUS: OPEN", color: "#00E676" }
      : marketStatus.session === "PRE_OPEN"
        ? { emoji: "🟡", label: "MARKET STATUS: PRE-OPEN", color: "#FFC107" }
        : { emoji: "🔴", label: "MARKET STATUS: CLOSED", color: "#FF4D4F" };
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "#181A24", border: `1px solid ${visual.color}33` }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black" style={{ color: visual.color }}>
          {visual.emoji} {visual.label}
        </span>
        <span className="text-[10px] font-bold text-white/40">{marketStatus.timeLabel}</span>
      </div>
      <p className="text-[10px] text-white/40 mt-1 leading-relaxed">
        {marketStatus.session === "CLOSED" ? "Market closed -- news monitoring remains active." : marketStatus.mcxStatus}
      </p>
    </div>
  );
}

// ---- News Market Bias summary ----
export function NewsMarketBiasCard({ net, confidence, weightPct }: { net: number; confidence: number; weightPct: number }) {
  const visual = net > 15 ? { emoji: "🟢", label: "BULLISH", color: "#00E676" } : net < -15 ? { emoji: "🔴", label: "BEARISH", color: "#FF4D4F" } : { emoji: "🟡", label: "NEUTRAL", color: "#FFC107" };
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: `1px solid ${visual.color}33` }}>
      <p className="text-[10px] font-black uppercase text-white/50 mb-2">News Market Bias</p>
      <div className="flex items-center justify-between">
        <span className="text-lg font-black" style={{ color: visual.color }}>
          {visual.emoji} {visual.label}
        </span>
        <span className="text-sm font-black" style={{ color: visual.color }}>
          {net > 0 ? "+" : ""}
          {Math.round(net)}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] font-bold text-white/50">
        <span>Confidence {confidence}%</span>
        <span>·</span>
        <span>News Weight {weightPct}%</span>
      </div>
    </div>
  );
}

// ---- Top market-moving events ----
const IMPACT_VISUAL = (impact: number) => {
  if (impact >= 3) return { emoji: "🟢🟢", color: "#00E676", label: `+${impact} Strong Bullish` };
  if (impact > 0) return { emoji: "🟢", color: "#00E676", label: `+${impact} Bullish` };
  if (impact <= -3) return { emoji: "🔴🔴", color: "#FF4D4F", label: `${impact} Strong Bearish` };
  if (impact < 0) return { emoji: "🔴", color: "#FF4D4F", label: `${impact} Bearish` };
  return { emoji: "🟡", color: "#FFC107", label: "0 Neutral" };
};

function EventCard({ event }: { event: NewsEvent }) {
  const visual = IMPACT_VISUAL(event.impactScale);
  return (
    <a href={event.primaryUrl || undefined} target={event.primaryUrl ? "_blank" : undefined} rel="noreferrer" className="block rounded-xl p-3" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-bold text-white/85 leading-snug">{event.title}</p>
        {event.primaryUrl && <ExternalLink size={11} className="shrink-0 mt-0.5 text-white/30" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: `${visual.color}22`, color: visual.color }}>
          {visual.emoji} {visual.label}
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          Relevance {event.relevancePct}%
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          Confidence {event.confidencePct}%
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          {event.affectedMarket === "BOTH" ? "Crude + NG" : event.affectedMarket === "CRUDE" ? "Crude Oil" : "Natural Gas"}
        </span>
        {event.articleCount > 1 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
            {event.articleCount} sources
          </span>
        )}
      </div>
      <p className="text-[10px] text-white/40 mt-1.5">
        {event.primarySource} · {timeAgo(event.publishedAt)}
      </p>
      <p className="text-[10px] text-white/55 mt-1.5 leading-relaxed">
        <span className="font-bold text-white/70">Why it matters: </span>
        {event.whyItMatters}
      </p>
      <p className="text-[10px] text-white/55 mt-1 leading-relaxed">
        <span className="font-bold text-white/70">Expected effect: </span>
        {event.expectedEffect}
      </p>
    </a>
  );
}

export function TopEventsList({ events }: { events: NewsEvent[] }) {
  const top5 = [...events].sort((a, b) => Math.abs(b.impactScale) * b.sourceQualityPct - Math.abs(a.impactScale) * a.sourceQualityPct).slice(0, 5);
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3">Top Market-Moving Events</p>
      {top5.length === 0 ? (
        <p className="text-[11px] text-white/40">No high-relevance events in the current feed.</p>
      ) : (
        <div className="space-y-2">
          {top5.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Chronological, filterable news timeline ----
type TimelineFilter = "ALL" | "CRUDE" | "NG" | "BULLISH" | "BEARISH" | "HIGH_IMPACT";
const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "CRUDE", label: "CRUDE" },
  { key: "NG", label: "NATURAL GAS" },
  { key: "BULLISH", label: "BULLISH" },
  { key: "BEARISH", label: "BEARISH" },
  { key: "HIGH_IMPACT", label: "HIGH IMPACT" },
];

function passesFilter(a: ScoredNewsArticle, f: TimelineFilter): boolean {
  switch (f) {
    case "ALL": return true;
    case "CRUDE": return a.affectedMarket === "CRUDE" || a.affectedMarket === "BOTH";
    case "NG": return a.affectedMarket === "NG" || a.affectedMarket === "BOTH";
    case "BULLISH": return a.impactScale > 0;
    case "BEARISH": return a.impactScale < 0;
    case "HIGH_IMPACT": return Math.abs(a.impactScale) >= 3;
  }
}

export function NewsTimeline({ articles, available, error }: { articles: ScoredNewsArticle[]; available: boolean; error?: string }) {
  const [filter, setFilter] = useState<TimelineFilter>("ALL");
  const filtered = useMemo(() => articles.filter((a) => passesFilter(a, filter)), [articles, filter]);

  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3 flex items-center gap-1.5">
        <Filter size={13} /> News Timeline
      </p>
      {!available ? (
        <p className="text-[11px] text-white/40 leading-relaxed">{error ?? "NEWS FEED TEMPORARILY UNAVAILABLE -- the rest of the dashboard still works."}</p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black border transition-colors"
                style={filter === f.key ? { background: "#00C2FF", color: "#04121C", borderColor: "transparent" } : { background: "transparent", borderColor: "rgba(255,255,255,.15)", color: "rgba(255,255,255,.5)" }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="text-[11px] text-white/40">No headlines match this filter right now.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.slice(0, 20).map((a, i) => {
                const visual = IMPACT_VISUAL(a.impactScale);
                return (
                  <a key={`${a.url}-${i}`} href={a.url || undefined} target={a.url ? "_blank" : undefined} rel="noreferrer" className="flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: "#12131C" }}>
                    <span className="text-[9px] font-bold text-white/35 shrink-0 mt-0.5 flex items-center gap-1">
                      <Clock size={9} /> {istClock(a.publishedAt).slice(0, 5)}
                    </span>
                    <span className="text-[11px] text-white/75 leading-snug flex-1">{a.headline}</span>
                    <span className="text-[9px] font-black shrink-0" style={{ color: visual.color }}>
                      {visual.emoji} {a.impactScale > 0 ? "+" : ""}
                      {a.impactScale}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Compact EIA market-data panel ----
function EiaRow({ label, result }: { label: string; result: { latestValue: number; priorValue: number; changeValue: number; direction: string } | null }) {
  if (!result) return <p className="text-[10px] text-white/30">{label}: data unavailable.</p>;
  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "#12131C" }}>
      <span className="text-[11px] font-bold text-white/70">{label}</span>
      <span className="text-[10px] font-black text-white/90">
        {result.latestValue.toLocaleString()} <span className="text-white/35 font-bold">(prev {result.priorValue.toLocaleString()})</span>{" "}
        <span style={{ color: result.changeValue < 0 ? "#FF4D4F" : "#00E676" }}>
          {result.changeValue >= 0 ? "+" : ""}
          {result.changeValue.toLocaleString()}
        </span>
      </span>
    </div>
  );
}

export function EiaPanel({ eia }: { eia: EiaFetchResponse | null }) {
  if (!eia?.available) return null;
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3 flex items-center gap-1.5">
        <Gauge size={13} /> EIA Market Data
      </p>
      <div className="space-y-1.5">
        <EiaRow label="US Crude Inventory (weekly)" result={eia.crude} />
        <EiaRow label="US NG Storage (weekly, Bcf)" result={eia.ngStorage} />
      </div>
      <p className="text-[9px] text-white/25 mt-2">Actual vs prior EIA release. Not a forecast comparison -- EIA's public data does not include analyst consensus figures.</p>
    </div>
  );
}

// ---- Economic calendar with actual/previous/impact ----
function daysUntil(dateStr: string): string {
  const diff = Math.round((new Date(`${dateStr}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return dateStr;
  return `in ${diff}d`;
}

const IMPACT_TAG: Record<EconCalendarEvent["impact"], { emoji: string; color: string }> = {
  HIGH: { emoji: "🔴", color: "#FF4D4F" },
  MEDIUM: { emoji: "🟡", color: "#FFC107" },
  LOW: { emoji: "🟢", color: "#00E676" },
};

export function EconCalendarCardV2({ events, available, error, symbol }: { events: EconCalendarEvent[]; available: boolean; error?: string; symbol: "CRUDEOIL" | "NATURALGAS" }) {
  const marketKey: AffectedMarket = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevant = events.filter((e) => e.affects === marketKey || e.affects === "BOTH");
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3">Event Calendar</p>
      {!available ? (
        <p className="text-[11px] text-white/40 leading-relaxed">{error === "FRED_API_KEY not configured" ? "Economic calendar unavailable -- add FRED_API_KEY." : (error ?? "Calendar unavailable right now.")}</p>
      ) : relevant.length === 0 ? (
        <p className="text-[11px] text-white/40">No upcoming releases found.</p>
      ) : (
        <div className="space-y-1.5">
          {relevant.map((e) => {
            const tag = IMPACT_TAG[e.impact];
            return (
              <div key={e.name} className="rounded-xl px-3 py-2" style={{ background: "#12131C" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white/80">{e.name}</span>
                  <span className="text-[10px] font-black" style={{ color: tag.color }}>
                    {tag.emoji} {e.impact}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-white/40">{daysUntil(e.date)} (IST)</span>
                  <span className="text-[10px] font-bold text-white/50">
                    {e.actual !== null ? `Latest: ${e.actual.toLocaleString()}` : "Latest: --"} {e.previous !== null ? `· Prior: ${e.previous.toLocaleString()}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
