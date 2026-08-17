import { AlarmClock } from "lucide-react";
import { useExpiryAlerts } from "../api/hooks";

// MCX options bleed theta and liquidity fast in their final couple of
// sessions -- this is a plain, hard-to-miss warning once either market's
// REAL listed option expiry (computed server-side, see worker.ts's
// computeExpiryAlerts) is 2 days away or closer, so open trades get closed
// or rolled in time instead of getting stuck. Renders nothing at all when
// no market is within that window -- never a stale/fabricated warning.
export function ExpiryAlertBanner() {
  const { data } = useExpiryAlerts();
  const alerts = data?.alerts ?? [];
  if (!alerts.length) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const urgent = a.daysLeft <= 0;
        const color = urgent ? "#DC2626" : a.daysLeft === 1 ? "#EA580C" : "#CA8A04";
        const daysLabel = urgent ? "TODAY" : a.daysLeft === 1 ? "Tomorrow" : `${a.daysLeft} days`;
        return (
          <div key={a.symbol} className="rounded-2xl p-3.5 flex items-start gap-2.5" style={{ background: `${color}12`, border: `1px solid ${color}44` }}>
            <AlarmClock size={18} style={{ color }} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide" style={{ color }}>
                {a.displayName} expiry: {daysLabel}
              </p>
              <p className="text-xs text-slate-600 mt-0.5 leading-snug">{a.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
