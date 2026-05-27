/**
 * signalPriorityEngine.js — Institutional Signal Priority Engine v1.0
 *
 * Ranks ALL available signals by institutional importance.
 * Suppresses noise, surfaces only what matters RIGHT NOW.
 *
 * Priority tiers:
 *   P1 — CRITICAL     (immediate action / risk required)
 *   P2 — HIGH         (significant institutional signal)
 *   P3 — MODERATE     (context-building signal)
 *   P4 — LOW          (background information)
 *
 * Output: ranked signal list + market briefing summary (≤ 5 sentences).
 * All computation pure — no API calls, no side effects.
 */

// ─── SIGNAL BUILDERS ─────────────────────────────────────────────────────────

function buildVetoSignal(agentConsensus) {
  if (!agentConsensus?.risk?.veto) return null;
  return {
    id:       'veto',
    priority: 'P1',
    category: 'RISK MANAGER',
    title:    'Risk Manager Veto Active',
    detail:   agentConsensus.risk.vetoReason || 'Multiple concurrent risk factors — stand aside.',
    color:    '#ef4444',
    action:   'STAND ASIDE',
  };
}

function buildLiquidityStressSignal(agentConsensus) {
  if (!agentConsensus?.agents?.liquidity) return null;
  const liq = agentConsensus.agents.liquidity;
  if (liq.score >= 25) return null;
  return {
    id:       'liquidity_stress',
    priority: 'P1',
    category: 'LIQUIDITY',
    title:    `Liquidity Stress — ${liq.condition}`,
    detail:   `Market depth severely impaired. Forced de-risking risk. Regime: ${liq.regimeLabel || liq.regime}`,
    color:    '#dc2626',
    action:   'REDUCE EXPOSURE',
  };
}

function buildRegimeTransitionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.transition?.isPending) return null;
  const { transitionRisk, signals } = adaptiveRegime.transition;
  if (transitionRisk === 'low') return null;
  return {
    id:       'regime_transition',
    priority: transitionRisk === 'high' ? 'P1' : 'P2',
    category: 'REGIME',
    title:    `Regime Transition Risk: ${transitionRisk.toUpperCase()}`,
    detail:   signals[0] || 'Regime change approaching — positioning coherence declining.',
    color:    '#f97316',
    action:   'MONITOR CLOSELY',
  };
}

function buildExhaustionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.exhaustion?.isExhausted) return null;
  const ex = adaptiveRegime.exhaustion;
  const pairs = ex.extremePairs.map(p => p.pair).slice(0, 3).join(', ');
  return {
    id:       'exhaustion',
    priority: ex.extremePairs.length >= 3 ? 'P1' : 'P2',
    category: 'COT EXTREMES',
    title:    `Positioning Exhaustion — ${ex.extremePairs.length} pair${ex.extremePairs.length > 1 ? 's' : ''}`,
    detail:   `Extreme historical positioning detected: ${pairs}. Mean reversion risk elevated.`,
    color:    '#f59e0b',
    action:   'AVOID MOMENTUM ENTRIES',
  };
}

function buildVixSignal(vix) {
  if (!vix) return null;
  if (vix <= 20) return null; // below threshold — not noteworthy
  const priority = vix > 30 ? 'P1' : vix > 25 ? 'P2' : 'P3';
  const label    = vix > 30 ? 'Extreme Fear' : vix > 25 ? 'Elevated Fear' : 'Cautious';
  return {
    id:       'vix_elevated',
    priority,
    category: 'VOLATILITY',
    title:    `VIX ${vix.toFixed(1)} — ${label}`,
    detail:   vix > 30
      ? 'Extreme fear regime. Institutional risk management dominating price action. Avoid directional bias.'
      : 'Elevated volatility — reduce position sizing, widen stops, avoid breakout entries.',
    color:    vix > 30 ? '#dc2626' : '#f59e0b',
    action:   vix > 30 ? 'CAPITAL PRESERVATION' : 'REDUCE SIZE',
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
      category: 'INTERMARKET',
      title:    `${s.description} Correlation Breakdown`,
      detail:   s.insight,
      color:    '#ef4444',
      action:   'INVESTIGATE',
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
      category: 'INTERMARKET',
      title:    `${s.description} Diverging`,
      detail:   s.insight,
      color:    '#f59e0b',
      action:   'MONITOR',
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
    category: 'COT SIGNAL',
    title:    `${b.pair}: ${b.score > 0 ? 'Strong Long' : 'Strong Short'} Positioning`,
    detail:   `Institutional bias score: ${b.score > 0 ? '+' : ''}${b.score?.toFixed(1)}/5. State: ${b.state}. Confluence: ${b.confluence?.score ?? 'N/A'}.`,
    color:    b.score > 0 ? '#22c55e' : '#ef4444',
    action:   b.score > 0 ? 'LONG BIAS' : 'SHORT BIAS',
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
    title:    `USD Macro Bias: ${macroSignal.bias.replace(/_/g, ' ')}`,
    detail:   macroSignal.implication || `Yield spread analysis indicates ${macroSignal.bias.replace(/_/g, ' ')} USD environment.`,
    color:    isBullUSD ? '#ef4444' : '#22c55e', // USD strong = risk-off color; USD weak = risk-on color
    action:   isBullUSD ? 'WATCH USD PAIRS' : 'RISK ASSETS TAILWIND',
  };
}

