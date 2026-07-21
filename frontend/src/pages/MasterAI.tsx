import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useCandles, useOptionsAnalytics, useSignal } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { useJournalStore, journalStats } from "../store/journalStore";
import { computeMasterAI, type Decision } from "../utils/masterEngine";
import { MeterBar } from "../components/MeterBar";
import { CardSkeleton } from "../components/Skeleton";
import type { InstrumentSymbol } from "../types";

const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };

const decisionStyle: Record<Decision, { bg: string; text: string }> = {
  "STRONG BUY": { bg: "bg-gradient-to-br from-emerald-600 to-emerald-500", text: "text-white" },
  BUY: { bg: "bg-gradient-to-br from-emerald-500 to-emerald-400", text: "text-white" },
  "BUY ON DIP": { bg: "bg-gradient-to-br from-emerald-300 to-emerald-200", text: "text-emerald-900" },
  WAIT: { bg: "bg-gradient-to-br from-amber-300 to-amber-200", text: "text-amber-900" },
  "NO TRADE": { bg: "bg-gradient-to-br from-slate-300 to-slate-200", text: "text-slate-700" },
  "SELL ON RISE": { bg: "bg-gradient-to-br from-rose-300 to-rose-200", text: "text-rose-900" },
  SELL: { bg: "bg-gradient-to-br from-rose-500 to-rose-400", text: "text-white" },
  "STRONG SELL": { bg: "bg-gradient-to-br from-rose-600 to-rose-500", text: "text-white" },
};

