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
function scoreLeveragedFlow(change) {
  if (typeof change !== 'number' || isNaN(change)) return 0;
  if (change >= 10000)  return  2;
  if (change >= 3000)   return  1;
  if (change <= -10000) return -2;
  if (change <= -3000)  return -1;
  return 0; // -3000 < change < 3000 → neutral
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
function scorePercentile(percentile) {
  if (typeof percentile !== 'number' || isNaN(percentile)) return 0;
  if (percentile > 80) return -1; // historically long → contrarian bearish
  if (percentile < 20) return  1; // historically short → contrarian bullish
  return 0;
}

// ─── FACTOR 4 — ASSET MANAGERS CONFIRMATION ──────────────────────────────────
// Asset managers are slower money but confirm trend when aligned with Leveraged.
// Input: data.assetManagersChange (integer, delta contracts)
function scoreAssetManagers(change) {
  if (typeof change !== 'number' || isNaN(change)) return 0;
  if (change > 0) return  1;
  if (change < 0) return -1;
  return 0;
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
  if (score > 0)  return 'bullish';
  if (score < 0)  return 'bearish';
  return 'neutral';
}

// ─── RECOMMENDATION ENGINE ───────────────────────────────────────────────────
function getRecommendation(score) {
  if (score >= 4)  return 'Only look for long setups this week. Avoid shorts.';
  if (score >= 2)  return 'Prioritize longs. Short setups need extra confirmation.';
  if (score === 1) return 'Slight long edge. Wait for clean structure before entering.';
  if (score === 0) return 'No directional edge. Wait for structure confirmation before trading.';
  if (score >= -2) return 'Slight short edge. Wait for clean structure before entering.';
  if (score >= -4) return 'Prioritize shorts. Long setups need extra confirmation.';
  return                  'Only look for short setups in HTF zones. Avoid longs.';
}

// ─── COLOR HELPER (for UI use) ────────────────────────────────────────────────
function getBiasColor(score) {
  if (score >= 4)  return '#22c55e'; // strong bull
  if (score >= 2)  return '#4ade80'; // bull
  if (score === 1) return '#86efac'; // slight bull
  if (score === 0) return '#94a3b8'; // neutral
  if (score >= -2) return '#fca5a5'; // slight bear
  if (score >= -4) return '#f87171'; // bear
  return                  '#ef4444'; // strong bear
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
    return 'Strong institutional alignment. Only look for long setups this week.';

  if (score >= 1.5)
    return 'Moderate bullish bias confirmed. Prioritize longs with HTF confirmation.';

  if (score > -1.5)
    return 'No clear directional edge. Wait for structure confirmation before trading.';

  if (score > -4)
    return 'Moderate bearish bias confirmed. Prioritize shorts with HTF confirmation.';

  return 'Strong institutional alignment. Only look for short setups in HTF zones.';
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
    const leveragedFlow   = scoreLeveragedFlow(data.leveragedWeeklyChange);
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
      direction:      getDirection(score),          // reuse shared helper
      color:          getBiasColor(score),           // reuse shared helper
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
  } catch (_err) {
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
  } catch (_err) {
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
 * @param {Object} pairData  - from pairsData: { latest, weeks, signal, pair }
 * @returns {Object}         - ready-to-pass to calculateBiasScore()
 */
export function deriveInputsFromPair(pairData) {
  if (!pairData || !pairData.latest || !pairData.weeks) return null;

  const { latest, weeks } = pairData;
  const prev = weeks[1] || null;

  // Factor 1 — Leveraged weekly change (smart money = levLong/levShort)
  const leveragedWeeklyChange = prev
    ? (latest.smartNet - prev.smartNet)
    : 0;

  // Factor 2 — Price vs Positioning divergence
  // priceDirection: derived from smartNet sign over last 2 weeks
  // positioningDirection: derived from leveragedWeeklyChange
  const priceDirection = (() => {
  if (!prev) return null;

  // Use smartNet directional change as HTF directional proxy
  if (latest.smartNet != null && prev.smartNet != null) {
    return latest.smartNet > prev.smartNet
      ? 'up'
      : latest.smartNet < prev.smartNet
      ? 'down'
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
    priceDirection,
    positioningDirection,
    positionPercentile,
    assetManagersChange,
    dealersExtreme,
  };
}
