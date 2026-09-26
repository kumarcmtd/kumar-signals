import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildBackup, parseBackup, summarise, isOurKey, looksLikeSecret, backupFilename, backupAge,
  BACKUP_FORMAT, BACKUP_VERSION,
} from "../utils/backupBundle";

const SERVER = {
  portfolio: [{ id: "p1" }, { id: "p2" }],
  tradeLogs: {
    "TWENTY20-CRUDEOIL-15": [{ id: "a", closed: true }, { id: "b", closed: false }],
    "BEST-NATURALGAS": [{ id: "c", closed: true }],
  },
  ntfyTopic: "kumar-private-topic",
};

const LOCAL = {
  "kumar-signals-pro-store": JSON.stringify({ state: { alerts: [{ id: "1" }, { id: "2" }, { id: "3" }] } }),
  "gptnews-positions": "[]",
};

test("a backup carries both halves of the data", () => {
  const b = buildBackup(LOCAL, SERVER, "https://example.workers.dev");
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.version, BACKUP_VERSION);
  assert.equal(Object.keys(b.local).length, 2);
  assert.equal(b.server.ntfyTopic, "kumar-private-topic");
  assert.equal(b.server.portfolio?.length, 2);
});

test("the summary counts what is actually recoverable", () => {
  const s = summarise(LOCAL, SERVER);
  assert.equal(s.tradeLogKeys, 2);
  assert.equal(s.totalTradeEntries, 3);
  assert.equal(s.closedTrades, 2);
  assert.equal(s.alerts, 3);
  assert.equal(s.portfolioTrades, 2);
  assert.equal(s.hasNtfyTopic, true);
});

// The rule that matters most. A backup gets emailed, synced and copied between
// devices -- a broker token must never be able to ride along.
test("anything that looks like a credential is refused by name", () => {
  for (const k of ["access_token", "upstox_TOKEN", "my-apikey", "user_password", "Authorization", "refresh_token", "client_secret"]) {
    assert.equal(looksLikeSecret(k), true, `${k} must be treated as a secret`);
  }
  for (const k of ["kumar-signals-pro-store", "gptnews-positions", "tradeLogs"]) {
    assert.equal(looksLikeSecret(k), false, `${k} is ordinary data, not a secret`);
  }
});

test("a credential is stripped even if it is handed in directly", () => {
  const b = buildBackup({ ...LOCAL, upstox_access_token: "SECRET-VALUE-123" }, SERVER, "https://example.workers.dev");
  const asText = JSON.stringify(b);
  assert.ok(!("upstox_access_token" in b.local), "the key must not survive into the bundle");
  assert.ok(!asText.includes("SECRET-VALUE-123"), "the value must not appear anywhere in the file");
});

test("only this app's storage keys are backed up", () => {
  assert.equal(isOurKey("kumar-signals-pro-store"), true);
  assert.equal(isOurKey("gptnews-positions"), true);
  assert.equal(isOurKey("overnight-impact-CRUDEOIL"), true);
  assert.equal(isOurKey("some-other-site-session"), false, "another site's data is not ours to export");
});

test("a backup survives a round trip unchanged", () => {
  const b = buildBackup(LOCAL, SERVER, "https://example.workers.dev");
  const parsed = parseBackup(JSON.stringify(b));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.bundle.local, b.local);
  assert.equal(parsed.bundle.server.ntfyTopic, "kumar-private-topic");
  assert.equal(parsed.bundle.summary.closedTrades, 2);
});

test("the summary is recomputed on restore, not taken on trust", () => {
  const b = buildBackup(LOCAL, SERVER, "https://example.workers.dev");
  const tampered = { ...b, summary: { ...b.summary, closedTrades: 9999 } };
  const parsed = parseBackup(JSON.stringify(tampered));
  assert.ok(parsed.ok);
  assert.equal(parsed.bundle.summary.closedTrades, 2, "what the file claims must not override what it holds");
});

test("a file that is not a backup is refused clearly", () => {
  const r = parseBackup(JSON.stringify({ hello: "world" }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /not a Kumar Signals backup/i);
});

test("damaged text is refused rather than half-read", () => {
  const r = parseBackup("{ this is not json");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /isn't readable|damaged/i);
});

test("a backup from a newer app version is refused, not partially applied", () => {
  const r = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 5, local: {} }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /newer version/i);
});

test("a backup with no settings section is refused", () => {
  const r = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /missing its saved settings/i);
});

test("a corrupt store is still backed up rather than dropped", () => {
  const b = buildBackup({ "kumar-signals-pro-store": "{not json" }, SERVER, "x");
  assert.equal(b.local["kumar-signals-pro-store"], "{not json", "unreadable data may still be recoverable by hand");
  assert.equal(b.summary.alerts, 0);
});

test("missing server sections do not break the backup", () => {
  const b = buildBackup(LOCAL, { portfolio: null, tradeLogs: null, ntfyTopic: null }, "x");
  assert.equal(b.summary.tradeLogKeys, 0);
  assert.equal(b.summary.portfolioTrades, 0);
  assert.equal(b.summary.hasNtfyTopic, false);
  assert.ok(parseBackup(JSON.stringify(b)).ok, "a partial backup must still restore");
});

test("the filename sorts by date and says what it is", () => {
  const name = backupFilename(new Date(2026, 8, 22, 9, 5));
  assert.equal(name, "kumar-signals-backup-2026-09-22-0905.json");
});

test("backup age is reported in plain words", () => {
  const now = Date.UTC(2026, 8, 22, 12, 0);
  assert.equal(backupAge(new Date(now - 3 * 60 * 60_000).toISOString(), now), "today");
  assert.equal(backupAge(new Date(now - 30 * 60 * 60_000).toISOString(), now), "yesterday");
  assert.equal(backupAge(new Date(now - 5 * 86_400_000).toISOString(), now), "5 days old");
  assert.equal(backupAge(new Date(now - 70 * 86_400_000).toISOString(), now), "2 months old");
  assert.equal(backupAge("not-a-date", now), "unknown date");
});

test("the app access key is never written into a backup file", async () => {
  const { ACCESS_KEY_STORAGE } = await import("../api/client");
  assert.equal(looksLikeSecret(ACCESS_KEY_STORAGE), true, "the storage key must trip the secret filter");
  const b = buildBackup({ [ACCESS_KEY_STORAGE]: "my-owner-key", "kumar-signals-pro-store": "{}" }, { portfolio: null, tradeLogs: null, ntfyTopic: null }, "https://x");
  assert.equal(JSON.stringify(b).includes("my-owner-key"), false);
});
