import { useMemo } from "react";
import { Rocket, TrendingUp, TrendingDown, Sparkles, Target, ShieldCheck, Layers } from "lucide-react";
import { useMarketStatus, usePortfolio } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import { useHitScoreSuite } from "../hooks/useHitScoreSuite";
import { scanForHitScoreCalls, HIT_SCORE_MIN, type HitScoreCandidate } from "../utils/hitScoreEngine";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import type { TradeLogEntry, TradeLogStatus } from "../store/appStore";
import type { TimeframeAnalysis, Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

interface ShootPremium {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Same delta~=0.5 ATM premium projection every other page in this app
// already uses, kept as this page's own independent copy.
function projectPremium(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): ShootPremium | null {
  if (!options || options.error || !analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const DELTA = 0.5;
  const favMove = Math.abs(analysis.underlyingTargets[0] - analysis.underlyingEntry);
  const riskMove = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + DELTA * favMove).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[1] - analysis.underlyingEntry)).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[2] - analysis.underlyingEntry)).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop, rr };
}

const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
};
const STATUS_COLOR: Record<TradeLogStatus, string> = {
  running: "text-sky-600",
  sl_hit: "text-rose-500",
  stopped_breakeven: "text-lime-600",
  stopped_after_t1: "text-emerald-600",
  target3_hit: "text-emerald-600",
};

