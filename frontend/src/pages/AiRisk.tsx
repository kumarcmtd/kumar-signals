import { useMemo, useState } from "react";
import { Flame, Zap, Wind, Volume2, Gauge, Copy, Info, TrendingUp, TrendingDown } from "lucide-react";
import { useMarketStatus } from "../api/hooks";
import { useMomentumBreakoutSuite, type BreakoutTimeframeResult } from "../hooks/useMomentumBreakoutSuite";
import { projectBreakoutPremium, type BreakoutEvaluation, type BreakoutQualified, type BreakoutPremiumProjection } from "../utils/momentumBreakoutEngine";
import { useTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import type { TradeLogEntry } from "../store/appStore";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { formatTipCard } from "../utils/tipFormat";
import type { Decision6 } from "../utils/timeframeEngine";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const SYMBOL_ACCENT: Record<TradableSymbol, string> = { CRUDEOIL: "#F59E0B", NATURALGAS: "#0EA5E9" };

const RANK_STYLE: { badgeBg: string; badgeText: string; ring: string; medal: string }[] = [
  { badgeBg: "linear-gradient(135deg,#FDE68A,#F59E0B)", badgeText: "#78350F", ring: "#F59E0B", medal: "🥇" },
  { badgeBg: "linear-gradient(135deg,#E2E8F0,#94A3B8)", badgeText: "#334155", ring: "#94A3B8", medal: "🥈" },
  { badgeBg: "linear-gradient(135deg,#F0B27A,#B5651D)", badgeText: "#4A2511", ring: "#C2703D", medal: "🥉" },
];
const DEFAULT_RANK = { badgeBg: "#EDE9FE", badgeText: "#5B21B6", ring: "#DDD6FE", medal: "" };

function tickMarks(count: number): string {
  if (count <= 0) return "○";
  if (count <= 3) return "✓".repeat(count);
  return `✓×${count}`;
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatExpiryTip(expiry: string | undefined): string {
  if (!expiry) return "—";
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

// Converts one timeframe's breakout read into the minimal shape useTradeLog()
// needs. "qualified" maps straight to STRONG BUY/STRONG SELL since a
// breakout that cleared every filter (squeeze/ATR expansion/volume/momentum)
// IS this engine's own highest-conviction call -- there's no weaker tier.
function pseudoAnalysisFor(r: BreakoutTimeframeResult): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" | null } {
  if (r.evaluation.status === "insufficient") return { tf: r.tf, decision: "WAIT", insufficient: r.evaluation.reason, optSide: null };
  if (r.evaluation.status === "wait") return { tf: r.tf, decision: "WAIT", insufficient: null, optSide: null };
  return { tf: r.tf, decision: r.evaluation.direction === "bullish" ? "STRONG BUY" : "STRONG SELL", insufficient: null, optSide: r.evaluation.direction === "bullish" ? "CE" : "PE" };
}

function projectionsFor(results: BreakoutTimeframeResult[], options: ReturnType<typeof useMomentumBreakoutSuite>["options"]): (BreakoutPremiumProjection | null)[] {
  return results.map((r) => {
    if (r.evaluation.status !== "qualified") return null;
    const optSide = r.evaluation.direction === "bullish" ? "CE" : "PE";
    return projectBreakoutPremium(r.evaluation, optSide, options);
  });
}

interface Candidate {
  symbol: TradableSymbol;
  tf: string;
  label: string;
  evaluation: BreakoutQualified;
  optSide: "CE" | "PE";
  trackingKey: string;
}

export function AiRisk() {
  const { data: market } = useMarketStatus();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const crudeOil = useMomentumBreakoutSuite("CRUDEOIL");
  const naturalGas = useMomentumBreakoutSuite("NATURALGAS");
  const board: Record<TradableSymbol, ReturnType<typeof useMomentumBreakoutSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };

  const crudeOilAnalyses = useMemo(() => crudeOil.results.map(pseudoAnalysisFor), [crudeOil.results]);
  const naturalGasAnalyses = useMemo(() => naturalGas.results.map(pseudoAnalysisFor), [naturalGas.results]);
  const crudeOilProjections = useMemo(() => projectionsFor(crudeOil.results, crudeOil.options), [crudeOil.results, crudeOil.options]);
  const naturalGasProjections = useMemo(() => projectionsFor(naturalGas.results, naturalGas.options), [naturalGas.results, naturalGas.options]);

  // Both symbols tick every render, same reason every other multi-symbol
  // page here does this -- an unselected tab's log must never stall.
  useTradeLog("CRUDEOIL", crudeOilAnalyses, crudeOilProjections, crudeOil.options, "AIRISK-CRUDEOIL");
  const tradeLogs = useTradeLog("NATURALGAS", naturalGasAnalyses, naturalGasProjections, naturalGas.options, "AIRISK-NATURALGAS");

  const ownTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("AIRISK-")) out[k] = v;
    return out;
  }, [tradeLogs]);

  const realized = useMemo(() => flattenClosedTrades(ownTradeLogsOnly), [ownTradeLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(ownTradeLogsOnly), [ownTradeLogsOnly]);

  const allClosed = useMemo(() => Object.values(ownTradeLogsOnly).flatMap((v) => v.filter((e) => e.closed)), [ownTradeLogsOnly]);
  const targetHitCount = allClosed.filter((e) => e.status === "target3_hit" || e.status === "stopped_after_t1").length;
  const slHitCount = allClosed.filter((e) => e.status === "sl_hit").length;
  const decidedCount = targetHitCount + slHitCount;
  const winRate = decidedCount > 0 ? Math.round((targetHitCount / decidedCount) * 100) : null;

  // The ranked leaderboard: every currently-qualified breakout across both
  // markets and all 4 timeframes, sorted by hit probability -- this page's
  // whole point is "don't make me pick a timeframe, just show me the best
  // rally to catch right now, ranked."
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const symbol of SYMBOLS) {
      const b = board[symbol];
      b.results.forEach((r) => {
        if (r.evaluation.status !== "qualified") return;
        out.push({
          symbol,
          tf: r.tf,
          label: r.label,
          evaluation: r.evaluation,
          optSide: r.evaluation.direction === "bullish" ? "CE" : "PE",
          trackingKey: `AIRISK-${symbol}-${r.tf}`,
        });
      });
    }
    return out.sort((a, b) => b.evaluation.confidence - a.evaluation.confidence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crudeOil.results, naturalGas.results, crudeOilProjections, naturalGasProjections]);

  // Every scanned combo (qualified + wait + insufficient) so the "why isn't
  // X ranked" question is always answerable, never a black box.
  const allScanned = useMemo(() => {
    const out: { symbol: TradableSymbol; tf: string; label: string; evaluation: BreakoutEvaluation }[] = [];
    for (const symbol of SYMBOLS) for (const r of board[symbol].results) out.push({ symbol, tf: r.tf, label: r.label, evaluation: r.evaluation });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crudeOil.results, naturalGas.results]);

  const allCalls = useMemo(() => {
    const out: { symbol: TradableSymbol; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(ownTradeLogsOnly)) {
      const symbol: TradableSymbol = k.startsWith("AIRISK-CRUDEOIL") ? "CRUDEOIL" : "NATURALGAS";
      for (const entry of v) out.push({ symbol, entry });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [ownTradeLogsOnly]);

  const anyLoading = crudeOil.loading || naturalGas.loading;

  return (
    <div className="space-y-4">
      {/* HERO */}
      <div className="rounded-3xl p-5 text-white shadow-lg" style={{ background: "linear-gradient(135deg,#F97316 0%,#EF4444 45%,#7C3AED 100%)" }}>
        <div className="flex items-center gap-2">
          <Flame size={22} />
          <h1 className="text-lg font-black tracking-tight">AI-Risk — Catch The Rally</h1>
        </div>
        <p className="text-[11px] text-white/90 mt-2 leading-relaxed">
          Every other engine in this app waits for multi-signal confluence before firing -- great for avoiding whipsaws, but structurally slow on a fast, one-directional crash or rally (that's why the
          natural gas PE move only got caught hours late). AI-Risk instead looks for a volatility squeeze + range breakout, confirmed by a real ATR expansion, above-average volume, and momentum in
          the breakout's own direction -- the classic setup for catching a big move at its start, not its tail.
        </p>
        <p className="text-[10px] text-white/70 mt-2 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-300" : "bg-white/50"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"} · Scanning both markets, 4 timeframes, every poll
        </p>
      </div>

      {/* STAT TILES */}
      <div className="grid grid-cols-4 gap-2">
        <ColorTile label="Closed Today" value={String(allClosed.length)} from="#DBEAFE" to="#EFF6FF" text="#1D4ED8" />
        <ColorTile label="Target Hit" value={String(targetHitCount)} from="#DCFCE7" to="#F0FDF4" text="#15803D" />
        <ColorTile label="SL Hit" value={String(slHitCount)} from="#FEE2E2" to="#FEF2F2" text="#B91C1C" />
        <ColorTile label="Win Rate" value={winRate !== null ? `${winRate}%` : "—"} from="#FEF3C7" to="#FFFBEB" text="#B45309" />
      </div>

      {/* RANKED LEADERBOARD */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={16} className="text-[#F59E0B]" />
          <p className="text-sm font-bold">Ranked By Hit Probability</p>
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mb-3">
          No timeframe to pick -- every qualifying breakout across both markets and all 4 timeframes, best chance first.
        </p>

        {candidates.length === 0 ? (
          <div className="text-center py-6">
            <Info size={26} className="mx-auto text-[var(--color-muted)] mb-2" />
            <p className="text-sm font-bold">No breakout qualifying right now</p>
            <p className="text-xs text-[var(--color-muted)] px-4 mt-1">
              {anyLoading ? "Scanning…" : "Neither market has cleared the squeeze + breakout + volume + momentum bar on any timeframe yet. Check back after the next candle close."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((c, i) => (
              <CandidateCard
                key={c.trackingKey}
                rank={i}
                candidate={c}
                options={board[c.symbol].options}
                tradeLogs={tradeLogs}
                copiedKey={copiedKey}
                setCopiedKey={setCopiedKey}
              />
            ))}
          </div>
        )}
      </div>

      {/* LIVE SCAN STATUS */}
      <div className="card p-4">
        <p className="text-xs font-bold mb-3">Live Scan Status</p>
        <div className="space-y-1.5">
          {allScanned.map(({ symbol, tf, label, evaluation }) => (
            <div key={`${symbol}-${tf}`} className="flex items-center justify-between gap-2 text-[11px] rounded-lg px-2.5 py-2 bg-[var(--color-surface-soft)]">
              <span className="font-semibold flex items-center gap-1.5 shrink-0">
                <span className="w-2 h-2 rounded-full" style={{ background: SYMBOL_ACCENT[symbol] }} />
                {DISPLAY_NAME[symbol]} · {label}
              </span>
              <span
                className="text-right truncate"
                style={{ color: evaluation.status === "qualified" ? (evaluation.direction === "bullish" ? "var(--color-buy)" : "var(--color-sell)") : "var(--color-muted)" }}
              >
                {evaluation.status === "qualified" ? `${evaluation.direction === "bullish" ? "CE" : "PE"} Breakout · ${evaluation.confidence}%` : evaluation.status === "insufficient" ? "No data" : evaluation.reason}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* TRACK RECORD */}
      <div className="card p-4">
        <p className="text-xs font-bold mb-3">AI-Risk Track Record</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "var(--color-buy)" : "var(--color-sell)"} />
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mt-2">Tracked separately from every other page's own trade log, starting from zero the day this page shipped.</p>
      </div>

      {/* CALL HISTORY */}
      {allCalls.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-1">Call History</p>
          <p className="text-[10px] text-[var(--color-muted)] mb-3">
            Every AI-Risk call ever made, newest first — exact time and price it was called, and once closed, exact time and price of whichever target/breakeven/stop rule actually closed it.
          </p>
          <div className="space-y-2">
            {allCalls.map(({ symbol, entry }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* DAY-WISE LOG */}
      {dayStats.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-3">Day-wise Log</p>
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

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2 flex items-start gap-1.5 justify-center">
        <Info size={12} className="shrink-0 mt-0.5" /> Educational reference only, not financial advice. A looser, faster-firing engine by design means more signals than the other pages -- and more
        false breakouts too. Always confirm on the live chart before acting.
      </p>
    </div>
  );
}

function ColorTile({ label, value, from, to, text }: { label: string; value: string; from: string; to: string; text: string }) {
  return (
    <div className="rounded-2xl px-2.5 py-2.5 text-center" style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}>
      <p className="text-[9px] font-semibold" style={{ color: text, opacity: 0.75 }}>
        {label}
      </p>
      <p className="text-sm font-black" style={{ color: text }}>
        {value}
      </p>
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

function CandidateCard({
  rank,
  candidate,
  options,
  tradeLogs,
  copiedKey,
  setCopiedKey,
}: {
  rank: number;
  candidate: Candidate;
  options: ReturnType<typeof useMomentumBreakoutSuite>["options"];
  tradeLogs: Record<string, TradeLogEntry[]>;
  copiedKey: string | null;
  setCopiedKey: (k: string | null) => void;
}) {
  const style = RANK_STYLE[rank] ?? DEFAULT_RANK;
  const { symbol, evaluation, optSide, trackingKey } = candidate;
  const log = tradeLogs[trackingKey] ?? [];
  const latest = log[log.length - 1];
  const bullish = evaluation.direction === "bullish";
  const Bias = bullish ? TrendingUp : TrendingDown;
  const biasColor = bullish ? "var(--color-buy)" : "var(--color-sell)";
  const liveLtp = latest && !latest.closed ? liveLtpFor(options, latest.strike, latest.optSide) : null;

  const tip =
    latest &&
    formatTipCard({
      symbolLabel: DISPLAY_NAME[symbol],
      strike: latest.strike,
      optSide: latest.optSide,
      expiryLabel: formatExpiryTip(options?.expiry),
      buyZoneLow: latest.entry,
      buyZoneHigh: Number((latest.entry * 1.02).toFixed(2)),
      targets: latest.targets,
      stopLoss: latest.stop,
    });

  return (
    <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: style.ring }}>
      <div className="px-3.5 py-2 flex items-center justify-between" style={{ background: style.badgeBg }}>
        <span className="text-xs font-black flex items-center gap-1.5" style={{ color: style.badgeText }}>
          {style.medal || `#${rank + 1}`} Rank {rank + 1}
        </span>
        <span className="text-xs font-black" style={{ color: style.badgeText }}>
          {evaluation.confidence}% Hit Probability
        </span>
      </div>
      <div className="p-3.5 space-y-2.5 bg-[var(--color-surface)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black flex items-center gap-1.5">
            <Bias size={15} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol]} · {candidate.label} · {optSide}
            {latest ? ` ${latest.strike}` : ""}
          </p>
          {liveLtp !== null && (
            <p className="text-sm font-black" style={{ color: biasColor }}>
              ₹{liveLtp}
            </p>
          )}
        </div>

        {latest && (
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <MiniStat label="Entry" value={`₹${latest.entry}`} />
            <MiniStat label="T1" value={`₹${latest.targets[0]}`} />
            <MiniStat label="T2" value={`₹${latest.targets[1]}`} />
            <MiniStat label="SL" value={`₹${latest.stop}`} tone="down" />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Chip icon={Wind} text={`ATR ${evaluation.atrExpansionRatio}x`} />
          <Chip icon={Volume2} text={`Vol ${evaluation.volumeRatio}x`} />
          <Chip icon={Gauge} text={`Momentum ${evaluation.rocPct > 0 ? "+" : ""}${evaluation.rocPct}%`} />
          {evaluation.squeezeDetected && <Chip icon={Zap} text="Squeeze release" />}
        </div>

        {latest && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-muted)]">
            <span className={latest.targetsHit[0] ? "text-[var(--color-buy)] font-semibold" : ""}>
              {tickMarks(latest.targetTouches?.[0] ?? (latest.targetsHit[0] ? 1 : 0))} T1
            </span>
            <span className={latest.targetsHit[1] ? "text-[var(--color-buy)] font-semibold" : ""}>
              {tickMarks(latest.targetTouches?.[1] ?? (latest.targetsHit[1] ? 1 : 0))} T2
            </span>
            <span className={latest.targetsHit[2] ? "text-[var(--color-buy)] font-semibold" : ""}>
              {tickMarks(latest.targetTouches?.[2] ?? (latest.targetsHit[2] ? 1 : 0))} T3 ₹{latest.targets[2]}
            </span>
            {!latest.closed && <span className="ml-auto font-bold animate-pulse" style={{ color: "#B91C1C" }}>LIVE</span>}
            {latest.closed && <span className="ml-auto font-bold">{latest.status.replace(/_/g, " ")}</span>}
          </div>
        )}

        {tip && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(tip);
              setCopiedKey(trackingKey);
              setTimeout(() => setCopiedKey(null), 2000);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-[var(--color-surface-soft)]"
          >
            <Copy size={12} />
            {copiedKey === trackingKey ? "Copied ✓" : "Copy Tip"}
          </button>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "down" }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-soft)] px-1.5 py-1.5">
      <p className="text-[8px] text-[var(--color-muted)]">{label}</p>
      <p className="text-[11px] font-bold" style={{ color: tone === "down" ? "var(--color-sell)" : "inherit" }}>
        {value}
      </p>
    </div>
  );
}

function Chip({ icon: Icon, text }: { icon: typeof Wind; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-[var(--color-surface-soft)] text-[var(--color-muted)]">
      <Icon size={10} />
      {text}
    </span>
  );
}

function CallHistoryRow({ symbol, entry }: { symbol: TradableSymbol; entry: TradeLogEntry }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "var(--color-buy)" : pnl !== null && pnl < 0 ? "var(--color-sell)" : "#B45309";

  return (
    <div className="rounded-xl border border-[var(--color-border)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">
            Called {fmtWhen(entry.openedAt)} at ₹{entry.entry}
            {entry.closed && entry.closedAt !== null && (
              <>
                {" "}
                · Closed {fmtWhen(entry.closedAt)} at ₹{exit}
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-bold" style={{ color: statusColor }}>
            {statusLabel}
          </p>
          {pnl !== null && (
            <p className="text-[10px] text-[var(--color-muted)]">
              {pnl >= 0 ? "+" : ""}
              {pnl} pts
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-[var(--color-muted)]">
        <span className={entry.targetsHit[0] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))} T3 ₹{entry.targets[2]}
        </span>
        <span>SL ₹{entry.stop}</span>
      </div>
    </div>
  );
}
