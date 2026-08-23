import type { Candle, Direction, IndicatorSnapshot } from "../types";

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const series = ema(values, period);
  return series[series.length - 1];
}

// Wilder's smoothing (a.k.a. RMA / SMMA): an exponential average with
// alpha = 1/period, SEEDED with a simple average of the first `period`
// values. This is the smoothing RSI, ATR and ADX are actually defined
// against on TradingView and every standard charting platform -- a plain EMA
// (alpha = 2/(period+1)) reacts noticeably faster and gives readings that
// won't line up with the chart a trader is cross-checking. Returns the full
// smoothed series; out[0] aligns to values[period-1].
function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  const out: number[] = [seed];
  for (let i = period; i < values.length; i++) {
    const prev = out[out.length - 1];
    out.push(prev + (values[i] - prev) / period);
  }
  return out;
}

// Wilder RSI at every bar (out[0] aligns to values[period]), so both the
// scalar rsi() and stochasticRsi() read from the same, standard definition.
function rsiSeries(values: number[], period = 14): number[] {
  if (values.length < period + 1) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);
  const out: number[] = [];
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  const series = rsiSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

// Stochastic RSI: the stochastic %K formula over a rolling window of the
// (Wilder) RSI series itself rather than price -- reads overbought/oversold
// on the momentum oscillator, and now uses the same standard RSI as above.
export function stochasticRsi(values: number[], rsiPeriod = 14, stochPeriod = 14): number | null {
  const series = rsiSeries(values, rsiPeriod);
  if (series.length < stochPeriod) return null;
  const window = series.slice(series.length - stochPeriod);
  const minR = Math.min(...window);
  const maxR = Math.max(...window);
  if (maxR === minR) return 50; // flat RSI window carries no directional info
  return ((window[window.length - 1] - minR) / (maxR - minR)) * 100;
}

// On-Balance Volume: a running total of volume, added on up-closes and
// subtracted on down-closes. Rising OBV alongside rising price confirms the
// move is backed by volume; a flattening/falling OBV during a price rise is
// a classic volume-non-confirmation warning.
export function onBalanceVolume(candles: Candle[]): number[] {
  if (!candles.length) return [];
  const out: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume ?? 0;
    if (candles[i].close > candles[i - 1].close) out.push(out[i - 1] + vol);
    else if (candles[i].close < candles[i - 1].close) out.push(out[i - 1] - vol);
    else out.push(out[i - 1]);
  }
  return out;
}

// Simple OBV trend read: compares the latest OBV to its value `lookback` bars
// ago, normalized against the OBV range over that window so the result is a
// unitless direction+strength rather than a raw (unbounded) volume number.
export function obvTrend(candles: Candle[], lookback = 20): { direction: Direction; strength: number } | null {
  const series = onBalanceVolume(candles);
  if (series.length < lookback + 1) return null;
  const window = series.slice(series.length - lookback - 1);
  const change = window[window.length - 1] - window[0];
  const range = Math.max(...window) - Math.min(...window);
  const strength = range > 0 ? Math.min(Math.abs(change) / range, 1) * 100 : 0;
  const direction: Direction = change > 0 ? "bullish" : change < 0 ? "bearish" : "neutral";
  return { direction, strength: Math.round(strength) };
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { line: number; signal: number; histogram: number } | null {
  if (values.length < slow + signalPeriod) return null;
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine.slice(slow - 1), signalPeriod);
  const line = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { line, signal, histogram: line - signal };
}

export function vwap(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 0;
    cumPV += typical * vol;
    cumV += vol;
  }
  if (cumV === 0) return candles[candles.length - 1].close;
  return cumPV / cumV;
}

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

// VWAP is conventionally anchored to a single trading session, resetting
// each day -- but candle arrays can now span many days (fetched history
// stitched onto today's live feed for the higher timeframes). Restrict to
// just the most recent session's bars before computing it, regardless of
// how far back the rest of the array goes.
function latestSessionOnly(candles: Candle[]): Candle[] {
  if (!candles.length) return candles;
  const lastDay = IST_DATE_FORMATTER.format(new Date(candles[candles.length - 1].date));
  const idx = candles.findIndex((c) => IST_DATE_FORMATTER.format(new Date(c.date)) === lastDay);
  return idx === -1 ? candles : candles.slice(idx);
}

export function trueRanges(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out.push(candles[i].high - candles[i].low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    out.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose)
      )
    );
  }
  return out;
}

// Wilder ATR -- the standard definition, matching TradingView (was an EMA of
// true range before, which reacts faster and reads differently).
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const series = wilderSmooth(trueRanges(candles), period);
  return series.length ? series[series.length - 1] : null;
}

