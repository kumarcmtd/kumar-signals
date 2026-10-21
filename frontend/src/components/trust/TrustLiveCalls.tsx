// Ai-Trust's calls as live trade cards, like Ai20-20: the option that was
// called, when, the entry premium, the live premium, stop and targets on a
// price scale, and what an investment is worth now. One card per market --
// the running call, or the latest one from today.
//
// The option plan (strike, entry premium, premium at stop / T1 / T2) is
// saved by the server at the moment of the call (tradeCardTracker). The stop
// and target premiums are delta estimates from the futures levels; the call
// itself is settled on the futures, so the badge can differ slightly from
// the premium scale.

import { useState } from "react";
import { Gem, Zap, ShieldCheck, FlaskConical } from "lucide-react";
import { AiChart } from "./AiChart";
import { useOptionsAnalytics, useTradeCardLog } from "../../api/hooks";
import { liveLtpFor } from "../../hooks/useTradeLog";
import { PriceScale, ProfitEstimate } from "../CallCardKit";
import { LOT_SIZE } from "../../utils/aiTwentyTwentyEngine";
import type { CardCall } from "../../utils/tradeCardLog";
import type { TradeLogEntry } from "../../utils/tradeLogCore";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

const RESULT: Record<NonNullable<CardCall["result"]> | "open", { t: string; bg: string; fg: string }> = {
  open: { t: "RUNNING", bg: "#FEF3C7", fg: "#92400E" },
  target: { t: "TARGET HIT ✓", bg: "#D1FAE5", fg: "#065F46" },
  stop: { t: "STOP HIT ✗", bg: "#FFE4E6", fg: "#9F1239" },
  time_exit: { t: "TIME EXIT", bg: "#E0E7FF", fg: "#3730A3" },
  day_end: { t: "DAY END", bg: "#E0E7FF", fg: "#3730A3" },
};

/** Premium at a futures price, from the call's own delta. */
const premAt = (c: CardCall, fut: number) => (c.opt && c.opt.delta !== null ? Math.max(0.05, c.opt.entry + c.opt.delta * (fut - c.entry)) : null);

/** The call in the shape the Ai20-20 price scale and investment box read. */
export function toLogEntry(c: CardCall): TradeLogEntry | null {
  const o = c.opt;
  if (!o || o.stop === null || o.t1 === null) return null;
  const t2 = o.t2 ?? o.t1;
  const best = o.entry + Math.abs(o.delta ?? 0.5) * c.bestPts;
  const exit = c.exit !== null ? premAt(c, c.exit) : null;
  return {
    id: c.id,
    strike: o.strike,
    optSide: c.side,
    entry: o.entry,
    targets: [o.t1, t2, t2],
    stop: o.stop,
    targetsHit: [c.result === "target", false, false],
    status: !c.closed ? "running" : c.result === "stop" ? "sl_hit" : c.result === "target" ? "stopped_after_t1" : "closed_eod",
    closed: c.closed,
    openedAt: Date.parse(c.openedAt),
    closedAt: c.closedAt ? Date.parse(c.closedAt) : null,
    highWaterMark: Math.max(best, o.entry),
    ...(exit !== null ? { exitPrice: Math.round(exit * 100) / 100 } : {}),
  };
}

