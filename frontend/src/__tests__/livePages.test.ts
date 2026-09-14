import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVE_PAGE_PATHS, isAlwaysLivePage, refetchIntervalFor } from "../config/livePages";

test("exactly six pages are allowed to poll on their own", () => {
  assert.equal(LIVE_PAGE_PATHS.length, 6, "this list IS the bottom bar -- adding a seventh silently adds load");
  assert.equal(new Set(LIVE_PAGE_PATHS).size, 6, "no duplicates");
});

test("the six main tabs are recognised, including the root page", () => {
  for (const path of LIVE_PAGE_PATHS) {
    assert.equal(isAlwaysLivePage(path), true, `${path} should be always-live`);
  }
});

test("every other page is not always-live", () => {
  for (const path of ["/price-alerts", "/gpt-news", "/ai-flash", "/settings", "/journal", "/charts", "/ai-edge"]) {
    assert.equal(isAlwaysLivePage(path), false, `${path} must not poll on its own`);
  }
});

test("a trailing slash does not turn a main page into a paused one", () => {
  assert.equal(isAlwaysLivePage("/best-call/"), true);
  assert.equal(isAlwaysLivePage("/"), true, "the root is a single slash and must survive the trim");
});

test("a path that merely starts with a live path is not treated as one", () => {
  // "/ai-up-something" is a different page and must not inherit live polling.
  assert.equal(isAlwaysLivePage("/ai-up-extra"), false);
  assert.equal(isAlwaysLivePage("/best-call/detail"), false);
});

test("main pages keep their interval; other pages get none", () => {
  assert.equal(refetchIntervalFor("/best-call", false, 15_000), 15_000);
  assert.equal(refetchIntervalFor("/gpt-news", false, 15_000), false, "false is React Query's own 'do not poll'");
});

test("the user switch turns polling back on anywhere", () => {
  assert.equal(refetchIntervalFor("/gpt-news", true, 30_000), 30_000);
  // ...and can never reduce a main page below its own interval.
  assert.equal(refetchIntervalFor("/", true, 15_000), 15_000);
  assert.equal(refetchIntervalFor("/", false, 15_000), 15_000);
});

test("the interval passed in is what comes back, so per-hook cadences survive", () => {
  for (const ms of [15_000, 20_000, 30_000, 60_000, 5 * 60_000, 60 * 60_000]) {
    assert.equal(refetchIntervalFor("/ai-up", false, ms), ms);
    assert.equal(refetchIntervalFor("/ai-flash", false, ms), false);
  }
});
