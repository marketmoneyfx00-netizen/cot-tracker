/**
 * marketStateEngine.js — Structural Context Synthesis Layer
 *
 * Synthesizes all existing engine outputs into a single, coherent
 * "what is the market actually doing?" classification per pair.
 *
 * Design principles:
 *   - Zero duplication: consumes already-computed outputs, never re-derives
 *   - 5 clear market states — not 40 micro-categories
 *   - Detects TRANSITIONAL state (the USDCHF problem: inst. bullish + structure bearish)
 *   - Observational language only — never "buy" or "sell"
 *   - Horizon-aware: institutional (weeks) never confused with intraday
 *
 * Inputs (all already available in App.jsx / MarketDecisionLayer):
 *   biasEntry   — one row from buildBiasArray() for a specific pair
 *   tacState    — from computeTacticalMomentum() for that pair
 *   macroSignal — from useMacroSignal()
 *   sentimentData — { vix, fg }
 *
 * Output: MarketStateResult (see typedef below)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MARKET_STATES = {
  FULL_ALIGNMENT:  'FULL_ALIGNMENT',
  TRANSITIONAL:    'TRANSITIONAL',
  DISTRIBUTION:    'DISTRIBUTION',
  CONFLICTED:      'CONFLICTED',
  NEUTRAL:         'NEUTRAL',
};

// ── Structural bias from tactical momentum ────────────────────────────────────
// Maps tacState output → structural directional bias label.
// tacState covers last ~5 days of 4H candles — meaningful HTF proxy.
function deriveStructureBias(tacState) {
  if (!tacState || tacState.pressure === 'insufficient') return 'UNKNOWN';

  const { pressure, marketState, volatilityFlag, velocity } = tacState;

  if (marketState === 'compression')                          return 'COMPRESSION';
  if (volatilityFlag && velocity === 'fast')                  return 'EXPANSION';
  if (pressure === 'bullish')                                 return 'BULLISH';
  if (pressure === 'bearish')                                 return 'BEARISH';
  return 'RANGING';
}

// ── Institutional bias from COT ───────────────────────────────────────────────
function deriveInstitutionalBias(biasEntry) {
  const score = biasEntry?.score ?? 0;
  if (score >  1.0) return 'BULLISH';
  if (score < -1.0) return 'BEARISH';
  return 'NEUTRAL';
}

// ── Volatility state ──────────────────────────────────────────────────────────
function deriveVolatilityState(sentimentData, tacState) {
  const vix  = sentimentData?.vix ?? 18;
  const flag = tacState?.volatilityFlag ?? false;
  const vel  = tacState?.velocity ?? 'slow';

  if (vix > 28 || (flag && vel === 'fast'))  return 'EXPANSION';
  if (vix > 20 || flag)                       return 'ELEVATED';
  if (vix < 13 && tacState?.marketState === 'compression') return 'COMPRESSION';
  return 'NORMAL';
}

// ── Crowding risk from z-score ─────────────────────────────────────────────────
function deriveCrowdingRisk(biasEntry) {
  const zs = biasEntry?.zscore;
  if (!zs) return 'LOW';

  const { state, percentile } = zs;
  if (state === 'EXTREME_LONG' || state === 'EXTREME_SHORT')     return 'EXTREME';
  if (state === 'ELEVATED_LONG' || state === 'ELEVATED_SHORT')   return 'ELEVATED';
  if (percentile > 72 || percentile < 28)                        return 'MODERATE';
  return 'LOW';
}

// ── Timing state ──────────────────────────────────────────────────────────────
// Answers: is the user arriving early, mid-trend, or late?
function deriveTimingState(biasEntry, tacState, instBias, structureBias, crowdingRisk) {
  const cotState   = biasEntry?.state ?? 'compression';  // expansion|distribution|building|compression
  const divState   = biasEntry?.divergence?.state ?? '';
  const tacPressure = tacState?.pressure ?? 'neutral';

  // Exhaustion signals — highest priority
  if (cotState === 'distribution')                          return 'EXHAUSTION';
  if (divState === 'EXHAUSTION')                            return 'EXHAUSTION';
  if (crowdingRisk === 'EXTREME' && cotState === 'expansion') return 'LATE_TREND';

  // Full expansion with alignment
  if (cotState === 'expansion' && tacPressure === (instBias === 'BULLISH' ? 'bullish' : 'bearish')) {
    return crowdingRisk === 'LOW' || crowdingRisk === 'MODERATE' ? 'EXPANSION' : 'LATE_TREND';
  }

  // Building with structural conflict → classic early accumulation
  if (cotState === 'building' && structureBias !== 'UNKNOWN' &&
      structureBias !== (instBias === 'BULLISH' ? 'BULLISH' : 'BEARISH')) {
    return 'EARLY_ACCUMULATION';
  }

  // Building with tactical alignment → confirmation phase
  if (cotState === 'building' && tacPressure === (instBias === 'BULLISH' ? 'bullish' : 'bearish')) {
    return 'CONFIRMATION';
  }

  return 'NEUTRAL';
}

// ── Alignment score ────────────────────────────────────────────────────────────
// 0–100. Measures how much all independent layers agree.
function computeAlignmentScore(biasEntry, instBias, structureBias, macroSignal, crowdingRisk, volatilityState) {
  let score = 50; // neutral baseline

  // 1. COT strength (0–20)
  const cotAbs = Math.min(5, Math.abs(biasEntry?.score ?? 0));
  score += (cotAbs / 5) * 20;

  // 2. Structure alignment with institutional bias (+15 / 0 / -15)
  if (instBias !== 'NEUTRAL' && structureBias !== 'UNKNOWN' && structureBias !== 'RANGING') {
    const strucDir = structureBias === 'BULLISH' ? 'BULLISH' : structureBias === 'BEARISH' ? 'BEARISH' : null;
    if (strucDir === instBias)  score += 15;
    else if (strucDir !== null) score -= 15;
  }

  // 3. Carry alignment (+10 / 0 / -8)
  const carry = biasEntry?.carryScore ?? null;
  if (carry !== null && instBias !== 'NEUTRAL') {
    const carryAligned = (instBias === 'BULLISH' && carry > 0) || (instBias === 'BEARISH' && carry < 0);
    if (carryAligned) score += 10;
    else if (carry !== 0) score -= 8;
  }

  // 4. Macro alignment (+10 / 0 / -10)
  const macroConf = biasEntry?.macroConfidence ?? 1.0;
  // macroConfidence: 1.0 = neutral/aligned, <0.85 = conflict, >1.0 not possible (clamped)
  if (macroConf < 0.80)       score -= 10;
  else if (macroConf > 0.95)  score += 10;

  // 5. Confluence score contribution (-10 to +10)
  const conf = biasEntry?.confluence?.confluenceScore ?? 50;
  score += ((conf - 50) / 50) * 10;

  // 6. Crowding risk penalty
  const crowdPenalty = { LOW: 0, MODERATE: -5, ELEVATED: -10, EXTREME: -20 };
  score += crowdPenalty[crowdingRisk] ?? 0;

  // 7. Volatility regime
  const volAdj = { COMPRESSION: -2, NORMAL: 3, ELEVATED: -5, EXPANSION: -10 };
  score += volAdj[volatilityState] ?? 0;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Market state classification ────────────────────────────────────────────────
function classifyMarketState(instBias, structureBias, alignmentScore, timingState, crowdingRisk) {
  // Distribution / exhaustion
  if (timingState === 'EXHAUSTION' || crowdingRisk === 'EXTREME') {
    return MARKET_STATES.DISTRIBUTION;
  }

  // Full alignment — every layer points same direction
  if (alignmentScore >= 70 && instBias !== 'NEUTRAL' && structureBias === instBias) {
    return MARKET_STATES.FULL_ALIGNMENT;
  }

  // Transitional — THE KEY CASE (USDCHF scenario)
  // Institutional positioning building in one direction, structure hasn't confirmed yet
  if (instBias !== 'NEUTRAL' && structureBias !== 'UNKNOWN' && structureBias !== 'RANGING' &&
      structureBias !== instBias && structureBias !== 'COMPRESSION' && structureBias !== 'EXPANSION') {
    return MARKET_STATES.TRANSITIONAL;
  }

  // Conflicted — many layers disagree, low alignment
  if (alignmentScore < 38) {
    return MARKET_STATES.CONFLICTED;
  }

  // Neutral — no institutional edge
  if (instBias === 'NEUTRAL') {
    return MARKET_STATES.NEUTRAL;
  }

  // Default: alignment exists but structure not confirmed
  return alignmentScore >= 55 ? MARKET_STATES.TRANSITIONAL : MARKET_STATES.NEUTRAL;
}

// ── Execution context (observational language, never imperative) ───────────────
function deriveExecutionContext(marketState, timingState, instBias, structureBias) {
  if (marketState === MARKET_STATES.FULL_ALIGNMENT) {
    return 'Contexto de continuación de tendencia — alineación estructural favorable en todas las capas';
  }

  if (marketState === MARKET_STATES.DISTRIBUTION) {
    return 'Posicionamiento en extremos — riesgo de aglomeración elevado, señales de agotamiento presentes';
  }

  if (marketState === MARKET_STATES.CONFLICTED) {
    return 'Sin ventaja direccional — múltiples capas en conflicto, mantener postura observacional';
  }

  if (marketState === MARKET_STATES.TRANSITIONAL) {
    if (timingState === 'EARLY_ACCUMULATION') {
      if (instBias === 'BULLISH') {
        return 'Esperar confirmación estructural — acumulación institucional formándose por encima de la estructura actual';
      }
      return 'Esperar confirmación estructural — distribución institucional formándose por debajo de la estructura actual';
    }
    if (timingState === 'CONFIRMATION') {
      return 'Momentum mejorando — monitorizar ruptura estructural para confirmar la tesis institucional';
    }
    return 'Transición en curso — esperar confirmación estructural antes de comprometerse direccionalmente';
  }

  if (timingState === 'EXPANSION') {
    return 'Fase de expansión — flujo institucional y estructura alineados, monitorizar continuación';
  }

  if (timingState === 'LATE_TREND') {
    return 'Contexto de tendencia tardía — posicionamiento elevado, nuevas entradas conllevan mayor riesgo';
  }

  return 'Sin ventaja direccional — esperar desarrollo del posicionamiento institucional';
}

// ── UI metadata ───────────────────────────────────────────────────────────────
const STATE_META = {
  FULL_ALIGNMENT: {
    icon:        '🟢',
    color:       '#22c55e',
    bg:          'rgba(34,197,94,0.08)',
    border:      'rgba(34,197,94,0.25)',
    label:       'Alineación Total',
    description: 'Flujo institucional, estructura, carry y macro apuntan en la misma dirección.',
  },
  TRANSITIONAL: {
    icon:        '🟡',
    color:       '#f59e0b',
    bg:          'rgba(245,158,11,0.08)',
    border:      'rgba(245,158,11,0.25)',
    label:       'Estructura Transicional',
    description: 'El posicionamiento institucional está girando antes de que la estructura HTF lo confirme.',
  },
  DISTRIBUTION: {
    icon:        '🟠',
    color:       '#f97316',
    bg:          'rgba(249,115,22,0.08)',
    border:      'rgba(249,115,22,0.25)',
    label:       'Distribución / Agotamiento',
    description: 'Posicionamiento en extremos o con señales de reversión. Riesgo de operativa masificada elevado.',
  },
  CONFLICTED: {
    icon:        '🔴',
    color:       '#ef4444',
    bg:          'rgba(239,68,68,0.08)',
    border:      'rgba(239,68,68,0.25)',
    label:       'Señales Conflictivas',
    description: 'Capas clave se contradicen entre sí — evitar compromisos direccionales.',
  },
  NEUTRAL: {
    icon:        '⚪',
    color:       '#6b7280',
    bg:          'rgba(107,114,128,0.06)',
    border:      'rgba(107,114,128,0.2)',
    label:       'Neutral / Lateral',
    description: 'Sin ventaja direccional institucional clara. Monitorizar el desarrollo del posicionamiento.',
  },
};

const TIMING_LABELS = {
  EARLY_ACCUMULATION: 'Acumulación Temprana',
  CONFIRMATION:       'Fase de Confirmación',
  EXPANSION:          'Expansión',
  LATE_TREND:         'Tendencia Tardía',
  EXHAUSTION:         'Agotamiento',
  NEUTRAL:            'En Desarrollo',
};

const CROWDING_META = {
  LOW:      { label: 'Bajo',     color: '#22c55e' },
  MODERATE: { label: 'Moderado', color: '#f59e0b' },
  ELEVATED: { label: 'Elevado',  color: '#f97316' },
  EXTREME:  { label: 'Extremo',  color: '#ef4444' },
};

const VOLATILITY_LABELS = {
  COMPRESSION: 'Compresión',
  NORMAL:      'Normal',
  ELEVATED:    'Elevada',
  EXPANSION:   'Expansión',
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * computeMarketState
 *
 * Single entry point. Pure function — no side effects.
 *
 * @param {object} biasEntry     — one row from buildBiasArray() for the pair
 * @param {object} tacState      — from computeTacticalMomentum() for the pair
 * @param {object} macroSignal   — from useMacroSignal()
 * @param {object} sentimentData — { vix: number, fg: number }
 * @returns {MarketStateResult}
 */
