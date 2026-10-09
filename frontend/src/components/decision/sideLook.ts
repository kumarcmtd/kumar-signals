// One colour language for AI Verify Pro, by SIDE and STAGE:
//   CE (bullish) = green, PE (bearish) = red,
//   and the deeper the colour, the further along the call is:
//   leaning (WAIT with a lean) -> light, setup forming -> medium, BUY -> deep.
// No lean is neutral grey; the EIA wait and market-closed keep their own look.

import { TrendingUp, TrendingDown, Hourglass, PauseCircle, Moon, Zap } from "lucide-react";
import type { DecisionResult } from "../../utils/buyDecisionEngine";

export interface SideLook {
  label: string;
  /** "▲ CE side · leaning" etc; null when there is no side. */
  tag: string | null;
  from: string;
  to: string;
  /** Light background: use dark ink instead of white. */
  light: boolean;
  ink: string; // main text colour
  Icon: typeof TrendingUp;
  stage: 0 | 1 | 2 | 3; // 0 none, 1 leaning, 2 forming, 3 buy
}

const CE = {
  1: { from: "#ECFDF5", to: "#BBF7D0", ink: "#065F46" },
  2: { from: "#059669", to: "#34D399", ink: "#FFFFFF" },
  3: { from: "#064E3B", to: "#059669", ink: "#FFFFFF" },
};
const PE = {
  1: { from: "#FFF1F2", to: "#FECDD3", ink: "#9F1239" },
  2: { from: "#E11D48", to: "#FB7185", ink: "#FFFFFF" },
  3: { from: "#881337", to: "#E11D48", ink: "#FFFFFF" },
};

export function sideLook(r: Pick<DecisionResult, "verdict" | "side">): SideLook {
  const v = r.verdict;
  if (v === "EVENT_WAIT") return { label: "WAIT — EIA REPORT", tag: null, from: "#7C2D12", to: "#EA580C", light: false, ink: "#FFFFFF", Icon: Zap, stage: 0 };
  if (v === "CLOSED") return { label: "MARKET CLOSED", tag: null, from: "#0F172A", to: "#334155", light: false, ink: "#FFFFFF", Icon: Moon, stage: 0 };

  const side = v === "BUY_CE" || v === "FORMING_CE" ? "CE" : v === "BUY_PE" || v === "FORMING_PE" ? "PE" : r.side;
  const stage: SideLook["stage"] = v === "BUY_CE" || v === "BUY_PE" ? 3 : v === "FORMING_CE" || v === "FORMING_PE" ? 2 : side ? 1 : 0;
  if (!side || stage === 0) {
    return { label: "WAIT", tag: "No side yet", from: "#F1F5F9", to: "#E2E8F0", light: true, ink: "#334155", Icon: PauseCircle, stage: 0 };
  }
  const c = (side === "CE" ? CE : PE)[stage];
  const arrow = side === "CE" ? "▲ CE side (bullish)" : "▼ PE side (bearish)";
  const label = stage === 3 ? `BUY ${side}` : stage === 2 ? `${side} SETUP FORMING` : `WAIT · leaning ${side}`;
  const Icon = stage === 3 ? (side === "CE" ? TrendingUp : TrendingDown) : stage === 2 ? Hourglass : PauseCircle;
  return { label, tag: `${arrow} · ${stage === 3 ? "confirmed" : stage === 2 ? "forming" : "early lean"}`, from: c.from, to: c.to, light: stage === 1, ink: c.ink, Icon, stage };
}
