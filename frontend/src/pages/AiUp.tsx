import { useMemo } from "react";
import { Repeat, TrendingUp, TrendingDown, Zap, Info, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useAiUp, type AiUpSymbol } from "../hooks/useAiUp";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { PriceScale, ProfitEstimate, fmtWhen } from "../components/CallCardKit";
import { VolatilityMeter } from "../components/VolatilityMeter";
import { NewsImpactCard } from "../components/NewsImpactCard";
import { CallStrengthButton } from "../components/CallStrengthButton";
import { ExpectedHoldBadge } from "../components/ExpectedHoldBadge";
import { LevelProximityWarning } from "../components/LevelProximityWarning";
import { DepthPressureBadge } from "../components/DepthPressureBadge";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";

const SYMBOLS: AiUpSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<AiUpSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<AiUpSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3 text-center shadow-sm">
      <p className="text-lg font-black tabular-nums" style={{ color: color ?? "var(--color-ink)" }}>
        {value}
      </p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

// A colourful entry/stop/target tile. Targets light up green with a ✓ once hit.
function LevelTile({ label, value, color, hit }: { label: string; value: string; color: string; hit?: boolean }) {
  return (
    <div className="rounded-xl px-2.5 py-2 border" style={{ background: hit ? `${color}18` : `${color}0A`, borderColor: `${color}44` }}>
      <p className="text-[9px] font-bold uppercase tracking-wide flex items-center gap-0.5" style={{ color }}>
        {hit ? "✓ " : ""}
        {label}
      </p>
      <p className="text-sm font-black tabular-nums mt-0.5" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function SymbolReversalCard({ symbol }: { symbol: AiUpSymbol }) {
  const scanner = useAiUp(symbol);
  const { setup, scan, options, candles, tradeLog } = scanner;
  const latest = tradeLog[tradeLog.length - 1] as TradeLogEntry | undefined;
  const hasLiveCall = !!latest && !latest.closed;

  // Direction of the OPEN trade drives colour once one exists; otherwise the
  // live setup does.
  const dir: "bullish" | "bearish" = latest && !latest.closed ? (latest.optSide === "CE" ? "bullish" : "bearish") : setup?.direction ?? "bullish";
  const bull = dir === "bullish";
  const accent = !setup && !hasLiveCall ? "#94A3B8" : bull ? "#16A34A" : "#DC2626";
  const Bias = bull ? TrendingUp : TrendingDown;

  const liveLtp = latest && !latest.closed && options ? liveLtpFor(options, latest.strike, latest.optSide) : null;
  const effStop = latest ? effectiveStopFor(latest) : 0;
  const nextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : 0;
  const legFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : 0;
  const entryTiming = hasLiveCall && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border-2 bg-white" style={{ borderColor: `${accent}44` }}>
      <div className="px-4 pt-3.5 flex items-center justify-between">
        <p className="text-base font-black">{DISPLAY_NAME[symbol]}</p>
        <span className="text-[11px] font-bold px-2 py-1 rounded-full flex items-center gap-1" style={{ color: accent, background: `${accent}14` }}>
          {bull ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {!setup && !hasLiveCall ? "Watching" : bull ? "Bounce setup" : "Fade setup"}
        </span>
      </div>

      {hasLiveCall && latest ? (
        <div className="p-4 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-black flex items-center gap-1.5">
                <Bias size={16} style={{ color: accent }} />
                {DISPLAY_NAME[symbol].toUpperCase()} {latest.strike} {latest.optSide}
              </p>
              <p className="text-[11px] text-slate-500">Created {fmtWhen(latest.openedAt)} at ₹{latest.entry}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-black" style={{ color: accent }}>
                ₹{liveLtp ?? latest.entry}
              </p>
              <p className="text-[10px] text-slate-400">Current premium</p>
            </div>
          </div>

          {setup && (
            <div className="rounded-xl px-3.5 py-3" style={{ background: `${accent}0D`, border: `1px solid ${accent}26` }}>
              <p className="text-[10px] font-bold uppercase" style={{ color: accent }}>
                {bull ? "Catching the bounce" : "Catching the fade"}
              </p>
              <p className="text-[12px] text-slate-600 mt-0.5 leading-snug">
                {bull
                  ? `Crude fell ~${setup.moveMagnitude} pts (${setup.moveAtr}× ATR) into an oversold RSI of ${setup.rsiExtreme}, then turned. Targets are the retrace back up.`
                  : `Crude spiked ~${setup.moveMagnitude} pts (${setup.moveAtr}× ATR) into an overbought RSI of ${setup.rsiExtreme}, then rolled over. Targets are the retrace back down.`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {setup && (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ color: accent, background: `${accent}14` }}>
                {setup.confidence}% confidence
              </span>
            )}
            {entryTiming && <EntryTimingBadge verdict={entryTiming} className="max-w-[170px]" />}
          </div>

          <PriceScale entry={latest} current={liveLtp} />
          <ProfitEstimate trade={latest} current={liveLtp} lotSize={LOT_SIZE[symbol]} />

          <CallStrengthButton candles={candles} direction={dir} ctx={{ entry: latest.entry, stop: effStop, targets: latest.targets, targetsHit: latest.targetsHit, current: liveLtp, openedAt: latest.openedAt }} />
          <ExpectedHoldBadge entries={tradeLog} open={{ entry: latest.entry, current: liveLtp, openedAt: latest.openedAt, nextTarget }} />
          <DepthPressureBadge symbol={symbol} optSide={latest.optSide} />

          <div className="grid grid-cols-3 gap-2">
            <LevelTile label="Entry" value={`₹${latest.entry}`} color="#2563EB" />
            <LevelTile label="Stop" value={`₹${effStop}`} color="#DC2626" />
            <LevelTile label="Live" value={liveLtp !== null ? `₹${liveLtp}` : "—"} color="#0EA5E9" />
            <LevelTile label="Target 1" value={`₹${latest.targets[0]}`} color="#16A34A" hit={latest.targetsHit[0]} />
            <LevelTile label="Target 2" value={`₹${latest.targets[1]}`} color="#16A34A" hit={latest.targetsHit[1]} />
            <LevelTile label="Target 3" value={`₹${latest.targets[2]}`} color="#16A34A" hit={latest.targetsHit[2]} />
          </div>

          {latest.meta?.reasons && latest.meta.reasons.length > 0 && (
            <div className="rounded-xl px-3.5 py-3 bg-slate-50 border border-slate-100">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Why this reversal</p>
              <ul className="space-y-1">
                {latest.meta.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-slate-600 flex gap-1.5">
                    <span style={{ color: accent }}>•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 pt-3 space-y-3">
          {setup ? (
            <div className="rounded-xl px-3.5 py-3" style={{ background: `${accent}0D`, border: `1px solid ${accent}26` }}>
              <p className="text-xs font-bold" style={{ color: accent }}>
                {bull ? "Bounce forming" : "Fade forming"} — {setup.confidence}% confidence
              </p>
              <ul className="mt-1.5 space-y-1">
                {setup.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                    <span className={r.ok ? "text-emerald-500" : "text-slate-300"}>{r.ok ? "✓" : "○"}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl px-3.5 py-3 bg-slate-50 border border-slate-100 flex items-start gap-2">
              <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-600 leading-snug">{scan.waitingReason}</p>
            </div>
          )}
          <NewsImpactCard symbol={symbol} />
        </div>
      )}

      <div className="px-4 pb-4">
        <VolatilityMeter symbol={symbol} />
      </div>
    </div>
  );
}

export function AiUp() {
  const tradeLogs = useAppStore((s) => s.tradeLogs);

  const ownLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("AIUP-")) out[k] = v;
    return out;
  }, [tradeLogs]);

  const perf = useMemo(() => computePerformanceStats(flattenClosedTrades(ownLogsOnly)), [ownLogsOnly]);
  const allCalls = useMemo(() => {
    const out: { symbol: string; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(ownLogsOnly)) {
      const symbol = k.replace("AIUP-", "");
      for (const e of v) out.push({ symbol, entry: e });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt).slice(0, 12);
  }, [ownLogsOnly]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#ECFDF5,#EFF6FF 45%,#FEF2F2)" }}>
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Repeat size={22} className="text-emerald-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-500 via-sky-500 to-rose-500 bg-clip-text text-transparent">AI-Up</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-3">
          Crude and gas rarely move in a straight line — a sharp, climactic fall is very often followed by a recovery, and a sharp spike by a fade. AI-Up waits for a real, ATR-sized move, then for
          the market to actually show it has exhausted and turned — oversold/overbought RSI now reversing, a genuine reversal candle, price reclaiming its average, volume behind the turn — and only
          then catches the snap-back, both ways. No turn, no trade.
        </p>
      </section>

      <LevelProximityWarning />

      {SYMBOLS.map((s) => (
        <SymbolReversalCard key={s} symbol={s} />
      ))}

      <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
        <p className="text-xs font-bold mb-3 flex items-center gap-1.5">
          <Zap size={14} className="text-emerald-500" /> AI-Up Track Record
        </p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#16A34A" : "#DC2626"} />
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Tracked under its own AIUP line, advanced and closed server-side even when the app is shut. Starts from zero the day this page shipped.</p>
      </div>

      {allCalls.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
          <p className="text-xs font-bold mb-3">Recent AI-Up Calls</p>
          <div className="space-y-1.5">
            {allCalls.map(({ symbol, entry }) => {
              const closed = entry.closed;
              const exit = closed ? exitPriceFor(entry) : null;
              const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
              const win = pnl !== null && pnl > 0;
              return (
                <div key={entry.id} className="flex items-center justify-between text-[11px] rounded-lg px-3 py-2" style={{ background: "var(--color-surface-soft)" }}>
                  <span className="font-semibold">
                    {DISPLAY_NAME[symbol as AiUpSymbol] ?? symbol} {entry.strike} {entry.optSide}
                  </span>
                  <span className="text-slate-400">{fmtWhen(entry.openedAt)}</span>
                  <span className="font-bold" style={{ color: !closed ? "#2563EB" : win ? "#16A34A" : pnl === 0 ? "#94A3B8" : "#DC2626" }}>
                    {!closed ? "Running" : pnl !== null ? `${pnl >= 0 ? "+" : ""}${pnl}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Method &amp; discipline</p>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          A trade only fires after a move of at least ~2.2× ATR that then shows a genuine turn: RSI that reached oversold/overbought and is now reversing, a real reversal candle, price back across its
          short-term average, and volume behind the turn (3 of 4+ must agree). Entry is the reversal bar; the stop sits just beyond the swing extreme; targets are the 38.2% / 61.8% / 100% retracement
          of the very move it is snapping back from. Educational reference only, not financial advice — always confirm on the live chart.
        </p>
      </div>
    </div>
  );
}
