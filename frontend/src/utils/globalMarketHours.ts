// MCX energy is a price-taker off the global benchmarks, and those trade a
// near-24-hour session while MCX (9am-11:55pm IST) is shut -- which is why a
// TradingView watchlist shows WTI / Brent / Henry Hub live and moving at, say,
// 6:30am IST even though the Indian market is "CLOSED". This resolves which
// global energy venues are open RIGHT NOW so the app can show that context.

export interface MarketVenue {
  id: string;
  name: string; // exchange
  product: string; // what trades there
  region: string;
  open: boolean;
  hoursNote: string;
  // Ties this venue to its live global quote (from /api/global-markets) and to
  // the MCX symbol it drives, so the panel can show a bullish/bearish read.
  quoteSymbol?: string;
  tracksMcx?: "CRUDEOIL" | "NATURALGAS";
}

export type MoveDir = "bullish" | "bearish" | "neutral";

// Below this, a move is chop, not a lean.
const NEUTRAL_PCT = 0.15;

export function moveDirection(changePercent: number | null | undefined): MoveDir {
  if (changePercent == null) return "neutral";
  if (changePercent > NEUTRAL_PCT) return "bullish";
  if (changePercent < -NEUTRAL_PCT) return "bearish";
  return "neutral";
}

// Averages a set of change%s (e.g. WTI + Brent for the crude read) into one
// bias. Returns neutral with a null pct when nothing is available.
export function aggregateBias(changePercents: (number | null | undefined)[]): { dir: MoveDir; avgPct: number | null } {
  const vals = changePercents.filter((x): x is number => typeof x === "number");
  if (!vals.length) return { dir: "neutral", avgPct: null };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { dir: moveDirection(avg), avgPct: Number(avg.toFixed(2)) };
}

function partsInZone(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")?.value ?? "Sun");
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? "0") % 24;
  const minute = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return { weekday: weekday < 0 ? 0 : weekday, minutes: hour * 60 + minute };
}

// CME Globex NYMEX energy (WTI Crude CL, Henry Hub Natural Gas NG): trades
// Sunday 6:00pm ET through Friday 5:00pm ET, with a daily maintenance halt
// 5:00-6:00pm ET. Computed in US Eastern time so it's automatically correct
// across US daylight-saving changes (the reason a fixed IST cutoff would drift
// twice a year).
export function cmeEnergyOpen(now: Date = new Date()): boolean {
  const { weekday, minutes } = partsInZone(now, "America/New_York");
  const OPEN_SUN = 18 * 60; // 6:00pm ET Sunday
  const CLOSE_FRI = 17 * 60; // 5:00pm ET Friday
  const BREAK_START = 17 * 60; // daily 5:00-6:00pm ET halt
  const BREAK_END = 18 * 60;
  if (weekday === 6) return false; // Saturday: fully closed
  if (weekday === 0) return minutes >= OPEN_SUN; // Sunday: reopens 6pm ET
  if (weekday === 5) return minutes < CLOSE_FRI; // Friday: closes 5pm ET for the weekend
  return !(minutes >= BREAK_START && minutes < BREAK_END); // Mon-Thu: open except the daily halt
}

// MCX energy: Mon-Fri, ~9:00am-11:55pm IST. Falls back to this clock rule when
// the live market-status flag isn't provided.
export function mcxOpenByClock(now: Date = new Date()): boolean {
  const { weekday, minutes } = partsInZone(now, "Asia/Kolkata");
  if (weekday < 1 || weekday > 5) return false;
  return minutes >= 9 * 60 && minutes < 23 * 60 + 55;
}

// The venues that matter for Crude Oil & Natural Gas, with live open/closed.
// ICE Brent runs its own near-24h session very close to CME's; it's flagged
// off the same global session with an honest "near-24h" note rather than
// asserting exact minutes we'd have to keep in sync.
export function globalEnergyVenues(now: Date = new Date(), mcxOpen?: boolean): MarketVenue[] {
  const cme = cmeEnergyOpen(now);
  return [
    {
      id: "mcx",
      name: "MCX",
      product: "Crude Oil & Natural Gas futures",
      region: "India",
      open: mcxOpen ?? mcxOpenByClock(now),
      hoursNote: "9:00 AM – 11:55 PM IST, Mon–Fri",
    },
    {
      id: "nymex-cl",
      name: "NYMEX (CME Globex)",
      product: "WTI Crude (CL)",
      region: "US",
      open: cme,
      hoursNote: "Sun 6:00 PM – Fri 5:00 PM ET (near 24h)",
      quoteSymbol: "CL=F",
      tracksMcx: "CRUDEOIL",
    },
    {
      id: "nymex-ng",
      name: "NYMEX (CME Globex)",
      product: "Henry Hub Natural Gas (NG)",
      region: "US",
      open: cme,
      hoursNote: "Sun 6:00 PM – Fri 5:00 PM ET (near 24h)",
      quoteSymbol: "NG=F",
      tracksMcx: "NATURALGAS",
    },
    {
      id: "ice-brent",
      name: "ICE",
      product: "Brent Crude (B)",
      region: "UK / Europe",
      open: cme,
      hoursNote: "Near-24h global session, Sun evening – Fri",
      quoteSymbol: "BZ=F",
      tracksMcx: "CRUDEOIL",
    },
  ];
}
