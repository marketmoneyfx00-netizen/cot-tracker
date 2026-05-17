/**
 * confidenceDecayEngine.js — Confidence Decay System
 *
 * Tracks progressive degradation of institutional-tactical alignment.
 * Produces a decay level and score that the UI uses to modulate colors
 * and visual confidence. Ensures the interface never appears "certain"
 * when bias and tactical pressure are in conflict.
 *
 * Alignment levels (never instantaneous — always graduated):
 *   high_alignment      → bias and tactical pressure agree, strong signal
 *   moderate_alignment  → partial agreement or weak bias
 *   weak_alignment      → disagreement beginning, confidence eroding
 *   structural_conflict → sustained cross-directional pressure
 */

const LEVEL_COLOR = {
  high_alignment:      '#22c55e',
  moderate_alignment:  '#f59e0b',
  weak_alignment:      '#f97316',
  structural_conflict: '#ef4444',
};

const LEVEL_TO_CONFLICT = {
  high_alignment:      'none',
  moderate_alignment:  'mild',
  weak_alignment:      'moderate',
  structural_conflict: 'severe',
};

function buildDecay(score, level, label) {
  return {
    score:         Math.round(Math.max(0, Math.min(100, score))),
    level,
    label,
    color:         LEVEL_COLOR[level]           ?? '#6b7280',
    conflictLevel: LEVEL_TO_CONFLICT[level]     ?? 'none',
  };
}

/**
 * Compute how much alignment has decayed between the institutional bias
 * and the current tactical pressure.
 *
 * @param {object} params
 * @param {number} params.biasScore  — institutional bias score (-5 to +5)
 * @param {string} params.biasDir    — 'bullish' | 'bearish' | 'neutral'
 * @param {object} params.tacState   — TacticalState from computeTacticalMomentum
 * @returns {object}                 — { score, level, label, color, conflictLevel }
 */
export function computeConfidenceDecay({ biasScore, biasDir, tacState }) {
  const biasAbs    = Math.abs(biasScore ?? 0);
  const hasBias    = biasAbs >= 1.0;
  const tacPressure  = tacState?.pressure;
  const tacVelocity  = tacState?.velocity;
  const tacMktState  = tacState?.marketState;

  // ── No tactical data ─────────────────────────────────────────────────────────
  if (!tacPressure || tacPressure === 'insufficient') {
    if (biasAbs >= 3.5) return buildDecay(78, 'moderate_alignment', 'Institutional Conviction');
    if (biasAbs >= 1.5) return buildDecay(62, 'moderate_alignment', 'Institutional Bias');
    return buildDecay(38, 'weak_alignment', 'Awaiting Confirmation');
  }

  // ── No institutional edge ────────────────────────────────────────────────────
  if (!hasBias) {
    if (tacPressure === 'neutral') return buildDecay(30, 'weak_alignment', 'No Directional Edge');
    return buildDecay(42, 'weak_alignment', 'Tactical Signal Only');
  }

  // ── Both layers available — compute alignment ─────────────────────────────
  const aligned    = (biasDir === 'bullish' && tacPressure === 'bullish') ||
                     (biasDir === 'bearish' && tacPressure === 'bearish');
  const conflicting = (biasDir === 'bullish' && tacPressure === 'bearish') ||
                      (biasDir === 'bearish' && tacPressure === 'bullish');

  if (aligned) {
    let score = 55 + biasAbs * 7;
    if (tacVelocity === 'fast')                                          score += 10;
    if (tacMktState === 'expansion' || tacMktState === 'recovery_phase') score += 5;
    score = Math.min(97, score);
    const level = score >= 80 ? 'high_alignment' : 'moderate_alignment';
    const label = score >= 80 ? 'High Alignment'  : 'Moderate Alignment';
    return buildDecay(score, level, label);
  }

  if (conflicting) {
    let score = 50 - biasAbs * 7;
    if (tacVelocity === 'fast')                   score -= 12;
    if (tacMktState === 'tactical_breakdown')      score -= 10;
    if (tacMktState === 'corrective_phase')        score -= 5;
    score = Math.max(5, score);
    if (score <= 18) return buildDecay(score, 'structural_conflict', 'Structural Conflict');
    if (score <= 32) return buildDecay(score, 'weak_alignment',      'Alignment Deteriorating');
    return              buildDecay(score, 'weak_alignment',           'Weak Alignment');
  }

  // ── Partial (one direction, other neutral) ───────────────────────────────
  const score = Math.min(65, 42 + biasAbs * 4);
  return buildDecay(score, 'moderate_alignment', 'Moderate Alignment');
}

/**
 * Derives the execution readiness state from decay level + tactical context.
 * Cleanly separates DIRECTION (what bias says) from TIMING (when to act).
 *
 * @param {object} params
 * @param {string} params.biasDir    — 'bullish' | 'bearish' | 'neutral'
 * @param {object} params.tacState   — TacticalState
 * @param {string} params.decayLevel — from computeConfidenceDecay
 * @param {number} params.biasScore  — institutional bias score
 * @returns {string}                 — execution readiness key
 */
export function computeExecutionReadiness({ biasDir, tacState, decayLevel, biasScore }) {
  const biasAbs     = Math.abs(biasScore ?? 0);
  const tacPressure = tacState?.pressure;
  const tacMktState = tacState?.marketState;

  if (!tacPressure || tacPressure === 'insufficient') {
    return biasAbs >= 1.5 ? 'await_confirmation' : 'no_edge';
  }

  if (decayLevel === 'structural_conflict') return 'await_stabilization';

  if (decayLevel === 'weak_alignment') {
    const correcting = tacMktState === 'corrective_phase'  ||
                       tacMktState === 'tactical_breakdown' ||
                       tacMktState === 'pullback_active';
    return correcting ? 'pullback_monitoring' : 'await_confirmation';
  }

  if (decayLevel === 'high_alignment' || decayLevel === 'moderate_alignment') {
    if (biasDir === tacPressure) return 'continuation_context';
    return 'pullback_monitoring';
  }

  return 'await_confirmation';
}

/**
 * Human-readable execution readiness label for display.
 */
export const EXECUTION_READINESS_CFG = {
  continuation_context: { label: 'Execution Conditions Improving', color: '#22c55e', icon: '●' },
  pullback_monitoring:  { label: 'Pullback Monitoring Active',      color: '#f59e0b', icon: '◐' },
  await_stabilization:  { label: 'Await Stabilization',            color: '#f97316', icon: '◌' },
  await_confirmation:   { label: 'Await Confirmation',             color: '#6b7280', icon: '○' },
  no_edge:              { label: 'No Directional Edge',            color: '#6b7280', icon: '○' },
};
