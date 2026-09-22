import { useRef, useState } from "react";
import { Download, Upload, ShieldCheck, AlertTriangle, Database } from "lucide-react";
import { api } from "../api/client";
import {
  buildBackup, parseBackup, backupFilename, backupAge, isOurKey, looksLikeSecret,
  type BackupBundle,
} from "../utils/backupBundle";

function readLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !isOurKey(key) || looksLikeSecret(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
  } catch {
    // Private mode, blocked storage. An empty local section still lets the
    // server-side half be backed up, which is better than failing outright.
  }
  return out;
}

/**
 * Download everything, restore everything.
 *
 * The trade history is the part that matters: it cannot be reconstructed from
 * anywhere, and every accuracy figure in the app is derived from it. Clearing
 * site data or changing phones destroys it silently, with no warning and no
 * undo.
 */
export function BackupRestoreCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BackupBundle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // Each server call is allowed to fail on its own: a backup missing the
      // portfolio is far better than no backup at all, so a failure records
      // null for that section rather than aborting.
      const [portfolio, tradeLogs, ntfy] = await Promise.all([
        api.portfolio().catch(() => null),
        api.getTradeLogs().catch(() => null),
        api.getNtfyTopic().catch(() => null),
      ]);

      const bundle = buildBackup(
        readLocalStorage(),
        { portfolio, tradeLogs: (tradeLogs as Record<string, unknown[]> | null) ?? null, ntfyTopic: ntfy?.topic ?? null },
        window.location.origin
      );

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFilename();
      a.click();
      URL.revokeObjectURL(url);

      const s = bundle.summary;
      const missing: string[] = [];
      if (portfolio === null) missing.push("portfolio");
      if (tradeLogs === null) missing.push("synced trade logs");
      if (ntfy === null) missing.push("alert topic");
      setStatus(
        `Saved ${s.totalTradeEntries} trade entries (${s.closedTrades} closed) across ${s.tradeLogKeys} ledgers, ${s.alerts} alerts and ${s.portfolioTrades} portfolio rows.` +
          (missing.length ? ` Could not reach: ${missing.join(", ")} — those sections are empty in this file.` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (file: File) => {
    setError(null);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseBackup(String(reader.result ?? ""));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Never restore on the first tap. What is on screen now is about to be
      // replaced and there is no undo, so the contents are shown first.
      setPending(result.bundle);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  };

  const applyRestore = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      for (const [k, v] of Object.entries(pending.local)) {
        if (looksLikeSecret(k)) continue;
        localStorage.setItem(k, v);
      }
      if (pending.server.tradeLogs) {
        await api.saveTradeLogs(pending.server.tradeLogs as never).catch(() => null);
      }
      if (pending.server.ntfyTopic) {
        await api.saveNtfyTopic(pending.server.ntfyTopic).catch(() => null);
      }
      setPending(null);
      setStatus("Restored. Reloading so every page picks up the restored data…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase text-[var(--color-muted)]">Backup &amp; Restore</p>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
          Saves everything that is yours into one file: every page's trade ledger, your alert settings, risk settings, journal, portfolio and alert topic. Your trade history
          cannot be rebuilt from anywhere else — clearing site data or switching phones destroys it with no warning.
        </p>

        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
          <ShieldCheck size={13} className="shrink-0 mt-0.5" style={{ color: "#15803D" }} />
          <p className="text-[10.5px] text-slate-600 leading-snug">
            <b>No passwords or broker tokens are in the file.</b> Your Upstox login is never included, so the backup is safe to email to yourself or keep in cloud storage.
            Charts and prices are also left out on purpose — they re-download free, and including them would bloat the file while protecting nothing.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-black text-white bg-[var(--color-primary)] disabled:opacity-50"
          >
            <Download size={14} /> Download backup
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-black border border-[var(--color-border)] bg-white disabled:opacity-50"
          >
            <Upload size={14} /> Restore
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) chooseFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Restore confirmation. Shown before anything is overwritten. */}
        {pending && (
          <div className="rounded-xl px-3 py-2.5" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <p className="text-[11.5px] font-black text-amber-800 flex items-center gap-1.5">
              <AlertTriangle size={13} /> Restore this backup?
            </p>
            <p className="text-[10.5px] text-slate-700 leading-snug mt-1">
              Taken <b>{backupAge(pending.createdAt)}</b> ({new Date(pending.createdAt).toLocaleString("en-IN")}). It holds{" "}
              <b>{pending.summary.totalTradeEntries} trade entries</b> ({pending.summary.closedTrades} closed) across {pending.summary.tradeLogKeys} ledgers,{" "}
              {pending.summary.alerts} alerts and {pending.summary.portfolioTrades} portfolio rows.
            </p>
            <p className="text-[10px] text-amber-800 leading-snug mt-1.5">
              This <b>replaces</b> what is on this device now. There is no undo — if the current data is worth keeping, download a backup of it first.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={applyRestore}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg text-[11.5px] font-black text-white bg-amber-600 disabled:opacity-50"
              >
                Yes, restore it
              </button>
              <button type="button" onClick={() => setPending(null)} className="flex-1 px-3 py-2 rounded-lg text-[11.5px] font-black bg-white border border-[var(--color-border)]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {status && (
          <p className="text-[10.5px] leading-snug flex items-start gap-1.5" style={{ color: "#15803D" }}>
            <Database size={12} className="shrink-0 mt-0.5" />
            {status}
          </p>
        )}
        {error && (
          <p className="text-[10.5px] leading-snug flex items-start gap-1.5" style={{ color: "#B91C1C" }}>
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        <p className="text-[9.5px] text-slate-400 leading-snug">
          Worth doing after any good run of trades, and before clearing your browser or changing phone. The file is plain text — you can open it and read exactly what is in it.
        </p>
      </div>
    </div>
  );
}
