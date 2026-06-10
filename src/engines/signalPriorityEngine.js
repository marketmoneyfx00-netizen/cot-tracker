/**
 * signalPriorityEngine.js — Motor de Prioridad de Señales Institucionales v1.0
 *
 * Clasifica TODAS las señales disponibles por importancia institucional.
 * Suprime el ruido, solo muestra lo que importa AHORA MISMO.
 *
 * Niveles de prioridad:
 *   P1 — CRÍTICO     (acción inmediata / riesgo requerido)
 *   P2 — ALTO        (señal institucional significativa)
 *   P3 — MODERADO    (señal de construcción de contexto)
 *   P4 — BAJO        (información de fondo)
 *
 * Salida: lista de señales clasificadas + resumen del mercado (≤ 5 frases).
 * Todo el cómputo es puro — sin llamadas a API, sin efectos secundarios.
 */

// ─── CONSTRUCTORES DE SEÑALES ─────────────────────────────────────────────────

function buildVetoSignal(agentConsensus) {
  if (!agentConsensus?.risk?.veto) return null;
  return {
    id:       'veto',
    priority: 'P1',
    category: 'GESTOR DE RIESGO',
    title:    'Veto del Gestor de Riesgo Activo',
    detail:   agentConsensus.risk.vetoReason || 'Múltiples factores de riesgo concurrentes — mantenerse al margen.',
    color:    '#ef4444',
    action:   'MANTENERSE AL MARGEN',
  };
}

function buildLiquidityStressSignal(agentConsensus) {
  if (!agentConsensus?.agents?.liquidity) return null;
  const liq = agentConsensus.agents.liquidity;
  if (liq.score >= 25) return null;
  return {
    id:       'liquidity_stress',
    priority: 'P1',
    category: 'LIQUIDEZ',
    title:    `Estrés de Liquidez — ${liq.condition}`,
    detail:   `Profundidad de mercado gravemente deteriorada. Riesgo de venta forzosa. Régimen: ${liq.regimeLabel || liq.regime}`,
    color:    '#dc2626',
    action:   'REDUCIR EXPOSICIÓN',
  };
}

function buildRegimeTransitionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.transition?.isPending) return null;
  const { transitionRisk, signals } = adaptiveRegime.transition;
  if (transitionRisk === 'low') return null;
  return {
    id:       'regime_transition',
    priority: transitionRisk === 'high' ? 'P1' : 'P2',
    category: 'RÉGIMEN',
    title:    `Riesgo de Transición de Régimen: ${transitionRisk === 'high' ? 'ALTO' : 'MEDIO'}`,
    detail:   signals[0] || 'Cambio de régimen inminente — coherencia de posicionamiento en declive.',
    color:    '#f97316',
    action:   'VIGILAR DE CERCA',
  };
}

function buildExhaustionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.exhaustion?.isExhausted) return null;
  const ex = adaptiveRegime.exhaustion;
  const pairs = ex.extremePairs.map(p => p.pair).slice(0, 3).join(', ');
  return {
    id:       'exhaustion',
    priority: ex.extremePairs.length >= 3 ? 'P1' : 'P2',
    category: 'EXTREMOS COT',
    title:    `Agotamiento de Posicionamiento — ${ex.extremePairs.length} par${ex.extremePairs.length > 1 ? 'es' : ''}`,
    detail:   `Posicionamiento histórico extremo detectado: ${pairs}. Riesgo de reversión a la media elevado.`,
    color:    '#f59e0b',
    action:   'EVITAR ENTRADAS EN MOMENTUM',
  };
}

function buildVixSignal(vix) {
  if (!vix) return null;
  if (vix <= 20) return null;
  const priority = vix > 30 ? 'P1' : vix > 25 ? 'P2' : 'P3';
  const label    = vix > 30 ? 'Miedo Extremo' : vix > 25 ? 'Miedo Elevado' : 'Cautela';
  return {
    id:       'vix_elevated',
    priority,
    category: 'VOLATILIDAD',
    title:    `VIX ${vix.toFixed(1)} — ${label}`,
    detail:   vix > 30
      ? 'Régimen de miedo extremo. Gestión de riesgo institucional dominando la acción del precio. Evitar sesgo direccional.'
      : 'Volatilidad elevada — reducir tamaño de posición, ampliar stops, evitar entradas en ruptura.',
    color:    vix > 30 ? '#dc2626' : '#f59e0b',
    action:   vix > 30 ? 'PRESERVAR CAPITAL' : 'REDUCIR TAMAÑO',
  };
}

