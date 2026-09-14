// The auto-update control for pages outside the six main tabs.
//
// Those pages load once when opened and then hold still, which saves Upstox
// rate limit, Worker invocations and battery. That is only acceptable if the
// user can SEE that the page is holding still and can update it in one tap --
// a silently frozen price screen would be far worse than a slow one.
//
// So this strip says plainly which mode the current page is in, when it last
// updated, and gives one button to update now plus a switch to keep a page
// live for the rest of the session.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Pause, Radio } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { isAlwaysLivePage } from "../config/livePages";

function agoLabel(since: number | null, now: number): string {
  if (since === null) return "";
  const secs = Math.max(0, Math.round((now - since) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

export function LiveControl() {
  const { pathname } = useLocation();
  const live = useAppStore((s) => s.liveOnOtherPages);
  const setLive = useAppStore((s) => s.setLiveOnOtherPages);
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setTick] = useState(0);

  // Every page records when it finished loading, so "updated 4 min ago" is
  // real rather than a guess -- including the first automatic load on open.
  useEffect(() => {
    if (fetching === 0 && lastUpdated === null) setLastUpdated(Date.now());
    if (fetching > 0) setLastUpdated(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching]);

  // Reset the stamp when the route changes -- the previous page's timing says
  // nothing about this one.
  useEffect(() => {
    setLastUpdated(null);
  }, [pathname]);

  // Keeps the "x min ago" honest between fetches.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // The six main tabs manage themselves; no control is shown there.
  if (isAlwaysLivePage(pathname)) return null;

  const busy = fetching > 0;
  const ago = agoLabel(lastUpdated, Date.now());

  return (
    <div className="max-w-lg mx-auto px-4 pb-2 -mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => setLive(!live)}
        aria-pressed={live}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors shrink-0"
        style={
          live
            ? { background: "color-mix(in srgb, var(--color-buy) 14%, transparent)", color: "var(--color-buy)" }
            : { background: "var(--color-surface-soft)", color: "var(--color-muted)" }
        }
      >
        {live ? <Radio size={11} /> : <Pause size={11} />}
        {live ? "Auto-update ON" : "Auto-update OFF"}
      </button>

      <span className="text-[10px] text-[var(--color-muted)] truncate min-w-0">
        {busy ? "Updating…" : live ? "This page keeps refreshing" : ago ? `Updated ${ago}` : "Tap Update for fresh data"}
      </span>

      <button
        type="button"
        onClick={() => {
          setLastUpdated(null);
          // Refetches only what this page is actually showing, not all ~25
          // pages' worth of cached queries.
          void queryClient.refetchQueries({ type: "active" });
        }}
        disabled={busy}
        className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0 disabled:opacity-50"
        style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}
      >
        <RefreshCw size={11} className={busy ? "motion-safe:animate-spin" : ""} />
        Update
      </button>
    </div>
  );
}
