// Ai-Trust -- the Trade Card's best calls only.
//
// A TRADE on the Trade Card already needs all six checks. A TRUST call needs
// five more, each one aimed at a way the earlier calls were stopped out:
//   1 strong trend      AI Verify agreement >= 75 (not a bare 66 pass)
//   2 news WITH it      supporting, not just "not against" -- in war-time
//                       crude a neutral tape can flip on one headline
//   3 fresh money       OI shows long build-up (CE) / short build-up (PE),
//                       or no fresh positions against it on a zone bounce;
//                       "OI not reported" is not good enough here
//   4 big reward        at least 2x the risk to the target
//   5 safe timing       not in the last 45 min of the session, not on the
//                       option's expiry day (premium melts), no report due
// It cannot make stop-losses impossible -- nothing can. It trades much less,
// so each call has more evidence behind it.

import type { TradeVerdict } from "./tradeVerdict";

export interface TrustRule {
  key: "trend" | "news" | "oi" | "reward" | "timing";
  label: string;
  ok: boolean;
  text: string;
}

export interface TrustGrade {
  trusted: boolean; // a TRADE that passes every trust rule
  isTrade: boolean;
  rules: TrustRule[];
  score: number; // rules passed + checks passed, out of `outOf`
  outOf: number;
}

export interface TrustContext {
  minutesToClose: number | null;
  optionDaysToExpiry: number | null;
}

export const TRUST = { minStrength: 75, minRR: 2, lastMinutes: 45 } as const;

export function trustGrade(v: Pick<TradeVerdict, "action" | "side" | "checks" | "passed" | "rr" | "strength" | "newsSide" | "oiKind" | "bounce">, ctx: TrustContext): TrustGrade {
  const up = v.side === "CE";
  const isTrade = v.action === "TRADE_CE" || v.action === "TRADE_PE";
  const fresh = up ? "long-buildup" : "short-buildup";
  const bounceOk = up ? ["long-unwinding", "no-clear-signal"] : ["short-covering", "no-clear-signal"];
  const oiOk = !!v.side && !!v.oiKind && (v.oiKind === fresh || (v.bounce && bounceOk.includes(v.oiKind)));
  const lateDay = ctx.minutesToClose !== null && ctx.minutesToClose < TRUST.lastMinutes;
  const expiryDay = ctx.optionDaysToExpiry !== null && ctx.optionDaysToExpiry <= 0;

  const rules: TrustRule[] = [
    {
      key: "trend",
      label: "Strong trend",
      ok: (v.strength ?? 0) >= TRUST.minStrength && !!v.side,
      text: v.strength === null ? "No trend reading" : `${v.strength} agree (needs ${TRUST.minStrength}+)`,
    },
    {
      key: "news",
      label: "News with it",
      ok: v.newsSide === "with",
      text: v.newsSide === "with" ? "Headlines support this side" : v.newsSide === "none" ? "No news reading" : v.newsSide === "neutral" ? "News neutral — one headline can flip it" : "News against",
    },
    {
      key: "oi",
      label: "Fresh money (OI)",
      ok: oiOk,
      text: !v.oiKind || v.oiKind === "no-data" ? "OI not reported — can't confirm" : oiOk ? (v.oiKind === fresh ? `${up ? "Long" : "Short"} build-up — new ${up ? "buyers" : "sellers"}` : "Bounce, no fresh positions against") : "OI not backing this side",
    },
    {
      key: "reward",
      label: `${TRUST.minRR}× reward`,
      ok: v.rr !== null && v.rr >= TRUST.minRR,
      text: v.rr === null ? "No target yet" : `${v.rr}× the risk to target`,
    },
    {
      key: "timing",
      label: "Safe timing",
      ok: !lateDay && !expiryDay && v.action !== "AVOID",
      text: expiryDay ? "Option expiry day — premium melts fast" : lateDay ? `Only ${ctx.minutesToClose} min to the close` : "Time and expiry OK",
    },
  ];
  const rulesOk = rules.filter((r) => r.ok).length;
  const checks = v.checks.length || 6;
  return { trusted: isTrade && rules.every((r) => r.ok), isTrade, rules, score: v.passed + rulesOk, outOf: checks + rules.length };
}
