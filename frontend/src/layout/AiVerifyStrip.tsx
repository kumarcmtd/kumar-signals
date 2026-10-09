// The AI Verify Pro quick-look card on the first five bottom-bar tabs.
//
// Rendered once here in the shell, like PullbackStrip, so the pages
// themselves stay untouched. Ai20-20 already shows the card inside its own
// layout (below the volatility meters), so it is skipped here to avoid
// showing it twice.

import { useLocation } from "react-router-dom";
import { LIVE_PAGE_PATHS } from "../config/livePages";
import { AiVerifyQuickCard } from "../components/AiVerifyQuickCard";

const SHOWN_ON = new Set<string>(LIVE_PAGE_PATHS.slice(0, 5).filter((p) => p !== "/ai-20-20"));

export function AiVerifyStrip() {
  const { pathname } = useLocation();
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!SHOWN_ON.has(clean)) return null;
  return (
    <div className="mb-4">
      <AiVerifyQuickCard />
    </div>
  );
}
