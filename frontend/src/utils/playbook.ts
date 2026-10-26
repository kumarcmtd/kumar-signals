// The trader's own plan, per market -- one TRADE / WAIT answer:
//
//   Crude Oil  news-driven, moves fast: trade ONLY when the 5m, 10m and 15m
//              calls all say the same side (each a Good / Strong Buy of CE,
//              or of PE). The 15m call's option plan is the one to take.
//   Nat. Gas   slow, weather / storage driven: trade ONLY the 1h call (a Good
//              / Strong Buy), when the 4h is not the other way, and the 1h
//              record on NG is not poor (needs 8+ results to judge).

import type { Decision6 } from "./timeframeEngine";
import type { TfRecord } from "./tfRecord";

export type PlanSym = "CRUDEOIL" | "NATURALGAS";

export const PLAN: Record<PlanSym, { tfs: string[]; lead: string; context: string[]; rule: string; why: string }> = {
  CRUDEOIL: {
    tfs: ["5", "10", "15"],
    lead: "15",
    context: ["60", "240"],
    rule: "5m · 10m · 15m all agree",
    why: "Crude moves on news in minutes — when the three short timeframes line up, the rally is on.",
  },
  NATURALGAS: {
    tfs: ["60"],
    lead: "60",
    context: ["240", "15", "10", "5"],
    rule: "1h call, 4h not against",
    why: "Gas trends over hours (weather, storage) — the 1-hour call is the one that pays; short timeframes are noise.",
  },
};

export interface TfRead {
  tf: string;
  optSide: "CE" | "PE" | null;
  decision: Decision6;
}

export interface PlanVerdict {
  trade: boolean;
  side: "CE" | "PE" | null;
  agree: number; // how many plan timeframes back the side
  of: number;
  headline: string;
  detail: string;
}

/** A timeframe's read counts only as a Good / Strong Buy of a side. */
export const actionable = (r: TfRead | undefined): "CE" | "PE" | null => (r && r.optSide && (r.decision === "STRONG BUY" || r.decision === "BUY") ? r.optSide : null);

const SHORT: Record<string, string> = { "5": "5m", "10": "10m", "15": "15m", "60": "1h", "240": "4h" };

export function planVerdict(sym: PlanSym, reads: TfRead[], leadRecord?: TfRecord | null): PlanVerdict {
  const p = PLAN[sym];
  const by = (tf: string) => reads.find((r) => r.tf === tf);
  const sides = p.tfs.map((tf) => actionable(by(tf)));
  const ce = sides.filter((s) => s === "CE").length;
  const pe = sides.filter((s) => s === "PE").length;
  const side: "CE" | "PE" | null = ce > pe ? "CE" : pe > ce ? "PE" : null;
  const agree = Math.max(ce, pe);
  const list = p.tfs.map((tf, i) => `${SHORT[tf]} ${sides[i] ?? "no call"}`).join(" · ");

  if (sym === "CRUDEOIL") {
    const all = agree === p.tfs.length && side !== null;
    return {
      trade: all,
      side: all ? side : side,
      agree,
      of: p.tfs.length,
      headline: all ? `TRADE ${side} — 5m · 10m · 15m all ${side}` : `WAIT — ${agree} of 3 agree`,
      detail: all ? `All three short timeframes say ${side}. Take the 15m call's option; book T1 fast on news spikes.` : `${list}. Wait until all three show the same side.`,
    };
  }
  const h1 = actionable(by("60"));
  const h4 = by("240")?.optSide ?? null;
  const h4Against = !!h1 && !!h4 && h4 !== h1;
  const poorRecord = !!leadRecord && leadRecord.closed >= 8 && leadRecord.winRate !== null && leadRecord.winRate < 35;
  const trade = !!h1 && !h4Against && !poorRecord;
  return {
    trade,
    side: h1,
    agree: h1 ? 1 : 0,
    of: 1,
    headline: trade ? `TRADE ${h1} — 1h call${h4 === h1 ? ", 4h agrees" : ""}` : !h1 ? "WAIT — no 1h call" : h4Against ? `WAIT — 1h ${h1} but 4h ${h4}` : `WAIT — 1h record poor (${leadRecord!.winRate}%)`,
    detail: trade
      ? `Take the 1h call's option. Gas moves slowly — give it hours, not minutes; exit at the stop or the targets.`
      : !h1
        ? `The 1h has no Good / Strong Buy on either side. Short-timeframe NG calls are noise — skip them.`
        : h4Against
          ? `The 4h trend points the other way — the 1h move is likely a pullback inside it.`
          : `The 1h call has lost too often on NG lately; wait for a cleaner setup.`,
  };
}
