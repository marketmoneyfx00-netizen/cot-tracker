/**
 * adaptiveRegimeEngine.js — Adaptive Institutional Regime Engine v2.0
 *
 * Wraps riskRegimeEngine.js with:
 *   - Regime momentum (accelerating / decelerating / stable)
 *   - Conviction level (how consistent signals are)
 *   - Exhaustion detection (extreme positioning → reversal risk)
 *   - Transition signals (approaching regime shift)
 *   - Positioning acceleration/deceleration per asset class
 *   - Extended regime taxonomy (8 states vs 6)
 *
 * Extended Regimes:
 *   RISK_ON_ACCELERATION  — risk-on strengthening; conviction building
 *   RISK_ON               — established risk appetite
 *   RISK_ON_EXHAUSTION    — risk-on but positioning extreme; reversal risk
 *   RISK_OFF              — defensive / safe haven flows
 *   RISK_OFF_EXTREME      — panic or forced de-risking; potential capitulation
 *   STAGFLATION           — cost-push inflation + growth deterioration
 *   DISINFLATION          — deflationary repricing
 *   LIQUIDITY_STRESS      — systemic funding pressure
 *   TRANSITIONAL          — insufficient or conflicting signals
 *
 * All computation is pure — no API calls, no side effects.
 */

import { REGIME_LABELS, REGIME_COLORS } from '../lib/riskRegimeEngine.js';

// ─── EXTENDED REGIME METADATA ────────────────────────────────────────────────

export const ADAPTIVE_REGIME_META = {
  RISK_ON_ACCELERATION: {
    label:       'Risk-On Acceleration',
    shortLabel:  'RISK-ON ↑',
    color:       '#22c55e',
    intensity:   'high',
    bias:        'bullish',
    actionBias:  'AGGRESSIVE_LONG',
    desc:        'Institutional flows building conviction. Trend likely early-to-mid stage — favorable for momentum entries.',
  },
  RISK_ON: {
    label:       'Risk-On Expansion',
    shortLabel:  'RISK-ON',
    color:       '#4ade80',
    intensity:   'medium',
    bias:        'bullish',
    actionBias:  'LONG',
    desc:        'Established risk-on positioning. Equities bid, bonds sold, USD soft. Trend entries remain valid.',
  },
  RISK_ON_EXHAUSTION: {
    label:       'Risk-On Exhaustion',
    shortLabel:  'RISK-ON ⚠',
    color:       '#f59e0b',
    intensity:   'high',
    bias:        'cautious',
    actionBias:  'REDUCE_LONGS',
    desc:        'Risk-on but positioning at historical extremes. Smart money may be distributing. Reversal risk elevated.',
  },
  RISK_OFF: {
    label:       'Risk-Off / Defensive',
    shortLabel:  'RISK-OFF',
    color:       '#ef4444',
    intensity:   'medium',
    bias:        'bearish',
    actionBias:  'SHORT_OR_FLAT',
    desc:        'Institutional defensive posture. Equities sold, bonds bid, gold accumulation. Reduce risk exposure.',
  },
  RISK_OFF_EXTREME: {
    label:       'Risk-Off Extreme / Capitulation',
    shortLabel:  'RISK-OFF !!',
    color:       '#dc2626',
    intensity:   'extreme',
    bias:        'bearish',
    actionBias:  'DEFENSIVE',
    desc:        'Extreme defensive positioning. Potential capitulation event. High volatility — capital preservation priority.',
  },
  STAGFLATION: {
    label:       'Stagflationary Pressure',
    shortLabel:  'STAGFLATION',
    color:       '#f97316',
    intensity:   'high',
    bias:        'mixed',
    actionBias:  'COMMODITIES_LONG',
    desc:        'Inflation + growth deterioration. Bonds sold, gold/oil bid, equities pressured. Commodity longs favored.',
  },
  DISINFLATION: {
    label:       'Disinflationary Repricing',
    shortLabel:  'DISINFLATION',
    color:       '#60a5fa',
    intensity:   'medium',
    bias:        'neutral',
    actionBias:  'BONDS_LONG',
    desc:        'Inflation expectations declining. Bond bid, energy soft, gold neutral. Duration longs may outperform.',
  },
  LIQUIDITY_STRESS: {
    label:       'Liquidity Stress',
    shortLabel:  'LIQ STRESS',
    color:       '#dc2626',
    intensity:   'extreme',
    bias:        'bearish',
    actionBias:  'CASH',
    desc:        'Systemic funding pressure. Cross-asset de-risking. USD squeeze. Cash is the position.',
  },
  TRANSITIONAL: {
    label:       'Transitional / Mixed',
    shortLabel:  'TRANSITIONAL',
    color:       '#8491a8',
    intensity:   'low',
    bias:        'neutral',
    actionBias:  'WAIT',
    desc:        'Mixed or insufficient signals. No dominant regime established. Await directional convergence.',
  },
};

