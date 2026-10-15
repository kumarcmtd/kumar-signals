// THE TRADE CARD -- one glance, one answer, for Crude Oil and Natural Gas.
//
//   full GREEN  TRADE CE NOW   all 5 checks pass
//   full RED    TRADE PE NOW   all 5 checks pass
//   light tint  WAIT           right side, wrong moment -- the buyer/seller
//                              zone to wait for is shown in big numbers
//   grey        AVOID          sideways, conflicting, or news vs chart
// It changes only when a 5-minute candle closes (the time is on the card),
// so it does not flicker with every tick. Ai20-20, Best Call and AI Verify
// Pro are inputs; where they disagree, this card is the referee.

import { Link } from "react-router-dom";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, Check, X, Minus } from "lucide-react";
import { useTradeVerdict } from "../hooks/useTradeVerdict";
import { useAppStore } from "../store/appStore";
import type { TradeAction, TradeVerdict } from "../utils/tradeVerdict";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const LOOK: Record<TradeAction, { bg: string; ink: string; sub: string; glow?: string }> = {
  TRADE_CE: { bg: "linear-gradient(135deg,#059669,#16A34A 55%,#22C55E)", ink: "#FFFFFF", sub: "rgba(255,255,255,.18)", glow: "0 0 0 3px #86EFAC, 0 0 22px #22C55EAA" },
  TRADE_PE: { bg: "linear-gradient(135deg,#BE123C,#DC2626 55%,#EF4444)", ink: "#FFFFFF", sub: "rgba(255,255,255,.18)", glow: "0 0 0 3px #FDA4AF, 0 0 22px #EF4444AA" },
  WAIT_CE: { bg: "linear-gradient(135deg,#ECFDF5,#D1FAE5)", ink: "#065F46", sub: "rgba(6,95,70,.08)" },
  WAIT_PE: { bg: "linear-gradient(135deg,#FFF1F2,#FFE4E6)", ink: "#9F1239", sub: "rgba(159,18,57,.08)" },
  AVOID: { bg: "repeating-linear-gradient(135deg,#F1F5F9 0 14px,#E2E8F0 14px 28px)", ink: "#334155", sub: "rgba(51,65,85,.08)" },
  CLOSED: { bg: "#F1F5F9", ink: "#475569", sub: "rgba(71,85,105,.08)" },
  NO_DATA: { bg: "#F8FAFC", ink: "#64748B", sub: "rgba(100,116,139,.08)" },
};

const rs = (n: number | null) => (n === null ? "—" : `₹${n.toFixed(2)}`);