function buildIntermarketBreakdownSignals(intermarket) {
  if (!intermarket?.signals) return [];
  return intermarket.signals
    .filter(s => s.status === 'BREAKDOWN')
    .slice(0, 2)
    .map(s => ({
      id:       `im_breakdown_${s.id}`,
      priority: 'P2',
      category: 'INTERMERCADO',
      title:    `${s.description} — Ruptura de Correlación`,
      detail:   s.insight,
      color:    '#ef4444',
      action:   'INVESTIGAR',
    }));
}

function buildIntermarketDivergenceSignals(intermarket) {
  if (!intermarket?.signals) return [];
  return intermarket.signals
    .filter(s => s.status === 'DIVERGING')
    .slice(0, 2)
    .map(s => ({
      id:       `im_diverging_${s.id}`,
      priority: 'P3',
      category: 'INTERMERCADO',
      title:    `${s.description} — Divergiendo`,
      detail:   s.insight,
      color:    '#f59e0b',
      action:   'VIGILAR',
    }));
}

function buildStrongCotSignals(biasArr) {
  if (!biasArr?.length) return [];
  const strong = biasArr
    .filter(b => b && Math.abs(b.score) >= 3)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);

  return strong.map(b => ({
    id:       `cot_strong_${b.pair}`,
    priority: Math.abs(b.score) >= 4 ? 'P2' : 'P3',
    category: 'SEÑAL COT',
    title:    `${b.pair}: Posicionamiento ${b.score > 0 ? 'Largo Fuerte' : 'Corto Fuerte'}`,
    detail:   `Puntuación de sesgo institucional: ${b.score > 0 ? '+' : ''}${b.score?.toFixed(1)}/5. Estado: ${b.state}. Confluencia: ${b.confluence?.score ?? 'N/D'}.`,
    color:    b.score > 0 ? '#22c55e' : '#ef4444',
    action:   b.score > 0 ? 'SESGO LARGO' : 'SESGO CORTO',
  }));
}

function buildMacroSignal(macroSignal, agentConsensus) {
  if (!macroSignal?.bias || macroSignal.bias === 'NEUTRAL') return null;
  const macro = agentConsensus?.agents?.macro;
  if (!macro || macro.confidence === 'low') return null;

  const isBullUSD = macroSignal.bias.includes('STRONG') || macroSignal.bias.includes('LEANING_STRONG');
  return {
    id:       'macro_usd',
    priority: macroSignal.confidence >= 7 ? 'P2' : 'P3',
    category: 'MACRO',
    title:    `Sesgo Macro USD: ${macroSignal.bias.replace(/_/g, ' ')}`,
    detail:   macroSignal.implication || `El análisis de spreads de rendimiento indica entorno USD ${macroSignal.bias.replace(/_/g, ' ')}.`,
    color:    isBullUSD ? '#ef4444' : '#22c55e',
    action:   isBullUSD ? 'VIGILAR PARES USD' : 'VIENTO DE COLA EN ACTIVOS DE RIESGO',
  };
}

function buildRegimeSignal(adaptiveRegime) {
  if (!adaptiveRegime?.regime) return null;
  const meta = adaptiveRegime.meta;
  return {
    id:       'regime_current',
    priority: meta?.intensity === 'extreme' ? 'P2' : 'P3',
    category: 'RÉGIMEN',
    title:    `Régimen Actual: ${meta?.label || adaptiveRegime.regime}`,
    detail:   meta?.desc || '',
    color:    meta?.color || '#8491a8',
    action:   meta?.actionBias?.replace(/_/g, ' ') || 'EVALUAR',
  };
}

function buildConvictionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.conviction) return null;
  const { level, score } = adaptiveRegime.conviction;
  if (level !== 'high') return null;
  return {
    id:       'high_conviction',
    priority: 'P3',
    category: 'CONVICCIÓN',
    title:    `Señal de Régimen de Alta Convicción (${score}/10)`,
    detail:   `Múltiples fuentes de señal independientes se alinean con el régimen ${adaptiveRegime.meta?.label || adaptiveRegime.regime}. Posicionamiento institucional coherente con la tesis.`,
    color:    adaptiveRegime.meta?.color || '#22c55e',
    action:   'TAMAÑO COMPLETO DE POSICIÓN PERMITIDO',
  };
}

