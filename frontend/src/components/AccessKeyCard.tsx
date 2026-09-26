import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { api, readAccessKey, saveAccessKey } from "../api/client";

type Status = { keyConfigured: boolean; keyAccepted: boolean } | null;

/**
 * The owner key for this device.
 *
 * The server holds the real key as a Cloudflare secret; this phone holds its
 * own copy, typed in here once. It is never part of the app's code, so nobody
 * who opens the site can read it -- which is exactly what was wrong with the
 * old force-stop password.
 */
export function AccessKeyCard() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<boolean>(() => readAccessKey() !== null);
  const [status, setStatus] = useState<Status>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await api.authStatus());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const save = async () => {
    saveAccessKey(value);
    setSaved(readAccessKey() !== null);
    setValue("");
    await check();
  };

  const clear = async () => {
    saveAccessKey(null);
    setSaved(false);
    await check();
  };

  let tone = { bg: "#F8FAFC", border: "#E2E8F0", ink: "#475569", Icon: ShieldOff, text: "Checking…" };
  if (status && !status.keyConfigured) {
    tone = { bg: "#FFFBEB", border: "#FDE68A", ink: "#B45309", Icon: ShieldOff, text: "Protection is OFF — no key is set on the server yet, so anyone with the link can change your data." };
  } else if (status && status.keyAccepted) {
    tone = { bg: "#F0FDF4", border: "#BBF7D0", ink: "#15803D", Icon: ShieldCheck, text: "Protected, and this phone's key is accepted." };
  } else if (status) {
    tone = {
      bg: "#FEF2F2",
      border: "#FECACA",
      ink: "#B91C1C",
      Icon: ShieldAlert,
      text: saved ? "Protected, but the key saved on this phone is wrong. Saving, syncing and alerts will fail until it matches." : "Protected — enter your key below so this phone can save trades and settings.",
    };
  }

  return (
    <div className="card overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase text-[var(--color-muted)]">App access key</p>
      <div className="px-4 py-3 space-y-3">
        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
          <tone.Icon size={14} className="shrink-0 mt-0.5" style={{ color: tone.ink }} />
          <p className="text-[10.5px] leading-snug" style={{ color: tone.ink }}>
            {checking && !status ? "Checking…" : tone.text}
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={saved ? "Key saved on this phone" : "Paste your key"}
            className="flex-1 min-w-0 rounded-xl border border-[var(--color-border)] px-3 py-2 text-[12px] bg-white"
          />
          <button
            type="button"
            onClick={save}
            disabled={!value.trim()}
            className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-[12px] font-black text-white bg-[var(--color-primary)] disabled:opacity-40"
          >
            <KeyRound size={13} /> Save
          </button>
        </div>
        {saved && (
          <button type="button" onClick={clear} className="text-[10.5px] font-bold text-slate-500 underline">
            Remove the key from this phone
          </button>
        )}

        <p className="text-[9.5px] text-slate-400 leading-snug">
          The key lives only on this phone and in Cloudflare — it is not in the app's code and is never included in a backup file. Set the same key in Cloudflare under
          Workers → kumar-signals → Settings → Variables and Secrets, as a <b>Secret</b> named <b>APP_ACCESS_KEY</b>.
        </p>
      </div>
    </div>
  );
}
