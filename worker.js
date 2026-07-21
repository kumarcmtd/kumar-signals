const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_HIST_URL = "https://api.upstox.com/v2/historical-candle";
const UPSTOX_OPTION_CHAIN_URL = "https://api.upstox.com/v2/option/chain";

const THEME = {
  CRUDEOIL: { grad: "linear-gradient(135deg,#ff8a00,#e52e71)", light: "#fff4e8" },
  NATURALGAS: { grad: "linear-gradient(135deg,#00c6ff,#0072ff)", light: "#e8f6ff" },
};

// Approximate historical success rates commonly cited in technical-analysis
// literature (e.g. Bulkowski-style pattern studies). Educational reference
// figures only — NOT a backtest of this instrument, NOT a guarantee.
const PATTERN_RELIABILITY = {
  "Double Top": 65, "Double Bottom": 66,
  "Head and Shoulders": 83, "Inverse Head and Shoulders": 84,
  "Ascending Triangle": 72, "Descending Triangle": 71, "Symmetrical Triangle": 60,
  "Rising Wedge": 62, "Falling Wedge": 68,
  "Bullish Flag / Pennant": 68, "Bearish Flag / Pennant": 67,
  "Bullish Rectangle": 60, "Bearish Rectangle": 60,
};

function pct(a, b) { return Math.abs(a - b) / ((a + b) / 2); }
function r2(x) { return Math.round(x * 100) / 100; }

function findSwings(candles, look = 2) {
  const highs = [], lows = [];
  for (let i = look; i < candles.length - look; i++) {
    let isH = true, isL = true;
    for (let j = i - look; j <= i + look; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isH = false;
      if (candles[j].low <= candles[i].low) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].high, date: candles[i].date });
    if (isL) lows.push({ i, price: candles[i].low, date: candles[i].date });
  }
  return { highs, lows };
}

function detectDoubleTop(highs, lows) {
  if (highs.length < 2) return null;
  const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
  if (pct(h1.price, h2.price) > 0.025) return null;
  const between = lows.filter(l => l.i > h1.i && l.i < h2.i);
  if (!between.length) return null;
  const neckline = Math.min(...between.map(l => l.price));
  const height = (h1.price + h2.price) / 2 - neckline;
  if (height <= 0) return null;
  return {
    pattern: "Double Top", direction: "bearish",
    entry: r2(neckline * 0.998), stop: r2(Math.max(h1.price, h2.price) * 1.01),
    target: r2(neckline - height),
    note: `Twin peaks near ${r2(h1.price)} & ${r2(h2.price)}, neckline support around ${r2(neckline)}.`
  };
}

function detectDoubleBottom(highs, lows) {
  if (lows.length < 2) return null;
  const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
  if (pct(l1.price, l2.price) > 0.025) return null;
  const between = highs.filter(h => h.i > l1.i && h.i < l2.i);
  if (!between.length) return null;
  const neckline = Math.max(...between.map(h => h.price));
  const height = neckline - (l1.price + l2.price) / 2;
  if (height <= 0) return null;
  return {
    pattern: "Double Bottom", direction: "bullish",
    entry: r2(neckline * 1.002), stop: r2(Math.min(l1.price, l2.price) * 0.99),
    target: r2(neckline + height),
    note: `Twin troughs near ${r2(l1.price)} & ${r2(l2.price)}, neckline resistance around ${r2(neckline)}.`
  };
}

