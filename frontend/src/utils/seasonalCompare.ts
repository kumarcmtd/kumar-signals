// "This week of the year, in past years" -- the seasonal comparison.
//
// Weeks are matched by ISO week number (Mon-Sun weeks, week 1 contains the
// first Thursday of the year), so "week 40" is the same slice of the season
// every year whatever the calendar date. For each past year it reports that
// week's price and what happened over the following weeks, so a trader can
// see whether this time of year has tended to rise or fall.
//
// It only ever reports what the prices did. Three years is a small sample and
// each winter's weather is different; the card says so rather than turning a
// tendency into a prediction.

export interface WeekBar {
  date: string; // week start YYYY-MM-DD (or YYYY-MM-01 for a month bar)
  open?: number;
  close: number;
  high: number;
  low: number;
  usdInr: number | null;
}

export interface IsoWeek {
  year: number;
  week: number;
}

export function isoWeekOf(date: string): IsoWeek {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

export const FORWARD_WEEKS = [1, 2, 4, 8] as const;

export interface SameWeekRow {
  year: number;
  date: string;
  close: number;
  inr: number | null; // ≈ MCX ₹ = close × that week's USD/INR
  weekChangePct: number | null; // vs the week before
  forwardPct: Record<(typeof FORWARD_WEEKS)[number], number | null>; // close N weeks later vs this close
  isCurrent: boolean;
}

export interface Tendency {
  weeks: number;
  up: number;
  down: number;
  years: number;
  avgPct: number | null;
}

export interface SeasonalView {
  week: number;
  rows: SameWeekRow[]; // this year first, then past years
  tendencies: Tendency[]; // over FORWARD_WEEKS, past years only
  chart: { week: number; [year: string]: number | null }[];
  chartYears: number[];
}

const pct = (from: number, to: number) => ((to - from) / from) * 100;

export function buildSeasonal(bars: WeekBar[], yearsBack = 3): SeasonalView | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 10) return null;
  const last = sorted[sorted.length - 1];
  const now = isoWeekOf(last.date);
  const keyed = sorted.map((b) => ({ ...b, iso: isoWeekOf(b.date) }));

  const rows: SameWeekRow[] = [];
  for (let k = 0; k <= yearsBack; k++) {
    const year = now.year - k;
    // Same ISO week; a year without a week 53 falls back to its week 52.
    let i = keyed.findIndex((b) => b.iso.year === year && b.iso.week === now.week);
    if (i < 0 && now.week === 53) i = keyed.findIndex((b) => b.iso.year === year && b.iso.week === 52);
    if (i < 0) continue;
    const b = keyed[i];
    const prev = keyed[i - 1];
    const forwardPct = {} as SameWeekRow["forwardPct"];
    for (const n of FORWARD_WEEKS) forwardPct[n] = keyed[i + n] ? pct(b.close, keyed[i + n].close) : null;
    rows.push({
      year,
      date: b.date,
      close: b.close,
      inr: b.usdInr !== null ? b.close * b.usdInr : null,
      weekChangePct: prev ? pct(prev.close, b.close) : null,
      forwardPct,
      isCurrent: k === 0,
    });
  }

  const past = rows.filter((r) => !r.isCurrent);
  const tendencies: Tendency[] = FORWARD_WEEKS.map((n) => {
    const vals = past.map((r) => r.forwardPct[n]).filter((v): v is number => v !== null);
    return {
      weeks: n,
      up: vals.filter((v) => v > 0).length,
      down: vals.filter((v) => v < 0).length,
      years: vals.length,
      avgPct: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    };
  });

  const chartYears = rows.map((r) => r.year).sort();
  const chart: SeasonalView["chart"] = [];
  for (let w = 1; w <= 53; w++) {
    const point: SeasonalView["chart"][number] = { week: w };
    let any = false;
    for (const y of chartYears) {
      const b = keyed.find((x) => x.iso.year === y && x.iso.week === w);
      point[String(y)] = b ? b.close : null;
      if (b) any = true;
    }
    if (any) chart.push(point);
  }

  return { week: now.week, rows, tendencies, chart, chartYears };
}

