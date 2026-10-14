// When was the news last scanned, and a "Scan now" button.
// Some headlines need to be known immediately -- to catch a rally or to get
// out before a stop is hit -- so the trader can force a fresh scan of every
// source instead of waiting for the automatic one (every 5 minutes). If the
// automatic scan has stopped, this says so plainly.

import { useEffect, useState } from "react";
import { RefreshCw, Radar, TriangleAlert } from "lucide-react";
import { useNewsFeed, useScanNewsNow } from "../../api/hooks";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

export function NewsScanBar({ compact = false }: { compact?: boolean }) {
  const feed = useNewsFeed();
  const scan = useScanNewsNow();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const last = feed.data?.lastScan;
  const at = last?.at ?? feed.data?.builtAt ?? null;
  const age = at ? Date.now() - Date.parse(at) : null;
  const stuck = age !== null && age > 15 * 60_000;

  return (
    <div className="rounded-2xl px-3 py-2 space-y-1" style={{ background: stuck ? "#FEF2F2" : "#EEF2FF", border: `1px solid ${stuck ? "#FECACA" : "#C7D2FE"}` }}>
      <div className="flex items-center gap-2">
        <Radar size={compact ? 14 : 16} className={stuck ? "text-rose-600" : "text-indigo-600"} />
        <div className="min-w-0 flex-1">
          <p className={`${compact ? "text-[12px]" : "text-[13px]"} font-black text-slate-800`}>
            Last scanned: {at ? `${stamp(at)} · ${ago(age!)}` : "not yet"}
          </p>
          {!compact && last && (
            <p className="text-[11px] text-slate-500">
              {last.trigger === "manual" ? "Scan now" : "Automatic, every 5 min"} · {last.sourcesOk}/{last.sourcesTotal} sources answered · {last.articles} stories
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="shrink-0 rounded-xl px-3 py-2 text-[12.5px] font-black text-white flex items-center gap-1.5 disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}
        >
          <RefreshCw size={13} className={scan.isPending ? "motion-safe:animate-spin" : ""} />
          {scan.isPending ? "Scanning…" : "Scan now"}
        </button>
      </div>
      {stuck && (
        <p className="text-[11.5px] font-bold text-rose-700 flex items-center gap-1">
          <TriangleAlert size={12} /> The automatic scan hasn't run for {ago(age!)} — tap Scan now.
        </p>
      )}
      {scan.isError && <p className="text-[11.5px] font-bold text-rose-700">{(scan.error as Error).message}</p>}
      {scan.isSuccess && !scan.isPending && <p className="text-[11px] font-bold text-emerald-700">Scanned every source — showing the newest news.</p>}
    </div>
  );
}
