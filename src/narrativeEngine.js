/**
 * narrativeEngine.js — Narrative Intelligence Layer
 *
 * Generates institutional-quality contextual interpretation sentences.
 * Purpose: help the user UNDERSTAND what is happening, not just see labels.
 *
 * Design principles:
 *   - Never contradicts itself across bias / tactical / execution layers
 *   - Describes the conflict explicitly when bias and momentum diverge
 *   - Avoids imperative "buy/sell" language — always contextual
 *   - Sounds like a macro desk, not a signal service
 */

// ── Bias descriptors ─────────────────────────────────────────────────────────

const BIAS_TEXT = {
  strong_bull:   'structural bullish bias remains strong',
  moderate_bull: 'institutional bias leans bullish',
  weak_bull:     'mild bullish structural context',
  neutral:       'no clear directional institutional edge',
  weak_bear:     'mild bearish structural context',
  moderate_bear: 'institutional bias leans bearish',
  strong_bear:   'structural bearish bias remains strong',
};

function getBiasKey(score) {
  const s = score ?? 0;
  if (s >= 3.5)  return 'strong_bull';
  if (s >= 1.5)  return 'moderate_bull';
  if (s >= 0.5)  return 'weak_bull';
  if (s > -0.5)  return 'neutral';
  if (s > -1.5)  return 'weak_bear';
  if (s > -3.5)  return 'moderate_bear';
  return                 'strong_bear';
}

// ── Tactical descriptors ─────────────────────────────────────────────────────

function getTacDesc(tacState) {
  if (!tacState || tacState.pressure === 'insufficient') return null;
  switch (tacState.marketState) {
    case 'tactical_breakdown': return 'tactical momentum has broken down aggressively';
    case 'corrective_phase':   return 'price is in a corrective phase with active bearish pressure';
    case 'pullback_active':    return 'a short-term pullback is in progress';
    case 'expansion':          return 'bullish momentum is expanding with conviction';
    case 'recovery_phase':     return 'price is recovering from recent lows';
    case 'stabilization':      return 'price action is stabilizing near current levels';
    case 'compression':        return 'price is compressing without clear directional pressure';
    default:                   return 'tactical momentum is evolving';
  }
}

// ── Execution readiness text ─────────────────────────────────────────────────

const EXEC_TEXT = {
  continuation_context: 'Execution conditions improving. Monitor for tactical entry context within the institutional thesis.',
  pullback_monitoring:  'Pullback monitoring active. Tactical execution conditions pending further improvement.',
  await_stabilization:  'Await stabilization before reassessing continuation conditions.',
  await_confirmation:   'Await further COT confirmation before adding directional exposure.',
  no_edge:              'No directional edge established. Maintain neutral observational posture.',
};

// ── Main narrative builder ───────────────────────────────────────────────────

/**
 * Build a three-part narrative: primary context, secondary context, execution guidance.
 *
 * @param {object} params
 * @param {number} params.biasScore         — institutional bias (-5 to +5)
 * @param {string} params.biasDirection     — 'bullish' | 'bearish' | 'neutral'
 * @param {object} params.tacState          — TacticalState from computeTacticalMomentum
 * @param {string} params.conflictLevel     — 'none' | 'mild' | 'moderate' | 'severe'
 * @param {string} params.executionReadiness — from computeExecutionReadiness
 * @param {string} [params.marketRegime]    — optional regime label
 * @returns {{ primary: string, context: string, execution: string, invalidation: string }}
 */
