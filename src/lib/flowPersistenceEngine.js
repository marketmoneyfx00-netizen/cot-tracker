/**
 * flowPersistenceEngine.js — Institutional Flow Persistence & Momentum Engine v1.0
 *
 * Analyzes weekly COT positioning changes to detect:
 *   - Flow state: accumulation/distribution persistence, acceleration, deceleration, exhaustion
 *   - Positioning momentum: velocity (1st derivative) and acceleration (2nd derivative)
 *   - Conviction trend: is institutional conviction building or fading?
 *   - Exhaustion and reversal probability based on z-score evolution + streak dynamics
 *   - Structural strength: how durable is the current institutional thesis?
 *
 * Design:
 *   - Pure functions. No side effects. No state. No React.
 *   - Uses pairRow.weeks array (most recent first) for time-series analysis.
 *   - Minimum 2 weeks required; 4+ weeks for full analysis.
 *   - All scores are dimensionless (0–100) or labeled constants.
 *
 * Input:  pairRow (with weeks array), biasEntry
 * Output: FlowPersistenceProfile
 */

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

export const FLOW_STATES = {
  ACCUMULATING_LONG:    'ACCUMULATING_LONG',
  ACCUMULATING_SHORT:   'ACCUMULATING_SHORT',
  ACCELERATING_LONG:    'ACCELERATING_LONG',
  ACCELERATING_SHORT:   'ACCELERATING_SHORT',
  DECELERATING_LONG:    'DECELERATING_LONG',
  DECELERATING_SHORT:   'DECELERATING_SHORT',
  EXHAUSTING:           'EXHAUSTING',
  REVERSING:            'REVERSING',
  NEUTRAL:              'NEUTRAL',
};

export const CONVICTION_TRENDS = {
  BUILDING:  'BUILDING',
  STABLE:    'STABLE',
  FADING:    'FADING',
  REVERSING: 'REVERSING',
  UNKNOWN:   'UNKNOWN',
};

export const FLOW_STATE_LABELS = {
  ACCUMULATING_LONG:  'Acumulación Larga',
  ACCUMULATING_SHORT: 'Acumulación Corta',
  ACCELERATING_LONG:  'Aceleración Larga',
  ACCELERATING_SHORT: 'Aceleración Corta',
  DECELERATING_LONG:  'Desaceleración Larga',
  DECELERATING_SHORT: 'Desaceleración Corta',
  EXHAUSTING:         'Posición en Agotamiento',
  REVERSING:          'Reversión de Posicionamiento',
  NEUTRAL:            'Neutral / Mixto',
};

export const FLOW_STATE_COLORS = {
  ACCUMULATING_LONG:  '#22c55e',
  ACCUMULATING_SHORT: '#ef4444',
  ACCELERATING_LONG:  '#16a34a',
  ACCELERATING_SHORT: '#b91c1c',
  DECELERATING_LONG:  '#86efac',
  DECELERATING_SHORT: '#fca5a5',
  EXHAUSTING:         '#f97316',
  REVERSING:          '#a78bfa',
  NEUTRAL:            '#6b7280',
};

// Minimum absolute weekly change (contracts) to be considered a meaningful flow signal
const FLOW_THRESHOLD = 1500;

// ── INTERNAL UTILS ────────────────────────────────────────────────────────────