function detectHeadShoulders(highs, lows) {
  if (highs.length < 3) return null;
  const [L, H, R] = highs.slice(-3);
  if (!(H.price > L.price * 1.008 && H.price > R.price * 1.008)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftT = lows.filter(l => l.i > L.i && l.i < H.i);
  const rightT = lows.filter(l => l.i > H.i && l.i < R.i);
  if (!leftT.length || !rightT.length) return null;
  const neckline = (leftT[leftT.length - 1].price + rightT[0].price) / 2;
  const height = H.price - neckline;
  if (height <= 0) return null;
  return {
    pattern: "Head and Shoulders", direction: "bearish",
    entry: r2(neckline * 0.997), stop: r2(R.price * 1.012),
    target: r2(neckline - height),
    note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.`
  };
}

function detectInverseHeadShoulders(highs, lows) {
  if (lows.length < 3) return null;
  const [L, H, R] = lows.slice(-3);
  if (!(H.price < L.price * 0.992 && H.price < R.price * 0.992)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftP = highs.filter(h => h.i > L.i && h.i < H.i);
  const rightP = highs.filter(h => h.i > H.i && h.i < R.i);
  if (!leftP.length || !rightP.length) return null;
  const neckline = (leftP[leftP.length - 1].price + rightP[0].price) / 2;
  const height = neckline - H.price;
  if (height <= 0) return null;
  return {
    pattern: "Inverse Head and Shoulders", direction: "bullish",
    entry: r2(neckline * 1.003), stop: r2(R.price * 0.988),
    target: r2(neckline + height),
    note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.`
  };
}

function detectAscendingTriangle(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  const flatRes = pct(h[0].price, h[1].price) < 0.015 && pct(h[1].price, h[2].price) < 0.015;
  const risingLows = l[0].price < l[1].price * 0.999 && l[1].price < l[2].price * 0.999;
  if (!flatRes || !risingLows) return null;
  const resistance = (h[0].price + h[1].price + h[2].price) / 3;
  const height = resistance - l[0].price;
  if (height <= 0) return null;
  return {
    pattern: "Ascending Triangle", direction: "bullish",
    entry: r2(resistance * 1.003), stop: r2(l[2].price * 0.99),
    target: r2(resistance + height),
    note: `Flat resistance near ${r2(resistance)} with rising swing lows — bullish breakout setup.`
  };
}

function detectDescendingTriangle(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  const flatSup = pct(l[0].price, l[1].price) < 0.015 && pct(l[1].price, l[2].price) < 0.015;
  const fallingHighs = h[0].price > h[1].price * 1.001 && h[1].price > h[2].price * 1.001;
  if (!flatSup || !fallingHighs) return null;
  const support = (l[0].price + l[1].price + l[2].price) / 3;
  const height = h[0].price - support;
  if (height <= 0) return null;
  return {
    pattern: "Descending Triangle", direction: "bearish",
    entry: r2(support * 0.997), stop: r2(h[2].price * 1.01),
    target: r2(support - height),
    note: `Flat support near ${r2(support)} with falling swing highs — bearish breakdown setup.`
  };
}

function detectRisingWedge(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  if (!(h[0].price < h[1].price && h[1].price < h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const widthStart = h[0].price - l[0].price, widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  return {
    pattern: "Rising Wedge", direction: "bearish",
    entry: r2(l[2].price * 0.995), stop: r2(h[2].price * 1.01),
    target: r2(l[2].price - widthStart),
    note: `Converging rising channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bearish reversal risk.`
  };
}

function detectFallingWedge(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price > l[1].price && l[1].price > l[2].price)) return null;
  const widthStart = h[0].price - l[0].price, widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  return {
    pattern: "Falling Wedge", direction: "bullish",
    entry: r2(h[2].price * 1.005), stop: r2(l[2].price * 0.99),
    target: r2(h[2].price + widthStart),
    note: `Converging falling channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bullish reversal setup.`
  };
}

function detectFlagPennant(candles) {
  const n = candles.length;
  if (n < 25) return null;
  const poleStart = candles[n - 20], poleEnd = candles[n - 8];
  const poleMove = poleEnd.close - poleStart.close;
  const poleRange = Math.abs(poleMove);
  if (poleRange / poleStart.close < 0.03) return null;
  const recent = candles.slice(n - 7);
  const recentHigh = Math.max(...recent.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low));
  if (recentHigh - recentLow > poleRange * 0.5) return null;
  if (poleMove > 0) {
    return {
      pattern: "Bullish Flag / Pennant", direction: "bullish",
      entry: r2(recentHigh * 1.003), stop: r2(recentLow * 0.99),
      target: r2(recentHigh + poleRange),
      note: `Sharp rally of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.`
    };
  }
  return {
    pattern: "Bearish Flag / Pennant", direction: "bearish",
    entry: r2(recentLow * 0.997), stop: r2(recentHigh * 1.01),
    target: r2(recentLow - poleRange),
    note: `Sharp decline of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.`
  };
}

