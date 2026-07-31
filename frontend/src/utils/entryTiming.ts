// Answers a different question than Rebound Strength does. Rebound Strength
// only fires when price is BETWEEN entry and stop (underwater) and asks
// "does this still have strength to recover?" This fires whenever someone is
// looking at a call that's already moved AWAY from its original entry price
// on the way to target, and asks the question that actually matters in that
// moment: "price already ran from ₹14.30 toward ₹21.22 and sits at ₹16.60 --
// do I still enter now, or has the easy part of this move already happened?"
export type EntryTimingTier = "past_stop" | "underwater" | "excellent" | "good" | "fair" | "late" | "past_target";

export interface EntryTimingVerdict {
  tier: EntryTimingTier;
  label: string;
  note: string;
}

// legFloor/nextTarget: the CURRENT leg's boundaries -- entry/Target 1 before
// anything's hit, Target 1/Target 2 once Target 1 has hit, etc. (same
// "which leg are we actually in" logic the rest of the card already uses for
// "Next target"), so this reads correctly even for a call that's already
// banked its first target and is running toward the next one.
export function evaluateEntryTiming(legFloor: number, nextTarget: number, effectiveStop: number, liveLtp: number): EntryTimingVerdict {
  if (liveLtp <= effectiveStop) {
    return { tier: "past_stop", label: "Already At Stop", note: "Live price is already at or below the current stop -- this isn't an entry opportunity, it's an exit one." };
  }
  if (liveLtp < legFloor) {
    return { tier: "underwater", label: "Below Entry -- Check Rebound", note: "Price has pulled back below the entry for this leg -- see the Rebound Strength check below before deciding." };
  }
  if (liveLtp >= nextTarget) {
    return { tier: "past_target", label: "Already Past Target", note: "Price has already reached this target -- entering now means chasing past it. Wait for the next fresh call or a real pullback." };
  }

  const progressPct = ((liveLtp - legFloor) / (nextTarget - legFloor)) * 100;
  const p = Math.round(progressPct);

  if (progressPct < 25) {
    return { tier: "excellent", label: "Good Entry Zone", note: `Only ${p}% of the move to the next target has happened -- most of it is still ahead.` };
  }
  if (progressPct < 50) {
    return { tier: "good", label: "Still a Fair Entry", note: `${p}% of the move to the next target is done -- reasonable room still left.` };
  }
  if (progressPct < 75) {
    return { tier: "fair", label: "Late -- Wait For a Pullback", note: `${p}% of the move to the next target already happened -- entering now risks buying near the top of this leg.` };
  }
  return { tier: "late", label: "Too Extended -- Don't Chase", note: `${p}% of the move to the next target is already done -- most of the quick reward is gone. Wait for a real pullback or the next call.` };
}
