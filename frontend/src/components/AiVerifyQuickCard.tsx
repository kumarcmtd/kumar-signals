// A one-glance AI Verify Pro read for both markets, for the Ai20-20 page:
// the verdict, how much of the evidence agrees, when the next candle check is,
// what it is waiting for, and whether it agrees with an open Ai20-20 call.
// The full reasons stay on AI Verify Pro; tapping a row goes there.

import { Link } from "react-router-dom";
import { BadgeCheck, TrendingUp, TrendingDown, Hourglass, PauseCircle, Moon, Zap, ChevronRight, Clock } from "lucide-react";
import { useBuyDecision } from "../hooks/useBuyDecision";
import { useAppStore } from "../store/appStore";
import { sessionBucketStart } from "../utils/candleResample";
import type { Verdict } from "../utils/buyDecisionEngine";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const LOOK: Record<Verdict, { label: string; from: string; to: string; Icon: typeof TrendingUp }> = {
  BUY_CE: { label: "BUY CE", from: "#047857", to: "#10B981", Icon: TrendingUp },
  BUY_PE: { label: "BUY PE", from: "#9F1239", to: "#E11D48", Icon: TrendingDown },
  FORMING_CE: { label: "CE SETUP FORMING", from: "#B45309", to: "#F59E0B", Icon: Hourglass },
  FORMING_PE: { label: "PE SETUP FORMING", from: "#B45309", to: "#F59E0B", Icon: Hourglass },
  WAIT: { label: "WAIT", from: "#312E81", to: "#4F46E5", Icon: PauseCircle },
  EVENT_WAIT: { label: "WAIT — EIA REPORT", from: "#7C2D12", to: "#EA580C", Icon: Zap },
  CLOSED: { label: "MARKET CLOSED", from: "#0F172A", to: "#334155", Icon: Moon },
};

function minutesToNextClose(): number {
  const now = Date.now();
  return Math.max(0, Math.ceil((sessionBucketStart(now, 15) + 15 * 60_000 - now) / 60_000));
}

function Row({ symbol }: { symbol: Sym }) {
  const { result, pick, marketOpen, loading } = useBuyDecision(symbol);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  if (!result) {
    return <div className="rounded-2xl bg-slate-100 px-3 py-2.5 text-[11.5px] text-slate-500">{NAME[symbol]}: {loading ? "reading the charts…" : "not enough finished candles yet"}</div>;
  }
  const L = LOOK[result.verdict];
  const buying = result.verdict === "BUY_CE" || result.verdict === "BUY_PE";

  // An open Ai20-20 call on this market, if any.
  const open = Object.entries(tradeLogs)
    .filter(([k]) => k.startsWith(`TWENTY20-${symbol}-`))
    .flatMap(([, v]) => v)
    .find((e) => !e.closed);
  const vsCall = open
    ? result.side === open.optSide
      ? { ok: true, text: `Agrees with your Ai20-20 ${open.strike} ${open.optSide}` }
      : result.side
        ? { ok: false, text: `Leans ${result.side} — against your Ai20-20 ${open.strike} ${open.optSide}. Keep its exit level.` }
        : { ok: null, text: `No clear view on your Ai20-20 ${open.strike} ${open.optSide}` }
    : null;

  const line = buying
    ? pick
      ? `${pick.strike} ${pick.side}${pick.ltp !== null ? ` @ ₹${pick.ltp.toFixed(2)}` : ""} · trend confirmed on closed candles`
      : "Trend confirmed on closed candles"
    : result.waitingFor[0] ?? (result.side ? `Leaning ${result.side}, not confirmed yet` : "No clear edge either way");

  return (
    <Link to="/ai-verify-pro" className="block rounded-2xl p-3 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${L.from}, ${L.to})` }}>
      <div className="absolute -right-6 -top-8 w-24 h-24 rounded-full" style={{ background: "rgba(255,255,255,.08)" }} />
      <div className="relative flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-[.12em] opacity-80">{NAME[symbol]}</p>
          <p className="text-[16px] font-black leading-tight flex items-center gap-1.5">
            <L.Icon size={16} strokeWidth={2.6} /> {L.label}
          </p>
        </div>
        <div className="text-center shrink-0 rounded-xl px-2 py-1" style={{ background: "rgba(255,255,255,.16)" }}>
          <p className="text-[17px] font-black leading-none">{result.strength}</p>
          <p className="text-[7.5px] font-bold uppercase tracking-wide opacity-85">agree</p>
        </div>
        <ChevronRight size={16} className="opacity-70 shrink-0" />
      </div>
      <p className="relative text-[11px] leading-snug mt-1.5 opacity-95">{line}</p>
      <div className="relative flex flex-wrap gap-1 mt-1.5">
        {result.lastClosedAt && <Chip>Last candle {result.lastClosedAt}</Chip>}
        {marketOpen && result.verdict !== "CLOSED" && (
          <Chip>
            <Clock size={9} className="inline -mt-0.5 mr-0.5" />
            Next check {minutesToNextClose()} min
          </Chip>
        )}
      </div>
      {vsCall && (
        <p className="relative text-[10.5px] font-black mt-1.5 rounded-lg px-2 py-1" style={{ background: vsCall.ok ? "rgba(255,255,255,.92)" : "rgba(15,23,42,.35)", color: vsCall.ok ? "#047857" : "#fff" }}>
          {vsCall.ok === false ? "⚠ " : vsCall.ok ? "✓ " : ""}
          {vsCall.text}
        </p>
      )}
    </Link>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9.5px] font-bold rounded-full px-1.5 py-[2px]" style={{ background: "rgba(255,255,255,.18)" }}>
      {children}
    </span>
  );
}

export function AiVerifyQuickCard() {
  return (
    <section className="rounded-3xl bg-white shadow-md p-3 space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <BadgeCheck size={15} className="text-indigo-600" />
        <p className="text-[12.5px] font-black text-slate-800">AI Verify Pro — quick look</p>
        <p className="text-[9.5px] text-slate-400 ml-auto">15m · 1h · 4h closed candles</p>
      </div>
      <Row symbol="NATURALGAS" />
      <Row symbol="CRUDEOIL" />
      <p className="text-[9.5px] text-slate-400 leading-snug px-1">
        "Forming" is not a buy until one more candle confirms. "Agree" is how much of the evidence points the same way (max 94), not a chance of profit. Tap for every reason.
      </p>
    </section>
  );
}
