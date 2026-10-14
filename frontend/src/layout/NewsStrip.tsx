// News first on AI-Shoot: in war-time crude, headlines move price before any
// indicator does, so the news card sits above everything else on that tab.

import { useLocation } from "react-router-dom";
import { NewsSnapshotCard } from "../components/news/NewsSnapshotCard";

export function NewsStrip() {
  const { pathname } = useLocation();
  if (pathname !== "/") return null;
  return (
    <div className="mb-4">
      <NewsSnapshotCard />
    </div>
  );
}
