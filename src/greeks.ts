// Black-76 option pricing, Greeks and implied volatility for options on
// futures, time-to-expiry measured to the MCX close, and max pain.

import { mcxCloseInstant } from "../frontend/src/utils/mcxSession";
import { r2 } from "./env";

// ---- Options Greeks (Black-76, for options on futures) ----
// MCX commodity options are options on the futures contract (not the spot),
// so Black-76 is the correct model (vs. plain Black-Scholes, which assumes
// a spot underlying with a dividend yield). r is a flat approximation of
// India's risk-free rate; it mainly affects discounting, not direction.
export const RISK_FREE_RATE = 0.065;

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normCDF(x: number) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function normPDF(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 vol point (1%)
  rho: number; // per 1 rate point (1%)
}

function black76Price(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0) return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const df = Math.exp(-r * T);
  return isCall ? df * (F * normCDF(d1) - K * normCDF(d2)) : df * (K * normCDF(-d2) - F * normCDF(-d1));
}

export function black76Greeks(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): Greeks {
  if (T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * T);
  const price = black76Price(F, K, T, r, sigma, isCall);

  const delta = isCall ? df * normCDF(d1) : -df * normCDF(-d1);
  const gamma = (df * normPDF(d1)) / (F * sigma * sqrtT);
  const vega = (F * df * normPDF(d1) * sqrtT) / 100; // per 1 vol point
  const thetaAnnual = isCall
    ? -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) + r * df * (F * normCDF(d1)) - r * df * (K * normCDF(d2))
    : -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) - r * df * (F * normCDF(-d1)) + r * df * (K * normCDF(-d2));
  const theta = thetaAnnual / 365;
  const rho = (-T * price) / 100; // per 1 rate point

  // Gamma especially needs more than 2 decimal places at these underlying
  // price scales (often 0.0001-0.001) -- r2 would round it straight to 0.
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { delta: r6(delta), gamma: r6(gamma), theta: r6(theta), vega: r6(vega), rho: r6(rho) };
}

// Solves for implied volatility from a market premium via bisection --
// slower than Newton-Raphson but immune to the divergence issues Newton's
// method has near expiry / deep ITM-OTM strikes, which matters more here
// than raw speed for a handful of strikes per request.
export function impliedVolatility(marketPrice: number, F: number, K: number, T: number, r: number, isCall: boolean): number | null {
  if (marketPrice <= 0 || T <= 0) return null;
  let lo = 0.001;
  let hi = 5.0;
  const intrinsic = isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  if (marketPrice < intrinsic * Math.exp(-r * T)) return null; // below intrinsic, no valid IV
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const price = black76Price(F, K, T, r, mid, isCall);
    if (Math.abs(price - marketPrice) < 1e-4) return r2(mid * 100);
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return r2(((lo + hi) / 2) * 100);
}

// Measured to MCX's close on the expiry date, not to "YYYY-MM-DD" parsed as UTC
// midnight. The old form hit zero at 05:30 IST on expiry day -- a whole
// trading session early -- and Black-Scholes with T = 0 has no IV to solve
// for and Greeks that divide by zero, so the final day's numbers were junk.
// It also understated T by roughly 18 hours on every other day.
export function yearsToExpiry(expiry: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  const endMs = m ? mcxCloseInstant(Number(m[1]), Number(m[2]), Number(m[3])) : new Date(expiry).getTime();
  const ms = endMs - Date.now();
  return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 0);
}

// The strike where option writers (sellers) collectively owe the least if
// the underlying settles there at expiry -- a common (not guaranteed) magnet
// for price to drift toward as expiry approaches, since option sellers are
// typically the better-capitalized side of the trade.
export function computeMaxPain(chain: any[]): number | null {
  if (!chain.length) return null;
  const strikes = chain.map((r) => r.strike_price);
  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const r of chain) {
      const callOI = r.call_options?.market_data?.oi || 0;
      const putOI = r.put_options?.market_data?.oi || 0;
      pain += callOI * Math.max(settle - r.strike_price, 0);
      pain += putOI * Math.max(r.strike_price - settle, 0);
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}
