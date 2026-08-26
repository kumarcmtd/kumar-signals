// Cross-page signal conflict detector.
//
// Every page in this app runs its own independent engine and opens its own
// trade-log line ("BEST-CRUDEOIL", "TWENTY20-NATURALGAS-15", "GATEPE-...",
// ...). Because they share no logic, two pages can legitimately be LONG
// opposite sides of the SAME symbol at the same time -- e.g. Best Call is
// holding a live 7850 CE (betting up) while Ai20-20 is holding a live 7850
// PE (betting down). That's the app contradicting itself, and it's exactly
// the moment a trader should NOT buy either leg.
//
// This scans every currently-open position across all pages and flags any
// symbol that has at least one live CE AND at least one live PE open at the
// same time, so AI-Shoot can surface a single "wait for a clear view"
// warning instead of the trader having to notice it by flipping between
// pages. Pure and deterministic -- reads only the already-open trade logs,
// never invents or re-runs a signal.

import type { TradeLogEntry } from "../store/appStore";

export type TradableSymbol = "CRUDEOIL" | "NATURALGAS";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];

export interface ConflictSide {
  page: string; // friendly page name that holds this open leg
  strike: number;
  entry: number;
  openedAt: number;
}

export interface SignalConflict {
  symbol: TradableSymbol;
  ceSources: ConflictSide[]; // live CE (bullish) legs open right now
  peSources: ConflictSide[]; // live PE (bearish) legs open right now
}

// Longest, most specific prefixes first so "GATECE-" wins before any shorter
// accidental match. The default-prefix pages (AI Test / Trade Report) key
// their logs by bare "<SYMBOL>-<TF>" with no page tag, so anything that
// doesn't match a known prefix is labelled generically.
const PREFIX_LABELS: { prefix: string; label: string }[] = [
  { prefix: "LEVELCROSS-", label: "Level Cross" },
  { prefix: "TWENTY20-", label: "Ai20-20" },
  { prefix: "GATECE-", label: "Directional" },
  { prefix: "GATEPE-", label: "Directional" },
  { prefix: "KUMARAI-", label: "Kumar AI" },
  { prefix: "AIRISK-", label: "AI Risk" },
  { prefix: "AIOWN-", label: "AI Own" },
  { prefix: "SHOOT-", label: "AI-Shoot" },
  { prefix: "BEST-", label: "Best Call" },
];

export function pageLabelForKey(key: string): string {
  for (const { prefix, label } of PREFIX_LABELS) {
    if (key.startsWith(prefix)) return label;
  }
  return "AI Test";
}

function lastOpen(entries: TradeLogEntry[] | undefined): TradeLogEntry | null {
  if (!entries || !entries.length) return null;
  const last = entries[entries.length - 1];
  return last && !last.closed ? last : null;
}

// De-dupes by page label so two timeframes of the same page (e.g. two
// TWENTY20-CRUDEOIL-* legs) count as one "Ai20-20" source, keeping the
// earliest-opened leg as the representative.
function dedupeByPage(sides: ConflictSide[]): ConflictSide[] {
  const byPage = new Map<string, ConflictSide>();
  for (const s of sides) {
    const existing = byPage.get(s.page);
    if (!existing || s.openedAt < existing.openedAt) byPage.set(s.page, s);
  }
  return Array.from(byPage.values()).sort((a, b) => a.openedAt - b.openedAt);
}

export function detectSignalConflicts(tradeLogs: Record<string, TradeLogEntry[]>): SignalConflict[] {
  const out: SignalConflict[] = [];

  for (const symbol of SYMBOLS) {
    const ce: ConflictSide[] = [];
    const pe: ConflictSide[] = [];

    for (const [key, entries] of Object.entries(tradeLogs)) {
      // "CRUDEOIL" and "NATURALGAS" never collide as substrings of each
      // other, so a plain includes() safely finds every page's key for a
      // symbol without knowing each page's naming scheme.
      if (!key.includes(symbol)) continue;
      const open = lastOpen(entries);
      if (!open) continue;
      const side: ConflictSide = { page: pageLabelForKey(key), strike: open.strike, entry: open.entry, openedAt: open.openedAt };
      if (open.optSide === "CE") ce.push(side);
      else if (open.optSide === "PE") pe.push(side);
    }

    const ceSources = dedupeByPage(ce);
    const peSources = dedupeByPage(pe);

    // A conflict is only real when BOTH directions are live at once.
    if (ceSources.length > 0 && peSources.length > 0) {
      out.push({ symbol, ceSources, peSources });
    }
  }

  return out;
}