function detectRectangle(highs, lows, candles) {
  if (highs.length < 2 || lows.length < 2) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  if (h.length < 2 || l.length < 2) return null;
  const flatRes = h.every((x, idx) => idx === 0 || pct(x.price, h[0].price) < 0.015);
  const flatSup = l.every((x, idx) => idx === 0 || pct(x.price, l[0].price) < 0.015);
  if (!flatRes || !flatSup) return null;
  const resistance = h.reduce((s, x) => s + x.price, 0) / h.length;
  const support = l.reduce((s, x) => s + x.price, 0) / l.length;
  const height = resistance - support;
  if (height <= 0 || height / support > 0.15) return null;
  const startIdx = Math.min(h[0].i, l[0].i);
  const prior = candles.slice(Math.max(0, startIdx - 15), startIdx);
  const priorUp = prior.length > 2 ? prior[prior.length - 1].close > prior[0].close : true;
  if (priorUp) {
    return {
      pattern: "Bullish Rectangle", direction: "bullish",
      entry: r2(resistance * 1.003), stop: r2(support * 0.99), target: r2(resistance + height),
      note: `Range-bound between ${r2(support)} and ${r2(resistance)} after an uptrend — continuation setup on an upside break.`
    };
  }
  return {
    pattern: "Bearish Rectangle", direction: "bearish",
    entry: r2(support * 0.997), stop: r2(resistance * 1.01), target: r2(support - height),
    note: `Range-bound between ${r2(support)} and ${r2(resistance)} after a downtrend — continuation setup on a downside break.`
  };
}

function detectSymmetricalTriangle(highs, lows) {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3), l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const height = h[0].price - l[0].price;
  return {
    pattern: "Symmetrical Triangle", direction: "neutral",
    entry: `${r2(h[2].price * 1.003)} (bullish break) / ${r2(l[2].price * 0.997)} (bearish break)`,
    stop: "Opposite side of whichever breakout triggers",
    target: `± ${r2(height)} projected from the breakout price`,
    note: `Converging highs & lows — wait for confirmation above ${r2(h[2].price)} or below ${r2(l[2].price)}.`
  };
}

function analyzeCommodity(candles) {
  const { highs, lows } = findSwings(candles, 2);
  const detectors = [
    () => detectHeadShoulders(highs, lows),
    () => detectInverseHeadShoulders(highs, lows),
    () => detectDoubleTop(highs, lows),
    () => detectDoubleBottom(highs, lows),
    () => detectAscendingTriangle(highs, lows),
    () => detectDescendingTriangle(highs, lows),
    () => detectRisingWedge(highs, lows),
    () => detectFallingWedge(highs, lows),
    () => detectFlagPennant(candles),
    () => detectRectangle(highs, lows, candles),
    () => detectSymmetricalTriangle(highs, lows),
  ];
  for (const d of detectors) {
    const res = d();
    if (res) {
      res.reliability = PATTERN_RELIABILITY[res.pattern] || null;
      return res;
    }
  }
  return {
    pattern: "No Clear Pattern", direction: "neutral",
    entry: "-", stop: "-", target: "-", reliability: null,
    note: "Price action doesn't currently match a well-defined chart pattern. Best to wait for clearer structure."
  };
}

async function getNearestFuture(token, query) {
  const usp = new URLSearchParams({ query, exchanges: "MCX", instrument_types: "FUT", records: "10" });
  const res = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json();
  if (json.status !== "success" || !json.data || !json.data.length) return null;
  const contracts = [...json.data].sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  const nearest = contracts[0];
  return { instrument_key: nearest.instrument_key, expiry: nearest.expiry, trading_symbol: nearest.trading_symbol };
}

