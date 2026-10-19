// One market on Ai-Trust. Three looks, one glance (utils/tradeTiers):
//   💎 TRUST CALL   glowing emerald (CE) / ruby (PE): all core checks + 70% of
//                   the supporting ones -- full size
//   ⚡ QUICK TRADE  electric blue / violet: a strong 5-15 min push -- half
//                   size, tight stop, 30-minute time stop
//   SIT TIGHT       deep night-blue glass: no call
// The ring counts the core checks; "support" is the supporting-check share.

import { useState } from "react";
import { Gem, Moon, Zap, LineChart } from "lucide-react";
import { AiChart, type ChartPlan } from "./AiChart";
import { useTradeVerdict } from "../../hooks/useTradeVerdict";
import { trustGrade } from "../../utils/trustGrade";
import { mcxSessionAt } from "../../utils/mcxSession";
import { ChecklistPanel, useChecklist } from "./ChecklistPanel";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const rs = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toFixed(2)}`);

function Ring({ score, outOf, color }: { score: number; outOf: number; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const pct = outOf ? score / outOf : 0;
  return (
    <div className="relative w-[78px] h-[78px] shrink-0">
      <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
        <circle cx="38" cy="38" r={r} stroke="rgba(255,255,255,.18)" strokeWidth="8" fill="none" />
        <circle cx="38" cy="38" r={r} stroke={color} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: "stroke-dasharray .8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-[20px] font-black leading-none">{score}</span>
        <span className="text-[9px] font-bold opacity-80">of {outOf}</span>
      </div>
    </div>
  );
}

/** Live price between the stop and the target. */
function Track({ stop, t1, live }: { stop: number | null; t1: number | null; live: number | null }) {
  if (stop === null || t1 === null || live === null) return null;
  const pct = Math.max(0, Math.min(100, ((live - stop) / (t1 - stop)) * 100));
  return (
    <div className="mt-3">
      <div className="h-2.5 rounded-full bg-black/25 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#FDE68A,#FFFFFF)" }} />
      </div>
      <div className="flex justify-between text-[10px] font-bold text-white/85 mt-1">
        <span>Stop {rs(stop)}</span>
        <span>Now {rs(live)}</span>
        <span>Target {rs(t1)}</span>
      </div>
    </div>
  );
}

export function TrustMarketCard({ symbol }: { symbol: Sym }) {
  const { verdict: v, pick, livePrice, optionDays, news, error, loading } = useTradeVerdict(symbol);
  const s = mcxSessionAt();
  const minutesToClose = s.isOpen ? s.closeMin - s.minutes : null;
  const g = trustGrade(v, { minutesToClose, optionDaysToExpiry: optionDays ?? null });
  const call = useChecklist(symbol, v, g, pick, livePrice, news ?? null, minutesToClose);
  const plan = call.mc?.plan ?? null;
  const qp = call.quick?.plan ?? null;
  const tier = call.tier;
  const side = tier === "quick" ? qp?.side ?? null : v.side;
  const ce = side === "CE";
  const opt = pick && v.side && pick.side === v.side ? pick : null;
  const tt = call.trustTier;
  const coreOk = tt ? tt.core.filter((i) => i.state === "pass").length : 0;
  const [showChart, setShowChart] = useState(false);
  const chartPlan: ChartPlan | null =
    tier === "trust" && plan
      ? { side: plan.side, entry: plan.entry, stop: plan.stop, t1: plan.t1, t2: plan.t2, zone: null, label: "Plan: T1 → T2" }
      : tier === "quick" && qp
        ? { side: qp.side, entry: qp.entry, stop: qp.stop, t1: qp.t1, t2: qp.t2, zone: null, label: `Quick: T1 → T2 by ${qp.exitBy}` }
        : (v.action === "WAIT_CE" || v.action === "WAIT_PE") && v.side && v.t1 !== null
          ? { side: v.side, entry: null, stop: null, t1: v.t1, t2: null, zone: v.entryZone, label: "If it pulls back and holds" }
          : null;

  if (v.action === "NO_DATA" || v.action === "CLOSED") {
    return (
      <div className="rounded-3xl p-4 text-white" style={{ background: "linear-gradient(135deg,#1E1B4B,#312E81)" }}>
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-indigo-200">{NAME[symbol]}</p>
        <p className="text-[20px] font-black mt-0.5">{v.action === "CLOSED" ? "Market closed" : loading ? "Reading the charts…" : "No live data"}</p>
        <p className="text-[11.5px] text-indigo-100/90 mt-1">{error && !loading ? error : v.action === "CLOSED" ? "Calls only come during MCX hours." : "Waiting for finished candles."}</p>
      </div>
    );
  }

  const look =
    tier === "trust"
      ? { bg: ce ? "linear-gradient(140deg,#064E3B,#059669 45%,#10B981 75%,#6EE7B7)" : "linear-gradient(140deg,#4C0519,#BE123C 45%,#F43F5E 75%,#FDA4AF)", ring: "#FFFFFF", rim: ce ? "conic-gradient(from var(--a),#34D399,#FDE68A,#22D3EE,#34D399)" : "conic-gradient(from var(--a),#FB7185,#FDE68A,#F472B6,#FB7185)", glow: ce ? "#10B981AA" : "#F43F5EAA" }
      : tier === "quick"
        ? { bg: ce ? "linear-gradient(140deg,#0C4A6E,#0284C7 45%,#06B6D4 75%,#5EEAD4)" : "linear-gradient(140deg,#3B0764,#9333EA 45%,#DB2777 75%,#F9A8D4)", ring: "#FFFFFF", rim: "conic-gradient(from var(--a),#22D3EE,#FDE047,#A78BFA,#22D3EE)", glow: "#06B6D4AA" }
        : { bg: "linear-gradient(140deg,#0F172A,#1E1B4B 55%,#3B0764)", ring: "#A78BFA", rim: null, glow: "" };

  const body = (
    <div className="relative rounded-[22px] p-4 text-white overflow-hidden" style={{ background: look.bg }}>
      <div className="absolute -right-10 -top-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -left-8 -bottom-14 w-36 h-36 rounded-full bg-white/5 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/80">{NAME[symbol]}</p>
          {tier === "trust" ? (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-white/95">
                <Gem size={14} /> AI-TRUST CALL · full size
              </p>
              <p className="text-[30px] font-black leading-none tracking-tight">BUY {side}</p>
            </>
          ) : tier === "quick" ? (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-white/95">
                <Zap size={14} /> QUICK TRADE · half size{call.quick?.counterTrend ? " · news-led" : ""}
              </p>
              <p className="text-[30px] font-black leading-none tracking-tight">BUY {side}</p>
              <p className="text-[11.5px] font-black text-yellow-200 mt-0.5">Exit by {qp?.exitBy} if no target</p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-violet-200">
                <Moon size={14} /> NO CALL RIGHT NOW
              </p>
              <p className="text-[26px] font-black leading-tight">SIT TIGHT</p>
            </>
          )}
        </div>
        <div className="text-center">
          <Ring score={coreOk} outOf={tt?.core.length ?? 0} color={look.ring} />
          <p className="text-[9px] font-bold text-white/80 mt-0.5">core · support {tt?.supportPct ?? 0}%</p>
        </div>
      </div>

      {tier === "trust" && (
        <div className="relative mt-3 rounded-2xl bg-white/15 backdrop-blur px-3 py-2.5">
          <p className="text-[17px] font-black">
            {opt ? `${opt.strike} ${opt.side}` : `ATM ${side}`}
            {opt?.ltp != null && <span className="text-white/90"> @ ~₹{opt.ltp.toFixed(2)}</span>}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] font-bold text-white/95 mt-1">
            <span>Entry {rs(plan?.entry ?? livePrice)}</span>
            <span>Stop {rs(plan?.stop ?? v.stop)}{call.premStop !== null && <span className="text-white/75"> (~₹{call.premStop.toFixed(1)})</span>}</span>
            <span>Target 1 {rs(plan?.t1 ?? v.t1)}{call.premT1 !== null && <span className="text-white/75"> (~₹{call.premT1.toFixed(1)})</span>}</span>
            <span>Target 2 {rs(plan?.t2 ?? null)}</span>
          </div>
          <p className="text-[12.5px] font-black mt-1">
            {call.lots !== null ? `Lots: ${call.lots} · ` : ""}
            {plan ? `R:R 1:${plan.rr}` : ""}
            {call.riskRs !== null ? ` · risk ≈ ₹${Math.round(call.riskRs)}/lot` : ""}
          </p>
        </div>
      )}
      {tier === "quick" && qp && (
        <div className="relative mt-3 rounded-2xl bg-white/15 backdrop-blur px-3 py-2.5">
          <p className="text-[17px] font-black">{call.quickStrike}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] font-bold text-white/95 mt-1">
            <span>Entry {rs(qp.entry)}</span>
            <span>Stop {rs(qp.stop)}</span>
            <span>Target 1 {rs(qp.t1)}</span>
            <span>Target 2 {rs(qp.t2)}</span>
          </div>
          <p className="text-[12.5px] font-black mt-1">
            {call.quickLots !== null ? `Lots: ${call.quickLots} (half risk) · ` : ""}
            {call.quickRiskRs !== null ? `risk ≈ ₹${Math.round(call.quickRiskRs)}/lot` : ""}
          </p>
          <p className="text-[11px] text-white/85 mt-1 leading-snug">Fast move — book at T1, trail to T2. Out at the stop, or at {qp.exitBy} if it stalls. Don't hold a quick trade longer.</p>
        </div>
      )}
      {tier === "none" && <p className="relative text-[12.5px] font-semibold text-white/90 mt-2 leading-snug">{`${v.headline}. ${v.reason}`}</p>}

      {tier === "trust" && <Track stop={plan?.stop ?? v.stop} t1={plan?.t1 ?? v.t1} live={livePrice} />}
      {tier === "quick" && qp && <Track stop={qp.stop} t1={qp.t1} live={livePrice} />}
      <button onClick={() => setShowChart((x) => !x)} className="relative w-full mt-3 rounded-xl bg-white/90 text-violet-800 px-3 py-2 flex items-center justify-center gap-1.5 text-[12px] font-black">
        <LineChart size={14} /> {showChart ? "Hide AI chart" : "📈 View AI chart — zones, FVG, channel, plan"}
      </button>
      {showChart && <AiChart symbol={symbol} plan={chartPlan} levels={call.mc?.levels ?? null} />}
      <ChecklistPanel call={call} />
      <p className="relative text-[10px] font-bold text-white/70 mt-2">
        {v.basedOn ? `Based on the ${v.basedOn} candle` : ""}
        {v.nextAt ? ` · next update ${v.nextAt}` : ""}
      </p>
    </div>
  );

  if (!look.rim) return <div className="rounded-3xl shadow-xl">{body}</div>;
  return (
    <div className="trust-rim rounded-3xl p-[3px] shadow-2xl" style={{ background: look.rim, boxShadow: `0 10px 40px -8px ${look.glow}` }}>
      {body}
    </div>
  );
}
