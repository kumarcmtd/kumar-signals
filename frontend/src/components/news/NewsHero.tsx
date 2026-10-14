// The top of Ai-News: what a trader needs in the first two seconds.
//   BreakingFlash  -- a high-impact story (|impact| >= 3) in the last hour,
//                     flashing, big, with STRONG BULLISH/BEARISH and the time.
//   NewsVerdict    -- which way the news leans, in big colour, and what it
//                     means for CE/PE.
//   ImpactFeed     -- readable story cards, biggest impact first in each hour;
//                     neutral stories folded away.
// In war-time crude, headlines move price within seconds -- so the newest
// big story always comes first, with its exact time.

import { useState } from "react";
import { Zap, TrendingUp, TrendingDown, Minus, Clock, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import type { ScoredNewsArticle } from "../../utils/newsScoring";
import { whyHeadlineMatters } from "../../utils/newsScoring";
import type { NewsTilt } from "../../utils/claudeNewsAnalytics";
import type { Candle } from "../../types";
import { newsReaction } from "../../utils/newsReaction";

type Market = "CRUDE" | "NG";
const relevantTo = (a: ScoredNewsArticle, m: Market) => a.affectedMarket === m || a.affectedMarket === "BOTH";
const ageMin = (a: ScoredNewsArticle, now: number) => Math.max(0, Math.round((now - Date.parse(a.publishedAt)) / 60_000));
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const ago = (m: number) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m ago` : `${Math.floor(m / 1440)}d ago`);

function strength(impact: number) {
  const a = Math.abs(impact);
  if (impact >= 3) return { word: a >= 4 ? "STRONG BULLISH" : "BULLISH", bg: "linear-gradient(135deg,#065F46,#16A34A)", ink: "#15803D", soft: "#DCFCE7" };
  if (impact <= -3) return { word: a >= 4 ? "STRONG BEARISH" : "BEARISH", bg: "linear-gradient(135deg,#881337,#E11D48)", ink: "#BE123C", soft: "#FFE4E6" };
  if (impact > 0) return { word: "Mildly bullish", bg: "", ink: "#16A34A", soft: "#F0FDF4" };
  if (impact < 0) return { word: "Mildly bearish", bg: "", ink: "#DC2626", soft: "#FEF2F2" };
  return { word: "Neutral", bg: "", ink: "#64748B", soft: "#F1F5F9" };
}

function ImpactDots({ impact }: { impact: number }) {
  const n = Math.min(5, Math.abs(impact));
  const ink = impact > 0 ? "#16A34A" : impact < 0 ? "#E11D48" : "#CBD5E1";
  return (
    <span className="inline-flex gap-[3px]" aria-label={`impact ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className="w-2 h-2 rounded-full inline-block" style={{ background: i <= n ? ink : "#E2E8F0" }} />
      ))}
    </span>
  );
}

