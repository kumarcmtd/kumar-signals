// sortByTime must order exactly as the per-compare Date comparator did.
import { expect, test } from "vitest";
import { sortByTime } from "../../src/upstox";

const old = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => +new Date(a.date) - +new Date(b.date));
const bar = (date: string, id: number) => ({ date, id, open: 1, high: 1, low: 1, close: 1, volume: 0, oi: 0 });

test("matches the old comparator: descending, ascending, shuffled, ties and bad stamps", () => {
  const base = Array.from({ length: 300 }, (_, i) => bar(new Date(Date.UTC(2026, 8, 1) + i * 1_800_000).toISOString().replace("Z", "+00:00"), i));
  const shuffled = base.map((b, i) => [b, (i * 7919) % 300] as const).sort((x, y) => x[1] - y[1]).map(([b]) => b);
  const ties = [...base.slice(0, 5), bar(base[2].date, 900), bar(base[2].date, 901), ...base.slice(5, 9)].reverse();
  const bad = [bar("nonsense", 1), ...base.slice(0, 4), bar("", 2)];
  for (const input of [[...base].reverse(), base, shuffled, ties, bad, [], [base[0]]]) {
    const got = [...input];
    sortByTime(got);
    expect(got).toEqual(old(input));
  }
});
