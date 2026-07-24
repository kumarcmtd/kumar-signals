import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, ShieldCheck, Info, Bot, ChevronDown, CheckCircle2 } from "lucide-react";
import { useMarketStatus, usePortfolio, useCreateTrade, useSignal } from "../api/hooks";
import { useTimeframeSuite } from "../hooks/useTimeframeSuite";
import { useEliteTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { findEliteSignal } from "../utils/eliteSignal";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { formatTipCard } from "../utils/tipFormat";
import { CircularGauge } from "../components/CircularGauge";
import { DECISION_LABEL } from "../utils/timeframeEngine";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SIGNAL_VALIDITY_MS = 20 * 60 * 1000;

interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

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

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function riskLabel(volatilityScore: number): { label: string; color: string } {
  if (volatilityScore >= 65) return { label: "High", color: "#FF4D4F" };
  if (volatilityScore >= 35) return { label: "Medium", color: "#FFC107" };
  return { label: "Low", color: "#00E676" };
}

export function AITestElite() {
  const [now, setNow] = useState(Date.now());
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const createTrade = useCreateTrade();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const crudeOil = useTimeframeSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useTimeframeSuite("NATURALGAS", journalSummary.winRate);

  const crudeOilEntries = useMemo(() => crudeOil.analyses.map((a) => ({ symbol: "CRUDEOIL", analysis: a, options: crudeOil.options })), [crudeOil.analyses, crudeOil.options]);
  const naturalGasEntries = useMemo(() => naturalGas.analyses.map((a) => ({ symbol: "NATURALGAS", analysis: a, options: naturalGas.options })), [naturalGas.analyses, naturalGas.options]);
  const crudeOilElite = useMemo(() => findEliteSignal(crudeOilEntries), [crudeOilEntries]);
  const naturalGasElite = useMemo(() => findEliteSignal(naturalGasEntries), [naturalGasEntries]);

  const crudeOilProj = crudeOilElite ? projectPremium(crudeOilElite.analysis, crudeOilElite.options) : null;
  const naturalGasProj = naturalGasElite ? projectPremium(naturalGasElite.analysis, naturalGasElite.options) : null;

  // Captured at the moment a call opens, so its "why" stays reviewable in
  // history later -- today's live analysis has nothing to do with a call
  // that already closed. Memoized on the underlying primitives so it isn't
  // a fresh object reference on every render.
  const crudeOilMeta = useMemo(
    () => (crudeOilElite ? { label: crudeOilElite.analysis.label, reasons: crudeOilElite.analysis.reasons, confirmingTimeframes: crudeOilElite.confirmingTimeframes } : undefined),
    [crudeOilElite]
  );
  const naturalGasMeta = useMemo(
    () => (naturalGasElite ? { label: naturalGasElite.analysis.label, reasons: naturalGasElite.analysis.reasons, confirmingTimeframes: naturalGasElite.confirmingTimeframes } : undefined),
    [naturalGasElite]
  );

  // Both symbols must keep ticking regardless of which one (if any)
  // currently qualifies, so an already-open Elite trade never silently
  // stops being tracked the moment the OTHER symbol becomes the pick.
  useEliteTradeLog("ELITE-CRUDEOIL", crudeOilElite?.analysis.decision ?? null, crudeOilElite?.analysis.optSide ?? null, crudeOilProj, crudeOil.options, crudeOilMeta);
  useEliteTradeLog("ELITE-NATURALGAS", naturalGasElite?.analysis.decision ?? null, naturalGasElite?.analysis.optSide ?? null, naturalGasProj, naturalGas.options, naturalGasMeta);
  const tradeLogs = useAppStore((s) => s.tradeLogs);

  const picks = [
    crudeOilElite && { key: "ELITE-CRUDEOIL", symbol: "CRUDEOIL" as TradableSymbol, elite: crudeOilElite, proj: crudeOilProj, options: crudeOil.options, signalExpiry: undefined as string | undefined },
    naturalGasElite && { key: "ELITE-NATURALGAS", symbol: "NATURALGAS" as TradableSymbol, elite: naturalGasElite, proj: naturalGasProj, options: naturalGas.options, signalExpiry: undefined as string | undefined },
  ].filter(Boolean) as { key: string; symbol: TradableSymbol; elite: NonNullable<typeof crudeOilElite>; proj: PremiumProjection | null; options: OptionsAnalytics | undefined }[];

  const { data: cSignal } = useSignal("CRUDEOIL");
  const { data: ngSignal } = useSignal("NATURALGAS");
  const expiryFor: Record<TradableSymbol, string | undefined> = { CRUDEOIL: cSignal?.expiry, NATURALGAS: ngSignal?.expiry };

  const eliteTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("ELITE-")) out[k] = v;
    return out;
  }, [tradeLogs]);
  const realized = useMemo(() => flattenClosedTrades(eliteTradeLogsOnly), [eliteTradeLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(eliteTradeLogsOnly), [eliteTradeLogsOnly]);

  // Every call this filter has ever made, open or closed, newest first --
  // this is what makes past calls reviewable/chattable, not just the
  // currently live one.
  const allCalls = useMemo(() => {
    const out: { symbol: TradableSymbol; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(eliteTradeLogsOnly)) {
      const symbol = k.replace("ELITE-", "") as TradableSymbol;
      for (const entry of v) out.push({ symbol, entry });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [eliteTradeLogsOnly]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen text-white space-y-4" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck size={22} className="text-[#00E676]" />
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-[#00E676] via-[#00C2FF] to-[#00E676] bg-clip-text text-transparent">AI Elite</h1>
        </div>
        <p className="text-[11px] text-[#9AA4B2] px-4">
          Only Very Strong Buy / Very Strong Sell, confirmed by a second timeframe, zero trading-rule vetoes, genuine price-action + support/resistance value-zone + volume confirmation, and at least a
          1:1.5 reward-to-risk. No middle-tier signals shown here.
        </p>
        <p className="text-[10px] text-[#9AA4B2] flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-[#00E676]" : "bg-[#FF4D4F]"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      {picks.length === 0 ? (
        <GlassCard glow="#00C2FF">
          <div className="text-center py-8 space-y-2">
            <Info size={28} className="mx-auto text-[#9AA4B2]" />
            <p className="text-sm font-bold text-white">No Elite-grade setup right now</p>
            <p className="text-xs text-[#9AA4B2] px-4">
              Neither Crude Oil nor Natural Gas currently clears every bar: Very Strong Buy/Sell confirmed by another timeframe, zero vetoes, real price-action + value-zone + volume confirmation, and
              at least 1:1.5 reward-to-risk. That's expected most of the time — this page is built to stay quiet rather than show a weaker signal just to have something on screen.
            </p>
          </div>
        </GlassCard>
      ) : (
        picks.map(({ key, symbol, elite, proj }, i) => (
          <motion.div key={key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: i * 0.1 }}>
            <EliteCard
              trackingKey={key}
              symbol={symbol}
              elite={elite}
              proj={proj}
              tradeLogs={tradeLogs}
              expiry={expiryFor[symbol]}
              now={now}
              loggedKey={loggedKey}
              setLoggedKey={setLoggedKey}
              copiedKey={copiedKey}
              setCopiedKey={setCopiedKey}
              chatKey={chatKey}
              setChatKey={setChatKey}
              createTrade={createTrade}
            />
          </motion.div>
        ))
      )}

      <GlassCard title="Elite Track Record">
        <div className="grid grid-cols-3 gap-2">
          <StatChip label="Closed" value={String(perf.totalClosed)} />
          <StatChip label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatChip label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#00E676" : "#FF4D4F"} />
          <StatChip label="Wins" value={String(perf.wins)} color="#00E676" />
          <StatChip label="Breakeven" value={String(perf.breakevens)} />
          <StatChip label="Losses" value={String(perf.losses)} color="#FF4D4F" />
        </div>
        <p className="text-[9px] text-[#9AA4B2] mt-2">
          Tracked separately from AI-Test V2/Pro's own trade log — this is only the strict Elite filter's own record, so you can honestly see whether the stricter bar actually performs better
          over time. Starts from zero the day this page shipped.
        </p>
        <p className="text-[9px] text-[#00C2FF] mt-1.5">
          Criteria strengthened on 24 Jul — added mandatory price-action, support/resistance value-zone, and volume confirmation plus a minimum 1:1.5 reward-to-risk on top of the original
          filter. Calls above from before that date used the looser bar and are kept as-is, not erased.
        </p>
      </GlassCard>

      {dayStats.length > 0 && (
        <GlassCard title="Elite Day-wise Log">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[380px]">
              <thead>
                <tr className="text-left text-[#9AA4B2]">
                  <th className="font-semibold pb-2">Date</th>
                  <th className="font-semibold pb-2">Target Hit</th>
                  <th className="font-semibold pb-2">Breakeven</th>
                  <th className="font-semibold pb-2">SL Hit</th>
                </tr>
              </thead>
              <tbody>
                {dayStats.map((d) => (
                  <tr key={d.dateKey} className="border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                    <td className="py-2 font-semibold">{d.label}</td>
                    <td className="py-2 font-bold" style={{ color: "#00E676" }}>{d.targetHit}</td>
                    <td className="py-2 font-bold" style={{ color: "#a3e635" }}>{d.breakeven}</td>
                    <td className="py-2 font-bold" style={{ color: "#FF4D4F" }}>{d.slHit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {allCalls.length > 0 && (
        <GlassCard title="Elite Calls (History) — chat any past call">
          <div className="space-y-2">
            {allCalls.map(({ symbol, entry }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} chatKey={chatKey} setChatKey={setChatKey} />
            ))}
          </div>
        </GlassCard>
      )}

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. A stricter filter means fewer signals, not a guarantee — always confirm on the live chart before acting.
      </p>
    </div>
  );
}

function EliteCard({
  trackingKey,
  symbol,
  elite,
  proj,
  tradeLogs,
  expiry,
  now,
  loggedKey,
  setLoggedKey,
  copiedKey,
  setCopiedKey,
  chatKey,
  setChatKey,
  createTrade,
}: {
  trackingKey: string;
  symbol: TradableSymbol;
  elite: NonNullable<ReturnType<typeof findEliteSignal>>;
  proj: PremiumProjection | null;
  tradeLogs: Record<string, TradeLogEntry[]>;
  expiry: string | undefined;
  now: number;
  loggedKey: string | null;
  setLoggedKey: (k: string | null) => void;
  copiedKey: string | null;
  setCopiedKey: (k: string | null) => void;
  chatKey: string | null;
  setChatKey: (k: string | null) => void;
  createTrade: ReturnType<typeof useCreateTrade>;
}) {
  const log = tradeLogs[trackingKey] ?? [];
  const latest = log[log.length - 1];
  if (!latest) return null;
  const liveLtp = !latest.closed ? liveLtpFor(elite.options, latest.strike, latest.optSide) : null;
  const validUntil = latest.openedAt + SIGNAL_VALIDITY_MS;
  const remainingMs = validUntil - now;
  const chatOpen = chatKey === trackingKey;
  const rl = riskLabel(elite.analysis.categories?.volatility.score ?? 50);
  const nextTarget = latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0];

  return (
    <GlassCard glow={elite.analysis.bias === "bullish" ? "#00E676" : "#FF4D4F"}>
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <CircularGauge value={elite.analysis.overallScore ?? 0} size={100} label="AI Confidence" />
        <div className="flex-1 w-full">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase text-[#9AA4B2]">
              {DISPLAY_NAME[symbol]} · {elite.analysis.label}
            </span>
            {!latest.closed && (
              <span className="text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse" style={{ background: "#FF4D4F22", color: "#FF4D4F" }}>
                LIVE
              </span>
            )}
          </div>
          <p className="text-xl font-black mt-0.5">
            {latest.strike} {latest.optSide}
          </p>
          <p className="text-sm font-bold mt-1" style={{ color: elite.analysis.bias === "bullish" ? "#00E676" : "#FF4D4F" }}>
            {DECISION_LABEL[elite.analysis.decision]}
          </p>
          <p className="text-[10px] text-[#9AA4B2] mt-1">
            Confirmed by: {elite.confirmingTimeframes.join(", ")}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <ConfluenceChip label="Price Action" ok={elite.confluence.priceAction} />
            <ConfluenceChip label="Value Zone" ok={elite.confluence.valueZone} />
            <ConfluenceChip label="Volume" ok={elite.confluence.volume} />
            <ConfluenceChip label={`R:R 1:${elite.rr ?? "—"}`} ok={elite.rr !== null && elite.rr >= 1.5} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <StatChip label="Entry" value={`₹${latest.entry}`} />
            <StatChip label="Stop Loss" value={`₹${latest.stop}`} color="#FF4D4F" />
            <StatChip label="Target 1" value={`₹${latest.targets[0]}`} color="#00E676" />
            <StatChip label="Target 2" value={`₹${latest.targets[1]}`} color="#00E676" />
            <StatChip label="Target 3" value={`₹${latest.targets[2]}`} color="#00E676" />
            <StatChip label="Probability" value={elite.analysis.hitProbability !== null ? `${elite.analysis.hitProbability}%` : "—"} />
            <StatChip label="Risk:Reward" value={proj?.rr !== null && proj?.rr !== undefined ? `1:${proj.rr}` : "—"} />
            <StatChip label="Holding Time" value={elite.analysis.holdingTime} />
            <StatChip label="Status" value={latest.closed ? latest.status.replace(/_/g, " ") : remainingMs > 0 ? fmtCountdown(remainingMs) + " left" : "Running"} />
          </div>
          {!latest.closed && (
            <div className="flex gap-2 mt-3">
              <button
                disabled={loggedKey === trackingKey}
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
                      notes: `Logged from AI Elite (${elite.analysis.label})`,
                    },
                    { onSuccess: () => setLoggedKey(trackingKey) }
                  )
                }
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#00E676,#00C2FF)" }}
              >
                {loggedKey === trackingKey ? "Logged ✓" : "Log to Journal"}
              </button>
              <button
                onClick={() => {
                  const tip = formatTipCard({
                    symbolLabel: DISPLAY_NAME[symbol],
                    strike: latest.strike,
                    optSide: latest.optSide,
                    expiryLabel: expiry ? formatExpiryTip(expiry) : "—",
                    buyZoneLow: latest.entry,
                    buyZoneHigh: Number((latest.entry * 1.02).toFixed(2)),
                    targets: latest.targets,
                    stopLoss: latest.stop,
                  });
                  navigator.clipboard.writeText(tip);
                  setCopiedKey(trackingKey);
                  setTimeout(() => setCopiedKey(null), 2000);
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold border"
                style={{ background: "#181A24", borderColor: "rgba(255,255,255,.08)" }}
              >
                <Copy size={13} />
                {copiedKey === trackingKey ? "Copied ✓" : "Copy Trade"}
              </button>
            </div>
          )}
          {liveLtp !== null && (
            <p className="text-[10px] text-[#9AA4B2] mt-2">Current premium: ₹{liveLtp}</p>
          )}
          <button
            onClick={() => setChatKey(chatOpen ? null : trackingKey)}
            className="w-full flex items-center justify-center gap-1.5 mt-3 py-2.5 rounded-xl text-xs font-bold border"
            style={{ background: "#181A24", borderColor: "rgba(0,194,255,.3)", color: "#00C2FF" }}
          >
            <Bot size={14} />
            Chat: Explain this trade
            <ChevronDown size={14} className={`transition-transform ${chatOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-xl p-3 space-y-3" style={{ background: "#0D0E16", border: "1px solid rgba(0,194,255,.15)" }}>
              <p className="text-[9px] text-[#9AA4B2]">Answers below are built from this trade's own real numbers — not a free-text chat model.</p>
              <ChatBubble
                q="Why did this qualify as Elite?"
                a={`${elite.analysis.reasons[0] ?? "Multiple scored categories agree on this direction."} It cleared every gate: ${DECISION_LABEL[elite.analysis.decision]}, zero vetoes, confirmed by ${elite.confirmingTimeframes.join(", ")}, genuine price-action + support/resistance value-zone + volume confirmation, and a 1:${elite.rr} reward-to-risk.`}
              />
              <ChatBubble
                q="What if the target fails?"
                a={`Stop loss is ₹${latest.stop}. ${
                  latest.targetsHit[0]
                    ? `Target 1 was already reached, so the trailing stop has moved up to ${latest.targetsHit[1] ? `₹${latest.targets[0]} (locking the Target 1–2 gain)` : `₹${latest.entry} (breakeven)`}.`
                    : "It hasn't reached Target 1 yet, so the original stop still applies."
                }`}
              />
              <ChatBubble
                q="Can I enter now?"
                a={
                  liveLtp !== null
                    ? `Current premium is ₹${liveLtp} vs a recommended entry of ₹${latest.entry} (${(((liveLtp - latest.entry) / latest.entry) * 100).toFixed(1)}% away). Within ~2% is generally still a reasonable entry.`
                    : latest.closed
                    ? "This trade has already closed — wait for the next Elite pick."
                    : "Live premium isn't available right now to compare against the recommended entry."
                }
              />
              <ChatBubble q="What's the risk level?" a={`${rl.label}, based on a volatility score of ${elite.analysis.categories?.volatility.score ?? "—"}/100 on this timeframe.`} />
              <ChatBubble q="What's the best exit?" a={`Next target is ₹${nextTarget}. Signal validity window: ${remainingMs > 0 ? fmtCountdown(remainingMs) : "expired"}.`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {elite.analysis.reasons.length > 0 && (
        <div className="mt-3 pt-3 border-t space-y-1" style={{ borderColor: "rgba(255,255,255,.08)" }}>
          <p className="text-[9px] font-bold text-[#00E676] uppercase">Why this qualifies</p>
          {elite.analysis.reasons.slice(0, 4).map((r, i) => (
            <p key={i} className="text-[11px] text-[#9AA4B2]">
              • {r}
            </p>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function GlassCard({ children, title, glow }: { children: React.ReactNode; title?: string; glow?: string }) {
  return (
    <section
      className="rounded-2xl p-4 backdrop-blur-xl"
      style={{ background: "#181A24", border: `1px solid ${glow ? `${glow}44` : "rgba(255,255,255,.08)"}`, boxShadow: glow ? `0 0 24px ${glow}22` : undefined }}
    >
      {title && <p className="text-xs font-bold uppercase text-[#9AA4B2] mb-3">{title}</p>}
      {children}
    </section>
  );
}

function ChatBubble({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-[#00C2FF]">{q}</p>
      <p className="text-[11px] text-[#9AA4B2] mt-0.5">{a}</p>
    </div>
  );
}

// One row per Elite call ever made (open or closed), each independently
// chattable -- reuses the real reasons/confirming-timeframes captured at
// the moment that specific call opened (entry.meta), not today's live
// analysis, which has nothing to do with a call from earlier or from a
// previous day.
function CallHistoryRow({
  symbol,
  entry,
  chatKey,
  setChatKey,
}: {
  symbol: TradableSymbol;
  entry: TradeLogEntry;
  chatKey: string | null;
  setChatKey: (k: string | null) => void;
}) {
  const chatOpen = chatKey === entry.id;
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const durationMin = entry.closedAt !== null ? Math.round((entry.closedAt - entry.openedAt) / 60000) : null;

  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}
            {entry.meta?.label ? ` · ${entry.meta.label}` : ""}
          </p>
          <p className="text-[10px] text-[#9AA4B2]">{new Date(entry.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold" style={{ color: !entry.closed ? "#FF4D4F" : pnl !== null && pnl > 0 ? "#00E676" : pnl !== null && pnl < 0 ? "#FF4D4F" : "#a3e635" }}>
            {!entry.closed ? "LIVE" : entry.status.replace(/_/g, " ")}
          </p>
          {pnl !== null && <p className="text-[10px] text-[#9AA4B2]">{pnl >= 0 ? "+" : ""}{pnl} pts</p>}
        </div>
      </div>
      <button onClick={() => setChatKey(chatOpen ? null : entry.id)} className="w-full flex items-center justify-center gap-1 mt-2 py-1.5 rounded-lg text-[10px] font-bold" style={{ background: "#181A24", color: "#00C2FF" }}>
        <Bot size={11} /> Chat about this call
        <ChevronDown size={11} className={`transition-transform ${chatOpen ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              {entry.meta ? (
                <ChatBubble
                  q="Why did this qualify as Elite?"
                  a={`${entry.meta.reasons[0] ?? "Multiple scored categories agreed on this direction."} Confirmed by: ${entry.meta.confirmingTimeframes.join(", ") || "—"}.`}
                />
              ) : (
                <ChatBubble q="Why did this qualify as Elite?" a="This call was opened before detailed reasoning capture shipped, so the original notes weren't saved for it — only the numbers below are available." />
              )}
              <ChatBubble
                q="What happened?"
                a={
                  !entry.closed
                    ? `Still running. Entry ₹${entry.entry}, targets ₹${entry.targets.join(" / ₹")}, stop ₹${entry.stop}.`
                    : `Closed as "${entry.status.replace(/_/g, " ")}" at ₹${exit}, ${pnl! >= 0 ? "a gain" : "a loss"} of ${Math.abs(pnl!)} points from the ₹${entry.entry} entry${durationMin !== null ? ` after ${durationMin} minute(s)` : ""}.`
                }
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Every card that renders has already cleared these gates (findEliteSignal
// filters out anything that doesn't) -- this checklist exists to make that
// visible/trustable at a glance rather than a claim the user has to take on
// faith, not to flag failures (a failing chip would mean the card shouldn't
// have rendered at all).
function ConfluenceChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold"
      style={{ background: ok ? "#00E67622" : "#FF4D4F22", color: ok ? "#00E676" : "#FF4D4F" }}
    >
      <CheckCircle2 size={10} />
      {label}
    </span>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <p className="text-[9px] text-[#9AA4B2]">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "#FFFFFF" }}>
        {value}
      </p>
    </div>
  );
}
