// The full pre-trade checklist on Ai-Trust, ticked live, ending in ONE
// verdict: TRADE (with direction, entry, stop, T1, T2 and lots sized from
// capital) or NO TRADE (with exactly which items failed).
// Market items come from utils/checklist (the same rules the server uses for
// the 💎 grade); personal items -- lots, trades today, daily loss, overnight
// gap -- use this phone's own settings.

import { useMemo, useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { useCandles, useOvernightTracker } from "../../api/hooks";
import { useAppStore } from "../../store/appStore";
import { marketChecklist, type CheckItem, type CheckSection, type ItemState, type MarketChecklist } from "../../utils/checklist";
import type { TradeVerdict } from "../../utils/tradeVerdict";
import type { TrustGrade } from "../../utils/trustGrade";
import type { OptionPick } from "../../hooks/useBuyDecision";
import type { NewsPulse } from "../../utils/newsPulse";
import { quickTier, trustTier, SUPPORT_NEEDED, type QuickTier, type TrustTier } from "../../utils/tradeTiers";
import { LOT_SIZE } from "../../utils/aiTwentyTwentyEngine";

type Sym = "CRUDEOIL" | "NATURALGAS";
const rs = (n: number) => `₹${n.toFixed(2)}`;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const MAX_TRADES = 3;

export interface FinalCall {
  tier: "trust" | "quick" | "none";
  trade: boolean; // 💎 trust call
  quickOk: boolean; // ⚡ quick trade
  trustTier: TrustTier | null;
  quick: QuickTier | null;
  failed: string[]; // why not 💎
  sections: CheckSection[];
  mc: MarketChecklist | null;
  lots: number | null;
  riskRs: number | null;
  premStop: number | null;
  premT1: number | null;
  quickLots: number | null;
  quickRiskRs: number | null;
  quickStrike: string;
}

/** Everything the verdict needs, for one market. */
export function useChecklist(
  symbol: Sym,
  v: TradeVerdict,
  g: TrustGrade,
  pick: OptionPick | null,
  livePrice: number | null,
  news: NewsPulse | null,
  minutesToClose: number | null,
): FinalCall {
  const c5 = useCandles(symbol, "5");
  const c15 = useCandles(symbol, "15");
  const c60 = useCandles(symbol, "60");
  const overnight = useOvernightTracker();
  const risk = useAppStore((s) => s.risk);
  const guardDay = useAppStore((s) => s.guardDay);
  const tradesToday = useAppStore((s) => s.tradesToday);
  const minute = Math.floor(Date.now() / 60_000);
  const candles = (q: typeof c15) => (q.data && "candles" in q.data ? q.data.candles : null);

  const mc = useMemo(() => {
    const a = candles(c15);
    const b = candles(c60);
    return a && b ? marketChecklist({ symbol, v, c15: a, c60: b, now: Date.now() }) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c15.data, c60.data, v, symbol, minute]);
  const trustT = useMemo(() => (mc ? trustTier(v, mc, g, minutesToClose) : null), [mc, v, g, minutesToClose]);
  const quick = useMemo(() => {
    const a = candles(c5);
    const b = candles(c15);
    return mc && a && b ? quickTier({ symbol, c5: a, c15: b, v, mc, news, now: Date.now(), minutesToClose }) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c5.data, c15.data, mc, v, news, symbol, minutesToClose, minute]);

  const today = istToday();
  const plan = mc?.plan ?? null;
  const lot = LOT_SIZE[symbol];
  const maxRisk = (risk.capital * risk.riskPercent) / 100;
  const optFor = (side: "CE" | "PE" | null | undefined) => (pick && side && pick.side === side ? pick : null);
  const opt = optFor(v.side);
  const riskPerLot = plan ? Math.abs(plan.entry - plan.stop) * Math.abs(opt?.delta ?? 0.5) * lot : null;
  const lots = riskPerLot && riskPerLot > 0 ? Math.floor(maxRisk / riskPerLot) : null;
  const prem = (level: number) => (opt?.ltp != null && opt.delta != null && livePrice !== null ? Math.max(0.05, opt.ltp + opt.delta * (level - livePrice)) : null);
  // Quick trades: HALF the normal risk.
  const qp = quick?.plan ?? null;
  const qOpt = optFor(qp?.side);
  const quickRiskRs = qp ? Math.abs(qp.entry - qp.stop) * Math.abs(qOpt?.delta ?? 0.5) * lot : null;
  const quickLots = quickRiskRs && quickRiskRs > 0 ? Math.floor(maxRisk / 2 / quickRiskRs) : null;

  const trades = tradesToday.date === today ? tradesToday.count : 0;
  const realised = guardDay.date === today ? guardDay.realised : 0;
  const lossLimit = (risk.capital * risk.dailyLossPercent) / 100;
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const morning = ist.getUTCHours() < 10;
  const move = overnight.data?.moves.find((m) => m.tracksMCX === symbol);
  const inr = overnight.data?.moves.find((m) => /INR/i.test(m.symbol) || /rupee|INR/i.test(m.name));
  const gapAgainst = move?.changePct != null && v.side && Math.abs(move.changePct) >= 1.5 && (v.side === "CE" ? move.changePct < 0 : move.changePct > 0);

  const personal: CheckSection = {
    title: "Your risk rules",
    items: [
      {
        id: "lots",
        label: `Risk per trade ≤ ${risk.riskPercent}% (₹${Math.round(maxRisk)})`,
        state: lots === null ? "na" : lots >= 1 ? "pass" : "fail",
        text: lots === null ? "—" : lots >= 1 ? `💎 ${lots} lot${lots > 1 ? "s" : ""} — risk ≈ ₹${Math.round(riskPerLot!)} per lot` : `1 lot risks ≈ ₹${Math.round(riskPerLot!)} — over your limit`,
      },
      { id: "count", label: `Max ${MAX_TRADES} trades a day`, state: trades >= MAX_TRADES ? "fail" : "pass", text: `${trades} taken today${trades >= MAX_TRADES ? " — done for today" : ""}` },
      {
        id: "loss",
        label: `Daily loss limit ${risk.dailyLossPercent}% (₹${Math.round(lossLimit)})`,
        state: realised <= -lossLimit ? "fail" : "pass",
        text: realised <= -lossLimit ? `Lost ₹${Math.abs(Math.round(realised))} today — close the terminal` : `Today ${realised >= 0 ? "+" : "−"}₹${Math.abs(Math.round(realised))} (from Capital Guard)`,
      },
      {
        id: "gap",
        label: "MCX open vs overnight NYMEX + INR",
        state: !move || move.changePct == null ? "na" : morning && gapAgainst ? "warn" : "info",
        text: !move || move.changePct == null ? "No overnight reading" : `NYMEX ${move.changePct > 0 ? "+" : ""}${move.changePct.toFixed(2)}% since MCX closed${inr?.changePct != null ? ` · INR ${inr.changePct > 0 ? "+" : ""}${inr.changePct.toFixed(2)}%` : ""}${morning && gapAgainst ? " — against this side, careful at the open" : ""}`,
      },
    ],
  };
  const dayLocked = trades >= MAX_TRADES || realised <= -lossLimit;
  const trade = !!trustT?.ok && !dayLocked && (lots ?? 0) >= 1;
  const quickOk = !trade && !!quick?.ok && !dayLocked && (quickLots ?? 0) >= 1;

  const detail = (mc?.sections ?? []).filter((x) => x.title === "Key levels" || x.title.endsWith("rules"));
  const sections: CheckSection[] = [
    ...(trustT
      ? [
          { title: "💎 Core — must all pass", items: trustT.core },
          { title: `💎 Supporting — ${trustT.supportPct ?? 0}% pass (needs ${SUPPORT_NEEDED * 100}%)`, items: trustT.support },
        ]
      : []),
    ...(quick ? [{ title: `⚡ Quick trade (5–15 min)${quick.side ? ` · ${quick.side}` : ""}`, items: quick.items }] : []),
    personal,
    ...detail,
  ];
  const failed = [...(trustT?.failed ?? []), ...personal.items.filter((i) => i.state === "fail").map((i) => i.label)];
  return {
    tier: trade ? "trust" : quickOk ? "quick" : "none",
    trade,
    quickOk,
    trustTier: trustT,
    quick,
    failed,
    sections,
    mc,
    lots,
    riskRs: riskPerLot,
    premStop: plan ? prem(plan.stop) : null,
    premT1: plan ? prem(plan.t1) : null,
    quickLots,
    quickRiskRs,
    quickStrike: qOpt ? `${qOpt.strike} ${qOpt.side}${qOpt.ltp != null ? ` @ ~₹${qOpt.ltp.toFixed(2)}` : ""}` : `ATM ${qp?.side ?? ""}`,
  };
}

const DOT: Record<ItemState, { c: string; t: string }> = {
  pass: { c: "bg-white text-emerald-600", t: "✓" },
  fail: { c: "bg-rose-500 text-white", t: "✗" },
  warn: { c: "bg-amber-300 text-amber-900", t: "!" },
  info: { c: "bg-sky-200 text-sky-900", t: "i" },
  na: { c: "bg-white/25 text-white", t: "–" },
};

function Item({ i }: { i: CheckItem }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 text-[11px] leading-snug">
      <span className={`mt-[1px] shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black ${DOT[i.state].c}`}>{DOT[i.state].t}</span>
      <span className="text-white/95">
        <b>{i.label}</b> <span className="text-white/75">· {i.text}</span>
      </span>
    </div>
  );
}

