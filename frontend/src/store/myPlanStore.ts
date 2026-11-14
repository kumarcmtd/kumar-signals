// The trader's own money rules for Ai20-20 v3 (capital, risk per trade, the
// day's loss limit, trades a day, max lots). Saved on this phone only.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PLAN, sanitizePlan, type MyPlan } from "../utils/twentyV3/riskPlan";

interface MyPlanState {
  plan: MyPlan;
  /** True once the trader has looked at and saved the plan. */
  confirmed: boolean;
  setPlan: (p: Partial<MyPlan>) => void;
}

export const useMyPlan = create<MyPlanState>()(
  persist(
    (set, get) => ({
      plan: DEFAULT_PLAN,
      confirmed: false,
      setPlan: (p) => set({ plan: sanitizePlan({ ...get().plan, ...p }), confirmed: true }),
    }),
    {
      name: "ai2020-my-plan",
      version: 1,
      merge: (persisted, current) => {
        const s = persisted as Partial<MyPlanState> | undefined;
        return { ...current, plan: sanitizePlan(s?.plan), confirmed: !!s?.confirmed };
      },
    }
  )
);
