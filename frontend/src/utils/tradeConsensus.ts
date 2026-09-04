// The one-glance "should I even look?" traffic light for a symbol.
//
// A trader who's busy doesn't have time to open every page, read the news, and
// weigh it all up. This collapses the whole app's current stance on a symbol
// into a single light:
//   GREEN  = the app agrees on a clear side right now (CE up / PE down) and the
//            market isn't too wild — a genuinely good moment to look closer.
//   YELLOW = mixed / weak / choppy — no real edge, options just bleed premium;
//            wait.
//   RED    = the app is contradicting itself (CE & PE both live) or the market
//            is too volatile to take any side — sit out.
//
// It is a SUMMARY to decide whether to dig into the pages, never a trade by
// itself. Pure and deterministic.

export type ConsensusLight = "green" | "yellow" | "red";

export interface ConsensusRead {
  light: ConsensusLight;
  side: "CE" | "PE" | null; // the favoured side when green
  headline: string; // short: "GO · Buy CE", "WAIT · Mixed", "AVOID · Too volatile"
  detail: string;
  bull: number;
  bear: number;
}

export interface ConsensusInput {
  symbolName: string;
  cePages: string[]; // pages holding a live CE (up) call
  pePages: string[]; // pages holding a live PE (down) call
  overnightLean: "bullish" | "bearish" | "neutral" | null; // global WTI/Brent or Henry Hub read
  volatilityPct: number | null; // ATR as % of price on the 15m candle
}

// 15m ATR as a % of price: crude/NG normally sit ~0.3-0.5%. Past ~0.9% the
// market is whipping hard enough that both a Call and a Put can lose.
const EXTREME_VOL_PCT = 0.9;
const HIGH_VOL_PCT = 0.55;

export function computeConsensus(input: ConsensusInput): ConsensusRead {
  const { symbolName, cePages, pePages, overnightLean, volatilityPct } = input;

  const bull = cePages.length + (overnightLean === "bullish" ? 1 : 0);
  const bear = pePages.length + (overnightLean === "bearish" ? 1 : 0);
  const net = bull - bear;
  const conflict = cePages.length > 0 && pePages.length > 0;
  const extreme = volatilityPct !== null && volatilityPct >= EXTREME_VOL_PCT;
  const choppy = volatilityPct !== null && volatilityPct >= HIGH_VOL_PCT;

  // 1) The app is split on the symbol -> genuine coin flip.
  if (conflict) {
    return {
      light: "red",
      side: null,
      headline: "AVOID · App is split",
      detail: `${symbolName}: some pages are long Calls (${cePages.join(", ")}) while others are long Puts (${pePages.join(", ")}). No clear side — sit out.`,
      bull,
      bear,
    };
  }

  // 2) Too volatile with no strong alignment -> both sides bleed.
  if (extreme && Math.abs(net) < 2) {
    return {
      light: "red",
      side: null,
      headline: "AVOID · Too volatile",
      detail: `${symbolName} is whipping both ways (~${volatilityPct!.toFixed(2)}% a candle) with no clear side — premiums bleed on Calls and Puts alike. Wait for it to settle.`,
      bull,
      bear,
    };
  }

  // 3) Aligned but very choppy -> right idea, wrong moment.
  if (extreme) {
    const side = net > 0 ? "CE" : "PE";
    return {
      light: "yellow",
      side,
      headline: `WAIT · Choppy ${side === "CE" ? "up" : "down"}-lean`,
      detail: `${symbolName} is leaning ${side === "CE" ? "up (Call)" : "down (Put)"}, but it's very choppy right now — wait for a calmer entry before buying.`,
      bull,
      bear,
    };
  }

  // 4) Clear one-sided agreement -> GO.
  if (net >= 2) {
    return {
      light: "green",
      side: "CE",
      headline: "GO · Buy CE (up)",
      detail: `${symbolName} is lining up to the upside${choppy ? " (a bit choppy, size down)" : ""} — worth opening the pages and taking the best Call setup.`,
      bull,
      bear,
    };
  }
  if (net <= -2) {
    return {
      light: "green",
      side: "PE",
      headline: "GO · Buy PE (down)",
      detail: `${symbolName} is lining up to the downside${choppy ? " (a bit choppy, size down)" : ""} — worth opening the pages and taking the best Put setup.`,
      bull,
      bear,
    };
  }

  // 5) Weak or no lean -> WAIT.
  if (net !== 0) {
    const dir = net > 0 ? "up" : "down";
    return {
      light: "yellow",
      side: null,
      headline: "WAIT · Weak lean",
      detail: `${symbolName} is leaning slightly ${dir}, but it's not confirmed across the pages yet — a mixed mood like this mostly burns premium. Wait for it to firm up.`,
      bull,
      bear,
    };
  }

  return {
    light: "yellow",
    side: null,
    headline: "WAIT · No edge yet",
    detail: `${symbolName} has no clear call or overnight lean right now — nothing worth chasing. Check back when a side develops.`,
    bull,
    bear,
  };
}
