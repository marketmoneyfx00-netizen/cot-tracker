/**
 * regimeTransitionEngine.js — Macro Regime Transition & Evolution Engine v1.0
 *
 * Detects the DIRECTION and VELOCITY of macro regime change, not just current state.
 *
 * Transition types:
 *   STABLE               — regime is holding, signals consistent
 *   IMPROVING_RISK_ON    — flows shifting toward risk appetite
 *   DETERIORATING_RISK_ON— equity conviction fading, defensive rotation emerging
 *   EMERGING_STAGFLATION — bond selling + gold + oil bid, equity pressure building
 *   DISINFLATION_BREAKDOWN— previous disinflationary positioning unwinding
 *   LIQUIDITY_STRESS_BUILDUP — USD squeeze + cross-asset de-risking accelerating
 *   MACRO_TRANSITION     — mixed / unclear transition in progress
 *
 * Also outputs:
 *   - velocity:           RAPID | MODERATE | GRADUAL | STATIC
 *   - stability:          0–100 (regime signal coherence)
 *   - confirmation_signals: string[]
 *   - deterioration_signals: string[]
 *   - emerging_regime:    string | null (what's developing)
 *   - confidence_trend:   IMPROVING | STABLE | DETERIORATING
 *   - regime_timeline:    { current, emerging, key_watch }
 *
 * Per-asset helper:
 *   buildAssetRegimeTrend(biasEntry, flowPersistence, riskRegime) → regime_trend label
 *
 * Design:
 *   - Pure functions. No side effects. No state. No React.
 *   - Works with whatever key assets are available — graceful degradation.
 *   - Uses FlowPersistenceProfile objects from flowPersistenceEngine.
 *
 * Input:  riskRegime, allAssetsWithFlow (array from export pre-pass), opts
 * Output: RegimeTransitionProfile
 */

// ── TRANSITION TYPE CONSTANTS ─────────────────────────────────────────────────

export const TRANSITION_TYPES = {
  STABLE:                   'STABLE',
  IMPROVING_RISK_ON:        'IMPROVING_RISK_ON',
  DETERIORATING_RISK_ON:    'DETERIORATING_RISK_ON',
  EMERGING_STAGFLATION:     'EMERGING_STAGFLATION',
  DISINFLATION_BREAKDOWN:   'DISINFLATION_BREAKDOWN',
  LIQUIDITY_STRESS_BUILDUP: 'LIQUIDITY_STRESS_BUILDUP',
  MACRO_TRANSITION:         'MACRO_TRANSITION',
};

export const TRANSITION_LABELS = {
  STABLE:                   'Estable / Régimen Consolidado',
  IMPROVING_RISK_ON:        'Apetito por Riesgo Mejorando',
  DETERIORATING_RISK_ON:    'Apetito por Riesgo Deteriorando',
  EMERGING_STAGFLATION:     'Estanflación Emergente',
  DISINFLATION_BREAKDOWN:   'Ruptura Desinflacionaria',
  LIQUIDITY_STRESS_BUILDUP: 'Acumulación de Estrés de Liquidez',
  MACRO_TRANSITION:         'Transición Macro / Mixto',
};

export const TRANSITION_COLORS = {
  STABLE:                   '#22c55e',
  IMPROVING_RISK_ON:        '#4ade80',
  DETERIORATING_RISK_ON:    '#f59e0b',
  EMERGING_STAGFLATION:     '#f97316',
  DISINFLATION_BREAKDOWN:   '#60a5fa',
  LIQUIDITY_STRESS_BUILDUP: '#dc2626',
  MACRO_TRANSITION:         '#8491a8',
};

// What the next regime logically is if a transition completes
const TRANSITION_TARGET_REGIME = {
  IMPROVING_RISK_ON:        'RISK_ON',
  DETERIORATING_RISK_ON:    'RISK_OFF',
  EMERGING_STAGFLATION:     'STAGFLATION',
  DISINFLATION_BREAKDOWN:   'STAGFLATION',
  LIQUIDITY_STRESS_BUILDUP: 'LIQUIDITY_STRESS',
  MACRO_TRANSITION:         null,
  STABLE:                   null,
};

