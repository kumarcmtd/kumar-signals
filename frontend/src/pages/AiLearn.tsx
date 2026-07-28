import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, Search, CandlestickChart, LineChart as LineChartIcon, Globe2, Activity, Copy, Info } from "lucide-react";
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
import { useCandles, useOptionsAnalytics, useSignal, useCreateTrade } from "../api/hooks";
import { TIMEFRAMES } from "../hooks/useTimeframeSuite";
import { useEliteTradeLog, liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { evaluatePatternSignal } from "../utils/patternSignalEngine";
import type { BestCallPick } from "../utils/bestCallSelector";
import { formatTipCard } from "../utils/tipFormat";
import { calculatePotentialLeft } from "../utils/kimiPlaybook";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import type { Decision6 } from "../utils/timeframeEngine";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

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

function formatExpiryTip(expiry: string | undefined): string {
  if (!expiry) return "—";
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

// Scans this instrument's 4 timeframes for a candlestick pattern that maps
// 1:1 onto an AI-Learn catalog entry (patternSignalEngine's own strict bar:
// structure + volume must also confirm), keeps only the highest-confidence
// timeframe, and tracks it under its own "PATTERN-<symbol>" trade log --
// deliberately separate from every other engine's trade log (AI Elite, the
// Directional Gate, Kimi, Best Call) so its hit ratio can be judged purely on
// its own, independent of the others.
function usePatternPickForSymbol(symbol: TradableSymbol) {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const { data: options } = useOptionsAnalytics(symbol);
  const { data: signal } = useSignal(symbol);

  const pick = useMemo(() => {
    const queriesByTf: Record<string, typeof c15> = { "15": c15, "30": c30, "60": c60, "240": c240 };
    const candidates: BestCallPick[] = [];
    for (const { tf, label } of TIMEFRAMES) {
      const candles = queriesByTf[tf].data?.candles ?? [];
      const p = evaluatePatternSignal(candles, label, options);
      if (p) candidates.push(p);
    }
    if (!candidates.length) return null;
    return candidates.reduce((best, c) => (c.confidence > best.confidence ? c : best));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c15.data, c30.data, c60.data, c240.data, options]);

  const trackingKey = `PATTERN-${symbol}`;
  const decision: Decision6 | null = pick ? (pick.direction === "bullish" ? "STRONG BUY" : "STRONG SELL") : null;
  const proj = pick ? { strike: pick.strike, optSide: pick.optSide, entry: pick.entry, targets: pick.targets, stop: pick.stop } : null;
  const meta = pick ? { label: pick.source, reasons: pick.reasons, confirmingTimeframes: [pick.label] } : undefined;
  useEliteTradeLog(trackingKey, decision, pick?.optSide ?? null, proj, options, meta);

  return { pick, trackingKey, options, expiry: signal?.expiry };
}

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

function PatternCallCard({
  symbol,
  data,
  tradeLogs,
  loggedKey,
  setLoggedKey,
  copiedKey,
  setCopiedKey,
  createTrade,
}: {
  symbol: TradableSymbol;
  data: ReturnType<typeof usePatternPickForSymbol>;
  tradeLogs: Record<string, TradeLogEntry[]>;
  loggedKey: string | null;
  setLoggedKey: (k: string | null) => void;
  copiedKey: string | null;
  setCopiedKey: (k: string | null) => void;
  createTrade: ReturnType<typeof useCreateTrade>;
}) {
  const pick = data.pick!;
  const log = tradeLogs[data.trackingKey] ?? [];
  const latest = log[log.length - 1];
  if (!latest) return null;

  const liveLtp = !latest.closed ? liveLtpFor(data.options, latest.strike, latest.optSide) : null;
  const nextTarget = latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0];
  const potential = calculatePotentialLeft(latest.entry, latest.stop, nextTarget, liveLtp ?? latest.entry);
  const Bias = pick.direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = pick.direction === "bullish" ? "var(--color-buy)" : "var(--color-sell)";

  const tip = formatTipCard({
    symbolLabel: DISPLAY_NAME[symbol],
    strike: latest.strike,
    optSide: latest.optSide,
    expiryLabel: formatExpiryTip(data.expiry),
    buyZoneLow: latest.entry,
    buyZoneHigh: Number((latest.entry * 1.02).toFixed(2)),
    targets: latest.targets,
    stopLoss: latest.stop,
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5 text-[11px] text-[var(--color-muted)]">
        <span>Pattern spotted: {new Date(latest.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <span className="flex items-center gap-1 font-bold text-[#0891B2]">
          <Info size={12} />
          AI-Learn Pattern Signal
        </span>
      </div>

      <div className="px-4 pt-3 flex items-center justify-between">
        <div>
          <p className="text-lg font-black flex items-center gap-1.5">
            <Bias size={16} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol].toUpperCase()} {latest.strike} {latest.optSide}
          </p>
          <p className="text-xs text-[var(--color-muted)]">{pick.label}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-black" style={{ color: biasColor }}>
            ₹{liveLtp ?? latest.entry}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">Current premium</p>
        </div>
      </div>

      <pre className="mx-4 mt-3 rounded-xl bg-[var(--color-surface-soft)] px-3.5 py-3 text-[13px] leading-6 whitespace-pre-wrap font-sans">{tip}</pre>

      <div className="px-4 mt-3 space-y-1">
        {pick.reasons.slice(0, 3).map((r, i) => (
          <p key={i} className="text-[11px] text-[var(--color-muted)]">
            • {r}
          </p>
        ))}
      </div>

      <div className="px-4 mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">Confidence {Math.round(pick.confidence)}%</span>
        {pick.rr !== null && <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">R:R 1:{pick.rr}</span>}
        {!latest.closed && (
          <span className="text-[10px] px-2 py-1 rounded-full font-bold animate-pulse" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
            LIVE
          </span>
        )}
      </div>

      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-[var(--color-buy)]">{potential.potentialLeftPercent}%</p>
            <p className="text-[10px] text-[var(--color-muted)]">Potential left</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(tip);
                setCopiedKey(data.trackingKey);
                setTimeout(() => setCopiedKey(null), 2000);
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-[var(--color-surface-soft)]"
            >
              <Copy size={13} />
              {copiedKey === data.trackingKey ? "Copied ✓" : "Copy"}
            </button>
            {!latest.closed && (
              <button
                disabled={loggedKey === data.trackingKey}
                onClick={() =>
                  createTrade.mutate(
                    {
                      symbol,
                      optSide: latest.optSide,
                      strike: latest.strike,
                      entryPrice: latest.entry,
                      stopLoss: latest.stop,
                      target: latest.targets[0],
                      quantity: 1,
                      lotSize: LOT_SIZE[symbol],
                      source: "master-ai",
                      notes: `Logged from AI-Learn Pattern Signal (${pick.label})`,
                    },
                    { onSuccess: () => setLoggedKey(data.trackingKey) }
                  )
                }
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                style={{ background: biasColor }}
              >
                {loggedKey === data.trackingKey ? "Logged ✓" : "Buy"}
              </button>
            )}
          </div>
        </div>
      </div>

      {!latest.closed && (
        <p className="px-4 pb-3 -mt-2 text-[10px] text-[var(--color-muted)]">
          Stop ₹{effectiveStopFor(latest)} · Next target ₹{nextTarget}
        </p>
      )}
      {latest.closed && (
        <p className="px-4 pb-3.5 -mt-2 text-[11px] font-bold" style={{ color: exitPriceFor(latest) - latest.entry >= 0 ? "var(--color-buy)" : "var(--color-sell)" }}>
          Closed: {latest.status.replace(/_/g, " ")}
        </p>
      )}
    </div>
  );
}

export function AiLearn() {
  const [tab, setTab] = useState<LearnCategory>("candlestick");
  const [search, setSearch] = useState("");
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const createTrade = useCreateTrade();

  const crudePattern = usePatternPickForSymbol("CRUDEOIL");
  const ngPattern = usePatternPickForSymbol("NATURALGAS");
  const winner =
    crudePattern.pick && (!ngPattern.pick || crudePattern.pick.confidence >= ngPattern.pick.confidence)
      ? { symbol: "CRUDEOIL" as TradableSymbol, data: crudePattern }
      : ngPattern.pick
      ? { symbol: "NATURALGAS" as TradableSymbol, data: ngPattern }
      : null;

  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const patternTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("PATTERN-")) out[k] = v;
    return out;
  }, [tradeLogs]);
  const realized = useMemo(() => flattenClosedTrades(patternTradeLogsOnly), [patternTradeLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(patternTradeLogsOnly), [patternTradeLogsOnly]);

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
      {winner ? (
        <PatternCallCard
          symbol={winner.symbol}
          data={winner.data}
          tradeLogs={tradeLogs}
          loggedKey={loggedKey}
          setLoggedKey={setLoggedKey}
          copiedKey={copiedKey}
          setCopiedKey={setCopiedKey}
          createTrade={createTrade}
        />
      ) : (
        <div className="card p-4 text-center">
          <p className="text-xs font-bold">No AI-Learn pattern call right now</p>
          <p className="text-[11px] text-[var(--color-muted)] mt-1">
            Neither Crude Oil nor Natural Gas currently has one of the 6 cataloged candlestick patterns (Hammer, Shooting Star, Bullish/Bearish
            Engulfing, Pin Bar) confirmed by both structure and volume, across any of the 4 timeframes. Check back after the next candle close.
          </p>
        </div>
      )}

      <div className="card p-4">
        <p className="text-sm font-bold">AI-Learn</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          A reference library of candlestick patterns, chart patterns, and MCX Crude Oil / Natural Gas fundamentals — distilled for
          learning. The card above is a live, single best pick generated ONLY from the 6 candlestick patterns cataloged below (plus
          real structure and volume confirmation) — a separate, independently-tracked experiment to see how well this specific
          strategy performs versus this app's other engines. Everything else on this page is static reference only.
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

      <div className="card p-4">
        <p className="text-xs font-bold mb-1">Pattern Signal — Hit Ratio Report</p>
        <p className="text-[10px] text-[var(--color-muted)] mb-3">
          Tracked completely separately from AI Elite, the Directional Gate, Kimi, and Best Call's own records — this is purely the
          6-pattern strategy above, judged on its own, starting from zero the day this card shipped.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Hit Ratio" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "var(--color-buy)" : "var(--color-sell)"} />
        </div>
      </div>

      {dayStats.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-3">Pattern Signal — Day-wise Log</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[380px]">
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <th className="font-semibold pb-2">Date</th>
                  <th className="font-semibold pb-2">Target Hit</th>
                  <th className="font-semibold pb-2">Breakeven</th>
                  <th className="font-semibold pb-2">SL Hit</th>
                </tr>
              </thead>
              <tbody>
                {dayStats.map((d) => (
                  <tr key={d.dateKey} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-semibold">{d.label}</td>
                    <td className="py-2 font-bold text-[var(--color-buy)]">{d.targetHit}</td>
                    <td className="py-2 font-bold text-amber-600">{d.breakeven}</td>
                    <td className="py-2 font-bold text-[var(--color-sell)]">{d.slHit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2 bg-[var(--color-surface-soft)]">
      <p className="text-[9px] text-[var(--color-muted)]">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "inherit" }}>
        {value}
      </p>
    </div>
  );
}
