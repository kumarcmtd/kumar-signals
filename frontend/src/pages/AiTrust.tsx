// Ai-Trust -- only the Trade Card's very best calls.
//
// The Trade Card (six checks) already filters hard. Ai-Trust adds five more
// rules (utils/trustGrade) and shows a call only when all eleven line up.
// Most of the time it says SIT TIGHT -- that is the point: fewer trades, each
// with much more evidence behind it. No system can avoid every stop-loss.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gem, RefreshCw } from "lucide-react";
import { TrustMarketCard } from "../components/trust/TrustMarketCard";
import { TrustRecord } from "../components/trust/TrustRecord";
import { TradeCounter } from "../components/trust/ChecklistPanel";

const RULES = [
  ["🧭", "Trend confirmed on 15m · 1h · 4h"],
  ["🕯️", "Steady 5-min candles"],
  ["📊", "Strong candle + volume"],
  ["📰", "News not against"],
  ["🎯", "Good entry spot, room to target"],
  ["💰", "Open interest backs the side"],
  ["💪", "Trend strength 75+"],
  ["🗞️", "News actively WITH it"],
  ["🏦", "Fresh OI money confirmed"],
  ["⚖️", "2× reward or more"],
  ["⏱️", "Not near close, not expiry day"],
  ["📈", "1H: price · EMA20 · EMA50 stacked"],
  ["🌡️", "RSI 40–70 rising (no chasing 70/30)"],
  ["〽️", "MACD cross + no divergence"],
  ["🧱", "Pivot / R1 / prev-day high not in the way"],
  ["🛢️", "No EIA within 2h · API Tuesday care"],
  ["🛡️", "1.5× ATR stop · 1:2 or better"],
  ["✋", "Max 3 trades · stop at 3% day loss"],
  ["🧮", "Lots sized to 2% risk"],
];

export function AiTrust() {
  const qc = useQueryClient();
  const [spin, setSpin] = useState(false);
  const refresh = async () => {
    setSpin(true);
    await Promise.all([qc.refetchQueries({ queryKey: ["candles"] }), qc.refetchQueries({ queryKey: ["options-analytics"] }), qc.refetchQueries({ queryKey: ["trade-card-log"] })]).finally(() => setSpin(false));
  };
  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-8 min-h-screen space-y-4" style={{ background: "radial-gradient(120% 60% at 50% 0%,#EDE9FE 0%,#FDF4FF 40%,#FFFFFF 75%)" }}>
      <style>{`
        @property --a { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
        @keyframes trust-spin { to { --a: 360deg; } }
        .trust-rim { animation: trust-spin 3.5s linear infinite; }
        @keyframes trust-shine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
      `}</style>

      <section className="relative rounded-3xl p-5 text-white overflow-hidden shadow-xl" style={{ background: "linear-gradient(135deg,#312E81,#6D28D9 45%,#C026D3 80%,#F472B6)" }}>
        <div className="absolute -right-12 -top-16 w-48 h-48 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute left-10 -bottom-20 w-48 h-48 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shadow-inner">
            <Gem size={26} />
          </div>
          <div className="flex-1">
            <h1
              className="text-[28px] font-black leading-none tracking-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg,#FFFFFF,#FDE68A,#FFFFFF,#FBCFE8,#FFFFFF)", backgroundSize: "200% 100%", animation: "trust-shine 4s linear infinite" }}
            >
              Ai-Trust
            </h1>
            <p className="text-[12px] font-semibold text-white/90 mt-1">Only the strongest calls. Your full checklist must agree.</p>
          </div>
          <button onClick={refresh} className="shrink-0 rounded-xl bg-white/20 px-2.5 py-2 text-[11px] font-black flex items-center gap-1">
            <RefreshCw size={12} className={spin ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <p className="relative text-[11.5px] text-white/85 mt-3 leading-snug">
          Most of the time this page says <b>SIT TIGHT</b>. That is how it avoids the junk calls that hit stop-losses. When a 💎 call shows, you also get a push.
        </p>
      </section>

      <TradeCounter />

      <TrustMarketCard symbol="CRUDEOIL" />
      <TrustMarketCard symbol="NATURALGAS" />

      <TrustRecord />

      <section className="rounded-3xl bg-white p-4 shadow-lg border border-violet-100">
        <p className="text-[13px] font-black text-slate-900">Everything that must agree</p>
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          {RULES.map(([icon, text], i) => (
            <div key={text} className="rounded-xl px-2 py-1.5 text-[11px] font-bold flex items-center gap-1.5" style={{ background: i < 6 ? "#ECFDF5" : i < 11 ? "#F5F3FF" : "#FFF7ED", color: i < 6 ? "#065F46" : i < 11 ? "#5B21B6" : "#9A3412" }}>
              <span>{icon}</span> {text}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-2 leading-snug">
          Green = the Trade Card's six checks. Violet = the five trust rules. Orange = your own checklist (tap "Full checklist" on a card to see every item ticked live). Tap "Took one" each time you enter a trade — the app can't see your broker orders. A 💎 call means the evidence lines up strongly — it is still not a guarantee. Keep the stop, and size so one loss stays small (max 2% of capital).
        </p>
      </section>
    </div>
  );
}