function CallCard({ sym, c }: { sym: Sym; c: CardCall }) {
  const options = useOptionsAnalytics(sym);
  const entry = toLogEntry(c);
  const live = c.opt ? liveLtpFor(options.data, c.opt.strike, c.side) : null;
  const current = c.closed ? (entry?.exitPrice ?? null) : live;
  const tier = c.tier ?? "card";
  const look =
    tier === "proven"
      ? { Icon: FlaskConical, label: "PROVEN STRATEGY", bar: "linear-gradient(180deg,#059669,#0D9488)" }
      : tier === "trust"
      ? { Icon: Gem, label: "AI-TRUST CALL", bar: "linear-gradient(180deg,#7C3AED,#DB2777)" }
      : tier === "quick"
        ? { Icon: Zap, label: "QUICK TRADE · half size", bar: "linear-gradient(180deg,#0284C7,#7C3AED)" }
        : { Icon: ShieldCheck, label: "TRADE CARD CALL", bar: c.side === "CE" ? "#10B981" : "#F43F5E" };
  const res = RESULT[c.result ?? "open"];
  const pnlPct = current !== null && c.opt ? ((current - c.opt.entry) / c.opt.entry) * 100 : null;
  const [chart, setChart] = useState(false);

  return (
    <div className="relative rounded-3xl bg-white shadow-lg overflow-hidden border border-slate-100">
      <div className="absolute left-0 top-0 bottom-0 w-2" style={{ background: look.bar }} />
      <div className="pl-5 pr-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-violet-700 flex items-center gap-1">
            <look.Icon size={13} /> {look.label}
          </p>
          <span className="ml-auto text-[10.5px] font-black rounded-md px-2 py-0.5" style={{ background: res.bg, color: res.fg }}>
            {res.t}
          </span>
        </div>
        <p className="text-[24px] font-black text-slate-900 leading-tight mt-1">
          {NAME[sym]} {c.opt ? c.opt.strike : "ATM"} <span className={c.side === "CE" ? "text-emerald-600" : "text-rose-600"}>{c.side}</span>
        </p>
        <p className="text-[11.5px] text-slate-500 mt-0.5">
          Called {when(c.openedAt)}
          {c.opt ? ` at ₹${c.opt.entry.toFixed(2)}` : ""}
          {tier === "quick" && c.exitByIso && !c.closed ? ` · exit by ${when(c.exitByIso).split(", ").pop()}` : ""}
        </p>

        {c.opt ? (
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Box label="Entry" value={`₹${c.opt.entry.toFixed(2)}`} />
            <Box label={c.closed ? "Exit (est.)" : "Live now"} value={current !== null ? `₹${current.toFixed(2)}` : "—"} />
            <Box
              label="P&L"
              value={pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
              tone={pnlPct === null ? undefined : pnlPct >= 0 ? "good" : "bad"}
            />
            <Box label="Stop loss" value={c.opt.stop !== null ? `₹${c.opt.stop.toFixed(2)}` : "—"} tone="bad" />
            <Box label="Target 1" value={c.opt.t1 !== null ? `₹${c.opt.t1.toFixed(2)}` : "—"} tone="good" />
            <Box label="Target 2" value={c.opt.t2 !== null ? `₹${c.opt.t2.toFixed(2)}` : "—"} tone="good" />
          </div>
        ) : (
          <p className="text-[11.5px] text-slate-500 mt-2">This call was logged before option prices were saved with calls — futures levels below.</p>
        )}
        {c.opt && c.opt.t1 !== null && c.opt.stop !== null && !c.closed && (
          <div className="mt-2 rounded-xl bg-violet-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">Upstox P&L exit — per lot (× your lots)</p>
            <p className="text-[14px] font-black text-slate-800 mt-0.5">
              <span className="text-emerald-700">Profit +₹{Math.round((c.opt.t1 - c.opt.entry) * LOT_SIZE[sym]).toLocaleString("en-IN")}</span>
              {"  ·  "}
              <span className="text-rose-700">Loss −₹{Math.round((c.opt.entry - c.opt.stop) * LOT_SIZE[sym]).toLocaleString("en-IN")}</span>
            </p>
          </div>
        )}
        {c.result === "stop" && <p className="mt-2 rounded-xl bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-800">{lossReview(c)}</p>}
        <p className="text-[10.5px] text-slate-500 mt-2">
          Futures: entry {c.entry} · stop {c.stop} · T1 {c.t1}
          {c.t2 ? ` · T2 ${c.t2}` : ""}
          {c.r !== null ? ` · result ${c.r >= 0 ? "+" : ""}${c.r}R` : ""}
        </p>
      </div>
      <div className="px-4 pb-2">
        <button onClick={() => setChart((x) => !x)} className="w-full rounded-xl bg-violet-50 text-violet-800 py-2 text-[12px] font-black">
          {chart ? "Hide chart" : "📈 View this call on the AI chart"}
        </button>
        {chart && <AiChart symbol={sym} plan={{ side: c.side, entry: c.entry, stop: c.stop, t1: c.t1, t2: c.t2 ?? null, zone: null, label: c.closed ? "Plan at entry" : "Plan: T1 → T2" }} levels={null} />}
      </div>
      {entry && <PriceScale entry={entry} current={current} />}
      {entry && <ProfitEstimate trade={entry} current={current} lotSize={LOT_SIZE[sym]} />}
      <p className="px-5 pb-3 text-[9.5px] text-slate-400 leading-snug">Stop / target premiums are estimates from the futures levels (option delta). The call is settled on the futures price.</p>
    </div>
  );
}

/** One line on how a losing call failed -- so losses can be learned from. */
export function lossReview(c: CardCall): string {
  const mins = c.closedAt ? Math.round((Date.parse(c.closedAt) - Date.parse(c.openedAt)) / 60_000) : null;
  const risk = Math.abs(c.entry - c.stop);
  const went = risk > 0 ? c.bestPts / risk : 0;
  const how =
    went >= 0.8 ? `it went ${c.bestPts} pts your way first (${went.toFixed(1)}R) — a trailing stop / partial booking would have saved it` : went >= 0.3 ? `it moved only ${c.bestPts} pts your way before turning` : "it turned against you almost at once — the entry was late or the move was already over";
  return `Loss review: stopped ${mins !== null ? `after ${mins} min` : ""}; ${how}.`;
}

function Box({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl px-2 py-1.5 text-center" style={{ background: tone === "good" ? "#ECFDF5" : tone === "bad" ? "#FFF1F2" : "#F8FAFC" }}>
      <p className="text-[9.5px] font-bold uppercase text-slate-500">{label}</p>
      <p className={`text-[14px] font-black ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export function TrustLiveCalls() {
  const q = useTradeCardLog();
  const today = istDay(Date.now());
  const pickFor = (sym: Sym): CardCall | null => {
    const log = q.data?.[sym] ?? [];
    const open = log.find((c) => !c.closed);
    if (open) return open;
    const last = log[log.length - 1];
    return last && istDay(Date.parse(last.openedAt)) === today ? last : null;
  };
  const calls = (["CRUDEOIL", "NATURALGAS"] as const).map((s) => [s, pickFor(s)] as const).filter(([, c]) => c);
  if (!calls.length) return null;
  return (
    <section className="space-y-3">
      <p className="text-[13px] font-black text-slate-900 px-1">Today's calls — live</p>
      {calls.map(([s, c]) => (
        <CallCard key={c!.id} sym={s} c={c!} />
      ))}
    </section>
  );
}
