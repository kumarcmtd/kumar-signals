import { useMemo, useState } from "react";
import { Bell, BellRing, Trash2, CheckCheck, Volume2, VolumeX, TrendingUp, TrendingDown, Radar, ShieldCheck, FlaskConical } from "lucide-react";
import { useAppStore, type AlertEntry, type AlertSource } from "../store/appStore";
import { notificationPermission, requestNotificationPermission } from "../utils/notify";

const SOURCE_STYLE: Record<AlertSource, { label: string; icon: typeof FlaskConical; bg: string; text: string }> = {
  Timeframe: { label: "AI-Test V2 / Pro", icon: FlaskConical, bg: "#DBEAFE", text: "#1D4ED8" },
  Elite: { label: "AI Elite", icon: ShieldCheck, bg: "#EDE9FE", text: "#6D28D9" },
  Kimi: { label: "Kimi AI Playbook", icon: Radar, bg: "#DCFCE7", text: "#15803D" },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

export function Alerts() {
  const alerts = useAppStore((s) => s.alerts);
  const markAlertRead = useAppStore((s) => s.markAlertRead);
  const markAllAlertsRead = useAppStore((s) => s.markAllAlertsRead);
  const clearAlerts = useAppStore((s) => s.clearAlerts);
  const alertSettings = useAppStore((s) => s.alertSettings);
  const setAlertSettings = useAppStore((s) => s.setAlertSettings);
  const setAlertSources = useAppStore((s) => s.setAlertSources);

  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [permission, setPermission] = useState(notificationPermission());

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);
  const visible = filter === "unread" ? alerts.filter((a) => !a.read) : alerts;

  async function handleEnableBrowserNotifications() {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") setAlertSettings({ browserNotifications: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Bell size={20} className="text-[var(--color-primary)]" /> Alerts
        </h1>
        {unreadCount > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[var(--color-sell-soft)] text-[var(--color-sell)]">{unreadCount} new</span>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs font-bold uppercase text-[var(--color-muted)]">Alert Settings</p>

        <ToggleRow
          label="Alerts enabled"
          note="Master switch — turns the whole engine on/off"
          checked={alertSettings.enabled}
          onChange={(v) => setAlertSettings({ enabled: v })}
        />

        <div className="flex items-center justify-between py-1.5">
          <div>
            <p className="text-sm">Browser notifications</p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {permission === "unsupported" ? "Not supported in this browser" : permission === "granted" ? "Enabled" : permission === "denied" ? "Blocked — allow notifications in browser settings" : "Needs permission"}
            </p>
          </div>
          {permission === "granted" ? (
            <ToggleSwitch checked={alertSettings.browserNotifications} onChange={(v) => setAlertSettings({ browserNotifications: v })} />
          ) : permission === "unsupported" ? (
            <span className="text-[11px] text-[var(--color-muted)]">—</span>
          ) : (
            <button onClick={handleEnableBrowserNotifications} className="flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] px-2.5 py-1.5 rounded-lg bg-blue-50">
              <BellRing size={13} /> Enable
            </button>
          )}
        </div>

        <ToggleRow
          label="Sound on new alert"
          icon={alertSettings.soundEnabled ? Volume2 : VolumeX}
          checked={alertSettings.soundEnabled}
          onChange={(v) => setAlertSettings({ soundEnabled: v })}
        />

        <div className="py-1.5">
          <p className="text-sm mb-1.5">Sensitivity</p>
          <div className="flex gap-2">
            <button
              onClick={() => setAlertSettings({ minTier: "strong" })}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg border ${alertSettings.minTier === "strong" ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
            >
              Strong only
            </button>
            <button
              onClick={() => setAlertSettings({ minTier: "all" })}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg border ${alertSettings.minTier === "all" ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
            >
              All tiers (noisier)
            </button>
          </div>
        </div>

        <div className="pt-1 space-y-1">
          <p className="text-sm mb-1">Sources</p>
          <ToggleRow label="AI-Test V2 / Pro (timeframe signals)" checked={alertSettings.sources.timeframe} onChange={(v) => setAlertSources({ timeframe: v })} compact />
          <ToggleRow label="AI Elite (strict confluence)" checked={alertSettings.sources.elite} onChange={(v) => setAlertSources({ elite: v })} compact />
          <ToggleRow label="Kimi AI (playbook setups)" checked={alertSettings.sources.kimi} onChange={(v) => setAlertSources({ kimi: v })} compact />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${filter === "all" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]"}`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${filter === "unread" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]"}`}
          >
            Unread ({unreadCount})
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={markAllAlertsRead} title="Mark all read" className="p-2 rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]">
            <CheckCheck size={16} />
          </button>
          <button onClick={clearAlerts} title="Clear all" className="p-2 rounded-lg text-[var(--color-sell)] hover:bg-[var(--color-surface-soft)]">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--color-muted)]">
          <Bell size={28} className="mx-auto mb-2 opacity-40" />
          {alerts.length === 0 ? "No alerts yet — they'll appear here the moment a signal fires on AI-Test V2/Pro, AI Elite, or Kimi AI." : "No unread alerts."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((a) => (
            <AlertRow key={a.id} alert={a} onRead={() => markAlertRead(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert, onRead }: { alert: AlertEntry; onRead: () => void }) {
  const style = SOURCE_STYLE[alert.source];
  const Icon = style.icon;
  const isBearish = alert.title.includes("SELL") || alert.title.includes("PE");
  const DirIcon = isBearish ? TrendingDown : TrendingUp;
  return (
    <button onClick={onRead} className={`card p-3 w-full text-left flex gap-3 ${alert.read ? "opacity-60" : ""}`}>
      <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: style.bg }}>
        <Icon size={16} style={{ color: style.text }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold truncate">{alert.title}</p>
          {!alert.read && <span className="shrink-0 w-2 h-2 rounded-full bg-[var(--color-sell)]" />}
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-2">{alert.detail}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: style.bg, color: style.text }}>
            {style.label}
          </span>
          <span className="text-[10px] text-[var(--color-muted)] flex items-center gap-1">
            <DirIcon size={10} /> {formatTime(alert.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function ToggleRow({
  label,
  note,
  icon: Icon,
  checked,
  onChange,
  compact,
}: {
  label: string;
  note?: string;
  icon?: typeof Volume2;
  checked: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${compact ? "py-1" : "py-1.5"}`}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={14} className="text-[var(--color-muted)]" />}
        <div>
          <p className="text-sm">{label}</p>
          {note && <p className="text-[11px] text-[var(--color-muted)]">{note}</p>}
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ${checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`}
      style={{ height: "22px" }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(0)" }}
      />
    </button>
  );
}
