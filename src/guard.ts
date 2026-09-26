// Per-request guard state and requireToken, which rate-limits every route
// that spends the Upstox token.

import { IpRateLimiter, UPSTOX_ROUTE_LIMIT, UPSTOX_ROUTE_WINDOW_MS } from "../frontend/src/utils/apiGuard";
import { type Env, json } from "./env";

// Per-request facts the guard needs further down the router.
export interface RequestGuard {
  ip: string;
  /** Carried a valid owner key. Always false while no key is configured. */
  owner: boolean;
}

const upstoxLimiter = new IpRateLimiter(UPSTOX_ROUTE_LIMIT, UPSTOX_ROUTE_WINDOW_MS);

// Every route that spends the Upstox token comes through here, which makes it
// the exact place to rate-limit "endpoints that hit Upstox": a new route that
// needs the token is covered automatically, with no list to keep in sync.
export async function requireToken(env: Env, guard: RequestGuard): Promise<string | Response> {
  if (!guard.owner) {
    const r = upstoxLimiter.check(guard.ip);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: `Too many requests from this address. Try again in ${r.retryAfterS}s.` }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(r.retryAfterS) },
      });
    }
  }
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return json({ error: "No token found in KV. Log in via the main kumarcmtd worker's /login first." }, 400);
  return token;
}
