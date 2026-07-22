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

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
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

function trueRanges(candles: Candle[]): number[] {
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

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const tr = trueRanges(candles);
  const series = ema(tr, period);
  return series[series.length - 1];
}

export function adx(candles: Candle[], period = 14): number | null {
  if (candles.length < period * 2) return null;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = trueRanges(candles);
  const smoothTR = ema(tr, period);
  const smoothPlusDM = ema(plusDM, period);
  const smoothMinusDM = ema(minusDM, period);
  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) {
      // No true-range movement at all (e.g. a stretch of identical-OHLC
      // candles during an illiquid/no-trade period) -- 0/0 would be NaN,
      // and once introduced it poisons every later EMA value permanently.
      // No range movement means no directional strength either, so 0 is
      // the correct reading, not an error.
      dx.push(0);
      continue;
    }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }
  const adxSeries = ema(dx, period);
  const result = adxSeries[adxSeries.length - 1];
  return Number.isFinite(result) ? result : null;
}

export function superTrend(
  candles: Candle[],
  period = 10,
  multiplier = 3
): { value: number; direction: Direction } | null {
  if (candles.length < period + 1) return null;
  const tr = trueRanges(candles);
  const atrSeries = ema(tr, period);
  let upperBand = 0;
  let lowerBand = 0;
  let trendUp = true;
  let stValue = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    const mid = (candles[i].high + candles[i].low) / 2;
    const basicUpper = mid + multiplier * atrSeries[i];
    const basicLower = mid - multiplier * atrSeries[i];
    upperBand = basicUpper < upperBand || candles[i - 1].close > upperBand ? basicUpper : upperBand;
    lowerBand = basicLower > lowerBand || candles[i - 1].close < lowerBand ? basicLower : lowerBand;
    if (candles[i].close > upperBand) trendUp = true;
    else if (candles[i].close < lowerBand) trendUp = false;
    stValue = trendUp ? lowerBand : upperBand;
  }
  return { value: stValue, direction: trendUp ? "bullish" : "bearish" };
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
    vwap: vwap(candles),
    atr14: atr(candles),
    adx14: adxValue,
    superTrend: st,
    bollinger: bollingerBands(closes),
    pivots: candles.length >= 2 ? pivotPoints(candles[candles.length - 2]) : null,
    trendDirection,
    momentumScore,
  };
}
