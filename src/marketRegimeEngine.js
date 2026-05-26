import { polymarketService } from './polymarket/index.js';

/**
 * marketRegimeEngine.js — Market Regime Detection Layer
 *
 * Synthesizes cross-pair tactical states, institutional bias, and macro context
 * into a coherent market regime classification.
 *
 * Principle: the same pullback means different things in Risk-On vs Risk-Off.
 * Regime context helps the user interpret the institutional bias correctly.
 *
 * Regime is NOT a trading signal. It is interpretive context.
 */

// ── Polymarket forward-looking context reader (Phase 2) ───────────────────────
// Reads MSC, RRC, GTRP, PUI from polymarketService synchronously.
// Returns null if service is not ready — enables graceful degradation.
function _getPolymarketCtx() {
  try {
    if (!polymarketService.isReady()) return null;
    const m = polymarketService.getMetrics();
    if (!m) return null;
    return {
      mscValue:   m.msc?.value  ?? null,
      rrcRegime:  m.rrc?.regime ?? null,
      rrcValue:   m.rrc?.value  ?? null,
      gtrpValue:  m.gtrp?.value ?? null,
      puiValue:   m.pui?.value  ?? null,
    };
  } catch {
    return null;
  }
}

export const REGIME_CONFIG = {
  risk_on: {
    label:       'Risk-On Environment',
    description: 'Capital flows favoring risk assets. Broad-based bullish pressure across correlated pairs.',
    color:  '#22c55e',
    bg:     'rgba(34,197,94,0.07)',
    border: 'rgba(34,197,94,0.18)',
  },
  risk_off: {
    label:       'Risk-Off Conditions',
    description: 'Risk aversion active. Safe-haven flows dominating. USD and JPY demand elevated.',
    color:  '#ef4444',
    bg:     'rgba(239,68,68,0.07)',
    border: 'rgba(239,68,68,0.18)',
  },
  trending: {
    label:       'Trending Environment',
    description: 'Directional momentum present across correlated pairs. Structural continuation context active.',
    color:  '#3b82f6',
    bg:     'rgba(59,130,246,0.07)',
    border: 'rgba(59,130,246,0.18)',
  },
  mean_reverting: {
    label:       'Mean-Reverting Conditions',
    description: 'Extended moves compressing. Range-bound behavior increasing. Structural trends moderating.',
    color:  '#8b5cf6',
    bg:     'rgba(139,92,246,0.07)',
    border: 'rgba(139,92,246,0.18)',
  },
  high_volatility: {
    label:       'Elevated Volatility',
    description: 'Volatility expansion active across pairs. Price action accelerating. Wider context uncertainty.',
    color:  '#f97316',
    bg:     'rgba(249,115,22,0.07)',
    border: 'rgba(249,115,22,0.18)',
  },
  macro_uncertainty: {
    label:       'Macro Uncertainty',
    description: 'Mixed directional signals across pairs. Institutional positioning diverging. Await clarity.',
    color:  '#f59e0b',
    bg:     'rgba(245,158,11,0.07)',
    border: 'rgba(245,158,11,0.18)',
  },
  compression: {
    label:       'Market Compression',
    description: 'Low conviction across correlated assets. Await institutional catalyst for directional clarity.',
    color:  '#6b7280',
    bg:     'rgba(107,114,128,0.07)',
    border: 'rgba(107,114,128,0.18)',
  },
  macro_expansion: {
    label:       'Macro Expansion',
    description: 'Broad-based institutional flow active. Structural directional context elevated across majors.',
    color:  '#06b6d4',
    bg:     'rgba(6,182,212,0.07)',
    border: 'rgba(6,182,212,0.18)',
  },
};

/**
 * Derive market regime from cross-pair tactical state consensus,
 * institutional bias array, and optional macro signal.
 *
 * @param {Object} tacStateMap   — { 'EUR/USD': TacticalState, ... }
 * @param {Array}  biasArr       — [{ pair, score, state }, ...]
 * @param {Object} macroSignal   — { bias: string, confidence: number } from /api/macro
 * @returns {object}             — regime object with label, description, color, confidence
 */
