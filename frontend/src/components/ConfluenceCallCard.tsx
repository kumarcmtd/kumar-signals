import { useMemo } from "react";
import { Star, TrendingUp, TrendingDown, ShieldCheck } from "lucide-react";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { checkReboundStrength } from "../utils/reboundStrength";
import { checkVolumeSupport } from "../utils/volumeSupport";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "./EntryTimingBadge";
import { PriceScale, ProfitEstimate, ReboundStrengthCard, VolumeSupportCard } from "./CallCardKit";
import type { ConfluenceCall } from "../utils/confluenceEngine";
import type { TradeLogEntry } from "../store/appStore";
import type { Candle, OptionsAnalytics } from "../types";

const DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const CONFIDENCE_COLOR = (score: number) => (score >= 90 ? "#CA8A04" : score >= 80 ? "#7C3AED" : score >= 70 ? "#2563EB" : "#0EA5E9");

// The one moment this whole app is actually built toward: three completely
// independent engines (Best Call's strict 3-way comparison, Ai20-20's live
// momentum scanner, Level Cross Scan's tested-level break detector) all
// currently holding an OPEN position on the same symbol, agreeing on the
// same side. Reuses every "supporting feature" the individual call pages
// already have (Price Scale, Profit Estimate, Entry Timing, Rebound
// Strength, Volume Support) rather than inventing new ones, so this reads
// as the same trusted toolkit, just pointed at a rarer, stronger signal.
export function ConfluenceCallCard({
  call,
  candles,
  options,
  lotSize,
}: {
  call: ConfluenceCall;
  candles: Candle[];
  options: OptionsAnalytics | undefined;
  lotSize: number;
}) {
  const liveLtp = liveLtpFor(options, call.primary.strike, call.optSide);

  const displayEntry: TradeLogEntry = useMemo(() => {
    const targetsHit: [boolean, boolean, boolean] = [
      liveLtp !== null && liveLtp >= call.suggestedTargets[0],
      liveLtp !== null && liveLtp >= call.suggestedTargets[1],
      liveLtp !== null && liveLtp >= call.suggestedTargets[2],
    ];
    return {
      id: `confluence-${call.symbol}`,
      strike: call.primary.strike,
      optSide: call.optSide,
      entry: call.primary.entry,
      targets: call.suggestedTargets,
      stop: call.suggestedStop,
      targetsHit,
      status: "running",
      closed: false,
      openedAt: Math.min(...call.sources.map((s) => s.openedAt)),
      closedAt: null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, liveLtp]);

  const effStop = effectiveStopFor(displayEntry);
  const inBetween = liveLtp !== null && liveLtp < displayEntry.entry && liveLtp > effStop;
  const rebound = inBetween ? checkReboundStrength(candles, call.direction) : null;
  const volumeSupport = checkVolumeSupport(candles, call.direction);
  const nextTarget = displayEntry.targetsHit[1] ? displayEntry.targets[2] : displayEntry.targetsHit[0] ? displayEntry.targets[1] : displayEntry.targets[0];
  const legFloor = displayEntry.targetsHit[1] ? displayEntry.targets[1] : displayEntry.targetsHit[0] ? displayEntry.targets[0] : displayEntry.entry;
  const entryTiming = liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;

  const Bias = call.direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = call.direction === "bullish" ? "#16A34A" : "#DC2626";
  const confColor = CONFIDENCE_COLOR(call.confidence);

  return (
    <div className="rounded-3xl overflow-hidden shadow-lg" style={{ border: `2px solid ${confColor}` }}>
      <div className="px-4 pt-3.5 pb-3 text-white" style={{ background: "linear-gradient(135deg,#F59E0B,#EC4899 55%,#7C3AED)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star size={16} fill="#FDE68A" color="#FDE68A" />
            <Star size={16} fill="#FDE68A" color="#FDE68A" />
            <Star size={16} fill="#FDE68A" color="#FDE68A" />
            <span className="text-xs font-black uppercase tracking-wide ml-1">3-Star Call</span>
          </div>
          <span className="text-[10px] font-bold bg-white/20 rounded-full px-2 py-0.5">{call.confidenceLabel}</span>
        </div>
        <p className="text-[11px] text-white/85 mt-1.5 leading-snug">
          Best Call, Ai20-20, and Level Cross Scan are all currently holding an open {call.optSide} on {DISPLAY_NAME[call.symbol] ?? call.symbol} at the same time -- three unrelated engines, one direction.
        </p>
      </div>

      <div className="bg-white">
        <div className="px-4 pt-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-black flex items-center gap-1.5">
              <Bias size={16} style={{ color: biasColor }} />
              {(DISPLAY_NAME[call.symbol] ?? call.symbol).toUpperCase()} {call.primary.strike} {call.optSide}
            </p>
            {!call.sameStrike && <p className="text-[10px] text-slate-400">Sources differ slightly on strike -- SL/targets below are the safest merge across all of them.</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-black" style={{ color: biasColor }}>
              ₹{liveLtp ?? call.primary.entry}
            </p>
            <p className="text-[10px] text-slate-400">Current premium</p>
            {entryTiming && <EntryTimingBadge verdict={entryTiming} className="mt-1 max-w-[160px]" />}
          </div>
        </div>

        <div className="mx-4 mt-3 rounded-xl px-3.5 py-3 flex items-center justify-between" style={{ background: `${confColor}12`, border: `1px solid ${confColor}44` }}>
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} style={{ color: confColor }} />
            <span className="text-xs font-bold" style={{ color: confColor }}>
              Confluence Confidence
            </span>
          </div>
          <span className="text-lg font-black" style={{ color: confColor }}>
            {call.confidence}%
          </span>
        </div>

        <PriceScale entry={displayEntry} current={liveLtp} />
        <ProfitEstimate trade={displayEntry} current={liveLtp} lotSize={lotSize} />
        {rebound && <ReboundStrengthCard rebound={rebound} />}
        <VolumeSupportCard volume={volumeSupport} />

        <div className="mx-4 mb-3.5 rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Confirmed By</p>
          <div className="space-y-1.5">
            {call.sources.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-600">{s.name}</span>
                <span className="text-slate-500">
                  {s.strike} {call.optSide} @ ₹{s.entry}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
