import { afterEach, expect, test, vi } from "vitest";
import { matchedPushText, runTwentyTwentyNotificationCheck, twentyCallText } from "../../src/notify";

afterEach(() => vi.useRealTimers());

test("MATCHED push text carries the call, both engines' agreement and the plan", () => {
  const m = matchedPushText({ displayName: "Crude Oil", strike: 8850, optSide: "CE", entry: 263.2, t1: 283.2, stop: 251.2, lot: 100, strength: 72, since: "21:15", liveHeadline: "HOLDING — still bullish right now" });
  expect(m.title).toBe("MATCHED: Crude Oil 8850 CE");
  expect(m.body).toContain("BUY Crude Oil 8850 CE");
  expect(m.body).toContain("AI Verify Pro BUY CE agree (72/94, confirmed since 21:15)");
  expect(m.body).toContain("Right now: HOLDING");
  expect(m.body).toContain("Stop: Rs 251.2");
  expect(m.body).toContain("About Rs 2000 per lot at Target 1.");
  // No live line -> no double blank line.
  expect(matchedPushText({ displayName: "Natural Gas", strike: 305, optSide: "PE", entry: 14, t1: 15.6, stop: 13, lot: 1250, strength: 70, since: null, liveHeadline: null }).body).not.toContain("\n\n\n");
});

test("the live check explains itself when the market is closed", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T06:00:00Z")); // Saturday
  const env = { COMMODITY_KV: { get: async () => null, put: async () => undefined } } as any;
  const report = await runTwentyTwentyNotificationCheck(env);
  expect(report[0]).toContain("MCX is closed");
});

test("every new Ai20-20 call gets its own push text, marked as unconfirmed", () => {
  const m = twentyCallText({ displayName: "Crude Oil", strike: 9300, optSide: "CE", entry: 200, stop: 180, targets: [220, 240, 260], lot: 100 });
  expect(m.title).toBe("⚡ Ai20-20: Crude Oil 9300 CE");
  expect(m.body).toContain("@ Rs 200");
  expect(m.body).toContain("Stop: Rs 180 | T1 Rs 220 | T2 Rs 240 | T3 Rs 260");
  expect(m.body).toContain("risk about Rs 2000, T1 about +Rs 2000");
  expect(m.body).toContain("NOT confirmed by the Trade Card");
  expect(m.body.split("\n").length).toBeGreaterThan(3);
});
