// =============================================================================
// Institutional Composite Engine
//
// Master scoring system combining all institutional signal layers into a
// single actionable Institutional Score (0-100).
//
// Components:
//   1. COT Positioning (existing engine)     — 25%
//   2. Macro Context (existing engines)      — 20%
//   3. Equity Intelligence (new FD)          — 20%
//   4. Earnings Regime (new FD)              — 15%
//   5. Financial Stress (new FD)             — 10% (inverted — high stress = lower score)
//   6. Crypto Risk Signal (existing + FD)    — 5%
//   7. Intermarket Stability (existing)      — 5%
// =============================================================================

import { clamp, scoreLabel, directionLabel, convictionLabel }
  from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Component weight configuration ───────────────────────────────────────────

const WEIGHTS = {
  cot:         0.25,
  macro:       0.20,
  equity:      0.20,
  earnings:    0.15,
  stress:      0.10, // inverted
  crypto:      0.05,
  intermarket: 0.05,
};

// ── COT input normalization ───────────────────────────────────────────────────

function normalizeCotBias(cotBiasScore) {
  // cotBiasScore is typically -5 to +5 or -100 to +100
  if (cotBiasScore == null) return null;
  const abs = Math.abs(cotBiasScore);
  if (abs <= 5) {
    // -5 to +5 scale → 0-100
    return clamp(50 + cotBiasScore * 10, 0, 100);
  }
  // -100 to +100 scale
  return clamp(50 + cotBiasScore * 0.5, 0, 100);
}

// ── Macro score normalization ─────────────────────────────────────────────────

function normalizeMacroScore(macroSignal) {
  if (!macroSignal) return null;
  // macroSignal.score is typically 0-100 or bias direction + strength
  if (typeof macroSignal.score === 'number') return clamp(macroSignal.score, 0, 100);
  if (macroSignal.direction === 'bullish') return 70;
  if (macroSignal.direction === 'bearish') return 30;
  return 50;
}

// ── Earnings score normalization ──────────────────────────────────────────────

function normalizeEarningsScore(earningsRegime) {
  if (!earningsRegime) return null;
  return clamp(earningsRegime.score ?? 50, 0, 100);
}

// ── Stress score (inverted) ───────────────────────────────────────────────────

function normalizeStressScore(stressEngine) {
  if (!stressEngine || stressEngine.stressScore == null) return null;
  // High stress → low contribution to composite
  return clamp(100 - stressEngine.stressScore, 0, 100);
}

// ── Crypto score ──────────────────────────────────────────────────────────────

function normalizeCryptoScore(cryptoLayer) {
  if (!cryptoLayer) return null;
  return clamp(cryptoLayer.riskSignal?.score ?? 50, 0, 100);
}

// ── Intermarket score ─────────────────────────────────────────────────────────

function normalizeIntermarketScore(intermarketStability) {
  if (!intermarketStability) return null;
  if (typeof intermarketStability.score === 'number') return clamp(intermarketStability.score, 0, 100);
  if (intermarketStability.stability === 'HIGH')    return 75;
  if (intermarketStability.stability === 'LOW')     return 25;
  return 50;
}

// ── Regime classification ─────────────────────────────────────────────────────

const REGIMES = [
  { min: 80, label: 'INSTITUTIONAL_BULL',    color: '#16a34a', description: 'Full institutional confluence — strong directional conviction' },
  { min: 65, label: 'CONSTRUCTIVE',          color: '#22c55e', description: 'Majority signals aligned — moderate-high conviction' },
  { min: 55, label: 'CAUTIOUSLY_BULLISH',    color: '#86efac', description: 'Leaning bullish with notable headwinds' },
  { min: 45, label: 'NEUTRAL',               color: '#fbbf24', description: 'Mixed signals — wait for confirmation' },
  { min: 35, label: 'CAUTIOUSLY_BEARISH',    color: '#f97316', description: 'Leaning bearish with pockets of support' },
  { min: 20, label: 'RISK_ELEVATED',         color: '#ef4444', description: 'Multiple stress signals active — defensive bias' },
  { min: 0,  label: 'INSTITUTIONAL_BEAR',    color: '#dc2626', description: 'Full institutional confluence to downside' },
];

function classifyRegime(score) {
  for (const r of REGIMES) {
    if (score >= r.min) return r;
  }
  return REGIMES[REGIMES.length - 1];
}

// ── Component breakdown formatter ─────────────────────────────────────────────

function buildComponentBreakdown(normalizedScores) {
  return Object.entries(normalizedScores)
    .filter(([, v]) => v != null)
    .map(([key, score]) => ({
      key,
      label: {
        cot:         'COT Positioning',
        macro:       'Macro Environment',
        equity:      'Equity Intelligence',
        earnings:    'Earnings Regime',
        stress:      'Financial Health',
        crypto:      'Crypto Risk Signal',
        intermarket: 'Intermarket Stability',
      }[key] ?? key,
      score:  Math.round(score),
      weight: WEIGHTS[key] ?? 0,
      contribution: Math.round(score * (WEIGHTS[key] ?? 0)),
      direction: score >= 55 ? 'bullish' : score <= 45 ? 'bearish' : 'neutral',
    }))
    .sort((a, b) => b.weight - a.weight);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} inputs
 *   .cotBiasScore         {number}  — raw COT bias score
 *   .macroSignal          {object}  — from useMacroSignal
 *   .equityIntel          {object}  — from computeEquityIntelligence
 *   .earningsRegime       {object}  — from computeEarningsRegime
 *   .stressEngine         {object}  — from computeBalanceSheetStress
 *   .cryptoLayer          {object}  — from computeCryptoMacroLayer
 *   .intermarketStability {object}  — from intermarketStabilityEngine (existing)
 * @returns {object} InstitutionalCompositeResult
 */
export function computeInstitutionalComposite(inputs) {
  const {
    cotBiasScore,
    macroSignal,
    equityIntel,
    earningsRegime,
    stressEngine,
    cryptoLayer,
    intermarketStability,
  } = inputs ?? {};

  const normalizedScores = {
    cot:         normalizeCotBias(cotBiasScore),
    macro:       normalizeMacroScore(macroSignal),
    equity:      equityIntel?.compositeScore ?? null,
    earnings:    normalizeEarningsScore(earningsRegime),
    stress:      normalizeStressScore(stressEngine),
    crypto:      normalizeCryptoScore(cryptoLayer),
    intermarket: normalizeIntermarketScore(intermarketStability),
  };

  // Build weighted items from available scores
  const items = Object.entries(normalizedScores)
    .filter(([k, v]) => v != null && WEIGHTS[k] != null)
    .map(([k, v]) => ({ value: v, weight: WEIGHTS[k] }));

  if (items.length === 0) return null;

  const totalWeight    = items.reduce((s, i) => s + i.weight, 0);
  const compositeScore = Math.round(
    items.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight
  );

  const regime    = classifyRegime(compositeScore);
  const breakdown = buildComponentBreakdown(normalizedScores);

  const dataCompleteness = Math.round((items.length / Object.keys(WEIGHTS).length) * 100);

  return {
    compositeScore: clamp(compositeScore, 0, 100),
    direction:    directionLabel(compositeScore),
    conviction:   convictionLabel(compositeScore),
    label:        scoreLabel(compositeScore),
    regime:       regime.label,
    regimeColor:  regime.color,
    regimeDesc:   regime.description,
    breakdown,
    normalizedScores,
    dataCompleteness,
    computedAt: new Date().toISOString(),
  };
}

export { WEIGHTS, REGIMES };
