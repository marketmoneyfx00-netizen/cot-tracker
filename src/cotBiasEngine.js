import { polymarketService } from './polymarket/index.js';

/**
 * cotBiasEngine.js — Institutional Bias Engine
 *
 * Generates a weekly HTF Bias Score from -5 to +5 based on COT data.
 * This is NOT a trade entry signal — it is a directional filter / HTF permission.
 *
 * Score scale:
 *   +5 → Very Bullish   (only longs)
 *   +4 → Strong Bullish
 *   +3 → Bullish
 *   +2 → Bullish Bias   (prioritize longs)
 *   +1 → Slight Bullish Edge
 *    0 → Neutral / Range
 *   -1 → Slight Bearish Edge
 *   -2 → Bearish Bias   (prioritize shorts)
 *   -3 → Bearish
 *   -4 → Strong Bearish
 *   -5 → Very Bearish   (aggressive shorts in HTF zones)
 *
 * Usage:
 *   const result = calculateBiasScore(data);
 */

// ─── FACTOR 1 — LEVERAGED MONEY WEEKLY CHANGE ────────────────────────────────
// Primary driver. Large institutional repositioning this week.
// Input: data.leveragedWeeklyChange (integer, contract count delta)
// V1: absolute thresholds (backward compat fallback)
function scoreLeveragedFlow(change) {
  if (typeof change !== 'number' || isNaN(change)) return 0;
  if (change >= 10000)  return  2;
  if (change >= 3000)   return  1;
  if (change <= -10000) return -2;
  if (change <= -3000)  return -1;
  return 0;
}

// V2: z-score relative to pair's own historical weekly changes.
// A 3K move in NZD (z=2.5) is far more significant than 3K in EUR (z=0.3).
// Input: data.leveragedFlowZScore (float — computed in deriveInputsFromPair)
function scoreLeveragedFlowZ(z) {
  if (typeof z !== 'number' || isNaN(z)) return 0;
  if (z >= 2.0)  return  2;
  if (z >= 1.0)  return  1;
  if (z <= -2.0) return -2;
  if (z <= -1.0) return -1;
  // Smooth gradient between ±0.5 and ±1.0 to avoid cliff edges
  if (z > 0.5)  return  parseFloat((z - 0.5).toFixed(2));
  if (z < -0.5) return  parseFloat((z + 0.5).toFixed(2));
  return 0;
}

// ─── FACTOR 2 — PRICE VS POSITIONING DIVERGENCE ──────────────────────────────
// Critical factor. Divergence between price movement and positioning reveals
// smart money intent: accumulating against price = strong reversal signal.
// Inputs: data.priceDirection ("up"|"down"), data.positioningDirection ("up"|"down")
function scoreDivergence(priceDir, posDir) {
  if (!priceDir || !posDir) return 0;
  const p = priceDir.toLowerCase();
  const q = posDir.toLowerCase();
  if (p === 'up'   && q === 'up')   return  1;  // aligned bullish
  if (p === 'down' && q === 'down') return -1;  // aligned bearish
  if (p === 'up'   && q === 'down') return -2;  // distribution — bearish signal
  if (p === 'down' && q === 'up')   return  2;  // accumulation — bullish signal
  return 0;
}

// ─── FACTOR 3 — HISTORICAL EXTREMITY (PERCENTILE) ────────────────────────────
// Extreme positioning is a contrarian signal: overextended longs are fuel for selloffs.
// Input: data.positionPercentile (0–100)
// V2: smooth continuous function instead of binary step.
// Eliminates the cliff between percentile 79 (0) and 81 (-1).
// Output range preserved at [-1, +1] for V2_MAX_RAW compatibility.
function scorePercentile(percentile) {
  if (typeof percentile !== 'number' || isNaN(percentile)) return 0;
  // Extremes keep full weight; gradient tapers smoothly through the middle.
  if (percentile >= 85) return -1;
  if (percentile <= 15) return  1;
  // Linear gradient: 85 → -1.0 ... 50 → 0 ... 15 → +1.0
  return parseFloat(Math.max(-1, Math.min(1, -(percentile - 50) / 35)).toFixed(2));
}