async function getHistoricalCandles(token, instrumentKey) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 270);
  const fmt = d => d.toISOString().slice(0, 10);
  const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/day/${fmt(to)}/${fmt(from)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json = await res.json();
  if (json.status !== "success" || !json.data || !json.data.candles) return null;
  const candles = json.data.candles.map(c => ({ date: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
  candles.sort((a, b) => new Date(a.date) - new Date(b.date));
  return candles;
}

// MCX commodity options are options on the futures contract, so the option
// chain is queried with the same instrument_key/expiry as the nearest future.
async function getOptionChain(token, instrumentKey, expiryDate) {
  const usp = new URLSearchParams({ instrument_key: instrumentKey, expiry_date: expiryDate });
  const res = await fetch(`${UPSTOX_OPTION_CHAIN_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json();
  if (json.status !== "success" || !json.data || !json.data.length) {
    const msg = json.errors ? json.errors.map(e => e.message).join("; ") : (json.status !== "success" ? "Option chain request failed" : "No strikes returned");
    return { error: msg };
  }
  return { chain: json.data };
}

function nearestStrikes(chain, spot, sideCount = 6) {
  const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
  let atmIdx = 0, atmDiff = Infinity;
  sorted.forEach((row, i) => {
    const diff = Math.abs(row.strike_price - spot);
    if (diff < atmDiff) { atmDiff = diff; atmIdx = i; }
  });
  const start = Math.max(0, atmIdx - sideCount);
  const end = Math.min(sorted.length, atmIdx + sideCount + 1);
  return { rows: sorted.slice(start, end), atmStrike: sorted.length ? sorted[atmIdx].strike_price : null };
}

function analyzeChain(chain) {
  let maxCallOI = null, maxPutOI = null, totalCallOI = 0, totalPutOI = 0;
  for (const r of chain) {
    const callOI = r.call_options?.market_data?.oi || 0;
    const putOI = r.put_options?.market_data?.oi || 0;
    totalCallOI += callOI;
    totalPutOI += putOI;
    if (!maxCallOI || callOI > maxCallOI.oi) maxCallOI = { strike: r.strike_price, oi: callOI };
    if (!maxPutOI || putOI > maxPutOI.oi) maxPutOI = { strike: r.strike_price, oi: putOI };
  }
  const pcr = totalCallOI > 0 ? r2(totalPutOI / totalCallOI) : null;
  const bias = pcr == null ? "neutral" : pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral";
  return {
    pcr,
    resistance: maxCallOI ? maxCallOI.strike : null, // heaviest Call OI = resistance
    support: maxPutOI ? maxPutOI.strike : null,       // heaviest Put OI = support
    bias,
  };
}

// Combines the chart-pattern direction (from the future's price action) with
// the option chain's PCR/OI bias into one actionable ATM option buy call.
// Premium target/stop are a rough delta≈0.5 (ATM) projection off the pattern's
// underlying target/stop — not a pricing model. Theta decay & IV moves mean
// actual premiums can diverge; always track the live quote.
function buildTradeSignal(pattern, spot, chainAnalysis, atmRow) {
  if (pattern.direction === "neutral" || typeof pattern.entry !== "number" ||
      typeof pattern.stop !== "number" || typeof pattern.target !== "number") {
    return { action: "NO TRADE", note: "No clear directional pattern yet — wait for a breakout before buying an option." };
  }
  if (!atmRow) {
    return { action: "NO TRADE", note: "Option chain strikes unavailable near spot." };
  }

  const isBullish = pattern.direction === "bullish";
  const optSide = isBullish ? "CE" : "PE";
  const optData = isBullish ? atmRow.call_options?.market_data : atmRow.put_options?.market_data;
  const premium = optData?.ltp;
  if (!premium || premium <= 0) {
    return { action: "NO TRADE", note: "No live premium quote for the ATM strike right now." };
  }

  const favMove = isBullish ? (pattern.target - spot) : (spot - pattern.target);
  const riskMove = isBullish ? (spot - pattern.stop) : (pattern.stop - spot);
  const DELTA = 0.5;
  const premiumTarget = r2(premium + DELTA * favMove);
  const premiumStop = r2(Math.max(premium * 0.35, premium - DELTA * riskMove));

  let confidence = "Medium (pattern only, OI neutral)";
  if (chainAnalysis.bias === pattern.direction) confidence = "High (pattern + OI agree)";
  else if (chainAnalysis.bias !== "neutral" && chainAnalysis.bias !== pattern.direction) confidence = "Low (OI data conflicts with pattern)";

  return {
    action: `BUY ${atmRow.strike_price} ${optSide}`,
    optSide,
    strike: atmRow.strike_price,
    premiumEntry: premium,
    premiumTarget,
    premiumStop,
    confidence,
    note: `${isBullish ? "Call" : "Put"} bought near ATM strike ${atmRow.strike_price}, premium ~₹${premium}. Premium target/SL are a rough delta-based estimate off the ${pattern.pattern} target/stop — track the live premium, don't rely on this alone.`
  };
}

async function computeOptionsSignals(token) {
  const out = {};
  for (const q of ["CRUDEOIL", "NATURALGAS"]) {
    try {
      const fut = await getNearestFuture(token, q);
      if (!fut) { out[q] = { error: "No instrument found" }; continue; }

      const candles = await getHistoricalCandles(token, fut.instrument_key);
      const spot = candles && candles.length ? candles[candles.length - 1].close : null;

      const chainRes = await getOptionChain(token, fut.instrument_key, fut.expiry);
      if (chainRes.error) {
        out[q] = { error: chainRes.error, trading_symbol: fut.trading_symbol, expiry: fut.expiry };
        continue;
      }

      const refPrice = spot ?? chainRes.chain[0]?.underlying_spot_price ?? 0;
      const { rows, atmStrike } = nearestStrikes(chainRes.chain, refPrice, 6);
      const analysis = analyzeChain(chainRes.chain);

      out[q] = {
        trading_symbol: fut.trading_symbol,
        expiry: fut.expiry,
        spot: refPrice,
        atmStrike,
        rows,
        ...analysis,
      };
    } catch (e) {
      out[q] = { error: e.message };
    }
  }
  return out;
}

async function computeSignals(token) {
  const out = {};
  for (const q of ["CRUDEOIL", "NATURALGAS"]) {
    try {
      const fut = await getNearestFuture(token, q);
      if (!fut) { out[q] = { error: "No instrument found" }; continue; }
      const candles = await getHistoricalCandles(token, fut.instrument_key);
      if (!candles || candles.length < 40) {
        out[q] = { error: "Not enough historical data yet", trading_symbol: fut.trading_symbol };
        continue;
      }
      const analysis = analyzeCommodity(candles);
      const spot = candles[candles.length - 1].close;

      let trade = { action: "NO TRADE", note: "Option chain unavailable." };
      const chainRes = await getOptionChain(token, fut.instrument_key, fut.expiry);
      if (!chainRes.error) {
        const chainAnalysis = analyzeChain(chainRes.chain);
        const { atmStrike } = nearestStrikes(chainRes.chain, spot, 1);
        const atmRow = chainRes.chain.find(r => r.strike_price === atmStrike);
        trade = buildTradeSignal(analysis, spot, chainAnalysis, atmRow);
        trade.pcr = chainAnalysis.pcr;
      } else {
        trade = { action: "NO TRADE", note: chainRes.error };
      }

      out[q] = {
        trading_symbol: fut.trading_symbol,
        expiry: fut.expiry,
        currentPrice: spot,
        lastDate: candles[candles.length - 1].date,
        ...analysis,
        trade,
      };
    } catch (e) {
      out[q] = { error: e.message };
    }
  }
  return out;
}

function renderSignalsHTML(signals) {
  const keys = Object.keys(signals);
  let cards = "";

  keys.forEach(q => {
    const s = signals[q];
    const theme = THEME[q] || { grad: "linear-gradient(135deg,#999,#666)", light: "#f2f2f2" };

    if (s.error) {
      cards += `
      <div class="card">
        <div class="hero" style="background:${theme.grad}"><p class="symbol">${q}</p></div>
        <div class="body"><p class="err">${s.error}${s.trading_symbol ? " (" + s.trading_symbol + ")" : ""}</p></div>
      </div>`;
      return;
    }

    const dirColor = s.direction === "bullish" ? "#0a9d3f" : s.direction === "bearish" ? "#e0263f" : "#888";
    const dirLabel = s.direction === "bullish" ? "BUY / BULLISH" : s.direction === "bearish" ? "SELL / BEARISH" : "NEUTRAL / WAIT";
    const relBadge = s.reliability
      ? `<span class="relbadge">~${s.reliability}% typical reliability*</span>`
      : `<span class="relbadge muted">n/a</span>`;

    const t = s.trade;
    const tradeIsLive = t && t.action !== "NO TRADE";
    const tradeBox = t ? `
        <div class="tradeBox" style="border-left-color:${tradeIsLive ? dirColor : '#ccc'}">
          <p class="tradeAction" style="color:${tradeIsLive ? dirColor : '#888'}">${t.action}</p>
          ${tradeIsLive ? `
          <div class="tradeGrid">
            <div class="gcell"><span>Premium Entry</span><b>₹${t.premiumEntry}</b></div>
            <div class="gcell"><span>Premium Target</span><b>₹${t.premiumTarget}</b></div>
            <div class="gcell"><span>Premium SL</span><b>₹${t.premiumStop}</b></div>
            <div class="gcell"><span>Confidence</span><b class="conf">${t.confidence}</b></div>
          </div>` : ``}
          <p class="tradeNote">${t.note}</p>
        </div>` : ``;

    cards += `
    <div class="card">
      <div class="hero" style="background:${theme.grad}">
        <p class="symbol">${q} · ${s.trading_symbol}</p>
        <p class="expiry">Expiry ${s.expiry} · as of ${s.lastDate}</p>
        <p class="ltp">₹${s.currentPrice}</p>
      </div>
      <div class="body" style="background:${theme.light}">
        <div class="patternRow">
          <span class="patternName">${s.pattern}</span>
          <span class="dirBadge" style="background:${dirColor}">${dirLabel}</span>
        </div>
        <div class="grid">
          <div class="gcell"><span>Entry</span><b>${s.entry}</b></div>
          <div class="gcell"><span>Stop Loss</span><b>${s.stop}</b></div>
          <div class="gcell"><span>Target</span><b>${s.target}</b></div>
          <div class="gcell"><span>Reliability</span><b>${relBadge}</b></div>
        </div>
        <p class="note">${s.note}</p>
        ${tradeBox}
      </div>
    </div>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Signals</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, sans-serif; background:#f5f6fa; color:#222; margin:0; padding:16px; }
  h1 { font-size:22px; margin:0 0 4px 0; background:linear-gradient(90deg,#6a11cb,#2575fc); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { font-size:13px; color:#888; margin-bottom:16px; }
  .nav { font-size:13px; color:#2575fc; text-decoration:none; display:inline-block; margin-bottom:16px; }
  .card { border-radius:16px; overflow:hidden; margin-bottom:18px; box-shadow:0 4px 14px rgba(0,0,0,0.08); }
  .hero { padding:18px 20px; color:#fff; }
  .symbol { margin:0; font-size:14px; opacity:0.9; }
  .expiry { margin:2px 0 8px 0; font-size:12px; opacity:0.8; }
  .ltp { margin:0; font-size:30px; font-weight:bold; }
  .body { padding:16px 18px 18px 18px; }
  .patternRow { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
  .patternName { font-size:17px; font-weight:bold; color:#222; }
  .dirBadge { color:#fff; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:20px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
  .gcell { background:#fff; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; }
  .gcell span { font-size:11px; color:#888; }
  .gcell b { font-size:16px; color:#222; margin-top:2px; }
  .relbadge { font-size:14px; color:#2575fc; }
  .relbadge.muted { color:#999; }
  .note { font-size:13px; color:#444; line-height:1.5; margin:0; }
  .tradeBox { margin-top:14px; padding:12px 14px; background:#fff; border-radius:10px; border-left:4px solid #ccc; }
  .tradeAction { margin:0 0 8px 0; font-size:16px; font-weight:bold; }
  .tradeGrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
  .tradeGrid .gcell { background:#f7f7fa; padding:8px 10px; }
  .tradeGrid .conf { font-size:13px; }
  .tradeNote { font-size:12px; color:#666; line-height:1.5; margin:0; }
  .err { color:#e0263f; padding:14px; }
  .disclaimer { font-size:11px; color:#999; line-height:1.6; margin-top:14px; padding:14px; background:#fff; border-radius:12px; }
</style>
</head>
<body>
  <h1>Kumar Commodity Signals</h1>
  <p class="sub">Reads the token your main Kumar Commodity Options worker already keeps in KV — no separate login needed here.</p>
  <a class="nav" href="/options">Option chain (strikes, OI, PCR) →</a>
  ${cards}
  <div class="disclaimer">
    *Reliability figures are approximate historical success rates commonly cited in
    technical-analysis literature for each classical chart pattern. General reference
    numbers only — not a backtest of MCX Crude Oil / Natural Gas specifically, and not
    a guarantee of future results. Patterns are detected algorithmically from daily
    candles of the nearest-month future using swing-pivot rules — always confirm on the
    live chart and manage risk before acting.<br><br>
    Options trade calls (BUY CE/PE) combine that pattern direction with the nearest-expiry
    ATM strike's live premium and the chain's Put/Call OI bias for a confidence read — they
    are not a priced option model. Premium target/SL are a rough delta≈0.5 projection off
    the pattern's underlying target/stop; actual premiums also move with time decay (theta)
    and implied volatility, especially close to expiry, so track the live quote and size
    positions accordingly. This is not financial advice.
  </div>
</body>
</html>`;
}

function fmtNum(n) { return (n === null || n === undefined || Number.isNaN(n)) ? "-" : (Math.round(n * 100) / 100).toLocaleString("en-IN"); }

function renderOptionsHTML(signals) {
  const keys = Object.keys(signals);
  let tabButtons = "";
  let panels = "";

  keys.forEach((q, i) => {
    const s = signals[q];
    const theme = THEME[q] || { grad: "linear-gradient(135deg,#999,#666)", light: "#f2f2f2" };
    const active = i === 0 ? "active" : "";
    tabButtons += `<button class="tab ${active}" style="background:${theme.grad}" onclick="showTab('${q}')" id="btn-${q}">${q}</button>`;

    if (s.error) {
      panels += `
      <div class="panel ${active}" id="panel-${q}">
        <p class="err">${s.error}${s.trading_symbol ? " (" + s.trading_symbol + ")" : ""}</p>
      </div>`;
      return;
    }

    const dirColor = s.bias === "bullish" ? "#0a9d3f" : s.bias === "bearish" ? "#e0263f" : "#888";
    const dirLabel = s.bias === "bullish" ? "PCR BULLISH" : s.bias === "bearish" ? "PCR BEARISH" : "PCR NEUTRAL";

    let rows = "";
    s.rows.forEach(r => {
      const isAtm = r.strike_price === s.atmStrike;
      const ce = r.call_options?.market_data || {};
      const pe = r.put_options?.market_data || {};
      rows += `
      <tr class="${isAtm ? "atm" : ""}">
        <td>${fmtNum(ce.oi)}</td>
        <td>${fmtNum(ce.ltp)}</td>
        <td class="strike">${fmtNum(r.strike_price)}</td>
        <td>${fmtNum(pe.ltp)}</td>
        <td>${fmtNum(pe.oi)}</td>
      </tr>`;
    });

    panels += `
    <div class="panel ${active}" id="panel-${q}">
      <div class="hero" style="background:${theme.grad}">
        <p class="symbol">${q} · ${s.trading_symbol}</p>
        <p class="expiry">Expiry ${s.expiry} · Spot ₹${fmtNum(s.spot)}</p>
        <span class="dirBadge" style="background:${dirColor}">${dirLabel} (${s.pcr ?? "-"})</span>
      </div>
      <div class="body" style="background:${theme.light}">
        <div class="grid">
          <div class="gcell"><span>Support (Max Put OI)</span><b>${fmtNum(s.support)}</b></div>
          <div class="gcell"><span>Resistance (Max Call OI)</span><b>${fmtNum(s.resistance)}</b></div>
        </div>
        <div class="tableWrap">
          <table>
            <thead><tr><th>Call OI</th><th>Call LTP</th><th>Strike</th><th>Put LTP</th><th>Put OI</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Options Chain</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, sans-serif; background:#f5f6fa; color:#222; margin:0; padding:16px; }
  h1 { font-size:22px; margin:0 0 4px 0; background:linear-gradient(90deg,#6a11cb,#2575fc); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { font-size:13px; color:#888; margin-bottom:16px; }
  .nav { font-size:13px; color:#2575fc; text-decoration:none; display:inline-block; margin-bottom:16px; }
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { flex:1; border:none; padding:12px 0; border-radius:12px; color:#fff; font-weight:bold; font-size:15px; opacity:0.5; }
  .tab.active { opacity:1; box-shadow:0 4px 12px rgba(0,0,0,0.2); }
  .panel { display:none; }
  .panel.active { display:block; }
  .hero { border-radius:16px 16px 0 0; padding:18px 20px; color:#fff; }
  .symbol { margin:0; font-size:14px; opacity:0.9; }
  .expiry { margin:2px 0 10px 0; font-size:12px; opacity:0.8; }
  .dirBadge { color:#fff; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:20px; background:rgba(255,255,255,0.25); }
  .body { padding:16px 18px 18px 18px; border-radius:0 0 16px 16px; margin-bottom:18px; box-shadow:0 4px 14px rgba(0,0,0,0.08); }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .gcell { background:#fff; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; }
  .gcell span { font-size:11px; color:#888; }
  .gcell b { font-size:16px; color:#222; margin-top:2px; }
  .tableWrap { overflow-x:auto; background:#fff; border-radius:10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { padding:8px 10px; text-align:center; white-space:nowrap; }
  th { color:#888; font-size:11px; border-bottom:1px solid #eee; }
  td.strike { font-weight:bold; }
  tr.atm { background:#fff9e0; }
  .err { color:#e0263f; padding:14px; background:#fff; border-radius:12px; }
  .disclaimer { font-size:11px; color:#999; line-height:1.6; margin-top:14px; padding:14px; background:#fff; border-radius:12px; }
</style>
</head>
<body>
  <h1>Kumar Commodity Options Chain</h1>
  <p class="sub">Nearest-expiry MCX option chain for the token your main Kumar Commodity Options worker keeps in KV.</p>
  <a class="nav" href="/">← Back to pattern signals</a>
  <div class="tabs">${tabButtons}</div>
  ${panels}
  <div class="disclaimer">
    OI = open interest. Support/Resistance are the strikes carrying the heaviest Put/Call OI in the
    displayed window, a common (not guaranteed) read of where price may find friction. PCR = total Put OI
    ÷ total Call OI across the window; above ~1.2 is read as bullish, below ~0.8 as bearish. Educational
    reference only — not financial advice.
  </div>
  <script>
    function showTab(q) {
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
      document.getElementById('btn-' + q).classList.add('active');
      document.getElementById('panel-' + q).classList.add('active');
    }
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/json") {
        const token = await env.COMMODITY_KV.get("access_token");
        if (!token) return new Response("No token found in KV. Log in via your main kumarcmtd worker's /login first.", { status: 400 });
        const results = await computeSignals(token);
        return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
      }

      if (url.pathname === "/options/json") {
        const token = await env.COMMODITY_KV.get("access_token");
        if (!token) return new Response("No token found in KV. Log in via your main kumarcmtd worker's /login first.", { status: 400 });
        const results = await computeOptionsSignals(token);
        return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
      }

      if (url.pathname === "/options") {
        const token = await env.COMMODITY_KV.get("access_token");
        if (!token) {
          return new Response(
            "No token found in KV yet. Log in via your main kumarcmtd worker's /login page first, then reload this page.",
            { headers: { "Content-Type": "text/html" } }
          );
        }
        const results = await computeOptionsSignals(token);
        return new Response(renderOptionsHTML(results), { headers: { "Content-Type": "text/html" } });
      }

      if (url.pathname === "/") {
        const token = await env.COMMODITY_KV.get("access_token");
        if (!token) {
          return new Response(
            "No token found in KV yet. Log in via your main kumarcmtd worker's /login page first, then reload this page.",
            { headers: { "Content-Type": "text/html" } }
          );
        }
        const results = await computeSignals(token);
        return new Response(renderSignalsHTML(results), { headers: { "Content-Type": "text/html" } });
              }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
};
