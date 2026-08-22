import type { TradeLogEntry } from "../store/appStore";

export type TradableSymbol = "CRUDEOIL" | "NATURALGAS";

export interface ConfluenceSource {
  name: string;
  strike: number;
  entry: number;
  stop: number;
  targets: [number, number, number];
  openedAt: number;
}

export interface ConfluenceCall {
  symbol: TradableSymbol;
  optSide: "CE" | "PE";
  direction: "bullish" | "bearish";
  sameStrike: boolean;
  // Best Call's own numbers -- always the headline entry/strike shown, since
  // it's the single most-compared engine of the three. suggestedStop/
  // suggestedTargets below are the actual recommendation, merged across all
  // sources.
  primary: ConfluenceSource;
  sources: ConfluenceSource[];
  suggestedStop: number;
  suggestedTargets: [number, number, number];
  confidence: number;
  confidenceLabel: string;
}

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];

function lastOpen(entries: TradeLogEntry[] | undefined): TradeLogEntry | null {
  if (!entries || !entries.length) return null;
  const last = entries[entries.length - 1];
  return last && !last.closed ? last : null;
}

function confidenceLabelFor(score: number): string {
  if (score >= 90) return "Exceptional Confluence";
  if (score >= 80) return "Strong Confluence";
  if (score >= 70) return "Good Confluence";
  return "Fair Confluence";
}

// Real, deterministic, and reproducible from the exact positions already
// open on Best Call / Ai20-20 / Level Cross Scan -- never invents a call.
// Only ever fires once all three independently-built engines already have
// an OPEN position on the same symbol agreeing on the same side (CE/PE):
// Best Call's own 3-engine comparison, Ai20-20's live-momentum scanner, and
// Level Cross Scan's tested-level break detector share no logic with each
// other, so genuine three-way agreement is a real, rare, meaningful event
// -- not something that can be talked into firing more often.
export function findConfluenceCalls(tradeLogs: Record<string, TradeLogEntry[]>): ConfluenceCall[] {
  const out: ConfluenceCall[] = [];

  for (const symbol of SYMBOLS) {
    const best = lastOpen(tradeLogs[`BEST-${symbol}`]);
    const levelCross = lastOpen(tradeLogs[`LEVELCROSS-${symbol}`]);
    const twenty = Object.entries(tradeLogs)
      .filter(([k]) => k.startsWith(`TWENTY20-${symbol}-`))
      .map(([, v]) => lastOpen(v))
      .filter((e): e is TradeLogEntry => e !== null);

    if (!best || !levelCross || twenty.length === 0) continue;
    if (levelCross.optSide !== best.optSide) continue;
    if (twenty.some((e) => e.optSide !== best.optSide)) continue;

    const sources: ConfluenceSource[] = [
      { name: "Best Call", strike: best.strike, entry: best.entry, stop: best.stop, targets: best.targets, openedAt: best.openedAt },
      { name: "Level Cross Scan", strike: levelCross.strike, entry: levelCross.entry, stop: levelCross.stop, targets: levelCross.targets, openedAt: levelCross.openedAt },
      ...twenty.map((e, i) => ({
        name: `Ai20-20${twenty.length > 1 ? ` #${i + 1}` : ""}`,
        strike: e.strike,
        entry: e.entry,
        stop: e.stop,
        targets: e.targets,
        openedAt: e.openedAt,
      })),
    ];

    const direction: "bullish" | "bearish" = best.optSide === "CE" ? "bullish" : "bearish";
    const sameStrike = sources.every((s) => s.strike === best.strike);

    // Option premium always ascends from stop -> entry -> targets whether
    // the position is a long CE or a long PE (you're always long the
    // premium in this app, never short) -- see bestCallSelector.ts's own
    // projectFromUnderlying, which builds every source's stop/targets this
    // same way. So the "safest common ground" across sources is always the
    // HIGHEST stop (caps loss soonest) and the LOWEST target at each leg
    // (reached soonest) -- no direction branch needed.
    const suggestedStop = Math.max(...sources.map((s) => s.stop));
    const suggestedTargets = [0, 1, 2].map((i) => Math.min(...sources.map((s) => s.targets[i]))) as [number, number, number];

    // Confidence is built entirely from how well the sources agree with
    // EACH OTHER, not from re-running any single engine's own score --
    // that's the whole point of a confluence read. A floor of 60 reflects
    // that three independent engines agreeing is already a strong signal
    // by construction; the rest rewards how tightly their entries cluster
    // (real convergence, not three vaguely-similar setups) and how many
    // EXTRA timeframes Ai20-20 itself independently confirms beyond the
    // one already required.
    const entries = sources.map((s) => s.entry);
    const meanEntry = entries.reduce((a, b) => a + b, 0) / entries.length;
    const spreadPct = meanEntry > 0 ? ((Math.max(...entries) - Math.min(...entries)) / meanEntry) * 100 : 100;
    const tightnessBonus = Math.max(0, Math.min(20, 20 - spreadPct * 2));
    const extraConfirmationBonus = Math.min(20, (twenty.length - 1) * 5);
    const confidence = Math.round(Math.max(60, Math.min(100, 60 + tightnessBonus + extraConfirmationBonus)));

    out.push({
      symbol,
      optSide: best.optSide,
      direction,
      sameStrike,
      primary: sources[0],
      sources,
      suggestedStop: Number(suggestedStop.toFixed(2)),
      suggestedTargets: suggestedTargets.map((t) => Number(t.toFixed(2))) as [number, number, number],
      confidence,
      confidenceLabel: confidenceLabelFor(confidence),
    });
  }

  return out;
}
