// One market on the Ai20-20 page: what v2 says right now (with its four
// checks), the running call with its plan in Rs per lot, and today's guard.

import { useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, CheckCircle2, XCircle, Copy, Clock3, ShieldCheck } from "lucide-react";
import { useCreateTrade } from "../../api/hooks";
import { useTradeVerdict } from "../../hooks/useTradeVerdict";
import type { TwentyV2State } from "../../hooks/useTwentyV2";
import { effectiveStopFor, liveLtpFor, type TradeLogEntry } from "../../utils/tradeLogCore";
import { LAB_LOT, type LabSym } from "../../utils/twentyLab";
import { V2_MAX_STOPS_PER_DAY } from "../../utils/twentyV2";
import { premiumToFutures } from "../../utils/chartMarks";
import { formatTipCard } from "../../utils/tipFormat";
import { reviewCall } from "../../utils/callReviewEngine";
import { PriceScale, ProfitEstimate, fmtWhen, formatExpiryTip } from "../CallCardKit";
import { BuyNowBanner } from "../BuyNowBanner";
import { buyNowAdvice, minutesToMcxClose } from "../../utils/buyNow";
import { CallReviewCard } from "../CallReviewCard";
import { ProfitMilestones } from "../ProfitMilestones";
import { AiChart, type ChartPlan } from "../trust/AiChart";
import type { Candle, OptionsAnalytics } from "../../types";

const rsLot = (pts: number, lot: number) => `${pts >= 0 ? "+" : "−"}₹${Math.abs(Math.round(pts * lot)).toLocaleString("en-IN")}`;

/** This call's premium levels as approximate futures levels, for the AI chart. */
function chartPlan(t: TradeLogEntry, options: OptionsAnalytics | undefined, candles: Candle[]): ChartPlan | null {
  const row = options && !options.error ? options.rows.find((r) => r.strike === t.strike) : undefined;
  const leg = row ? (t.optSide === "CE" ? row.call : row.put) : undefined;
  const delta = typeof leg?.delta === "number" && Math.abs(leg.delta) >= 0.05 ? leg.delta : t.optSide === "CE" ? 0.5 : -0.5;
  const before = candles.filter((c) => Date.parse(c.date) <= t.openedAt);
  const fut = before.length ? before[before.length - 1].close : null;
  const lv = premiumToFutures(t, delta, fut);
  return lv ? { side: t.optSide, entry: lv.entry, stop: lv.stop, t1: lv.t1, t2: lv.t2, zone: null, label: t.closed ? "Plan at entry (approx.)" : "Ai20-20 plan (approx. futures)" } : null;
}

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