export interface GridRow {
  offset: number; // weeks from this week
  week: number; // ISO week number
  cells: { year: number; date: string | null; close: number | null; inr: number | null }[];
}

/**
 * Week by week from this week onwards, each past season side by side: the
 * row for "+3" holds, for every year, the bar three weeks after that year's
 * same week -- so a season that crosses New Year stays in one column.
 */
export function seasonGrid(bars: WeekBar[], view: SeasonalView, weeksAhead = 12): GridRow[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const anchors = view.rows.map((r) => ({ year: r.year, i: sorted.findIndex((b) => b.date === r.date) }));
  const rows: GridRow[] = [];
  for (let k = 0; k <= weeksAhead; k++) {
    const cells = anchors.map(({ year, i }) => {
      const b = i >= 0 ? sorted[i + k] : undefined;
      return { year, date: b?.date ?? null, close: b?.close ?? null, inr: b && b.usdInr !== null ? b.close * b.usdInr : null };
    });
    const firstDate = cells.find((c) => c.date)?.date;
    rows.push({ offset: k, week: firstDate ? isoWeekOf(firstDate).week : ((view.week + k - 1) % 52) + 1, cells });
  }
  return rows;
}

// ---- Monthly ---------------------------------------------------------------

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthCell {
  year: number;
  month: number; // 0-11
  open: number;
  high: number;
  low: number;
  close: number;
  usdInr: number | null;
  changePct: number; // open -> close
  rangePct: number; // low -> high, as % of low
  partial: boolean; // the month in progress
}

export interface MonthRow {
  month: number;
  label: string;
  cells: Record<number, MonthCell | null>;
  /** Past (complete) years only. */
  up: number;
  years: number;
  avgChangePct: number | null;
  avgRangePct: number | null;
}

export interface MonthlyView {
  years: number[]; // oldest -> newest
  currentYear: number;
  currentMonth: number;
  rows: MonthRow[];
}

export function buildMonthly(months: WeekBar[], yearsBack = 3): MonthlyView | null {
  if (months.length < 6) return null;
  const sorted = [...months].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const currentYear = Number(last.date.slice(0, 4));
  const currentMonth = Number(last.date.slice(5, 7)) - 1;
  const years = Array.from({ length: yearsBack + 1 }, (_, i) => currentYear - yearsBack + i);

  const byKey = new Map<string, WeekBar>();
  for (const b of sorted) byKey.set(b.date.slice(0, 7), b);

  const rows: MonthRow[] = MONTH_LABELS.map((label, month) => {
    const cells: Record<number, MonthCell | null> = {};
    for (const year of years) {
      const b = byKey.get(`${year}-${String(month + 1).padStart(2, "0")}`);
      if (!b) {
        cells[year] = null;
        continue;
      }
      const open = b.open ?? b.close;
      cells[year] = {
        year, month, open, high: b.high, low: b.low, close: b.close, usdInr: b.usdInr,
        changePct: ((b.close - open) / open) * 100,
        rangePct: b.low > 0 ? ((b.high - b.low) / b.low) * 100 : 0,
        partial: year === currentYear && month === currentMonth,
      };
    }
    const past = years.filter((y) => y < currentYear).map((y) => cells[y]).filter((c): c is MonthCell => c !== null);
    return {
      month,
      label,
      cells,
      up: past.filter((c) => c.changePct > 0).length,
      years: past.length,
      avgChangePct: past.length ? past.reduce((s, c) => s + c.changePct, 0) / past.length : null,
      avgRangePct: past.length ? past.reduce((s, c) => s + c.rangePct, 0) / past.length : null,
    };
  });
  return { years, currentYear, currentMonth, rows };
}