export function computeMarketRegime(tacStateMap, biasArr, macroSignal) {
  const tacValues = Object.values(tacStateMap ?? {}).filter(Boolean);
  const n         = tacValues.length || 1;

  const bullish     = tacValues.filter(t => t.pressure === 'bullish').length;
  const bearish     = tacValues.filter(t => t.pressure === 'bearish').length;
  const breakdowns  = tacValues.filter(t => t.marketState === 'tactical_breakdown').length;
  const compressions= tacValues.filter(t => t.marketState === 'compression').length;
  const fast        = tacValues.filter(t => t.velocity === 'fast').length;
  const expansions  = tacValues.filter(t => t.marketState === 'expansion').length;

  const macroUSD  = macroSignal?.bias;
  const macroConf = macroSignal?.confidence ?? 0;

  let regime     = 'macro_uncertainty';
  let confidence = 40;

  // Risk-Off: aggressive breakdowns or broad bearish fast momentum
  if (breakdowns >= 2 || (bearish >= Math.ceil(n * 0.6) && fast >= 2)) {
    regime     = 'risk_off';
    confidence = Math.min(90, 55 + breakdowns * 10 + fast * 5);
  }
  // Risk-On: expansions or broad bullish fast momentum
  else if (expansions >= 2 || (bullish >= Math.ceil(n * 0.6) && fast >= 2)) {
    regime     = 'risk_on';
    confidence = Math.min(88, 50 + expansions * 10 + fast * 5);
  }
  // High volatility: many fast-moving pairs, mixed direction
  else if (fast >= Math.ceil(n * 0.5) && (bullish + bearish) >= Math.ceil(n * 0.6)) {
    regime     = 'high_volatility';
    confidence = Math.min(80, 55 + fast * 8);
  }
  // Market compression: majority of pairs compressed
  else if (compressions >= Math.ceil(n * 0.6)) {
    regime     = 'compression';
    confidence = Math.min(75, 50 + compressions * 5);
  }
  // Strong macro USD directional signal → trending
  else if ((macroUSD === 'USD_STRONG' || macroUSD === 'USD_WEAK') && macroConf >= 6) {
    regime     = 'trending';
    confidence = Math.min(80, 45 + macroConf * 5);
  }
  // Bimodal tactical (bull + bear simultaneously) → mean reverting
  else if (bullish >= 2 && bearish >= 2) {
    regime     = 'mean_reverting';
    confidence = 50;
  }
  // Broad institutional strength → macro expansion
  else if (biasArr?.length) {
    const strongBias = biasArr.filter(b => Math.abs(b.score) >= 2.5).length;
    if (strongBias >= 2) {
      regime     = 'macro_expansion';
      confidence = Math.min(78, 50 + strongBias * 8);
    }
  }

  // ── Phase 2: Polymarket forward-looking adjustments (conservative, graceful) ──
  const polyCtx = _getPolymarketCtx();
  if (polyCtx) {
    const { mscValue, rrcRegime, gtrpValue, puiValue } = polyCtx;
    const highStress     = typeof mscValue  === 'number' && mscValue  >= 65;
    const recessionary   = rrcRegime === 'HIGH_RISK' || rrcRegime === 'SEVERE';
    const highGeo        = typeof gtrpValue === 'number' && gtrpValue >= 0.65;
    const highUncertain  = typeof puiValue  === 'number' && puiValue  >= 75;

    // Elevate to risk_off when Polymarket signals building stress that the
    // tactical state map hasn't yet reflected (breakdowns not yet manifested).
    if ((regime === 'macro_uncertainty' || regime === 'compression') && highStress && recessionary) {
      regime     = 'risk_off';
      confidence = Math.min(72, confidence + 18);
    }

    // Geopolitical tail-risk can sustain risk_off even when tactical states are mixed.
    if (regime === 'macro_uncertainty' && highGeo) {
      regime     = 'risk_off';
      confidence = Math.min(68, confidence + 12);
    }

    // Attenuate confidence in trending/expansion regimes when crowd uncertainty is extreme.
    // High PUI = prediction markets are split on policy path → trending label is premature.
    if ((regime === 'trending' || regime === 'macro_expansion') && highUncertain) {
      confidence = Math.max(30, confidence - 18);
    }

    // Confirm existing regime when Polymarket stress direction aligns (boost confidence only).
    if (highStress && (regime === 'risk_off' || regime === 'high_volatility')) {
      confidence = Math.min(90, confidence + 8);
    }
  }

  const cfg = REGIME_CONFIG[regime] ?? REGIME_CONFIG.macro_uncertainty;
  return { regime, ...cfg, confidence };
}
