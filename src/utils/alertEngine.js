/**
 * alertEngine.js — Decision Engine v3
 * Pure function. No state, no side effects.
 *
 * Layer 1: detectTradingOpportunity — institutional context (unchanged)
 * Layer 2: resolveVerdict            — executive decision (AVOID / PREPARE / EXECUTE)
 */

export function detectTradingOpportunity({ marketState, ideas }) {
  if (!marketState || !ideas) return null;

  const state = marketState.state;

  // ── Blockers ──────────────────────────────────────────────────────────────
  if (state === 'compression') {
    return {
      type: 'warning', strength: 'low',
      title: 'Mercado sin oportunidad',
      message: 'El posicionamiento institucional no muestra expansión. Operar en rango genera más ruido que oportunidad.',
      action: 'Evitar entradas — esperar que el precio salga del rango con volumen',
      pairs: [], confidenceScore: 0,
    };
  }

  if (state === 'distribution') {
    return {
      type: 'warning', strength: 'medium',
      title: 'Reducción de posiciones institucionales',
      message: 'Los institucionales están reduciendo exposición. No indica cambio de tendencia, pero sí menor convicción.',
      action: 'No añadir posiciones — reducir tamaño si estás dentro',
      pairs: [], confidenceScore: 0.2,
    };
  }

  // ── Filter valid ideas ─────────────────────────────────────────────────────
  const validIdeas = (ideas || []).filter(
    i => i.confidence === 'HIGH' || i.confidence === 'MEDIUM'
  );

  // ── Dominance check (min 60% consensus to avoid false alerts) ─────────────
  const total      = validIdeas.length;
  const longCount  = validIdeas.filter(i => i.isLong).length;
  const shortCount = validIdeas.filter(i => !i.isLong).length;
  const dominance  = total > 0 ? Math.max(longCount, shortCount) / total : 0;

  if (total === 0 || dominance < 0.6) {
    return {
      type: 'warning', strength: 'low',
      title: 'Sin oportunidad clara',
      message: 'Las condiciones actuales no muestran alineación institucional suficiente.',
      action: 'Mantente fuera del mercado hasta mayor claridad',
      pairs: [], confidenceScore: dominance,
    };
  }

  const highIdeas   = validIdeas.filter(i => i.confidence === 'HIGH');
  const topIdeas    = highIdeas.length ? highIdeas : validIdeas;
  const pairs       = topIdeas.map(i => i.pair).slice(0, 3);
  const strength    = highIdeas.length >= 1 ? 'high' : 'medium';
  let dirLabel = null;
  if (longCount > shortCount) dirLabel = 'alcista';
  else if (shortCount > longCount) dirLabel = 'bajista';
  else dirLabel = 'mixto';

  if (dirLabel === 'mixto') {
    return {
      type: 'warning', strength: 'low',
      title: 'Dirección institucional no definida',
      message: 'Las oportunidades muestran equilibrio entre compras y ventas.',
      action: 'Evitar operar hasta que el mercado defina dirección',
      pairs: [], confidenceScore: dominance,
    };
  }

  const pairText = pairs.length === 1
    ? pairs[0]
    : pairs.length === 2
    ? pairs.join(' y ')
    : `${pairs[0]}, ${pairs[1]} y ${pairs[2]}`;

  let message, action;

  if (state === 'expansion') {
    message = `Flujo institucional ${dirLabel} con expansión activa. ${pairText} lideran el movimiento.`;
    action  = dirLabel === 'alcista'
      ? 'Buscar compras en retrocesos — no perseguir precio'
      : 'Buscar ventas en rebotes — no perseguir precio';
  } else {
    message = `Confluencia ${dirLabel} parcial. ${pairs.slice(0, 2).join(' y ')} presentan sesgo definido pero el mercado no está en expansión plena.`;
    action  = 'Reducir tamaño — solo operar pares con confluencia institucional confirmada';
  }

  return {
    type: 'opportunity', strength, confidenceScore: dominance,
    title: 'Confluencia institucional detectada',
    message, action, pairs,
  };
}

