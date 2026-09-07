// "If I'd bought 1 lot at this call, how much did it actually make?"
//
// Tracks the PEAK rupee profit a single lot would have reached over the life of
// the call, and ticks fixed ₹ milestones as that peak passes them. The peak is
// read from the trade's highWaterMark (the highest premium ever seen), which is
// preserved even after the trade closes at its stop -- so a ✓ never disappears
// just because the call later reversed. You're always long the option premium
// (a bought CE or PE), so profit = (premium - entry) x lot size for both sides.

export const PROFIT_MILESTONES = [500, 1000, 2000, 3000, 5000] as const;

export interface MilestoneState {
  value: number; // the ₹ milestone
  hit: boolean; // peak profit reached it
}

// Highest rupee profit 1 lot would have made. Uses the stored high-water mark
// (survives an SL close) plus the current premium, floored at 0 (a call that
// only ever lost shows ₹0, never a negative "profit").
export function peakProfitRs(entryPremium: number, highWaterMark: number | null | undefined, currentLtp: number | null | undefined, lotSize: number): number {
  const peak = Math.max(highWaterMark ?? entryPremium, currentLtp ?? entryPremium, entryPremium);
  return Math.max(0, Math.round((peak - entryPremium) * lotSize));
}

export function milestoneStates(peakRs: number): MilestoneState[] {
  return PROFIT_MILESTONES.map((value) => ({ value, hit: peakRs >= value }));
}

// How many milestones were reached (for a quick "3 of 5" style summary).
export function milestonesHitCount(peakRs: number): number {
  return PROFIT_MILESTONES.reduce((n, v) => (peakRs >= v ? n + 1 : n), 0);
}
