// Backup and restore.
//
// Everything this app knows about you lives in two places, and BOTH can be
// wiped without warning:
//
//   * Browser storage -- trade logs, alert settings, risk settings, journal.
//     Clearing site data, switching phones, or the browser reclaiming space on
//     a full device all destroy it silently.
//   * The Worker's KV -- the portfolio, the synced trade-log copy, the ntfy
//     topic. Safer, but still one account away from gone.
//
// A closed-trade history cannot be reconstructed. 237 closed Ai20-20 calls are
// the only record of how that engine actually performed; lose them and every
// accuracy figure in the app resets to nothing. That is what this protects.
//
// WHAT IS DELIBERATELY NOT IN THE FILE
//
//   * The Upstox access token, and any other credential. A backup gets emailed
//     to yourself, saved to cloud storage, copied between phones -- all places
//     a broker token must never be. It is excluded by construction here: this
//     module is only ever handed the data below, never the token.
//   * Market candles, prices and news. They are large, they go stale within
//     minutes, and Upstox re-sends them for free on the next refresh. Backing
//     up a copy of yesterday's chart would make the file huge while protecting
//     nothing that is actually at risk.

export const BACKUP_FORMAT = "kumar-signals-backup";
export const BACKUP_VERSION = 1;

export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO timestamp of when the backup was taken. */
  createdAt: string;
  /** Which app build produced it, for diagnosing an odd restore later. */
  appOrigin: string;
  /** Everything held in browser storage, key by key. */
  local: Record<string, string>;
  /** Everything held server-side that belongs to the user. */
  server: {
    portfolio: unknown[] | null;
    tradeLogs: Record<string, unknown[]> | null;
    ntfyTopic: string | null;
  };
  /** Plain counts, so the file can be sanity-checked without reading it all. */
  summary: BackupSummary;
}

export interface BackupSummary {
  localKeys: number;
  tradeLogKeys: number;
  totalTradeEntries: number;
  closedTrades: number;
  alerts: number;
  portfolioTrades: number;
  hasNtfyTopic: boolean;
}

/** Only keys belonging to this app are backed up; other sites' data is not ours. */
export const LOCAL_KEY_PREFIXES = ["kumar-signals", "gptnews", "overnight"];

export function isOurKey(key: string): boolean {
  const k = key.toLowerCase();
  return LOCAL_KEY_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Anything that looks like a credential is stripped before it can reach a file.
 *
 * Belt and braces: nothing here should ever be handed a token in the first
 * place, but a backup is the single easiest way to leak one by accident, so
 * this refuses on key name regardless of where the value came from.
 */
const SECRET_HINTS = ["token", "secret", "apikey", "api_key", "password", "authorization", "access_token", "refresh"];

export function looksLikeSecret(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_HINTS.some((h) => k.includes(h));
}

function countTradeEntries(logs: Record<string, unknown[]> | null): { keys: number; total: number; closed: number } {
  if (!logs) return { keys: 0, total: 0, closed: 0 };
  let total = 0;
  let closed = 0;
  for (const list of Object.values(logs)) {
    if (!Array.isArray(list)) continue;
    total += list.length;
    for (const e of list) {
      if (e && typeof e === "object" && (e as { closed?: unknown }).closed === true) closed += 1;
    }
  }
  return { keys: Object.keys(logs).length, total, closed };
}

export function summarise(local: Record<string, string>, server: BackupBundle["server"]): BackupSummary {
  // Trade logs live in BOTH places. The server copy is the merged one, so it
  // is the one counted; the local copy is still in the file, just not
  // double-counted in the summary.
  const counts = countTradeEntries(server.tradeLogs);

  let alerts = 0;
  const storeRaw = local["kumar-signals-pro-store"];
  if (storeRaw) {
    try {
      const parsed = JSON.parse(storeRaw) as { state?: { alerts?: unknown[] } };
      if (Array.isArray(parsed?.state?.alerts)) alerts = parsed.state!.alerts!.length;
    } catch {
      // A corrupt store still gets backed up verbatim -- it may be
      // recoverable by hand later, and refusing to back it up guarantees it
      // is not.
    }
  }

  return {
    localKeys: Object.keys(local).length,
    tradeLogKeys: counts.keys,
    totalTradeEntries: counts.total,
    closedTrades: counts.closed,
    alerts,
    portfolioTrades: Array.isArray(server.portfolio) ? server.portfolio.length : 0,
    hasNtfyTopic: Boolean(server.ntfyTopic),
  };
}

export function buildBackup(local: Record<string, string>, server: BackupBundle["server"], appOrigin: string): BackupBundle {
  const safeLocal: Record<string, string> = {};
  for (const [k, v] of Object.entries(local)) {
    if (looksLikeSecret(k)) continue;
    safeLocal[k] = v;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appOrigin,
    local: safeLocal,
    server,
    summary: summarise(safeLocal, server),
  };
}

export type ParseResult = { ok: true; bundle: BackupBundle } | { ok: false; error: string };

/**
 * Reads a backup file back.
 *
 * Refuses anything it does not recognise rather than half-restoring it. A
 * partial restore that silently drops trade history is worse than a clear
 * refusal, because you would not find out until the numbers were already wrong.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't readable as a backup — it may be the wrong file, or damaged." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "That file doesn't contain a backup." };

  const b = raw as Partial<BackupBundle>;
  if (b.format !== BACKUP_FORMAT) {
    return { ok: false, error: "That's not a Kumar Signals backup file." };
  }
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) {
    return { ok: false, error: `This backup was made by a newer version of the app (v${String(b.version)}). Update the app first, then restore.` };
  }
  if (!b.local || typeof b.local !== "object") {
    return { ok: false, error: "This backup is missing its saved settings and cannot be restored safely." };
  }

  const server = (b.server ?? { portfolio: null, tradeLogs: null, ntfyTopic: null }) as BackupBundle["server"];
  const local = b.local as Record<string, string>;

  return {
    ok: true,
    bundle: {
      format: BACKUP_FORMAT,
      version: b.version,
      createdAt: typeof b.createdAt === "string" ? b.createdAt : new Date(0).toISOString(),
      appOrigin: typeof b.appOrigin === "string" ? b.appOrigin : "unknown",
      local,
      server,
      // Recomputed rather than trusted: the counts in the file describe what
      // the file CLAIMS, and what matters on restore is what it actually holds.
      summary: summarise(local, server),
    },
  };
}

/** A filename that sorts chronologically and says what it is at a glance. */
export function backupFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `kumar-signals-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** Plain-language age, so a stale backup is obvious before it is relied on. */
export function backupAge(createdAt: string, now: number = Date.now()): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return "unknown date";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month old" : `${months} months old`;
}
