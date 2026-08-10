import { useMemo } from "react";
import { Target, TrendingUp, TrendingDown, Gauge, ListChecks } from "lucide-react";
import { useMarketStatus, usePortfolio } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useTradeLog, liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { useHitScoreSuite } from "../hooks/useHitScoreSuite";
import { scanForAiTwenty, projectPremium20, type AiTwentyCandidate } from "../utils/aiTwentyTwentyEngine";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import type { TradeLogEntry, TradeLogStatus } from "../store/appStore";
import type { Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
  closed_manual: "Closed Manually",
};
const STATUS_COLOR: Record<TradeLogStatus, string> = {
  running: "text-sky-600",
  sl_hit: "text-rose-500",
  stopped_breakeven: "text-lime-600",
  stopped_after_t1: "text-emerald-600",
  target3_hit: "text-emerald-600",
  closed_manual: "text-slate-500",
};

function fmtLogTime(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function TwentyTradeLogLine({ entry, liveLtp }: { entry: TradeLogEntry; liveLtp: number | null }) {
  const dulled = entry.closed;
  const effStop = effectiveStopFor(entry);
  const nextTarget = entry.targetsHit[1] ? entry.targets[2] : entry.targetsHit[0] ? entry.targets[1] : entry.targets[0];
  const legFloor = entry.targetsHit[1] ? entry.targets[1] : entry.targetsHit[0] ? entry.targets[0] : entry.entry;
  const entryTiming = !dulled && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;
  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-opacity ${dulled ? "opacity-50 bg-slate-50 border-slate-200" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">
          {entry.strike} {entry.optSide} · Entry ₹{entry.entry}
        </span>
        <span className={`text-[10px] font-bold shrink-0 ${STATUS_COLOR[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
      </div>
      <p className="text-[9px] text-slate-400 mt-1">
        Called {fmtLogTime(entry.openedAt)}
        {entry.closedAt !== null ? ` · Closed ${fmtLogTime(entry.closedAt)}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-500">
        <span className={entry.targetsHit[0] ? "text-emerald-600 font-semibold" : ""}>
          {entry.targetsHit[0] ? "✓" : "○"} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-emerald-600 font-semibold" : ""}>
          {entry.targetsHit[1] ? "✓" : "○"} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-emerald-600 font-semibold" : ""}>
          {entry.targetsHit[2] ? "✓" : "○"} T3 ₹{entry.targets[2]}
        </span>
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="opacity-60"> (was ₹{entry.stop})</span>}
        </span>
      </div>
      {!dulled && liveLtp !== null && <p className="text-[10px] text-slate-400 mt-1">Current premium: ₹{liveLtp}</p>}
      {entryTiming && <EntryTimingBadge verdict={entryTiming} theme="light" className="mt-1.5" />}
    </div>
  );
}

function StatTile({ label, value, gradient }: { label: string; value: string; gradient: string }) {
  return (
    <div className="rounded-2xl p-3 text-center text-white shadow-sm" style={{ background: gradient }}>
      <p className="text-[9px] font-bold uppercase opacity-80">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: score >= 60 ? "#10B981" : score <= 40 ? "#EF4444" : "#F59E0B" }} />
      </div>
      <span className="text-[10px] font-bold text-slate-600 w-8 text-right">{Math.round(score)}</span>
    </div>
  );
}

