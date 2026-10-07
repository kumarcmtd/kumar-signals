// Weather demand vs the same weeks in the last three years.
//
// Gas demand follows temperature, so the useful question is "is this stretch
// colder (or hotter) than the same stretch in recent years?". Weeks here are
// 7-day blocks counted from today (week 0 = today..today+6), so every year is
// compared on the same calendar days. Degree days are °F, base 65°F: HDD for
// heating, CDD for cooling. Only past years' actual weather is a fact; this
// year's next two weeks are a forecast and are flagged as one.

export interface WeatherDay {
  date: string;
  tC: number;
  hdd: number;
  cdd: number;
  forecast?: boolean;
}

export interface WeatherRegion {
  id: "US" | "EU" | "ASIA";
  name: string;
  why: string;
  cities: { name: string; weight: number }[];
  current: WeatherDay[];
  past: { year: number; days: WeatherDay[] }[];
}

export type Metric = "hdd" | "cdd";

export interface WeekCell {
  year: number;
  value: number; // the season's metric, summed over the week
  tC: number; // mean temperature
  forecast: boolean;
}

export interface WeatherWeek {
  offset: number; // weeks from today
  start: string; // this year's date for the week start
  cells: Record<number, WeekCell | null>;
  pastAvg: number | null;
}

export interface Comparison {
  now: number | null; // this year
  byYear: { year: number; value: number | null }[];
  avg: number | null;
  diffPct: number | null; // now vs avg
}

export interface WeatherView {
  metric: Metric;
  mild: boolean; // too little heating or cooling for weather to matter much
  years: number[]; // past years oldest -> newest, then this year
  thisYear: number;
  weeks: WeatherWeek[];
  next14: Comparison; // forecast
  last28: Comparison; // actual
  next4wkPast: { year: number; value: number | null; diffPct: number | null }[]; // what followed in past years
}

const WEEKS_BEFORE = 4;
const WEEKS_AFTER = 12;
/** Under this many degree days a day (3-yr avg), weather is a minor driver. */
const MILD_PER_DAY = 3;

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Sum of the metric over day offsets [from, to) from `anchor`; null if under 70% of days exist. */
function sumDays(days: WeatherDay[], anchor: string, from: number, to: number, metric: Metric): { value: number; tC: number; forecast: boolean } | null {
  const lo = addDays(anchor, from);
  const hi = addDays(anchor, to);
  const inRange = days.filter((d) => d.date >= lo && d.date < hi);
  if (inRange.length < (to - from) * 0.7) return null;
  const scale = (to - from) / inRange.length; // fill a missing day or two at the average
  return {
    value: inRange.reduce((s, d) => s + d[metric], 0) * scale,
    tC: inRange.reduce((s, d) => s + d.tC, 0) / inRange.length,
    forecast: inRange.some((d) => d.forecast),
  };
}

const avgOf = (v: (number | null)[]) => {
  const n = v.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
const diff = (now: number | null, avg: number | null) => (now !== null && avg !== null && avg > 0 ? ((now - avg) / avg) * 100 : null);

/** The past year's anchor: today's month-day in that year. */
function anchorFor(today: string, year: number): string {
  const md = today.slice(5) === "02-29" ? "02-28" : today.slice(5);
  return `${year}-${md}`;
}

export function buildWeatherView(region: WeatherRegion, today: string): WeatherView | null {
  if (!region.current.length || !region.past.length) return null;
  const thisYear = Number(today.slice(0, 4));
  const past = [...region.past].sort((a, b) => a.year - b.year);

  // Heating or cooling season: whichever the past years had more of over the next 4 weeks.
  const sum4 = (m: Metric) => avgOf(past.map((p) => sumDays(p.days, anchorFor(today, p.year), 0, 28, m)?.value ?? null)) ?? 0;
  const hdd4 = sum4("hdd");
  const cdd4 = sum4("cdd");
  const metric: Metric = hdd4 >= cdd4 ? "hdd" : "cdd";
  const mild = Math.max(hdd4, cdd4) / 28 < MILD_PER_DAY;

  const weeks: WeatherWeek[] = [];
  for (let w = -WEEKS_BEFORE; w < WEEKS_AFTER; w++) {
    const cells: Record<number, WeekCell | null> = {};
    for (const p of past) {
      const s = sumDays(p.days, anchorFor(today, p.year), w * 7, w * 7 + 7, metric);
      cells[p.year] = s ? { year: p.year, value: s.value, tC: s.tC, forecast: false } : null;
    }
    const s = sumDays(region.current, today, w * 7, w * 7 + 7, metric);
    cells[thisYear] = s ? { year: thisYear, value: s.value, tC: s.tC, forecast: s.forecast } : null;
    weeks.push({ offset: w, start: addDays(today, w * 7), cells, pastAvg: avgOf(past.map((p) => cells[p.year]?.value ?? null)) });
  }

  const compare = (from: number, to: number): Comparison => {
    const byYear = past.map((p) => ({ year: p.year, value: sumDays(p.days, anchorFor(today, p.year), from, to, metric)?.value ?? null }));
    const now = sumDays(region.current, today, from, to, metric)?.value ?? null;
    const avg = avgOf(byYear.map((b) => b.value));
    return { now, byYear, avg, diffPct: diff(now, avg) };
  };
  const next4 = past.map((p) => ({ year: p.year, value: sumDays(p.days, anchorFor(today, p.year), 0, 28, metric)?.value ?? null }));
  const avg4 = avgOf(next4.map((n) => n.value));

  return {
    metric,
    mild,
    years: [...past.map((p) => p.year), thisYear],
    thisYear,
    weeks,
    next14: compare(0, 14),
    last28: compare(-28, 0),
    next4wkPast: next4.map((n) => ({ ...n, diffPct: diff(n.value, avg4) })),
  };
}

/** Plain-words reading of a comparison; never a prediction of price. */
export function describe(c: Comparison, metric: Metric): { tone: "more" | "less" | "normal" | "unknown"; text: string } {
  if (c.diffPct === null) return { tone: "unknown", text: "Not enough data to compare" };
  const word = metric === "hdd" ? ["colder", "milder"] : ["hotter", "cooler"];
  const demand = metric === "hdd" ? "heating" : "air-conditioning (power burn)";
  if (Math.abs(c.diffPct) < 8) return { tone: "normal", text: `Close to the 3-year average — normal ${demand} demand` };
  const pct = Math.round(Math.abs(c.diffPct));
  return c.diffPct > 0
    ? { tone: "more", text: `${pct}% ${word[0]} than the 3-year average — more ${demand} demand` }
    : { tone: "less", text: `${pct}% ${word[1]} than the 3-year average — less ${demand} demand` };
}
