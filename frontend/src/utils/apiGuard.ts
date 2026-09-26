// API access guard: an owner key for anything that changes or reveals your
// data, and a per-IP limit on everything that spends the Upstox token.
//
// WHY. Before this, every /api/* route was open to anyone who found the URL.
// That was worse than it sounds:
//   * GET /api/notify/topic returned the ntfy topic -- and ntfy topics are
//     public by name, so knowing it is enough to subscribe to every trade
//     alert this app sends, or to POST/DELETE it and silence them.
//   * POST /api/trade-logs overwrote the track record every accuracy figure
//     is computed from. The client-side "force stop" password lives in the
//     JS bundle, so it protected nothing; this endpoint is the real door.
//   * Any script could hammer the Upstox-backed routes into the 1015 limit.
//
// THE KEY IS NEVER IN THE REPO OR THE BUNDLE. The Worker reads it from the
// APP_ACCESS_KEY secret (Cloudflare dashboard, or `wrangler secret put`); the
// phone holds its own copy, typed into Settings once and kept in that
// device's storage. A key compiled into the frontend would be readable by
// anyone who opened the site, which is the same mistake as the force-stop
// password.
//
// ROLLOUT IS FAIL-OPEN. With no APP_ACCESS_KEY set, nothing is enforced and
// the app behaves exactly as before. Protection switches on the moment the
// secret exists. Failing closed would have broken trade-log sync, the
// portfolio and alert settings on the very next deploy, before there was any
// way to enter a key.

/** Header the app sends its key in. */
export const ACCESS_KEY_HEADER = "X-App-Key";

/**
 * GET routes that reveal private data. Everything else a GET returns is
 * market data anyone could see on a chart.
 */
export const SENSITIVE_READS = new Set(["/api/trade-logs", "/api/portfolio", "/api/notify/topic"]);

/** Does this request need the owner key (when one is configured)? */
export function requiresKey(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "OPTIONS" || m === "HEAD") return false;
  // Any method that writes. Includes POST /api/kumar-ai/analyze, which spends
  // the Workers AI quota.
  if (m !== "GET") return true;
  return SENSITIVE_READS.has(pathname);
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * Constant-time key comparison.
 *
 * Both sides are hashed first, so the comparison always runs over two 32-byte
 * digests: no early exit on the first differing byte, and no leak of the key's
 * length. Portable to Node for testing, unlike the Workers-only
 * crypto.subtle.timingSafeEqual.
 */
export async function keyMatches(provided: string | null | undefined, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface RateCheck {
  ok: boolean;
  /** Seconds until the window resets, for a Retry-After header. */
  retryAfterS: number;
}

/**
 * Fixed-window request counter per client IP.
 *
 * HONEST LIMITS OF THIS: it lives in one Worker isolate's memory. Requests
 * from one client can land on different isolates, each counting separately,
 * so a determined attacker gets more than `limit`. What it reliably does is
 * stop a single script hammering one isolate -- the common case -- at zero
 * cost and with no config that could fail a deploy. The durable upgrade is
 * Cloudflare's Rate Limiting binding or a WAF rule.
 *
 * Memory is bounded: past `maxKeys` distinct IPs the table is cleared rather
 * than allowed to grow without limit.
 */
export class IpRateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 5000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  check(ip: string, now: number = Date.now()): RateCheck {
    let entry = this.hits.get(ip);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (!entry && this.hits.size >= this.maxKeys) this.hits.clear();
      entry = { windowStart: now, count: 0 };
      this.hits.set(ip, entry);
    }
    entry.count += 1;
    const retryAfterS = Math.max(1, Math.ceil((entry.windowStart + this.windowMs - now) / 1000));
    return { ok: entry.count <= this.limit, retryAfterS };
  }
}

/**
 * Per-IP budget for routes that spend the Upstox token.
 *
 * Set well above what the app itself needs. A heavy live page polls candles
 * on several timeframes for both symbols, plus options, depth and prices --
 * on the order of 60-100 requests a minute from one phone. 300/min leaves
 * room for two open tabs while still stopping a script at 5 per second.
 * With an access key configured, the owner's own requests skip this entirely.
 */
export const UPSTOX_ROUTE_LIMIT = 300;
export const UPSTOX_ROUTE_WINDOW_MS = 60_000;
