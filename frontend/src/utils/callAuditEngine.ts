// Call Audit -- grades a CE/PE call the way an option BUYER experiences it.
//
// Every other scorer in this app grades the DIRECTION: is the trend real, do
// the timeframes agree, is momentum behind it. All necessary, none sufficient.
// A perfectly correct directional call still loses money if the premium is
// bleeding 4% a day to theta, if the strike's delta is so low the premium
// barely reacts to the move, or if nobody is quoting that strike and the fill
// is terrible. Those are the things that decide whether a right call pays.
//
// So this audits both halves: the SETUP (trend, strength, agreement, track
// record) and the CONTRACT (R:R on the premium, delta, theta burn, liquidity,
// IV, expiry runway).
//
// Two rules keep it honest:
//
//  1. Thresholds are either textbook-standard (Wilder's ADX bands, delta ~0.5
//     at the money) or measured RELATIVE TO THE LIVE CHAIN (this strike's OI
//     and IV against the chain's own median). Nothing invents an absolute
//     "good IV" or "good OI" number, which would differ per commodity and per
//     week and be a fabrication dressed as a standard.
//
//  2. A check with no data scores "unknown" and its weight is removed from the
//     denominator entirely, rather than silently counting as a failure. A
//     missing greek must not quietly downgrade a good call, and the card
//     reports how many checks it could not run.

import type { Direction } from "../types";

export type AuditStatus = "pass" | "warn" | "fail" | "unknown";
export type AuditGrade = "A+" | "A" | "B" | "C" | "D";

export interface AuditCheck {
  id: string;
  label: string;
  status: AuditStatus;
  /** Points earned out of `weight`. */
  earned: number;
  weight: number;
  detail: string;
}

export interface CallAudit {
  /** 0-100, normalised over only the checks that had data. */
  score: number;
  grade: AuditGrade;
  headline: string;
  verdict: string;
  checks: AuditCheck[];
  knownChecks: number;
  unknownChecks: number;
}

export interface AuditInput {
  optSide: "CE" | "PE";
  // --- Setup side ---
  trend: Direction;
  higherTfTrend: Direction | null;
  adx: number | null;
  tradeQualityPct: number | null;
  // --- Contract side ---
  premium: number;
  delta: number | null;
  thetaPerDay: number | null;
  iv: number | null;
  oi: number | null;
  volume: number | null;
  rr: number | null;
  daysToExpiry: number | null;
  /** Chain-wide medians, used so OI/IV are judged relatively, not absolutely. */
  medianOi: number | null;
  medianIv: number | null;
  /** This engine's own closed trades on this symbol+timeframe. */
  trackRecord: { closed: number; wins: number } | null;
}

/** Below this many closed trades the track record is not scored at all. */
export const MIN_TRACK_SAMPLE = 8;

const WEIGHTS = {
  trendAlign: 18,
  adx: 14,
  quality: 12,
  rr: 14,
  delta: 12,
  theta: 12,
  liquidity: 8,
  iv: 6,
  expiry: 4,
  track: 10,
} as const;

function check(id: string, label: string, weight: number, status: AuditStatus, earned: number, detail: string): AuditCheck {
  return { id, label, status, earned: status === "unknown" ? 0 : earned, weight, detail };
}

