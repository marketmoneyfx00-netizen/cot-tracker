// =============================================================================
// Institutional Composite Engine
//
// Master scoring system combining all institutional signal layers into a
// single actionable Institutional Score (0-100).
//
// Components:
//   1. COT Positioning (existing engine)     — 25%
//   2. Macro Context (existing engines)      — 22%
//   3. Equity Intelligence (new FD)          — 22%
//   4. Earnings Regime (new FD)              — 16%
//   5. Financial Stress (new FD)             — 10% (inverted — high stress = lower score)
//   6. Intermarket Stability (existing)      — 5%
// =============================================================================

import { clamp, scoreLabel, directionLabel, convictionLabel }
  from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Component weight configuration ───────────────────────────────────────────

const WEIGHTS = {
  cot:         0.25,
  macro:       0.22,
  equity:      0.22,
  earnings:    0.16,
  stress:      0.10, // inverted
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
  { min: 80, label: 'ALCISTA INSTITUCIONAL', color: '#16a34a', description: 'Confluencia institucional total — convicción direccional fuerte' },
  { min: 65, label: 'CONSTRUCTIVO',          color: '#22c55e', description: 'Mayoría de señales alineadas — convicción moderada-alta' },
  { min: 55, label: 'LEVEMENTE ALCISTA',     color: '#86efac', description: 'Tendencia alcista con resistencias notables' },
  { min: 45, label: 'NEUTRAL',               color: '#fbbf24', description: 'Señales mixtas — esperar confirmación' },
  { min: 35, label: 'LEVEMENTE BAJISTA',     color: '#f97316', description: 'Tendencia bajista con zonas de soporte' },
  { min: 20, label: 'RIESGO ELEVADO',        color: '#ef4444', description: 'Múltiples señales de estrés activas — sesgo defensivo' },
  { min: 0,  label: 'BAJISTA INSTITUCIONAL', color: '#dc2626', description: 'Confluencia institucional total a la baja' },
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
        cot:         'Posicionamiento COT',
        macro:       'Entorno Macro',
        equity:      'Renta Variable',
        earnings:    'Régimen de Ganancias',
        stress:      'Salud Financiera',
        intermarket: 'Estabilidad Intermercado',
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
    intermarketStability,
  } = inputs ?? {};

  const normalizedScores = {
    cot:         normalizeCotBias(cotBiasScore),
    macro:       normalizeMacroScore(macroSignal),
    equity:      equityIntel?.compositeScore ?? null,
    earnings:    normalizeEarningsScore(earningsRegime),
    stress:      normalizeStressScore(stressEngine),
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