// ─── FACTOR 4 — ASSET MANAGERS CONFIRMATION ──────────────────────────────────
// Asset managers are slower money but confirm trend when aligned with Leveraged.
// Input: data.assetManagersChange (integer, delta contracts)
// V2: magnitude-aware. 100K AM move ≠ 1K AM move.
// Normalized at 25K contracts = full ±1 score; scales linearly below.
function scoreAssetManagers(change) {
  if (typeof change !== 'number' || isNaN(change)) return 0;
  if (change === 0) return 0;
  const magnitude = Math.min(1, Math.abs(change) / 25000);
  return parseFloat((Math.sign(change) * magnitude).toFixed(2));
}

// ─── FACTOR 5 — DEALERS EXTREME FILTER ───────────────────────────────────────
// Dealers are typically counter-trend (market makers). Their extreme positioning
// signals that they expect institutional flow in the opposite direction.
// Input: data.dealersExtreme ("short"|"long"|"neutral")
function scoreDealers(extreme) {
  if (!extreme) return 0;
  const v = extreme.toLowerCase();
  if (v === 'short') return -1;
  if (v === 'long')  return  1;
  return 0;
}

// ─── POLYMARKET MACRO CONFIDENCE (Phase 2) ───────────────────────────────────
// Reads MSC and RRC from polymarketService (if ready) to derive a macroConfidence
// multiplier in [0.75, 1.0]. Conservative: never zeros the COT signal, never
// inverts direction. Returns 1.0 (no adjustment) when Polymarket is unavailable.
function _computePolymarketConf(pair) {
  try {
    if (!polymarketService.isReady()) return 1.0;
    const m = polymarketService.getMetrics();
    if (!m) return 1.0;

    const mscVal = m.msc?.value ?? null;
    const rrcVal = m.rrc?.value ?? null;
    const rrcRegime = m.rrc?.regime ?? null;

    let conf = 1.0;

    // MSC-based attenuation: elevated macro stress reduces COT predictive weight.
    // High-stress regimes cause institutional positioning to reflect defensive flow
    // rather than directional conviction — COT signals become noisier.
    if (typeof mscVal === 'number') {
      if (mscVal >= 70)      conf = Math.max(0.75, conf - 0.20);
      else if (mscVal >= 55) conf = Math.max(0.82, conf - 0.12);
      else if (mscVal >= 42) conf = Math.max(0.90, conf - 0.05);
    }

    // RRC-based adjustment for risk-sensitive FX pairs (AUD, NZD, CAD).
    // Recession risk building → their COT signals carry less structural conviction.
    if (typeof rrcVal === 'number' && pair) {
      const isRiskSensitive = /AUD|NZD|CAD/.test(pair);
      if (isRiskSensitive) {
        if (rrcRegime === 'HIGH_RISK' || rrcRegime === 'SEVERE') {
          conf = Math.max(0.75, conf - 0.10);
        } else if (rrcRegime === 'ELEVATED') {
          conf = Math.max(0.82, conf - 0.05);
        }
      }
    }

    return parseFloat(conf.toFixed(3));
  } catch {
    return 1.0;
  }
}

// ─── LABEL MAP ────────────────────────────────────────────────────────────────
function getLabel(score) {
  if (score >= 4)          return 'Strong Bullish Bias';
  if (score >= 2)          return 'Bullish Bias';
  if (score === 1)         return 'Slight Bullish Edge';
  if (score === 0)         return 'Neutral / Range';
  if (score >= -2)         return 'Slight Bearish Edge';
  if (score >= -4)         return 'Bearish Bias';
  return                          'Strong Bearish Bias';
}

function getDirection(score) {
  if (score >= 1.5)  return 'bullish';
  if (score > -1.5)  return 'neutral';
  return 'bearish';
}

// Semantic state aligned with V2 label thresholds
function getSemanticState(score) {
  if (score >= 4)    return 'strong_bull';
  if (score >= 1.5)  return 'bull';
  if (score > -1.5)  return 'neutral';
  if (score > -4)    return 'bear';
  return                   'strong_bear';
}

