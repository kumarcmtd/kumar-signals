import { expect, test } from "vitest";
import { WINDOWS, usDst, ukDst, measureWindow, todaysGroup, cmeBreakIst, hhmm } from "../utils/sessionClock";
import type { Candle } from "../types";

const w = (id: string) => WINDOWS.find((x) => x.id === id)!;

test("windows follow US / UK clock changes", () => {
  expect(usDst("2026-10-21")).toBe(true);
  expect(usDst("2026-11-02")).toBe(false); // US clocks change 1 Nov 2026
  expect(ukDst("2026-10-21")).toBe(true);
  expect(ukDst("2026-10-26")).toBe(false); // UK changes 25 Oct 2026
  expect(hhmm(w("us_data").startFor("2026-10-21")!)).toBe("6:00 PM");
  expect(hhmm(w("us_data").startFor("2026-11-02")!)).toBe("7:00 PM");
  expect(hhmm(w("nymex_open").startFor("2026-10-21")!)).toBe("6:30 PM");
  expect(hhmm(w("europe_open").startFor("2026-10-21")!)).toBe("12:30 PM");
  expect(w("eia_crude").startFor("2026-10-21")).not.toBeNull(); // Wednesday
  expect(w("eia_crude").startFor("2026-10-22")).toBeNull();
  expect(cmeBreakIst("2026-10-21")).toEqual({ from: "02:30", to: "03:30" });
});

test("measures 'after a rally, the 6 PM window falls' when the data really does that", () => {
  // 60 weekdays of 30-min candles 9:00-23:30 IST. Every 3rd day rallies +2% by 6 PM, then falls in 6:00-6:30.
  const out: Candle[] = [];
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(2026, 6, 1 + d)).toISOString().slice(0, 10);
    let p = 100;
    const rally = d % 3 === 0;
    for (let k = 0; k < 29; k++) {
      const min = 9 * 60 + k * 30;
      const o = p;
      let c = p + (k % 2 ? 0.05 : -0.05) + (d % 3 === 1 ? -0.07 : 0);
      if (rally && min < 18 * 60) c = p + 2 / 18;
      if (min === 18 * 60) c = rally ? p - 0.8 : p + (d % 2 ? 0.2 : -0.2);
      const h = Math.floor(min / 60);
      out.push({ date: `${day}T${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+05:30`, open: o, high: Math.max(o, c) + 0.05, low: Math.min(o, c) - 0.05, close: c });
      p = c;
    }
  }
  const s = measureWindow(out, w("us_data"));
  expect(s.afterRally.days).toBe(20);
  expect(s.afterRally.downPct).toBe(100);
  expect(s.afterRally.bias).toBe("down");
  expect(s.afterRally.confidence).toBe("reliable");
  expect(todaysGroup(s, 2).key).toBe("afterRally");
  expect(todaysGroup(s, 0).key).toBe("all");
});
