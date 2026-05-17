/**
 * pairDecisionEngine.js — Unified Per-Pair Decision Engine
 *
 * Single source of truth: given a pair + all data sources → one verdict.
 *
 * Decision hierarchy (cannot change):
 *   1. tradeReadinessScore < 50  → AVOID (macro block)
 *   2. intradayScore < 60        → AVOID (intraday block)
 *   3. intradayScore < 70        → PREPARE (caution)
 *   4. cotBias + marketState     → EXECUTE / PREPARE
 *
 * Returns a `PairContext` object consumed by ALL UI components.
 * No state, no side effects — pure function.
 */

import { calculateBiasScore, deriveInputsFromPair, computeZScoreExtremes, detectCOTDivergence } from '../cotBiasEngine.js';
import { calculateExecutionScore }                  from '../intradayExecutionEngine.js';
import { detectTradingOpportunityWithVerdict }      from '../utils/alertEngine.js';
import { computeConfluenceScore }                   from '../confluenceEngine.js';

// ─── FINAL DECISION ───────────────────────────────────────────────────────────
// Single source of truth for execution permission.
// All UI modules MUST use this to determine whether to show actionable signals.
// Hierarchy is fixed: macro > intraday > COT bias.
export function buildFinalDecision({ tradeReadinessScore, intradayScore }) {
  const trs = typeof tradeReadinessScore === 'number' ? tradeReadinessScore : 100;
  const its = typeof intradayScore       === 'number' ? intradayScore       : 100;

  if (trs < 50) {
    return {
      verdict:        'AVOID',
      reason:         'macro',
      blockSource:    'TradeReadiness',
      allowExecution: false,
      isMacroBlocked: true,
      isIntradayBlocked: false,
      message:        'Macro risk elevated — execution restricted',
      sub:            `Trade Readiness: ${trs}/100`,
    };
  }
  if (its < 60) {
    return {
      verdict:        'AVOID',
      reason:         'intraday',
      blockSource:    'IntradayExecution',
      allowExecution: false,
      isMacroBlocked: false,
      isIntradayBlocked: true,
      message:        'Execution conditions below threshold — await improvement',
      sub:            `Intraday Score: ${its}/100`,
    };
  }
  if (its < 70) {
    return {
      verdict:        'PREPARE',
      reason:         'caution',
      blockSource:    null,
      allowExecution: false,
      isMacroBlocked: false,
      isIntradayBlocked: false,
      message:        'Preparation phase — execution conditions improving',
      sub:            `Intraday Score: ${its}/100`,
    };
  }
  return {
    verdict:        'EXECUTE',
    reason:         null,
    blockSource:    null,
    allowExecution: true,
    isMacroBlocked: false,
    isIntradayBlocked: false,
    message:        'Execution conditions favorable',
    sub:            `Intraday Score: ${its}/100`,
  };
}

// ─── MARKET STATE ─────────────────────────────────────────────────────────────
// Derives per-pair market state from COT bias score + position delta.
export function derivePairMarketState(pairRow) {
  if (!pairRow) return 'compression';
  const inputs = deriveInputsFromPair(pairRow);
  if (!inputs) return 'compression';
  const bias   = calculateBiasScore(inputs);
  if (!bias)   return 'compression';

  const latest = pairRow.weeks?.[0];
  const prev   = pairRow.weeks?.[1];
  const delta  = latest && prev ? latest.smartNet - prev.smartNet : 0;
  const pctL   = latest?.smartPctL ?? 50;
  const av     = Math.abs(delta);
  const ab     = Math.abs(bias.score);

  if ((pctL > 75 || pctL < 25) && av > 15000 && delta * bias.score < 0) return 'distribution';
  if (ab >= 2 && av > 10000)   return 'expansion';
  if (ab >= 1.5 || av >= 3000) return 'building';
  return 'compression';
}