// ─── RECOMMENDATION ENGINE ───────────────────────────────────────────────────
function getRecommendation(score) {
  if (score >= 4)  return 'Strong bullish structural edge. Long bias preferred — confirm tactical context before acting.';
  if (score >= 2)  return 'Bullish structural bias. Favorable for longs — await tactical alignment and price structure.';
  if (score === 1) return 'Slight bullish structural edge. Monitor for tactical confirmation before positioning.';
  if (score === 0) return 'No structural directional edge. Await COT confirmation and price structure.';
  if (score >= -2) return 'Slight bearish structural edge. Monitor for tactical confirmation before positioning.';
  if (score >= -4) return 'Bearish structural bias. Favorable for shorts — await tactical alignment and price structure.';
  return                  'Strong bearish structural edge. Short bias preferred — confirm tactical context before acting.';
}

// ─── COLOR HELPER (for UI use) ────────────────────────────────────────────────
// Thresholds intentionally aligned with V2 semantic label ranges.
// Neutral zone (-1.5 to +1.5) renders slate — not pink — so "Neutral / Divergence"
// states are never visually mistaken for a bearish signal.
function getBiasColor(score) {
  if (score >= 4)    return '#22c55e'; // strong bull
  if (score >= 1.5)  return '#4ade80'; // bull
  if (score > -1.5)  return '#94a3b8'; // neutral / divergence
  if (score > -4)    return '#f87171'; // bear
  return                   '#ef4444'; // strong bear
}


// ─── V2 WEIGHT CONSTANTS ─────────────────────────────────────────────────────
const V2_WEIGHTS = {
  leveragedFlow:    1.5,
  divergence:       1.0,
  historicalExtreme:1.5,
  assetManagers:    1.5,
  dealersFilter:    0.5,
};

// Maximum possible raw score with V2 weights (for normalization to -5..+5):
// Max per factor: leveragedFlow=2, divergence=2, historicalExtreme=1, assetManagers=1, dealers=1
// Weighted max = (2*1.5) + (2*1.0) + (1*1.5) + (1*1.5) + (1*0.5) = 3+2+1.5+1.5+0.5 = 8.5
const V2_MAX_RAW = 8.5;

// ─── V2 LABEL MAP ─────────────────────────────────────────────────────────────
function getLabelV2(score) {
  if (score >= 4)    return 'Strong Bullish Edge';
  if (score >= 1.5)  return 'Moderate Bullish Bias';
  if (score > -1.5)  return 'Neutral / Divergence';
  if (score > -4)    return 'Moderate Bearish Bias';
  return                   'Strong Bearish Edge';
}

// ─── V2 RECOMMENDATION ────────────────────────────────────────────────────────
function getRecommendationV2(score) {
  if (score >= 4)
    return 'Strong bullish structural edge. Long bias preferred — confirm tactical context and price structure before acting.';

  if (score >= 1.5)
    return 'Moderate bullish structural bias. Favorable for longs — await tactical alignment before positioning.';

  if (score > -1.5)
    return 'No structural directional edge. Await COT confirmation and price structure.';

  if (score > -4)
    return 'Moderate bearish structural bias. Favorable for shorts — await tactical alignment before positioning.';

  return 'Strong bearish structural edge. Short bias preferred — confirm tactical context and price structure before acting.';
}

// ─── V2 SCORING ENGINE ────────────────────────────────────────────────────────
/**
 * calculateInstitutionalBiasV2
 *
 * Weighted scoring engine with macro confidence multiplier.
 * Normalizes to -5..+5 range. Falls back to V1 on any malformed input.
 *
 * @param {Object} data         - Same input shape as calculateBiasScore()
 * @param {number} [data.macroConfidence] - Optional 0.0–1.0 multiplier (default 1.0)
 * @returns {Object}            - Identical output shape to calculateBiasScore()
 */
