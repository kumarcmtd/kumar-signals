// Shared by the Ai-Chart canvas, its legend and the page.

import type { LineWidth, UTCTimestamp } from "lightweight-charts";

const IST_S = 19_800;
/** Chart time for a moment: shifted to IST so the axis reads Indian time. */
export const chartTime = (ms: number) => (Math.floor(ms / 1000) + IST_S) as UTCTimestamp;

/** Strong support thick green, weak support yellow, strong rejection thick red, weak rejection pink. */
export const LEVEL_STYLE = {
  "support-strong": { color: "#15803D", width: 4 as LineWidth, title: "S" },
  "support-weak": { color: "#EAB308", width: 2 as LineWidth, title: "s" },
  "resistance-strong": { color: "#DC2626", width: 4 as LineWidth, title: "R" },
  "resistance-weak": { color: "#F472B6", width: 2 as LineWidth, title: "r" },
} as const;
