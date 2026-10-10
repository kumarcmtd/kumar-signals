// A one-glance AI Verify Pro read for both markets, for the Ai20-20 page:
// the verdict, how much of the evidence agrees, when the next candle check is,
// what it is waiting for, and whether it agrees with an open Ai20-20 call.
// The full reasons stay on AI Verify Pro; tapping a row goes there.

import { Link } from "react-router-dom";
import { RefreshCw, BadgeCheck, ChevronRight, Clock } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBuyDecision } from "../hooks/useBuyDecision";
import { LiveNowPill } from "./decision/LiveNow";
import { useAppStore } from "../store/appStore";
import { sessionBucketStart } from "../utils/candleResample";
import { sideLook } from "./decision/sideLook";
import { callMatch, type MatchLevel } from "../utils/callMatch";

const MATCH_STYLE: Record<MatchLevel, React.CSSProperties> = {
  matched: { background: "#FFFFFF", color: "#047857", boxShadow: "0 0 0 2px #10B981" },
  same_side_unconfirmed: { background: "rgba(255,255,255,.85)", color: "#475569" },
  fading: { background: "#FFFBEB", color: "#B45309" },
  against: { background: "#FEF2F2", color: "#B91C1C" },
  no_view: { background: "rgba(255,255,255,.85)", color: "#475569" },
};
const MATCH_ICON: Record<MatchLevel, string> = { matched: "✅", same_side_unconfirmed: "⏳", fading: "⚠", against: "⚠", no_view: "·" };

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

function minutesToNextClose(): number {
  const now = Date.now();
  return Math.max(0, Math.ceil((sessionBucketStart(now, 15) + 15 * 60_000 - now) / 60_000));
}

function Row({ symbol }: { symbol: Sym }) {
  const { result, pick, live, marketOpen, loading } = useBuyDecision(symbol);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  if (!result) {
    return <div className="rounded-2xl bg-slate-100 px-3 py-2.5 text-[11.5px] text-slate-500">{NAME[symbol]}: {loading ? "reading the charts…" : "not enough finished candles yet"}</div>;
  }
  const L = sideLook(result);
  // Light (early-lean) rows use dark ink; the rest stay white on colour.
  const soft = L.light ? "rgba(15,23,42,.07)" : "rgba(255,255,255,.18)";
  const buying = result.verdict === "BUY_CE" || result.verdict === "BUY_PE";

  // An open Ai20-20 call on this market, if any.
  const open = Object.entries(tradeLogs)
    .filter(([k]) => k.startsWith(`TWENTY20-${symbol}-`))
    .flatMap(([, v]) => v)
    .find((e) => !e.closed);
  // Same rule as the MATCHED push alert (utils/callMatch).
  const match = open ? callMatch(result, live, open.optSide) : null;
  const vsCall = match && open ? { level: match.level, text: `${match.text} (your Ai20-20 ${open.strike} ${open.optSide})` } : null;

  const line = buying
    ? pick
      ? `${pick.strike} ${pick.side}${pick.ltp !== null ? ` @ ₹${pick.ltp.toFixed(2)}` : ""} · trend confirmed on closed candles`
      : "Trend confirmed on closed candles"
    : result.waitingFor[0] ?? (result.side ? `Leaning ${result.side}, not confirmed yet` : "No clear edge either way");

  return (
    <Link to="/ai-verify-pro" className="block rounded-2xl p-3 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${L.from}, ${L.to})`, color: L.ink, border: L.light ? `1px solid ${L.ink}33` : undefined }}>
      <div className="absolute -right-6 -top-8 w-24 h-24 rounded-full" style={{ background: "rgba(255,255,255,.08)" }} />
      <div className="relative flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-[.12em] opacity-80">{NAME[symbol]}</p>
          <p className="text-[16px] font-black leading-tight flex items-center gap-1.5">
            <L.Icon size={16} strokeWidth={2.6} /> {L.label}
          </p>
          {L.tag && <p className="text-[10px] font-black mt-0.5 opacity-90">{L.tag}</p>}
        </div>
        <div className="text-center shrink-0 rounded-xl px-2 py-1" style={{ background: soft }}>
          <p className="text-[17px] font-black leading-none">{result.strength}</p>
          <p className="text-[7.5px] font-bold uppercase tracking-wide opacity-85">agree</p>
        </div>
        <ChevronRight size={16} className="opacity-70 shrink-0" />
      </div>
      <p className="relative text-[11px] leading-snug mt-1.5 opacity-95">{line}</p>
      <div className="relative flex flex-wrap gap-1 mt-1.5">
        {result.lastClosedAt && <Chip bg={soft}>Last candle {result.lastClosedAt}</Chip>}
        {marketOpen && result.verdict !== "CLOSED" && (
          <Chip bg={soft}>
            <Clock size={9} className="inline -mt-0.5 mr-0.5" />
            Next check {minutesToNextClose()} min
          </Chip>
        )}
      </div>
      {live && <LiveNowPill read={live} />}
      {vsCall && (
        <p className="relative text-[10.5px] font-black mt-1.5 rounded-lg px-2 py-1" style={MATCH_STYLE[vsCall.level]}>
          {MATCH_ICON[vsCall.level]} {vsCall.text}
        </p>
      )}
    </Link>
  );
}

function Chip({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <span className="text-[9.5px] font-bold rounded-full px-1.5 py-[2px]" style={{ background: bg }}>
      {children}
    </span>
  );
}

export function AiVerifyQuickCard() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await Promise.all([qc.refetchQueries({ queryKey: ["candles"] }), qc.refetchQueries({ queryKey: ["options-analytics"] })]).finally(() => setSpinning(false));
  };
  return (
    <section className="rounded-3xl bg-white shadow-md p-3 space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <BadgeCheck size={15} className="text-indigo-600" />
        <p className="text-[12.5px] font-black text-slate-800">AI Verify Pro — quick look</p>
        <button onClick={refresh} className="ml-auto text-[10.5px] font-black text-indigo-700 bg-indigo-50 rounded-lg px-2 py-1 flex items-center gap-1">
          <RefreshCw size={11} className={spinning ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <Row symbol="NATURALGAS" />
      <Row symbol="CRUDEOIL" />
      <p className="text-[9.5px] text-slate-400 leading-snug px-1">
        Decision: 15m · 1h · 4h closed candles. "Right now" is the live candle and can change before it closes. Green = CE (bullish), red = PE (bearish); light = early lean, medium = setup forming, deep = BUY. "Forming" is not a buy until one more candle confirms. "Agree" is how much of the evidence points the same way (max 94), not a chance of profit. Tap for every reason.
      </p>
    </section>
  );
}