export function calculateInstitutionalBiasV2(data = {}) {
  // ── Null guard → fallback to V1 ─────────────────────────────────────────
  if (!data) return calculateBiasScore(null);

  try {
    // Prefer z-score relative flow when available (market-size-aware)
    const leveragedFlow   = data.leveragedFlowZScore != null
      ? scoreLeveragedFlowZ(data.leveragedFlowZScore)
      : scoreLeveragedFlow(data.leveragedWeeklyChange);
    const divergence      = scoreDivergence(data.priceDirection, data.positioningDirection);
    const historicalEx    = scorePercentile(data.positionPercentile);
    const assetManagers   = scoreAssetManagers(data.assetManagersChange);
    const dealers         = scoreDealers(data.dealersExtreme);

    // ── Malformed-input guard: if all factors are 0 and inputs look missing,
    //    fall back gracefully rather than returning misleading neutral score ──
    const hasAnyInput = (
      data.leveragedWeeklyChange != null ||
      data.priceDirection        != null ||
      data.positionPercentile    != null ||
      data.assetManagersChange   != null ||
      data.dealersExtreme        != null
    );
    if (!hasAnyInput) return calculateBiasScore(data);

    // ── Weighted raw score ────────────────────────────────────────────────
    const rawScore =
      (leveragedFlow  * V2_WEIGHTS.leveragedFlow)    +
      (divergence     * V2_WEIGHTS.divergence)        +
      (historicalEx   * V2_WEIGHTS.historicalExtreme) +
      (assetManagers  * V2_WEIGHTS.assetManagers)     +
      (dealers        * V2_WEIGHTS.dealersFilter);

    // ── Normalize to -5..+5 via max-raw-score scaling ────────────────────
    const normalizedRaw = V2_MAX_RAW > 0
      ? (rawScore / V2_MAX_RAW) * 5
      : rawScore;

    // ── Macro confidence multiplier (default 1.0 if absent/invalid) ──────
    const macroConf = (
      typeof data.macroConfidence === 'number' &&
      !isNaN(data.macroConfidence) &&
      data.macroConfidence >= 0 &&
      data.macroConfidence <= 1
    ) ? data.macroConfidence : 1.0;

    const finalRaw = normalizedRaw * macroConf;

    // ── Safe clamp + decimal precision to -5..+5 ───────────────────────────
    const score = Math.max(-5, Math.min(5, Number(finalRaw.toFixed(1))));

    // ── NaN guard → fall back to V1 ──────────────────────────────────────
    if (isNaN(score)) return calculateBiasScore(data);

    return {
      score,
      label:          getLabelV2(score),
      direction:      getDirection(score),
      color:          getBiasColor(score),
      state:          getSemanticState(score),
      recommendation: getRecommendationV2(score),
      breakdown: {
        leveragedFlow,
        divergence,
        percentile:    historicalEx,                 // key kept for UI compatibility
        assetManagers,
        dealers,
      },
      // V2 metadata (ignored by UI — backward safe)
      _v2: {
        rawWeighted:      rawScore,
        normalized:       normalizedRaw,
        macroConfidence:  macroConf,
        weightsApplied:   V2_WEIGHTS,
      },
    };
  } catch {
    // Any unexpected error → silent fallback to V1
    return calculateBiasScore(data);
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
/**
 * calculateBiasScore
 *
 * @param {Object} data
 * @param {number}  data.leveragedWeeklyChange   - Leveraged Money net change (contracts)
 * @param {string}  data.priceDirection          - "up" | "down"
 * @param {string}  data.positioningDirection    - "up" | "down"
 * @param {number}  data.positionPercentile      - 0–100 historical percentile
 * @param {number}  data.assetManagersChange     - Asset Managers net change (contracts)
 * @param {string}  data.dealersExtreme          - "short" | "long" | "neutral"
 *
 * @returns {Object} Bias result with score, label, direction, recommendation, breakdown
 */
/**
 * calculateBiasScore
 *
 * Public export. Routes to V2 engine (calculateInstitutionalBiasV2) with
 * automatic fallback to V1 logic on any error or malformed input.
 * Output shape is identical regardless of which engine runs.
 *
 * @param {Object} data  - Same input shape as before (backward compatible)
 * @returns {Object}     - { score, label, direction, color, recommendation, breakdown }
 */
export function calculateBiasScore(data = {}) {
  // ── V1 null guard (kept for backward compatibility) ───────────────────────
  if (!data) {
    return {
      score: 0,
      label: 'Neutral / Divergence',
      direction: 'neutral',
      color: '#94a3b8',
      state: 'neutral',
      recommendation: 'Waiting for new COT data',
      breakdown: { leveragedFlow:0, divergence:0, percentile:0, assetManagers:0, dealers:0 },
    };
  }

  // ── V1 ENGINE (preserved as fallback — do not remove) ────────────────────
  function _v1() {
    const leveragedFlow  = scoreLeveragedFlow(data.leveragedWeeklyChange);
    const divergence     = scoreDivergence(data.priceDirection, data.positioningDirection);
    const percentile     = scorePercentile(data.positionPercentile);
    const assetManagers  = scoreAssetManagers(data.assetManagersChange);
    const dealers        = scoreDealers(data.dealersExtreme);
    const rawScore = leveragedFlow + divergence + percentile + assetManagers + dealers;
    const score    = Math.max(-5, Math.min(5, rawScore));
    return {
      score,
      label:          getLabel(score),
      direction:      getDirection(score),
      color:          getBiasColor(score),
      state:          getSemanticState(score),
      recommendation: getRecommendation(score),
      breakdown: { leveragedFlow, divergence, percentile, assetManagers, dealers },
    };
  }

  // ── ACTIVE ENGINE: V2 with V1 fallback ───────────────────────────────────
  try {
    const v2Result = calculateInstitutionalBiasV2(data);
    // Extra NaN/null guard on the returned score before accepting V2 result
    if (!v2Result || typeof v2Result.score !== 'number' || isNaN(v2Result.score)) {
      return _v1();
    }
    return v2Result;
  } catch {
    return _v1();
  }
}

// ─── DERIVE FROM PROCESSED PAIR DATA (COT Tracker native format) ─────────────
/**
 * deriveInputsFromPair
 *
 * Helper to compute bias engine inputs from the native COT Tracker
 * pair object (built by buildProcessedRow + pairsData structure in App.jsx).
 *
 * @param {Object} pairData                 - from pairsData: { latest, weeks, signal, pair }
 * @param {number|null} realPriceChangePct  - Optional: real price % change over the available
 *                                            candle window (passed from candleMap; window size
 *                                            depends on hook config — currently ~5 days at 4H).
 *                                            When provided, replaces the COT-proxy price direction.
 * @returns {Object}                        - ready-to-pass to calculateBiasScore()
 */
export function deriveInputsFromPair(pairData, realPriceChangePct = null) {
  if (!pairData || !pairData.latest || !pairData.weeks) return null;

  const { latest, weeks } = pairData;
  const prev = weeks[1] || null;

  // Factor 1 — Leveraged weekly change (smart money = levLong/levShort)
  const leveragedWeeklyChange = prev
    ? (latest.smartNet - prev.smartNet)
    : 0;

  // Factor 1 V2 — Z-score of weekly change relative to pair's own history.
  // Normalises flow significance by market size: 3K in NZD ≠ 3K in EUR.
  const leveragedFlowZScore = (() => {
    const changes = [];
    for (let i = 1; i < weeks.length; i++) {
      const c = weeks[i - 1], p = weeks[i];
      if (c.smartNet != null && p.smartNet != null) changes.push(c.smartNet - p.smartNet);
    }
    if (changes.length < 4) return null;
    const mean = changes.reduce((s, v) => s + v, 0) / changes.length;
    const variance = changes.reduce((s, v) => s + (v - mean) ** 2, 0) / changes.length;
    const std = Math.sqrt(variance);
    if (std < 1) return null;
    return parseFloat(((leveragedWeeklyChange - mean) / std).toFixed(2));
  })();

  // Factor 2 — Price vs Positioning divergence
  // priceDirection: prefer injected real price return; fall back to COT 4-week proxy.
  // positioningDirection: derived from the immediate weekly change (COT-native, correct).
  const priceDirection = (() => {
    // Source 1: real price % change injected from candleMap (eliminates COT-as-price tautology)
    if (typeof realPriceChangePct === 'number' && !isNaN(realPriceChangePct)) {
      const threshold = 0.15; // 5-day window → tighter noise threshold than 4-week
      if (realPriceChangePct > threshold)  return 'up';
      if (realPriceChangePct < -threshold) return 'down';
      return null;
    }
    // Source 2: 4-week COT smartNet change as HTF proxy (fallback — not ideal)
    if (!prev) return null;
    const week3 = weeks[3] ?? null;
    if (latest.smartNet != null && week3?.smartNet != null) {
      const d = latest.smartNet - week3.smartNet;
      return d > 0 ? 'up' : d < 0 ? 'down' : null;
    }
    if (latest.smartNet != null && prev.smartNet != null) {
      return latest.smartNet > prev.smartNet ? 'up'
           : latest.smartNet < prev.smartNet ? 'down'
           : null;
    }
    return null;
  })();
  const positioningDirection = leveragedWeeklyChange > 0 ? 'up' : leveragedWeeklyChange < 0 ? 'down' : null;

  // Factor 3 — Historical percentile of current smartNet vs last 52 weeks
  const allNets = weeks.map(w => w.smartNet).filter(n => typeof n === 'number');
  let positionPercentile = 50;
  if (allNets.length >= 3) {
    const min = Math.min(...allNets);
    const max = Math.max(...allNets);
    const range = max - min;
    positionPercentile = range > 0
      ? Math.round(((latest.smartNet - min) / range) * 100)
      : 50;
  }

  // Factor 4 — Asset Managers change
  const assetManagersChange = prev && latest.assetNet != null && prev.assetNet != null
    ? latest.assetNet - prev.assetNet
    : 0;

  // Factor 5 — Dealers extreme
  const dealersExtreme = (() => {
    if (latest.dealerNet == null) return 'neutral';
    // Use percentile approach: if dealers are in extreme short/long territory
    const dealerNets = weeks.map(w => w.dealerNet).filter(n => typeof n === 'number');
    if (dealerNets.length < 3) return 'neutral';
    const dMin = Math.min(...dealerNets);
    const dMax = Math.max(...dealerNets);
    const dRange = dMax - dMin;
    const dPct = dRange > 0 ? ((latest.dealerNet - dMin) / dRange) * 100 : 50;
    if (dPct > 75) return 'long';
    if (dPct < 25) return 'short';
    return 'neutral';
  })();

  return {
    leveragedWeeklyChange,
    leveragedFlowZScore,
    priceDirection,
    positioningDirection,
    positionPercentile,
    assetManagersChange,
    dealersExtreme,
    macroConfidence: _computePolymarketConf(pairData?.pair),
  };
}

// ─── TAREA 2.2 — Z-SCORE EXTREMES ────────────────────────────────────────────
/**
 * computeZScoreExtremes
 *
 * Normalises current net position against its 52-week history.
 * Replaces raw contract counts with statistically meaningful context.
 *
 * Z > +2  → Extreme Long  (historically overbought — contrarian reversal risk)
 * Z < -2  → Extreme Short (historically oversold  — contrarian reversal risk)
 *
 * @param {number}   currentNet   - Current week smartNet contracts
 * @param {number[]} weeklyNets   - Array of last 52 weekly smartNet values (oldest first)
 * @returns {{ zscore: number, percentile: number, state: string, label: string }}
 */
export function computeZScoreExtremes(currentNet, weeklyNets) {
  const series = Array.isArray(weeklyNets)
    ? weeklyNets.filter(n => typeof n === 'number' && !isNaN(n))
    : [];

  if (series.length < 4 || typeof currentNet !== 'number') {
    return { zscore: 0, percentile: 50, state: 'NORMAL', label: 'Insufficient history' };
  }

  const n    = series.length;
  const mean = series.reduce((s, v) => s + v, 0) / n;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std  = Math.sqrt(variance);

  const zscore    = std > 0 ? parseFloat(((currentNet - mean) / std).toFixed(2)) : 0;
  const below     = series.filter(v => v < currentNet).length;
  const percentile = Math.round((below / n) * 100);

  let state, label;
  if (zscore > 2)       { state = 'EXTREME_LONG';  label = 'Extreme Long — Reversal Risk'; }
  else if (zscore < -2) { state = 'EXTREME_SHORT'; label = 'Extreme Short — Reversal Risk'; }
  else if (zscore > 1)  { state = 'ELEVATED_LONG'; label = 'Elevated Long Positioning'; }
  else if (zscore < -1) { state = 'ELEVATED_SHORT';label = 'Elevated Short Positioning'; }
  else                  { state = 'NORMAL';         label = 'Normal Positioning Range'; }

  return { zscore, percentile, state, label };
}

// ─── TAREA 2.1 — COT DIVERGENCE ENGINE ───────────────────────────────────────
/**
 * detectCOTDivergence
 *
 * Institutional signal: detects when price direction and COT positioning
 * change in opposite directions — a real accumulation / distribution signal.
 *
 * Divergence = sign(ΔPrice) ≠ sign(ΔCOT)
 *
 * Returns:
 *   BULLISH_DIVERGENCE  — price down, institutions buying → Accumulation
 *   BEARISH_DIVERGENCE  — price up,   institutions selling → Distribution
 *   EXHAUSTION          — both aligned but Z-score extreme → Possible reversal
 *   ALIGNED_BULLISH     — both up (no divergence, trend continuation)
 *   ALIGNED_BEARISH     — both down (no divergence, trend continuation)
 *   NEUTRAL             — inconclusive
 *
 * @param {Object} params
 * @param {number}   params.priceChangePct    - % price change over lookback (positive = up)
 * @param {number}   params.cotNetChange      - ΔCOT net contracts (positive = buying)
 * @param {number}   [params.zscore]          - Optional z-score for exhaustion detection
 * @param {number}   [params.threshold=0.1]   - Minimum absolute % price move to count
 * @returns {{ state: string, label: string, reading: string, strength: number }}
 */
export function detectCOTDivergence({ priceChangePct, cotNetChange, zscore, threshold = 0.1 }) {
  const priceFlat = Math.abs(priceChangePct ?? 0) < threshold;
  const cotFlat   = Math.abs(cotNetChange ?? 0) < 500;  // < 500 contracts = noise

  if (priceFlat && cotFlat) {
    return { state: 'NEUTRAL', label: 'Sin divergencia', reading: 'Sin señal — movimiento insuficiente', strength: 0 };
  }

  const priceUp = (priceChangePct ?? 0) > 0;
  const cotUp   = (cotNetChange   ?? 0) > 0;

  // Check exhaustion only when both are aligned but positioning is extreme
  if (priceUp === cotUp && typeof zscore === 'number' && Math.abs(zscore) > 2) {
    return {
      state: 'EXHAUSTION',
      label: 'Agotamiento',
      reading: 'Posible reversión — posicionamiento extremo + tendencia alineada',
      strength: Math.min(1, Math.abs(zscore) / 3),
    };
  }

  if (!priceUp && cotUp) {
    const strength = Math.min(1, Math.abs(cotNetChange) / 15000);
    return {
      state: 'BULLISH_DIVERGENCE',
      label: 'Divergencia Alcista',
      reading: 'Acumulación institucional — smart money comprando contra la caída de precio',
      strength,
    };
  }

  if (priceUp && !cotUp) {
    const strength = Math.min(1, Math.abs(cotNetChange) / 15000);
    return {
      state: 'BEARISH_DIVERGENCE',
      label: 'Divergencia Bajista',
      reading: 'Distribución institucional — smart money vendiendo contra la subida de precio',
      strength,
    };
  }

  // Aligned (no divergence)
  return {
    state: priceUp ? 'ALIGNED_BULLISH' : 'ALIGNED_BEARISH',
    label: priceUp ? 'Alineado Alcista' : 'Alineado Bajista',
    reading: priceUp
      ? 'Precio y COT alineados al alza — tendencia institucional confirmada'
      : 'Precio y COT alineados a la baja — tendencia institucional confirmada',
    strength: 0.5,
  };
}