export function BreakingFlash({ articles, market, label, now, candles }: { articles: ScoredNewsArticle[]; market: Market; label: string; now: number; candles?: Candle[] | null }) {
  const big = articles
    .filter((a) => relevantTo(a, market) && Math.abs(a.impactScale) >= 3 && ageMin(a, now) <= 60)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || Math.abs(b.impactScale) - Math.abs(a.impactScale));
  if (big.length === 0) {
    return (
      <div className="rounded-2xl px-4 py-3 bg-slate-50 border border-slate-200">
        <p className="text-[13px] font-black text-slate-600 flex items-center gap-1.5">
          <Zap size={15} className="text-slate-400" /> No major {label} headline in the last hour
        </p>
        <p className="text-[11.5px] text-slate-500 mt-0.5">A big war, supply or OPEC story will flash here the moment it lands.</p>
      </div>
    );
  }
  const top = big[0];
  const s = strength(top.impactScale);
  const why = whyHeadlineMatters(top.matchedRules);
  const m = ageMin(top, now);
  const fresh = m <= 15;
  const reaction = candles ? newsReaction(candles, top.publishedAt, top.impactScale > 0 ? 1 : -1) : null;
  return (
    <div className="space-y-2">
      <a
        href={top.url || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-3xl p-4 text-white relative overflow-hidden"
        style={{ background: s.bg, boxShadow: fresh ? `0 0 0 3px #FDE047, 0 10px 30px ${s.ink}66` : `0 10px 24px ${s.ink}44` }}
      >
        {fresh && <span className="absolute inset-0 rounded-3xl motion-safe:animate-pulse" style={{ boxShadow: "inset 0 0 0 3px #FDE047" }} />}
        <div className="relative flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-yellow-300 text-slate-900 text-[11px] font-black tracking-wider flex items-center gap-1">
            <Zap size={12} /> BREAKING
          </span>
          <span className="text-[12px] font-black tracking-wide">{s.word} · {label}</span>
        </div>
        <p className="relative text-[18px] leading-snug font-extrabold mt-2">{top.headline}</p>
        <div className="relative flex items-center gap-2 mt-2 text-[12px] font-bold opacity-95 flex-wrap">
          <Clock size={13} />
          <span>{clock(top.publishedAt)} · {ago(m)}</span>
          <span className="opacity-80">· {top.source}</span>
          <ExternalLink size={12} className="opacity-80" />
        </div>
        {why && <p className="relative text-[12px] leading-snug mt-2 rounded-xl px-2.5 py-1.5" style={{ background: "rgba(255,255,255,.16)" }}>{why.effect}</p>}
        {reaction && (
          <p className="relative text-[12.5px] font-bold leading-snug mt-2 rounded-xl px-2.5 py-1.5 bg-white" style={{ color: s.ink }}>
            Since {reaction.sinceAt}: {reaction.movePts >= 0 ? "+" : "−"}₹{Math.abs(reaction.movePts)} ({reaction.movePct >= 0 ? "+" : "−"}{Math.abs(reaction.movePct)}%). {reaction.text}
          </p>
        )}
      </a>
      {big.slice(1, 4).map((a) => {
        const t = strength(a.impactScale);
        return (
          <a key={`${a.url}-${a.headline}`} href={a.url || undefined} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 rounded-2xl px-3 py-2.5 bg-white" style={{ borderLeft: `6px solid ${t.ink}`, boxShadow: "0 1px 3px rgba(15,23,42,.08)" }}>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black" style={{ color: t.ink }}>{t.word} · {clock(a.publishedAt)} · {ago(ageMin(a, now))}</p>
              <p className="text-[14px] font-bold text-slate-900 leading-snug mt-0.5">{a.headline}</p>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export function NewsVerdict({ tilt, label }: { tilt: NewsTilt; label: string }) {
  const bull = tilt.direction === "bullish";
  const bear = tilt.direction === "bearish";
  const bg = bull ? "linear-gradient(135deg,#ECFDF5,#BBF7D0)" : bear ? "linear-gradient(135deg,#FFF1F2,#FECDD3)" : "linear-gradient(135deg,#F8FAFC,#E2E8F0)";
  const ink = bull ? "#065F46" : bear ? "#9F1239" : "#334155";
  const Icon = bull ? TrendingUp : bear ? TrendingDown : Minus;
  const meaning = bull
    ? "Headlines favour CE. Don't buy PE against it; buy CE only on steady 5-min candles."
    : bear
      ? "Headlines favour PE. Don't buy CE against it; buy PE only on steady 5-min candles."
      : "No clear news edge — the chart decides. Watch for a BREAKING story.";
  return (
    <div className="rounded-3xl p-4" style={{ background: bg, color: ink }}>
      <p className="text-[11px] font-black tracking-[.14em] uppercase opacity-80">{label} news right now</p>
      <div className="flex items-center gap-3 mt-1">
        <Icon size={34} strokeWidth={2.8} />
        <p className="text-[30px] font-black leading-none">{bull ? "BULLISH" : bear ? "BEARISH" : "NEUTRAL"}</p>
        <p className="ml-auto text-[30px] font-black tabular-nums leading-none">{tilt.score > 0 ? "+" : ""}{tilt.score}</p>
      </div>
      <div className="flex gap-3 mt-2 text-[12px] font-black">
        <span className="text-emerald-700">▲ {tilt.bullishCount} bullish</span>
        <span className="text-rose-700">▼ {tilt.bearishCount} bearish</span>
        <span className="text-slate-500">{tilt.neutralCount} neutral</span>
      </div>
      <p className="text-[13px] font-bold leading-snug mt-2">{meaning}</p>
    </div>
  );
}

export function ImpactFeed({ articles, market, now }: { articles: ScoredNewsArticle[]; market: Market; now: number }) {
  const [showQuiet, setShowQuiet] = useState(false);
  const recent = articles.filter((a) => relevantTo(a, market) && ageMin(a, now) <= 12 * 60).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const moving = recent.filter((a) => a.impactScale !== 0);
  const quiet = recent.filter((a) => a.impactScale === 0);
  return (
    <section className="space-y-2">
      <h2 className="text-[16px] font-black text-slate-900">Market-moving stories · last 12 hours</h2>
      {moving.length === 0 && <p className="text-[13px] text-slate-500">No story with a bullish or bearish read in the last 12 hours.</p>}
      {moving.slice(0, 15).map((a) => {
        const t = strength(a.impactScale);
        const m = ageMin(a, now);
        return (
          <a key={`${a.url}-${a.headline}`} href={a.url || undefined} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-white px-3.5 py-3" style={{ borderLeft: `${4 + Math.abs(a.impactScale) * 2}px solid ${t.ink}`, boxShadow: "0 1px 4px rgba(15,23,42,.08)" }}>
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-black px-2 py-0.5 rounded-md" style={{ background: t.soft, color: t.ink }}>{t.word}</span>
              <ImpactDots impact={a.impactScale} />
              <span className="ml-auto text-[11.5px] font-bold text-slate-500 tabular-nums">{clock(a.publishedAt)} · {ago(m)}</span>
            </div>
            <p className="text-[15px] font-bold text-slate-900 leading-snug mt-1.5">{a.headline}</p>
            <p className="text-[11.5px] text-slate-500 mt-1">{a.source}</p>
          </a>
        );
      })}
      {quiet.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <button type="button" onClick={() => setShowQuiet((v) => !v)} className="w-full flex items-center justify-between px-3.5 py-2.5 text-[13px] font-black text-slate-600">
            {quiet.length} other stories (no clear price impact)
            {showQuiet ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showQuiet &&
            quiet.slice(0, 25).map((a) => (
              <a key={`${a.url}-${a.headline}`} href={a.url || undefined} target="_blank" rel="noopener noreferrer" className="block px-3.5 py-2 border-t border-slate-100">
                <p className="text-[13px] text-slate-700 leading-snug">{a.headline}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{a.source} · {ago(ageMin(a, now))}</p>
              </a>
            ))}
        </div>
      )}
    </section>
  );
}
