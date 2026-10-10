import { afterEach, expect, test, vi } from "vitest";
import { sendNtfyNotification } from "../../src/notify";

afterEach(() => vi.unstubAllGlobals());

test("a 522 from ntfy.sh is retried, and succeeds when ntfy recovers", async () => {
  const codes = [522, 522, 200];
  const f = vi.fn(async () => new Response("", { status: codes.shift()! }));
  vi.stubGlobal("fetch", f);
  expect(await sendNtfyNotification("t", "T", "B", "urgent", { retryDelaysMs: [0, 0] })).toEqual({ ok: true });
  expect(f).toHaveBeenCalledTimes(3);
});

test("still failing after all tries: a plain message saying it is ntfy's side", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 522 })));
  const r = await sendNtfyNotification("t", "T", "B", "urgent", { retryDelaysMs: [0, 0] });
  expect(r.ok).toBe(false);
  expect(r.error).toContain("HTTP 522, tried 3 times");
  expect(r.error).toContain("NTFY_TOKEN");
});

test("a 400 is not retried; a dropped connection is", async () => {
  const bad = vi.fn(async () => new Response("", { status: 400 }));
  vi.stubGlobal("fetch", bad);
  expect((await sendNtfyNotification("t", "T", "B", "urgent", { retryDelaysMs: [0, 0] })).ok).toBe(false);
  expect(bad).toHaveBeenCalledTimes(1);
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? Promise.reject(new Error("network")) : new Response("", { status: 200 }))));
  expect((await sendNtfyNotification("t", "T", "B", "urgent", { retryDelaysMs: [0, 0] })).ok).toBe(true);
});

test("with an access token the push is authorised, and a bad token says so", async () => {
  let auth: string | null = null;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    auth = new Headers(init.headers).get("Authorization");
    return new Response("", { status: 200 });
  }));
  expect((await sendNtfyNotification("t", "T", "B", "urgent", { token: "tk_abc", retryDelaysMs: [] })).ok).toBe(true);
  expect(auth).toBe("Bearer tk_abc");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
  expect((await sendNtfyNotification("t", "T", "B", "urgent", { token: "bad", retryDelaysMs: [0, 0] })).error).toContain("NTFY_TOKEN");
});

test("without a token, a 429 points to the fix", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
  expect((await sendNtfyNotification("t", "T", "B", "urgent", { retryDelaysMs: [0, 0] })).error).toContain("NTFY_TOKEN");
});