// ─── POSITIONING ACCELERATION ────────────────────────────────────────────────
// Detects whether net positions are growing (acceleration) or shrinking (deceleration)

function computePositioningMomentum(biasArr = []) {
  if (!biasArr.length) return { direction: 'neutral', strength: 0 };

  let accelerating = 0, decelerating = 0;

  biasArr.forEach(b => {
    if (!b) return;
    // Expansion state = accumulation building
    if (b.state === 'expansion') accelerating++;
    else if (b.state === 'building') accelerating += 0.5;
    // Distribution state = positioning unwinding
    else if (b.state === 'distribution') decelerating++;
    else if (b.state === 'compression') decelerating += 0.5;
  });

  const net = accelerating - decelerating;
  const total = biasArr.length || 1;
  const strength = Math.abs(net) / total; // 0–1

  return {
    direction: net > 0.3 ? 'accelerating' : net < -0.3 ? 'decelerating' : 'stable',
    strength: parseFloat(strength.toFixed(2)),
    acceleratingCount: Math.round(accelerating),
    deceleratingCount: Math.round(decelerating),
  };
}

// ─── EXHAUSTION DETECTION ────────────────────────────────────────────────────
// Extreme positioning = positioning at historical limits → mean reversion risk

function detectExhaustion(biasArr = []) {
  if (!biasArr.length) return { isExhausted: false, extremePairs: [] };

  const extremePairs = biasArr.filter(b => {
    const pct = b?.zscore?.percentile;
    return pct != null && (pct >= 88 || pct <= 12);
  });

  const isExhausted = extremePairs.length >= 2;

  return {
    isExhausted,
    extremePairs: extremePairs.map(b => ({
      pair: b.pair,
      percentile: b.zscore?.percentile,
      direction: (b.zscore?.percentile ?? 50) > 50 ? 'overbought' : 'oversold',
    })),
  };
}

// ─── CONVICTION SCORING ───────────────────────────────────────────────────────
// How many independent signals agree with the base regime

function computeConviction(baseRegime, biasArr, macroSignal, riskRegime) {
  let score = riskRegime?.confidence ?? 0; // 0-10 base

  // Macro alignment bonus
  const usdBias = macroSignal?.bias;
  if (baseRegime === 'RISK_ON' || baseRegime === 'RISK_ON_ACCELERATION') {
    if (usdBias === 'USD_WEAK' || usdBias === 'USD_LEANING_WEAK') score += 2;
    if (usdBias === 'USD_STRONG') score -= 2;
  } else if (baseRegime === 'RISK_OFF' || baseRegime === 'RISK_OFF_EXTREME') {
    if (usdBias === 'USD_STRONG' || usdBias === 'USD_LEANING_STRONG') score += 2;
    if (usdBias === 'USD_WEAK') score -= 2;
  }

  // COT signal alignment bonus: many pairs trending same direction
  const validBias = biasArr.filter(b => b && typeof b.score === 'number');
  if (validBias.length) {
    const bullCount = validBias.filter(b => b.score > 1).length;
    const bearCount = validBias.filter(b => b.score < -1).length;
    const pctAligned = Math.max(bullCount, bearCount) / validBias.length;
    if (pctAligned >= 0.7) score += 2;
    else if (pctAligned >= 0.5) score += 1;
    else score -= 1;
  }

  score = Math.min(10, Math.max(0, Math.round(score)));
  return {
    score,
    level: score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low',
  };
}

// ─── TRANSITION SIGNAL ───────────────────────────────────────────────────────
// Detect whether a regime change is approaching

function detectTransitionSignal(baseRegime, positioningMomentum, exhaustion, macroSignal) {
  const signals = [];
  let transitionRisk = 'low';

  if (exhaustion.isExhausted) {
    transitionRisk = 'elevated';
    signals.push(`${exhaustion.extremePairs.length} pairs at historical positioning extremes — distribution risk`);
  }

  if (positioningMomentum.direction === 'decelerating' &&
      (baseRegime === 'RISK_ON' || baseRegime === 'RISK_ON_ACCELERATION')) {
    transitionRisk = 'elevated';
    signals.push('Institutional accumulation pace slowing — risk-on momentum fading');
  }

  if (positioningMomentum.direction === 'accelerating' &&
      (baseRegime === 'RISK_OFF' || baseRegime === 'TRANSITIONAL')) {
    signals.push('Institutional flows building in defensive assets — risk-off building');
  }

  const usdBias = macroSignal?.bias;
  if (baseRegime === 'RISK_ON' && (usdBias === 'USD_STRONG' || usdBias === 'USD_LEANING_STRONG')) {
    transitionRisk = transitionRisk === 'elevated' ? 'high' : 'elevated';
    signals.push('USD strengthening conflicts with risk-on positioning — regime coherence weakening');
  }

  return {
    transitionRisk,
    signals: signals.slice(0, 4),
    isPending: transitionRisk !== 'low',
  };
}

