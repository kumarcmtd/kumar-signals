import { expect, test } from "vitest";
import { callMatch } from "../utils/callMatch";

test("MATCHED only when AI Verify has confirmed the same side and the live candle is not turning", () => {
  expect(callMatch({ verdict: "BUY_CE", side: "CE" }, { action: "HOLDING", tone: "good" }, "CE").ok).toBe(true);
  expect(callMatch({ verdict: "BUY_CE", side: "CE" }, null, "CE").level).toBe("matched");
  expect(callMatch({ verdict: "FORMING_CE", side: "CE" }, null, "CE").level).toBe("same_side_unconfirmed");
  expect(callMatch({ verdict: "WAIT", side: "CE" }, null, "CE").ok).toBe(false);
  expect(callMatch({ verdict: "BUY_CE", side: "CE" }, { action: "WEAKENING", tone: "warn" }, "CE").level).toBe("fading");
  expect(callMatch({ verdict: "BUY_CE", side: "CE" }, { action: "REVERSING", tone: "bad" }, "CE").level).toBe("fading");
  expect(callMatch({ verdict: "BUY_PE", side: "PE" }, null, "CE").level).toBe("against");
  expect(callMatch({ verdict: "WAIT", side: null }, null, "PE").level).toBe("no_view");
});

test("a clean match also needs steady candles, no chase, and news not against", () => {
  const buy = { verdict: "BUY_CE" as const, side: "CE" as const };
  const holding = { action: "HOLDING" as const, tone: "good" as const };
  expect(callMatch(buy, holding, "CE", { pulse: { state: "CHOPPY", stretched: null } }).level).toBe("choppy");
  expect(callMatch(buy, holding, "CE", { pulse: { state: "STEADY_DOWN", stretched: null } }).level).toBe("fading");
  expect(callMatch(buy, holding, "CE", { pulse: { state: "STEADY_UP", stretched: { side: "up", atrs: 3, pullbackTo: 8600 } } }).level).toBe("stretched");
  const bearNews = { net: -50, direction: "bearish" as const, highImpactFresh: 2, top: null, feedAgeMin: 3, available: true };
  expect(callMatch(buy, holding, "CE", { news: bearNews }).level).toBe("news_against");
  expect(callMatch(buy, holding, "CE", { pulse: { state: "STEADY_UP", stretched: null }, news: { ...bearNews, net: 40, direction: "bullish" } }).ok).toBe(true);
});
