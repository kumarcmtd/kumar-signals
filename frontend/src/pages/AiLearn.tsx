import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, Search, CandlestickChart, LineChart as LineChartIcon, Globe2, Activity } from "lucide-react";
import {
  CANDLESTICK_PATTERNS,
  CHART_PATTERNS,
  FUNDAMENTALS,
  VOLUME_MOMENTUM,
  type LearnEntry,
  type LearnCategory,
  type LearnBias,
  type CandleSpec,
} from "../data/learnLibrary";

const TABS: { key: LearnCategory; label: string; icon: typeof CandlestickChart; entries: LearnEntry[] }[] = [
  { key: "candlestick", label: "Candlesticks", icon: CandlestickChart, entries: CANDLESTICK_PATTERNS },
  { key: "chart", label: "Chart Patterns", icon: LineChartIcon, entries: CHART_PATTERNS },
  { key: "fundamentals", label: "Fundamentals", icon: Globe2, entries: FUNDAMENTALS },
  { key: "volume", label: "Volume & Momentum", icon: Activity, entries: VOLUME_MOMENTUM },
];

const BIAS_STYLE: Record<LearnBias, { label: string; color: string; bg: string; icon: typeof TrendingUp }> = {
  bullish: { label: "Bullish", color: "#15803D", bg: "#DCFCE7", icon: TrendingUp },
  bearish: { label: "Bearish", color: "#B91C1C", bg: "#FEE2E2", icon: TrendingDown },
  neutral: { label: "Neutral", color: "#B45309", bg: "#FEF3C7", icon: Minus },
};

const KIND_LABEL: Record<LearnEntry["kind"], string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  info: "Reference",
};

function MiniCandles({ candles }: { candles: CandleSpec[] }) {
  return (
    <div className="flex items-end justify-center gap-2 h-24 bg-[var(--color-surface-soft)] rounded-lg px-4 py-2">
      {candles.map((c, i) => (
        <div key={i} className="relative w-6 h-full">
          <div
            className="absolute left-1/2 -translate-x-1/2 w-px bg-[var(--color-muted)]"
            style={{ top: `${c.wickTop}%`, bottom: `${100 - c.wickBottom}%` }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 w-3.5 rounded-[2px]"
            style={{
              top: `${c.bodyTop}%`,
              bottom: `${100 - c.bodyBottom}%`,
              background: c.bullish ? "var(--color-buy)" : "var(--color-sell)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EntryCard({ entry }: { entry: LearnEntry }) {
  const [open, setOpen] = useState(false);
  const bias = BIAS_STYLE[entry.bias];
  const BiasIcon = bias.icon;

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 p-3.5 text-left">
        <span
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: bias.bg, color: bias.color }}
        >
          <BiasIcon size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{entry.name}</p>
          <p className="text-[10px] text-[var(--color-muted)] mt-0.5">
            {bias.label} · {KIND_LABEL[entry.kind]}
          </p>
        </div>
        <ChevronDown size={16} className={`shrink-0 text-[var(--color-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {entry.candles && <MiniCandles candles={entry.candles} />}
          <p className="text-xs leading-relaxed text-[var(--color-text)]">{entry.summary}</p>
          {entry.tradeNote && (
            <p className="text-xs leading-relaxed rounded-lg bg-[var(--color-surface-soft)] px-2.5 py-2">
              <span className="font-bold">How it's traded: </span>
              {entry.tradeNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AiLearn() {
  const [tab, setTab] = useState<LearnCategory>("candlestick");
  const [search, setSearch] = useState("");

  const activeTab = TABS.find((t) => t.key === tab)!;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeTab.entries;
    return activeTab.entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)
    );
  }, [activeTab, search]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-sm font-bold">AI-Learn</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          A reference library of candlestick patterns, chart patterns, and MCX Crude Oil / Natural Gas fundamentals — distilled for
          learning. Nothing on this page feeds any live signal; it's here so you can look up what the concepts used elsewhere in this
          app actually mean.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSearch("");
            }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
              tab === t.key ? "bg-slate-900 text-white" : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]"
            }`}
          >
            <t.icon size={13} />
            {t.label}
            <span className={`text-[10px] ${tab === t.key ? "text-white/70" : "text-[var(--color-muted)]"}`}>{t.entries.length}</span>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          type="text"
          placeholder={`Search ${activeTab.label.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-border)] pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2.5">
        {filtered.map((entry) => (
          <EntryCard key={entry.id} entry={entry} />
        ))}
        {!filtered.length && (
          <div className="card p-4 text-xs text-center text-[var(--color-muted)]">No matches in {activeTab.label}.</div>
        )}
      </div>
    </div>
  );
}