function buildRegimeSignal(adaptiveRegime) {
  if (!adaptiveRegime?.regime) return null;
  const meta = adaptiveRegime.meta;
  return {
    id:       'regime_current',
    priority: meta?.intensity === 'extreme' ? 'P2' : 'P3',
    category: 'REGIME',
    title:    `Current Regime: ${meta?.label || adaptiveRegime.regime}`,
    detail:   meta?.desc || '',
    color:    meta?.color || '#8491a8',
    action:   meta?.actionBias?.replace(/_/g, ' ') || 'ASSESS',
  };
}

function buildConvictionSignal(adaptiveRegime) {
  if (!adaptiveRegime?.conviction) return null;
  const { level, score } = adaptiveRegime.conviction;
  if (level !== 'high') return null;
  return {
    id:       'high_conviction',
    priority: 'P3',
    category: 'CONVICTION',
    title:    `High Conviction Regime Signal (${score}/10)`,
    detail:   `Multiple independent signal sources align with the ${adaptiveRegime.meta?.label || adaptiveRegime.regime} regime. Institutional positioning consistent with thesis.`,
    color:    adaptiveRegime.meta?.color || '#22c55e',
    action:   'FULL POSITION SIZE PERMITTED',
  };
}

// ─── PRIORITY SORTING ─────────────────────────────────────────────────────────

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2, P4: 3 };

function sortByPriority(signals) {
  return [...signals].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

// ─── MARKET BRIEFING GENERATOR ───────────────────────────────────────────────

function generateMarketBriefing({ adaptiveRegime, agentConsensus, macroSignal, biasArr, intermarket }) {
  const lines = [];

  // 1. Regime headline
  if (adaptiveRegime?.meta) {
    const { meta, conviction, momentum } = adaptiveRegime;
    lines.push(
      `Market regime is ${meta.label} with ${conviction.level} conviction (${conviction.score}/10) ` +
      `and ${momentum.direction} institutional positioning momentum.`
    );
  }

  // 2. Agent consensus
  if (agentConsensus?.consensus) {
    const { score, label, direction } = agentConsensus.consensus;
    const riskLevel = agentConsensus.risk.level;
    lines.push(
      `The 6-agent institutional consensus scores ${score}/100 — ${label} environment ` +
      `with ${riskLevel.toLowerCase()} risk. Directional bias: ${direction}.`
    );
  }

  // 3. Key COT signal
  const topCot = biasArr?.filter(b => Math.abs(b?.score || 0) >= 2.5).sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
  if (topCot) {
    lines.push(
      `Strongest institutional COT signal: ${topCot.pair} at ${topCot.score > 0 ? '+' : ''}${topCot.score?.toFixed(1)} ` +
      `(${topCot.state} state). ${topCot.score > 0 ? 'Net long accumulation.' : 'Net short pressure.'}`
    );
  }

  // 4. Macro
  if (macroSignal?.bias && macroSignal.bias !== 'NEUTRAL') {
    lines.push(`Macro: ${macroSignal.implication?.slice(0, 150) || `USD bias: ${macroSignal.bias.replace(/_/g, ' ')}.`}`);
  }

  // 5. Key risk or intermarket divergence
  if (agentConsensus?.risk?.veto) {
    lines.push(`⚠ RISK MANAGER VETO: ${agentConsensus.risk.vetoReason}`);
  } else if (intermarket?.keyDivergences?.length) {
    lines.push(`Intermarket watch: ${intermarket.keyDivergences[0]?.slice(0, 160)}`);
  }

  return lines.slice(0, 5);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * computeSignalPriority — main entry point.
 *
 * @param {{
 *   agentConsensus:  Object
 *   adaptiveRegime:  Object
 *   intermarket:     Object
 *   biasArr:         Array
 *   macroSignal:     Object|null
 *   sharedLiveVix:   number|null
 * }}
 *
 * @returns {{
 *   signals:       Array    — ranked priority signals
 *   briefing:      string[] — 3-5 sentence market briefing
 *   hasData:       boolean
 *   criticalCount: number   — count of P1 (critical) signals
 * }}
 */
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
