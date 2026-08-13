import { Waypoints, TrendingUp, TrendingDown, Info, Eye, Target } from "lucide-react";
import { useLevelCrossScanner } from "../hooks/useLevelCrossScanner";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { PriceScale, ProfitEstimate, DetailRow } from "../components/CallCardKit";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

function SymbolCard({ symbol, scanner }: { symbol: TradableSymbol; scanner: ReturnType<typeof useLevelCrossScanner> }) {
  const signal = scanner.best[symbol];
  const log = scanner.tradeLogs[symbol];
  const latest = log[log.length - 1];
  const openTrade = latest && !latest.closed ? latest : undefined;
  const options = scanner.options[symbol];
  const liveLtp = openTrade ? liveLtpFor(options, openTrade.strike, openTrade.optSide) : null;

  const nextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : null;
  const legFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : null;
  const entryTiming = liveLtp !== null && nextTarget !== null && legFloor !== null && latest ? evaluateEntryTiming(legFloor, nextTarget, effectiveStopFor(latest), liveLtp) : null;

  if (!signal || !latest) {
    const nearMiss = scanner.misses[symbol][0];
    return (
      <section className="rounded-3xl bg-white shadow-md p-5 text-center space-y-1.5">
        <p className="text-sm font-black text-slate-700">{DISPLAY_NAME[symbol]} -- No Qualifying Break Right Now</p>
        {nearMiss?.level ? (
          <p className="text-xs text-slate-500 px-2">
            Watching {nearMiss.level.type} at ₹{nearMiss.level.price} ({nearMiss.level.touches}x tested) on {nearMiss.label} -- {nearMiss.reasons[nearMiss.reasons.length - 1]}
          </p>
        ) : (
          <p className="text-xs text-slate-500 px-2">No significant, well-tested level has broken with real conviction yet on any timeframe.</p>
        )}
      </section>
    );
  }

  const bullish = signal.direction === "bullish";
  const accent = bullish ? "#0D9488" : "#DC2626";

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-start justify-between gap-3" style={{ background: bullish ? "linear-gradient(135deg,#ECFEFF,#FFFFFF)" : "linear-gradient(135deg,#FEF2F2,#FFFFFF)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {DISPLAY_NAME[symbol]} · {signal.label}
          </p>
          <p className="text-lg font-black flex items-center gap-1.5" style={{ color: accent }}>
            {bullish ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {signal.optSide} Buy Call
          </p>
          <p className="text-sm font-bold text-slate-700 mt-0.5">
            {latest.strike} {latest.optSide} · Entry ₹{latest.entry}
          </p>
        </div>
        <div className="text-center shrink-0">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-lg shadow" style={{ background: accent }}>
            {signal.confidence}
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-1">Confidence</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {signal.level && (
          <div className="rounded-2xl p-3" style={{ background: "#F0FDFA", border: "1px solid #99F6E4" }}>
            <p className="text-[10px] font-bold uppercase text-teal-700 flex items-center gap-1.5">
              <Waypoints size={12} /> Level That Broke
            </p>
            <p className="text-sm font-black text-teal-900 mt-0.5">
              {signal.level.type === "resistance" ? "Resistance" : "Support"} at ₹{signal.level.price} -- tested {signal.level.touches}x before breaking
            </p>
            {signal.nextLevel && (
              <p className="text-[11px] text-teal-700 mt-1">
                Target set at the next significant level (₹{signal.nextLevel.price}, tested {signal.nextLevel.touches}x) -- a real level, not a projection.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <DetailRow label="Stop Loss" value={`₹${effectiveStopFor(latest)}`} valueColor="#DC2626" />
          <DetailRow label="Target 1" value={`₹${latest.targets[0]}`} valueColor="#0D9488" />
          <DetailRow label="Live Premium" value={liveLtp !== null ? `₹${liveLtp}` : "—"} valueColor="#0EA5E9" />
        </div>
        {entryTiming && <EntryTimingBadge verdict={entryTiming} theme="light" />}

        <PriceScale entry={latest} current={liveLtp} />
        <ProfitEstimate trade={latest} current={liveLtp} lotSize={LOT_SIZE[symbol]} />

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">Why This Cleared The Bar</p>
          {signal.reasons.map((r, i) => (
            <p key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <span className="mt-0.5 text-teal-500">•</span> {r}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LevelCrossScan() {
  const scanner = useLevelCrossScanner();

  const dayStats = summarizeTradeLogsByDay({
    "LEVELCROSS-CRUDEOIL": scanner.tradeLogs.CRUDEOIL,
    "LEVELCROSS-NATURALGAS": scanner.tradeLogs.NATURALGAS,
  });

  const anyMiss = SYMBOLS.some((s) => scanner.misses[s].length > 0);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <Waypoints size={18} className="text-teal-600" />
          <p className="text-sm font-bold">Level Cross Scan</p>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1.5">
          A horizontal level tested several times, then finally broken with real conviction, tends to move fast -- that's real supply/demand getting absorbed, not a random tick. Every market, every
          timeframe scanned continuously with no fixed candle interval; only the single highest-confidence genuine break per instrument shows here. A weak close, extended RSI, or volume running
          against the break disqualifies it outright -- some days that's zero calls, by design.
        </p>
      </div>

      {scanner.anyLiveDataUnavailable && (
        <div className="card p-4 text-center">
          <p className="text-sm font-bold text-rose-500">Live data unavailable</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">Option chain unreachable for one or both markets -- no entry, target, or stop loss is fabricated while this is down.</p>
        </div>
      )}

      {SYMBOLS.map((symbol) => (
        <SymbolCard key={symbol} symbol={symbol} scanner={scanner} />
      ))}

      {anyMiss && (
        <section className="card p-4 space-y-2.5">
          <p className="text-xs font-bold uppercase text-[var(--color-muted)] flex items-center gap-1.5">
            <Eye size={13} className="text-indigo-500" /> Levels Being Watched
          </p>
          {SYMBOLS.flatMap((symbol) =>
            scanner.misses[symbol].map((m, i) => (
              <div key={`${symbol}-${i}`} className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-600">
                  {DISPLAY_NAME[symbol]} · {m.label} · {m.level?.type === "resistance" ? "Resistance" : "Support"} ₹{m.level?.price} ({m.level?.touches}x tested)
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{m.reasons[m.reasons.length - 1]}</p>
              </div>
            ))
          )}
        </section>
      )}

      <section className="card p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-purple-500" /> Day-wise Trade Log
        </p>
        <p className="text-[10px] text-[var(--color-muted)] mb-3">One MCX session = 9:00am – 11:55pm IST.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] text-center py-3">No trades have closed yet -- this fills in as calls run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-[var(--color-muted)] text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-[var(--color-border)]">
                  <td className="py-2 font-semibold">{d.label}</td>
                  <td className="py-2 font-bold text-emerald-600">{d.targetHit}</td>
                  <td className="py-2 font-bold text-lime-600">{d.breakeven}</td>
                  <td className="py-2 font-bold text-rose-500">{d.slHit}</td>
                  <td className="py-2 text-[var(--color-muted)]">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2 flex items-start justify-center gap-1.5">
        <Info size={12} className="shrink-0 mt-0.5" />
        Educational reference only, not financial advice. Levels and touch counts are computed deterministically from real candle history -- always confirm on the live chart before acting.
      </p>
    </div>
  );
}

