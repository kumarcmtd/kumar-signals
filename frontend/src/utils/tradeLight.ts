import type { EntryTimingVerdict } from "./entryTiming";
import type { ReboundCheck } from "./reboundStrength";

// A single, unambiguous traffic light on top of everything Entry Timing and
// Rebound Strength already compute -- both were already real, live-data
// verdicts, just spread across a badge and a conditional card that someone
// has to piece together themselves. This collapses them into the one
// question that actually matters at a glance: green (buy now), yellow
// (wait, here's the price to watch for), or red (don't buy this leg at
// all right now). The suggested price is always derived from the SAME real
// levels already on the card (leg floor / next target / effective stop) --
// never a fabricated number.

export type TradeLightColor = "green" | "yellow" | "red";

export interface TradeLightVerdict {
  light: TradeLightColor;
  label: string;
  note: string;
  // The price to watch for when it isn't a flat "buy now" -- null when the
  // answer is genuinely "buy at the current live price" (green) or "there
  // isn't a sensible level right now, wait for a fresh call" (red on a
  // finished/invalid leg).
  suggestedBuyPrice: number | null;
}

export function computeTradeLight(
  entryTiming: EntryTimingVerdict,
  rebound: ReboundCheck | null,
  legFloor: number,
  nextTarget: number,
  effectiveStop: number
): TradeLightVerdict {
  const legSpan = nextTarget - legFloor;
  const atPct = (pct: number) => Number((legFloor + legSpan * pct).toFixed(2));

  switch (entryTiming.tier) {
    case "excellent":
    case "good":
      return {
        light: "green",
        label: "Buy Now",
        note: `${entryTiming.note} Current price is a clean entry -- no need to wait.`,
        suggestedBuyPrice: null,
      };

    case "fair":
      return {
        light: "yellow",
        label: "Wait For Buy",
        note: "Already more than halfway through this leg -- entering now risks buying near the top. Wait for a pullback into a cleaner zone.",
        suggestedBuyPrice: atPct(0.4),
      };

    case "late":
      return {
        light: "red",
        label: "Don't Buy Now",
        note: "Too extended -- most of this leg's reward is already gone. Wait for a real pullback, not just a small dip.",
        suggestedBuyPrice: atPct(0.25),
      };

    case "underwater": {
      if (rebound && rebound.tier === "strong") {
        return {
          light: "yellow",
          label: "Wait For Buy",
          note: `Price pulled back below entry, but ${rebound.label.toLowerCase()} (${rebound.score}% of checks still favor this direction) -- watch for it to reclaim the entry level before buying.`,
          suggestedBuyPrice: Number(legFloor.toFixed(2)),
        };
      }
      if (rebound && rebound.tier === "moderate") {
        return {
          light: "yellow",
          label: "Wait For Buy",
          note: `Price is below entry with mixed signals (${rebound.label.toLowerCase()}) -- only worth buying if it holds above the midpoint on the way back up.`,
          suggestedBuyPrice: Number(((effectiveStop + legFloor) / 2).toFixed(2)),
        };
      }
      return {
        light: "red",
        label: "Don't Buy Now",
        note: rebound
          ? `Price is below entry and ${rebound.label.toLowerCase()} -- real risk this heads to the stop instead of recovering. Let this one play out before adding.`
          : "Price is below entry with no rebound read yet -- too early to call this a buy.",
        suggestedBuyPrice: null,
      };
    }

    case "past_target":
      return {
        light: "red",
        label: "Don't Buy Now",
        note: "This leg already reached its target -- buying now means chasing past it. Wait for the next fresh call.",
        suggestedBuyPrice: null,
      };

    case "past_stop":
    default:
      return {
        light: "red",
        label: "Don't Buy Now",
        note: "This call is already at or past its stop -- not a valid entry. Wait for a fresh call.",
        suggestedBuyPrice: null,
      };
  }
}
