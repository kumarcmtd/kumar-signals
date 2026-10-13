// NEWS FLASH push: a major headline (|impact| >= 4) pushed to the phone the
// moment the 5-minute news refresh finds it.
//
// In war-time crude a strike on oil infrastructure or a ceasefire moves price
// within seconds -- far faster than any candle confirms. This does not call a
// trade; it tells the trader the risk has just changed, so they can protect a
// running position or stand aside. Each story is pushed once (KV marker).

import type { ScoredNewsArticle } from "../frontend/src/utils/newsScoring";
import { whyHeadlineMatters } from "../frontend/src/utils/newsScoring";
import { cachePut, type Env } from "./env";
import { fetchEnergyNews } from "./news";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";

export const FLASH_MIN_IMPACT = 4;
const FLASH_MAX_AGE_MIN = 20;
const FLASH_PER_RUN = 2;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The fresh major stories, newest first. */
export function majorFlashes(articles: ScoredNewsArticle[], now: number): ScoredNewsArticle[] {
  return articles
    .filter((a) => Math.abs(a.impactScale) >= FLASH_MIN_IMPACT && now - Date.parse(a.publishedAt) <= FLASH_MAX_AGE_MIN * 60_000 && now - Date.parse(a.publishedAt) >= -5 * 60_000)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function flashText(a: ScoredNewsArticle, now: number): { title: string; body: string } {
  const market = a.affectedMarket === "NG" ? "Natural Gas" : a.affectedMarket === "BOTH" ? "Crude + Gas" : "Crude";
  const dir = a.impactScale > 0 ? "STRONG BULLISH" : "STRONG BEARISH";
  const mins = Math.max(0, Math.round((now - Date.parse(a.publishedAt)) / 60_000));
  const at = new Date(a.publishedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const why = whyHeadlineMatters(a.matchedRules);
  return {
    title: `NEWS FLASH: ${dir} ${market}`,
    body: [
      a.headline,
      `${at} (${mins} min ago) -- ${a.source}`,
      why ? `\n${why.effect}` : "",
      "",
      "Protect any running trade on the other side. Don't chase the first spike --",
      "check AI Verify Pro's 5-min trend before entering.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function runNewsFlashCheck(env: Env, now = Date.now()): Promise<number> {
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return 0;
  const news = await fetchEnergyNews(env);
  if (!news.available) return 0;
  let sent = 0;
  for (const a of majorFlashes(news.articles, now)) {
    if (sent >= FLASH_PER_RUN) break;
    const key = `notified:NEWSFLASH-${hash(a.url || a.headline)}`;
    if (await env.COMMODITY_KV.get(key)) continue;
    if (!(await cachePut(env.COMMODITY_KV, key, "1", { expirationTtl: 2 * 86_400 }))) continue;
    const msg = flashText(a, now);
    const r = await sendNtfyNotification(topic, msg.title, msg.body, "urgent", { token: env.NTFY_TOKEN });
    if (r.ok) sent++;
  }
  return sent;
}
