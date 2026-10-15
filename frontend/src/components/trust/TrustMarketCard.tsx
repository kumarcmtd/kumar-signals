// One market on Ai-Trust. Three looks, one glance:
//   💎 TRUST CALL   glowing emerald (CE) / ruby (PE) with a spinning rim
//   GOOD, NOT TRUST amber: the Trade Card says TRADE, a trust rule is missing
//   SIT TIGHT       deep night-blue glass: nothing trusted -- no trade
// The ring is how much of the 11-point evidence lines up right now.

import { Gem, Moon, ShieldAlert } from "lucide-react";
import { useTradeVerdict } from "../../hooks/useTradeVerdict";
import { trustGrade, type TrustGrade } from "../../utils/trustGrade";
import { mcxSessionAt } from "../../utils/mcxSession";
import type { TradeVerdict } from "../../utils/tradeVerdict";

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

function Points({ v, g }: { v: TradeVerdict; g: TrustGrade }) {
  const items = [...v.checks.map((c) => ({ key: `c-${c.key}`, label: c.label, ok: c.state !== "fail", text: c.text })), ...g.rules.map((r) => ({ key: `r-${r.key}`, label: r.label, ok: r.ok, text: r.text }))];
  return (
    <div className="mt-3 grid grid-cols-1 gap-1">
      {items.map((p) => (
        <div key={p.key} className="flex items-start gap-2 rounded-lg px-2 py-1 text-[11px] leading-snug" style={{ background: p.ok ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.18)" }}>
          <span className={`mt-[1px] shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black ${p.ok ? "bg-white text-emerald-600" : "bg-white/25 text-white"}`}>{p.ok ? "✓" : "✗"}</span>
          <span className="text-white/95">
            <b>{p.label}</b> <span className="text-white/75">· {p.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Live price between the stop and the target. */
function Track({ v, live }: { v: TradeVerdict; live: number | null }) {
  if (v.stop === null || v.t1 === null || live === null) return null;
  const pct = Math.max(0, Math.min(100, ((live - v.stop) / (v.t1 - v.stop)) * 100));
  return (
    <div className="mt-3">
      <div className="h-2.5 rounded-full bg-black/25 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#FDE68A,#FFFFFF)" }} />
      </div>
      <div className="flex justify-between text-[10px] font-bold text-white/85 mt-1">
        <span>Stop {rs(v.stop)}</span>
        <span>Now {rs(live)}</span>
        <span>Target {rs(v.t1)}</span>
      </div>
    </div>
  );
}

export function TrustMarketCard({ symbol }: { symbol: Sym }) {
  const { verdict: v, pick, livePrice, optionDays, error, loading } = useTradeVerdict(symbol);
  const s = mcxSessionAt();
  const g = trustGrade(v, { minutesToClose: s.isOpen ? s.closeMin - s.minutes : null, optionDaysToExpiry: optionDays ?? null });
  const ce = v.side === "CE";
  const opt = pick && v.side && pick.side === v.side ? pick : null;

  if (v.action === "NO_DATA" || v.action === "CLOSED") {
    return (
      <div className="rounded-3xl p-4 text-white" style={{ background: "linear-gradient(135deg,#1E1B4B,#312E81)" }}>
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-indigo-200">{NAME[symbol]}</p>
        <p className="text-[20px] font-black mt-0.5">{v.action === "CLOSED" ? "Market closed" : loading ? "Reading the charts…" : "No live data"}</p>
        <p className="text-[11.5px] text-indigo-100/90 mt-1">{error && !loading ? error : v.action === "CLOSED" ? "Trust calls only come during MCX hours." : "Waiting for finished candles."}</p>
      </div>
    );
  }

  const look = g.trusted
    ? { bg: ce ? "linear-gradient(140deg,#064E3B,#059669 45%,#10B981 75%,#6EE7B7)" : "linear-gradient(140deg,#4C0519,#BE123C 45%,#F43F5E 75%,#FDA4AF)", ring: "#FFFFFF", rim: ce ? "conic-gradient(from var(--a),#34D399,#FDE68A,#22D3EE,#34D399)" : "conic-gradient(from var(--a),#FB7185,#FDE68A,#F472B6,#FB7185)" }
    : g.isTrade
      ? { bg: "linear-gradient(140deg,#78350F,#D97706 55%,#FBBF24)", ring: "#FEF3C7", rim: null }
      : { bg: "linear-gradient(140deg,#0F172A,#1E1B4B 55%,#3B0764)", ring: "#A78BFA", rim: null };

  const body = (
    <div className="relative rounded-[22px] p-4 text-white overflow-hidden" style={{ background: look.bg }}>
      <div className="absolute -right-10 -top-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -left-8 -bottom-14 w-36 h-36 rounded-full bg-white/5 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/80">{NAME[symbol]}</p>
          {g.trusted ? (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-white/95">
                <Gem size={14} /> AI-TRUST CALL
              </p>
              <p className="text-[30px] font-black leading-none tracking-tight">BUY {v.side}</p>
            </>
          ) : g.isTrade ? (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-white/95">
                <ShieldAlert size={14} /> GOOD — NOT TRUST GRADE
              </p>
              <p className="text-[24px] font-black leading-tight">Skip, or small size</p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-black flex items-center gap-1 text-violet-200">
                <Moon size={14} /> NO TRUSTED CALL
              </p>
              <p className="text-[26px] font-black leading-tight">SIT TIGHT</p>
            </>
          )}
        </div>
        <Ring score={g.score} outOf={g.outOf} color={look.ring} />
      </div>

      {g.trusted ? (
        <div className="relative mt-3 rounded-2xl bg-white/15 backdrop-blur px-3 py-2.5">
          <p className="text-[17px] font-black">
            {opt ? `${opt.strike} ${opt.side}` : `ATM ${v.side}`}
            {opt?.ltp != null && <span className="text-white/90"> @ ~₹{opt.ltp.toFixed(2)}</span>}
          </p>
          <p className="text-[12px] font-bold text-white/90 mt-0.5">
            Futures stop {rs(v.stop)} · target {rs(v.t1)}
            {v.rr !== null && ` · ${v.rr}× reward`}
          </p>
          <p className="text-[11px] text-white/80 mt-1 leading-snug">{v.reason}</p>
        </div>
      ) : (
        <p className="relative text-[12.5px] font-semibold text-white/90 mt-2 leading-snug">
          {g.isTrade ? `Trade Card says ${v.headline}, but ${g.rules.filter((r) => !r.ok).map((r) => r.label.toLowerCase()).join(", ")} ${g.rules.filter((r) => !r.ok).length > 1 ? "are" : "is"} missing.` : `${v.headline}. ${v.reason}`}
        </p>
      )}

      {(g.trusted || g.isTrade) && <Track v={v} live={livePrice} />}
      <Points v={v} g={g} />
      <p className="relative text-[10px] font-bold text-white/70 mt-2">
        {v.basedOn ? `Based on the ${v.basedOn} candle` : ""}
        {v.nextAt ? ` · next update ${v.nextAt}` : ""}
      </p>
    </div>
  );

  if (!look.rim) return <div className="rounded-3xl shadow-xl">{body}</div>;
  return (
    <div className="trust-rim rounded-3xl p-[3px] shadow-2xl" style={{ background: look.rim, boxShadow: ce ? "0 10px 40px -8px #10B981AA" : "0 10px 40px -8px #F43F5EAA" }}>
      {body}
    </div>
  );
}
