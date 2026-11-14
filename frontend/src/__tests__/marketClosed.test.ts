import { describe, expect, test } from "vitest";
import { nextMcxOpen } from "../utils/mcxSession";

const ist = (s: string) => Date.parse(`${s}+05:30`);

describe("next MCX open", () => {
  test("weekend and late-night closes point to the right morning", () => {
    expect(nextMcxOpen(ist("2026-11-14T10:00:00")).label).toBe("Monday 9:00 AM IST"); // Saturday
    expect(nextMcxOpen(ist("2026-11-13T23:58:00")).label).toBe("Monday 9:00 AM IST"); // Friday after the bell
    expect(nextMcxOpen(ist("2026-11-17T07:00:00")).label).toBe("today 9:00 AM IST"); // Tuesday before the open
    expect(nextMcxOpen(ist("2026-11-17T23:58:00")).label).toBe("Wednesday 9:00 AM IST");
    expect(nextMcxOpen(ist("2026-11-14T10:00:00")).at).toBe(ist("2026-11-16T09:00:00"));
  });
});