export function auditCall(input: AuditInput): CallAudit {
  const checks: AuditCheck[] = [];
  const wantedDir: Direction = input.optSide === "CE" ? "bullish" : "bearish";

  // --- Setup: do the timeframes actually agree with the side being bought? ---
  if (input.higherTfTrend === null) {
    checks.push(check("trendAlign", "Trend alignment", WEIGHTS.trendAlign, "unknown", 0, "Higher-timeframe trend unavailable."));
  } else if (input.trend === wantedDir && input.higherTfTrend === wantedDir) {
    checks.push(check("trendAlign", "Trend alignment", WEIGHTS.trendAlign, "pass", WEIGHTS.trendAlign, `Both this timeframe and the higher one are ${wantedDir} — the ${input.optSide} is with the trend.`));
  } else if (input.trend === wantedDir) {
    checks.push(check("trendAlign", "Trend alignment", WEIGHTS.trendAlign, "warn", WEIGHTS.trendAlign * 0.5, "This timeframe agrees but the higher one does not — a counter-trend trade on the bigger picture."));
  } else {
    checks.push(check("trendAlign", "Trend alignment", WEIGHTS.trendAlign, "fail", 0, `The trend is not ${wantedDir} — this ${input.optSide} is fighting the tape.`));
  }

  // --- Setup: is there a trend at all? Wilder's own ADX bands. ---
  if (input.adx === null) {
    checks.push(check("adx", "Trend strength (ADX)", WEIGHTS.adx, "unknown", 0, "ADX unavailable."));
  } else if (input.adx >= 40) {
    checks.push(check("adx", "Trend strength (ADX)", WEIGHTS.adx, "pass", WEIGHTS.adx, `ADX ${input.adx.toFixed(1)} — a genuinely strong trend, which is what a bought option needs.`));
  } else if (input.adx >= 25) {
    checks.push(check("adx", "Trend strength (ADX)", WEIGHTS.adx, "pass", WEIGHTS.adx * 0.75, `ADX ${input.adx.toFixed(1)} — trending, but not powerfully.`));
  } else if (input.adx >= 20) {
    checks.push(check("adx", "Trend strength (ADX)", WEIGHTS.adx, "warn", WEIGHTS.adx * 0.4, `ADX ${input.adx.toFixed(1)} — weak trend. Premium decays while price goes nowhere.`));
  } else {
    checks.push(check("adx", "Trend strength (ADX)", WEIGHTS.adx, "fail", 0, `ADX ${input.adx.toFixed(1)} — choppy, no trend. The worst regime for buying options.`));
  }

  // --- Setup: how many of the engine's own factors agree ---
  if (input.tradeQualityPct === null) {
    checks.push(check("quality", "Factor agreement", WEIGHTS.quality, "unknown", 0, "Confidence breakdown unavailable."));
  } else if (input.tradeQualityPct >= 75) {
    checks.push(check("quality", "Factor agreement", WEIGHTS.quality, "pass", WEIGHTS.quality, `${input.tradeQualityPct}% of the engine's factors point the same way.`));
  } else if (input.tradeQualityPct >= 55) {
    checks.push(check("quality", "Factor agreement", WEIGHTS.quality, "warn", WEIGHTS.quality * 0.5, `${input.tradeQualityPct}% factor agreement — a meaningful minority disagrees.`));
  } else {
    checks.push(check("quality", "Factor agreement", WEIGHTS.quality, "fail", 0, `Only ${input.tradeQualityPct}% factor agreement — the engine is close to split.`));
  }

  // --- Contract: reward against risk, measured on the PREMIUM, not the future ---
  if (input.rr === null) {
    checks.push(check("rr", "Reward : Risk", WEIGHTS.rr, "unknown", 0, "Premium R:R could not be computed."));
  } else if (input.rr >= 2) {
    checks.push(check("rr", "Reward : Risk", WEIGHTS.rr, "pass", WEIGHTS.rr, `1:${input.rr.toFixed(2)} on the premium — risking ₹1 to make ₹${input.rr.toFixed(2)}.`));
  } else if (input.rr >= 1.5) {
    checks.push(check("rr", "Reward : Risk", WEIGHTS.rr, "pass", WEIGHTS.rr * 0.7, `1:${input.rr.toFixed(2)} on the premium — acceptable, not generous.`));
  } else if (input.rr >= 1) {
    checks.push(check("rr", "Reward : Risk", WEIGHTS.rr, "warn", WEIGHTS.rr * 0.35, `1:${input.rr.toFixed(2)} — you need a high hit rate to profit at this ratio.`));
  } else {
    checks.push(check("rr", "Reward : Risk", WEIGHTS.rr, "fail", 0, `1:${input.rr.toFixed(2)} — risking more than the target pays. Poor structure.`));
  }

  // --- Contract: will the premium actually respond to the move? ---
  // Delta is ~0.5 at the money by definition, so this is a measure of how far
  // the chosen strike sits from the money, expressed as "how much of each
  // rupee of underlying move reaches your premium".
  if (input.delta === null) {
    checks.push(check("delta", "Delta (move capture)", WEIGHTS.delta, "unknown", 0, "Strike delta unavailable."));
  } else {
    const d = Math.abs(input.delta);
    const paise = Math.round(d * 100);
    if (d >= 0.45) {
      checks.push(check("delta", "Delta (move capture)", WEIGHTS.delta, "pass", WEIGHTS.delta, `Delta ${d.toFixed(2)} — about ${paise} paise of every ₹1 the underlying moves reaches your premium.`));
    } else if (d >= 0.35) {
      checks.push(check("delta", "Delta (move capture)", WEIGHTS.delta, "warn", WEIGHTS.delta * 0.55, `Delta ${d.toFixed(2)} — only ~${paise} paise per ₹1 move reaches you. Needs a bigger move to pay.`));
    } else {
      checks.push(check("delta", "Delta (move capture)", WEIGHTS.delta, "fail", 0, `Delta ${d.toFixed(2)} — far out of the money. The underlying can move your way and this premium barely follows.`));
    }
  }

  // --- Contract: the option buyer's real enemy ---
  if (input.thetaPerDay === null || !(input.premium > 0)) {
    checks.push(check("theta", "Theta burn", WEIGHTS.theta, "unknown", 0, "Theta unavailable."));
  } else {
    const burnPct = (Math.abs(input.thetaPerDay) / input.premium) * 100;
    if (burnPct < 1.5) {
      checks.push(check("theta", "Theta burn", WEIGHTS.theta, "pass", WEIGHTS.theta, `Loses about ${burnPct.toFixed(1)}% of the premium per day to time decay — a light headwind.`));
    } else if (burnPct < 3) {
      checks.push(check("theta", "Theta burn", WEIGHTS.theta, "warn", WEIGHTS.theta * 0.5, `Loses about ${burnPct.toFixed(1)}% per day to decay. Don't hold this one waiting.`));
    } else {
      checks.push(check("theta", "Theta burn", WEIGHTS.theta, "fail", 0, `Burns about ${burnPct.toFixed(1)}% of the premium every day. Time is actively against you here.`));
    }
  }

  // --- Contract: can you get in and out? Judged against this chain, not an
  // invented absolute, since OI scale differs per commodity and per week. ---
  if (input.oi === null || input.medianOi === null || input.medianOi <= 0) {
    checks.push(check("liquidity", "Liquidity", WEIGHTS.liquidity, "unknown", 0, "Open interest unavailable for this strike."));
  } else {
    const ratio = input.oi / input.medianOi;
    if (ratio >= 1) {
      checks.push(check("liquidity", "Liquidity", WEIGHTS.liquidity, "pass", WEIGHTS.liquidity, `Open interest is ${ratio.toFixed(1)}x the chain median — one of the better-traded strikes.`));
    } else if (ratio >= 0.5) {
      checks.push(check("liquidity", "Liquidity", WEIGHTS.liquidity, "warn", WEIGHTS.liquidity * 0.5, `Open interest is ${ratio.toFixed(1)}x the chain median — thinner than average, expect a wider spread.`));
    } else {
      checks.push(check("liquidity", "Liquidity", WEIGHTS.liquidity, "fail", 0, `Open interest is only ${ratio.toFixed(1)}x the chain median. Thin strike — fills may be poor.`));
    }
  }

  // --- Contract: are you buying expensive or cheap volatility? ---
  if (input.iv === null || input.medianIv === null || input.medianIv <= 0) {
    checks.push(check("iv", "Implied volatility", WEIGHTS.iv, "unknown", 0, "Implied volatility unavailable."));
  } else {
    const ratio = input.iv / input.medianIv;
    if (ratio <= 1.05) {
      checks.push(check("iv", "Implied volatility", WEIGHTS.iv, "pass", WEIGHTS.iv, `IV ${input.iv.toFixed(1)} is at or below the chain median — you are not overpaying for volatility.`));
    } else if (ratio <= 1.25) {
      checks.push(check("iv", "Implied volatility", WEIGHTS.iv, "warn", WEIGHTS.iv * 0.5, `IV ${input.iv.toFixed(1)} is ${Math.round((ratio - 1) * 100)}% above the chain median — slightly rich.`));
    } else {
      checks.push(check("iv", "Implied volatility", WEIGHTS.iv, "fail", 0, `IV ${input.iv.toFixed(1)} is ${Math.round((ratio - 1) * 100)}% above the chain median. Expensive premium; an IV drop alone can lose you money.`));
    }
  }

  // --- Contract: enough runway left before expiry ---
  if (input.daysToExpiry === null) {
    checks.push(check("expiry", "Expiry runway", WEIGHTS.expiry, "unknown", 0, "Expiry date unavailable."));
  } else if (input.daysToExpiry >= 7) {
    checks.push(check("expiry", "Expiry runway", WEIGHTS.expiry, "pass", WEIGHTS.expiry, `${input.daysToExpiry} days to expiry — room for the move to develop.`));
  } else if (input.daysToExpiry >= 3) {
    checks.push(check("expiry", "Expiry runway", WEIGHTS.expiry, "warn", WEIGHTS.expiry * 0.5, `${input.daysToExpiry} days to expiry — decay accelerates from here.`));
  } else {
    checks.push(check("expiry", "Expiry runway", WEIGHTS.expiry, "fail", 0, `Only ${input.daysToExpiry} day(s) to expiry. Very little time for the trade to work.`));
  }

  // --- Setup: has this engine actually been right on this timeframe? ---
  const tr = input.trackRecord;
  if (!tr || tr.closed < MIN_TRACK_SAMPLE) {
    const n = tr?.closed ?? 0;
    checks.push(check("track", "Engine track record", WEIGHTS.track, "unknown", 0, `Only ${n} closed trade${n === 1 ? "" : "s"} on this timeframe — too few to judge (needs ${MIN_TRACK_SAMPLE}).`));
  } else {
    const winPct = Math.round((tr.wins / tr.closed) * 100);
    if (winPct >= 60) {
      checks.push(check("track", "Engine track record", WEIGHTS.track, "pass", WEIGHTS.track, `${winPct}% of this engine's last ${tr.closed} closed trades here were winners.`));
    } else if (winPct >= 45) {
      checks.push(check("track", "Engine track record", WEIGHTS.track, "warn", WEIGHTS.track * 0.5, `${winPct}% win rate over ${tr.closed} closed trades on this timeframe — around a coin flip.`));
    } else {
      checks.push(check("track", "Engine track record", WEIGHTS.track, "fail", 0, `Only ${winPct}% of the last ${tr.closed} closed trades here won. This timeframe has not been working.`));
    }
  }

  // Unknown checks drop out of the denominator entirely so missing data never
  // reads as a failure.
  const scored = checks.filter((c) => c.status !== "unknown");
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  const earned = scored.reduce((s, c) => s + c.earned, 0);
  const raw = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  // Weighted averaging alone lets a flawless SETUP hold the score up no matter
  // how broken the CONTRACT is: the setup checks are 54 of the 110 points, so
  // a perfect trend read floors the score near 49 even when every single
  // option-side check has failed. For someone buying the premium that is
  // precisely backwards -- a deep-OTM, fast-decaying, illiquid strike is a
  // skip whatever the trend is doing. So a broken contract caps the grade
  // outright, and the verdict says that is what happened.
  const contractFails = checks.filter((c) => CONTRACT_CHECK_IDS.has(c.id) && c.status === "fail").length;
  const cap = contractFails >= 3 ? 40 : contractFails === 2 ? 57 : 100;
  const score = Math.min(raw, cap);
  const capped = score < raw;

  const grade = gradeFor(score);
  return {
    score,
    grade,
    headline: HEADLINE[grade],
    verdict: capped
      ? `${contractFails} of the option-side checks failed — the contract itself is the problem, whatever the trend is doing.`
      : verdictFor(grade, checks, totalWeight > 0),
    checks,
    knownChecks: scored.length,
    unknownChecks: checks.length - scored.length,
  };
}

