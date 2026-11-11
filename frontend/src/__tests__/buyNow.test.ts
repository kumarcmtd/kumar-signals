import { describe, expect, test } from "vitest";
import { buyNowAdvice, minutesToMcxClose } from "../utils/buyNow";

// The NG 310 CE 1h call from the trader's screenshot: called at 16.90,
// stop 14.43, T1 19.40 / T2 21.00 / T3 23.50, lot 1250.
const call = { entry: 16.9, stop: 14.43, targets: [19.4, 21.0, 23.5] as [number, number, number], targetsHit: [false, false, false] as [boolean, boolean, boolean], closed: false, lot: 1250, minutesToClose: 240 };
const at = (live: number | null, extra: Partial<Parameters<typeof buyNowAdvice>[0]> = {}) => buyNowAdvice({ ...call, live, ...extra });

describe("Can I buy now?", () => {
  test("the screenshot: T1 already touched (peak 19.40), now 18.75 -> don't chase", () => {
    const a = at(18.75, { targetsHit: [true, false, false] });
    expect(a.state).toBe("no_chase");
    expect(a.title).toContain("T1 already reached");
    expect(a.holding).toContain("Move your stop to your entry (₹16.90)");
  });

  test("74% of the way to T1 without touching it -> don't chase, with the price to wait for", () => {
    const a = at(18.75);
    expect(a.state).toBe("no_chase");
    expect(a.detail).toContain("74% of the move to T1 is done");
    expect(a.buyUpTo).toBeCloseTo(17.52, 1);
    expect(a.detail).toMatch(/\+₹81[23]\/lot left against −₹5,400\/lot risk/);
  });

  test("a quarter to half of the way -> wait for a dip to the buy-up-to price", () => {
    const a = at(17.9);
    expect(a.state).toBe("wait_dip");
    expect(a.title).toBe("WAIT — don't buy at ₹17.90");
    expect(a.detail).toMatch(/Buy only at ₹17\.5\d or lower/);
  });

  test("still close to the call price -> yes, with the most to pay", () => {
    const a = at(17.2);
    expect(a.state).toBe("enter");
    expect(a.title).toBe("YES — you can still buy at ₹17.20");
    expect(a.detail).toContain("Only 12% of the move to T1 is done");
    expect(a.detail).toMatch(/Don't pay more than ₹17\.5\d/);
  });

  test("below the call price but well above the stop -> a better price than the call", () => {
    const a = at(16.5);
    expect(a.state).toBe("enter");
    expect(a.title).toContain("good price");
  });

  test("more than halfway down to the stop -> wait, the call is not working yet", () => {
    expect(at(15.4).state).toBe("near_stop");
  });

  test("at the stop, closed, or no price -> never an entry", () => {
    expect(at(14.4).state).toBe("over");
    expect(at(18, { closed: true }).state).toBe("over");
    expect(at(null).state).toBe("no_price");
  });

  test("the signal faded (STRONG BUY -> WATCH BUY) -> wait for BUY again", () => {
    const a = at(17.0, { stillValid: false, signalNow: "WATCH BUY" });
    expect(a.state).toBe("weak");
    expect(a.detail).toContain("now reads WATCH BUY");
  });

  test("too close to the MCX close, or a quick trade about to time out -> too late", () => {
    expect(at(17.0, { minutesToClose: 30 }).state).toBe("too_late");
    expect(at(17.0, { exitByMinutes: 5 }).state).toBe("too_late");
    expect(at(17.0, { exitByMinutes: 25 }).state).toBe("enter");
  });

  test("after T2 the holder's stop is T1: profit locked", () => {
    expect(at(21.5, { targetsHit: [true, true, false] }).holding).toContain("profit locked");
  });

  test("minutes to close: counted while MCX is open, null when shut", () => {
    expect(minutesToMcxClose(Date.parse("2026-11-11T17:00:00Z"))).toBe(85); // 22:30 IST; MCX closes 23:55 in US winter
    expect(minutesToMcxClose(Date.parse("2026-11-11T19:00:00Z"))).toBeNull(); // 00:30 IST: shut
  });
});