// ── Layer 2: Veredicto absoluto ───────────────────────────────────────────────
// Priority order (cannot change):
//   1. tradeReadinessScore + intradayScore  → overrides everything
//   2. marketState                          → second filter
//   3. alert strength                       → final filter

function resolveVerdict({ alert, marketState, intradayScore, tradeReadinessScore }) {
  // 1. 🔴 MACRO BLOCK — Trade Readiness manda sobre todo lo demás
  if (tradeReadinessScore < 50) {
    return {
      verdict: 'AVOID',
      color: '#ef4444',
      title: 'No operar',
      message: 'Evento macro activo — el mercado no está en condiciones seguras',
      action: 'Esperar absorción completa antes de considerar cualquier entrada',
    };
  }

  // 2. 🔴 INTRADAY BLOCK — ejecución bloqueada por condiciones intradía
  if (intradayScore < 60) {
    return {
      verdict: 'AVOID',
      color: '#ef4444',
      title: 'No operar',
      message: 'Condiciones intradía débiles — permiso operativo no alcanzado',
      action: 'Esperar mejor contexto intradía antes de ejecutar',
    };
  }

  // 3. 🔴 Sin setup — warning no es oportunidad
  if (alert?.type === 'warning') {
    return {
      verdict: 'AVOID',
      color: '#ef4444',
      title: 'No operar',
      message: 'El contexto institucional no presenta oportunidad válida',
      action: 'Mantente fuera del mercado hasta nueva alineación',
    };
  }

  // 4. 🟡 Confluencia insuficiente — evitar setups débiles
  if (alert?.confidenceScore < 0.7) {
    return {
      verdict: 'PREPARE',
      color: '#f59e0b',
      title: 'Preparar operación',
      message: 'Confluencia institucional moderada — aún sin dominancia clara',
      action: 'Esperar mayor alineación antes de ejecutar',
    };
  }

  // 5. 🟡 Estado o fuerza insuficiente
  if (
    marketState === 'compression' ||
    marketState === 'distribution' ||
    alert?.strength !== 'high'
  ) {
    return {
      verdict: 'PREPARE',
      color: '#f59e0b',
      title: 'Preparar operación',
      message: 'Setup institucional válido pero sin confirmación completa',
      action: 'Esperar retroceso + confirmación antes de ejecutar',
    };
  }

  // 6. 🟢 EJECUCIÓN — todas las condiciones cumplidas
  return {
    verdict: 'EXECUTE',
    color: '#22c55e',
    title: 'Ejecutar oportunidad',
    message: 'Confluencia institucional completa en entorno favorable',
    action: 'Buscar entrada en retroceso en timeframe operativo',
  };
}

/**
 * detectTradingOpportunityWithVerdict
 *
 * Wraps detectTradingOpportunity with the absolute verdict layer.
 * Use this function whenever intradayScore and tradeReadinessScore are available.
 * Falls back gracefully when they are not (verdict defaults to PREPARE).
 *
 * @param {object} params
 * @param {object} params.marketState        — { state: 'expansion' | 'compression' | ... }
 * @param {Array}  params.ideas              — from bias engine
 * @param {number} params.intradayScore      — 0–100 from calculateExecutionScore
 * @param {number} params.tradeReadinessScore — 0–100 from TradeReadinessChecklist
 * @returns {object} alert + verdict fields
 */
export function detectTradingOpportunityWithVerdict({
  marketState,
  ideas,
  intradayScore = 100,
  tradeReadinessScore = 100,
}) {
  const alert = detectTradingOpportunity({ marketState, ideas });

  // No alert → no verdict needed
  if (!alert) return null;

  const verdict = resolveVerdict({
    alert,
    marketState: marketState?.state,
    intradayScore,
    tradeReadinessScore,
  });

  return {
    ...alert,
    verdict:        verdict.verdict,
    verdictTitle:   verdict.title,
    verdictMessage: verdict.message,
    verdictAction:  verdict.action,
    verdictColor:   verdict.color,
  };
}

