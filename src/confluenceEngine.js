/**
 * confluenceEngine.js — Multi-Factor Confluence Scoring
 *
 * Computes a per-pair Confluence Score (0-100) by combining:
 *   - COT institutional bias strength
 *   - Carry differential alignment
 *   - Macro signal (USD direction) alignment
 *   - CB policy stance alignment
 *   - Crowding/exhaustion penalty from z-score extremes
 *
 * NOT a signal. A high confluence score means multiple independent
 * data streams agree on the same directional thesis. It amplifies
 * conviction when aligned, and warns when they diverge.
 */

/**
 * @param {Object}  params
 * @param {number}  params.biasScore       — COT bias score (-5 to +5)
 * @param {string}  params.biasDirection   — 'bullish' | 'bearish' | 'neutral'
 * @param {number}  [params.carryScore]       — carry differential (bps-equivalent, ±10 scale from /api/rates)
 * @param {Object}  [params.macroSignal]     — { bias: 'USD_STRONG'|'USD_LEANING_STRONG'|'USD_WEAK'|'USD_LEANING_WEAK'|'NEUTRAL', confidence: 0-10 }
 * @param {string}  [params.pair]            — 'EUR/USD' etc (for USD base/quote mapping)
 * @param {number}  [params.stanceDivergence]— base_stance - quote_stance from /api/rates pair entry (positive = base CB more hawkish → bullish for pair)
 * @param {number}  [params.zScore]          — COT z-score (from computeZScoreExtremes)
 * @returns {{ confluenceScore, policyAlignment, carryAlignment, label, color, details }}
 */
export function computeConfluenceScore({
  biasScore,
  biasDirection,
  carryScore       = null,
  macroSignal      = null,
  pair             = '',
  stanceDivergence = null,
  zScore           = null,
}) {
  const hasBias = Math.abs(biasScore ?? 0) >= 0.5 && biasDirection && biasDirection !== 'neutral';

  if (!hasBias) {
    return {
      confluenceScore: 0,
      policyAlignment: 'neutral',
      carryAlignment:  'neutral',
      label:  'No Directional Confluence',
      color:  '#6b7280',
      details: { cot: 0, carry: 0, macro: 0, policy: 0, crowding: 0 },
    };
  }

  const details = {};
  let score = 0;

  // ── 1. COT bias (max 40 pts) ─────────────────────────────────────────────
  // Strong institutional positioning drives the foundation score.
  const cotPts = Math.round((Math.abs(biasScore) / 5) * 40);
  score += cotPts;
  details.cot = cotPts;

  // ── 2. Carry alignment (max 20 pts, min -5) ───────────────────────────────
  // carry_score from /api/rates is bps-equivalent, capped ±10.
  // Positive carry_score = the base currency earns more (bullish for pair).
  let carryPts       = 0;
  let carryAlignment = 'neutral';

  if (typeof carryScore === 'number' && !isNaN(carryScore) && carryScore !== 0) {
    const aligned  = (biasDirection === 'bullish' && carryScore > 0) ||
                     (biasDirection === 'bearish' && carryScore < 0);
    carryAlignment = aligned ? 'aligned' : 'opposed';
    // Scale to ±10 range; full ±10 = ±20 pts
    carryPts = aligned
      ? Math.min(20, Math.round((Math.abs(carryScore) / 10) * 20))
      : -5;
  }
  score += carryPts;
  details.carry = carryPts;

  // ── 3. Macro signal alignment (max 20 pts, min -10) ───────────────────────
  // USD_STRONG/LEANING_STRONG is bullish for USD-base pairs (USD/JPY, USD/CHF)
  // but bearish for USD-quote pairs (EUR/USD, GBP/USD, AUD/USD, NZD/USD).
  // LEANING variants contribute at half weight (lower confidence signal).
  let macroPts = 0;

  if (macroSignal?.bias && typeof macroSignal.confidence === 'number') {
    const usdIsBase  = pair.startsWith('USD/');
    const usdBullish = macroSignal.bias === 'USD_STRONG' || macroSignal.bias === 'USD_LEANING_STRONG';
    const usdBearish = macroSignal.bias === 'USD_WEAK'   || macroSignal.bias === 'USD_LEANING_WEAK';
    const isLeaning  = macroSignal.bias.includes('LEANING');

    let expectedDir = null;
    if (usdBullish) expectedDir = usdIsBase ? 'bullish' : 'bearish';
    if (usdBearish) expectedDir = usdIsBase ? 'bearish' : 'bullish';

    if (expectedDir) {
      const aligned   = expectedDir === biasDirection;
      const macroConf = Math.min(10, macroSignal.confidence) / 10; // 0-1
      const weight    = isLeaning ? 0.6 : 1.0; // LEANING signals carry 60% weight

      macroPts = aligned
        ? Math.round(macroConf * 20 * weight)
        : Math.round(-macroConf * 10 * weight);
      macroPts = Math.max(-10, Math.min(20, macroPts));
    }
  }
  score += macroPts;
  details.macro = macroPts;

  // ── 4. CB policy stance divergence (max 15 pts, min -8) ──────────────────
  // stanceDivergence = base_stance - quote_stance from /api/rates.
  // Positive = base CB more hawkish = structurally bullish for the pair.
  let policyPts       = 0;
  let policyAlignment = 'neutral';

  if (typeof stanceDivergence === 'number' && !isNaN(stanceDivergence) && stanceDivergence !== 0) {
    const stanceDir   = stanceDivergence > 0 ? 'bullish' : 'bearish';
    const aligned     = stanceDir === biasDirection;
    policyAlignment   = aligned ? 'aligned' : 'opposed';
    // Max stanceDivergence in practice ≈ ±10 (two banks at opposite extremes ±5 each)
    const normalised  = Math.min(1, Math.abs(stanceDivergence) / 10);
    policyPts = aligned
      ? Math.round(normalised * 15)
      : Math.round(-normalised * 8);
    policyPts = Math.max(-8, Math.min(15, policyPts));
  }
  score += policyPts;
  details.policy = policyPts;

  // ── 5. Crowding/exhaustion penalty (max -10 pts) ─────────────────────────
  // Extreme z-score positioning = crowded trade = reversal risk.
  let crowdingPts = 0;
  if (typeof zScore === 'number' && !isNaN(zScore)) {
    const absZ = Math.abs(zScore);
    if (absZ > 2.5)      crowdingPts = -10;
    else if (absZ > 2.0) crowdingPts = -7;
    else if (absZ > 1.5) crowdingPts = -3;
  }
  score += crowdingPts;
  details.crowding = crowdingPts;

  const confluenceScore = Math.max(0, Math.min(100, score));

  let label, color;
  if (confluenceScore >= 70)      { label = 'High Confluence';      color = '#22c55e'; }
  else if (confluenceScore >= 45) { label = 'Moderate Confluence';  color = '#f59e0b'; }
  else if (confluenceScore >= 20) { label = 'Low Confluence';       color = '#f97316'; }
  else                            { label = 'No Confluence';        color = '#6b7280'; }

  return { confluenceScore, policyAlignment, carryAlignment, label, color, details };
}
