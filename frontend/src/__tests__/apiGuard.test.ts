import { test } from "vitest";
import assert from "node:assert/strict";
import { requiresKey, keyMatches, IpRateLimiter, SENSITIVE_READS } from "../utils/apiGuard";

// ---------------------------------------------------------------------------
// Which requests need the owner key
// ---------------------------------------------------------------------------

test("every write needs the key", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(requiresKey(m, "/api/trade-logs"), true, m);
  }
  assert.equal(requiresKey("POST", "/api/kumar-ai/analyze"), true, "spends the Workers AI quota");
  assert.equal(requiresKey("POST", "/api/notify/test"), true);
  assert.equal(requiresKey("DELETE", "/api/portfolio/abc-123"), true);
});

test("reads of private data need the key", () => {
  assert.equal(requiresKey("GET", "/api/notify/topic"), true, "the ntfy topic is enough to subscribe to every alert");
  assert.equal(requiresKey("GET", "/api/trade-logs"), true);
  assert.equal(requiresKey("GET", "/api/portfolio"), true);
});

test("market-data reads stay open, so the app still loads before a key is entered", () => {
  for (const p of ["/api/market-status", "/api/prices", "/api/candles", "/api/options/CRUDEOIL", "/api/global-markets"]) {
    assert.equal(requiresKey("GET", p), false, p);
    assert.equal(SENSITIVE_READS.has(p), false);
  }
});

test("method case and preflight/HEAD requests are handled", () => {
  assert.equal(requiresKey("post", "/api/trade-logs"), true);
  assert.equal(requiresKey("OPTIONS", "/api/trade-logs"), false);
  assert.equal(requiresKey("HEAD", "/api/trade-logs"), false);
});

// ---------------------------------------------------------------------------
// Key comparison
// ---------------------------------------------------------------------------

test("the right key matches and a wrong one does not", async () => {
  assert.equal(await keyMatches("correct horse battery", "correct horse battery"), true);
  assert.equal(await keyMatches("correct horse batterx", "correct horse battery"), false);
  assert.equal(await keyMatches("correct", "correct horse battery"), false, "a prefix is not a match");
});

test("a missing key never matches, even against an empty expected key", async () => {
  assert.equal(await keyMatches(null, "k"), false);
  assert.equal(await keyMatches(undefined, "k"), false);
  assert.equal(await keyMatches("", "k"), false);
  assert.equal(await keyMatches("k", ""), false, "an unset secret must not accept anything");
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test("requests within the limit pass and the next one is refused", () => {
  const rl = new IpRateLimiter(3, 60_000);
  const t = 1_000_000;
  assert.equal(rl.check("1.1.1.1", t).ok, true);
  assert.equal(rl.check("1.1.1.1", t).ok, true);
  assert.equal(rl.check("1.1.1.1", t).ok, true);
  const over = rl.check("1.1.1.1", t + 10_000);
  assert.equal(over.ok, false);
  assert.equal(over.retryAfterS, 50, "tells the client when to come back");
});

test("each IP has its own budget", () => {
  const rl = new IpRateLimiter(1, 60_000);
  assert.equal(rl.check("1.1.1.1", 0).ok, true);
  assert.equal(rl.check("2.2.2.2", 0).ok, true);
  assert.equal(rl.check("1.1.1.1", 0).ok, false);
});

test("the budget refills when the window passes", () => {
  const rl = new IpRateLimiter(1, 60_000);
  assert.equal(rl.check("1.1.1.1", 0).ok, true);
  assert.equal(rl.check("1.1.1.1", 59_999).ok, false);
  assert.equal(rl.check("1.1.1.1", 60_000).ok, true);
});

test("memory stays bounded under a flood of distinct IPs", () => {
  const rl = new IpRateLimiter(10, 60_000, 100);
  for (let i = 0; i < 1000; i += 1) rl.check(`10.0.${Math.floor(i / 256)}.${i % 256}`, 0);
  // Still functions after being cleared.
  assert.equal(rl.check("9.9.9.9", 0).ok, true);
});
