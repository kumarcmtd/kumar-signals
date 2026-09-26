# Analysis-quality review (items 11–13)

Report only. **No logic was changed for these three items** — each needs a
decision from you first. Code references are to `worker.ts` unless noted.

---

## 11. PCR and max-OI support/resistance use only ±10 strikes

**Confirmed.** `buildChainFromContracts` keeps the 10 strikes either side of
spot (21 strikes) before fetching quotes. `analyzeChain` then computes PCR,
max-call-OI "resistance" and max-put-OI "support" over those rows only.
`computeMaxPain` runs on the same trimmed chain.

**Was it intended?** The window was intended — but for **cost**, not method.
Its comment says the aim is to avoid spending rate-limit budget quoting deep
ITM/OTM strikes. PCR and max OI being computed on the window is a side
effect, not a design choice.

**Why it matters:**

- **PCR won't match what you see elsewhere.** The "PCR" quoted by MCX and most
  platforms is over the whole series. Ours is a near-the-money PCR. The
  bullish/bearish thresholds (above 1.2 / below 0.8) are the conventional
  whole-chain ones, applied to a different number.
- **It gates trades.** `buildTradeSignal` refuses a pattern trade when the PCR
  bias disagrees with the pattern, and labels agreement "High confidence". So
  the windowed PCR is not just displayed — it vetoes and upgrades calls.
- **Max-OI levels can be an artefact of the window edge.** If the real
  heaviest strike sits outside ±10, "resistance" becomes simply the biggest
  strike *inside* the window, which may be the outermost one.
- **Open trades shift PCR.** Strikes with an open trade are pinned into the
  chain even when far from spot. Their OI then enters the PCR total, so PCR
  (and therefore the gate) can change depending on whether you are holding
  a trade. This one is a genuine bug regardless of which PCR you prefer.

**Options — your call:**

1. **Full-chain PCR/max-OI, fetched less often** *(recommended)*. Quote the
   whole series every ~5 minutes for PCR, max OI and max pain; keep the ±10
   window at 20s for live premiums. Costs roughly one extra Upstox quote call
   per symbol every 5 minutes.
2. **Keep near-the-money PCR, but own it.** Label it "ATM PCR (±10 strikes)",
   exclude pinned strikes from the totals, and recalibrate thresholds from our
   own history rather than the whole-chain convention.
3. **Minimum fix only:** exclude pinned strikes from PCR/max-OI/max-pain.

---

## 12. Contract roll is by expiry date only

**Confirmed.** The "nearest future" is the first contract whose expiry has not
passed (after Phase 2, it rolls at the close on expiry day). Nothing looks at
open interest or volume.

**Why it matters:**

- **The last days of a contract are its least representative.** Traders roll
  to next month several sessions before expiry, so the front month thins out
  and moves erratically while every candle, signal and pattern on the app
  still comes from it.
- **Options already expire earlier than the future.** The code already knows
  this (`resolveOptionChainAcrossFutures` falls back to the next future when
  the front month's options have stopped listing). So near expiry the app can
  be reading candles from one contract and options from another.
- **The 270-day daily history is one contract's life.** `fetchHistoricalCandles`
  requests 270 days of daily bars for the *current* front-month
  `instrument_key`. A monthly MCX future is only actively traded for its last
  month or two; most of those 270 days are when it was a far-month contract
  with thin volume and wide spreads. Daily indicators (moving averages, ATR,
  the gap and time-of-day studies) are partly built on that thin stretch.

**Proposal — your call:**

1. **Roll early, by open interest.** Switch to the next contract once its OI
   exceeds the front month's, or a fixed N trading days (e.g. 3) before the
   front month's *option* expiry — whichever comes first. Needs quotes for two
   futures per symbol, which we largely have already.
2. **Stitch a continuous series for history.** Build daily history by joining
   successive front months at their roll dates (back-adjusted), so 270 days
   means 270 days of the contract that was actually being traded. Upstox has
   an expired-instruments history API that would make this possible; I have
   not verified its availability or limits for your account.

---

## 13. Textbook pattern reliability next to heuristic matches

**Confirmed, but currently latent.** `PATTERN_RELIABILITY` (65% Double Top,
84% Inverse H&S, …) is Bulkowski-style literature data for other markets and
timeframes. It is attached to every pattern result in the API. **I found no
screen that renders it today** — the pattern tile shows the name, direction
and a "High/Medium" confidence that comes from pattern-plus-OI agreement, not
from this table. So nobody is currently misled on screen; the risk is the
number being surfaced later and read as "84% chance for this trade".

Also note: after Phase 1 our detectors are stricter (recency, already-broke,
target and stop checks), so even the definition of a "match" no longer
resembles the studies those figures came from.

**Suggestion — your call:**

1. **Replace with our own hit rates** *(recommended)*. Every pattern trade
   already lands in the trade log with its outcome. Report, per pattern name,
   "N closed, X hit target" — and show nothing below a minimum sample (the app
   already uses this rule elsewhere, e.g. the overnight study's "too few").
2. **Or keep it, labelled:** rename the field to `literatureReliability` and,
   wherever it is ever shown, caption it "textbook figure, other markets —
   not measured on MCX".
3. **Or drop it** from the API until option 1 exists.

Phase 1 already stopped it influencing anything: the new best-match ranking
deliberately does not use it.