// Wilder ADX: TR and the directional movements are Wilder-smoothed (not a
// plain EMA), then DX, then ADX is Wilder-smoothed again -- the standard
// two-stage smoothing every platform uses.
export function adx(candles: Candle[], period = 14): number | null {
  if (candles.length < period * 2) return null;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  // Drop the first true range (index 0 has no previous close) so TR lines up
  // one-to-one with the directional-movement series, which start at i=1.
  const trFrom1 = trueRanges(candles).slice(1);
  const smoothTR = wilderSmooth(trFrom1, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);
  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) {
      // No true-range movement at all (e.g. a stretch of identical-OHLC
      // candles during an illiquid/no-trade period) -- 0/0 would be NaN, and
      // once introduced it poisons every later smoothed value permanently.
      // No range movement means no directional strength either, so 0 is the
      // correct reading, not an error.
      dx.push(0);
      continue;
    }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }
  const adxSeries = wilderSmooth(dx, period);
  const result = adxSeries.length ? adxSeries[adxSeries.length - 1] : NaN;
  return Number.isFinite(result) ? result : null;
}

// SuperTrend with proper final-band persistence. The previous version
// initialized the bands to 0, which defeated the "carry the locked band
// forward until price genuinely breaks it" step -- so it collapsed to raw
// basic bands and flipped direction far more often than the real indicator.
// This carries finalUpper/finalLower forward per Wilder's rules and only
// flips trend on a real close through the opposite band.
export function superTrend(
  candles: Candle[],
  period = 10,
  multiplier = 3
): { value: number; direction: Direction } | null {
  if (candles.length < period + 1) return null;
  const atrSeries = wilderSmooth(trueRanges(candles), period); // atrSeries[k] -> candle index (period-1)+k
  const startIdx = period - 1;
  let finalUpper = 0;
  let finalLower = 0;
  let trendUp = true;
  let prevClose = candles[startIdx].close;
  for (let k = 0; k < atrSeries.length; k++) {
    const c = candles[startIdx + k];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * atrSeries[k];
    const basicLower = hl2 - multiplier * atrSeries[k];
    if (k === 0) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      trendUp = c.close >= hl2;
    } else {
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
      if (trendUp && c.close <= finalLower) trendUp = false;
      else if (!trendUp && c.close >= finalUpper) trendUp = true;
    }
    prevClose = c.close;
  }
  return { value: trendUp ? finalLower : finalUpper, direction: trendUp ? "bullish" : "bearish" };
}

// Commodity Channel Index: how far the typical price sits from its moving
// average, scaled by mean absolute deviation. Standard reading: > +100
// overbought/strong uptrend, < -100 oversold/strong downtrend.
export function cci(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const window = candles.slice(candles.length - period);
  const typicalPrices = window.map((c) => (c.high + c.low + c.close) / 3);
  const sma = typicalPrices.reduce((s, v) => s + v, 0) / period;
  const meanDeviation = typicalPrices.reduce((s, v) => s + Math.abs(v - sma), 0) / period;
  if (meanDeviation === 0) return 0;
  const lastTypical = typicalPrices[typicalPrices.length - 1];
  return (lastTypical - sma) / (0.015 * meanDeviation);
}

export function bollingerBands(
  values: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number } | null {
  if (values.length < period) return null;
  const window = values.slice(values.length - period);
  const mean = window.reduce((s, v) => s + v, 0) / period;
  const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + stdDevMultiplier * stdDev,
    middle: mean,
    lower: mean - stdDevMultiplier * stdDev,
  };
}

export function pivotPoints(prevCandle: Candle) {
  const { high, low, close } = prevCandle;
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  const r3 = high + 2 * (pivot - low);
  const s3 = low - 2 * (high - pivot);
  return { pivot, r1, r2, r3, s1, s2, s3 };
}

// Central Pivot Range: bc/tc bracket the pivot into a "value area" band.
// A narrow CPR (tc close to bc) suggests a trending day; a wide CPR suggests
// more likely range-bound/sideways action.
export function centralPivotRange(prevCandle: Candle) {
  const { high, low, close } = prevCandle;
  const pivot = (high + low + close) / 3;
  const bc = (high + low) / 2;
  const tc = pivot + (pivot - bc);
  return { pivot, bc: Math.min(bc, tc), tc: Math.max(bc, tc) };
}

export function computeIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const macdResult = macd(closes);
  const st = superTrend(candles);
  const adxValue = adx(candles);
  const rsiValue = rsi(closes);

  let trendDirection: Direction = "neutral";
  if (st) trendDirection = st.direction;

  let momentumScore: number | null = null;
  if (rsiValue !== null && adxValue !== null) {
    const rsiComponent = (rsiValue - 50) * 2; // -100..100
    const adxComponent = Math.min(adxValue, 50) * 2; // 0..100, strength only
    momentumScore = Math.round((rsiComponent + (trendDirection === "bearish" ? -adxComponent : adxComponent)) / 2);
  }

  return {
    ema9: emaLast(closes, 9),
    ema20: emaLast(closes, 20),
    ema50: emaLast(closes, 50),
    ema200: emaLast(closes, 200),
    rsi14: rsiValue,
    macd: macdResult,
    vwap: vwap(latestSessionOnly(candles)),
    atr14: atr(candles),
    adx14: adxValue,
    superTrend: st,
    bollinger: bollingerBands(closes),
    pivots: candles.length >= 2 ? pivotPoints(candles[candles.length - 2]) : null,
    trendDirection,
    momentumScore,
  };
}
