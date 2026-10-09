import { expect, test } from "vitest";
import { sideLook } from "../components/decision/sideLook";

test("green for CE, red for PE, deeper the further along", () => {
  const leanCe = sideLook({ verdict: "WAIT", side: "CE" });
  const formCe = sideLook({ verdict: "FORMING_CE", side: "CE" });
  const buyCe = sideLook({ verdict: "BUY_CE", side: "CE" });
  expect([leanCe.stage, formCe.stage, buyCe.stage]).toEqual([1, 2, 3]);
  expect(leanCe.light).toBe(true);
  expect(leanCe.label).toBe("WAIT · leaning CE");
  expect(buyCe.tag).toContain("CE side");
  expect(sideLook({ verdict: "WAIT", side: "PE" }).ink).toBe("#9F1239");
  expect(sideLook({ verdict: "FORMING_PE", side: "PE" }).tag).toContain("PE side");
  expect(sideLook({ verdict: "WAIT", side: null }).stage).toBe(0);
  expect(sideLook({ verdict: "CLOSED", side: "CE" }).tag).toBeNull();
});
