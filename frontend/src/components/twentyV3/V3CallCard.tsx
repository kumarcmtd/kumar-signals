// One market on the Ai20-20 v3 page: the exact order to place when a call
// comes (lots from the trader's own plan), then the running call managed step
// by step -- or, while there is no call, what each setup is waiting for.

import { useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Copy, Clock3, CheckCircle2, Circle } from "lucide-react";
import { useCreateTrade } from "../../api/hooks";
import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { effectiveStopFor, liveLtpFor, type TradeLogEntry } from "../../utils/tradeLogCore";
import { LAB_LOT } from "../../utils/twentyLab";
import { buyNowAdvice, minutesToMcxClose } from "../../utils/buyNow";
import { PriceScale, fmtWhen } from "../CallCardKit";
import { BuyNowBanner } from "../BuyNowBanner";
import { AiChart } from "../trust/AiChart";
import { isPracticeSetup } from "../../utils/twentyV3/live";

const inr = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${inr(n)}`;
const NAME = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" } as const;
/** "1 call", "0 calls" -- one text piece, so a phone translator or reader cannot split "call" from "s". */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Level({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2 bg-slate-50 border border-slate-100">
      <p className="text-[9.5px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-[13px] font-black" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[10px] font-bold text-slate-500">{sub}</p>}
    </div>
  );
}

function Steps({ open }: { open: TradeLogEntry }) {
  const steps = open.manage === "hold"
    ? [
        { done: true, text: `Bought at ₹${open.entry}. Stop ₹${open.stop} — it stays there, it does not move.` },
        { done: open.targetsHit[0], text: `Hold. ₹${open.targets[0]} / ₹${open.targets[1]} / ₹${open.targets[2]} are profit marks, not exits — big opening moves tend to run into the close.` },
        { done: false, text: "Sell at the MCX close (the app alerts you 15 minutes before) — never carry it overnight." },
      ]
    : [
    { done: true, text: `Bought at ₹${open.entry}. Stop ₹${open.stop}.` },
    { done: open.targetsHit[0], text: `At T1 ₹${open.targets[0]}: move the stop up to your entry ₹${open.entry} — no loss possible after that.` },
    { done: open.targetsHit[1], text: `At T2 ₹${open.targets[1]}: move the stop to T1 ₹${open.targets[0]} — profit locked.` },
    { done: open.targetsHit[2], text: `At T3 ₹${open.targets[2]}: sell everything.` },
    { done: false, text: "Still open near MCX close? Sell at the close — never carry it overnight." },
      ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase text-slate-400">How to manage it</p>
      {steps.map((s, i) => (
        <p key={i} className={`text-[11.5px] leading-snug flex gap-2 ${i === next ? "font-black text-slate-800" : s.done ? "text-emerald-700" : "text-slate-500"}`}>
          {s.done ? <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-500" /> : <Circle size={14} className={`shrink-0 mt-0.5 ${i === next ? "text-sky-500" : "text-slate-300"}`} />}
          {s.text}
        </p>
      ))}
    </div>
  );
}

function RunningCall({ s, open, older }: { s: TwentyV3State; open: TradeLogEntry; older: boolean }) {
  const lot = LAB_LOT[s.sym];
  const lots = Math.max(1, s.lots.lots);
  const qty = lots * lot;
  const ltp = liveLtpFor(s.options, open.strike, open.optSide);
  const stop = effectiveStopFor(open);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const [chart, setChart] = useState(false);
  const createTrade = useCreateTrade();
  const order =
    open.manage === "hold"
      ? `BUY ${NAME[s.sym]} ${open.strike} ${open.optSide} — ${lots} lot${lots > 1 ? "s" : ""} (${qty} qty) @ ₹${open.entry}\nStop ₹${stop} (fixed). Hold — sell at the MCX close.`
      : `BUY ${NAME[s.sym]} ${open.strike} ${open.optSide} — ${lots} lot${lots > 1 ? "s" : ""} (${qty} qty) @ ₹${open.entry}\nStop ₹${stop} · T1 ₹${open.targets[0]} · T2 ₹${open.targets[1]} · T3 ₹${open.targets[2]}\nAfter T1 move the stop to entry. Sell before MCX close.`;
  return (
    <div className="space-y-2.5">
      {open.practice && (
        <p className="text-[11.5px] font-black text-amber-900 rounded-xl bg-amber-100 border border-amber-300 px-2.5 py-2">
          📝 PRACTICE CALL — paper only. Follow it on paper to learn the moves; this setup has not proven itself on 10 years of prices, so no real money.
        </p>
      )}
      <div className="rounded-2xl p-3" style={{ background: open.optSide === "CE" ? "#ECFDF5" : "#FFF1F2" }}>
        <p className="text-[10px] font-black uppercase text-slate-500">{open.meta?.label ?? "Ai20-20"}{older ? " · earlier rules" : ""}</p>
        <p className="text-[16px] font-black text-slate-800">
          {`${open.practice ? "PAPER BUY" : "BUY"} ${plural(lots, "lot")} · ${open.strike} ${open.optSide} @ ₹${open.entry}`}
        </p>
        <p className="text-[10.5px] text-slate-500">
          {qty} qty · called {fmtWhen(open.openedAt)} · {open.practice ? `sized as your plan would size it (${s.lots.lots > 0 ? s.lots.why : "0 lots — stop wider than your per-trade limit"})` : s.lots.lots > 0 ? s.lots.why : "Your plan allows 0 lots for this stop — shown at 1 lot."}
        </p>
      </div>
      <BuyNowBanner advice={buyNowAdvice({ entry: open.entry, stop: open.stop, targets: open.targets, targetsHit: open.targetsHit, closed: open.closed, live: ltp, lot, minutesToClose: minutesToMcxClose(), hold: open.manage === "hold" })} />
      <div className="grid grid-cols-3 gap-2">
        <Level label={open.targetsHit[0] && open.manage !== "hold" ? "Stop (moved)" : "Stop"} value={`₹${stop}`} sub={signed((stop - open.entry) * qty)} color="#E11D48" />
        <Level label="Target 1" value={`₹${open.targets[0]}`} sub={signed((open.targets[0] - open.entry) * qty)} color="#059669" />
        <Level label="Target 2" value={`₹${open.targets[1]}`} sub={signed((open.targets[1] - open.entry) * qty)} color="#059669" />
        <Level label="Target 3" value={`₹${open.targets[2]}`} sub={signed((open.targets[2] - open.entry) * qty)} color="#059669" />
        <Level label="Live premium" value={ltp !== null ? `₹${ltp}` : "—"} color="#4F46E5" />
        <Level label="P&L now" value={ltp !== null ? signed((ltp - open.entry) * qty) : "—"} sub={plural(lots, "lot")} color={ltp !== null && ltp >= open.entry ? "#059669" : "#E11D48"} />
      </div>
      <p className="text-[10.5px] text-slate-500 leading-snug">
        If your broker exits by profit/loss in rupees: loss exit at <b>{signed((open.stop - open.entry) * qty)}</b>, first profit at <b>{signed((open.targets[0] - open.entry) * qty)}</b>.
      </p>
      <Steps open={open} />
      <PriceScale entry={open} current={ltp} />
      <div className="flex gap-2">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(order);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 border border-slate-200 text-slate-700"
        >
          <Copy size={13} /> {copied ? "Copied ✓" : "Copy order"}
        </button>
        <button
          disabled={logged}
          onClick={() =>
            createTrade.mutate(
              { symbol: s.sym, optSide: open.optSide, strike: open.strike, entryPrice: open.entry, stopLoss: open.stop, target: open.targets[0], quantity: lots, lotSize: lot, source: "master-ai", notes: `${open.practice ? "PAPER trade — " : ""}Logged from ${open.meta?.label ?? "Ai20-20 v3"}` },
              { onSuccess: () => setLogged(true) }
            )
          }
          className="flex-1 px-3 py-2 rounded-xl text-xs font-black text-white disabled:opacity-60"
          style={{ background: open.optSide === "CE" ? "#059669" : "#E11D48" }}
        >
          {logged ? "Logged in portfolio ✓" : open.practice ? "Log my paper trade" : "I took it — log in portfolio"}
        </button>
      </div>
      <button onClick={() => setChart((v) => !v)} className="w-full py-2.5 rounded-xl text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#7C3AED,#DB2777)" }}>
        📈 {chart ? "Hide chart" : "Chart — zones and key levels"}
      </button>
      {chart && <AiChart symbol={s.sym} plan={null} levels={null} />}
    </div>
  );
}

export function V3CallCard({ s }: { s: TwentyV3State }) {
  const r = s.read;
  const olderOpen = [...s.older].reverse().find((e) => !e.closed) ?? null;
  const open = s.running ?? olderOpen;
  const side = open?.optSide ?? r.entry?.side ?? null;
  const practice = open ? !!open.practice : r.entry ? isPracticeSetup(r.entry.setup) : false;
  const pill = open ? (practice ? "PRACTICE RUNNING" : "CALL RUNNING") : r.state === "call" ? (practice ? "PRACTICE CALL" : "NEW CALL") : r.state === "watch" ? "WATCHING" : r.state === "window_closed" ? "WAITING" : r.state === "off" ? "NO CALLS" : "LOADING";
  const hot = !!open || r.state === "call";
  // Badge colours by meaning: blue = practice, green/red = a real CE/PE call,
  // teal = watching live, amber = waiting for the window, gray = off / loading.
  const accent = hot ? (practice ? "#2563EB" : side === "CE" ? "#059669" : "#E11D48") : r.state === "watch" ? "#0D9488" : r.state === "window_closed" ? "#D97706" : "#94A3B8";
  const headBg = hot
    ? practice
      ? "linear-gradient(135deg,#EFF6FF,#FFFFFF)"
      : side === "CE"
        ? "linear-gradient(135deg,#ECFDF5,#FFFFFF)"
        : "linear-gradient(135deg,#FFF1F2,#FFFFFF)"
    : r.state === "window_closed"
      ? "linear-gradient(135deg,#FFFBEB,#FFFFFF)"
      : r.state === "watch"
        ? "linear-gradient(135deg,#F0FDFA,#FFFFFF)"
        : "linear-gradient(135deg,#F8FAFC,#FFFFFF)";
  const Dir = side === "PE" ? TrendingDown : TrendingUp;
  const blocked = r.state === "call" && !open ? (s.expiry ?? (s.guard.ok ? (s.ticket ? null : "No live option price to build the order — nothing to enter.") : s.guard.reason)) : null;
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-center gap-3" style={{ background: headBg }}>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-black text-slate-800">{s.sym === "CRUDEOIL" ? "🛢️ Crude Oil" : "🔥 Natural Gas"}</p>
          <p className="text-[11px] text-slate-500 leading-snug">{open ? `${open.optSide} call running — follow the steps below.` : r.headline}</p>
        </div>
        <span className="shrink-0 flex items-center gap-1 text-[10.5px] font-black px-2.5 py-1 rounded-full text-white" style={{ background: accent }}>
          {hot && <Dir size={12} />}
          {pill}
        </span>
      </div>
      <div className="p-4 space-y-3">
        {r.state === "off" && !open && (
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <p className="text-[11px] text-slate-600 leading-snug">Every strategy tested lost money on 2022–26 gas prices, so v3 makes no gas calls. Gas moves cleaner on the 1-hour chart.</p>
            <Link to="/ai-today" className="inline-block mt-1 text-[11.5px] font-black text-white px-3 py-1.5 rounded-xl" style={{ background: "linear-gradient(135deg,#F97316,#DB2777)" }}>
              🎯 Open Ai-Today — gas 1-hour plan
            </Link>
          </div>
        )}
        {!open && r.setups.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-slate-400">{r.setups.some((x) => isPracticeSetup(x.id)) ? "Practice setup — what it is waiting for" : "Live setups — what each is waiting for"}</p>
            {r.setups.map((x) => (
              <div key={x.id} className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2">
                <p className="text-[11.5px] font-black text-slate-800">{x.fired ? "✅ " : ""}{x.name}</p>
                <p className="text-[11px] text-slate-500 leading-snug">{x.line}</p>
              </div>
            ))}
          </div>
        )}
        {blocked && <p className="text-[11.5px] font-bold text-amber-800 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2">{blocked}</p>}
        {open && <RunningCall s={s} open={open} older={!s.running} />}
        {r.state !== "off" && (
          <p className="text-[11px] text-slate-500">
            {`Today: ${plural(s.guard.callsToday, "call")} · ${plural(s.guard.stopsToday, "stop")} · one call at a time; no more after 2 stops, 3 calls or −₹3,000 a lot.`}
          </p>
        )}
        {s.liveDataUnavailable && (
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
            <Clock3 size={13} /> Option prices unavailable right now — no entry, stop or target is made up while this is down.
          </p>
        )}
      </div>
    </section>
  );
}
