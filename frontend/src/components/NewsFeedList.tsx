import { Newspaper, ExternalLink } from "lucide-react";
import type { ScoredNewsArticle, ExpectedMove } from "../utils/newsScoring";

const MOVE_COLOR: Record<ExpectedMove, string> = {
  very_strong_bullish: "#00E676",
  bullish: "#00E676",
  neutral: "#FFC107",
  bearish: "#FF4D4F",
  very_strong_bearish: "#FF4D4F",
};

const MOVE_LABEL: Record<ExpectedMove, string> = {
  very_strong_bullish: "Very Strong Bullish",
  bullish: "Bullish",
  neutral: "Neutral",
  bearish: "Bearish",
  very_strong_bearish: "Very Strong Bearish",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ArticleRow({ article }: { article: ScoredNewsArticle }) {
  const color = MOVE_COLOR[article.expectedMove];
  return (
    <a
      href={article.url || undefined}
      target={article.url ? "_blank" : undefined}
      rel={article.url ? "noreferrer" : undefined}
      className="block rounded-xl p-3"
      style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[12px] font-bold text-white/85 leading-snug">{article.headline}</p>
        {article.url && <ExternalLink size={11} className="shrink-0 mt-0.5 text-white/30" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>
          {MOVE_LABEL[article.expectedMove]}
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          {article.affectedMarket === "BOTH" ? "Crude + NG" : article.affectedMarket === "CRUDE" ? "Crude Oil" : "Natural Gas"}
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          Importance {article.importance}
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/50" style={{ background: "rgba(255,255,255,.06)" }}>
          Impact {article.timeImpact}
        </span>
      </div>
      <p className="text-[10px] text-white/35 mt-1.5">
        {article.source} · {timeAgo(article.publishedAt)}
      </p>
    </a>
  );
}

export function NewsFeedList({ articles, available, error }: { articles: ScoredNewsArticle[]; available: boolean; error?: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3 flex items-center gap-1.5">
        <Newspaper size={13} /> Live Energy News
      </p>
      {!available ? (
        <p className="text-[11px] text-white/40 leading-relaxed">
          {error === "NEWSAPI_KEY not configured" ? "News feed isn't connected yet -- add a NEWSAPI_KEY secret to light this up." : (error ?? "News feed unavailable right now.")}
        </p>
      ) : articles.length === 0 ? (
        <p className="text-[11px] text-white/40">No oil/gas-relevant headlines in the current feed.</p>
      ) : (
        <div className="space-y-2">
          {articles.slice(0, 12).map((a, i) => (
            <ArticleRow key={`${a.url}-${i}`} article={a} />
          ))}
        </div>
      )}
    </div>
  );
}