// ─── ORDENACIÓN POR PRIORIDAD ─────────────────────────────────────────────────

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2, P4: 3 };

function sortByPriority(signals) {
  return [...signals].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

// ─── GENERADOR DE RESUMEN DEL MERCADO ─────────────────────────────────────────

function generateMarketBriefing({ adaptiveRegime, agentConsensus, macroSignal, biasArr, intermarket }) {
  const lines = [];

  if (adaptiveRegime?.meta) {
    const { meta, conviction, momentum } = adaptiveRegime;
    const momDir = momentum.direction === 'accelerating' ? 'acelerando' : momentum.direction === 'decelerating' ? 'desacelerando' : 'estable';
    const convLvl = conviction.level === 'high' ? 'alta' : conviction.level === 'medium' ? 'media' : 'baja';
    lines.push(
      `El régimen de mercado es ${meta.label} con convicción ${convLvl} (${conviction.score}/10) ` +
      `y momentum de posicionamiento institucional ${momDir}.`
    );
  }

  if (agentConsensus?.consensus) {
    const { score, label, direction } = agentConsensus.consensus;
    const riskLevel = agentConsensus.risk.level;
    const riskEs = riskLevel === 'LOW' ? 'bajo' : riskLevel === 'MODERATE' ? 'moderado' : riskLevel === 'HIGH' ? 'alto' : 'crítico';
    lines.push(
      `El consenso institucional de 6 agentes puntúa ${score}/100 — entorno ${label} ` +
      `con riesgo ${riskEs}. Sesgo direccional: ${direction}.`
    );
  }

  const topCot = biasArr?.filter(b => Math.abs(b?.score || 0) >= 2.5).sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
  if (topCot) {
    lines.push(
      `Señal COT institucional más fuerte: ${topCot.pair} en ${topCot.score > 0 ? '+' : ''}${topCot.score?.toFixed(1)} ` +
      `(estado ${topCot.state}). ${topCot.score > 0 ? 'Acumulación neta larga.' : 'Presión neta corta.'}`
    );
  }

  if (macroSignal?.bias && macroSignal.bias !== 'NEUTRAL') {
    lines.push(`Macro: ${macroSignal.implication?.slice(0, 150) || `Sesgo USD: ${macroSignal.bias.replace(/_/g, ' ')}.`}`);
  }

  if (agentConsensus?.risk?.veto) {
    lines.push(`⚠ VETO DEL GESTOR DE RIESGO: ${agentConsensus.risk.vetoReason}`);
  } else if (intermarket?.keyDivergences?.length) {
    lines.push(`Vigilancia intermercado: ${intermarket.keyDivergences[0]?.slice(0, 160)}`);
  }

  return lines.slice(0, 5);
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

export function computeSignalPriority({
  agentConsensus  = null,
  adaptiveRegime  = null,
  intermarket     = null,
  biasArr         = [],
  macroSignal     = null,
  sharedLiveVix   = null,
} = {}) {
  const rawSignals = [
    buildVetoSignal(agentConsensus),
    buildLiquidityStressSignal(agentConsensus),
    buildRegimeTransitionSignal(adaptiveRegime),
    buildExhaustionSignal(adaptiveRegime),
    buildVixSignal(sharedLiveVix),
    ...buildIntermarketBreakdownSignals(intermarket),
    ...buildStrongCotSignals(biasArr),
    buildMacroSignal(macroSignal, agentConsensus),
    buildRegimeSignal(adaptiveRegime),
    buildConvictionSignal(adaptiveRegime),
    ...buildIntermarketDivergenceSignals(intermarket),
  ].filter(Boolean);

  const signals = sortByPriority(rawSignals);

  const briefing = generateMarketBriefing({
    adaptiveRegime, agentConsensus, macroSignal, biasArr, intermarket,
  });

  return {
    signals,
    briefing,
    hasData: signals.length > 0,
    criticalCount: signals.filter(s => s.priority === 'P1').length,
  };
}
