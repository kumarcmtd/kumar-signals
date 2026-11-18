// The trader's map: where price is between its recent 3-hour high and low,
// how much room is left, and the "careful" zone right under the high (or over
// the low) where the calls wait for a candle to close through.

import { useMemo } from "react";
import { Mountain } from "lucide-react";
import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { GAP_LIVE, gapPicture } from "../../utils/twentyV3/gapRun";
import { SMART_LAB } from "../../utils/twentyV3/labFacts";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function LevelsCard({ s }: { s: TwentyV3State }) {
  const view = useMemo(() => {
    const ctx = s.ctx;
    if (!ctx) return null;
    const p = ctx.p;
    const i = p.c.length - 1;
    if (i < GAP_LIVE.lookback || !Number.isFinite(p.atr[i])) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - GAP_LIVE.lookback; j < i; j++) {
      hi = Math.max(hi, p.c[j].high);
      lo = Math.min(lo, p.c[j].low);
    }
    return { hi, lo, px: p.c[i].close, atr: p.atr[i], run: gapPicture(p, i) };
  }, [s.ctx]);
  if (!view) return null;
  const { hi, lo, px, atr, run } = view;
  const span = Math.max(hi - lo, 1e-9);
  const pos = Math.min(100, Math.max(0, ((px - lo) / span) * 100));
  const care = Math.min(50, ((GAP_LIVE.nearAtr * atr) / span) * 100);
  const aboveHi = px > hi;
  const belowLo = px < lo;
  const nearHi = !aboveHi && hi - px < GAP_LIVE.nearAtr * atr;
  const nearLo = !belowLo && px - lo < GAP_LIVE.nearAtr * atr;
  const say = aboveHi
    ? `Closed above the 3-hour high ${inr(hi)} — no ceiling overhead; CE calls are free to come.`
    : belowLo
      ? `Closed below the 3-hour low ${inr(lo)} — no floor underneath; PE calls are free to come.`
      : nearHi
        ? `Right under the 3-hour high (${inr(hi - px)} away) — careful zone: a CE waits for a 5-minute close above ${inr(hi)}.`
        : nearLo
          ? `Right over the 3-hour low (${inr(px - lo)} away) — careful zone: a PE waits for a 5-minute close below ${inr(lo)}.`
          : `Room both ways: ${inr(hi - px)} up to the high, ${inr(px - lo)} down to the low.`;
  return (
    <section className="rounded-3xl bg-white shadow-md p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#F97316,#EC4899)" }}>
          <Mountain size={16} className="text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-black text-slate-800">Your levels — the gap to the high</p>
          <p className="text-[11px] text-slate-500">Crude futures · last 3 hours of 5-minute candles</p>
        </div>
      </div>
      <div className="pt-5 pb-1">
        <div className="relative h-4 rounded-full" style={{ background: "linear-gradient(90deg,#FECDD3,#F1F5F9 30%,#F1F5F9 70%,#BBF7D0)" }}>
          <div className="absolute inset-y-0 left-0 rounded-l-full bg-rose-300/70" style={{ width: `${care}%` }} />
          <div className="absolute inset-y-0 right-0 rounded-r-full bg-amber-300/80" style={{ width: `${care}%` }} />
          <div className="absolute -top-6 -translate-x-1/2 flex flex-col items-center" style={{ left: `${aboveHi ? 100 : belowLo ? 0 : pos}%` }}>
            <span className="text-[10px] font-black text-white bg-slate-800 rounded-md px-1.5 py-0.5 whitespace-nowrap">{inr(px)}</span>
            <span className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
          </div>
        </div>
        <div className="flex justify-between mt-1.5 text-[10.5px] font-black">
          <span className="text-rose-600">{`Low ${inr(lo)}`}</span>
          <span className="text-amber-600">{`careful ±${inr(GAP_LIVE.nearAtr * atr)}`}</span>
          <span className="text-emerald-600">{`High ${inr(hi)}`}</span>
        </div>
      </div>
      <p className={`text-[12px] font-semibold leading-snug rounded-xl px-2.5 py-2 ${nearHi || nearLo ? "bg-amber-50 text-amber-900 border border-amber-200" : "bg-slate-50 text-slate-700"}`}>{say}</p>
      {run && run.backPts >= 1.5 * atr && (
        <p className="text-[11px] text-slate-500 leading-snug">
          {run.side === "CE"
            ? `Run in progress: price climbed ${inr(run.backPts)} back up from ${inr(run.turn)} and is ${inr(run.roomPts)} under the high ${inr(run.level)}.`
            : `Run in progress: price fell ${inr(run.backPts)} from ${inr(run.turn)} and is ${inr(run.roomPts)} over the low ${inr(run.level)}.`}
        </p>
      )}
      <p className="text-[10.5px] text-slate-400 leading-snug">
        {`Tested honestly: trading the run to the high as its own call lost in all ${SMART_LAB.gapRun.versions + SMART_LAB.gapBreak.versions} versions tried (${signed(SMART_LAB.gapRun.recent.avgRs)} a call, 2022–26) — the high stops most runs. Your “careful at the high” part is what works, so the calls use that.`}
      </p>
    </section>
  );
}
