// =============================================================================
// Earnings Regime Engine
//
// Classifies the current earnings environment and predicts regime shifts.
// Input: adaptedEarnings from earningsAdapter + macroContext
// Output: regime classification, drift prediction, volatility regime, score.
// =============================================================================

import { clamp } from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Regime classification ─────────────────────────────────────────────────────

export const EARNINGS_REGIME = {
  BEAT_ACCELERATION:  'BEAT_ACCELERATION',   // beats + improving surprise magnitude
  BEAT_DECELERATION:  'BEAT_DECELERATION',   // beats but shrinking surprise
  MISS_ACCELERATION:  'MISS_ACCELERATION',   // misses + worsening
  MISS_RECOVERY:      'MISS_RECOVERY',       // coming off misses, improving
  STABLE_BEAT:        'STABLE_BEAT',         // consistent beats, no change in trajectory
  TRANSITION:         'TRANSITION',          // mixed signals
  INSUFFICIENT_DATA:  'INSUFFICIENT_DATA',
};

const REGIME_META = {
  [EARNINGS_REGIME.BEAT_ACCELERATION]: {
    color: '#22c55e', label: 'Beat Acceleration', score: 85,
    drift: 'STRONG_POSITIVE', description: 'Accelerating positive EPS surprises — highest momentum state',
  },
  [EARNINGS_REGIME.STABLE_BEAT]: {
    color: '#4ade80', label: 'Stable Beat', score: 70,
    drift: 'MILD_POSITIVE', description: 'Consistent EPS beats with stable surprise magnitude',
  },
  [EARNINGS_REGIME.BEAT_DECELERATION]: {
    color: '#fbbf24', label: 'Beat Deceleration', score: 55,
    drift: 'NEUTRAL', description: 'Still beating but surprise size shrinking — watch revisions',
  },
  [EARNINGS_REGIME.TRANSITION]: {
    color: '#f97316', label: 'Transition', score: 45,
    drift: 'NEUTRAL', description: 'Mixed earnings signals — regime change likely in progress',
  },
  [EARNINGS_REGIME.MISS_RECOVERY]: {
    color: '#fb923c', label: 'Miss Recovery', score: 40,
    drift: 'MILD_POSITIVE', description: 'Coming off misses; improving but not yet positive',
  },
  [EARNINGS_REGIME.MISS_ACCELERATION]: {
    color: '#ef4444', label: 'Miss Acceleration', score: 15,
    drift: 'STRONG_NEGATIVE', description: 'Worsening EPS misses — elevated downside risk',
  },
  [EARNINGS_REGIME.INSUFFICIENT_DATA]: {
    color: '#6b7280', label: 'Insufficient Data', score: 50,
    drift: 'NEUTRAL', description: 'Not enough earnings history to classify regime',
  },
};

// ── Regime classification logic ───────────────────────────────────────────────

function classifyRegime(summary, earnings) {
  if (!summary || earnings.length < 4) return EARNINGS_REGIME.INSUFFICIENT_DATA;

  const streak = summary.streak ?? 0;
  const momentum = summary.revisionMomentum ?? 0;
  const beatRate = summary.beatRate ?? 0;

  if (streak >= 3 && momentum > 2)   return EARNINGS_REGIME.BEAT_ACCELERATION;
  if (streak >= 2 && momentum >= 0)  return EARNINGS_REGIME.STABLE_BEAT;
  if (streak >= 1 && momentum < -2)  return EARNINGS_REGIME.BEAT_DECELERATION;
  if (streak <= -3 && momentum < -2) return EARNINGS_REGIME.MISS_ACCELERATION;
  if (streak <= -1 && momentum > 2)  return EARNINGS_REGIME.MISS_RECOVERY;
  if (beatRate < 0.4)                return EARNINGS_REGIME.MISS_ACCELERATION;
  if (beatRate > 0.6)                return EARNINGS_REGIME.STABLE_BEAT;
  return EARNINGS_REGIME.TRANSITION;
}

// ── Volatility regime ─────────────────────────────────────────────────────────

function classifyVolatilityRegime(earnings) {
  if (!earnings.length) return { regime: 'UNKNOWN', expectedMove: null };
  const surprises = earnings.map(e => Math.abs(e.epsSurprisePct ?? 0));
  const avgSurprise = surprises.reduce((s, v) => s + v, 0) / (surprises.length || 1);

  if (avgSurprise > 20) return { regime: 'EXTREME', expectedMove: '> 8%' };
  if (avgSurprise > 10) return { regime: 'HIGH',    expectedMove: '4-8%' };
  if (avgSurprise > 5)  return { regime: 'NORMAL',  expectedMove: '2-4%' };
  return                        { regime: 'LOW',     expectedMove: '< 2%' };
}