function Checks({ v, ink }: { v: TradeVerdict; ink: string }) {
  if (!v.checks.length) return null;
  return (
    <div className="mt-2 space-y-[3px]">
      {v.checks.map((c) => {
        const Icon = c.state === "pass" ? Check : c.state === "fail" ? X : Minus;
        const dot = c.state === "pass" ? "#16A34A" : c.state === "fail" ? "#DC2626" : "#94A3B8";
        return (
          <div key={c.key} className="flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: ink }}>
            <span className="mt-[1px] shrink-0 rounded-full w-4 h-4 flex items-center justify-center bg-white" style={{ color: dot }}>
              <Icon size={11} strokeWidth={3.2} />
            </span>
            <span>
              <b>{c.label}:</b> <span className="opacity-90">{c.text}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Row({ symbol }: { symbol: Sym }) {
  const { verdict: v, since, pick, livePrice, error, loading } = useTradeVerdict(symbol);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const L = LOOK[v.action];
  const trade = v.action === "TRADE_CE" || v.action === "TRADE_PE";
  const wait = v.action === "WAIT_CE" || v.action === "WAIT_PE";

  if (v.action === "NO_DATA" && error && !loading) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 px-3 py-2.5">
        <p className="text-[12px] font-black text-rose-700">{NAME[symbol]}: live data unavailable — no call</p>
        <p className="text-[10.5px] text-rose-700/90 leading-snug mt-0.5">{error}</p>
      </div>
    );
  }

  // The option to buy: AI Verify's ATM pick, only when it is on the card's side.
  const opt = pick && v.side && pick.side === v.side ? pick : null;
  const prem = (level: number | null) =>
    opt && opt.ltp !== null && opt.delta !== null && level !== null && livePrice !== null ? Math.max(0.05, opt.ltp + opt.delta * (level - livePrice)) : null;

  // A running call that this card is against.
  const running = Object.entries(tradeLogs)
    .filter(([k]) => k.startsWith(`TWENTY20-${symbol}-`) || k === `BEST-${symbol}`)
    .flatMap(([, list]) => list)
    .filter((e) => !e.closed);
  const clash = running.find((e) => !(trade && e.optSide === v.side));

  return (
    <div className="rounded-2xl p-3 relative overflow-hidden" style={{ background: L.bg, color: L.ink, boxShadow: trade ? L.glow : "0 1px 4px rgba(15,23,42,.08)" }}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] opacity-80">{NAME[symbol]}</p>
          <p className={`font-black leading-tight ${trade ? "text-[24px]" : "text-[19px]"}`}>{v.headline}</p>
        </div>
        <div className="text-center shrink-0 rounded-xl px-2 py-1" style={{ background: L.sub }}>
          <p className="text-[18px] font-black leading-none">{v.passed}/5</p>
          <p className="text-[8px] font-bold uppercase tracking-wide opacity-85">checks</p>
        </div>
      </div>
      <p className="text-[12.5px] font-bold leading-snug mt-1">{v.reason}</p>

      {trade && (
        <div className="mt-2 rounded-xl px-2.5 py-2 text-[12px] font-bold leading-snug" style={{ background: L.sub }}>
          {opt ? (
            <p className="text-[14px] font-black">
              Buy {opt.strike} {opt.side}
              {opt.ltp !== null && ` @ ~₹${opt.ltp.toFixed(2)}`}
            </p>
          ) : (
            <p className="text-[13px] font-black">Buy ATM {v.side}</p>
          )}
          <p>
            Stop: futures {rs(v.stop)}
            {prem(v.stop) !== null && ` (premium ~₹${prem(v.stop)!.toFixed(1)})`} · Target: {rs(v.t1)}
            {prem(v.t1) !== null && ` (~₹${prem(v.t1)!.toFixed(1)})`}
            {v.rr !== null && ` · ${v.rr}× reward`}
          </p>
        </div>
      )}

      {wait && v.entryZone && (
        <div className="mt-2 rounded-xl px-2.5 py-2 bg-white/80">
          <p className="text-[10px] font-black uppercase tracking-wide opacity-80">{v.side === "CE" ? "Buyer zone — wait for price here" : "Seller zone — wait for price here"}</p>
          <p className="text-[20px] font-black leading-tight tabular-nums">
            {rs(v.entryZone.low)} – {rs(v.entryZone.high)}
          </p>
          {livePrice !== null && <p className="text-[10.5px] font-bold opacity-80">Now {rs(livePrice)} · then a strong {v.side === "CE" ? "green" : "red"} 5-min candle = entry</p>}
        </div>
      )}

      <Checks v={v} ink={L.ink} />

      {(v.buyerZone || v.sellerZone) && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px] font-bold">
          <div className="rounded-lg px-2 py-1 bg-emerald-50 text-emerald-800">
            Buyers {v.buyerZone ? `${rs(v.buyerZone.low)}–${v.buyerZone.high.toFixed(2)}` : "none near"}
          </div>
          <div className="rounded-lg px-2 py-1 bg-rose-50 text-rose-800">
            Sellers {v.sellerZone ? `${rs(v.sellerZone.low)}–${v.sellerZone.high.toFixed(2)}` : "none near"}
          </div>
        </div>
      )}

      {clash && (
        <p className="mt-2 text-[11px] font-black rounded-lg px-2 py-1 bg-white text-rose-700">
          ⚠ Your running {clash.strike} {clash.optSide} is not backed by this card — no adding; follow its stop or book what you have.
        </p>
      )}

      <p className="text-[10px] font-bold mt-2 opacity-75">
        {v.basedOn ? `Based on the ${v.basedOn} candle` : ""}
        {since && since !== v.basedOn ? ` · this call since ${since}` : ""}
        {v.nextAt ? ` · next update ${v.nextAt}` : ""}
      </p>
    </div>
  );
}

export function TradeCard() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await Promise.all([qc.refetchQueries({ queryKey: ["candles"] }), qc.refetchQueries({ queryKey: ["options-analytics"] })]).finally(() => setSpinning(false));
  };
  return (
    <section className="rounded-3xl bg-white shadow-md p-3 space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <ShieldCheck size={16} className="text-indigo-600" />
        <p className="text-[13.5px] font-black text-slate-900">Trade Card — one answer</p>
        <button onClick={refresh} className="ml-auto text-[10.5px] font-black text-indigo-700 bg-indigo-50 rounded-lg px-2 py-1 flex items-center gap-1">
          <RefreshCw size={11} className={spinning ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <Row symbol="CRUDEOIL" />
      <Row symbol="NATURALGAS" />
      <p className="text-[9.5px] text-slate-500 leading-snug px-1">
        Full green / red only when all 5 pass: trend (15m·1h·4h), steady 5-min candles, a strong candle with volume, news not against, and a good entry spot with room. Buyer/seller zones are where price turned hard before (15-min candles, last 2 days). Changes only when a 5-min candle closes; it says EXIT at once if the stop breaks. Not a guarantee —{" "}
        <Link to="/ai-verify-pro" className="underline">
          full reasons
        </Link>
        .
      </p>
    </section>
  );
}
