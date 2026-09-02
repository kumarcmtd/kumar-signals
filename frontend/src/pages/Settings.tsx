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

      <ClearStaleCalls />

      <SettingsGroup title="About">
        <SettingsRow label="Version" value="0.1.0 (early build)" />
        <SettingsRow label="Disclaimer" value="Educational use only, not financial advice" />
      </SettingsGroup>
    </div>
  );
}

const CLEAR_STALE_PASSWORD = "SHANVI";

function istDayStartMs(): number {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${ymd}T00:00:00+05:30`).getTime();
}

// One password-gated button that closes every still-running call left over
// from a previous day, across all pages. Each is booked at its entry (no fake
// profit/loss). Password is a soft accidental-tap guard, not real security
// (this is a public client bundle) -- same SHANVI guard the Force Stop uses.
function ClearStaleCalls() {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const clearStaleTradeLogs = useAppStore((s) => s.clearStaleTradeLogs);
  const [status, setStatus] = useState<string | null>(null);

  const dayStart = istDayStartMs();
  const staleCount = Object.values(tradeLogs).filter((h) => {
    const last = h[h.length - 1];
    return last && !last.closed && last.openedAt < dayStart;
  }).length;

  const handleClear = () => {
    if (staleCount === 0) {
      setStatus("No leftover calls from earlier days — everything running is from today.");
      return;
    }
    const pw = window.prompt(`Enter password to clear ${staleCount} still-running call${staleCount > 1 ? "s" : ""} from earlier days:`);
    if (pw === null) return;
    if (pw !== CLEAR_STALE_PASSWORD) {
      setStatus("Incorrect password — nothing was cleared.");
      return;
    }
    const cleared = clearStaleTradeLogs();
    setStatus(cleared > 0 ? `Cleared ${cleared} leftover call${cleared > 1 ? "s" : ""} from earlier days. Today's calls are untouched.` : "Nothing to clear.");
  };

  return (
    <SettingsGroup title="Maintenance">
      <div className="px-4 py-3.5">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Trash2 size={16} className="text-rose-500" /> Clear old running calls
        </p>
        <p className="text-[11px] text-[var(--color-muted)] mt-1 leading-snug">
          Closes every call still marked "running" that was opened on an earlier day (a stale leftover), across every page at once. Today's live calls are never touched. Each is booked at its
          entry — no fake profit or loss.
        </p>
        <p className="text-[12px] mt-2">
          {staleCount > 0 ? (
            <span className="font-bold text-rose-600">{staleCount} leftover call{staleCount > 1 ? "s" : ""} from earlier days</span>
          ) : (
            <span className="text-[var(--color-muted)]">No leftover calls right now</span>
          )}
        </p>
        <button
          onClick={handleClear}
          className="mt-2.5 w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: staleCount > 0 ? "linear-gradient(135deg,#F43F5E,#DC2626)" : "#94A3B8" }}
        >
          Clear {staleCount > 0 ? staleCount : ""} Old Running Call{staleCount === 1 ? "" : "s"}
        </button>
        {status && <p className="text-[11px] mt-2 text-[var(--color-muted)]">{status}</p>}
      </div>
    </SettingsGroup>
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
