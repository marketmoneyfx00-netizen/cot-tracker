/**
 * tacticalMomentumEngine.js
 *
 * Computes short-term tactical momentum from OHLC candles (1-min or 4H).
 * Purpose: provide a price-action context layer SEPARATE from the institutional
 * HTF bias (cotBiasEngine). Never replaces the HTF bias — it modulates narrative
 * and execution readiness timing.
 *
 * Design principles:
 *   - Swing-aware: velocities calibrated for 4H timeframe as primary
 *   - Not hyperreactive: SMA-based, not tick-level noise
 *   - Context-first: outputs describe the state, not a signal
 */

const MIN_CANDLES = 5;

/**
 * @param {Array<{open,high,low,close,time}>} candles — OHLC newest-last
 * @returns {TacticalState}
 */
export function computeTacticalMomentum(candles) {
  if (!candles || candles.length < MIN_CANDLES) {
    return {
      direction:      null,
      pressure:       'insufficient',
      marketState:    null,
      label:          'Datos de Precio Insuficientes',
      description:    'Se necesitan más velas de precio en vivo para evaluar el estado táctico.',
      color:          '#6b7280',
      velocity:       null,
      pctChange:      null,
      volatilityFlag: false,
    };
  }

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && v > 0);
  const n      = closes.length;

  if (n < MIN_CANDLES) {
    return {
      direction: null, pressure: 'insufficient', marketState: null,
      label: 'Datos de Precio Insuficientes', description: null, color: '#6b7280',
      velocity: null, pctChange: null, volatilityFlag: false,
    };
  }

  // Fast SMA (last 3 closes) vs slow SMA (all available closes)
  const fastLen = Math.min(3, n);
  const smaFast = closes.slice(-fastLen).reduce((s, v) => s + v, 0) / fastLen;
  const smaSlow = closes.reduce((s, v) => s + v, 0) / n;

  // Momentum: first half average vs second half average
  const half       = Math.floor(n / 2);
  const firstAvg   = closes.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const secondAvg  = closes.slice(half).reduce((s, v) => s + v, 0) / (n - half);
  const momentum   = secondAvg - firstAvg;
  const pctChange  = Math.abs(firstAvg) > 0 ? (Math.abs(momentum) / firstAvg) * 100 : 0;

  // Directional bias from SMA spread
  const spread = smaFast - smaSlow;
  const dir    = spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral';

  // Velocity thresholds tuned for 4H candles (swing context)
  const velocity = pctChange > 0.15 ? 'fast' : pctChange > 0.05 ? 'moderate' : 'slow';

  // Bar consistency: how many of last N bars agree with direction
  const bars       = candles.slice(-Math.min(8, n));
  const bullBars   = bars.filter(c => c.close > c.open).length;
  const bearBars   = bars.length - bullBars;
  const consistency = bars.length > 0 ? Math.abs(bullBars - bearBars) / bars.length : 0;

  // Volatility expansion flag: high/low range on last 3 bars vs earlier bars
  let volatilityFlag = false;
  if (candles.length >= 6) {
    const recentRange = candles.slice(-3).reduce((s, c) => s + (c.high - c.low), 0) / 3;
    const olderRange  = candles.slice(-6, -3).reduce((s, c) => s + (c.high - c.low), 0) / 3;
    if (olderRange > 0) volatilityFlag = recentRange / olderRange > 1.6;
  }

  // ── State classification ──────────────────────────────────────────────────
  let marketState, label, pressure, description, color;

  if (dir === 'bearish' && velocity === 'fast' && consistency > 0.5) {
    marketState = 'tactical_breakdown';
    label       = 'Ruptura Táctica';
    pressure    = 'bearish';
    description = 'Momentum bajista agresivo activo. Presión direccional acelerando a la baja.';
    color       = '#ef4444';

  } else if (dir === 'bearish' && volatilityFlag) {
    marketState = 'volatility_expansion';
    label       = 'Expansión de Volatilidad';
    pressure    = 'bearish';
    description = 'Rango expandiéndose con sesgo bajista. Incertidumbre elevada en la acción del precio a corto plazo.';
    color       = '#f97316';

  } else if (dir === 'bearish' && (velocity === 'fast' || velocity === 'moderate')) {
    marketState = 'corrective_phase';
    label       = 'Fase Correctiva';
    pressure    = 'bearish';
    description = 'Presión de precio bajista activa. Retroceso o corrección en curso.';
    color       = '#f97316';

  } else if (dir === 'bearish') {
    marketState = 'pullback_active';
    label       = 'Fase de Retroceso';
    pressure    = 'bearish';
    description = 'Deriva bajista leve. Monitorizando estabilización.';
    color       = '#f59e0b';

  } else if (dir === 'bullish' && velocity === 'fast' && consistency > 0.5) {
    marketState = 'expansion';
    label       = 'Fase de Expansión';
    pressure    = 'bullish';
    description = 'Momentum alcista fuerte. Presión direccional acelerando al alza.';
    color       = '#22c55e';

  } else if (dir === 'bullish' && volatilityFlag) {
    marketState = 'volatility_expansion';
    label       = 'Expansión de Volatilidad';
    pressure    = 'bullish';
    description = 'Rango expandiéndose con sesgo alcista. Momentum elevado en la acción del precio a corto plazo.';
    color       = '#f59e0b';

  } else if (dir === 'bullish' && velocity === 'moderate') {
    marketState = 'trend_continuation';
    label       = 'Continuación de Tendencia';
    pressure    = 'bullish';
    description = 'Presión alcista moderada. Contexto de continuación estructural desarrollándose.';
    color       = '#4ade80';

  } else if (dir === 'bullish') {
    marketState = 'recovery_phase';
    label       = 'Intento de Recuperación';
    pressure    = 'bullish';
    description = 'Deriva alcista leve. Construyendo base — monitorizando aumento de convicción.';
    color       = '#86efac';

  } else {
    marketState = 'compression';
    label       = 'Compresión';
    pressure    = 'neutral';
    description = 'Sin momentum direccional claro. Precio en rango — aguardando catalizador.';
    color       = '#6b7280';
  }

  return { direction: dir, pressure, marketState, label, description, color, velocity, pctChange, volatilityFlag };
}