function round(v, d = 2) {
  if (v == null || isNaN(v)) return null;
  return parseFloat(v.toFixed(d));
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── TIME-SERIES EXTRACTION ────────────────────────────────────────────────────

/**
 * Extract net positions from weeks array (most recent first).
 * Merges latest + weeks[1..N] to get a full time series.
 */
function extractNetPositions(latest, weeks) {
  const all = [latest, ...(weeks ?? [])].slice(0, 12);
  return all
    .map(w => ({
      net:  w?.smartNet  ?? null,
      pctL: w?.smartPctL ?? null,
      date: w?.isoDate   ?? null,
    }))
    .filter(w => w.net != null);
}

/**
 * Compute weekly velocity array (1st derivative, most recent first).
 * velocity[i] = net[i] - net[i+1]
 */
function computeVelocities(nets) {
  const v = [];
  for (let i = 0; i < nets.length - 1; i++) {
    v.push(nets[i].net - nets[i + 1].net);
  }
  return v;
}

/**
 * Compute acceleration array (2nd derivative, most recent first).
 * acceleration[i] = velocity[i] - velocity[i+1]
 */
function computeAccelerations(velocities) {
  const a = [];
  for (let i = 0; i < velocities.length - 1; i++) {
    a.push(velocities[i] - velocities[i + 1]);
  }
  return a;
}

// ── FLOW STATE DETECTION ──────────────────────────────────────────────────────

function detectFlowState(velocities, accelerations, direction, zscore, divState) {
  if (!velocities.length) return 'NEUTRAL';

  const v0 = velocities[0];
  const v1 = velocities[1] ?? null;
  const a0 = accelerations[0] ?? null;
  const absZ = zscore != null ? Math.abs(zscore) : 0;

  // Divergence exhaustion signal: override everything
  if (divState === 'EXHAUSTION') return 'EXHAUSTING';

  // Velocity direction flip vs prior week = reversal in progress
  if (v1 != null && ((v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0))) {
    // But only flag as REVERSING if the flip is meaningful
    if (Math.abs(v0) > FLOW_THRESHOLD) return 'REVERSING';
  }

  // Z-score extreme + deceleration = exhaustion
  if (absZ >= 2.0 && a0 != null) {
    const zAlignedWithDir = (zscore > 0 && direction === 'bullish') ||
                            (zscore < 0 && direction === 'bearish');
    const decel = (v0 > 0 && a0 < 0) || (v0 < 0 && a0 > 0);
    if (zAlignedWithDir && decel && absZ >= 2.3) return 'EXHAUSTING';
  }

  if (Math.abs(v0) < FLOW_THRESHOLD) return 'NEUTRAL';

  const isLong = v0 > 0;

  // Classify with acceleration context
  if (a0 != null && Math.abs(a0) > FLOW_THRESHOLD / 2) {
    const accelerating = (v0 > 0 && a0 > 0) || (v0 < 0 && a0 < 0);
    if (accelerating) return isLong ? 'ACCELERATING_LONG' : 'ACCELERATING_SHORT';
    return isLong ? 'DECELERATING_LONG' : 'DECELERATING_SHORT';
  }

  return isLong ? 'ACCUMULATING_LONG' : 'ACCUMULATING_SHORT';
}

// ── SCORE COMPUTATIONS ────────────────────────────────────────────────────────

function computePersistenceScore(streak, velocities, direction) {
  const dirSign = direction === 'bullish' ? 1 : direction === 'bearish' ? -1 : 0;

  // Base from consecutive-report streak
  let base;
  if (streak >= 6)      base = 90;
  else if (streak >= 4) base = 75;
  else if (streak >= 3) base = 60;
  else if (streak >= 2) base = 42;
  else if (streak >= 1) base = 25;
  else                  base = 10;

  // Modulate by flow direction consistency over last 4 weeks
  if (velocities.length >= 2 && dirSign !== 0) {
    const sample    = velocities.slice(0, 4);
    const aligned   = sample.filter(v => v * dirSign > 0).length;
    const total     = sample.length;
    const consist   = aligned / total;  // 0..1
    // Blend: high consistency preserves score, low penalizes
    base = Math.round(base * consist + (base * 0.30) * (1 - consist));
  }

  return Math.round(clamp(base, 0, 100));
}

function computeExhaustionProbability(zscore, streak, velocities, divState, accelerations) {
  let prob = 0;

  const absZ = zscore != null ? Math.abs(zscore) : 0;
  const v0   = velocities[0]     ?? null;
  const a0   = accelerations[0]  ?? null;

  // Z-score extreme (primary driver)
  if (absZ >= 3.0)      prob += 50;
  else if (absZ >= 2.5) prob += 38;
  else if (absZ >= 2.0) prob += 25;
  else if (absZ >= 1.5) prob += 10;

  // Long streak at extreme amplifies mean-reversion risk
  if (streak >= 6)      prob += 20;
  else if (streak >= 4) prob += 12;
  else if (streak >= 2) prob += 5;

  // Deceleration at extreme = very high exhaustion
  if (v0 != null && a0 != null) {
    const decel = (v0 > 0 && a0 < 0) || (v0 < 0 && a0 > 0);
    if (decel && absZ >= 2.0) prob += 18;
    else if (decel)           prob += 8;
  }

  // Divergence signal
  if (divState === 'EXHAUSTION')        prob += 25;
  else if (divState?.includes('DIVERGENCE')) prob += 8;

  // Recent velocity direction flip = early reversal indicator
  if (velocities.length >= 2 && v0 != null) {
    const v1 = velocities[1];
    if ((v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0)) prob += 15;
  }

  return Math.round(clamp(prob, 0, 100));
}

function computeFlowMomentum(velocities) {
  // Weighted rolling sum of last 4 weeks
  const weights = [0.40, 0.30, 0.20, 0.10];
  const n = Math.min(4, velocities.length);
  if (!n) return null;

  let weighted = 0;
  let totalW   = 0;
  for (let i = 0; i < n; i++) {
    weighted += (velocities[i] ?? 0) * weights[i];
    totalW   += weights[i];
  }
  const raw = weighted / (totalW || 1);
  // Normalize to -100..+100 using 50K contracts as ±100 reference
  return round(clamp(raw / 500, -100, 100), 1);
}

function detectConvictionTrend(nets, streak, direction, biasScore) {
  if (nets.length < 2) return 'UNKNOWN';

  const cur  = nets[0].net;
  const prev = nets[1]?.net ?? null;
  const prev2= nets[2]?.net ?? null;

  if (cur == null || prev == null) return 'UNKNOWN';

  const delta0  = cur  - prev;
  const delta1  = prev2 != null ? prev - prev2 : null;
  const dirSign = direction === 'bullish' ? 1 : direction === 'bearish' ? -1 : 0;
  const biasAbs = Math.abs(biasScore ?? 0);

  // Direction change — positioning actively moving against institutional thesis
  if (dirSign !== 0 && delta0 * dirSign < -5000) return 'REVERSING';

  // Building — position growing in thesis direction with meaningful bias
  if (dirSign !== 0 && delta0 * dirSign > 3000 && biasAbs >= 2.0) return 'BUILDING';

  // Building from streak context
  if (streak >= 3 && dirSign !== 0 && delta0 * dirSign > 0) return 'BUILDING';

  // Fading — two consecutive weeks of position reduction
  if (delta1 != null && delta0 * dirSign < 0 && delta1 * dirSign < 0) return 'FADING';

  // Weak positioning or minimal streak = fading signal
  if (biasAbs < 1.0 || streak <= 1) return 'FADING';

  return 'STABLE';
}

function computeStructuralStrength(streak, nets, velocities, zscore, biasScore) {
  let strength = 0;

  // Streak (primary driver)
  if (streak >= 6)      strength += 40;
  else if (streak >= 4) strength += 30;
  else if (streak >= 3) strength += 22;
  else if (streak >= 2) strength += 14;
  else if (streak >= 1) strength += 8;

  // Net position scale (absolute institutional exposure)
  const net = nets[0]?.net;
  if (net != null) {
    const absNet = Math.abs(net);
    if (absNet >= 100000)     strength += 20;
    else if (absNet >= 50000) strength += 15;
    else if (absNet >= 25000) strength += 10;
    else if (absNet >= 10000) strength += 5;
  }

  // Bias magnitude
  const biasAbs = Math.abs(biasScore ?? 0);
  if (biasAbs >= 4)      strength += 20;
  else if (biasAbs >= 3) strength += 15;
  else if (biasAbs >= 2) strength += 10;
  else if (biasAbs >= 1) strength += 5;

  // Z-score: structured (not flat, not crowded) = best
  if (zscore != null) {
    const absZ = Math.abs(zscore);
    if (absZ >= 1.0 && absZ < 2.5) strength += 10;  // clean institutional structure
    else if (absZ < 0.5)           strength -= 5;    // flat = weak conviction
    else if (absZ >= 2.5)          strength -= 5;    // crowded = reversal risk
  }

  // Velocity consistency: all recent weeks flowing in same direction
  if (velocities.length >= 3) {
    const signs = velocities.slice(0, 3).map(v => Math.sign(v));
    if (signs.every(s => s === signs[0] && s !== 0)) strength += 10;
  }

  return Math.round(clamp(strength, 0, 100));
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Builds a comprehensive flow persistence and positioning momentum profile.
 *
 * @param {Object} pairRow    — pairRow with latest + weeks array (most recent first)
 * @param {Object} biasEntry  — scored bias entry from cotBiasEngine
 * @returns {FlowPersistenceProfile}
 */
export function buildFlowPersistence(pairRow, biasEntry) {
  const latest   = pairRow?.latest  ?? pairRow?.weeks?.[0] ?? {};
  const weeks    = pairRow?.weeks   ?? [];
  const signal   = pairRow?.signal  ?? {};
  const zscore   = biasEntry?.zscore?.zscore ?? null;
  const divState = biasEntry?.divergence?.state ?? 'NONE';
  const direction = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';
  const biasScore = biasEntry?.bias?.score     ?? biasEntry?.score     ?? 0;
  const streak    = signal.strength ?? 0;

  const nets = extractNetPositions(latest, weeks.slice(1));

  // Insufficient data — return minimal profile
  if (nets.length < 2) {
    return {
      flow_state:               'NEUTRAL',
      flow_state_label:         FLOW_STATE_LABELS.NEUTRAL,
      flow_state_color:         FLOW_STATE_COLORS.NEUTRAL,
      persistence_score:        null,
      positioning_velocity:     null,
      positioning_acceleration: null,
      flow_momentum:            null,
      exhaustion_probability:   null,
      reversal_probability:     null,
      transition_risk:          null,
      conviction_trend:         'UNKNOWN',
      structural_strength:      null,
      flow_direction:           direction,
      streak:                   { length: streak, direction: 'neutral', consistent: false },
      data_quality:             'insufficient',
      meta: { weeks_available: nets.length, min_required: 2 },
    };
  }

  const velocities    = computeVelocities(nets);
  const accelerations = computeAccelerations(velocities);

  const positioningVelocity     = round(velocities[0] ?? null, 0);
  const positioningAcceleration = round(accelerations[0] ?? null, 0);
  const flowMomentum            = computeFlowMomentum(velocities);

  const flowState = detectFlowState(velocities, accelerations, direction, zscore, divState);

  const exhaustionProb   = computeExhaustionProbability(zscore, streak, velocities, divState, accelerations);
  const reversalProb     = Math.round(clamp(exhaustionProb * 0.70, 0, 100));
  const persistenceScore = computePersistenceScore(streak, velocities, direction);
  const convictionTrend  = detectConvictionTrend(nets, streak, direction, biasScore);
  const structuralStrength = computeStructuralStrength(streak, nets, velocities, zscore, biasScore);

  // Transition risk: exhaustion + deceleration pattern + weak streak
  const v0 = velocities[0] ?? 0;
  const a0 = accelerations[0] ?? null;
  const decelerating = a0 != null && ((v0 > 0 && a0 < 0) || (v0 < 0 && a0 > 0));
  const transitionRisk = Math.round(clamp(
    exhaustionProb * 0.55 + (decelerating ? 22 : 0) + (streak <= 1 ? 12 : 0),
    0, 100,
  ));

  const streakDir = signal.signal === 'buy' ? 'long' : signal.signal === 'sell' ? 'short' : 'neutral';
  const streakConsistent = velocities
    .slice(0, Math.min(streak, 4))
    .every(v => direction === 'bullish' ? v >= 0 : direction === 'bearish' ? v <= 0 : true);

  return {
    flow_state:               flowState,
    flow_state_label:         FLOW_STATE_LABELS[flowState] ?? flowState,
    flow_state_color:         FLOW_STATE_COLORS[flowState] ?? '#6b7280',
    persistence_score:        persistenceScore,
    positioning_velocity:     positioningVelocity,
    positioning_acceleration: positioningAcceleration,
    flow_momentum:            flowMomentum,
    exhaustion_probability:   exhaustionProb,
    reversal_probability:     reversalProb,
    transition_risk:          transitionRisk,
    conviction_trend:         convictionTrend,
    structural_strength:      structuralStrength,
    flow_direction:           direction,
    streak: {
      length:     streak,
      direction:  streakDir,
      consistent: streakConsistent,
    },
    data_quality: nets.length >= 6 ? 'full' : nets.length >= 4 ? 'good' : 'limited',
    meta: {
      weeks_available: nets.length,
      velocity_series: velocities.slice(0, 4).map(v => round(v, 0)),
      net_series:      nets.slice(0, 5).map(n => ({ net: n.net, date: n.date })),
    },
  };
}

export function flowStateColor(state) {
  return FLOW_STATE_COLORS[state] ?? '#6b7280';
}
