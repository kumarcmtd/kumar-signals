import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors worker.ts's upstoxJson error mapping. The worker imports Cloudflare
// types and cannot be loaded here, so the mapping is duplicated as a pure
// function and pinned -- the exact strings a trader sees are worth a test.
function messageFor(text: string, status = 429): string {
  try {
    JSON.parse(text);
    return "";
  } catch {
    const code = /error code:\s*(\d+)/i.exec(text)?.[1];
    if (code === "1015") return `Upstox is rate-limiting this app right now (Cloudflare 1015) while loading price history. Nothing is broken -- it clears on its own and the data refills on the next refresh.`;
    if (code) return `Upstox returned Cloudflare error ${code} while loading price history.`;
    return `Upstox sent a non-JSON reply (HTTP ${status}) while loading price history.`;
  }
}

test("a Cloudflare 1015 body is reported as rate limiting, not as a JSON parse error", () => {
  // This is the literal body Cloudflare returns, and the exact case that
  // surfaced to the trader as: Unexpected token 'e', "error code: 1015 " is
  // not valid JSON -- a real rate limit wearing a nonsense message.
  const msg = messageFor("error code: 1015 ");
  assert.match(msg, /rate-limiting/);
  assert.doesNotMatch(msg, /Unexpected token/);
  assert.doesNotMatch(msg, /valid JSON/);
});

test("other Cloudflare codes are named rather than swallowed", () => {
  assert.match(messageFor("error code: 1020"), /Cloudflare error 1020/);
});

test("a non-JSON body with no Cloudflare code still explains itself", () => {
  assert.match(messageFor("<html>Bad Gateway</html>", 502), /non-JSON reply \(HTTP 502\)/);
});

test("valid JSON parses and produces no error message at all", () => {
  assert.equal(messageFor('{"status":"success"}'), "");
});
