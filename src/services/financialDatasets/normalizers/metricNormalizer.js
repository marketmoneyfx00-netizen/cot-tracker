// =============================================================================
// Metric Normalizer
//
// Common normalization utilities: percentile ranking, z-score, clamp, label.
// These are pure math helpers used across all FD engines.
// =============================================================================

export function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function zScore(value, mean, std) {
  if (std === 0 || std == null) return 0;
  return (value - mean) / std;
}

/** Map z-score to a 0-100 score where 50=neutral, 100=strong positive, 0=strong negative */
export function zToScore(z, cap = 3) {
  const clamped = clamp(z, -cap, cap);
  return clamp(50 + (clamped / cap) * 50, 0, 100);
}

/** Percentile rank of value in array (0-100) */
export function percentileRank(value, array) {
  if (!array?.length) return 50;
  const below = array.filter(v => v < value).length;
  return clamp(Math.round((below / array.length) * 100), 0, 100);
}

/** Normalize value from [min,max] domain to [0,100] score */
export function rangeTo100(value, min, max) {
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Weighted average of {value, weight} pairs */
export function weightedAvg(items) {
  if (!items?.length) return 50;
  let wSum = 0, total = 0;
  for (const { value, weight } of items) {
    if (value == null || weight == null) continue;
    wSum  += value * weight;
    total += weight;
  }
  return total === 0 ? 50 : clamp(wSum / total, 0, 100);
}

/** Simple EMA over array of numbers */
export function ema(values, period) {
  if (!values?.length) return null;
  const k = 2 / (period + 1);
  let v = values[0];
  for (let i = 1; i < values.length; i++) {
    v = values[i] * k + v * (1 - k);
  }
  return v;
}

/** Compute rolling returns from price array */
export function rollingReturns(prices, window = 20) {
  if (!prices || prices.length < window + 1) return [];
  const returns = [];
  for (let i = window; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - window]) / prices[i - window]);
  }
  return returns;
}

/** Annualized volatility from daily returns */
export function annualizedVol(dailyReturns) {
  if (!dailyReturns?.length) return null;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  return Math.sqrt(variance * 252);
}

/** Pearson correlation between two arrays of equal length */
export function correlation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const xa = x.slice(0, n), ya = y.slice(0, n);
  const mx = xa.reduce((s, v) => s + v, 0) / n;
  const my = ya.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xa[i] - mx, dy = ya[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/** Score label */
export function scoreLabel(score) {
  if (score >= 80) return 'Very Strong';
  if (score >= 65) return 'Strong';
  if (score >= 45) return 'Neutral';
  if (score >= 30) return 'Weak';
  return 'Very Weak';
}

/** Direction label */
export function directionLabel(score) {
  if (score >= 60) return 'bullish';
  if (score <= 40) return 'bearish';
  return 'neutral';
}

/** Conviction label */
export function convictionLabel(score) {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

/** Format percent for display */
export function fmtPct(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

/** Format large numbers (1.2M, 350B) */
export function fmtLarge(v) {
  if (v == null) return 'N/A';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}