function RunningCall({ sym, s, open, legacy, expiry }: { sym: LabSym; s: TwentyV2State; open: TradeLogEntry; legacy: boolean; expiry: string | undefined }) {
  const lot = LAB_LOT[sym];
  const ltp = liveLtpFor(s.options, open.strike, open.optSide);
  const stop = effectiveStopFor(open);
  const [chart, setChart] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const createTrade = useCreateTrade();
  const name = sym === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
  const tip = formatTipCard({ symbolLabel: name, strike: open.strike, optSide: open.optSide, expiryLabel: formatExpiryTip(expiry), buyZoneLow: open.entry, buyZoneHigh: Number((open.entry * 1.02).toFixed(2)), targets: open.targets, stopLoss: stop });
  return (
    <div className="space-y-2.5">
      <div className="rounded-2xl p-3" style={{ background: open.optSide === "CE" ? "#ECFDF5" : "#FFF1F2" }}>
        <p className="text-[15px] font-black text-slate-800">
          BUY {open.strike} {open.optSide} @ ₹{open.entry}
        </p>
        <p className="text-[10.5px] text-slate-500">
          {formatExpiryTip(expiry)} expiry · called {fmtWhen(open.openedAt)} · 1 lot = {lot}
          {legacy ? " · made by the OLD rules" : ""}
        </p>
      </div>
      <BuyNowBanner
        advice={buyNowAdvice({ entry: open.entry, stop: open.stop, targets: open.targets, targetsHit: open.targetsHit, closed: open.closed, live: ltp, lot, minutesToClose: minutesToMcxClose() })}
      />
      <div className="grid grid-cols-3 gap-2">
        <Level label={open.targetsHit[0] ? "Stop (moved)" : "Stop"} value={`₹${stop}`} sub={rsLot(stop - open.entry, lot)} color="#E11D48" />
        <Level label="Target 1" value={`₹${open.targets[0]}`} sub={rsLot(open.targets[0] - open.entry, lot)} color="#059669" />
        <Level label="Target 2" value={`₹${open.targets[1]}`} sub={rsLot(open.targets[1] - open.entry, lot)} color="#059669" />
        <Level label="Target 3" value={`₹${open.targets[2]}`} sub={rsLot(open.targets[2] - open.entry, lot)} color="#059669" />
        <Level label="Live premium" value={ltp !== null ? `₹${ltp}` : "—"} color="#4F46E5" />
        <Level label="P&L now" value={ltp !== null ? rsLot(ltp - open.entry, lot) : "—"} sub="per lot" color={ltp !== null && ltp >= open.entry ? "#059669" : "#E11D48"} />
      </div>
      <p className="text-[11px] text-slate-600 leading-snug">
        {open.targetsHit[1]
          ? `T2 reached — the stop is now at T1 (₹${open.targets[0]}), so this call locks a profit.`
          : open.targetsHit[0]
            ? `T1 reached — the stop is now at your entry (₹${open.entry}): no loss from here.`
            : `Exit at ₹${stop} if it falls there. After T1 the stop moves up to your entry. Still open at the day's close? It closes there.`}
      </p>
      <PriceScale entry={open} current={ltp} />
      <ProfitEstimate trade={open} current={ltp} lotSize={lot} />
      <CallReviewCard
        review={reviewCall({
          optSide: open.optSide,
          direction: open.optSide === "CE" ? "bullish" : "bearish",
          entry: open.entry,
          stop,
          targets: open.targets,
          targetsHit: open.targetsHit,
          current: ltp,
          peak: open.highWaterMark,
          openedAt: open.openedAt,
          lotSize: lot,
          goalRs: Math.round((open.targets[0] - open.entry) * lot),
          thetaPerDay: null,
          candles: s.candles,
          medianWinnerMinutes: null,
        })}
      />
      <ProfitMilestones entry={open} current={ltp} lotSize={lot} />
      <div className="flex gap-2">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(tip);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 border border-slate-200 text-slate-700"
        >
          <Copy size={13} /> {copied ? "Copied ✓" : "Copy"}
        </button>
        <button
          disabled={logged}
          onClick={() =>
            createTrade.mutate(
              { symbol: sym, optSide: open.optSide, strike: open.strike, entryPrice: open.entry, stopLoss: open.stop, target: open.targets[0], quantity: 1, lotSize: lot, source: "master-ai", notes: "Logged from Ai20-20 v2" },
              { onSuccess: () => setLogged(true) }
            )
          }
          className="flex-1 px-3 py-2 rounded-xl text-xs font-black text-white disabled:opacity-60"
          style={{ background: open.optSide === "CE" ? "#059669" : "#E11D48" }}
        >
          {logged ? "Logged in portfolio ✓" : "I took it — log in portfolio"}
        </button>
      </div>
      <button onClick={() => setChart((v) => !v)} className="w-full py-2.5 rounded-xl text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#7C3AED,#DB2777)" }}>
        📈 {chart ? "Hide AI chart" : "AI chart — zones and this call's levels"}
      </button>
      {chart && <AiChart symbol={sym} plan={chartPlan(open, s.options, s.candles)} levels={null} />}
    </div>
  );
}

