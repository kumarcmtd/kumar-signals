import { useCandles } from "../api/hooks";
import { detectLevelProximity, type LevelAlert, type LevelAlertKind } from "../utils/levelProximity";
import { TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle } from "lucide-react";

const DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const STYLE: Record<LevelAlertKind, { grad: string; ring: string; text: string; tag: string; Icon: typeof TrendingUp }> = {
  breakout_up: { grad: "linear-gradient(135deg,#16A34A,#059669)", ring: "#16A34A", text: "#065F46", tag: "BREAKOUT", Icon: ArrowUpCircle },
  breakdown: { grad: "linear-gradient(135deg,#DC2626,#B91C1C)", ring: "#DC2626", text: "#7F1D1D", tag: "BREAKDOWN", Icon: ArrowDownCircle },
  near_resistance: { grad: "linear-gradient(135deg,#EA580C,#F59E0B)", ring: "#EA580C", text: "#7C2D12", tag: "RESISTANCE", Icon: TrendingUp },
  near_support: { grad: "linear-gradient(135deg,#0EA5E9,#2563EB)", ring: "#0EA5E9", text: "#0C4A6E", tag: "SUPPORT", Icon: TrendingDown },
};

function AlertBanner({ symbol, alert }: { symbol: string; alert: LevelAlert }) {
  const s = STYLE[alert.kind];
  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ border: `2px solid ${s.ring}` }}>
      <div className="px-3.5 py-2 flex items-center gap-2 text-white" style={{ background: s.grad }}>
        <s.Icon size={18} className="shrink-0 kp-blink" />
        <p className="text-[13px] font-black uppercase tracking-wide kp-blink">
          {DISPLAY_NAME[symbol] ?? symbol} · {alert.headline}
        </p>
        <span className="ml-auto text-[9px] font-black bg-white/25 rounded-full px-2 py-0.5 shrink-0">{s.tag}</span>
      </div>
      <div className="px-3.5 py-2.5" style={{ background: `${s.ring}0D` }}>
        <p className="text-[11px] leading-snug" style={{ color: s.text }}>
          {alert.detail}
        </p>
        <p className="text-[10px] mt-1 font-semibold" style={{ color: s.ring }}>
          {alert.distancePct}% away · level tested {alert.touches}× · catch it early
        </p>
      </div>
    </div>
  );
}

// One blinking early-warning strip, shown when live Crude/NG price is arriving
// at (or just breaking) a major tested level. Reads the same 1-hour candles the
// rest of the app already caches, so it costs nothing extra and stays in sync.
export function LevelProximityWarning() {
  const crude = useCandles("CRUDEOIL", "60");
  const ng = useCandles("NATURALGAS", "60");

  const alerts: { symbol: string; alert: LevelAlert }[] = [];
  const crudeAlert = crude.data ? detectLevelProximity(crude.data.candles) : null;
  const ngAlert = ng.data ? detectLevelProximity(ng.data.candles) : null;
  if (crudeAlert) alerts.push({ symbol: "CRUDEOIL", alert: crudeAlert });
  if (ngAlert) alerts.push({ symbol: "NATURALGAS", alert: ngAlert });

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      <style>{`@keyframes kpBlink{0%,100%{opacity:1}50%{opacity:.35}}.kp-blink{animation:kpBlink 1s steps(1,end) infinite}@media (prefers-reduced-motion:reduce){.kp-blink{animation:none}}`}</style>
      {alerts.map(({ symbol, alert }) => (
        <AlertBanner key={symbol} symbol={symbol} alert={alert} />
      ))}
    </div>
  );
}