export function buildNarrative({
  biasScore,
  biasDirection,
  tacState,
  conflictLevel,
  executionReadiness,
  marketRegime,
}) {
  const biasKey  = getBiasKey(biasScore);
  const biasDesc = BIAS_TEXT[biasKey];
  const tacDesc  = getTacDesc(tacState);
  const biasDir  = biasDirection || (biasScore > 0 ? 'bullish' : biasScore < 0 ? 'bearish' : 'neutral');
  const hasBias  = Math.abs(biasScore ?? 0) >= 0.5;
  const hasConflict = conflictLevel === 'moderate' || conflictLevel === 'severe';
  const tacMissing  = !tacDesc || tacState?.pressure === 'insufficient';

  // ── PRIMARY narrative ──────────────────────────────────────────────────────
  let primary;

  if (tacMissing && hasBias) {
    primary = `Institutional positioning indicates ${biasDesc}. Awaiting tactical confirmation from live price data.`;

  } else if (!hasBias && tacMissing) {
    primary = 'No clear directional context established. Monitor for institutional positioning shifts and tactical price confirmation.';

  } else if (!hasBias && tacDesc) {
    primary = `Institutional positioning is neutral. ${cap(tacDesc)}.`;

  } else if (hasConflict) {
    if (biasDir === 'bullish') {
      primary = `Institutional bias remains ${biasDesc}, but ${tacDesc}. Current conditions suggest corrective pressure rather than confirmed reversal.`;
    } else {
      primary = `${cap(biasDesc)}. ${cap(tacDesc)}, though this may represent a corrective bounce within the broader structural context.`;
    }

  } else if (tacState?.pressure === biasDir) {
    const strength = (biasKey === 'strong_bull' || biasKey === 'strong_bear');
    if (strength) {
      primary = `${cap(biasDesc)} with tactical momentum aligned. Structural alignment conditions are favorable for the institutional thesis.`;
    } else {
      primary = `${cap(biasDesc)}. Tactical momentum is consistent with the structural context, supporting the directional thesis.`;
    }

  } else {
    primary = `${cap(biasDesc)}. ${cap(tacDesc ?? 'Tactical conditions are evolving')}.`;
  }

  // ── CONTEXT narrative ──────────────────────────────────────────────────────
  let context;

  if (hasConflict && biasDir === 'bullish') {
    context = 'Structural bullish context remains intact despite short-term tactical weakness. Price action currently diverges from institutional positioning.';
  } else if (hasConflict && biasDir === 'bearish') {
    context = 'Structural bearish context remains intact. Current recovery conditions do not invalidate the broader directional thesis.';
  } else if (executionReadiness === 'await_stabilization') {
    context = 'Tactical momentum deterioration is elevated. Monitor for signs of price stabilization before reassessing continuation conditions.';
  } else if (executionReadiness === 'pullback_monitoring') {
    context = 'Tactical pullback provides potential context for strategic positioning within the institutional directional thesis.';
  } else if (executionReadiness === 'continuation_context') {
    context = 'Institutional flow and tactical momentum are aligned. Conditions support continuation monitoring within the structural context.';
  } else if (executionReadiness === 'await_confirmation') {
    context = 'Tactical conditions are insufficient to confirm the institutional directional thesis. Maintain observational posture.';
  } else {
    context = 'Monitor evolving conditions for institutional and tactical convergence.';
  }

  // ── EXECUTION narrative ────────────────────────────────────────────────────
  const execution = EXEC_TEXT[executionReadiness] ?? 'Monitor for context development.';

  // ── INVALIDATION narrative ─────────────────────────────────────────────────
  let invalidation;

  if (!hasBias) {
    invalidation = 'No active thesis — no invalidation scenario applies. Await directional positioning shift in the next COT report.';
  } else if (biasDir === 'bullish') {
    if (biasKey === 'strong_bull') {
      invalidation = 'Thesis invalidated by: two consecutive COT reports showing institutional net selling, or price breaking and holding below the prior structural low with increasing net short positioning.';
    } else if (biasKey === 'moderate_bull') {
      invalidation = 'Thesis invalidated by: net positioning turning negative in the next COT report, or price failing to reclaim the structural range after a corrective phase.';
    } else {
      invalidation = 'Weak bullish context resolves without action if net positioning fails to increase in the next report.';
    }
  } else if (biasDir === 'bearish') {
    if (biasKey === 'strong_bear') {
      invalidation = 'Thesis invalidated by: two consecutive COT reports showing institutional net buying, or price breaking and holding above the prior structural high with increasing net long positioning.';
    } else if (biasKey === 'moderate_bear') {
      invalidation = 'Thesis invalidated by: net positioning turning positive in the next COT report, or price sustaining a recovery above the structural resistance zone.';
    } else {
      invalidation = 'Weak bearish context resolves without action if net positioning fails to decrease in the next report.';
    }
  } else {
    invalidation = 'Neutral context — no invalidation applies until a directional thesis is established.';
  }

  return { primary, context, execution, invalidation };
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
