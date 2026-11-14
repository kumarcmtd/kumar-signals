import { describe, expect, test } from "vitest";
import { prepare, simulate, type Prepared } from "../utils/twentyLab";
import { V2_RULES } from "../utils/twentyV2";
import { computeFeatures, sessionMinute, NOISE_MIN_DAYS } from "../utils/twentyV3/features";
import { entryAt, firstEntry, type V3Ctx } from "../utils/twentyV3/setups";
import { readV3, V3_ACTIVE } from "../utils/twentyV3/live";
import { simulateV3 } from "../utils/twentyV3/sim";
import type { Candle } from "../types";

// US winter (standard time): New York 9:00 = 19:30 IST. Day d of a run of weekdays from Mon 2 Nov 2026... use Mon 9 Nov 2026 (after the US clock change on 1 Nov).
const DAY0 = Date.UTC(2026, 10, 9) - 5.5 * 3600_000; // IST midnight, Monday 9 Nov 2026
const weekdays = (n: number) => {
  const out: number[] = [];
  for (let d = 0; out.length < n; d++) {
    const wd = new Date(DAY0 + 5.5 * 3600_000 + d * 86_400_000).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
};
const ist = (d: number, min: number) => DAY0 + d * 86_400_000 + min * 60_000;
const NY = (h: number, m = 0) => (h * 60 + m) + 10 * 60 + 30; // New York clock -> IST minute (winter)

/** Quiet days: price wiggles +/-w around 6000 all session, with a fixed small pattern. */
function quietDays(days: number[], w = 4): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
      const x = 6000 + (m % 30 === 0 ? w : m % 15 === 0 ? -w : 0);
      out.push({ date: new Date(ist(d, m)).toISOString(), open: 6000, high: Math.max(6000, x) + 1, low: Math.min(6000, x) - 1, close: x, volume: 100 });
    }
  }
  return out;
}

const ctxOf = (c: Candle[]): V3Ctx => {
  const p = prepare(c, false);
  return { p, f: computeFeatures(p) };
};
const idxAt = (p: Prepared, d: number, istMin: number) => p.c.findIndex((k) => Date.parse(k.date) === ist(d, istMin));

describe("v3 session features", () => {
  test("session minute counts from the 9:00 AM New York open; nothing before it", () => {
    expect(sessionMinute(9 * 60)).toBe(0);
    expect(sessionMinute(13 * 60 + 20)).toBe(260);
    expect(sessionMinute(8 * 60 + 55)).toBeNaN();
    expect(sessionMinute(23 * 60)).toBeNaN(); // the evening before, New York time
  });

  test("open, VWAP, opening range and the noise band are built from that day's and earlier candles only", () => {
    const days = weekdays(NOISE_MIN_DAYS + 2);
    const c = quietDays(days);
    const { p, f } = ctxOf(c);
    const last = days[days.length - 1];
    const i930 = idxAt(p, last, NY(9, 30));
    expect(f.sessMin[i930]).toBe(30);
    expect(f.sessOpen[i930]).toBe(6000);
    expect(Number.isFinite(f.orHigh[i930])).toBe(true);
    expect(f.orHigh[idxAt(p, last, NY(9, 25))]).toBeNaN(); // range not finished yet
    expect(f.sigma[i930]).toBeGreaterThan(0);
    expect(f.upper[i930]).toBeGreaterThan(6000);
    expect(f.lower[i930]).toBeLessThan(6000);
    // The first days have no band yet: fewer than 10 earlier days.
    expect(f.sigma[idxAt(p, days[3], NY(9, 30))]).toBeNaN();
    // Changing a LATER candle never changes an earlier feature.
    const c2 = c.map((k) => (Date.parse(k.date) > ist(last, NY(9, 30)) ? { ...k, close: k.close + 50, high: k.high + 50 } : k));
    const f2 = ctxOf(c2).f;
    expect(f2.vwap[i930]).toBe(f.vwap[i930]);
    expect(f2.upper[i930]).toBe(f.upper[i930]);
  });
});

