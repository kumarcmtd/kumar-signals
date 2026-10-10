import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Smartphone, CheckCircle2, AlertTriangle, Send, MonitorSmartphone, Copy } from "lucide-react";
import { useNtfyTopic, useSendTestNotification } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { keepScreenOnSupported } from "../hooks/useKeepScreenOn";

// Why in-app alerts go quiet on a locked phone, and the two ways round it.
//
// A locked phone freezes this web page -- timers stop and no sound may start
// -- so the in-app alert engine cannot fire. That is the phone's rule, not a
// bug. The alerts that DO reach a locked phone are the ones the SERVER sends
// through ntfy (MATCHED Ai20-20 + AI Verify calls, and Best Call), at "urgent" priority.
export function LockedAlertsCard() {
  const { data } = useNtfyTopic();
  const test = useSendTestNotification();
  const keepScreenOn = useAppStore((s) => s.alertSettings.keepScreenOn ?? false);
  const setAlertSettings = useAppStore((s) => s.setAlertSettings);
  const [copied, setCopied] = useState(false);
  const topic = data?.topic ?? null;
  const wakeSupported = keepScreenOnSupported();

  return (
    <div className="card p-4 space-y-3" style={{ borderLeft: "4px solid #7C3AED" }}>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#7C3AED,#4F46E5)" }}>
          <Lock size={15} />
        </span>
        <div>
          <p className="text-[13px] font-black">Alerts with the phone locked</p>
          <p className="text-[10.5px] text-[var(--color-muted)]">Read this once — it decides whether an alert reaches you.</p>
        </div>
      </div>

      <p className="text-[11.5px] leading-snug text-slate-700">
        When the phone locks, Android freezes this web page, so the ringtone above <b>cannot</b> play. That is the phone's rule, not a bug. Alerts that
        reach a locked phone come from the <b>server</b> through the free <b>ntfy</b> app as <b>urgent</b>: Best Call calls, and <b>MATCHED</b> calls —
        an Ai20-20 call only when AI Verify Pro has confirmed the same side (BUY) and the live candle is not turning against it.
      </p>

      <div className="rounded-xl p-3 space-y-2" style={{ background: topic ? "#ECFDF5" : "#FEF2F2" }}>
        <p className="text-[11.5px] font-bold flex items-center gap-1.5" style={{ color: topic ? "#047857" : "#B91C1C" }}>
          {topic ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {topic ? "Push topic saved" : "No push topic saved — locked-phone alerts are OFF"}
        </p>
        {topic ? (
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(topic).then(() => setCopied(true));
            }}
            className="w-full flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-800"
          >
            <span className="truncate">{topic}</span>
            <span className="flex items-center gap-1 text-[10.5px] text-indigo-600 shrink-0">
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </span>
          </button>
        ) : (
          <Link to="/settings" className="block text-[11.5px] font-bold text-indigo-600 underline">Set a topic in Settings →</Link>
        )}
      </div>

      <div>
        <p className="text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1.5">
          <Smartphone size={13} /> One-time phone setup
        </p>
        <ol className="text-[11.5px] text-slate-700 space-y-1 list-decimal pl-5 leading-snug">
          <li>Install <b>ntfy</b> from the Play Store (free).</li>
          <li>Tap <b>+</b> and subscribe to the topic above (copy it here, paste it there).</li>
          <li>
            In ntfy's settings, turn on <b>Insistent max priority</b> if your version has it — urgent alerts then keep ringing until you tap them.
          </li>
          <li>Set your ringtone as the sound for ntfy's <b>max priority</b> notifications (Android notification settings for ntfy).</li>
          <li>
            In Android settings → Apps → ntfy → <b>Battery</b>, choose <b>Unrestricted</b> / don't optimise. Otherwise the phone may delay alerts
            while locked.
          </li>
          <li>Tap <b>Send test push</b> below, lock the phone, and check it rings.</li>
        </ol>
      </div>

      <button
        disabled={!topic || test.isPending}
        onClick={() => test.mutate()}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-lg text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)" }}
      >
        <Send size={13} /> {test.isPending ? "Sending…" : "Send test push (urgent)"}
      </button>
      {test.isSuccess && <p className="text-[11px] font-bold text-emerald-700">Sent — it should ring on your phone within seconds.</p>}
      {test.isError && <p className="text-[11px] font-bold text-rose-700">{(test.error as Error).message}</p>}

      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold flex items-center gap-1.5">
              <MonitorSmartphone size={14} /> Keep screen on while the app is open
            </p>
            <p className="text-[10.5px] text-[var(--color-muted)] leading-snug">
              {wakeSupported
                ? "For desk trading with the phone charging: the screen won't lock, so in-app alerts and your ringtone keep working. Uses more battery."
                : "Not supported by this browser — use ntfy for locked-phone alerts."}
            </p>
          </div>
          <button
            disabled={!wakeSupported}
            onClick={() => setAlertSettings({ keepScreenOn: !keepScreenOn })}
            aria-pressed={keepScreenOn}
            className="relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40"
            style={{ background: keepScreenOn ? "var(--color-primary)" : "#CBD5E1" }}
          >
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: keepScreenOn ? 22 : 2 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
