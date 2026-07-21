export type InstrumentSymbol = "CRUDEOIL" | "NATURALGAS" | "GOLD" | "SILVER";

export type Direction = "bullish" | "bearish" | "neutral";
export type OptionSide = "CE" | "PE";

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  oi?: number;
}

export interface MarketStatus {
  isOpen: boolean;
  timeLabel: string;
  mcxStatus: string;
}

export interface PriceCard {
  symbol: InstrumentSymbol;
  tradingSymbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number | null;
  oi: number | null;
  high: number | null;
  low: number | null;
  lastUpdated: string;
}

export interface TradeSignal {
  action: string; // e.g. "BUY 6500 CE" or "NO TRADE"
  optSide?: OptionSide;
  strike?: number;
  premiumEntry?: number;
  premiumTarget?: number;
  premiumStop?: number;
  confidence?: string;
  pcr?: number | null;
  note: string;
}

export interface PatternSignal {
  pattern: string;
  direction: Direction;
  entry: number | string;
  stop: number | string;
  target: number | string;
  reliability: number | null;
  note: string;
}

export interface SignalCard {
  symbol: InstrumentSymbol;
  tradingSymbol: string;
  expiry: string;
  currentPrice: number;
  lastDate: string;
  pattern: PatternSignal;
  trade: TradeSignal;
  error?: string;
}

export interface Greeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

export interface OptionLeg extends Greeks {
  ltp: number | null;
  oi: number | null;
  iv: number | null;
}

export interface OptionRowAnalytics {
  strike: number;
  call: OptionLeg;
  put: OptionLeg;
}

export interface OptionsAnalytics {
  symbol: InstrumentSymbol;
  tradingSymbol: string;
  expiry: string;
  spot: number;
  atmStrike: number | null;
  pcr: number | null;
  bias: Direction;
  support: number | null;
  resistance: number | null;
  maxPain: number | null;
  rows: OptionRowAnalytics[];
  error?: string;
}

export interface IndicatorSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  vwap: number | null;
  atr14: number | null;
  adx14: number | null;
  superTrend: { value: number; direction: Direction } | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  pivots: { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } | null;
  trendDirection: Direction;
  momentumScore: number | null;
}

export interface PortfolioTrade {
  id: string;
  symbol: InstrumentSymbol;
  optSide?: OptionSide;
  strike?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  lotSize: number;
  stopLoss?: number;
  target?: number;
  entryDate: string;
  exitDate?: string;
  status: "OPEN" | "CLOSED";
  pnl?: number;
  notes?: string;
  source?: "manual" | "master-ai" | "signal";
}

export interface GlobalQuote {
  symbol: string;
  name: string;
  tracksMCX: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string | null;
  error?: string;
}
