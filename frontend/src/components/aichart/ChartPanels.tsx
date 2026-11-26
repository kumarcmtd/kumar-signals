// What sits around the Ai-Chart: the colour legend, the tapped call's details,
// the list of calls on the chart, and the levels in numbers.

import { Link } from "react-router-dom";
import { callResult, type CallMark, type ChartSym } from "../../utils/callMarks";
import type { SrLevel } from "../../utils/srLevels";
import { LEVEL_STYLE } from "./chartStyle";

const inr = (n: number, d = 0) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (n: number) => (n === 0 ? "₹0" : `${n > 0 ? "+" : "−"}₹${Math.abs(n).toLocaleString("en-IN")}`);
const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const TONE = { win: "#059669", loss: "#DC2626", flat: "#64748B", open: "#2563EB" } as const;

function Bar({ color, width, label }: { color: string; width: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-6 rounded-full" style={{ height: width + 1, background: color }} />
      {label}
    </span>
  );
}

export function Legend() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] font-bold text-slate-600">
      <Bar color={LEVEL_STYLE["support-strong"].color} width={4} label="Strong support (4+ bounces)" />
      <Bar color={LEVEL_STYLE["resistance-strong"].color} width={4} label="Strong rejection (4+)" />
      <Bar color={LEVEL_STYLE["support-weak"].color} width={2} label="Weak support (2–3)" />
      <Bar color={LEVEL_STYLE["resistance-weak"].color} width={2} label="Weak rejection (2–3)" />
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-2.5 rounded-sm bg-emerald-200 border border-emerald-500" /> Buyer zone
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-2.5 rounded-sm bg-rose-200 border border-rose-500" /> Seller zone
      </span>
      <span>
        <b className="text-emerald-600">★</b> CE call · <b className="text-rose-600">★</b> PE call
      </span>
      <span>☆ hollow = practice call</span>
      <span className="col-span-2 text-slate-400 font-semibold">×N on a line = how many separate times price turned there (90 days of 30-minute candles). P, R1, S1 pivots; PDH / PDL yesterday's high / low. Only live (running) calls are starred; “Past calls” shows the rest. Tap a star for the call.</span>
    </div>
  );
}

export function CallDetail({ m, sym, onClose }: { m: CallMark; sym: ChartSym; onClose: () => void }) {
  const r = callResult(m, sym);
  const e = m.entry;
  const col = m.side === "CE" ? "#16A34A" : "#DC2626";
  return (
    <div className="rounded-2xl border-2 p-3 space-y-1.5 bg-white" style={{ borderColor: col }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-black" style={{ color: col }}>
          {`★ ${m.page} · ${e.strike} ${m.side}${m.practice ? " (practice)" : ""}`}
        </p>
        <button onClick={onClose} className="text-[11px] font-black text-slate-400 px-2" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-[12px] text-slate-700">
        {`${when(m.openedAt)} · bought at ${inr(e.entry, 2)} · futures ${inr(m.price, m.price < 1000 ? 2 : 0)}`}
      </p>
      <p className="text-[12px] text-slate-700">{`Stop ${inr(e.stop, 2)} · T1 ${inr(e.targets[0], 2)} · T2 ${inr(e.targets[1], 2)} · T3 ${inr(e.targets[2], 2)}`}</p>
      <p className="text-[12.5px] font-black" style={{ color: TONE[r.tone] }}>
        {r.text}
        {r.rs !== null && ` · ${signed(r.rs)} a lot`}
      </p>
      <Link to={m.route} className="inline-block text-[11.5px] font-black text-violet-700">
        {`Open ${m.page} →`}
      </Link>
    </div>
  );
}

export function CallList({ marks, sym, onPick, live }: { marks: CallMark[]; sym: ChartSym; onPick: (m: CallMark) => void; live?: boolean }) {
  if (!marks.length)
    return (
      <p className="text-[11.5px] text-slate-500">
        {live ? "No live call right now. A star appears on the chart the moment any page gives a CE or PE call, and goes when the call closes. Tap “Past calls” to see earlier ones." : "No page has called on this market in the candles shown. Calls appear here and on the chart as stars the moment a page gives one."}
      </p>
    );
  return (
    <div className="space-y-1.5">
      {[...marks].reverse().slice(0, 20).map((m) => {
        const r = callResult(m, sym);
        return (
          <button key={m.id} onClick={() => onPick(m)} className="w-full flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-left">
            <span className="text-[16px] leading-none" style={{ color: m.side === "CE" ? "#16A34A" : "#DC2626" }}>
              {m.practice ? "☆" : "★"}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] font-black text-slate-800 truncate">{`${m.page} · ${m.entry.strike} ${m.side}`}</span>
              <span className="block text-[10.5px] text-slate-500">{`${when(m.openedAt)} · futures ${inr(m.price, m.price < 1000 ? 2 : 0)}`}</span>
            </span>
            <span className="text-[11px] font-black text-right shrink-0" style={{ color: TONE[r.tone] }}>
              {r.rs !== null ? signed(r.rs) : r.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LevelChips({ levels, price, decimals }: { levels: SrLevel[]; price: number; decimals: number }) {
  const sorted = [...levels].sort((a, b) => b.price - a.price);
  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map((l) => {
        const st = LEVEL_STYLE[`${l.kind}-${l.tier}`];
        const away = l.price - price;
        return (
          <span key={`${l.kind}${l.price}`} className="text-[10.5px] font-black rounded-lg px-2 py-1 text-white" style={{ background: st.color }}>
            {`${l.kind === "support" ? "S" : "R"}${l.tier === "strong" ? "★" : ""} ${inr(l.price, decimals)} ×${l.holds} (${away >= 0 ? "+" : "−"}${Math.abs(away).toFixed(decimals)})`}
          </span>
        );
      })}
    </div>
  );
}
