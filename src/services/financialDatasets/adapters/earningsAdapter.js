// =============================================================================
// Earnings Adapter
//
// Transforms raw /api/fd?type=earnings response into EarningsSummary
// used by earningsRegimeEngine.
// =============================================================================

import { normalizeEarnings } from '../normalizers/fundamentalsNormalizer.js';

export function adaptEarnings(raw, ticker) {
  const normalized = normalizeEarnings(raw);
  if (!normalized) return null;

  return {
    ticker,
    ...normalized,
    qualitySignals: deriveQualitySignals(normalized),
    fetchedAt: new Date().toISOString(),
  };
}

function deriveQualitySignals(normalized) {
  const { summary, earnings } = normalized;

  const recentThree = earnings.slice(0, 3);
  const oldThree    = earnings.slice(3, 6);

  const recentAvgSurprise = avg(recentThree.map(e => e.epsSurprisePct ?? 0));
  const oldAvgSurprise    = avg(oldThree.map(e => e.epsSurprisePct ?? 0));

  const guidanceAcceleration = recentAvgSurprise - oldAvgSurprise;

  // Post-earnings drift proxy: consecutive beats → strong positive drift expected
  const streak       = summary.streak ?? 0;
  const driftSignal  = streak > 2 ? 'STRONG_POSITIVE' : streak > 0 ? 'MILD_POSITIVE' :
                       streak < -2 ? 'STRONG_NEGATIVE' : streak < 0 ? 'MILD_NEGATIVE' : 'NEUTRAL';

  // Volatility regime
  const latestSurprise = Math.abs(earnings[0]?.epsSurprisePct ?? 0);
  const volatilityRegime = latestSurprise > 15 ? 'HIGH_VOL' : latestSurprise > 5 ? 'NORMAL' : 'LOW_VOL';

  return {
    guidanceAcceleration: Math.round(guidanceAcceleration * 100) / 100,
    driftSignal,
    volatilityRegime,
    consistencyScore: computeConsistency(earnings),
  };
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function computeConsistency(earnings) {
  if (earnings.length < 4) return null;
  const surprises = earnings.map(e => e.epsSurprisePct ?? 0);
  const mean = avg(surprises);
  const variance = avg(surprises.map(s => (s - mean) ** 2));
  const std = Math.sqrt(variance);
  // Low std dev around positive mean = high consistency
  if (mean > 0 && std < 5) return 'HIGH';
  if (mean > 0 && std < 15) return 'MEDIUM';
  return 'LOW';
}
