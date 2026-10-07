// US gas storage vs the same week in past years.
//
// The market's yardstick is the five-year average for the same week: more gas
// in storage than that tends to weigh on price, less tends to support it. The
// weekly change matters too -- a smaller injection (or bigger withdrawal) than
// usual is "tighter". Weeks are matched to the same calendar date in each past
// year (EIA weeks end on Fridays, so the nearest is within three days).
// Everything here is arithmetic on the EIA's reported numbers; the one forward
// figure, "if the next 4 weeks are average", is labelled as exactly that.

export interface StorageWeek {
  period: string; // week ending, YYYY-MM-DD
  value: number; // Bcf
}

export interface WeekStats {
  period: string;
  value: number;
  change: number | null; // vs the week before
  lastYear: number | null; // level, same week last year
  lastYearChange: number | null;
  avg5: number | null; // level, 5-yr average (past 5 years)
  avg5Change: number | null;
  avg3: number | null;
  vs5Pct: number | null;
  vs5Bcf: number | null;
  vsLyPct: number | null;
  vs3Pct: number | null;
}

export interface StorageView {
  latest: WeekStats;
  recent: WeekStats[]; // newest first
  pastSameWeek: { year: number; period: string; value: number; change: number | null }[]; // newest first
  next4: { avg5: number | null; projected: number | null; projectedAvg5: number | null; byYear: { year: number; change: number | null }[] };
  seasons: { year: number; low: number | null; peak: number | null; peakPartial: boolean; lowPartial: boolean }[];
  chart: { week: number; [key: string]: number | null }[];
  chartYears: number[];
  nextReport: { date: string; istTime: string };
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const pct = (a: number, b: number) => ((a - b) / b) * 100;
const avg = (v: (number | null)[]) => {
  const n = v.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};

/** Index of the week nearest the same month-day `yearsBack` years earlier (within 3 days). */
function sameWeekIndex(weeks: StorageWeek[], period: string, yearsBack: number): number {
  const [y, m, d] = period.split("-").map(Number);
  const target = Date.UTC(y - yearsBack, m - 1, m === 2 && d === 29 ? 28 : d);
  let best = -1;
  let bestGap = 3.5 * DAY;
  weeks.forEach((w, i) => {
    const gap = Math.abs(t(w.period) - target);
    if (gap <= bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

const changeAt = (weeks: StorageWeek[], i: number) => (i > 0 && t(weeks[i].period) - t(weeks[i - 1].period) <= 8 * DAY ? weeks[i].value - weeks[i - 1].value : null);

function statsAt(weeks: StorageWeek[], i: number): WeekStats {
  const w = weeks[i];
  const past = [1, 2, 3, 4, 5].map((k) => sameWeekIndex(weeks, w.period, k));
  const level = (k: number) => (past[k - 1] >= 0 ? weeks[past[k - 1]].value : null);
  const levels5 = [1, 2, 3, 4, 5].map(level);
  const avg5 = levels5.every((v) => v !== null) ? avg(levels5) : null; // only a true 5-year average
  const avg3 = avg(levels5.slice(0, 3));
  const changes5 = past.map((j) => (j >= 0 ? changeAt(weeks, j) : null));
  const lastYear = level(1);
  return {
    period: w.period,
    value: w.value,
    change: changeAt(weeks, i),
    lastYear,
    lastYearChange: changes5[0],
    avg5,
    avg5Change: changes5.every((c) => c !== null) ? avg(changes5) : null,
    avg3,
    vs5Pct: avg5 ? pct(w.value, avg5) : null,
    vs5Bcf: avg5 !== null ? w.value - avg5 : null,
    vsLyPct: lastYear ? pct(w.value, lastYear) : null,
    vs3Pct: avg3 ? pct(w.value, avg3) : null,
  };
}

/** ISO week number of a date. */
function isoWeek(date: string): number {
  const d = new Date(t(date));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}

/** US daylight time: second Sunday of March to first Sunday of November. */
function usDst(date: string): boolean {
  const y = Number(date.slice(0, 4));
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return Date.UTC(y, month, 1 + ((7 - first) % 7) + (n - 1) * 7);
  };
  const x = t(date);
  return x >= nthSunday(2, 2) && x < nthSunday(10, 1);
}

export function buildStorage(raw: StorageWeek[]): StorageView | null {
  const weeks = [...raw].sort((a, b) => a.period.localeCompare(b.period));
  if (weeks.length < 60) return null;
  const last = weeks.length - 1;
  const latest = statsAt(weeks, last);
  const year = Number(latest.period.slice(0, 4));

  const recent: WeekStats[] = [];
  for (let i = last; i > last - 8 && i > 0; i--) recent.push(statsAt(weeks, i));

  const pastSameWeek = [1, 2, 3, 4, 5]
    .map((k) => ({ k, i: sameWeekIndex(weeks, latest.period, k) }))
    .filter(({ i }) => i >= 0)
    .map(({ k, i }) => ({ year: year - k, period: weeks[i].period, value: weeks[i].value, change: changeAt(weeks, i) }));

  const byYear = [1, 2, 3, 4, 5].map((k) => {
    const i = sameWeekIndex(weeks, latest.period, k);
    return { year: year - k, change: i >= 0 && weeks[i + 4] && t(weeks[i + 4].period) - t(weeks[i].period) <= 30 * DAY ? weeks[i + 4].value - weeks[i].value : null };
  });
  const next4Avg = byYear.every((b) => b.change !== null) ? avg(byYear.map((b) => b.change)) : null;
  const last4Avg5 = (() => {
    const p = new Date(t(latest.period) + 28 * DAY).toISOString().slice(0, 10);
    const lv = [1, 2, 3, 4, 5].map((k) => {
      const i = sameWeekIndex(weeks, p, k);
      return i >= 0 ? weeks[i].value : null;
    });
    return lv.every((v) => v !== null) ? avg(lv) : null;
  })();

  const seasons = [3, 2, 1, 0].map((k) => {
    const yr = year - k;
    const ofYear = weeks.filter((w) => w.period.startsWith(String(yr)));
    const lows = ofYear.filter((w) => Number(w.period.slice(5, 7)) <= 5).map((w) => w.value);
    const peaks = ofYear.filter((w) => Number(w.period.slice(5, 7)) >= 9).map((w) => w.value);
    const month = Number(latest.period.slice(5, 7));
    return {
      year: yr,
      low: lows.length ? Math.min(...lows) : null,
      peak: peaks.length ? Math.max(...peaks) : null,
      lowPartial: k === 0 && month <= 5,
      peakPartial: k === 0 && month < 12,
    };
  });

  const chartYears = [year - 3, year - 2, year - 1, year];
  const chart: StorageView["chart"] = [];
  for (let w = 1; w <= 53; w++) {
    const point: StorageView["chart"][number] = { week: w };
    let any = false;
    for (const y of chartYears) {
      const b = weeks.find((x) => x.period.startsWith(String(y)) && isoWeek(x.period) === w);
      point[String(y)] = b ? b.value : null;
      if (b) any = true;
    }
    const five = [1, 2, 3, 4, 5].map((k) => weeks.find((x) => x.period.startsWith(String(year - k)) && isoWeek(x.period) === w)?.value ?? null).filter((v): v is number => v !== null);
    point.min5 = five.length === 5 ? Math.min(...five) : null;
    point.max5 = five.length === 5 ? Math.max(...five) : null;
    if (any) chart.push(point);
  }

  // The report for the week ending Friday F comes out Thursday F+6, so the next one covers F+7.
  const nextDate = new Date(t(latest.period) + 13 * DAY).toISOString().slice(0, 10);
  return {
    latest,
    recent,
    pastSameWeek,
    next4: { avg5: next4Avg, projected: next4Avg !== null ? latest.value + next4Avg : null, projectedAvg5: last4Avg5, byYear },
    seasons,
    chart,
    chartYears,
    nextReport: { date: nextDate, istTime: usDst(nextDate) ? "8:00 PM IST" : "9:00 PM IST" },
  };
}

/** Plain reading of the level vs the 5-year average; a tendency, not a forecast. */
export function readLevel(vs5Pct: number | null): { tone: "bearish" | "bullish" | "neutral" | "unknown"; text: string } {
  if (vs5Pct === null) return { tone: "unknown", text: "Not enough history for a 5-year average" };
  const p = Math.abs(vs5Pct).toFixed(1);
  if (vs5Pct > 4) return { tone: "bearish", text: `${p}% MORE gas than the 5-year average — a comfortable cushion, which tends to weigh on price` };
  if (vs5Pct < -4) return { tone: "bullish", text: `${p}% LESS gas than the 5-year average — a thinner cushion, which tends to support price` };
  return { tone: "neutral", text: `Within ${p}% of the 5-year average — storage is near normal` };
}

/** This week's change vs the usual change for the same week. */
export function readChange(change: number | null, avg5Change: number | null): { tone: "bearish" | "bullish" | "neutral" | "unknown"; text: string } {
  if (change === null || avg5Change === null) return { tone: "unknown", text: "" };
  const d = change - avg5Change;
  if (Math.abs(d) < 5) return { tone: "neutral", text: "This week's change was close to the usual for this week" };
  return d < 0
    ? { tone: "bullish", text: `${Math.round(-d)} Bcf tighter than the usual change for this week (less added / more taken out)` }
    : { tone: "bearish", text: `${Math.round(d)} Bcf looser than the usual change for this week (more added / less taken out)` };
}
