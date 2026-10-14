// News first, at the top of AI-Shoot: which way the news leans for Crude and
// for Natural Gas, the biggest recent story with its time, and -- the part
// that decides whether it is still tradeable -- how far price has ALREADY
// moved since that headline, read as room left / partly priced / done.
// Tapping opens Ai-News.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Newspaper, ChevronRight, Clock } from "lucide-react";
import { useCandles, useNewsFeed } from "../../api/hooks";
import { computeTilt } from "../../utils/claudeNewsAnalytics";
import { newsReaction, type NewsReaction, type RoomRead } from "../../utils/newsReaction";
import { NewsScanBar } from "./NewsScanBar";
import type { ScoredNewsArticle } from "../../utils/newsScoring";

type Sym = "CRUDEOIL" | "NATURALGAS";
const MARKETS: { sym: Sym; key: "CRUDE" | "NG"; label: string }[] = [
  { sym: "CRUDEOIL", key: "CRUDE", label: "Crude Oil" },
  { sym: "NATURALGAS", key: "NG", label: "Natural Gas" },
];

const ROOM: Record<RoomRead, { label: string; bg: string; ink: string }> = {
  room_left: { label: "ROOM LEFT", bg: "#DCFCE7", ink: "#166534" },
  partly_priced: { label: "PARTLY PRICED IN", bg: "#FEF9C3", ink: "#854D0E" },
  done: { label: "MOVE MOSTLY DONE", bg: "#FFEDD5", ink: "#9A3412" },
  faded: { label: "SPIKE FADED", bg: "#F1F5F9", ink: "#475569" },
  ignored: { label: "MARKET IGNORING IT", bg: "#F1F5F9", ink: "#475569" },
};

const ageMin = (a: ScoredNewsArticle, now: number) => Math.max(0, Math.round((now - Date.parse(a.publishedAt)) / 60_000));
const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The story that matters most now: the newest big one in 6h, else the newest moving one in 3h. */
function keyStory(articles: ScoredNewsArticle[], key: "CRUDE" | "NG", now: number): ScoredNewsArticle | null {
  const rel = articles.filter((a) => (a.affectedMarket === key || a.affectedMarket === "BOTH") && a.impactScale !== 0);
  const newest = (list: ScoredNewsArticle[]) => [...list].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null;
  return newest(rel.filter((a) => Math.abs(a.impactScale) >= 3 && ageMin(a, now) <= 360)) ?? newest(rel.filter((a) => ageMin(a, now) <= 180));
}

function Reaction({ r }: { r: NewsReaction }) {
  const room = ROOM[r.read];
  const sign = r.movePts >= 0 ? "+" : "−";
  return (
    <div className="rounded-xl px-2.5 py-2 mt-1.5" style={{ background: room.bg, color: room.ink }}>
      <p className="text-[12px] font-black">
        {room.label} · since {r.sinceAt}: {sign}₹{Math.abs(r.movePts)} ({sign}{Math.abs(r.movePct)}%)
        {r.peakPts > 0 && <span className="font-bold"> · furthest ₹{r.peakPts}</span>}
      </p>
      <p className="text-[11.5px] font-semibold leading-snug mt-0.5">{r.text}</p>
      {r.gapFromClose && <p className="text-[10.5px] mt-0.5 opacity-80">The headline came while MCX was shut — measured from the last close.</p>}
    </div>
  );
}

function MarketRow({ sym, keyName, label, articles, now }: { sym: Sym; keyName: "CRUDE" | "NG"; label: string; articles: ScoredNewsArticle[]; now: number }) {
  const c5 = useCandles(sym, "5");
  const tilt = useMemo(() => computeTilt(articles, keyName, now), [articles, keyName, now]);
  const story = useMemo(() => keyStory(articles, keyName, now), [articles, keyName, now]);
  const candles = c5.data && "candles" in c5.data ? c5.data.candles : null;
  const reaction = useMemo(
    () => (story && candles ? newsReaction(candles, story.publishedAt, story.impactScale > 0 ? 1 : -1) : null),
    [story, candles],
  );
  const bull = tilt.direction === "bullish";
  const bear = tilt.direction === "bearish";
  const ink = bull ? "#047857" : bear ? "#BE123C" : "#475569";
  const pill = bull ? "#DCFCE7" : bear ? "#FFE4E6" : "#F1F5F9";
  const s = story ? (story.impactScale >= 3 ? "STRONG BULLISH" : story.impactScale <= -3 ? "STRONG BEARISH" : story.impactScale > 0 ? "Bullish" : "Bearish") : null;
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5" style={{ borderLeft: `6px solid ${ink}`, boxShadow: "0 1px 4px rgba(15,23,42,.08)" }}>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-black text-slate-800">{label}</p>
        <span className="text-[13px] font-black px-2 py-0.5 rounded-lg" style={{ background: pill, color: ink }}>
          {bull ? "BULLISH" : bear ? "BEARISH" : "NEUTRAL"} {tilt.score > 0 ? "+" : ""}{tilt.score}
        </span>
        <span className="ml-auto text-[11px] font-bold text-slate-500">▲{tilt.bullishCount} ▼{tilt.bearishCount}</span>
      </div>
      {story ? (
        <>
          <p className="text-[11px] font-black mt-1.5 flex items-center gap-1" style={{ color: story.impactScale > 0 ? "#047857" : "#BE123C" }}>
            {s} <Clock size={11} className="ml-1" /> {story.dateKnown === false ? "first seen " : ""}{clock(story.publishedAt)} · {ago(ageMin(story, now))}
          </p>
          <p className="text-[14px] font-bold text-slate-900 leading-snug mt-0.5">{story.headline}</p>
          {reaction ? <Reaction r={reaction} /> : <p className="text-[11px] text-slate-500 mt-1">Price reaction shows when MCX is open and candles are in.</p>}
        </>
      ) : (
        <p className="text-[12px] text-slate-500 mt-1">No market-moving {label} story in the last 3 hours.</p>
      )}
    </div>
  );
}

export function NewsSnapshotCard() {
  const feed = useNewsFeed();
  const articles = useMemo(() => feed.data?.articles ?? [], [feed.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [feed.dataUpdatedAt]);
  if (!feed.data?.available) return null;
  return (
    <section className="rounded-3xl p-3 space-y-2" style={{ background: "linear-gradient(135deg,#EEF2FF,#F0FDFA)" }}>
      <Link to="/ai-news" className="flex items-center gap-1.5 px-1">
        <Newspaper size={16} className="text-indigo-600" />
        <p className="text-[14px] font-black text-slate-900">News first — Crude & Gas</p>
        <span className="ml-auto text-[11.5px] font-black text-indigo-600 flex items-center">
          Ai-News <ChevronRight size={14} />
        </span>
      </Link>
      <NewsScanBar compact />
      {MARKETS.map((m) => (
        <MarketRow key={m.sym} sym={m.sym} keyName={m.key} label={m.label} articles={articles} now={now} />
      ))}
      <p className="text-[10px] text-slate-500 leading-snug px-1">
        "Since" is the futures move from the last price before the headline, against a typical 1-hour range. An estimate, not a forecast — the next headline can reverse it.
      </p>
    </section>
  );
}