// ── Post-earnings drift prediction ────────────────────────────────────────────

function predictDrift(regime, streak, latestSurprise) {
  const meta = REGIME_META[regime];
  const base = meta.drift;

  const magnitude = (() => {
    const absSurprise = Math.abs(latestSurprise ?? 0);
    if (absSurprise > 20) return 'LARGE';
    if (absSurprise > 10) return 'MEDIUM';
    if (absSurprise > 5)  return 'SMALL';
    return 'NEGLIGIBLE';
  })();

  return { direction: base, magnitude, confidence: Math.abs(streak ?? 0) >= 3 ? 'HIGH' : 'MEDIUM' };
}

// ── Revision trend ────────────────────────────────────────────────────────────

function computeRevisionTrend(earnings) {
  if (earnings.length < 4) return null;

  const recent = earnings.slice(0, 2).map(e => e.epsSurprisePct ?? 0);
  const prior  = earnings.slice(2, 6).map(e => e.epsSurprisePct ?? 0);

  const recentAvg = recent.reduce((s, v) => s + v, 0) / (recent.length || 1);
  const priorAvg  = prior.reduce((s, v) => s + v, 0)  / (prior.length  || 1);

  const delta = recentAvg - priorAvg;
  return {
    recentAvg:   Math.round(recentAvg * 100) / 100,
    priorAvg:    Math.round(priorAvg * 100) / 100,
    delta:       Math.round(delta * 100) / 100,
    trend:       delta > 3 ? 'IMPROVING' : delta < -3 ? 'DETERIORATING' : 'STABLE',
  };
}

// ── Revenue alignment ─────────────────────────────────────────────────────────

function computeRevenueAlignment(earnings) {
  const withRevData = earnings.filter(e => e.revenueSurprisePct != null).slice(0, 4);
  if (withRevData.length < 2) return null;

  const revBeatRate = withRevData.filter(e => (e.revenueSurprisePct ?? 0) >= 0).length / withRevData.length;
  const epsRevAlign = withRevData.filter(e =>
    ((e.epsSurprisePct ?? 0) >= 0) === ((e.revenueSurprisePct ?? 0) >= 0)
  ).length / withRevData.length;

  return {
    revBeatRate:   Math.round(revBeatRate * 100),
    epsRevAlign:   Math.round(epsRevAlign * 100),
    divergence:    epsRevAlign < 0.5 ? 'HIGH' : epsRevAlign < 0.75 ? 'MEDIUM' : 'LOW',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} adaptedEarnings - from earningsAdapter.adaptEarnings()
 * @param {object} macroContext - { riskRegime, fedStance, yieldEnv } optional
 * @returns {object} EarningsRegimeResult
 */
export function computeEarningsRegime(adaptedEarnings, macroContext = {}) {
  if (!adaptedEarnings) return null;

  const { earnings, summary, qualitySignals, ticker } = adaptedEarnings;

  const regime = classifyRegime(summary, earnings);
  const meta   = REGIME_META[regime];

  const volRegime   = classifyVolatilityRegime(earnings);
  const driftPred   = predictDrift(regime, summary?.streak, earnings[0]?.epsSurprisePct);
  const revisionTrend = computeRevisionTrend(earnings);
  const revAlign    = computeRevenueAlignment(earnings);

  // Macro adjustment: high yield env compresses forward P/E multiples → lower score
  let macroAdj = 0;
  if (macroContext.yieldEnv === 'HIGH') macroAdj -= 5;
  if (macroContext.riskRegime === 'risk_off') macroAdj -= 8;
  if (macroContext.fedStance === 'hawkish') macroAdj -= 5;
  if (macroContext.fedStance === 'dovish')  macroAdj += 5;

  const score = clamp((meta.score ?? 50) + macroAdj, 0, 100);

  return {
    ticker,
    regime,
    score,
    label:        meta.label,
    color:        meta.color,
    description:  meta.description,
    volatilityRegime: volRegime,
    drift:        driftPred,
    revisionTrend,
    revenueAlignment: revAlign,
    summary,
    qualitySignals,
    macroAdjustment: macroAdj,
    computedAt: new Date().toISOString(),
  };
}

export { REGIME_META };
