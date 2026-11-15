// Ai-Super Fast's live-only checks, applied after a setup fires and before a
// call opens. Neither can be replayed on old years (there is no archive of
// past option chains or headlines), so the lab results do not include them --
// the page says so.

import type { OptionsAnalytics } from "../../types";
import { newsVsSide, type NewsPulse } from "../newsPulse";
import type { StrikeChoice } from "./ticket";

export interface GateResult {
  ok: boolean;
  label: string;
  detail: string;
}

/**
 * Good liquidity: the strike to buy has at least a fifth of the open interest
 * AND of the volume of the busiest strike near the money, and both are above
 * zero -- a thin option fills far from the screen price.
 */
export function liquidityGate(options: OptionsAnalytics | undefined, choice: StrikeChoice | null, side: "CE" | "PE"): GateResult {
  const label = "Option liquidity";
  if (!options || options.error || !choice) return { ok: false, label, detail: "No live option chain — can't check the order would fill." };
  const rows = [...options.rows].sort((a, b) => a.strike - b.strike);
  const at = rows.findIndex((r) => r.strike === choice.strike);
  let maxOi = 0;
  let maxVol = 0;
  for (let i = Math.max(0, at - 2); i <= Math.min(rows.length - 1, at + 2); i++) {
    const leg = side === "CE" ? rows[i].call : rows[i].put;
    maxOi = Math.max(maxOi, leg?.oi ?? 0);
    maxVol = Math.max(maxVol, leg?.volume ?? 0);
  }
  const oi = choice.oi ?? 0;
  const vol = choice.volume ?? 0;
  const ok = oi > 0 && vol > 0 && oi >= 0.2 * maxOi && vol >= 0.2 * maxVol;
  const fmt = (n: number) => n.toLocaleString("en-IN");
  return {
    ok,
    label,
    detail: ok ? `${choice.strike} ${side}: OI ${fmt(oi)}, volume ${fmt(vol)} — trades well.` : `${choice.strike} ${side} is thin (OI ${fmt(oi)}, volume ${fmt(vol)}) — skip, it may not fill near the screen price.`,
  };
}

/** News in favour: the latest headlines must lean the call's way (not neutral, not against). */
export function newsGate(news: NewsPulse | null, side: "CE" | "PE"): GateResult {
  const label = "News in favour";
  if (!news || !news.available) return { ok: false, label, detail: "News feed unavailable — Super Fast needs the news on its side, so no call." };
  const v = newsVsSide(news, side);
  const lean = `news ${news.net >= 0 ? "+" : ""}${news.net} (${news.direction})`;
  if (v === "with") return { ok: true, label, detail: `Headlines lean ${side === "CE" ? "bullish" : "bearish"}: ${lean}.` };
  if (v === "neutral") return { ok: false, label, detail: `Headlines are neutral (${lean}) — Super Fast waits for news on its side.` };
  return { ok: false, label, detail: `Headlines lean against a ${side} (${lean}) — no call.` };
}
