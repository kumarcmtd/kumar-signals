import { test } from "node:test";
import assert from "node:assert/strict";
import { auditCall, gradeFor, medianOf, MIN_TRACK_SAMPLE, type AuditInput } from "../utils/callAuditEngine";

// A textbook-good bullish CE: trends agree, strong ADX, ATM delta, light
// theta, liquid strike, fair IV, plenty of runway, proven timeframe.
function goodCall(over: Partial<AuditInput> = {}): AuditInput {
  return {
    optSide: "CE",
    trend: "bullish",
    higherTfTrend: "bullish",
    adx: 42,
    tradeQualityPct: 81,
    premium: 534,
    delta: 0.52,
    thetaPerDay: -5,
    iv: 30,
    oi: 12_000,
    volume: 4_000,
    rr: 2.2,
    daysToExpiry: 14,
    medianOi: 10_000,
    medianIv: 31,
    trackRecord: { closed: 20, wins: 14 },
    ...over,
  };
}

const byId = (a: ReturnType<typeof auditCall>, id: string) => a.checks.find((c) => c.id === id)!;

test("a clean setup on a clean contract grades at the top", () => {
  const a = auditCall(goodCall());
  assert.equal(a.grade, "A+");
  assert.ok(a.score >= 85, `expected a high score, got ${a.score}`);
  assert.equal(a.unknownChecks, 0);
});

test("a right-direction call on a terrible contract is NOT graded well", () => {
  // The whole point of the audit: trend perfect, but the option itself is a
  // deep-OTM, fast-decaying, illiquid, expensive lottery ticket.
  const a = auditCall(goodCall({ delta: 0.12, thetaPerDay: -30, premium: 400, oi: 500, medianOi: 10_000, iv: 55, medianIv: 30, rr: 0.8, daysToExpiry: 2 }));
  assert.equal(byId(a, "trendAlign").status, "pass");
  assert.equal(byId(a, "delta").status, "fail");
  assert.equal(byId(a, "theta").status, "fail");
  assert.equal(byId(a, "liquidity").status, "fail");
  assert.equal(byId(a, "iv").status, "fail");
  assert.equal(byId(a, "rr").status, "fail");
  assert.ok(a.score < 45, `a bad contract must not pass on trend alone, got ${a.score}`);
  assert.equal(a.grade, "D");
});

test("buying a CE against a bearish trend fails the alignment check outright", () => {
  const a = auditCall(goodCall({ trend: "bearish", higherTfTrend: "bearish" }));
  const c = byId(a, "trendAlign");
  assert.equal(c.status, "fail");
  assert.equal(c.earned, 0);
  assert.match(c.detail, /fighting the tape/);
});

test("a PE is judged against the bearish trend, mirroring the CE case", () => {
  const bullishTape = { trend: "bearish" as const, higherTfTrend: "bearish" as const };
  assert.equal(byId(auditCall(goodCall({ optSide: "PE", ...bullishTape })), "trendAlign").status, "pass");
  assert.equal(byId(auditCall(goodCall({ optSide: "PE", trend: "bullish", higherTfTrend: "bullish" })), "trendAlign").status, "fail");
});

test("agreeing with the lower timeframe but not the higher one is only a half pass", () => {
  const c = byId(auditCall(goodCall({ trend: "bullish", higherTfTrend: "bearish" })), "trendAlign");
  assert.equal(c.status, "warn");
  assert.equal(c.earned, c.weight * 0.5);
  assert.match(c.detail, /counter-trend/);
});

test("a choppy tape fails ADX, since that is the worst regime for buying options", () => {
  assert.equal(byId(auditCall(goodCall({ adx: 14 })), "adx").status, "fail");
  assert.equal(byId(auditCall(goodCall({ adx: 22 })), "adx").status, "warn");
  assert.equal(byId(auditCall(goodCall({ adx: 30 })), "adx").status, "pass");
});

test("theta is judged as a share of the premium, not as a raw number", () => {
  // -5 on a 534 premium is under 1% a day; -5 on a 60 premium is over 8%.
  assert.equal(byId(auditCall(goodCall({ thetaPerDay: -5, premium: 534 })), "theta").status, "pass");
  const heavy = byId(auditCall(goodCall({ thetaPerDay: -5, premium: 60 })), "theta");
  assert.equal(heavy.status, "fail");
  assert.match(heavy.detail, /8\.3% of the premium every day/);
});