// Regime asset expectations: what direction should each key asset have in this regime?
const REGIME_EXPECTATIONS = {
  RISK_ON: {
    equity: 'bullish', bonds: 'bearish', gold: 'bearish', oil: 'bullish', usd: 'bearish',
  },
  RISK_OFF: {
    equity: 'bearish', bonds: 'bullish', gold: 'bullish', oil: 'bearish', usd: 'bullish',
  },
  STAGFLATION: {
    equity: 'bearish', bonds: 'bearish', gold: 'bullish', oil: 'bullish', usd: 'neutral',
  },
  DISINFLATION: {
    equity: 'bullish', bonds: 'bullish', gold: 'neutral', oil: 'bearish', usd: 'neutral',
  },
  LIQUIDITY_STRESS: {
    equity: 'bearish', bonds: 'neutral', gold: 'bearish', oil: 'bearish', usd: 'bullish',
  },
  TRANSITIONAL: {
    equity: 'neutral', bonds: 'neutral', gold: 'neutral', oil: 'neutral', usd: 'neutral',
  },
};

// ── KEY ASSET EXTRACTION ──────────────────────────────────────────────────────

const KEY_ASSET_ALIASES = {
  equity: ['SP500', 'NAS100', 'ES', 'NQ', 'SPX', 'NDX'],
  bonds:  ['US10Y', 'US2Y', 'US30Y', 'ZN', 'ZB', 'ZT', 'BONDS'],
  gold:   ['GOLD', 'GC', 'XAU', 'GLD'],
  oil:    ['WTI', 'CL', 'OIL', 'CRUDE', 'BRENT'],
  usd:    ['DXY', 'USDX', 'USD'],
};

function findKeyAsset(role, allAssetsWithFlow) {
  const aliases = KEY_ASSET_ALIASES[role] ?? [];
  for (const alias of aliases) {
    const found = allAssetsWithFlow.find(a =>
      a.pair?.replace('/', '').toUpperCase() === alias ||
      a.pair?.toUpperCase() === alias,
    );
    if (found) return found;
  }
  return null;
}

// ── TRANSITION SCORING ────────────────────────────────────────────────────────