// ─── EXTEND BASE REGIME ───────────────────────────────────────────────────────
// Maps the base regime + adaptive signals → extended 9-state taxonomy

function extendRegime(baseRegime, positioningMomentum, exhaustion) {
  if (baseRegime === 'RISK_ON') {
    if (exhaustion.isExhausted && exhaustion.extremePairs.length >= 3) {
      return 'RISK_ON_EXHAUSTION';
    }
    if (positioningMomentum.direction === 'accelerating' && positioningMomentum.strength > 0.4) {
      return 'RISK_ON_ACCELERATION';
    }
    return 'RISK_ON';
  }

  if (baseRegime === 'RISK_OFF') {
    if (exhaustion.isExhausted && positioningMomentum.direction === 'accelerating') {
      return 'RISK_OFF_EXTREME';
    }
    return 'RISK_OFF';
  }

  // Other regimes pass through
  return baseRegime;
}

// ─── KEY DRIVERS (ADAPTIVE) ──────────────────────────────────────────────────

function buildAdaptiveDrivers(extRegime, positioningMomentum, exhaustion, transition) {
  const drivers = [];

  // Momentum context
  if (positioningMomentum.direction === 'accelerating') {
    drivers.push(`Institutional positioning accelerating — ${positioningMomentum.acceleratingCount} pairs in expansion/building state`);
  } else if (positioningMomentum.direction === 'decelerating') {
    drivers.push(`Institutional positioning decelerating — ${positioningMomentum.deceleratingCount} pairs in distribution/compression state`);
  }

  // Exhaustion
  if (exhaustion.isExhausted) {
    const extremeLabels = exhaustion.extremePairs.slice(0, 2).map(p =>
      `${p.pair} (${p.direction}, ${p.percentile?.toFixed(0)}th pct)`
    ).join(', ');
    drivers.push(`Extreme positioning detected: ${extremeLabels}`);
  }

  // Action bias
  const meta = ADAPTIVE_REGIME_META[extRegime];
  if (meta) {
    drivers.push(`Recommended posture: ${meta.actionBias.replace(/_/g, ' ')}`);
  }

  // Transition warning
  if (transition.isPending) {
    transition.signals.slice(0, 2).forEach(s => drivers.push(s));
  }

  return drivers.slice(0, 5);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * computeAdaptiveRegime — main entry point.
 *
 * @param {{
 *   baseRegime:   Object   — output of computeRiskRegime()
 *   biasArr:      Array    — from buildBiasArray()
 *   allBiasArr:   Array    — all assets
 *   macroSignal:  Object|null
 * }}
 *
 * @returns {{
 *   regime:           string   — extended regime key
 *   meta:             Object   — ADAPTIVE_REGIME_META entry
 *   base:             Object   — original riskRegime output
 *   conviction:       Object   — { score, level }
 *   momentum:         Object   — { direction, strength }
 *   exhaustion:       Object   — { isExhausted, extremePairs }
 *   transition:       Object   — { transitionRisk, signals, isPending }
 *   adaptiveDrivers:  string[]
 * }}
 */
export function computeAdaptiveRegime({ baseRegime, biasArr = [], allBiasArr = [], macroSignal = null } = {}) {
  if (!baseRegime) {
    return {
      regime:          'TRANSITIONAL',
      meta:            ADAPTIVE_REGIME_META.TRANSITIONAL,
      base:            null,
      conviction:      { score: 0, level: 'low' },
      momentum:        { direction: 'neutral', strength: 0 },
      exhaustion:      { isExhausted: false, extremePairs: [] },
      transition:      { transitionRisk: 'low', signals: [], isPending: false },
      adaptiveDrivers: ['Awaiting COT data and macro signal'],
    };
  }

  const combinedBias     = [...(biasArr || []), ...(allBiasArr || [])].filter(Boolean);
  const positioningMomentum = computePositioningMomentum(combinedBias);
  const exhaustion          = detectExhaustion(combinedBias);
  const extRegime           = extendRegime(baseRegime.regime, positioningMomentum, exhaustion);
  const conviction          = computeConviction(extRegime, combinedBias, macroSignal, baseRegime);
  const transition          = detectTransitionSignal(extRegime, positioningMomentum, exhaustion, macroSignal);
  const adaptiveDrivers     = buildAdaptiveDrivers(extRegime, positioningMomentum, exhaustion, transition);

  return {
    regime:           extRegime,
    meta:             ADAPTIVE_REGIME_META[extRegime] || ADAPTIVE_REGIME_META.TRANSITIONAL,
    base:             baseRegime,
    conviction,
    momentum:         positioningMomentum,
    exhaustion,
    transition,
    adaptiveDrivers,
  };
}