test("liquidity and IV are judged against the live chain, never an invented absolute", () => {
  // The same raw OI is good on a thin chain and poor on a heavy one.
  assert.equal(byId(auditCall(goodCall({ oi: 5_000, medianOi: 4_000 })), "liquidity").status, "pass");
  assert.equal(byId(auditCall(goodCall({ oi: 5_000, medianOi: 20_000 })), "liquidity").status, "fail");
  // Likewise IV: 45 is cheap against a median of 50, rich against a median of 25.
  assert.equal(byId(auditCall(goodCall({ iv: 45, medianIv: 50 })), "iv").status, "pass");
  assert.equal(byId(auditCall(goodCall({ iv: 45, medianIv: 25 })), "iv").status, "fail");
});

test("missing data scores unknown and is removed from the denominator, not failed", () => {
  const full = auditCall(goodCall());
  const partial = auditCall(goodCall({ iv: null, medianIv: null, oi: null, medianOi: null }));
  assert.equal(byId(partial, "iv").status, "unknown");
  assert.equal(byId(partial, "liquidity").status, "unknown");
  assert.equal(partial.unknownChecks, 2);
  // Those two checks were passing before; dropping them must not move the score.
  assert.equal(partial.score, full.score, "an unavailable greek must not penalise an otherwise identical call");
});

test("a thin track record is not scored at all rather than counted against the call", () => {
  const c = byId(auditCall(goodCall({ trackRecord: { closed: 3, wins: 0 } })), "track");
  assert.equal(c.status, "unknown");
  assert.equal(c.earned, 0);
  assert.match(c.detail, /too few to judge/);
});

test(`exactly ${MIN_TRACK_SAMPLE} closed trades is enough for the track record to count`, () => {
  const losing = byId(auditCall(goodCall({ trackRecord: { closed: MIN_TRACK_SAMPLE, wins: 2 } })), "track");
  assert.equal(losing.status, "fail");
  assert.match(losing.detail, /has not been working/);
});

test("a call with no data at all scores zero and says so instead of guessing", () => {
  const a = auditCall({
    optSide: "CE", trend: "bullish", higherTfTrend: null, adx: null, tradeQualityPct: null,
    premium: 0, delta: null, thetaPerDay: null, iv: null, oi: null, volume: null, rr: null,
    daysToExpiry: null, medianOi: null, medianIv: null, trackRecord: null,
  });
  assert.equal(a.score, 0);
  assert.equal(a.knownChecks, 0);
  assert.equal(a.verdict, "Not enough data to audit this call yet.");
});

test("a broken contract caps the grade no matter how good the trend read is", () => {
  // Two option-side failures cap at C; three or more cap at D. Without the cap
  // a flawless setup alone floors the score near 49, so the contract half
  // could never sink a call on its own.
  const twoFails = auditCall(goodCall({ delta: 0.1, thetaPerDay: -40, premium: 400 }));
  assert.equal(twoFails.grade, "C");
  assert.match(twoFails.verdict, /the contract itself is the problem/);

  const threeFails = auditCall(goodCall({ delta: 0.1, thetaPerDay: -40, premium: 400, rr: 0.5 }));
  assert.equal(threeFails.grade, "D");
});

test("a single option-side failure does not trigger the cap", () => {
  const one = auditCall(goodCall({ rr: 0.5 }));
  assert.ok(one.score > 57, `one failure should not be capped, got ${one.score}`);
  assert.doesNotMatch(one.verdict, /the contract itself is the problem/);
});

test("the verdict names what is actually holding the call back", () => {
  const a = auditCall(goodCall({ thetaPerDay: -40, premium: 400 }));
  assert.match(a.verdict, /theta burn/i);
});

test("grade boundaries", () => {
  assert.equal(gradeFor(85), "A+");
  assert.equal(gradeFor(72), "A");
  assert.equal(gradeFor(58), "B");
  assert.equal(gradeFor(45), "C");
  assert.equal(gradeFor(44), "D");
});

test("medianOf ignores nulls and non-positive values", () => {
  assert.equal(medianOf([10, 20, 30]), 20);
  assert.equal(medianOf([10, null, 20, 0, -5, undefined]), 15);
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([null, 0]), null);
});
