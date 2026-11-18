import { useEffect, useState } from "react";
import { Leaf, RefreshCw } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useAiLite } from "../hooks/useAiLite";
import { LITE } from "../utils/lite/engine";
import { LITE_LAB } from "../utils/lite/labFacts";
import { nextMcxOpen } from "../utils/mcxSession";
import { ResultsStrip } from "../components/aiTest/ResultsStrip";
import { LiteMarketCard } from "../components/lite/LiteMarketCard";
import { LiteRules } from "../components/lite/LiteRules";

// Ai Lite: a few plain rules, a fixed Rs 2,000 target, calls pushed to the
// phone even with the app closed -- the trader's "less rules, more freedom"
// page. The rules, the money plan and an honest 10-year test sit on one page.

const ago = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};

export function AiLite() {
  const crude = useAiLite("CRUDEOIL");
  const gas = useAiLite("NATURALGAS");
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const updatedAt = Math.max(crude.updatedAt, gas.updatedAt);
  const closed = crude.marketKnown && !crude.open;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 text-slate-800 min-h-screen space-y-3.5" style={{ background: "linear-gradient(180deg,#ECFDF5 0%,#F0FDFA 30%,#EFF6FF 65%,#F8FAFC 100%)" }}>
      <section className="relative overflow-hidden rounded-3xl p-4 text-white shadow-lg shadow-emerald-300/40" style={{ background: "linear-gradient(135deg,#16A34A 0%,#0D9488 50%,#0EA5E9 100%)" }}>
        <span className="pointer-events-none absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/20 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-12 -left-10 w-40 h-40 rounded-full bg-lime-300/30 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/40 shrink-0">
            <Leaf size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] font-black leading-tight drop-shadow-sm">Ai Lite</h1>
            <p className="text-[11.5px] text-white/90 leading-snug">Less rules, more freedom · catch the move, book ₹2,000</p>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-center">
          {[
            [`₹${LITE.targetRs.toLocaleString("en-IN")}`, "target / lot"],
            [`₹${LITE.stopRs.toLocaleString("en-IN")}`, "stop / lot"],
            ["3", "simple rules"],
          ].map(([big, small]) => (
            <div key={small} className="rounded-2xl bg-white/20 ring-1 ring-white/30 py-1.5">
              <p className="text-[17px] font-black leading-none">{big}</p>
              <p className="text-[9.5px] font-bold uppercase text-white/90 mt-1">{small}</p>
            </div>
          ))}
        </div>
        <div className="relative mt-2.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black bg-white/20 ring-1 ring-white/30">
            <span className={`w-2 h-2 rounded-full ${closed ? "bg-rose-200" : "bg-lime-300 animate-pulse"}`} />
            {crude.marketKnown ? (closed ? `MCX closed · opens ${nextMcxOpen(now).label.replace(" IST", "")}` : "LIVE · alerts on even with the app closed") : "…"}
          </span>
          <button onClick={() => void Promise.all([crude.refetch(), gas.refetch()])} disabled={crude.fetching || gas.fetching} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black bg-white text-emerald-700 shadow disabled:opacity-70 shrink-0" aria-label="Refresh">
            <RefreshCw size={12} className={crude.fetching || gas.fetching ? "animate-spin" : ""} />
            {updatedAt > 0 ? ago(now - updatedAt) : "Load"}
          </button>
        </div>
      </section>

      <ResultsStrip logs={tradeLogs} engineId="lite" signalsTab={false} />
      <LiteMarketCard s={crude} lab={{ avgRs: LITE_LAB.crude.recent.avgRs, last50: LITE_LAB.crude.last50.avgRs }} />
      <LiteMarketCard s={gas} lab={{ avgRs: LITE_LAB.gas.recent.avgRs, last50: LITE_LAB.gas.last50.avgRs }} />
      <LiteRules />

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">Educational reference, not financial advice. Targets and stops are option premiums for 1 lot; real fills, spreads and fast markets differ, and no rule wins every day. Never risk money you cannot afford to lose.</p>
    </div>
  );
}
