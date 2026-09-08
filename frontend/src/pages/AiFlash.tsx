import { useMemo, useState, useEffect } from "react";
import { Zap, RefreshCw, AlertTriangle } from "lucide-react";
import { useNewsFeed } from "../api/hooks";
import { analyzeFlash, formatAge, formatStamp, ageMinutes, type FlashMarket } from "../utils/aiFlashEngine";
import { FlashScoreCard, FlashRow, TopDriverCard, FlashSourceHealth } from "../components/AiFlashKit";

const MARKETS: { key: FlashMarket; label: string; short: string }[] = [
  { key: "CRUDE", label: "Crude Oil", short: "Crude" },
  { key: "NG", label: "Natural Gas", short: "NG" },
];

// How many rows to show before "show more". The feed is newest-first, so the
// first dozen is nearly always the part that matters on a flash page.
const INITIAL_ROWS = 12;

export function AiFlash() {
  const { data, isLoading, isFetching, error, refetch } = useNewsFeed();
  const [market, setMarket] = useState<FlashMarket>("CRUDE");
  const [expanded, setExpanded] = useState(false);

  // Re-render on a timer so the "3 min ago" ages keep counting up between
  // network refetches -- otherwise a headline would appear frozen at the age
  // it had when it arrived, which on this page is actively misleading.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  // Held as the possibly-undefined reference rather than `?? []` so the memo
  // key is stable: a fresh [] literal each render would re-score the whole
  // feed on every 20s age tick.
  const articles = data?.articles;
  const crude = useMemo(() => analyzeFlash(articles ?? [], "CRUDE"), [articles]);
  const ng = useMemo(() => analyzeFlash(articles ?? [], "NG"), [articles]);
  const active = market === "CRUDE" ? crude : ng;
  const activeLabel = MARKETS.find((m) => m.key === market)!.label;

  const rows = expanded ? active.items : active.items.slice(0, INITIAL_ROWS);
  const checkedAge = data?.fetchedAt ? ageMinutes(data.fetchedAt) : null;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen text-white space-y-3.5" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      <section className="pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex items-center justify-center">
              <Zap size={22} className="text-[#FF2D55]" fill="#FF2D55" />
              <span className="absolute inset-0 rounded-full motion-safe:animate-ping bg-[#FF2D55]/25" />
            </span>
            <h1 className="text-xl font-black">AI Flash</h1>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white/6 text-white/60 active:scale-95 transition-transform"
            aria-label="Refresh news now"
          >
            <RefreshCw size={11} className={isFetching ? "motion-safe:animate-spin" : ""} />
            {checkedAge !== null ? `Checked ${formatAge(checkedAge)}` : "Refresh"}
          </button>
        </div>
        {data?.fetchedAt && (
          <p className="text-[10px] text-white/30 mt-1">Feed last checked at {formatStamp(data.fetchedAt)}</p>
        )}
        <p className="text-[11px] text-white/40 mt-1.5 leading-snug">
          Newest energy headlines first, each scored bullish or bearish, with one 0-100 pressure score per commodity. Built for speed: fresh news counts roughly double a 90-minute-old story.
        </p>
      </section>

      <div className="flex gap-2.5">
        {MARKETS.map((m) => (
          <FlashScoreCard key={m.key} title={m.label} pulse={m.key === "CRUDE" ? crude.pulse : ng.pulse} active={market === m.key} onClick={() => setMarket(m.key)} />
        ))}
      </div>

      {error && (
        <div className="rounded-2xl p-3.5 flex items-start gap-2" style={{ background: "#2A1215", border: "1px solid #FF4D4F55" }}>
          <AlertTriangle size={15} className="text-[#FF4D4F] shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-bold text-[#FF4D4F]">Couldn't load the news feed</p>
            <p className="text-[10px] text-white/45 mt-0.5">{(error as Error).message}</p>
          </div>
        </div>
      )}

      {!error && data && !data.available && (
        <div className="rounded-2xl p-3.5 flex items-start gap-2" style={{ background: "#2A2412", border: "1px solid #FFC10755" }}>
          <AlertTriangle size={15} className="text-[#FFC107] shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-bold text-[#FFC107]">All news sources are down right now</p>
            <p className="text-[10px] text-white/45 mt-0.5">{data.error ?? "Nothing is being scored, so treat both scores above as unknown rather than neutral."}</p>
          </div>
        </div>
      )}

      <TopDriverCard pulse={active.pulse} symbolLabel={activeLabel} />

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-black text-white/80">{activeLabel} Flash Feed</h2>
          <span className="text-[10px] text-white/35">{active.items.length} stories · newest first</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-white/4 motion-safe:animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#14161F", border: "1px solid rgba(255,255,255,.07)" }}>
            <p className="text-[12px] font-bold text-white/60">No {activeLabel} stories in the last 48 hours</p>
            <p className="text-[10px] text-white/35 mt-1">This is a genuinely quiet tape, not a loading state — nothing scoreable has come through the feeds.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((item) => (
              <FlashRow key={item.id} item={item} />
            ))}
          </div>
        )}

        {active.items.length > INITIAL_ROWS && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-2.5 py-2.5 rounded-xl text-[11px] font-bold bg-white/6 text-white/60 active:scale-[.98] transition-transform"
          >
            {expanded ? "Show less" : `Show all ${active.items.length} stories`}
          </button>
        )}
      </section>

      <FlashSourceHealth sourceStatus={data?.sourceStatus ?? []} />

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Scoring is rule-based, so the same headline always scores the same way — no headline, price, or date is ever invented. A score is a read on
        news pressure only; it knows nothing about the chart. Always confirm on the live chart before acting.
      </p>
    </div>
  );
}
