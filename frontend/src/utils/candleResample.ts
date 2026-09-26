// Resampling 1-minute candles into 15/30/60/240-minute bars.
//
// Moved out of worker.ts into a pure module so it can be tested, and fixed for
// three faults that all made our bars disagree with TradingView:
//
// 1. BUCKETS WERE ALIGNED TO THE UTC EPOCH. `floor(t / bucket) * bucket` puts
//    hour boundaries at :00 UTC, which is :30 IST. MCX opens at 09:00 IST, so
//    every 60-minute bar ran 09:30-10:30 instead of 09:00-10:00, and the
//    240-minute bars were misaligned the same way. 15m and 30m happened to be
//    unaffected only because IST's half-hour offset is a multiple of them.
//    Buckets are now anchored to each session's 09:00 IST open, the way a
//    session-based chart draws them -- and because the anchor resets every
//    day, any bucket size is correct, not just ones that divide 24 hours.
//
// 2. OPEN INTEREST CAME FROM THE FIRST MINUTE. OI is a level, not a flow: the
//    bar's OI is where it stood when the bar CLOSED. Taking the first minute's
//    reading reported the previous bar's OI under this bar's timestamp.
//
// 3. STAMPS WERE EMITTED IN UTC. `toISOString()` produced "...T03:30:00.000Z"
//    while Upstox's own candles, and every consumer that reads the clock
//    straight off the text, use "...T09:00:00+05:30". The 15-minute series fed
//    to the live session-trend card therefore labelled its session high
//    "03:45" instead of "09:15". Resampled bars now carry the same +05:30 form
//    as native ones, so the text and the instant agree.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SESSION_OPEN_MIN = 9 * 60;

/** The minimal shape resampling needs. Worker and frontend candles both fit. */
export interface ResampleCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  oi?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant rendered the way Upstox stamps candles: IST with +05:30. */
export function toIstStamp(ms: number): string {
  const t = new Date(ms + IST_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00+05:30`;
}

/** The start of the bucket an instant belongs to, anchored at 09:00 IST that day. */
export function sessionBucketStart(ms: number, minutesPerBucket: number): number {
  const bucketMs = minutesPerBucket * 60_000;
  const ist = new Date(ms + IST_OFFSET_MS);
  const sessionOpen = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) + SESSION_OPEN_MIN * 60_000 - IST_OFFSET_MS;
  return sessionOpen + Math.floor((ms - sessionOpen) / bucketMs) * bucketMs;
}

export function resampleCandles<C extends ResampleCandle>(candles: C[], minutesPerBucket: number): C[] {
  if (!candles.length) return [];
  const out: C[] = [];
  let bucketStart: number | null = null;
  let cur: C | null = null;

  for (const c of candles) {
    const t = sessionBucketStart(new Date(c.date).getTime(), minutesPerBucket);
    if (t !== bucketStart) {
      if (cur) out.push(cur);
      bucketStart = t;
      cur = { ...c, date: toIstStamp(t), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0, oi: c.oi };
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
      // Latest reading wins. Zero is Upstox's placeholder for "no OI reported"
      // on that minute, not a real collapse to zero, so it never overwrites a
      // genuine reading.
      if (typeof c.oi === "number" && c.oi > 0) cur.oi = c.oi;
    }
  }
  if (cur) out.push(cur);
  return out;
}