/** The checks that describe the CONTRACT rather than the setup. */
const CONTRACT_CHECK_IDS = new Set(["rr", "delta", "theta", "liquidity", "iv", "expiry"]);

export function gradeFor(score: number): AuditGrade {
  if (score >= 85) return "A+";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  if (score >= 45) return "C";
  return "D";
}

const HEADLINE: Record<AuditGrade, string> = {
  "A+": "Excellent call",
  A: "Good call",
  B: "Playable, with caveats",
  C: "Weak call",
  D: "Skip this one",
};

function verdictFor(grade: AuditGrade, checks: AuditCheck[], hadData: boolean): string {
  if (!hadData) return "Not enough data to audit this call yet.";
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length > 0) {
    const names = failed.map((f) => f.label.toLowerCase()).join(", ");
    return grade === "D" || grade === "C"
      ? `Held back by ${names}. Fix or skip.`
      : `Strong overall, but ${names} ${failed.length === 1 ? "is" : "are"} working against it.`;
  }
  const warned = checks.filter((c) => c.status === "warn");
  if (warned.length > 0) return `Nothing broken, but watch ${warned.map((w) => w.label.toLowerCase()).join(", ")}.`;
  return "Every check this call could be measured on passed.";
}

/** Median of the finite, positive values only -- used for the chain baselines. */
export function medianOf(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// ---- Adapter from this app's live shapes to an AuditInput ----
// Shared deliberately: the grade frozen when a call is given and the grade
// recomputed live must come from the same code, or the "rated A when given,
// now B" comparison would be measuring two different rulers against each other.

/** Whole days from now until an ISO/`YYYY-MM-DD` expiry, or null if unparseable. */
export function daysUntilExpiry(expiry: string | undefined, now: number = Date.now()): number | null {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

interface ChainLike {
  expiry?: string;
  rows: { strike: number; call: { iv?: number | null; oi?: number | null; volume?: number | null }; put: { iv?: number | null; oi?: number | null; volume?: number | null } }[];
}

export function buildAuditInput(args: {
  optSide: "CE" | "PE";
  trend: Direction;
  higherTfTrend: Direction | null;
  adx: number | null;
  tradeQualityPct: number | null;
  strike: number;
  premium: number;
  delta: number | null;
  thetaPerDay: number | null;
  rr: number | null;
  options: ChainLike | undefined;
  trackRecord: { closed: number; wins: number } | null;
  now?: number;
}): AuditInput {
  const { optSide, options } = args;
  const pick = <T,>(leg: { iv?: number | null; oi?: number | null; volume?: number | null }, key: "iv" | "oi" | "volume"): T | null => (leg[key] ?? null) as T | null;
  const row = options?.rows.find((r) => r.strike === args.strike);
  const leg = row ? (optSide === "CE" ? row.call : row.put) : null;
  const sameSideLegs = options?.rows.map((r) => (optSide === "CE" ? r.call : r.put)) ?? [];

  return {
    optSide,
    trend: args.trend,
    higherTfTrend: args.higherTfTrend,
    adx: args.adx,
    tradeQualityPct: args.tradeQualityPct,
    premium: args.premium,
    delta: args.delta,
    thetaPerDay: args.thetaPerDay,
    iv: leg ? pick<number>(leg, "iv") : null,
    oi: leg ? pick<number>(leg, "oi") : null,
    volume: leg ? pick<number>(leg, "volume") : null,
    rr: args.rr,
    daysToExpiry: daysUntilExpiry(options?.expiry, args.now),
    // Medians are taken across the SAME side of the chain only -- calls and
    // puts carry systematically different OI and IV, so pooling them would
    // compare a call against a baseline half made of puts.
    medianOi: medianOf(sameSideLegs.map((l) => l.oi)),
    medianIv: medianOf(sameSideLegs.map((l) => l.iv)),
    trackRecord: args.trackRecord,
  };
}

// ---- Adapter for the standard TradeLogEntry call pages ----
// Best Call, AI-Shoot, Ai20-20, Level Cross and AI-Up all describe a call the
// same way -- a strike, a side, and premium entry/stop/targets -- so one
// adapter audits all of them. SuperTrend needs its own path only because it
// derives its option leg from a futures setup.
//
// The setup-side inputs are recomputed here from the page's own candles rather
// than taken from whatever that page happens to believe: the trend read must be
// INDEPENDENT of the call being audited, or "is this call with the trend?"
// would just be asking the call to confirm itself.

export interface TradeLogCallLike {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  stop: number;
  targets: number[];
  targetsHit: boolean[];
  openedAt: number;
}

export function auditTradeLogCall(args: {
  call: TradeLogCallLike;
  /** Independent trend read for this page's timeframe. */
  trend: Direction | null;
  /** Independent higher-timeframe trend, normally from daily candles. */
  higherTfTrend: Direction | null;
  adx: number | null;
  /** How much live evidence still backs the call (Check Call Strength's score). */
  strengthPct: number | null;
  options: ChainLike | undefined;
  /** Per-strike greeks, read from the same chain row the call points at. */
  delta: number | null;
  thetaPerDay: number | null;
  trackRecord: { closed: number; wins: number } | null;
  now?: number;
}): CallAudit {
  const { call } = args;

  // Reward to Target 2 over risk to the stop -- deliberately the same
  // convention projectPremiumFromUnderlying uses, so "R:R" means the same
  // thing on every card in the app. Target 1 and the stop are both built from
  // the same ATR step on most engines, which makes R:R to Target 1
  // structurally ~1:1 and therefore meaningless.
  const risk = call.entry - call.stop;
  const reward = (call.targets[1] ?? call.targets[0]) - call.entry;
  const rr = risk > 0 && reward > 0 ? Number((reward / risk).toFixed(2)) : risk > 0 ? 0 : null;

  return auditCall(
    buildAuditInput({
      optSide: call.optSide,
      // A null trend read is reported as unknown rather than assumed neutral,
      // which would otherwise fail the alignment check on missing data.
      trend: args.trend ?? (call.optSide === "CE" ? "bullish" : "bearish"),
      higherTfTrend: args.trend === null ? null : args.higherTfTrend,
      adx: args.adx,
      tradeQualityPct: args.strengthPct,
      strike: call.strike,
      premium: call.entry,
      delta: args.delta,
      thetaPerDay: args.thetaPerDay,
      rr,
      options: args.options,
      trackRecord: args.trackRecord,
      now: args.now,
    })
  );
}

/** Pulls the greeks for the exact strike+side a call points at. */
export function legGreeksFor(
  options: { rows: { strike: number; call: { delta?: number; theta?: number }; put: { delta?: number; theta?: number } }[] } | undefined,
  strike: number,
  optSide: "CE" | "PE"
): { delta: number | null; thetaPerDay: number | null } {
  const row = options?.rows.find((r) => r.strike === strike);
  if (!row) return { delta: null, thetaPerDay: null };
  const leg = optSide === "CE" ? row.call : row.put;
  return {
    delta: typeof leg.delta === "number" && Number.isFinite(leg.delta) ? Math.abs(leg.delta) : null,
    thetaPerDay: typeof leg.theta === "number" && Number.isFinite(leg.theta) ? leg.theta : null,
  };
}
