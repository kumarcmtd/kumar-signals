// "Why Today" -- turns the app's already-fetched, already-scored energy news
// into a plain read of WHY crude / natural gas is moving and roughly HOW LONG
// the driver tends to matter. The direction and the driving headlines are
// deterministic and grounded in real articles; an AI layer (in the worker)
// only writes the prose summary, strictly from those same headlines.

export type WhyLean = "bullish" | "bearish" | "neutral";
export type DurationBucket = "temporary" | "days" | "structural";

export interface WhyDriver {
  headline: string;
  source: string;
  url: string;
  impact: WhyLean;
  timeImpact: string; // the article's own time-impact tag (e.g. "1h", "1d")
}

export interface WhyCommodity {
  available: boolean;
  lean: WhyLean;
  leanScore: number; // summed impact scale of the drivers
  drivers: WhyDriver[];
  aiSummary: string; // written by the worker's AI, grounded in the drivers; "" if none
  durationRead: string; // "Temporary" | "A few days" | "Longer-lasting"
  durationWhy: string;
}

// How long each kind of catalyst usually matters. Data-release reactions
// (inventories/storage) fade fast; weather and macro run a few days; supply
// policy, conflict and sanctions reprice the curve for longer.
const DURATION_BY_RULE: Record<string, DurationBucket> = {
  inventoryDraw: "temporary",
  inventoryBuild: "temporary",
  storageBuild: "temporary",
  storageDraw: "temporary",
  refineryShutdown: "temporary",
  pipelineOutageNg: "temporary",
  coldWinter: "days",
  warmWinter: "days",
  hurricane: "days",
  lngExportIncrease: "days",
  dollarStrong: "days",
  dollarWeak: "days",
  fedRateHike: "days",
  fedRateCut: "days",
  opecCut: "structural",
  opecIncrease: "structural",
  war: "structural",
  peace: "structural",
  pipelineExplosion: "structural",
  hormuz: "structural",
  redSea: "structural",
  sanctions: "structural",
};

const DURATION_LABEL: Record<DurationBucket, string> = {
  temporary: "Temporary",
  days: "A few days",
  structural: "Longer-lasting",
};

const DURATION_WHY: Record<DurationBucket, string> = {
  temporary: "Driven by a data release or short-term flow — these moves usually fade within a session or two.",
  days: "Weather or macro-driven — tends to matter for a few days, then the market re-focuses on fundamentals.",
  structural: "Supply policy, conflict or sanctions — this kind of driver can reprice the market for weeks, not hours.",
};

// Picks the most durable bucket among all matched rules (structural beats
// days beats temporary). Defaults to temporary when nothing classifies.
export function classifyNewsDuration(matchedRules: string[]): { read: string; why: string; bucket: DurationBucket } {
  let bucket: DurationBucket = "temporary";
  for (const r of matchedRules) {
    const b = DURATION_BY_RULE[r];
    if (b === "structural") return { read: DURATION_LABEL.structural, why: DURATION_WHY.structural, bucket: "structural" };
    if (b === "days") bucket = "days";
  }
  return { read: DURATION_LABEL[bucket], why: DURATION_WHY[bucket], bucket };
}

export function leanFromScore(score: number): WhyLean {
  if (score > 0.5) return "bullish";
  if (score < -0.5) return "bearish";
  return "neutral";
}