function TwentyCandidateCard({ candidate, tradeLogs, options, keyPrefix }: { candidate: AiTwentyCandidate; tradeLogs: Record<string, TradeLogEntry[]>; options: OptionsAnalytics | undefined; keyPrefix: string }) {
  const bullish = candidate.analysis.bias === "bullish";
  const accent = bullish ? "#0EA5E9" : "#F43F5E";
  const symbolKey = candidate.symbol as TradableSymbol;
  const log = tradeLogs[`${keyPrefix}-${symbolKey}-${candidate.analysis.tf}`] ?? [];
  const latest = log[log.length - 1];
  const openTrade = latest && !latest.closed ? latest : undefined;
  const liveLtp = openTrade ? liveLtpFor(options, openTrade.strike, openTrade.optSide) : null;
  const heroNextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : null;
  const heroLegFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : null;
  const heroEntryTiming = liveLtp !== null && heroNextTarget !== null && heroLegFloor !== null && latest ? evaluateEntryTiming(heroLegFloor, heroNextTarget, effectiveStopFor(latest), liveLtp) : null;
  const categories = candidate.analysis.categories;

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-start justify-between gap-3" style={{ background: bullish ? "linear-gradient(135deg,#EFF6FF,#FFFFFF)" : "linear-gradient(135deg,#FFF1F2,#FFFFFF)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {DISPLAY_NAME[symbolKey]} · {candidate.analysis.label}
          </p>
          <p className="text-lg font-black flex items-center gap-1.5" style={{ color: accent }}>
            {bullish ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {candidate.analysis.optSide} Quick +20
          </p>
          {latest && (
            <p className="text-sm font-bold text-slate-700 mt-0.5">
              {latest.strike} {latest.optSide} · Entry ₹{latest.entry}
            </p>
          )}
        </div>
        <div className="text-center shrink-0">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-sm shadow" style={{ background: accent }}>
            +20
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-1">Target 1</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Stop Loss" value={latest ? `₹${effectiveStopFor(latest)}` : "—"} color="#EF4444" />
          <MiniStat label="Target 1 (+20)" value={latest ? `₹${latest.targets[0]}` : "—"} color="#0EA5E9" />
          <MiniStat label="Target 2 (+32)" value={latest ? `₹${latest.targets[1]}` : "—"} color="#0EA5E9" />
          <MiniStat label="Target 3 (+45)" value={latest ? `₹${latest.targets[2]}` : "—"} color="#0EA5E9" />
          <MiniStat label="Live Premium" value={liveLtp !== null ? `₹${liveLtp}` : "—"} color="#6366F1" />
          <MiniStat label="Status" value={openTrade ? "Running" : latest ? "Closed" : "—"} color="#64748B" />
        </div>
        {heroEntryTiming && <EntryTimingBadge verdict={heroEntryTiming} theme="light" />}

        {categories && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Why this qualified</p>
            <CategoryBar label="Trend" score={bullish ? categories.trend.score : 100 - categories.trend.score} />
            <CategoryBar label="Momentum" score={bullish ? categories.momentum.score : 100 - categories.momentum.score} />
            <CategoryBar label="Price Action" score={bullish ? categories.priceAction.score : 100 - categories.priceAction.score} />
            <CategoryBar label="Volume" score={bullish ? categories.volume.score : 100 - categories.volume.score} />
            <CategoryBar label="Support/Resistance" score={bullish ? categories.supportResistance.score : 100 - categories.supportResistance.score} />
          </div>
        )}
        <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <ListChecks size={12} className="shrink-0 mt-0.5 text-sky-500" /> {candidate.reason}
        </p>

        {log.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Trade Log (newest first)</p>
            {[...log].reverse().map((entry) => (
              <TwentyTradeLogLine key={entry.id} entry={entry} liveLtp={entry.id === openTrade?.id ? liveLtp : null} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="text-xs font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

export function AiTwentyTwenty() {
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const crudeOil = useHitScoreSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useHitScoreSuite("NATURALGAS", journalSummary.winRate);
  const board: Record<TradableSymbol, ReturnType<typeof useHitScoreSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };

  const candidates = useMemo(() => {
    const entries = [
      ...crudeOil.entries.map((e) => ({ symbol: "CRUDEOIL", analysis: e.analysis })),
      ...naturalGas.entries.map((e) => ({ symbol: "NATURALGAS", analysis: e.analysis })),
    ];
    return scanForAiTwenty(entries);
  }, [crudeOil.entries, naturalGas.entries]);

  const keyPrefix = "TWENTY20";
  const crudeOilAnalyses = useMemo(
    () =>
      crudeOil.entries.map((e): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" | null } => {
        const qualifies = candidates.some((c) => c.symbol === "CRUDEOIL" && c.analysis.tf === e.tf);
        return { tf: e.tf, decision: qualifies ? (e.analysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT", insufficient: e.analysis.insufficient, optSide: e.analysis.optSide };
      }),
    [crudeOil.entries, candidates]
  );
  const naturalGasAnalyses = useMemo(
    () =>
      naturalGas.entries.map((e): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" | null } => {
        const qualifies = candidates.some((c) => c.symbol === "NATURALGAS" && c.analysis.tf === e.tf);
        return { tf: e.tf, decision: qualifies ? (e.analysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT", insufficient: e.analysis.insufficient, optSide: e.analysis.optSide };
      }),
    [naturalGas.entries, candidates]
  );
  const crudeOilProjections = useMemo(() => crudeOil.entries.map((e) => projectPremium20(e.analysis, crudeOil.options)), [crudeOil.entries, crudeOil.options]);
  const naturalGasProjections = useMemo(() => naturalGas.entries.map((e) => projectPremium20(e.analysis, naturalGas.options)), [naturalGas.entries, naturalGas.options]);

  useTradeLog("CRUDEOIL", crudeOilAnalyses, crudeOilProjections, crudeOil.options, `${keyPrefix}-CRUDEOIL`);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGasAnalyses, naturalGasProjections, naturalGas.options, `${keyPrefix}-NATURALGAS`);

  const twentyTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith(`${keyPrefix}-`)) out[k] = v;
    return out;
  }, [tradeLogs]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(twentyTradeLogsOnly), [twentyTradeLogsOnly]);
  const anyLiveDataUnavailable = crudeOil.liveDataUnavailable || naturalGas.liveDataUnavailable;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-5" style={{ background: "linear-gradient(180deg,#EFF6FF,#F0FDFA 40%,#F8FAFC)" }}>
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Target size={24} className="text-sky-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 bg-clip-text text-transparent">Ai20-20</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-4">
          Best Call and AI Verify Pro are deliberately strict and go quiet once a call closes or runs past its move -- Ai20-20 fills that gap. A modest, flat <span className="font-bold text-slate-700">+20 premium point target</span> is
          "enough" here: any clean directional read (at most one minor caution) across either market and all four timeframes qualifies, so this page fires far more often.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Markets Scanned" value="2" gradient="linear-gradient(135deg,#0EA5E9,#06B6D4)" />
        <StatTile label="Timeframes Scanned" value="4" gradient="linear-gradient(135deg,#06B6D4,#10B981)" />
        <StatTile label="Qualifying Now" value={String(candidates.length)} gradient="linear-gradient(135deg,#6366F1,#0EA5E9)" />
      </div>

      {anyLiveDataUnavailable && (
        <div className="rounded-2xl bg-white border border-rose-200 p-4 text-center shadow-sm">
          <p className="text-sm font-bold text-rose-500">Live data unavailable</p>
          <p className="text-xs text-slate-500 mt-1">Option chain unreachable for one or both markets — no entry, target, or stop loss is fabricated while this is down.</p>
        </div>
      )}

      {candidates.length === 0 ? (
        <section className="rounded-3xl bg-white shadow-md p-8 text-center space-y-2">
          <Gauge size={28} className="mx-auto text-sky-400 animate-pulse" />
          <p className="text-base font-black text-slate-700">No Quick +20 Setup Right Now</p>
          <p className="text-xs text-slate-500 px-4">Still scanning both markets across all four timeframes (15m/30m/1H/4H) every poll — nothing has a clean directional read yet. Check back shortly.</p>
        </section>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <TwentyCandidateCard key={`${c.symbol}-${c.analysis.tf}`} candidate={c} tradeLogs={tradeLogs} options={board[c.symbol as TradableSymbol].options} keyPrefix={keyPrefix} />
          ))}
        </div>
      )}

      {/* DAY-WISE TRADE LOG */}
      <section className="rounded-3xl bg-white shadow-md p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-slate-500 mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-sky-500" /> Day-wise Trade Log — Both Symbols
        </p>
        <p className="text-[10px] text-slate-400 mb-3">One MCX session = 9:00am – 11:55pm IST. Counts every closed trade across both markets and all four timeframes.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-3">No trades have closed yet — this fills in as calls run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-slate-100">
                  <td className="py-2 font-semibold text-slate-700">{d.label}</td>
                  <td className="py-2 font-bold text-emerald-600">{d.targetHit}</td>
                  <td className="py-2 font-bold text-lime-600">{d.breakeven}</td>
                  <td className="py-2 font-bold text-rose-500">{d.slHit}</td>
                  <td className="py-2 text-slate-500">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Entry/stop/target numbers are always computed deterministically from real live data. A lower, more frequent bar means more signals but a
        weaker edge per signal than Best Call -- always confirm on the live chart before acting.
      </p>
    </div>
  );
}
