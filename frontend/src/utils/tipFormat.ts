// Renders specific words in the Unicode "Mathematical Sans-Serif Bold" block
// (the same style used in the terse BUY/ABOVE/TARGET/SL tip-sheet format
// common on trading Telegram/WhatsApp channels) -- verified against the
// user's own pasted example (𝗕𝗨𝗬, 𝗘𝗫) so the codepoint offsets are exact,
// not guessed.
function toBoldSans(text: string): string {
  return text.replace(/[A-Za-z0-9]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + (code - 65)); // A-Z
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + (code - 97)); // a-z
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ec + (code - 48)); // 0-9
    return ch;
  });
}

export interface TipCardParams {
  symbolLabel: string; // e.g. "Crude Oil"
  strike: number;
  optSide: "CE" | "PE";
  expiryLabel: string; // e.g. "17 Aug"
  buyZoneLow: number;
  buyZoneHigh: number;
  targets: [number, number, number];
  stopLoss: number;
}

// This app only ever recommends buying options (CE or PE), never writing
// them -- so the action word is always "BUY", matching the user's own
// example (which itself says "BUY ... PE", i.e. buying a put to express a
// bearish view, not selling/writing a call).
export function formatTipCard(p: TipCardParams): string {
  return [
    `🛒${toBoldSans("BUY")} ${p.symbolLabel} ${p.strike} ${p.optSide} (${p.expiryLabel} ${toBoldSans("EX")})`,
    "",
    `🪙${toBoldSans("ABOVE")}:-${p.buyZoneLow}/${p.buyZoneHigh}`,
    "",
    `🏆${toBoldSans("TARGET")}:- ${p.targets[0]}/${p.targets[1]}/${p.targets[2]}`,
    "",
    `🚫${toBoldSans("SL")}:- ${p.stopLoss}`,
  ].join("\n");
}