export function computeMarketState(biasEntry, tacState, macroSignal, sentimentData) {
  // Graceful empty state when no COT data is loaded
  if (!biasEntry) {
    return {
      marketState:      MARKET_STATES.NEUTRAL,
      structureBias:    'UNKNOWN',
      institutionalBias:'NEUTRAL',
      alignmentScore:   0,
      timingState:      'NEUTRAL',
      executionContext: 'Sin datos COT cargados — sube un archivo CFTC para activar el contexto estructural.',
      volatilityState:  'NORMAL',
      crowdingRisk:     'LOW',
      ...STATE_META.NEUTRAL,
      timingLabel:      TIMING_LABELS.NEUTRAL,
      crowdingMeta:     CROWDING_META.LOW,
      volatilityLabel:  VOLATILITY_LABELS.NORMAL,
      isEmpty:          true,
    };
  }

  // ── Derive each layer ──────────────────────────────────────────────────────
  const structureBias    = deriveStructureBias(tacState);
  const instBias         = deriveInstitutionalBias(biasEntry);
  const volatilityState  = deriveVolatilityState(sentimentData, tacState);
  const crowdingRisk     = deriveCrowdingRisk(biasEntry);
  const timingState      = deriveTimingState(biasEntry, tacState, instBias, structureBias, crowdingRisk);
  const alignmentScore   = computeAlignmentScore(biasEntry, instBias, structureBias, macroSignal, crowdingRisk, volatilityState);
  const marketState      = classifyMarketState(instBias, structureBias, alignmentScore, timingState, crowdingRisk);
  const executionContext = deriveExecutionContext(marketState, timingState, instBias, structureBias);

  const meta = STATE_META[marketState];

  return {
    // Core classification
    marketState,
    structureBias,
    institutionalBias: instBias,
    alignmentScore,
    timingState,
    executionContext,
    volatilityState,
    crowdingRisk,

    // UI helpers
    ...meta,
    timingLabel:    TIMING_LABELS[timingState]  ?? timingState,
    crowdingMeta:   CROWDING_META[crowdingRisk] ?? CROWDING_META.LOW,
    volatilityLabel: VOLATILITY_LABELS[volatilityState] ?? volatilityState,
    isEmpty:        false,
  };
}