function scoreTransitions(regime, flows) {
  const { equity, bonds, gold, oil, usd } = flows;

  const scores = {
    IMPROVING_RISK_ON:        0,
    DETERIORATING_RISK_ON:    0,
    EMERGING_STAGFLATION:     0,
    DISINFLATION_BREAKDOWN:   0,
    LIQUIDITY_STRESS_BUILDUP: 0,
    STABLE:                   0,
  };

  // ── IMPROVING RISK-ON ─────────────────────────────────────────────────────
  if (equity?.conviction_trend === 'BUILDING')                          scores.IMPROVING_RISK_ON += 3;
  if (equity?.flow_state === 'ACCUMULATING_LONG')                       scores.IMPROVING_RISK_ON += 2;
  if (equity?.flow_state === 'ACCELERATING_LONG')                       scores.IMPROVING_RISK_ON += 4;
  if (equity?.flow_state === 'REVERSING' && equity.flow_direction === 'bearish') scores.IMPROVING_RISK_ON += 3;
  if (usd?.conviction_trend === 'FADING')                               scores.IMPROVING_RISK_ON += 1;
  if (usd?.flow_state === 'DECELERATING_LONG' || usd?.flow_state === 'REVERSING') scores.IMPROVING_RISK_ON += 1;
  if (gold?.conviction_trend === 'FADING')                              scores.IMPROVING_RISK_ON += 1;

  // ── DETERIORATING RISK-ON ─────────────────────────────────────────────────
  if (equity?.conviction_trend === 'FADING')                            scores.DETERIORATING_RISK_ON += 3;
  if (equity?.conviction_trend === 'REVERSING')                         scores.DETERIORATING_RISK_ON += 5;
  if (equity?.flow_state === 'DECELERATING_LONG')                       scores.DETERIORATING_RISK_ON += 2;
  if (equity?.flow_state === 'REVERSING' && equity.flow_direction === 'bullish') scores.DETERIORATING_RISK_ON += 4;
  if (equity?.exhaustion_probability != null && equity.exhaustion_probability >= 55) scores.DETERIORATING_RISK_ON += 2;
  if (gold?.conviction_trend === 'BUILDING')                            scores.DETERIORATING_RISK_ON += 2;
  if (gold?.flow_state === 'ACCUMULATING_LONG' || gold?.flow_state === 'ACCELERATING_LONG') scores.DETERIORATING_RISK_ON += 2;
  if (usd?.flow_state === 'ACCUMULATING_LONG' || usd?.flow_state === 'ACCELERATING_LONG')   scores.DETERIORATING_RISK_ON += 2;
  if (bonds?.conviction_trend === 'BUILDING' && bonds.flow_direction === 'bullish')         scores.DETERIORATING_RISK_ON += 2;

  // ── EMERGING STAGFLATION ──────────────────────────────────────────────────
  if (bonds?.flow_state === 'ACCUMULATING_SHORT' || bonds?.flow_state === 'ACCELERATING_SHORT') scores.EMERGING_STAGFLATION += 3;
  if (bonds?.conviction_trend === 'BUILDING' && bonds.flow_direction === 'bearish')              scores.EMERGING_STAGFLATION += 2;
  if (gold?.flow_state === 'ACCUMULATING_LONG'  || gold?.flow_state === 'ACCELERATING_LONG')     scores.EMERGING_STAGFLATION += 3;
  if (oil?.flow_state  === 'ACCUMULATING_LONG'  || oil?.flow_state  === 'ACCELERATING_LONG')     scores.EMERGING_STAGFLATION += 2;
  if (equity?.conviction_trend === 'FADING' || equity?.flow_state?.includes('DECELERATING'))     scores.EMERGING_STAGFLATION += 1;

  // ── DISINFLATION BREAKDOWN ────────────────────────────────────────────────
  // Disinflationary bond positioning unwinding = rates surprise / reflation
  if (bonds?.conviction_trend === 'REVERSING')                          scores.DISINFLATION_BREAKDOWN += 4;
  if (bonds?.conviction_trend === 'FADING' && bonds.flow_direction === 'bullish') scores.DISINFLATION_BREAKDOWN += 3;
  if (bonds?.flow_state === 'REVERSING' && bonds.flow_direction === 'bullish')    scores.DISINFLATION_BREAKDOWN += 3;
  if (oil?.conviction_trend === 'BUILDING')                             scores.DISINFLATION_BREAKDOWN += 2;
  if (gold?.flow_state?.includes('ACCUMULATING') || gold?.conviction_trend === 'BUILDING') scores.DISINFLATION_BREAKDOWN += 1;

  // ── LIQUIDITY STRESS BUILD-UP ─────────────────────────────────────────────
  if (usd?.flow_state === 'ACCELERATING_LONG')                          scores.LIQUIDITY_STRESS_BUILDUP += 5;
  if (usd?.conviction_trend === 'BUILDING' && usd.flow_direction === 'bullish') scores.LIQUIDITY_STRESS_BUILDUP += 3;
  if (equity?.flow_state === 'ACCELERATING_SHORT')                      scores.LIQUIDITY_STRESS_BUILDUP += 4;
  if (equity?.conviction_trend === 'REVERSING')                         scores.LIQUIDITY_STRESS_BUILDUP += 3;
  if (equity?.exhaustion_probability != null && equity.exhaustion_probability >= 70) scores.LIQUIDITY_STRESS_BUILDUP += 2;
  if (gold?.flow_state === 'REVERSING')                                 scores.LIQUIDITY_STRESS_BUILDUP += 2;  // gold sold for cash
  if (oil?.conviction_trend === 'FADING')                               scores.LIQUIDITY_STRESS_BUILDUP += 1;

  // ── STABLE ────────────────────────────────────────────────────────────────
  const available = [equity, bonds, gold, oil, usd].filter(Boolean);
  const stableCount = available.filter(a =>
    a.conviction_trend === 'STABLE' || a.conviction_trend === 'BUILDING',
  ).length;
  // Regime-expectation alignment boosts stability
  const regimeExp = REGIME_EXPECTATIONS[regime] ?? REGIME_EXPECTATIONS.TRANSITIONAL;
  const alignedCount = available.filter(a => {
    const role = Object.keys(flows).find(k => flows[k] === a);
    const exp  = regimeExp[role];
    return exp && a.flow_direction === exp;
  }).length;
  scores.STABLE += stableCount * 2 + alignedCount;

  return scores;
}

// ── CONFIRMATION & DETERIORATION SIGNALS ──────────────────────────────────────

