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
