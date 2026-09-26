// Kumar AI: the Workers AI reasoning layer. Numbers arrive already decided
// by the rule engine; the model only adds the qualitative read.

import type { Env } from "./env";

// ---- Kumar AI: Workers AI reasoning layer for the Kumar AI page ----
// The entry/stop/target/decision/confidence numbers are ALWAYS computed by
// the same deterministic, already-verified rule-based engine the rest of
// this app uses (analyzeTimeframe on the frontend) -- they are sent HERE
// already decided, and the model is explicitly instructed never to change
// them. Its only job is the qualitative layer this app can't compute on its
// own: plain-language reasoning, bullish/bearish factor lists, risk
// factors, expected movement, and a holding-duration suggestion. If the
// model call fails or returns unparseable output, this returns an honest
// error/empty result rather than fabricating a narrative.
interface KumarAiIndicatorSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  vwap: number | null;
  atr14: number | null;
  adx14: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  superTrend: { value: number; direction: string } | null;
  volumeRatio: number | null;
}

export interface KumarAiAnalyzeRequest {
  symbol: string;
  timeframeLabel: string;
  decision: string;
  bias: string;
  optSide: string | null;
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number | null;
  confidencePct: number | null;
  indicators: KumarAiIndicatorSnapshot;
  structureLabel: string | null;
  patternLabel: string | null;
  supportResistanceNote: string | null;
  reasons: string[];
}

interface KumarAiAnalyzeResult {
  reasoning: string;
  bullishReasons: string[];
  bearishReasons: string[];
  riskFactors: string[];
  expectedMovement: string;
  holdingDuration: string;
  bestTimeframeNote: string;
  error?: string;
}

function buildKumarAiPrompt(body: KumarAiAnalyzeRequest): string {
  const ind = body.indicators;
  return `Symbol: ${body.symbol}
Timeframe: ${body.timeframeLabel}
Decision already determined by the rule-based engine: ${body.decision} (bias: ${body.bias})
Option side: ${body.optSide ?? "n/a"}
Entry: ${body.entry}
Stop Loss: ${body.stop}
Targets: ${body.targets.join(", ")}
Risk:Reward: ${body.rr ?? "n/a"}
Confidence: ${body.confidencePct ?? "n/a"}%
EMA9/20/50/200: ${ind.ema9 ?? "n/a"} / ${ind.ema20 ?? "n/a"} / ${ind.ema50 ?? "n/a"} / ${ind.ema200 ?? "n/a"}
RSI(14): ${ind.rsi14 ?? "n/a"}
MACD: line=${ind.macd?.line ?? "n/a"} signal=${ind.macd?.signal ?? "n/a"} histogram=${ind.macd?.histogram ?? "n/a"}
VWAP: ${ind.vwap ?? "n/a"}
ATR(14): ${ind.atr14 ?? "n/a"}
ADX(14): ${ind.adx14 ?? "n/a"}
Bollinger Bands: upper=${ind.bollinger?.upper ?? "n/a"} middle=${ind.bollinger?.middle ?? "n/a"} lower=${ind.bollinger?.lower ?? "n/a"}
SuperTrend: ${ind.superTrend?.value ?? "n/a"} (${ind.superTrend?.direction ?? "n/a"})
Volume vs 10-bar average: ${ind.volumeRatio ?? "n/a"}x
Market structure: ${body.structureLabel ?? "n/a"}
Candle pattern: ${body.patternLabel ?? "n/a"}
Support/Resistance note: ${body.supportResistanceNote ?? "n/a"}
Reasons the rule-based engine already identified: ${body.reasons.join("; ") || "none"}

Do NOT invent, change, or second-guess the entry/stop/target/decision numbers above -- treat them as fixed facts. Return ONLY this JSON shape, no markdown fences, no extra keys:
{
  "reasoning": "2-3 sentence plain-language summary of why this call was generated",
  "bullishReasons": ["short bullet", "..."],
  "bearishReasons": ["short bullet", "..."],
  "riskFactors": ["short bullet", "..."],
  "expectedMovement": "short phrase describing expected price behavior",
  "holdingDuration": "short suggested holding time range",
  "bestTimeframeNote": "one sentence on whether this timeframe suits this setup"
}`;
}

// Accepts `unknown`, not `string` -- with response_format:"json_object", the
// Workers AI binding sometimes hands back an already-parsed object under
// `.response` instead of a JSON string (shape varies by model/binding
// version), and calling .trim() on that used to throw "raw.trim is not a
// function", surfacing as a broken AI-reasoning panel instead of a graceful
// fallback.
function parseKumarAiResponse(raw: unknown): KumarAiAnalyzeResult {
  const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const fromObj = (obj: Record<string, unknown>): KumarAiAnalyzeResult => ({
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    bullishReasons: strArray(obj.bullishReasons),
    bearishReasons: strArray(obj.bearishReasons),
    riskFactors: strArray(obj.riskFactors),
    expectedMovement: typeof obj.expectedMovement === "string" ? obj.expectedMovement : "",
    holdingDuration: typeof obj.holdingDuration === "string" ? obj.holdingDuration : "",
    bestTimeframeNote: typeof obj.bestTimeframeNote === "string" ? obj.bestTimeframeNote : "",
  });

  if (raw && typeof raw === "object") {
    return fromObj(raw as Record<string, unknown>);
  }

  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: "AI returned an empty response",
    };
  }

  try {
    const cleaned = text
      .trim()
      .replace(/^```(json)?/i, "")
      .replace(/```$/, "")
      .trim();
    return fromObj(JSON.parse(cleaned));
  } catch {
    // Model didn't return valid JSON -- surface the raw text as the
    // reasoning rather than silently dropping it or fabricating structure.
    return {
      reasoning: text.trim().slice(0, 800),
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
    };
  }
}

export async function computeKumarAiAnalysis(env: Env, body: KumarAiAnalyzeRequest): Promise<KumarAiAnalyzeResult> {
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a professional commodity trading analyst. You are given REAL, already-computed technical indicator readings and a REAL entry/stop/target/decision already decided by a deterministic rule-based engine -- you must NEVER invent or change any of these numbers. Your only job is to explain, in strict JSON, why these readings support (or don't fully support) this call: bullish/bearish factors, risk factors, expected movement, and a holding-duration suggestion. Reply with ONLY a single JSON object, no markdown, no commentary outside the JSON.",
        },
        { role: "user", content: buildKumarAiPrompt(body) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 700,
    });
    return parseKumarAiResponse((result as { response?: unknown }).response);
  } catch (err: unknown) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: err instanceof Error ? err.message : "AI reasoning unavailable right now",
    };
  }
}