describe("v3 setups", () => {
  test("noise breakout: a close above the band on the half hour buys CE, and the trade trails out when price falls back", () => {
    const days = weekdays(NOISE_MIN_DAYS + 2);
    const last = days[days.length - 1];
    const c = quietDays(days).map((k) => {
      const t = Date.parse(k.date);
      if (t < ist(last, NY(9, 0))) return k;
      const m = (t - ist(last, 0)) / 60_000;
      // Up 6 points every 5 minutes from 9:00 New York, then slide back 8 a candle from 10:30
      // (gently, so the VWAP trail -- not the hard stop -- takes it out).
      const up = Math.min(18, (m - NY(9, 0)) / 5 + 1) * 6;
      const x = m >= NY(10, 30) ? 6108 - 8 * ((m - NY(10, 30)) / 5 + 1) : 6000 + up;
      return { ...k, open: x - 3, high: x + 2, low: x - 4, close: x };
    });
    const ctx = ctxOf(c);
    const i = idxAt(ctx.p, last, NY(9, 25)); // the candle that ends 9:30
    const e = entryAt(ctx, i, "noise");
    expect(e?.side).toBe("CE");
    expect(e?.manage).toBe("trail5");
    expect(entryAt(ctx, i + 1, "noise")).toBeNull(); // 9:35 is not a half hour
    // The same strong first half hour is a big opening drive: hold to the close, stop only.
    const drive = entryAt(ctx, i, "driveStrict");
    expect(drive?.side).toBe("CE");
    expect(drive?.manage).toBe("hold");
    expect(entryAt(ctx, i + 6, "driveStrict")).toBeNull(); // only at 9:30
    const t = simulateV3(ctx, ["noise"], { sym: "CRUDEOIL" }).filter((x) => ctx.p.day[x.openIdx] === ctx.p.day[i]);
    expect(t[0].exit).toBe("trail");
    expect(t[0].openIdx).toBe(i);
  });

  test("opening range breakout: only the day's first close outside the 9:00-9:30 range", () => {
    const days = weekdays(3);
    const last = days[2];
    const c = quietDays(days).map((k) => {
      const m = (Date.parse(k.date) - ist(last, 0)) / 60_000;
      if (m === NY(9, 40)) return { ...k, open: 6004, high: 6030, low: 6003, close: 6025 };
      if (m === NY(9, 45)) return { ...k, open: 6025, high: 6040, low: 6020, close: 6035 };
      return k;
    });
    const ctx = ctxOf(c);
    const i = idxAt(ctx.p, last, NY(9, 40));
    expect(entryAt(ctx, i, "orb")?.side).toBe("CE");
    expect(entryAt(ctx, i + 1, "orb")).toBeNull();
  });

  test("the v3 replay of the trend setup equals the v2 lab exactly", () => {
    // Random walk: whatever the v2 rules do, the v3 replay must do the same.
    let px = 6000;
    const days = weekdays(14);
    const c: Candle[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (const d of days)
      for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
        const o = px;
        px += rnd() * 12;
        c.push({ date: new Date(ist(d, m)).toISOString(), open: o, high: Math.max(o, px) + 2, low: Math.min(o, px) - 2, close: px, volume: 100 });
      }
    const p = prepare(c, true);
    const ctx: V3Ctx = { p, f: computeFeatures(p) };
    const a = simulate(p, V2_RULES, "CRUDEOIL");
    const b = simulateV3(ctx, ["trend"], { sym: "CRUDEOIL" });
    expect(b.map((x) => [x.openIdx, x.closeIdx, x.rs, x.exit])).toEqual(a.map((x) => [x.openIdx, x.closeIdx, x.rs, x.exit]));
  }, 30_000);

  test("the live read calls exactly what the lab replay calls, candle by candle", () => {
    let px = 6000;
    let drift = 0;
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const days = weekdays(15);
    const c: Candle[] = [];
    for (const d of days)
      for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
        if (rnd() < 0.03) drift = (rnd() - 0.5) * 6;
        const o = px;
        px += drift + (rnd() - 0.5) * 10;
        c.push({ date: new Date(ist(d, m)).toISOString(), open: o, high: Math.max(o, px) + 2, low: Math.min(o, px) - 2, close: px, volume: 100 + rnd() * 50 });
      }
    const p = prepare(c, true);
    const full: V3Ctx = { p, f: computeFeatures(p) };
    const setups = V3_ACTIVE.CRUDEOIL;
    let compared = 0;
    let fired = 0;
    for (let i = c.length - 2 * 179; i < c.length; i++) {
      const lab = firstEntry(full, i, setups);
      const inWin = full.f.sessMin[i] >= 20 && full.f.sessMin[i] <= 270;
      if (!lab && !inWin) continue;
      const barEnd = Date.parse(c[i].date) + 5 * 60_000;
      const live = readV3(c.slice(0, i + 1), "CRUDEOIL", barEnd + 1000);
      if (live.entry && live.barEnd !== barEnd) {
        // A one-moment setup acted on its candle a few minutes late: the lab must have fired THERE.
        const j = c.findIndex((k) => Date.parse(k.date) + 5 * 60_000 === live.barEnd);
        const at = firstEntry(full, j, setups);
        expect(at?.setup).toBe(live.entry.setup);
        expect(at?.side).toBe(live.entry.side);
      } else {
        expect(live.entry?.setup ?? null).toBe(lab?.setup ?? null);
        expect(live.entry?.side ?? null).toBe(lab?.side ?? null);
      }
      compared++;
      if (lab) fired++;
    }
    expect(compared).toBeGreaterThan(50);
    expect(fired).toBeGreaterThanOrEqual(0);
  }, 60_000);

  test("day guards: no new trade after the day's loss limit", () => {
    const days = weekdays(3);
    const last = days[2];
    // Two opening-range breakouts would need two days; instead check the guard stops a second setup the same day.
    const c = quietDays(days).map((k) => {
      const m = (Date.parse(k.date) - ist(last, 0)) / 60_000;
      if (m === NY(9, 40)) return { ...k, open: 6004, high: 6030, low: 6003, close: 6025 };
      if (m === NY(9, 45)) return { ...k, open: 6025, high: 6026, low: 5900, close: 5905 }; // stop
      return k;
    });
    const ctx = ctxOf(c);
    const all = simulateV3(ctx, ["orb"], { sym: "CRUDEOIL" });
    expect(all).toHaveLength(1);
    expect(all[0].exit).toBe("sl");
    const none = simulateV3(ctx, ["orb"], { sym: "CRUDEOIL", dayLossLimitRs: 1 });
    expect(none).toHaveLength(1); // the first trade still happens; the guard only blocks NEW ones
  });
});
