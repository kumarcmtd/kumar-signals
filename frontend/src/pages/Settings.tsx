import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, Globe2, ChevronRight } from "lucide-react";

export function Settings() {
  return (
    <div className="space-y-4">
      <SettingsGroup title="More pages">
        <Link to="/prices" className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <LayoutGrid size={16} className="text-[var(--color-muted)]" /> Live Prices (all instruments)
          </span>
          <ChevronRight size={16} className="text-[var(--color-muted)]" />
        </Link>
        <Link to="/global" className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <Globe2 size={16} className="text-[var(--color-muted)]" /> Global Markets (WTI/Brent/Henry Hub)
          </span>
          <ChevronRight size={16} className="text-[var(--color-muted)]" />
        </Link>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" value="Light (premium)" />
      </SettingsGroup>

      <SettingsGroup title="Account">
        <SettingsRow label="Broker Settings" value="Not connected" note="Coming soon" />
        <SettingsRow label="API Configuration" value="Uses main worker's KV token" />
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <SettingsRow label="Push Notifications" value="Not configured" note="Coming soon" />
        <SettingsRow label="Telegram Alerts" value="Planned" note="Future" />
        <SettingsRow label="WhatsApp Alerts" value="Planned" note="Future" />
        <SettingsRow label="Voice Alerts" value="Planned" note="Future" />
      </SettingsGroup>

      <SettingsGroup title="Trading (future)">
        <SettingsRow label="Broker Order Placement" value="Not connected" note="Future" />
        <SettingsRow label="Auto Trading" value="Not enabled" note="Future" />
        <SettingsRow label="Paper Trading Mode" value="Not enabled" note="Future" />
        <SettingsRow label="Strategy Builder" value="Not available" note="Future" />
        <SettingsRow label="Backtesting" value="Not available" note="Future" />
      </SettingsGroup>

      <SettingsGroup title="About">
        <SettingsRow label="Version" value="0.1.0 (early build)" />
        <SettingsRow label="Disclaimer" value="Educational use only, not financial advice" />
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase text-[var(--color-muted)]">{title}</p>
      <div className="divide-y divide-[var(--color-border)]">{children}</div>
    </div>
  );
}

function SettingsRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm">{label}</span>
      <span className="text-sm text-[var(--color-muted)] flex items-center gap-2">
        {value}
        {note && <span className="text-[10px] bg-[var(--color-warn-soft)] text-amber-800 px-2 py-0.5 rounded-full">{note}</span>}
      </span>
    </div>
  );
}