/**
 * Determine if structural bias and tactical pressure are in conflict.
 * Returns false when tactical data is insufficient or neutral (not enough signal).
 *
 * @param {string} structuralDir  — 'bullish' | 'bearish' | 'neutral'
 * @param {string} tacPressure    — 'bullish' | 'bearish' | 'neutral' | 'insufficient'
 */
export function detectBiasTacticalConflict(structuralDir, tacPressure) {
  if (!structuralDir || !tacPressure || tacPressure === 'insufficient' || tacPressure === 'neutral') {
    return false;
  }
  return structuralDir !== tacPressure;
}

/**
 * Quantify the intensity of bias-tactical conflict.
 * Used by confidenceDecayEngine to calibrate decay speed.
 *
 * @param {string} structuralDir  — 'bullish' | 'bearish' | 'neutral'
 * @param {object} tacState       — TacticalState
 * @returns {'none'|'mild'|'moderate'|'severe'}
 */
export function getConflictIntensity(structuralDir, tacState) {
  if (!structuralDir || !tacState || tacState.pressure === 'insufficient') return 'none';
  if (tacState.pressure === 'neutral') return 'none';
  if (structuralDir === tacState.pressure) return 'none';

  // Conflict confirmed — quantify by velocity and state
  const { velocity, marketState } = tacState;
  if (marketState === 'tactical_breakdown' || velocity === 'fast') return 'severe';
  if (marketState === 'corrective_phase'   || velocity === 'moderate') return 'moderate';
  return 'mild';
}