function buildConfirmationSignals(transitionType, flows) {
  const { equity, bonds, gold, oil, usd } = flows;
  const signals = [];

  if (transitionType === 'IMPROVING_RISK_ON') {
    if (equity?.flow_state?.includes('ACCUMULATING_LONG') || equity?.flow_state?.includes('ACCELERATING'))
      signals.push('Equity futures net long accumulation — institutional risk appetite expanding');
    if (usd?.conviction_trend === 'FADING' || usd?.flow_state?.includes('DECELERATING'))
      signals.push('Dollar positioning fading — capital rotating from haven to risk assets');
    if (gold?.conviction_trend === 'FADING')
      signals.push('Gold accumulation slowing — safe-haven demand not building');
  }

  if (transitionType === 'DETERIORATING_RISK_ON') {
    if (equity?.flow_state?.includes('DECELERATING') || equity?.conviction_trend === 'FADING')
      signals.push('Equity net long accumulation decelerating — institutional risk reduction in progress');
    if (gold?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Gold accumulation emerging — institutional defensive hedging building');
    if (usd?.flow_state?.includes('ACCUMULATING_LONG') || usd?.flow_state?.includes('ACCELERATING'))
      signals.push('Dollar net long positioning growing — haven demand signal');
    if (bonds?.conviction_trend === 'BUILDING' && bonds.flow_direction === 'bullish')
      signals.push('Fixed income accumulation re-emerging — safety rotation in progress');
  }

  if (transitionType === 'EMERGING_STAGFLATION') {
    if (bonds?.flow_state?.includes('SHORT'))
      signals.push('Bond selling pressure — rising inflation premium building in yield curve');
    if (gold?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Gold accumulation — inflation hedge demand intensifying');
    if (oil?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Energy net long building — cost-push inflation / supply disruption signal');
  }

  if (transitionType === 'DISINFLATION_BREAKDOWN') {
    if (bonds?.conviction_trend === 'REVERSING' || bonds?.flow_state === 'REVERSING')
      signals.push('Disinflationary bond positioning reversing — reflation / supply-side shock threat');
    if (oil?.conviction_trend === 'BUILDING')
      signals.push('Energy accumulation re-emerging — commodity reflation risk');
  }

  if (transitionType === 'LIQUIDITY_STRESS_BUILDUP') {
    if (usd?.flow_state === 'ACCELERATING_LONG')
      signals.push('Dollar positioning accelerating long — funding demand / dollar squeeze developing');
    if (equity?.conviction_trend === 'REVERSING')
      signals.push('Institutional equity positioning in active reversal — forced de-risking signal');
    if (gold?.flow_state === 'REVERSING')
      signals.push('Gold selling into weakness — classic liquidity-driven liquidation pattern');
  }

  return signals.slice(0, 4);
}

function buildDeteriorationSignals(regime, flows) {
  const { equity, bonds, gold, oil, usd } = flows;
  const signals = [];

  if (regime === 'RISK_ON') {
    if (equity?.exhaustion_probability != null && equity.exhaustion_probability >= 50)
      signals.push(`Equity positioning exhaustion risk elevated (${equity.exhaustion_probability}%) — mean-reversion threat`);
    if (gold?.conviction_trend === 'BUILDING')
      signals.push('Gold accumulation emerging contrary to risk-on — institutional hedging signal');
    if (usd?.flow_state?.includes('ACCELERATING_LONG'))
      signals.push('Dollar squeeze risk building — FX liquidity warning');
  }

  if (regime === 'RISK_OFF') {
    if (equity?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Equity accumulation emerging — potential risk-on recovery underway');
    if (gold?.exhaustion_probability != null && gold.exhaustion_probability >= 50)
      signals.push(`Gold positioning at exhaustion risk (${gold.exhaustion_probability}%) — haven trade potentially overcrowded`);
  }

  if (regime === 'STAGFLATION') {
    if (bonds?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Bond accumulation emerging — inflation expectations may be peaking');
    if (oil?.conviction_trend === 'FADING')
      signals.push('Energy conviction fading — stagflation pressure potentially moderating');
  }

  if (regime === 'DISINFLATION') {
    if (oil?.conviction_trend === 'BUILDING')
      signals.push('Energy accumulation re-emerging — disinflationary thesis under threat from supply');
    if (bonds?.conviction_trend === 'FADING')
      signals.push('Fixed income conviction fading — duration demand softening');
  }

  if (regime === 'LIQUIDITY_STRESS') {
    if (equity?.conviction_trend !== 'REVERSING' && equity?.flow_state?.includes('ACCUMULATING_LONG'))
      signals.push('Equity accumulation emerging — stress potentially peaking / dip-buying activity');
  }

  return signals.slice(0, 3);
}

// ── VELOCITY & STABILITY ──────────────────────────────────────────────────────

function computeTransitionVelocity(scores, topType, topScore) {
  if (topType === 'STABLE') return 'STATIC';
  if (topScore >= 10)       return 'RAPID';
  if (topScore >= 6)        return 'MODERATE';
  if (topScore >= 3)        return 'GRADUAL';
  return 'STATIC';
}

function computeRegimeStability(flows, regime, confidence) {
  const available = Object.values(flows).filter(Boolean);
  if (!available.length) return 50;  // no data = indeterminate

  const regimeExp = REGIME_EXPECTATIONS[regime] ?? REGIME_EXPECTATIONS.TRANSITIONAL;

  let stability = confidence ?? 50;  // start from regime confidence

  // Asset alignment with regime expectation
  let aligned = 0;
  let checked = 0;
  for (const [role, flow] of Object.entries(flows)) {
    if (!flow) continue;
    const exp = regimeExp[role];
    if (!exp || exp === 'neutral') continue;
    checked++;
    if (flow.flow_direction === exp) aligned++;
  }
  if (checked > 0) {
    const alignRate = aligned / checked;
    stability = stability * 0.5 + alignRate * 100 * 0.5;
  }

  // Penalize for assets in REVERSING or EXHAUSTING states
  const reversingCount = available.filter(f =>
    f.flow_state === 'REVERSING' || f.flow_state === 'EXHAUSTING',
  ).length;
  stability -= reversingCount * 12;

  // Penalize for low-streak assets
  const lowStreakCount = available.filter(f => (f.streak?.length ?? 0) <= 1).length;
  stability -= lowStreakCount * 5;

  return Math.round(Math.max(0, Math.min(100, stability)));
}

function computeConfidenceTrend(flows, regime, confidence) {
  const available = Object.values(flows).filter(Boolean);
  if (!available.length) return 'STABLE';

  const regimeExp = REGIME_EXPECTATIONS[regime] ?? {};
  let buildingInDir = 0;
  let fadingInDir   = 0;

  for (const [role, flow] of Object.entries(flows)) {
    if (!flow) continue;
    const exp = regimeExp[role];
    const aligned = !exp || exp === 'neutral' || flow.flow_direction === exp;
    if (flow.conviction_trend === 'BUILDING' && aligned)  buildingInDir++;
    if (flow.conviction_trend === 'FADING'   && aligned)  fadingInDir++;
    if (flow.conviction_trend === 'REVERSING')             fadingInDir += 2;
  }

  if (buildingInDir > fadingInDir + 1)         return 'IMPROVING';
  if (fadingInDir   > buildingInDir + 1)       return 'DETERIORATING';
  if (confidence >= 70 && fadingInDir === 0)   return 'IMPROVING';
  if (confidence <= 35)                         return 'DETERIORATING';
  return 'STABLE';
}

// ── PER-ASSET REGIME TREND ────────────────────────────────────────────────────

/**
 * Classifies how an individual asset is positioned relative to the current macro regime.
 *
 * @param {Object} biasEntry      — scored bias entry
 * @param {Object} flowPersistence— FlowPersistenceProfile from flowPersistenceEngine
 * @param {Object} riskRegime     — current macro risk regime
 * @param {string} cat            — asset class: 'fx' | 'index' | 'bonds' | 'commodities'
 * @returns {string} regime_trend label
 */
export function buildAssetRegimeTrend(biasEntry, flowPersistence, riskRegime, cat) {
  const regime    = riskRegime?.regime ?? 'TRANSITIONAL';
  const direction = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';

  // Derive the "role" this asset plays
  // For FX we use generic alignment; for specific assets use role-based check
  const pair = biasEntry?.pair ?? '';
  let role;
  if (['SP500', 'NAS100', 'ES', 'NQ'].some(a => pair.includes(a)))      role = 'equity';
  else if (['US10Y', 'US2Y', 'US30Y', 'ZN', 'ZB'].some(a => pair.includes(a))) role = 'bonds';
  else if (['GOLD', 'GC', 'XAU'].some(a => pair.includes(a)))            role = 'gold';
  else if (['WTI', 'CL', 'OIL'].some(a => pair.includes(a)))             role = 'oil';
  else if (['DXY', 'USDX'].some(a => pair.includes(a)))                  role = 'usd';
  else role = cat ?? 'fx';  // FX pairs use cat

  const regimeExp = REGIME_EXPECTATIONS[regime] ?? {};
  const expected  = regimeExp[role];
  const isAligned = !expected || expected === 'neutral' || direction === expected;

  const flowState   = flowPersistence?.flow_state ?? 'NEUTRAL';
  const convTrend   = flowPersistence?.conviction_trend ?? 'UNKNOWN';

  // Leading: accelerating in regime-aligned direction
  if (isAligned && (flowState === 'ACCELERATING_LONG' || flowState === 'ACCELERATING_SHORT')) {
    return 'LEADING';
  }

  // Lagging: decelerating after long regime alignment
  if (isAligned && (flowState === 'DECELERATING_LONG' || flowState === 'DECELERATING_SHORT')) {
    return 'LAGGING';
  }

  // Aligned: building in regime-expected direction
  if (isAligned && convTrend === 'BUILDING') return 'ALIGNED';

  // Converging: direction matches but still building conviction
  if (isAligned && (convTrend === 'STABLE' || convTrend === 'UNKNOWN')) return 'CONVERGING';

  // Reversing: clear direction flip
  if (flowState === 'REVERSING') return 'REVERSING';

  // Diverging: direction opposes regime expectation
  if (!isAligned && direction !== 'neutral') return 'DIVERGING';

  return 'NEUTRAL';
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Detects regime transition type, velocity, and stability from cross-asset flow data.
 *
 * @param {Object}   riskRegime          — current macro risk regime
 * @param {Array}    allAssetsWithFlow    — array of { pair, cat, direction, flowPersistence, biasEntry }
 * @param {Object}   [opts]
 * @param {number}   [opts.confidenceBoost] — optional regime confidence adjustment
 * @returns {RegimeTransitionProfile}
 */
export function buildRegimeTransition(riskRegime, allAssetsWithFlow = []) {
  const regime     = riskRegime?.regime     ?? 'TRANSITIONAL';
  const confidence = riskRegime?.confidence ?? 50;
  const signals    = riskRegime?.signals    ?? {};

  // Extract key asset flow profiles
  const flows = {
    equity: findKeyAsset('equity', allAssetsWithFlow)?.flowPersistence ?? null,
    bonds:  findKeyAsset('bonds',  allAssetsWithFlow)?.flowPersistence ?? null,
    gold:   findKeyAsset('gold',   allAssetsWithFlow)?.flowPersistence ?? null,
    oil:    findKeyAsset('oil',    allAssetsWithFlow)?.flowPersistence ?? null,
    usd:    findKeyAsset('usd',    allAssetsWithFlow)?.flowPersistence ?? null,
  };

  const availableCount = Object.values(flows).filter(Boolean).length;
  const signalCoverage = availableCount >= 4 ? 'HIGH'
    : availableCount >= 2 ? 'MODERATE'
    : availableCount >= 1 ? 'LOW'
    : 'NONE';

  // Score each transition type
  const transitionScores = scoreTransitions(regime, flows);

  // Find top transition type
  const sortedEntries = Object.entries(transitionScores)
    .sort(([, a], [, b]) => b - a);
  const [topType, topScore]    = sortedEntries[0];
  const [secondType, secondScore] = sortedEntries[1] ?? ['STABLE', 0];

  // Need a meaningful gap from STABLE to call a transition
  const stableScore    = transitionScores.STABLE ?? 0;
  const transitionGap  = topType !== 'STABLE' ? topScore - stableScore : 0;

  let transitionType;
  if (signalCoverage === 'NONE') {
    transitionType = 'STABLE';
  } else if (transitionGap >= 5) {
    transitionType = topType;
  } else if (transitionGap >= 2 && secondScore < topScore) {
    // Moderate signal — call it a transitional state
    transitionType = 'MACRO_TRANSITION';
  } else {
    transitionType = 'STABLE';
  }

  const velocity           = computeTransitionVelocity(transitionScores, transitionType, topScore);
  const stability          = computeRegimeStability(flows, regime, confidence);
  const confidenceTrend    = computeConfidenceTrend(flows, regime, confidence);
  const confirmationSignals = buildConfirmationSignals(transitionType, flows);
  const deteriorationSignals = buildDeteriorationSignals(regime, flows);

  const emergingRegime = (transitionType !== 'STABLE' && transitionType !== 'MACRO_TRANSITION')
    ? (TRANSITION_TARGET_REGIME[transitionType] ?? null)
    : null;

  // Key watch: what to monitor for confirmation
  const keyWatch = buildKeyWatch(transitionType, regime, flows);

  // Regime evolution timeline
  const regimeTimeline = {
    current:        regime,
    emerging:       emergingRegime,
    confidence_trend: confidenceTrend,
    key_watch:      keyWatch,
  };

  return {
    transition_type:        transitionType,
    transition_label:       TRANSITION_LABELS[transitionType] ?? transitionType,
    transition_color:       TRANSITION_COLORS[transitionType] ?? '#6b7280',
    velocity,
    stability,
    confidence_trend:       confidenceTrend,
    confirmation_signals:   confirmationSignals,
    deterioration_signals:  deteriorationSignals,
    emerging_regime:        emergingRegime,
    regime_timeline:        regimeTimeline,
    signal_coverage:        signalCoverage,
    available_key_assets:   availableCount,
    regime_signals_context: signals,
    scores_debug: {
      IMPROVING_RISK_ON:        transitionScores.IMPROVING_RISK_ON,
      DETERIORATING_RISK_ON:    transitionScores.DETERIORATING_RISK_ON,
      EMERGING_STAGFLATION:     transitionScores.EMERGING_STAGFLATION,
      DISINFLATION_BREAKDOWN:   transitionScores.DISINFLATION_BREAKDOWN,
      LIQUIDITY_STRESS_BUILDUP: transitionScores.LIQUIDITY_STRESS_BUILDUP,
      STABLE:                   transitionScores.STABLE,
    },
    meta: {
      regime_at_analysis: regime,
      regime_confidence:  confidence,
      second_transition:  secondType,
      second_score:       secondScore,
      transition_gap:     transitionGap,
    },
  };
}

function buildKeyWatch(transitionType, regime, flows) {
  const { equity, gold } = flows;

  if (transitionType === 'IMPROVING_RISK_ON') {
    return equity?.conviction_trend === 'BUILDING'
      ? 'Monitorizar si la convicción en renta variable sostiene 3+ semanas consecutivas de acumulación neta larga'
      : 'Vigilar si el posicionamiento en renta variable cambia de distribución a acumulación en datos COT';
  }

  if (transitionType === 'DETERIORATING_RISK_ON') {
    if (gold?.flow_state?.includes('ACCUMULATING_LONG'))
      return 'Seguir si el neto largo en oro continúa creciendo — confirma la tesis de rotación defensiva';
    return 'Monitorizar la ruptura de la racha neta larga en renta variable y la divergencia USD/oro para confirmación del cambio de régimen';
  }

  if (transitionType === 'EMERGING_STAGFLATION') {
    return 'Vigilar venta de bonos + oro + petróleo acelerando simultáneamente — se requiere triple confirmación';
  }

  if (transitionType === 'DISINFLATION_BREAKDOWN') {
    return 'Monitorizar si el posicionamiento neto largo en bonos se estabiliza o continúa deshaciendo — determina la durabilidad de la reflación';
  }

  if (transitionType === 'LIQUIDITY_STRESS_BUILDUP') {
    return 'Seguir la aceleración del posicionamiento en DXY y si la venta de oro continúa (margin calls) o se recupera';
  }

  if (regime === 'RISK_ON') return 'Vigilar la racha de convicción en renta variable y el posicionamiento neto en bonos para señales tempranas de rotación defensiva';
  if (regime === 'RISK_OFF') return 'Monitorizar futuros de renta variable para señales tempranas de acumulación y riesgo de agotamiento del oro';
  if (regime === 'STAGFLATION') return 'Seguir la desaceleración de ventas de bonos — indicador líder clave del pico estanflacionario';
  return 'Monitorizar la convergencia del posicionamiento entre activos para claridad de régimen';
}

export function transitionColor(type) {
  return TRANSITION_COLORS[type] ?? '#6b7280';
}
