// Price + Open Interest read for the futures -- the classic "build-up" table.
//
// Every futures contract has one buyer and one seller, so OI on its own never
// says bullish or bearish. Read TOGETHER with price, it says whether money is
// coming in or going out, and on which side:
//
//   price up   + OI up    long build-up    new buyers        bullish
//   price down + OI up    short build-up   new sellers       bearish
//   price up   + OI down  short covering   sellers exiting   bullish, weak
//   price down + OI down  long unwinding   buyers exiting    bearish, weak
//
// It describes what HAS happened in the positions, not what price will do, and
// nobody can see who holds them. Only real Upstox numbers go in; a missing OI
// gives "no OI data", never a guess.
//
// Near expiry the table is distorted: OI in the expiring month falls whatever
// the market does, because traders roll positions into next month. So inside
// ROLLOVER_DAYS of expiry the two months' OI is added together and that
// combined figure is the headline read.

export type BuildupKind = "long-buildup" | "short-buildup" | "short-covering" | "long-unwinding" | "no-clear-signal" | "no-data";

export interface BuildupRead {
  kind: BuildupKind;
  priceChangePct: number | null;
  oiChangePct: number | null;
  title: string;
  meaning: string;
  tone: "bull" | "bear" | "bull-weak" | "bear-weak" | "neutral";
}

/** Below these moves the reading is too small to name. */
export const DAY_BANDS = { pricePct: 0.15, oiPct: 0.5 };
export const HOUR_BANDS = { pricePct: 0.08, oiPct: 0.2 };
export const ROLLOVER_DAYS = 5;

const LABELS: Record<Exclude<BuildupKind, "no-data">, Omit<BuildupRead, "kind" | "priceChangePct" | "oiChangePct">> = {
  "long-buildup": { title: "Long build-up", meaning: "Price up and OI up: new buying positions are being added.", tone: "bull" },
  "short-buildup": { title: "Short build-up", meaning: "Price down and OI up: new selling positions are being added.", tone: "bear" },
  "short-covering": { title: "Short covering", meaning: "Price up but OI down: sellers are exiting. Up-moves from covering often fade once it ends.", tone: "bull-weak" },
  "long-unwinding": { title: "Long unwinding", meaning: "Price down and OI down: buyers are exiting. Falls from unwinding often slow once it ends.", tone: "bear-weak" },
  "no-clear-signal": { title: "No clear build-up", meaning: "Price or OI has barely moved, so positions aren't clearly building on either side.", tone: "neutral" },
};

export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

export function classifyBuildup(priceChangePct: number | null, oiChangePct: number | null, bands = DAY_BANDS): BuildupRead {
  if (priceChangePct === null || oiChangePct === null) {
    return { kind: "no-data", priceChangePct, oiChangePct, title: "No OI data", meaning: "Upstox did not return the price or OI needed for this read.", tone: "neutral" };
  }
  let kind: BuildupKind;
  if (Math.abs(priceChangePct) < bands.pricePct || Math.abs(oiChangePct) < bands.oiPct) kind = "no-clear-signal";
  else if (priceChangePct > 0) kind = oiChangePct > 0 ? "long-buildup" : "short-covering";
  else kind = oiChangePct > 0 ? "short-buildup" : "long-unwinding";
  return { kind, priceChangePct, oiChangePct, ...LABELS[kind] };
}

// ---- Shape the Worker returns -------------------------------------------------

export interface OiContractSnapshot {
  tradingSymbol: string;
  expiry: string; // YYYY-MM-DD
  price: number | null;
  oi: number | null;
  asOf: string | null;
  prevClose: number | null;
  prevOi: number | null;
  prevDate: string | null;
  /** "live" = today's session; "last" = market shut, comparing the last two sessions. */
  session: "live" | "last";
  hourAgo: { price: number | null; oi: number | null; at: string } | null;
}

export interface OiBuildupResponse {
  symbol: string;
  contracts: OiContractSnapshot[]; // nearest expiry first
  error?: string;
}

// ---- The read the card shows ---------------------------------------------------

export interface OiBuildupView {
  headline: BuildupRead;
  headlineBasis: string;
  lastHour: BuildupRead | null;
  perContract: { tradingSymbol: string; daysToExpiry: number | null; read: BuildupRead; oi: number | null; oiChange: number | null }[];
  rollover: { daysToExpiry: number; nearOiChangePct: number | null; combinedOiChangePct: number | null } | null;
  session: "live" | "last";
}

const IST_MS = 5.5 * 60 * 60 * 1000;
export function daysToExpiry(expiry: string, now: number = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (!m) return null;
  const today = new Date(now + IST_MS);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - todayUtc) / 86_400_000);
}

function sum(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

export function buildOiView(res: OiBuildupResponse, now: number = Date.now()): OiBuildupView | null {
  const cs = res.contracts.filter((c) => c.price !== null);
  if (cs.length === 0) return null;
  const near = cs[0];
  const perContract = cs.map((c) => ({
    tradingSymbol: c.tradingSymbol,
    daysToExpiry: daysToExpiry(c.expiry, now),
    read: classifyBuildup(pctChange(c.prevClose, c.price), pctChange(c.prevOi, c.oi)),
    oi: c.oi,
    oiChange: c.oi !== null && c.prevOi !== null ? c.oi - c.prevOi : null,
  }));

  const nearDays = perContract[0].daysToExpiry;
  const inRollover = nearDays !== null && nearDays <= ROLLOVER_DAYS && cs.length > 1;
  // The price move is taken from whichever month now holds more OI -- the one
  // traders are actually using.
  const active = inRollover ? [...cs].sort((a, b) => (b.oi ?? 0) - (a.oi ?? 0))[0] : near;
  const activePricePct = pctChange(active.prevClose, active.price);

  let headline: BuildupRead;
  let headlineBasis: string;
  let rollover: OiBuildupView["rollover"] = null;
  if (inRollover) {
    const combinedOiChangePct = pctChange(sum(cs.map((c) => c.prevOi)), sum(cs.map((c) => c.oi)));
    headline = classifyBuildup(activePricePct, combinedOiChangePct);
    headlineBasis = `${cs.map((c) => c.tradingSymbol).join(" + ")} OI added together (rollover week)`;
    rollover = { daysToExpiry: nearDays!, nearOiChangePct: pctChange(near.prevOi, near.oi), combinedOiChangePct };
  } else {
    headline = perContract[0].read;
    headlineBasis = near.tradingSymbol;
  }

  let lastHour: BuildupRead | null = null;
  if (active.session === "live" && active.hourAgo) {
    lastHour = classifyBuildup(pctChange(active.hourAgo.price, active.price), pctChange(active.hourAgo.oi, active.oi), HOUR_BANDS);
  }

  return { headline, headlineBasis, lastHour, perContract, rollover, session: near.session };
}
