// Phase 2: the app must STOP calling Upstox once it is rate limited (1015),
// and a rate limit must be reported as one -- not as "no contracts".
//
// fetch is mocked and every call is counted. The point of these tests is the
// number of calls: a fallback loop that keeps firing into a 1015 extends it.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isRateLimit, upstoxJson } from "../../src/env";
import { resolveOptionChainAcrossFutures, resolveOptionExpiryCandidates } from "../../src/optionChain";
import { getNearestFuture, getUpcomingFutures } from "../../src/upstox";

const RATE_LIMIT_PAGE = "<html><body>error code: 1015</body></html>";
const realFetch = globalThis.fetch;
let calls: string[] = [];

function mockFetch(handler: (url: string) => Response) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const rateLimited = () => new Response(RATE_LIMIT_PAGE, { status: 429, headers: { "Content-Type": "text/html" } });

// Every test uses its own symbol/instrument so the modules' caches never leak
// a result from one test into the next.
let n = 0;
const uniq = (p: string) => `${p}-${++n}-${Date.now()}`;
const futureFor = (key: string) => ({ instrument_key: key, expiry: "2099-12-15", trading_symbol: `${key} FUT` });

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

test("a 1015 page is reported as a rate limit, with a readable message", async () => {
  const err = await upstoxJson(rateLimited(), "the option chain").catch((e) => e);
  expect(isRateLimit(err)).toBe(true);
  expect(String(err.message)).toMatch(/rate-limiting/);
});

test("other non-JSON replies are errors, but not rate limits", async () => {
  const err = await upstoxJson(new Response("<html>502 Bad Gateway</html>", { status: 502 }), "x").catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(isRateLimit(err)).toBe(false);
});

// Item 5
test("expiry discovery surfaces a rate limit instead of falling back to 'no contracts'", async () => {
  mockFetch(() => rateLimited());
  const err = await resolveOptionExpiryCandidates("tok", futureFor(uniq("MCX_FO|EXP"))).catch((e) => e);
  expect(isRateLimit(err)).toBe(true);
  expect(calls).toHaveLength(1);
});

test("a genuinely empty expiry list still falls back to the future's own expiry", async () => {
  mockFetch(() => json({ status: "success", data: [] }));
  const fut = futureFor(uniq("MCX_FO|EMPTY"));
  expect(await resolveOptionExpiryCandidates("tok", fut)).toEqual([fut.expiry]);
});

// Item 6
test("the option-chain fallback stops at the first rate limit", async () => {
  mockFetch(() => rateLimited());
  const q = uniq("CRUDEOIL");
  const res = await resolveOptionChainAcrossFutures("tok", q, futureFor(uniq("MCX_FO|PRIMARY")), 9000);
  expect(res.rateLimited).toBe(true);
  expect(res.chain).toBeUndefined();
  // One expiry-discovery call, then stop. The old code went on to try every
  // expiry, fetch the futures list, and repeat for two more futures.
  expect(calls).toHaveLength(1);
});

test("a rate limit on the chain itself also stops the loop", async () => {
  // Discovery works and lists three expiries; the chain fetch is rate limited.
  mockFetch((url) =>
    url.includes("expiry_date=")
      ? rateLimited()
      : json({ status: "success", data: [{ expiry: "2099-10-15" }, { expiry: "2099-11-15" }, { expiry: "2099-12-15" }] })
  );
  const res = await resolveOptionChainAcrossFutures("tok", uniq("NATURALGAS"), futureFor(uniq("MCX_FO|P2")), 250);
  expect(res.rateLimited).toBe(true);
  expect(calls.filter((u) => u.includes("expiry_date="))).toHaveLength(1);
  expect(calls.some((u) => u.includes("instruments/search"))).toBe(false);
});

// Item 7
test("nearest and upcoming futures share one cached lookup", async () => {
  mockFetch(() =>
    json({
      status: "success",
      data: [
        { instrument_key: "B", expiry: "2099-11-19", trading_symbol: "B FUT" },
        { instrument_key: "A", expiry: "2099-10-19", trading_symbol: "A FUT" },
        { instrument_key: "C", expiry: "2099-12-19", trading_symbol: "C FUT" },
      ],
    })
  );
  const q = uniq("CRUDEOIL");
  expect((await getNearestFuture("tok", q))?.instrument_key).toBe("A");
  expect((await getUpcomingFutures("tok", q, 3)).map((f) => f.instrument_key)).toEqual(["A", "B", "C"]);
  expect(calls).toHaveLength(1);
});

test("an expired contract in the list is skipped, so the cache rolls by itself", async () => {
  mockFetch(() =>
    json({
      status: "success",
      data: [
        { instrument_key: "OLD", expiry: "2020-01-17", trading_symbol: "OLD FUT" },
        { instrument_key: "NEXT", expiry: "2099-10-19", trading_symbol: "NEXT FUT" },
      ],
    })
  );
  expect((await getNearestFuture("tok", uniq("NATURALGAS")))?.instrument_key).toBe("NEXT");
});

test("an empty futures result is not cached", async () => {
  mockFetch(() => json({ status: "success", data: [] }));
  const q = uniq("CRUDEOIL");
  expect(await getNearestFuture("tok", q)).toBeNull();
  expect(await getNearestFuture("tok", q)).toBeNull();
  expect(calls).toHaveLength(2);
});
