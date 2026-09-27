// Large trade-log saves go up in pieces small enough for one Worker request.
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../api/client";
import type { TradeLogEntry } from "../utils/tradeLogCore";

afterEach(() => vi.unstubAllGlobals());

test("a big save is split into pieces under the size cap, and every key arrives exactly once", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response('{"ok":true}');
  });
  const logs: Record<string, TradeLogEntry[]> = {};
  for (let k = 0; k < 40; k++) logs[`KEY-${k}`] = Array.from({ length: 100 }, (_, i) => ({ id: `${k}-${i}`, note: "x".repeat(200) }) as unknown as TradeLogEntry);
  await api.saveTradeLogs(logs);
  expect(bodies.length).toBeGreaterThan(1);
  for (const b of bodies) expect(JSON.stringify(b).length).toBeLessThan(130_000);
  const sent = bodies.flatMap((b) => Object.keys(b));
  expect(sent.sort()).toEqual(Object.keys(logs).sort());
  expect(Object.assign({}, ...bodies)).toEqual(logs);
});

test("a small save is one request", async () => {
  let calls = 0;
  vi.stubGlobal("fetch", async () => { calls++; return new Response('{"ok":true}'); });
  await api.saveTradeLogs({ A: [] });
  expect(calls).toBe(1);
});
