// The Trade Card (one answer per market) on AI-Shoot, Best Call and AI-Up.
//
// Rendered once here in the shell, like PullbackStrip, so the pages
// themselves stay untouched. Ai20-20 and Ai-Trust carry their own Trade Card
// views, and Ai-Today has its own one-market plan -- a second verdict on top
// of that plan would only argue with it.

import { useLocation } from "react-router-dom";
import { TradeCard } from "../components/TradeCard";

// Listed by page, not by bottom-bar position: when Ai-Today took AI-Up's tab,
// the card stayed with AI-Up instead of jumping onto Ai-Today.
export const TRADE_CARD_STRIP_PAGES = ["/", "/best-call", "/ai-up"] as const;
const SHOWN_ON = new Set<string>(TRADE_CARD_STRIP_PAGES);

export function AiVerifyStrip() {
  const { pathname } = useLocation();
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!SHOWN_ON.has(clean)) return null;
  return (
    <div className="mb-4">
      <TradeCard />
    </div>
  );
}
