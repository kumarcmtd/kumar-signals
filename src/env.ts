// Shared foundations: the Env bindings, security headers, Upstox URLs and
// symbol lists, the core Candle/FutureInfo types, market status, the Upstox
// JSON reader with its typed 1015 rate-limit error, and the json() helper.

import { mcxSessionAt } from "../frontend/src/utils/mcxSession";

export interface Env {
  COMMODITY_KV: KVNamespace;
  ASSETS: Fetcher;
  AI: Ai;
  // All three optional -- News Based Trade AI degrades gracefully per
  // source when a key isn't configured (see fetchEnergyNews/fetchEiaData/
  // fetchEconCalendar below), never fabricating data to fill the gap.
  NEWSAPI_KEY?: string;
  EIA_API_KEY?: string;
  FRED_API_KEY?: string;
  // Owner key for writes and private reads. Set as a Cloudflare SECRET (never
  // in wrangler.jsonc or the repo). Unset = nothing enforced; see apiGuard.ts.
  APP_ACCESS_KEY?: string;
}

// The TradingView widget (frontend/src/components/TradingViewWidget.tsx) is
// the only third-party origin this app ever loads anything from -- its
// script dynamically creates its own embed iframe/data connections on
// whichever tradingview.com subdomain it currently uses internally, which
// isn't pinned down in their public docs, so this allows the whole domain
// rather than guessing a specific subdomain and having it silently break.
// Every other resource (JS bundle, CSS, fonts, images, API calls) is
// same-origin. Everything below is additive to what Workers Assets already
// serves, applied to every response this Worker returns.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://s3.tradingview.com",
  // React sets color/layout via the inline `style` DOM attribute on
  // thousands of elements throughout this app -- CSP has no nonce/hash
  // mechanism for the style="" attribute itself (only for <style> blocks),
  // so avoiding 'unsafe-inline' here would mean rewriting every dynamic
  // color in the app into static stylesheet classes, a large UI-risking
  // change well beyond a headers hardening pass. script-src (the actual
  // XSS vector) stays fully locked down with no 'unsafe-inline'/'unsafe-eval'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tradingview.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.tradingview.com wss://*.tradingview.com",
  "frame-src https://*.tradingview.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

// Applied to every response this Worker returns -- API JSON, the SPA's
// index.html, and every static asset -- so there's exactly one place that
// defines this app's security posture instead of it depending on every
// individual route remembering to set headers correctly.
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
export const UPSTOX_HIST_URL = "https://api.upstox.com/v2/historical-candle";
export const UPSTOX_INTRADAY_URL = "https://api.upstox.com/v2/historical-candle/intraday";
const UPSTOX_OPTION_CHAIN_URL = "https://api.upstox.com/v2/option/chain";

// All price-card instruments. Only CRUDEOIL/NATURALGAS have the options-based
// BUY/SELL signal logic wired up so far (OPTION_SYMBOLS) -- Gold/Silver/Copper/
// Aluminium show live price data only until that's extended.
export const ALL_SYMBOLS = ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER"] as const;
export const OPTION_SYMBOLS = ["CRUDEOIL", "NATURALGAS"] as const;
export type Symbol = (typeof ALL_SYMBOLS)[number];

export type Direction = "bullish" | "bearish" | "neutral";

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

// MCX commodity trading session. The close is DST-aware (23:30 IST while the US
// is on daylight time, 23:55 while it is on standard time) and comes from the
// same mcxSession helper the EOD force-close and the overnight anchor use, so
// "is MCX open" can never have two answers. Holidays are not known.
export function getMarketStatus() {
  const s = mcxSessionAt();
  const { isOpen, isPreOpen } = s;
  const session: "OPEN" | "CLOSED" | "PRE_OPEN" = isOpen ? "OPEN" : isPreOpen ? "PRE_OPEN" : "CLOSED";
  const hh = String(Math.floor(s.minutes / 60)).padStart(2, "0");
  const mm = String(s.minutes % 60).padStart(2, "0");
  return {
    isOpen,
    session,
    timeLabel: `${hh}:${mm} IST`,
    closeLabel: s.closeLabel,
    mcxStatus: isOpen
      ? `MCX session is live until ${s.closeLabel} IST.`
      : isPreOpen
        ? "MCX pre-open session -- trading resumes shortly."
        : "MCX session resumes ~9:00 AM IST on the next trading day. News monitoring remains active.",
  };
}

// Chart-pattern detection lives in frontend/src/utils/chartPatterns.ts, which
// adds recency, already-broke/target/stop checks and best-match ranking on top
// of the original detectors. See that file.

export function r2(x: number) {
  return Math.round(x * 100) / 100;
}

export interface FutureInfo {
  instrument_key: string;
  expiry: string;
  trading_symbol: string;
}

// Cloudflare serves its own error pages as PLAIN TEXT, not JSON -- most
// importantly "error code: 1015", which means "you are being rate limited".
// Upstox sits behind Cloudflare, so calling res.json() on that response threw
// a SyntaxError whose message ("Unexpected token 'e', \"error code: 1015 \" is
// not valid JSON") was then surfaced to the trader verbatim, dressed up as a
// market-data gap. The rate limit was real; the message was gibberish.
// Parsing through here names the actual cause instead.
// A Cloudflare 1015 from Upstox, as its own type so callers can tell "you are
// being rate limited, STOP calling" apart from "this request failed, try the
// next candidate". Treating the two the same is what made every fallback loop
// fire more doomed calls into an active rate limit and prolong it.
class UpstoxRateLimitError extends Error {
  readonly rateLimited = true;
}

export function isRateLimit(e: unknown): boolean {
  return e instanceof UpstoxRateLimitError;
}

export async function upstoxJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const code = /error code:\s*(\d+)/i.exec(text)?.[1];
    if (code === "1015") {
      throw new UpstoxRateLimitError(`Upstox is rate-limiting this app right now (Cloudflare 1015) while loading ${what}. Nothing is broken -- it clears on its own and the data refills on the next refresh.`);
    }
    if (code) throw new Error(`Upstox returned Cloudflare error ${code} while loading ${what}.`);
    throw new Error(`Upstox sent a non-JSON reply (HTTP ${res.status}) while loading ${what}.`);
  }
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
