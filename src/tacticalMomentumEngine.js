/**
 * tacticalMomentumEngine.js
 *
 * Computes short-term tactical momentum from 1-minute OHLC candles.
 * Purpose: provide a price-action context layer that is SEPARATE from
 * the institutional HTF bias (cotBiasEngine). Never replaces the HTF bias —
 * it modulates narrative and execution readiness.
 *
 * Returns a tactical state object that signals whether the market is in
 * expansion, pullback, compression, breakdown, etc. — independent of COT data.
 */

const MIN_CANDLES = 5;

/**
 * @param {Array<{open,high,low,close,time}>} candles — 1-min OHLC, newest last
 * @returns TacticalState
 */
export function computeTacticalMomentum(candles) {
  if (!candles || candles.length < MIN_CANDLES) {
    return {
      direction:   null,
      pressure:    'insufficient',
      marketState: null,
      label:       'Insufficient Price Data',
      description: 'Need more live price candles to assess tactical state.',
      color:       '#6b7280',
      velocity:    null,
      pctChange:   null,
    };
  }

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && v > 0);
  const n = closes.length;

  if (n < MIN_CANDLES) {
    return {
      direction: null, pressure: 'insufficient', marketState: null,
      label: 'Insufficient Price Data', description: null, color: '#6b7280',
      velocity: null, pctChange: null,
    };
  }

  // Fast SMA (last 3 closes) vs slow SMA (all available closes)
  const fastLen = Math.min(3, n);
  const slowLen = n;
  const smaFast = closes.slice(-fastLen).reduce((s, v) => s + v, 0) / fastLen;
  const smaSlow = closes.reduce((s, v) => s + v, 0) / slowLen;

  // Momentum: first half avg vs second half avg
  const half         = Math.floor(n / 2);
  const firstHalf    = closes.slice(0, half);
  const secondHalf   = closes.slice(half);
  const firstAvg     = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg    = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const momentum     = secondAvg - firstAvg;
  const pctChange    = Math.abs(firstAvg) > 0 ? (Math.abs(momentum) / firstAvg) * 100 : 0;

  // Directional bias from SMA spread
  const spread = smaFast - smaSlow;
  const dir    = spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral';

  // Velocity: how sharp the move is
  const velocity = pctChange > 0.08 ? 'fast' : pctChange > 0.03 ? 'moderate' : 'slow';

  // Bar consistency: count bearish vs bullish bars
  const bars        = candles.slice(-Math.min(8, n));
  const bullBars    = bars.filter(c => c.close > c.open).length;
  const bearBars    = bars.length - bullBars;
  const consistency = bars.length > 0 ? Math.abs(bullBars - bearBars) / bars.length : 0;

  let marketState, label, pressure, description, color;

  if (dir === 'bearish' && velocity === 'fast' && consistency > 0.5) {
    marketState  = 'tactical_breakdown';
    label        = 'Tactical Breakdown';
    pressure     = 'bearish';
    description  = 'Aggressive bearish momentum active. Price accelerating lower.';
    color        = '#ef4444';
  } else if (dir === 'bearish' && (velocity === 'fast' || velocity === 'moderate')) {
    marketState  = 'corrective_phase';
    label        = 'Corrective Phase';
    pressure     = 'bearish';
    description  = 'Bearish price pressure active. Pullback or correction underway.';
    color        = '#f97316';
  } else if (dir === 'bearish') {
    marketState  = 'pullback_active';
    label        = 'Pullback Active';
    pressure     = 'bearish';
    description  = 'Mild bearish drift. Monitoring for stabilization.';
    color        = '#f59e0b';
  } else if (dir === 'bullish' && velocity === 'fast' && consistency > 0.5) {
    marketState  = 'expansion';
    label        = 'Expansion Phase';
    pressure     = 'bullish';
    description  = 'Strong bullish momentum. Price accelerating higher.';
    color        = '#22c55e';
  } else if (dir === 'bullish' && (velocity === 'fast' || velocity === 'moderate')) {
    marketState  = 'recovery_phase';
    label        = 'Recovery Phase';
    pressure     = 'bullish';
    description  = 'Bullish price pressure building. Recovering from lows.';
    color        = '#4ade80';
  } else if (dir === 'bullish') {
    marketState  = 'stabilization';
    label        = 'Stabilization';
    pressure     = 'bullish';
    description  = 'Mild bullish drift. Building base.';
    color        = '#86efac';
  } else {
    marketState  = 'compression';
    label        = 'Compression';
    pressure     = 'neutral';
    description  = 'No clear directional momentum. Market in range.';
    color        = '#6b7280';
  }

  return { direction: dir, pressure, marketState, label, description, color, velocity, pctChange };
}

/**
 * Determine if structural bias and tactical pressure conflict.
 * @param {string} structuralDir — 'bullish'|'bearish'|'neutral'
 * @param {string} tacticalPressure — 'bullish'|'bearish'|'neutral'|'insufficient'
 */
export function detectBiasTacticalConflict(structuralDir, tacticalPressure) {
  if (!structuralDir || !tacticalPressure || tacticalPressure === 'insufficient' || tacticalPressure === 'neutral') {
    return false;
  }
  return structuralDir !== tacticalPressure;
}
