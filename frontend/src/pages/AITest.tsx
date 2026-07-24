import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Star, Radio, Copy } from "lucide-react";
import { useMarketStatus, usePortfolio, useCreateTrade } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import type { TradeLogEntry, TradeLogStatus } from "../store/appStore";
import { useTimeframeSuite } from "../hooks/useTimeframeSuite";
import { useTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { formatTipCard } from "../utils/tipFormat";
import { RefreshBar } from "../components/RefreshBar";
import type { TimeframeAnalysis, Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

const decisionColor: Record<Decision6, string> = {
  "STRONG BUY": "text-[#22c55e]",
  BUY: "text-[#4ade80]",
  "WATCH BUY": "text-[#a3e635]",
  WAIT: "text-[#fbbf24]",
  SELL: "text-[#fb7185]",
  "STRONG SELL": "text-[#f43f5e]",
};
const decisionBg: Record<Decision6, string> = {
  "STRONG BUY": "bg-[#22c55e]",
  BUY: "bg-[#4ade80]",
  "WATCH BUY": "bg-[#a3e635]",
  WAIT: "bg-[#fbbf24]",
  SELL: "bg-[#fb7185]",
  "STRONG SELL": "bg-[#f43f5e]",
};

// WATCH BUY (65-79) and SELL (25-44) sit only a few points off WAIT's 45-64
// neutral band -- a real signal, but a much weaker one than STRONG BUY/BUY/
// STRONG SELL. This page shows every non-WAIT tier (unlike AI Elite's
// stricter gate), so instead of hiding these it flags them visually
// wherever they'd otherwise look identically confident to a strong tier.
const MARGINAL_DECISIONS = new Set<Decision6>(["WATCH BUY", "SELL"]);

const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
};
const STATUS_COLOR: Record<TradeLogStatus, string> = {
  running: "text-white/60",
  sl_hit: "text-[#f43f5e]",
  stopped_breakeven: "text-[#a3e635]",
  stopped_after_t1: "text-[#22c55e]",
  target3_hit: "text-[#22c55e]",
};

interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Converts a timeframe's underlying entry/target/stop (in the future's own
// price units) into option-premium terms using the same delta≈0.5 ATM
// projection this app's backend already uses for its single combined
// signal -- applied per-timeframe here since each one has its own ATR-based
// underlying move, layered onto the one live premium every timeframe shares.
// This is only ever used to OPEN a new trade log entry -- once a trade line
// exists, its own frozen numbers are what get displayed and tracked, not a
// fresh call to this function (which always reflects "right now").
function projectPremium(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): PremiumProjection | null {
  if (!options || options.error || !analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) {
    return null;
  }
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

function formatExpiryTip(expiry: string): string {
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

function copyTipToClipboard(params: {
  symbolLabel: string;
  strike: number | null | undefined;
  optSide: "CE" | "PE" | null | undefined;
  expiry: string | undefined;
  buyEntry: number;
  targets: [number, number, number];
  stop: number;
}) {
  if (!params.strike || !params.optSide) return;
  const tip = formatTipCard({
    symbolLabel: params.symbolLabel,
    strike: params.strike,
    optSide: params.optSide,
    expiryLabel: params.expiry ? formatExpiryTip(params.expiry) : "—",
    buyZoneLow: params.buyEntry,
    buyZoneHigh: Number((params.buyEntry * 1.02).toFixed(2)),
    targets: params.targets,
    stopLoss: params.stop,
  });
  navigator.clipboard.writeText(tip);
}

export function AITest() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const { risk } = useAppStore();
  const createTrade = useCreateTrade();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const journalWinRate = journalSummary.winRate;

  const crudeOil = useTimeframeSuite("CRUDEOIL", journalWinRate);
  const naturalGas = useTimeframeSuite("NATURALGAS", journalWinRate);
  const board: Record<TradableSymbol, ReturnType<typeof useTimeframeSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };
  const current = board[symbol];

  const allEntries = useMemo(
    () =>
      SYMBOLS.flatMap((sym) =>
        board[sym].analyses.map((a) => ({ symbol: sym, analysis: a, options: board[sym].options }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crudeOil.analyses, naturalGas.analyses]
  );

  const actionableEntries = allEntries.filter((e) => e.analysis.decision !== "WAIT" && e.analysis.hitProbability !== null);
  // Prefer a genuinely strong tier for "Best Trade of the Day" over a
  // marginal one (WATCH BUY/SELL, only a few points off WAIT), even if the
  // marginal tier's hitProbability happens to score higher -- only falls
  // back to a marginal pick when nothing stronger currently qualifies.
  const strongActionableEntries = actionableEntries.filter((e) => !MARGINAL_DECISIONS.has(e.analysis.decision));
  const bestTradePool = strongActionableEntries.length ? strongActionableEntries : actionableEntries;
  const bestTrade = bestTradePool.length
    ? bestTradePool.reduce((best, e) => ((e.analysis.hitProbability ?? 0) > (best.analysis.hitProbability ?? 0) ? e : best))
    : null;
  const bestTradeProj = bestTrade ? projectPremium(bestTrade.analysis, bestTrade.options) : null;

  const validEntries = allEntries.filter((e) => e.analysis.overallScore !== null);
  const bullishCount = validEntries.filter((e) => e.analysis.bias === "bullish").length;
  const bearishCount = validEntries.filter((e) => e.analysis.bias === "bearish").length;
  const bullishPct = validEntries.length ? Math.round((bullishCount / validEntries.length) * 100) : 0;
  const bearishPct = validEntries.length ? Math.round((bearishCount / validEntries.length) * 100) : 0;
  const neutralPct = 100 - bullishPct - bearishPct;
  const overallTrend = bullishPct > bearishPct ? "Bullish" : bearishPct > bullishPct ? "Bearish" : "Neutral";
  const avgConfidence = validEntries.length
    ? Math.round(validEntries.reduce((s, e) => s + Math.abs((e.analysis.overallScore ?? 50) - 50) * 2, 0) / validEntries.length)
    : null;
  const avgVolatility = validEntries.length
    ? Math.round(validEntries.reduce((s, e) => s + (e.analysis.categories?.volatility.score ?? 50), 0) / validEntries.length)
    : null;

  const marketSummary = useMemo(() => buildMarketSummary(symbol, current.analyses), [symbol, current.analyses]);
  const dashboardUpdatedAt = Math.max(crudeOil.dataUpdatedAt, naturalGas.dataUpdatedAt);

  const crudeOilProjections = useMemo(
    () => crudeOil.analyses.map((a) => projectPremium(a, crudeOil.options)),
    [crudeOil.analyses, crudeOil.options]
  );
  const naturalGasProjections = useMemo(
    () => naturalGas.analyses.map((a) => projectPremium(a, naturalGas.options)),
    [naturalGas.analyses, naturalGas.options]
  );
  // Both symbols must be ticked every render regardless of which tab is
  // selected -- otherwise the unselected symbol's trades silently stop
  // advancing (and its day-wise stats would go stale) the moment you switch away.
  useTradeLog("CRUDEOIL", crudeOil.analyses, crudeOilProjections, crudeOil.options);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGas.analyses, naturalGasProjections, naturalGas.options);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(tradeLogs), [tradeLogs]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 bg-gradient-to-b from-[#07050C] via-[#0D0A17] to-[#0D0A17] text-white min-h-screen space-y-5">
      <section className="text-center pt-2 space-y-2">
        <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
          AI-Test V2 — Institutional Commodity Dashboard
        </h1>
        <p className="text-[11px] text-white/50">Independent multi-timeframe scoring for MCX Natural Gas &amp; Crude Oil options</p>
      </section>

      {/* DASHBOARD */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <MiniStat label="Market Status" value={market ? (market.isOpen ? "OPEN" : "CLOSED") : "…"} tone={market?.isOpen ? "up" : "down"} icon={<Radio size={11} />} />
          <MiniStat label="Overall Trend" value={overallTrend} tone={overallTrend === "Bullish" ? "up" : overallTrend === "Bearish" ? "down" : undefined} />
          <MiniStat label="Bullish / Bearish / Neutral" value={`${bullishPct}% / ${bearishPct}% / ${neutralPct}%`} span />
          <MiniStat label="AI Confidence" value={avgConfidence !== null ? `${avgConfidence}%` : "—"} />
          <MiniStat label="Market Volatility" value={avgVolatility !== null ? `${avgVolatility}/100` : "—"} />
          <MiniStat label="Trading Session" value={market?.timeLabel ?? "—"} span />
          <MiniStat
            label="Last Updated"
            value={
              dashboardUpdatedAt > 0
                ? new Date(dashboardUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "—"
            }
            span
          />
        </div>
      </section>

      {/* BEST TRADE OF THE DAY */}
      {bestTrade && (
        <motion.section
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-gradient-to-br from-indigo-600/30 to-fuchsia-600/20 border border-indigo-400/30 p-4"
        >
          <p className="text-[11px] font-bold text-indigo-200 flex items-center gap-1.5 mb-2">
            <Star size={13} className="text-amber-300 fill-amber-300" /> BEST TRADE OF THE DAY
          </p>
          <p className="text-lg font-black flex items-center gap-1.5 flex-wrap">
            {DISPLAY_NAME[bestTrade.symbol]} · {bestTrade.analysis.label} · {bestTrade.analysis.decision} {bestTradeProj ? `${bestTradeProj.strike} ` : ""}
            {bestTrade.analysis.optSide ?? ""}
            {MARGINAL_DECISIONS.has(bestTrade.analysis.decision) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border border-amber-400/50 text-amber-300">MARGINAL</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div>
              <p className="text-lg font-black text-emerald-300">{bestTrade.analysis.hitProbability}%</p>
              <p className="text-[9px] text-white/50">Probability</p>
            </div>
            <div>
              <p className="text-lg font-black">{bestTrade.analysis.signalStrength}</p>
              <p className="text-[9px] text-white/50">Signal Strength</p>
            </div>
            <div>
              <p className="text-lg font-black">{bestTrade.analysis.confidenceLabel}</p>
              <p className="text-[9px] text-white/50">Confidence</p>
            </div>
          </div>
          {bestTrade.analysis.reasons[0] && <p className="text-[11px] text-white/60 mt-2">Reason: {bestTrade.analysis.reasons[0]}</p>}
        </motion.section>
      )}

      {/* SYMBOL SELECTOR */}
      <div className="flex gap-2">
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold border transition-all ${
              symbol === sym ? "bg-white/10 border-indigo-400/40" : "bg-white/5 border-white/10 text-white/50"
            }`}
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      <RefreshBar dataUpdatedAt={current.dataUpdatedAt} isFetching={current.isFetching} onRefresh={current.refetchAll} dark />

      {current.liveDataUnavailable && (
        <div className="rounded-2xl bg-white/5 border border-amber-400/30 p-4 text-center">
          <p className="text-sm font-bold text-amber-300 flex items-center justify-center gap-1.5">
            <AlertTriangle size={14} /> Live data unavailable
          </p>
          <p className="text-xs text-white/50 mt-1">{current.errorMessage ?? "Option chain unreachable"} — no Entry, Target, Stop Loss, or Hit Probability is fabricated.</p>
        </div>
      )}

      {/* MARKET SUMMARY */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4">
        <p className="text-xs font-bold uppercase text-white/70 mb-2">AI Market Summary</p>
        <p className="text-xs text-white/60 leading-relaxed">{marketSummary}</p>
      </section>

      {/* TABLE VIEW */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-white/70 mb-3">Timeframe Overview — {DISPLAY_NAME[symbol]}</p>
        <table className="w-full text-[11px] min-w-[720px]">
          <thead>
            <tr className="text-white/40 text-left">
              <th className="font-semibold pb-2">Timeframe</th>
              <th className="font-semibold pb-2">Signal</th>
              <th className="font-semibold pb-2">Strike</th>
              <th className="font-semibold pb-2">Entry</th>
              <th className="font-semibold pb-2">Live Price</th>
              <th className="font-semibold pb-2">Target</th>
              <th className="font-semibold pb-2">Stop Loss</th>
              <th className="font-semibold pb-2">Probability</th>
              <th className="font-semibold pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {current.analyses.map((a) => {
              const log = tradeLogs[`${symbol}-${a.tf}`] ?? [];
              const latest = log[log.length - 1];
              const liveLtp = latest && !latest.closed ? liveLtpFor(current.options, latest.strike, latest.optSide) : null;
              const pctChange = latest && liveLtp !== null ? (((liveLtp - latest.entry) / latest.entry) * 100).toFixed(1) : null;
              return (
                <tr key={a.tf} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{a.label}</td>
                  <td className={`py-2 font-bold ${a.insufficient ? "text-white/30" : decisionColor[a.decision]}`}>
                    {a.insufficient ? "—" : a.decision}
                    {!a.insufficient && MARGINAL_DECISIONS.has(a.decision) && <span className="text-[8px] opacity-70"> (marginal)</span>}
                  </td>
                  <td className="py-2">{latest ? `${latest.strike} ${latest.optSide}` : "—"}</td>
                  <td className="py-2">{latest ? `₹${latest.entry}` : "—"}</td>
                  <td className="py-2 font-bold">
                    {liveLtp !== null ? (
                      <span className={Number(pctChange) >= 0 ? "text-[#22c55e]" : "text-[#f43f5e]"}>
                        ₹{liveLtp} ({Number(pctChange) >= 0 ? "+" : ""}
                        {pctChange}%)
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2">{latest ? `₹${latest.targets[0]}` : "—"}</td>
                  <td className="py-2">{latest ? `₹${latest.stop}` : "—"}</td>
                  <td className="py-2">{a.hitProbability !== null ? `${a.hitProbability}%` : "—"}</td>
                  <td className={`py-2 font-bold ${latest ? STATUS_COLOR[latest.status] : "text-white/30"}`}>
                    {latest ? STATUS_LABEL[latest.status] : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* DAY-WISE TRADE LOG SUMMARY */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-white/70 mb-1">Day-wise Trade Log — Both Symbols</p>
        <p className="text-[10px] text-white/40 mb-3">One MCX session = 9:00am – 11:55pm IST. Counts every closed trade across all timeframes for Natural Gas and Crude Oil.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-white/40 text-center py-3">No trades have closed yet — this fills in as signals run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-white/40 text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{d.label}</td>
                  <td className="py-2 font-bold text-[#22c55e]">{d.targetHit}</td>
                  <td className="py-2 font-bold text-[#a3e635]">{d.breakeven}</td>
                  <td className="py-2 font-bold text-[#f43f5e]">{d.slHit}</td>
                  <td className="py-2 text-white/60">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* PER-TIMEFRAME TRADE CARDS */}
      <div className="space-y-3">
        {current.analyses.map((a) => {
          const log = tradeLogs[`${symbol}-${a.tf}`] ?? [];
          const latest = log[log.length - 1];
          const openTrade = latest && !latest.closed ? latest : undefined;
          const liveLtp = openTrade ? liveLtpFor(current.options, openTrade.strike, openTrade.optSide) : null;
          const key = `${symbol}-${a.tf}-${latest?.id ?? "none"}`;
          return (
            <section key={a.tf} className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/10">
                <p className="text-sm font-bold">{a.label}</p>
                {a.insufficient ? (
                  <span className="text-[10px] font-bold text-white/40">NO DATA</span>
                ) : MARGINAL_DECISIONS.has(a.decision) ? (
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1 ${decisionColor[a.decision]} border-current/40`}>
                    {a.decision}
                    {a.optSide ? ` ${latest ? latest.strike : ""} ${a.optSide}` : ""}
                    <span className="text-[8px] opacity-80">MARGINAL</span>
                  </span>
                ) : (
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full text-black ${decisionBg[a.decision]}`}>
                    {a.decision}
                    {a.optSide ? ` ${latest ? latest.strike : ""} ${a.optSide}` : ""}
                  </span>
                )}
              </div>

              {a.insufficient ? (
                <p className="text-xs text-white/40 text-center py-4 px-4">{a.insufficient}</p>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <TfField label="AI Score" value={`${a.overallScore}/100`} />
                    <TfField label="Market Trend" value={a.bias === "bullish" ? "Bullish" : a.bias === "bearish" ? "Bearish" : "Neutral"} />
                    <TfField label="Signal Strength" value={a.signalStrength} />
                    <TfField label="Hit Probability" value={a.hitProbability !== null ? `${a.hitProbability}%` : "—"} />
                    <TfField label="Confidence" value={a.confidenceLabel} />
                    <TfField label="Holding Time" value={a.holdingTime} />
                  </div>

                  {log.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-white/50 uppercase">Trade Log (newest first)</p>
                      {[...log].reverse().map((entry) => (
                        <TradeLogLine key={entry.id} entry={entry} liveLtp={entry.id === openTrade?.id ? liveLtp : null} />
                      ))}
                    </div>
                  ) : (
                    a.decision !== "WAIT" && <p className="text-[11px] text-white/40">No live premium available to open a trade log for this call.</p>
                  )}

                  {a.vetoes.length > 0 && (
                    <div className="rounded-xl bg-amber-400/10 border border-amber-400/20 p-2.5">
                      <p className="text-[10px] font-bold text-amber-300 mb-1">Downgraded to WAIT by trading rules:</p>
                      {a.vetoes.map((v, i) => (
                        <p key={i} className="text-[11px] text-amber-200/80">
                          • {v}
                        </p>
                      ))}
                    </div>
                  )}

                  {a.reasons.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-white/50 uppercase">Reasons</p>
                      {a.reasons.slice(0, 6).map((r, i) => (
                        <p key={i} className="text-xs text-white/60 flex items-start gap-1.5">
                          <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" /> {r}
                        </p>
                      ))}
                    </div>
                  )}

                  {openTrade && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={loggedKey === key}
                        onClick={() =>
                          createTrade.mutate(
                            {
                              symbol,
                              optSide: openTrade.optSide,
                              strike: openTrade.strike,
                              entryPrice: openTrade.entry,
                              stopLoss: openTrade.stop,
                              target: openTrade.targets[0],
                              quantity: 1,
                              lotSize: LOT_SIZE[symbol],
                              source: "master-ai",
                              notes: `Logged from AI-Test (${a.label})`,
                            },
                            { onSuccess: () => setLoggedKey(key) }
                          )
                        }
                        className="py-2 rounded-xl text-xs font-bold bg-indigo-500 text-white disabled:opacity-50"
                      >
                        {loggedKey === key ? "Logged ✓" : `Log to Journal`}
                      </button>
                      <button
                        onClick={() => {
                          copyTipToClipboard({
                            symbolLabel: DISPLAY_NAME[symbol],
                            strike: openTrade.strike,
                            optSide: openTrade.optSide,
                            expiry: current.signal?.expiry,
                            buyEntry: openTrade.entry,
                            targets: openTrade.targets,
                            stop: openTrade.stop,
                          });
                          setCopiedKey(key);
                          setTimeout(() => setCopiedKey(null), 2000);
                        }}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-white/10 border border-white/15 text-white/90"
                      >
                        <Copy size={13} strokeWidth={2.5} />
                        {copiedKey === key ? "Copied ✓" : "Copy Tip"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Position sizing uses your Risk page settings (₹{risk.capital.toLocaleString("en-IN")}
        capital, {risk.riskPercent}% risk). Every timeframe is scored independently — nothing here is a guaranteed outcome.
      </p>
    </div>
  );
}

function buildMarketSummary(symbol: TradableSymbol, analyses: TimeframeAnalysis[]): string {
  const valid = analyses.filter((a) => a.overallScore !== null);
  if (!valid.length) return `No sufficient live data yet to summarize ${DISPLAY_NAME[symbol]} across timeframes.`;
  const bullish = valid.filter((a) => a.bias === "bullish");
  const bearish = valid.filter((a) => a.bias === "bearish");
  const actionable = valid.filter((a) => a.decision !== "WAIT");
  if (!actionable.length) {
    return `${DISPLAY_NAME[symbol]} isn't showing a high-probability setup on any analyzed timeframe right now — confluence is mixed or vetoed by the trading rules. Best to wait for clearer alignment.`;
  }
  const dominant = bullish.length > bearish.length ? "bullish" : bearish.length > bullish.length ? "bearish" : "mixed";
  const tfList = actionable.map((a) => a.label).join(", ");
  return `${DISPLAY_NAME[symbol]} is showing ${dominant} confluence on the ${tfList} timeframe(s), with confirmation from the technical, volume, and structure factors listed above. Probability favors continuation in that direction while it holds, but always confirm on the live chart before acting.`;
}

function MiniStat({ label, value, tone, span, icon }: { label: string; value: string; tone?: "up" | "down"; span?: boolean; icon?: React.ReactNode }) {
  const color = tone === "up" ? "text-[#22c55e]" : tone === "down" ? "text-[#f43f5e]" : "text-white";
  return (
    <div className={`rounded-xl bg-white/5 border border-white/10 px-3 py-2 ${span ? "col-span-2" : ""}`}>
      <p className="text-[9px] text-white/40">{label}</p>
      <p className={`text-sm font-bold flex items-center gap-1 ${color}`}>
        {icon} {value}
      </p>
    </div>
  );
}

function TfField({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-[#22c55e]" : tone === "down" ? "text-[#f43f5e]" : "text-white";
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
      <p className="text-[9px] text-white/40">{label}</p>
      <p className={`text-xs font-bold ${color}`}>{value}</p>
    </div>
  );
}

// One line in a timeframe's trade history. Open (still-running) trades render
// at full brightness with the live premium shown; closed trades -- whether
// they ended in a hit target or a stopped-out loss -- are visually "dulled"
// per how a real trade log reads: it's history now, not the live position.
function TradeLogLine({ entry, liveLtp }: { entry: TradeLogEntry; liveLtp: number | null }) {
  const dulled = entry.closed;
  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-opacity ${dulled ? "opacity-40 bg-white/[0.02] border-white/5" : "bg-white/5 border-white/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">
          {entry.strike} {entry.optSide} · Entry ₹{entry.entry}
        </span>
        <span className={`text-[10px] font-bold shrink-0 ${STATUS_COLOR[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-white/50">
        <TargetTick label="T1" price={entry.targets[0]} hit={entry.targetsHit[0]} />
        <TargetTick label="T2" price={entry.targets[1]} hit={entry.targetsHit[1]} />
        <TargetTick label="T3" price={entry.targets[2]} hit={entry.targetsHit[2]} />
        <span>SL ₹{entry.stop}</span>
      </div>
      {!dulled && liveLtp !== null && <p className="text-[10px] text-white/40 mt-1">Current premium: ₹{liveLtp}</p>}
    </div>
  );
}

function TargetTick({ label, price, hit }: { label: string; price: number; hit: boolean }) {
  return (
    <span className={hit ? "text-[#22c55e] font-semibold" : ""}>
      {hit ? "✓" : "○"} {label} ₹{price}
    </span>
  );
}