// ─── GLOBAL MARKET STATE ──────────────────────────────────────────────────────
// Derived from all fxPairs — used for AlertBanner context text.
export function deriveGlobalMarketState(biasArr) {
  const tot = biasArr.length || 1;
  const ex  = biasArr.filter(r => r.state === 'expansion').length;
  const di  = biasArr.filter(r => r.state === 'distribution').length;
  const co  = biasArr.filter(r => r.state === 'compression').length;
  if (di >= 2)         return 'distribution';
  if (ex > tot / 2)    return 'expansion';
  if (co > tot / 2)    return 'compression';
  return 'mixed';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Normalize pair key: converts 'EUR/USD' ↔ 'EURUSD' for cross-module lookups.
// /api/rates uses no-slash format; COT Tracker uses slash format.
function normalizePairKey(str) {
  if (!str) return '';
  return str.replace('/', '').toUpperCase();
}

// Real price % change from 4H candle array (oldest→newest).
// Window size: determined by useAllPairCandles config (currently 30 × 4H ≈ 5 days).
// Named conservatively to reflect actual window, not an assumed timeframe.
function computeRealPriceChange(candles) {
  if (!Array.isArray(candles) || candles.length < 10) return null;
  const oldest = candles[0]?.close;
  const newest  = candles[candles.length - 1]?.close;
  if (!oldest || !newest || oldest <= 0) return null;
  return parseFloat(((newest - oldest) / oldest * 100).toFixed(4));
}

// Macro confidence multiplier for the V2 bias engine.
// Start at 1.0; apply a mild boost/penalty if macro and carry align/conflict.
// Handles both definitive (USD_STRONG) and leaning (USD_LEANING_STRONG) variants.
// Clamped [0.5, 1.0] so we never zero-out the institutional bias score.
function computePairMacroConfidence(pair, biasDirection, macroSignal, carryScore) {
  let conf = 1.0;

  if (macroSignal?.bias && typeof macroSignal.confidence === 'number' && macroSignal.confidence >= 5) {
    const usdIsBase  = (pair || '').startsWith('USD/');
    const usdBullish = macroSignal.bias === 'USD_STRONG' || macroSignal.bias === 'USD_LEANING_STRONG';
    const usdBearish = macroSignal.bias === 'USD_WEAK'   || macroSignal.bias === 'USD_LEANING_WEAK';
    const isLeaning  = macroSignal.bias.includes('LEANING');

    let expectedDir = null;
    if (usdBullish) expectedDir = usdIsBase ? 'bullish' : 'bearish';
    if (usdBearish) expectedDir = usdIsBase ? 'bearish' : 'bullish';

    if (expectedDir && biasDirection !== 'neutral') {
      const macroConf = macroSignal.confidence / 10;
      const weight    = isLeaning ? 0.6 : 1.0;
      if (expectedDir === biasDirection) {
        conf = Math.min(1.0, conf + macroConf * 0.1 * weight);
      } else {
        conf = Math.max(0.5, conf - macroConf * 0.15 * weight);
      }
    }
  }

  if (typeof carryScore === 'number' && !isNaN(carryScore) && biasDirection !== 'neutral') {
    const aligned = (biasDirection === 'bullish' && carryScore > 0) ||
                    (biasDirection === 'bearish' && carryScore < 0);
    if (aligned)               conf = Math.min(1.0, conf + 0.05);
    else if (carryScore !== 0) conf = Math.max(0.5, conf - 0.08);
  }

  return parseFloat(conf.toFixed(2));
}

// ─── BIAS ARRAY ───────────────────────────────────────────────────────────────
/**
 * Pre-compute per-pair bias + state for all fxPairs.
 *
 * @param {Array}  fxPairs   — from App.jsx pairsData
 * @param {Object} [opts]
 * @param {Object} [opts.candleMap]   — { 'EUR/USD': [{open,high,low,close},...] }
 * @param {Object} [opts.ratesData]   — from /api/rates: { pairs: [{pair, carry_score, ...}] }
 * @param {Object} [opts.macroSignal] — from /api/macro: { bias, confidence }
 */
export function buildBiasArray(fxPairs, { candleMap = {}, ratesData = null, macroSignal = null } = {}) {
  const pairsRates = ratesData?.pairs ?? [];

  return (fxPairs || []).map(p => {
    if (!p || p.pair.includes('Index')) return null;

    // Real price % change from candleMap (window = whatever useAllPairCandles provides)
    const realPriceChangePct = computeRealPriceChange(candleMap?.[p.pair]);

    const inp = deriveInputsFromPair(p, realPriceChangePct);
    if (!inp) return null;

    // Carry data: /api/rates uses no-slash format (EURUSD); normalize for lookup
    const pairKey    = normalizePairKey(p.pair);
    const pairRates  = pairsRates.find(r => normalizePairKey(r.pair) === pairKey) ?? null;
    const carryScore      = pairRates?.carry_score      ?? null;
    const stanceDivergence = pairRates?.stance_divergence ?? null;

    // macroConfidence: dampen/amplify V2 bias based on macro + carry alignment
    const biasDir = inp.leveragedWeeklyChange > 0 ? 'bullish'
      : inp.leveragedWeeklyChange < 0 ? 'bearish' : 'neutral';
    const macroConf = computePairMacroConfidence(p.pair, biasDir, macroSignal, carryScore);

    const bias = calculateBiasScore({ ...inp, macroConfidence: macroConf });
    if (!bias) return null;

    // Z-Score Extremes
    const weeklyNets = (p.weeks || []).map(w => w.smartNet).filter(n => typeof n === 'number');
    const currentNet = p.weeks?.[0]?.smartNet ?? 0;
    const zscoreData = computeZScoreExtremes(currentNet, weeklyNets);

    // COT Divergence — use real price change when available
    const week4Net       = p.weeks?.[3]?.smartNet ?? currentNet;
    const cotPriceChange = realPrice4W ?? (weeklyNets.length >= 4
      ? ((currentNet - week4Net) / (Math.abs(week4Net) || 1)) * 100
      : 0);
    const divergence = detectCOTDivergence({
      priceChangePct: cotPriceChange,
      cotNetChange:   inp.leveragedWeeklyChange,
      zscore:         zscoreData.zscore,
    });

    // Confluence Score — how many independent signals agree
    const confluence = computeConfluenceScore({
      biasScore:       bias.score,
      biasDirection:   bias.direction,
      carryScore,
      macroSignal,
      pair:            p.pair,
      stanceDivergence,
      zScore:          zscoreData.zscore,
    });

    return {
      pair:            p.pair,
      score:           bias.score,
      state:           derivePairMarketState(p),
      bias,
      zscore:          zscoreData,
      divergence,
      confluence,
      carryScore,
      macroConfidence: macroConf,
    };
  }).filter(Boolean);
}

// ─── CORE ENGINE ──────────────────────────────────────────────────────────────
/**
 * buildPairContext
 *
 * @param {string}  pair                  — e.g. 'EUR/USD'
 * @param {Array}   biasArr               — from buildBiasArray()
 * @param {object}  sentimentData         — { fg, vix, highCount, midCount }
 * @param {object}  riskData              — { score }
 * @param {number}  tradeReadinessScore   — 0-100, from TradeReadinessChecklist
 * @param {string}  globalMarketState     — from deriveGlobalMarketState()
 *
 * @returns {PairContext}
 */
export function buildPairContext({
  pair,
  biasArr,
  sentimentData,
  riskData,
  tradeReadinessScore = 100,
  globalMarketState = 'mixed',
}) {
  // 1. Find this pair's bias entry
  const pairBias = biasArr.find(r => r.pair === pair)
    || [...biasArr].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]
    || null;

  // 2. Intraday score for this pair (carry alignment factor included)
  const intradayResult = pairBias ? calculateExecutionScore({
    biasScore:     pairBias.score,
    biasDirection: pairBias.score > 0 ? 'bullish' : pairBias.score < 0 ? 'bearish' : 'neutral',
    riskScore:     riskData?.score ?? 0,
    fg:            sentimentData?.fg ?? 50,
    vix:           sentimentData?.vix ?? 18,
    highCount:     sentimentData?.highCount ?? 0,
    midCount:      sentimentData?.midCount ?? 0,
    carryScore:    pairBias.carryScore ?? null,
  }) : null;
  const intradayScore = intradayResult?.score ?? 100;

  // 3. Ideas for this pair only
  const allIdeas = biasArr
    .filter(r => Math.abs(r.score) >= 1.5 && r.state !== 'distribution')
    .map(r => ({
      pair:       r.pair,
      isLong:     r.score > 0,
      dir:        r.score > 0 ? 'buy' : 'sell',
      confidence: Math.abs(r.score) >= 3 ? 'HIGH' : Math.abs(r.score) >= 2 ? 'MEDIUM' : 'LOW',
    }));
  const pairIdeas = allIdeas.filter(i => i.pair === pair);

  // 4. Alert + verdict (fully pair-scoped)
  const alertData = detectTradingOpportunityWithVerdict({
    marketState:          { state: globalMarketState },
    ideas:                pairIdeas,
    intradayScore,
    tradeReadinessScore,
  });

  // 5. Verdict flags — derived directly from scores (single authority)
  const isMacroBlocked    = tradeReadinessScore < 50;
  const isIntradayBlocked = intradayScore < 60;
  const isBlocked         = isMacroBlocked || isIntradayBlocked || alertData?.verdict === 'AVOID';
  const isPreparing       = !isBlocked && (intradayScore < 70 || alertData?.verdict === 'PREPARE');
  const isTradable        = !isBlocked && !isPreparing && alertData?.verdict === 'EXECUTE';

  // 6. Intraday constraint for AlertBanner display
  let intradayConstraint = null;
  let intradayBlock      = false;
  if (alertData?.type === 'opportunity') {
    if (intradayScore < 60) {
      intradayBlock      = true;
      intradayConstraint = { level: 'block',   message: 'Execution restricted — intraday conditions unfavorable' };
    } else if (intradayScore < 70) {
      intradayConstraint = { level: 'warning', message: 'Execution conditions suboptimal — monitor for improvement' };
    }
  }

  // 7. alertKey — changes whenever verdict-relevant inputs change
  const alertKey = alertData
    ? `${alertData.type}-${alertData.strength}-${globalMarketState}-${pair}-${tradeReadinessScore}-${intradayScore}`
    : null;

  return {
    // Identity
    pair,

    // Scores
    intradayScore,
    tradeReadinessScore,
    intradayResult,

    // COT context
    cotBias:         pairBias?.bias ?? null,
    biasScore:       pairBias?.score ?? 0,
    pairMarketState: pairBias?.state ?? 'compression',
    globalMarketState,

    // Quantitative signals (TAREA 2.1 + 2.2)
    zscoreExtremes: pairBias?.zscore    ?? null,
    cotDivergence:  pairBias?.divergence ?? null,

    // Ideas
    pairIdeas,
    allIdeas,

    // Alert (with verdict embedded)
    alertData,
    alertKey,
    intradayConstraint,
    intradayBlock,

    // Decision flags (single source of truth for opacity/pointer-events)
    isBlocked,
    isPreparing,
    isTradable,
    isMacroBlocked,
    isIntradayBlocked,

    // Derived verdict string (shorthand)
    verdict: isBlocked ? 'AVOID' : isPreparing ? 'PREPARE' : 'EXECUTE',
  };
}