function fmtLogTime(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function hitScoreColor(score: number): string {
  if (score >= 98) return "#EAB308"; // gold -- near perfect
  if (score >= 95) return "#EC4899"; // pink -- excellent
  return "#F97316"; // orange -- the 90-94 qualifying floor
}

function ShootTradeLogLine({ entry, liveLtp }: { entry: TradeLogEntry; liveLtp: number | null }) {
  const dulled = entry.closed;
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
        <span>SL ₹{entry.stop}</span>
      </div>
      {!dulled && liveLtp !== null && <p className="text-[10px] text-slate-400 mt-1">Current premium: ₹{liveLtp}</p>}
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

function ShootCallCard({ call, tradeLogs, options, keyPrefix }: { call: HitScoreCandidate; tradeLogs: Record<string, TradeLogEntry[]>; options: OptionsAnalytics | undefined; keyPrefix: string }) {
  const bullish = call.analysis.bias === "bullish";
  const accent = bullish ? "#10B981" : "#EF4444";
  const symbolKey = call.symbol as TradableSymbol;
  const log = tradeLogs[`${keyPrefix}-${symbolKey}-${call.analysis.tf}`] ?? [];
  const latest = log[log.length - 1];
  const openTrade = latest && !latest.closed ? latest : undefined;
  const liveLtp = openTrade ? liveLtpFor(options, openTrade.strike, openTrade.optSide) : null;

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-start justify-between gap-3" style={{ background: bullish ? "linear-gradient(135deg,#ECFDF5,#FFFFFF)" : "linear-gradient(135deg,#FEF2F2,#FFFFFF)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {DISPLAY_NAME[symbolKey]} · {call.analysis.label}
          </p>
          <p className="text-lg font-black flex items-center gap-1.5" style={{ color: accent }}>
            {bullish ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {call.analysis.optSide} Buy Call
          </p>
          {latest && (
            <p className="text-sm font-bold text-slate-700 mt-0.5">
              {latest.strike} {latest.optSide} · Entry ₹{latest.entry}
            </p>
          )}
        </div>
        <div className="text-center shrink-0">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-lg shadow" style={{ background: hitScoreColor(call.hitScore) }}>
            {call.hitScore}
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-1">Hit Score</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Stop Loss" value={latest ? `₹${latest.stop}` : "—"} color="#EF4444" />
          <MiniStat label="Target 1" value={latest ? `₹${latest.targets[0]}` : "—"} color="#10B981" />
          <MiniStat label="R:R" value={`1:${call.rr}`} color="#6366F1" />
          <MiniStat label="Target 2" value={latest ? `₹${latest.targets[1]}` : "—"} color="#10B981" />
          <MiniStat label="Target 3" value={latest ? `₹${latest.targets[2]}` : "—"} color="#10B981" />
          <MiniStat label="Live Premium" value={liveLtp !== null ? `₹${liveLtp}` : "—"} color="#0EA5E9" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">Why this made the cut</p>
          {call.breakdown.map((b) => (
            <div key={b.label} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 w-40 shrink-0">{b.label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.points / b.max) * 100}%`, background: accent }} />
              </div>
              <span className="text-[10px] font-bold text-slate-600 w-10 text-right">
                {b.points}/{b.max}
              </span>
            </div>
          ))}
          {call.confirmingTimeframes.length > 0 && (
            <p className="text-[11px] text-slate-500 flex items-start gap-1.5 pt-1">
              <ShieldCheck size={12} className="shrink-0 mt-0.5 text-emerald-500" /> Confirmed by: {call.confirmingTimeframes.join(", ")}
            </p>
          )}
          {call.orderBlockAligned && (
            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <Layers size={12} className="shrink-0 mt-0.5 text-indigo-500" /> Recent smart-money order block aligns with this direction
            </p>
          )}
        </div>

        {log.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Trade Log (newest first)</p>
            {[...log].reverse().map((entry) => (
              <ShootTradeLogLine key={entry.id} entry={entry} liveLtp={entry.id === openTrade?.id ? liveLtp : null} />
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

export function AiShoot() {
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const crudeOil = useHitScoreSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useHitScoreSuite("NATURALGAS", journalSummary.winRate);
  const board: Record<TradableSymbol, ReturnType<typeof useHitScoreSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };

  const calls = useMemo(() => {
    const entries = [
      ...crudeOil.entries.map((e) => ({ symbol: "CRUDEOIL", analysis: e.analysis, candles: e.candles })),
      ...naturalGas.entries.map((e) => ({ symbol: "NATURALGAS", analysis: e.analysis, candles: e.candles })),
    ];
    return scanForHitScoreCalls(entries);
  }, [crudeOil.entries, naturalGas.entries]);

  const keyPrefix = "SHOOT";
  const crudeOilAnalyses = useMemo(
    () =>
      crudeOil.entries.map((e): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" | null } => {
        const qualifies = calls.some((c) => c.symbol === "CRUDEOIL" && c.analysis.tf === e.tf);
        return {
          tf: e.tf,
          decision: qualifies ? (e.analysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT",
          insufficient: e.analysis.insufficient,
          optSide: e.analysis.optSide,
        };
      }),
    [crudeOil.entries, calls]
  );
  const naturalGasAnalyses = useMemo(
    () =>
      naturalGas.entries.map((e): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" | null } => {
        const qualifies = calls.some((c) => c.symbol === "NATURALGAS" && c.analysis.tf === e.tf);
        return {
          tf: e.tf,
          decision: qualifies ? (e.analysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT",
          insufficient: e.analysis.insufficient,
          optSide: e.analysis.optSide,
        };
      }),
    [naturalGas.entries, calls]
  );
  const crudeOilProjections = useMemo(() => crudeOil.entries.map((e) => projectPremium(e.analysis, crudeOil.options)), [crudeOil.entries, crudeOil.options]);
  const naturalGasProjections = useMemo(() => naturalGas.entries.map((e) => projectPremium(e.analysis, naturalGas.options)), [naturalGas.entries, naturalGas.options]);

  useTradeLog("CRUDEOIL", crudeOilAnalyses, crudeOilProjections, crudeOil.options, `${keyPrefix}-CRUDEOIL`);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGasAnalyses, naturalGasProjections, naturalGas.options, `${keyPrefix}-NATURALGAS`);

  const dayStats = useMemo(() => summarizeTradeLogsByDay(tradeLogs), [tradeLogs]);
  const anyLiveDataUnavailable = crudeOil.liveDataUnavailable || naturalGas.liveDataUnavailable;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-5" style={{ background: "linear-gradient(180deg,#FFF7ED,#FDF4FF 35%,#F0F9FF 70%,#ECFDF5)" }}>
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Rocket size={24} className="text-orange-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 bg-clip-text text-transparent">AI-Shoot</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-4">
          Every market, every timeframe, every direction scanned continuously — no fixed symbol, no fixed CE/PE, no fixed timeframe, no fixed number of calls. Only setups that clear a{" "}
          <span className="font-bold text-slate-700">{HIT_SCORE_MIN}+ Hit Score</span> (price action + value zone + volume + momentum + cross-timeframe confirmation + smart-money order-block alignment,
          zero vetoes, 1:1.5+ reward-to-risk) ever show up here. Some days that's zero, some days a few — best of the best only.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Markets Scanned" value="2" gradient="linear-gradient(135deg,#6366F1,#8B5CF6)" />
        <StatTile label="Timeframes Scanned" value="4" gradient="linear-gradient(135deg,#0EA5E9,#06B6D4)" />
        <StatTile label="Qualifying Now" value={String(calls.length)} gradient="linear-gradient(135deg,#F97316,#EC4899)" />
      </div>

      {anyLiveDataUnavailable && (
        <div className="rounded-2xl bg-white border border-rose-200 p-4 text-center shadow-sm">
          <p className="text-sm font-bold text-rose-500">Live data unavailable</p>
          <p className="text-xs text-slate-500 mt-1">Option chain unreachable for one or both markets — no entry, target, stop loss, or Hit Score is fabricated while this is down.</p>
        </div>
      )}

      {calls.length === 0 ? (
        <section className="rounded-3xl bg-white shadow-md p-8 text-center space-y-2">
          <Sparkles size={28} className="mx-auto text-orange-400" />
          <p className="text-sm font-bold text-slate-700">No {HIT_SCORE_MIN}+ Hit Score call right now</p>
          <p className="text-xs text-slate-500 px-4">
            AI-Shoot only ever shows the best of the best across both markets and all four timeframes (15m/30m/1H/4H). Nothing has cleared the bar this poll — check back shortly, or a stronger
            setup may already be showing on AI Elite or AI-Test Pro's spotlight.
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <ShootCallCard key={`${call.symbol}-${call.analysis.tf}`} call={call} tradeLogs={tradeLogs} options={board[call.symbol as TradableSymbol].options} keyPrefix={keyPrefix} />
          ))}
        </div>
      )}

      {/* DAY-WISE TRADE LOG */}
      <section className="rounded-3xl bg-white shadow-md p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-slate-500 mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-purple-500" /> Day-wise Trade Log — Both Symbols
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
        Educational reference only, not financial advice. Entry/stop/target/Hit Score numbers are always computed deterministically from real live data. A strict, uncapped-frequency filter means the
        number of calls varies day to day by design — always confirm on the live chart before acting.
      </p>
    </div>
  );
}
