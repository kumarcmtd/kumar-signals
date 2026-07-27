import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, Globe2, ListTree, Bell, ChevronRight, Smartphone, Send, Trash2 } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { notificationPermission } from "../utils/notify";
import { useNtfyTopic, useSaveNtfyTopic, useDeleteNtfyTopic, useSendTestNotification, useCheckNotificationsNow } from "../api/hooks";

export function Settings() {
  const alertSettings = useAppStore((s) => s.alertSettings);
  const permission = notificationPermission();

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
        <Link to="/options" className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <ListTree size={16} className="text-[var(--color-muted)]" /> Options Analytics
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
        <Link to="/alerts" className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <Bell size={16} className="text-[var(--color-muted)]" /> In-App &amp; Browser Alerts
          </span>
          <span className="text-sm text-[var(--color-muted)] flex items-center gap-2">
            {alertSettings.enabled ? (permission === "granted" && alertSettings.browserNotifications ? "On (browser + in-app)" : "On (in-app)") : "Off"}
            <ChevronRight size={16} />
          </span>
        </Link>
        <SettingsRow label="Telegram Alerts" value="Planned" note="Future" />
        <SettingsRow label="WhatsApp Alerts" value="Planned" note="Future" />
        <SettingsRow label="Voice Alerts" value="Planned" note="Future" />
      </SettingsGroup>

      <NtfyPushSetup />

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

function randomTopic(): string {
  return `kumar-signals-${Math.random().toString(36).slice(2, 8)}`;
}

// True background push -- delivers even with this site fully closed --
// built on ntfy.sh (a free, no-signup push relay: the server just POSTs to a
// topic URL) instead of the raw browser Web Push protocol, which would need
// per-device VAPID/AES-GCM crypto that can't be verified end-to-end from a
// dev sandbox. A Cloudflare Cron Trigger checks Best Call every 5 minutes
// server-side and posts to this topic whenever the pick changes.
function NtfyPushSetup() {
  const { data, isLoading } = useNtfyTopic();
  const saveTopic = useSaveNtfyTopic();
  const deleteTopic = useDeleteNtfyTopic();
  const sendTest = useSendTestNotification();
  const checkNow = useCheckNotificationsNow();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (data?.topic) setTopic(data.topic);
  }, [data?.topic]);

  const savedTopic = data?.topic ?? null;

  return (
    <div className="card overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase text-[var(--color-muted)]">Background Push (works with app closed)</p>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
          Uses <span className="font-semibold">ntfy.sh</span>, a free push relay with no account needed. A server-side check runs every
          5 minutes and sends a notification here whenever Best Call opens a new pick — even with this site fully closed.
        </p>

        {!isLoading && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder={randomTopic()}
                className="flex-1 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
              />
              <button
                disabled={!topic || saveTopic.isPending}
                onClick={() => {
                  saveTopic.mutate(topic, {
                    onSuccess: () => setStatus("Saved. Now subscribe to this exact topic in the ntfy app or browser."),
                    onError: (e) => setStatus(e instanceof Error ? e.message : "Failed to save"),
                  });
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[var(--color-primary)] disabled:opacity-50"
              >
                Save
              </button>
            </div>

            {savedTopic && (
              <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2.5 space-y-2">
                <p className="text-xs">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Smartphone size={13} /> Subscribed topic: {savedTopic}
                  </span>
                </p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  Install the free ntfy app (Android/iOS) or open <code className="text-[10px]">ntfy.sh/{savedTopic}</code> in a browser
                  tab, and subscribe to this exact topic name to start receiving alerts.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    disabled={sendTest.isPending}
                    onClick={() => {
                      sendTest.mutate(undefined, {
                        onSuccess: () => setStatus("Test sent — check your ntfy app/tab now."),
                        onError: (e) => setStatus(e instanceof Error ? e.message : "Test failed"),
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white border border-[var(--color-border)]"
                  >
                    <Send size={12} /> Send test
                  </button>
                  <button
                    disabled={checkNow.isPending}
                    onClick={() => {
                      checkNow.mutate(undefined, {
                        onSuccess: () => setStatus("Checked now — you'll get a push only if a real Best Call is currently open."),
                        onError: (e) => setStatus(e instanceof Error ? e.message : "Check failed"),
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white border border-[var(--color-border)]"
                  >
                    Check now
                  </button>
                  <button
                    disabled={deleteTopic.isPending}
                    onClick={() => {
                      deleteTopic.mutate(undefined, { onSuccess: () => setStatus("Removed.") });
                      setTopic("");
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--color-sell)] bg-white border border-[var(--color-border)]"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            )}

            {status && <p className="text-[11px] text-[var(--color-primary)]">{status}</p>}
          </>
        )}
      </div>
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