export function TwentyCallCard({ sym, s, expiry }: { sym: LabSym; s: TwentyV2State; expiry: string | undefined }) {
  const name = sym === "CRUDEOIL" ? "🛢️ Crude Oil" : "🔥 Natural Gas";
  const v2Open = [...s.log].reverse().find((e) => !e.closed) ?? null;
  const oldOpen = [...s.legacy].reverse().find((e) => !e.closed) ?? null;
  const open = v2Open ?? oldOpen;
  const r = s.read;
  const master = useTradeVerdict(sym).verdict;
  const side = open?.optSide ?? r.side;
  const pill = open ? "CALL RUNNING" : r.state === "call" ? "NEW CALL" : r.state === "watch" ? "WATCHING" : r.state === "window_closed" ? "WAITING FOR WINDOW" : r.state === "off" ? "CALLS OFF" : "LOADING";
  const hot = !!open || r.state === "call";
  const accent = hot ? (side === "CE" ? "#059669" : "#E11D48") : r.state === "off" ? "#64748B" : "#0EA5E9";
  const Dir = side === "PE" ? TrendingDown : TrendingUp;

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-center gap-3" style={{ background: hot ? (side === "CE" ? "linear-gradient(135deg,#ECFDF5,#FFFFFF)" : "linear-gradient(135deg,#FFF1F2,#FFFFFF)") : "linear-gradient(135deg,#F0F9FF,#FFFFFF)" }}>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-black text-slate-800">{name}</p>
          <p className="text-[11px] text-slate-500 leading-snug">{open ? `${open.optSide} call running — manage it below.` : r.headline}</p>
        </div>
        <span className="shrink-0 flex items-center gap-1 text-[10.5px] font-black px-2.5 py-1 rounded-full text-white" style={{ background: accent }}>
          {hot && <Dir size={12} />}
          {pill}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {r.state === "off" && (
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <p className="text-[12px] font-black text-slate-700">No Ai20-20 calls on gas</p>
            <p className="text-[11px] text-slate-600 leading-snug">5-minute calls lost money on gas in every rule set tested (50 days of NYMEX gas + 15 days of MCX). Gas moves cleaner on the 1-hour chart.</p>
            <Link to="/ai-today" className="inline-block mt-1 text-[11.5px] font-black text-white px-3 py-1.5 rounded-xl" style={{ background: "linear-gradient(135deg,#F97316,#DB2777)" }}>
              🎯 Open Ai-Today — gas 1-hour plan
            </Link>
          </div>
        )}

        {r.state !== "off" && r.checks.length > 0 && !open && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-slate-400">The 4 checks (finished 5-min candle)</p>
            {r.checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" /> : <XCircle size={15} className="text-slate-300 shrink-0 mt-0.5" />}
                <p className="text-[11.5px] leading-snug">
                  <span className={`font-black ${c.ok ? "text-slate-800" : "text-slate-500"}`}>{c.label}</span> <span className="text-slate-500">— {c.detail}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        {r.state === "call" && !open && <p className="text-[11.5px] font-bold text-amber-700">Every check passed, but there is no live option premium to price the call — nothing to enter.</p>}

        {open && <RunningCall sym={sym} s={s} open={open} legacy={!v2Open} expiry={expiry} />}

        {(open || r.state === "call") && (
          <p className="text-[11px] text-slate-600 rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2">
            <span className="font-black">Trade Card says:</span> {master.headline}
            {master.action === `TRADE_${side}` ? " — agrees ✅" : ""}
            <span className="block text-[10px] text-slate-400">For information. The v2 record above is for Ai20-20's own rules.</span>
          </p>
        )}

        {r.state !== "off" && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck size={13} className="text-sky-500 shrink-0" />
            Today: {s.guard.callsToday} call{s.guard.callsToday === 1 ? "" : "s"} · {s.guard.stopsToday} stop-loss{s.guard.stopsToday === 1 ? "" : "es"} (calls stop after {V2_MAX_STOPS_PER_DAY}). One call at a time.
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