export function TradeCounter() {
  const today = istToday();
  const tradesToday = useAppStore((s) => s.tradesToday);
  const bump = useAppStore((s) => s.bumpTradesToday);
  const n = tradesToday.date === today ? tradesToday.count : 0;
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow border border-violet-100">
      <p className="flex-1 text-[12px] font-black text-slate-800">
        Trades I took today: <span className={n >= MAX_TRADES ? "text-rose-600" : "text-violet-700"}>{n} / {MAX_TRADES}</span>
      </p>
      <button aria-label="One less" onClick={() => bump(today, -1)} className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center">
        <Minus size={14} />
      </button>
      <button aria-label="I took a trade" onClick={() => bump(today, 1)} className="h-8 px-2.5 rounded-xl text-white text-[11px] font-black flex items-center gap-1" style={{ background: "linear-gradient(135deg,#7C3AED,#DB2777)" }}>
        <Plus size={13} /> Took one
      </button>
    </div>
  );
}

export function ChecklistPanel({ call }: { call: FinalCall }) {
  const [open, setOpen] = useState(false);
  const all = call.sections.flatMap((s) => s.items);
  const ok = all.filter((i) => i.state === "pass").length;
  const bad = all.filter((i) => i.state === "fail").length;
  return (
    <div className="relative mt-3">
      {call.tier === "none" && call.failed.length > 0 && (
        <div className="rounded-xl bg-black/25 px-3 py-2">
          <p className="text-[11px] font-black text-white">No 💎 — missing:</p>
          <p className="text-[11px] text-white/85 leading-snug mt-0.5">{call.failed.slice(0, 8).join(" · ")}{call.failed.length > 8 ? ` · +${call.failed.length - 8} more` : ""}</p>
        </div>
      )}
      {call.mc?.ngFade && (
        <div className="rounded-xl bg-sky-400/25 px-3 py-2 mt-2">
          <p className="text-[11px] font-black text-white">NG fade setup ({call.mc.ngFade.side}) — mean reversion, half size</p>
          <p className="text-[11px] text-white/85 leading-snug">
            {call.mc.ngFade.text}. Target middle band {rs(call.mc.ngFade.target)}, stop {rs(call.mc.ngFade.stop)}.
          </p>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="w-full mt-2 rounded-xl bg-white/15 px-3 py-2 flex items-center text-[12px] font-black text-white">
        Full checklist · {ok} ✓ · {bad} ✗
        <ChevronDown size={15} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        call.sections.map((s) => (
          <div key={s.title} className="mt-2 rounded-xl bg-black/15 py-1">
            <p className="px-2 pt-1 text-[10px] font-black uppercase tracking-wider text-white/70">{s.title}</p>
            {s.items.map((i) => (
              <Item key={i.id} i={i} />
            ))}
          </div>
        ))}
    </div>
  );
}