export function MasterAI() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const { risk } = useAppStore();
  const { logSignal, entries } = useJournalStore();

  const c1D = useCandles(symbol, "1D");
  const c30 = useCandles(symbol, "30");
  const c15 = useCandles(symbol, "15");
  const c5 = useCandles(symbol, "5");
  const { data: options } = useOptionsAnalytics(symbol);
  const { data: signal } = useSignal(symbol);

  const loading = c1D.isLoading || c30.isLoading || c15.isLoading || c5.isLoading;
  const ready = c1D.data && c30.data && c15.data && c5.data;

  const result = useMemo(() => {
    if (!ready) return null;
    return computeMasterAI({
      candlesByTf: { "1D": c1D.data!.candles, "30": c30.data!.candles, "15": c15.data!.candles, "5": c5.data!.candles },
      options,
      signal,
    });
  }, [ready, c1D.data, c30.data, c15.data, c5.data, options, signal]);

  useEffect(() => {
    if (!result) return;
    logSignal({
      symbol,
      decision: result.decision,
      confidence: result.overallScore,
      strike: result.strike,
      optSide: result.optSide,
      entry: result.entry,
      stop: result.stop,
      target1: result.target1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.decision, result?.strike, result?.optSide, symbol]);

  const symbolEntries = entries.filter((e) => e.symbol === symbol);
  const stats = journalStats(entries);

  const riskAmount = (risk.capital * risk.riskPercent) / 100;
  const perUnitRisk = result?.entry !== null && result?.entry !== undefined && result?.stop !== null && result?.stop !== undefined ? Math.abs(result.entry - result.stop) : null;
  const lotSize = LOT_SIZE[symbol];
  const lots = perUnitRisk && perUnitRisk > 0 ? Math.floor(riskAmount / perUnitRisk / lotSize) : null;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-sm font-bold">Master AI — Confluence Signal Engine</p>
        <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
          Never fires from one indicator. Combines multi-timeframe trend, momentum, volatility, volume/OI, price action,
          smart-money structure, and the option chain — a trade only appears when several of these independently agree.
          Weak or conflicting confluence returns <span className="font-semibold">NO TRADE</span> on purpose.
        </p>
      </div>

      <div className="flex gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-xl py-2 text-sm font-bold ${
              symbol === sym ? "bg-gradient-to-r from-orange-500 to-pink-600 text-white" : "bg-white card text-[var(--color-muted)]"
            }`}
          >
            {sym}
          </button>
        ))}
      </div>

      {loading && <CardSkeleton />}

      {result && (
        <>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`card overflow-hidden`}>
            <div className={`p-4 ${decisionStyle[result.decision].bg}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-2xl font-black ${decisionStyle[result.decision].text}`}>{result.decision}</p>
                  <p className={`text-xs mt-0.5 ${decisionStyle[result.decision].text} opacity-90`}>
                    {symbol}
                    {result.strike ? ` ${result.strike} ${result.optSide}` : ""} · {result.sentiment}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-3xl font-black ${decisionStyle[result.decision].text}`}>{result.overallScore}</p>
                  <p className={`text-[10px] ${decisionStyle[result.decision].text} opacity-90`}>{result.confidenceLabel}</p>
                </div>
              </div>
            </div>

            {result.reasons.length > 0 && (
              <div className="p-4 space-y-1.5">
                <p className="text-[11px] font-bold text-[var(--color-muted)] uppercase">Why</p>
                {result.reasons.slice(0, 8).map((r, i) => (
                  <p key={i} className="text-xs text-black/70 leading-relaxed">
                    • {r}
                  </p>
                ))}
              </div>
            )}
          </motion.div>

          <div className="card p-4 space-y-3">
            <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Confluence meters</p>
            <MeterBar label="Trend (multi-timeframe)" score={result.meters.trend.score} direction={result.meters.trend.direction} />
            <MeterBar label="Momentum" score={result.meters.momentum.score} direction={result.meters.momentum.direction} />
            <MeterBar label="Volume / OI" score={result.meters.volume.score} direction={result.meters.volume.direction} />
            <MeterBar label="Volatility" score={result.meters.volatility.score} direction="neutral" />
            <MeterBar label="Price action" score={result.meters.priceAction.score} direction={result.meters.priceAction.direction} />
            <MeterBar label="Smart money (SMC)" score={result.meters.smc.score} direction={result.meters.smc.direction} />
            <MeterBar label="Option chain" score={result.meters.option.score} direction={result.meters.option.direction} />
          </div>

          <div className="card p-4 space-y-2">
            <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Multi-timeframe alignment</p>
            {result.mtf.map((row) => (
              <div key={row.tf} className="flex items-center justify-between text-xs">
                <span className="font-semibold w-16">{row.label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${
                    row.direction === "bullish" ? "bg-[var(--color-buy)]" : row.direction === "bearish" ? "bg-[var(--color-sell)]" : "bg-slate-400"
                  }`}
                >
                  {row.direction.toUpperCase()}
                </span>
                <span className="text-[var(--color-muted)] flex-1 text-right">{row.note}</span>
              </div>
            ))}
          </div>

          {result.entry !== null && (
            <div className="card p-4 space-y-3">
              <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Entry / exit plan</p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Entry" value={`₹${result.entry}`} />
                <Stat label="Stop-loss" value={`₹${result.stop}`} />
                <Stat label="Target 1" value={`₹${result.target1}`} />
                <Stat label="Target 2" value={result.target2 !== null ? `₹${result.target2}` : "—"} />
                <Stat label="Target 3" value={result.target3 !== null ? `₹${result.target3}` : "—"} />
                <Stat label="R:R" value={result.rr !== null ? `1:${result.rr}` : "—"} />
              </div>
              <div className="rounded-xl bg-[var(--color-surface-soft)] p-3 space-y-1">
                <p className="text-xs">
                  <span className="font-semibold">Holding time:</span> {result.expectedHoldingTime}
                </p>
                {result.expectedProbability !== null && (
                  <p className="text-xs">
                    <span className="font-semibold">Indicative probability:</span> ~{result.expectedProbability}% (not a guarantee — a rough
                    read of confluence strength)
                  </p>
                )}
                {result.trailingStopNote && <p className="text-xs text-[var(--color-muted)]">{result.trailingStopNote}</p>}
              </div>
            </div>
          )}

          <div className="card p-4 space-y-3">
            <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Risk management</p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Risk amount" value={`₹${riskAmount.toFixed(0)}`} />
              <Stat label="Lot size" value={String(lotSize)} />
              <Stat label="Suggested lots" value={lots !== null ? String(lots) : "—"} />
              <Stat label="Max loss" value={perUnitRisk !== null && lots !== null ? `₹${(perUnitRisk * lots * lotSize).toFixed(0)}` : "—"} />
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              Guardrails (edit capital/risk % on the Risk page): cap risk per trade at {risk.riskPercent}% of capital, stop for the day near
              2× that on a loss, and avoid running more than 2 option positions at once.
            </p>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Signal journal (on-device)</p>
              {stats.totalClosed > 0 && (
                <p className="text-[11px] text-[var(--color-muted)]">{stats.totalClosed} closed</p>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
              Every actionable Master AI call is logged here automatically. Mark it Win/Loss yourself once it plays out — this is a
              lightweight local log stored on this device, not a broker-verified ledger.
            </p>
            {stats.totalClosed > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Win rate" value={stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"} />
                <Stat
                  label="Profit factor"
                  value={stats.profitFactor === null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
                />
                <Stat label="Avg win" value={stats.avgWin !== null ? `${stats.avgWin.toFixed(1)}%` : "—"} />
                <Stat label="Avg loss" value={stats.avgLoss !== null ? `${stats.avgLoss.toFixed(1)}%` : "—"} />
                {stats.sharpe !== null && <Stat label="Sharpe (approx)" value={stats.sharpe.toFixed(2)} />}
              </div>
            )}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {symbolEntries.length === 0 && <p className="text-xs text-[var(--color-muted)]">No logged calls for {symbol} yet.</p>}
              {symbolEntries.slice(0, 15).map((e) => (
                <JournalRow key={e.id} entryId={e.id} decision={e.decision} confidence={e.confidence} strike={e.strike} optSide={e.optSide} ts={e.ts} outcome={e.outcome} />
              ))}
            </div>
          </div>
        </>
      )}

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed px-1">
        Educational reference only, not financial advice. Analyzes Daily/30m/15m/5m timeframes with weighted confluence — always verify on
        the live chart and manage your own risk before trading.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function JournalRow({
  entryId,
  decision,
  confidence,
  strike,
  optSide,
  ts,
  outcome,
}: {
  entryId: string;
  decision: Decision;
  confidence: number;
  strike?: number;
  optSide?: "CE" | "PE";
  ts: number;
  outcome: "open" | "win" | "loss";
}) {
  const { markOutcome } = useJournalStore();
  return (
    <div className="flex items-center justify-between rounded-lg bg-[var(--color-surface-soft)] px-3 py-2 text-xs">
      <div>
        <p className="font-semibold">
          {decision}
          {strike ? ` ${strike} ${optSide}` : ""}
        </p>
        <p className="text-[var(--color-muted)]">
          {new Date(ts).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })} · conf {confidence}
        </p>
      </div>
      {outcome === "open" ? (
        <div className="flex gap-1.5">
          <button onClick={() => markOutcome(entryId, "win")} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
            <ThumbsUp size={14} />
          </button>
          <button onClick={() => markOutcome(entryId, "loss")} className="p-1.5 rounded-lg bg-rose-100 text-rose-700">
            <ThumbsDown size={14} />
          </button>
        </div>
      ) : (
        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${outcome === "win" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
          {outcome.toUpperCase()}
        </span>
      )}
    </div>
  );
}
