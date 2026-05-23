/**
 * convictionEngine.js — Institutional Decision Conviction Engine v1.0
 *
 * Converts multi-signal interpretation into a single conviction score (0-100)
 * with asset-class-specific weighting, alignment bonuses, and conflict penalties.
 *
 * Design:
 *   - Pure functions. No side effects. No state. No React.
 *   - Each factor scored 0-1. Weighted sum × 100 = raw conviction.
 *   - Alignment bonus for ≥5 confirming factors.
 *   - Conflict penalty for ≥3 opposing factors.
 *   - Asset-specific weight maps for FX / index / bonds / commodities.
 *   - Separate prioritization layer for cross-asset opportunity ranking.
 *
 * Input:  biasEntry (from cotBiasEngine), pairRow (from parseTiff), opts
 * Output: ConvictionProfile + PrioritizationMatrix
 */

// ── ASSET-SPECIFIC WEIGHT MAPS ────────────────────────────────────────────────
// Each category sums to 1.00. Adjust per asset class emphasis.

const ASSET_WEIGHTS = {
  fx: {
    bias_strength: 0.20,  // core COT signal
    divergence:    0.12,  // price vs positioning conflict
    zscore:        0.08,  // crowding / extreme positioning
    flow_persist:  0.12,  // report streak — institutional persistence
    macro_regime:  0.12,  // macro environment alignment
    carry_policy:  0.18,  // CB policy divergence + carry conviction
    cross_asset:   0.10,  // cross-asset confirmation
    execution:     0.08,  // intraday execution conditions
  },
  index: {
    bias_strength: 0.20,
    divergence:    0.15,
    zscore:        0.10,
    flow_persist:  0.15,
    macro_regime:  0.25,  // dominant driver for equities
    carry_policy:  0.05,  // liquidity / yield pressure proxy
    cross_asset:   0.05,
    execution:     0.05,
  },
  bonds: {
    bias_strength: 0.18,
    divergence:    0.12,
    zscore:        0.08,
    flow_persist:  0.15,
    macro_regime:  0.22,  // inflation / growth regime critical
    carry_policy:  0.15,  // FED cycle / duration demand
    cross_asset:   0.05,
    execution:     0.05,
  },
  commodities: {
    bias_strength: 0.20,
    divergence:    0.15,
    zscore:        0.10,
    flow_persist:  0.15,
    macro_regime:  0.18,  // growth + inflation regime
    carry_policy:  0.10,  // supply/inflation regime proxy
    cross_asset:   0.07,
    execution:     0.05,
  },
};

// ── MACRO REGIME ALIGNMENT MAP ────────────────────────────────────────────────
// [regime][cat][direction] → alignment score 0-1

const MACRO_ALIGNMENT = {
  RISK_ON: {
    fx:          { bullish: 0.60, bearish: 0.40 },  // varies by pair
    index:       { bullish: 0.90, bearish: 0.10 },  // strong equity bid
    bonds:       { bullish: 0.30, bearish: 0.65 },  // yield pressure
    commodities: { bullish: 0.70, bearish: 0.30 },  // demand-driven bid
  },
  RISK_OFF: {
    fx:          { bullish: 0.35, bearish: 0.75 },  // USD/JPY/CHF haven bid
    index:       { bullish: 0.10, bearish: 0.90 },  // equity de-risk
    bonds:       { bullish: 0.80, bearish: 0.20 },  // haven accumulation
    commodities: { bullish: 0.30, bearish: 0.65 },  // demand destruction
  },
  STAGFLATION: {
    fx:          { bullish: 0.50, bearish: 0.50 },
    index:       { bullish: 0.25, bearish: 0.75 },  // growth squeeze
    bonds:       { bullish: 0.20, bearish: 0.80 },  // inflation premium
    commodities: { bullish: 0.90, bearish: 0.10 },  // inflation hedge bid
  },
  DISINFLATION: {
    fx:          { bullish: 0.60, bearish: 0.40 },
    index:       { bullish: 0.70, bearish: 0.30 },  // multiple expansion
    bonds:       { bullish: 0.90, bearish: 0.10 },  // rate decline thesis
    commodities: { bullish: 0.30, bearish: 0.70 },  // deflation pressure
  },
  LIQUIDITY_STRESS: {
    fx:          { bullish: 0.20, bearish: 0.85 },  // dollar wrecking-ball
    index:       { bullish: 0.10, bearish: 0.90 },
    bonds:       { bullish: 0.65, bearish: 0.35 },  // flight to quality
    commodities: { bullish: 0.35, bearish: 0.65 },
  },
  TRANSITIONAL: {
    fx:          { bullish: 0.40, bearish: 0.40 },
    index:       { bullish: 0.40, bearish: 0.40 },
    bonds:       { bullish: 0.40, bearish: 0.40 },
    commodities: { bullish: 0.40, bearish: 0.40 },
  },
};

// ── RAW SCORE FUNCTIONS (0-1) ─────────────────────────────────────────────────

function scoreBiasStrength(biasScore) {
  if (biasScore == null || isNaN(biasScore)) return 0;
  return Math.min(1, Math.abs(biasScore) / 5);
}

function scoreDivergence(divState, direction) {
  if (!divState || divState === 'NONE') return 0.60;  // no divergence = mild positive
  const isBull = direction === 'bullish';
  if (divState === 'EXHAUSTION')       return 0.00;   // hard stop — reversal risk
  if (divState === 'BULLISH_DIVERGENCE') return isBull ? 1.00 : 0.15;
  if (divState === 'BEARISH_DIVERGENCE') return isBull ? 0.15 : 1.00;
  return 0.50;
}

function scoreZscore(zscore, direction) {
  if (zscore == null || isNaN(zscore)) return 0.55;
  const z       = Math.abs(zscore);
  const aligned = (zscore > 0 && direction === 'bullish') ||
                  (zscore < 0 && direction === 'bearish');
  // Normal range: clean signal, no crowding
  if (z < 1.0) return 0.85;
  if (z < 1.5) return 0.75;
  // Stretched: some crowding risk
  if (z < 2.0) return aligned ? 0.55 : 0.70;
  // Extreme: crowding risk aligned, contrarian edge opposed
  if (z < 2.5) return aligned ? 0.35 : 0.75;
  return aligned ? 0.20 : 0.80;  // strong contrarian if extreme & opposed
}

function scoreFlowPersistence(streak) {
  if (!streak || streak <= 0) return 0.20;
  if (streak === 1)            return 0.35;
  if (streak === 2)            return 0.55;
  if (streak === 3)            return 0.72;
  if (streak === 4)            return 0.85;
  if (streak === 5)            return 0.93;
  return 1.00;  // 6+ consecutive reports
}

function scoreMacroRegime(riskRegime, direction, cat) {
  if (!riskRegime?.regime) return 0.40;
  const regime = riskRegime.regime;
  const conf   = Math.min(1, (riskRegime.confidence ?? 50) / 100);
  const catMap = MACRO_ALIGNMENT[regime] ?? MACRO_ALIGNMENT.TRANSITIONAL;
  const dirMap = catMap[cat] ?? catMap.fx;
  const base   = direction === 'bullish' ? dirMap.bullish : dirMap.bearish;
  // Blend with confidence: low confidence → regress toward 0.40 neutral
  return base * conf + 0.40 * (1 - conf);
}

function scoreCarryPolicy(opts, cat, direction) {
  const { carryConviction, cycleProfiles, riskRegime } = opts;

  if (cat === 'fx') {
    const map = {
      STRONG_LONG_BASE:    direction === 'bullish' ? 1.00 : 0.00,
      MODERATE_LONG_BASE:  direction === 'bullish' ? 0.72 : 0.28,
      NEUTRAL:             0.50,
      MODERATE_SHORT_BASE: direction === 'bearish' ? 0.72 : 0.28,
      STRONG_SHORT_BASE:   direction === 'bearish' ? 1.00 : 0.00,
    };
    return map[carryConviction] ?? 0.50;
  }

  if (cat === 'bonds') {
    const fed = cycleProfiles?.['FED'];
    if (!fed) return 0.50;
    if (fed.cycleType === 'CUTTING' && direction === 'bullish')  return 0.92;
    if (fed.cycleType === 'CUTTING' && direction === 'bearish')  return 0.15;
    if (fed.cycleType === 'HIKING'  && direction === 'bearish')  return 0.92;
    if (fed.cycleType === 'HIKING'  && direction === 'bullish')  return 0.15;
    if (fed.cycleType === 'PAUSED') {
      // Late pause often precedes cuts → mildly bullish bonds
      return fed.maturity === 'LATE' || fed.maturity === 'EXTENDED'
        ? (direction === 'bullish' ? 0.62 : 0.38)
        : 0.50;
    }
    return 0.50;
  }

  if (cat === 'index') {
    // Proxy: liquidity / yield pressure via macro regime
    const regime = riskRegime?.regime;
    if (!regime) return 0.50;
    if (regime === 'RISK_ON' || regime === 'DISINFLATION') return direction === 'bullish' ? 0.75 : 0.25;
    if (regime === 'RISK_OFF' || regime === 'LIQUIDITY_STRESS') return direction === 'bearish' ? 0.75 : 0.25;
    return 0.50;
  }

  if (cat === 'commodities') {
    // Proxy: inflation/supply regime from macro
    const regime = riskRegime?.regime;
    if (!regime) return 0.50;
    if (regime === 'STAGFLATION') return direction === 'bullish' ? 0.90 : 0.10;
    if (regime === 'RISK_ON')     return direction === 'bullish' ? 0.68 : 0.32;
    if (regime === 'DISINFLATION') return direction === 'bearish' ? 0.72 : 0.28;
    return 0.50;
  }

  return 0.50;
}

function scoreCrossAsset(crossAssetCtx, direction) {
  if (!crossAssetCtx) return 0.50;
  const theme = (crossAssetCtx.dominantTheme ?? '').toUpperCase();
  if (!theme) return 0.50;

  const isBull = direction === 'bullish';
  // Themes that support bullish positions
  const bullish = ['RISK_ON', 'CARRY_FAVORABLE', 'GROWTH', 'MOMENTUM', 'INFLATION_HEDGE'];
  // Themes that support bearish positions
  const bearish = ['RISK_OFF', 'CARRY_UNWIND', 'DEFLATION', 'FLIGHT', 'STRESS', 'DETERIORATION'];

  const hasBullish = bullish.some(k => theme.includes(k));
  const hasBearish = bearish.some(k => theme.includes(k));

  if (hasBullish && !hasBearish) return isBull ? 0.90 : 0.15;
  if (hasBearish && !hasBullish) return isBull ? 0.15 : 0.90;
  if (hasBullish && hasBearish)  return 0.45;  // mixed signals
  return 0.50;
}

function scoreExecution(exec) {
  if (!exec) return 0.40;
  const label = exec.permission?.label ?? '';
  const score = exec.score ?? 50;
  if (label === 'FAVORABLE' || score >= 70) return 1.00;
  if (score >= 55)                           return 0.65;
  if (score >= 40)                           return 0.40;
  return 0.15;
}

// ── RISK FACTOR BUILDER ───────────────────────────────────────────────────────

function buildRiskFactors(rawScores, biasEntry, direction, cat, biasScore) {
  const risks = [];
  const z     = biasEntry.zscore?.zscore ?? null;

  if (z != null && Math.abs(z) >= 2.5) {
    risks.push({
      type: 'CROWDING_RISK', severity: 'HIGH',
      description: `Extreme positioning (Z: ${z > 0 ? '+' : ''}${z?.toFixed(2)}, ${biasEntry.zscore?.percentile ?? '?'}th pct) — sharp reversal risk at these levels.`,
    });
  } else if (z != null && Math.abs(z) >= 1.5) {
    risks.push({
      type: 'CROWDING_RISK', severity: 'MODERATE',
      description: `Stretched positioning (Z: ${z?.toFixed(2)}) — not extreme but worth monitoring for distribution signals.`,
    });
  }

  if (biasEntry.divergence?.state === 'EXHAUSTION') {
    risks.push({
      type: 'EXHAUSTION', severity: 'HIGH',
      description: 'Price and positioning co-moving at extremes — exhaustion signal historically precedes sharp mean-reversion.',
    });
  }

  if (rawScores.macro_regime < 0.30) {
    risks.push({
      type: 'REGIME_CONFLICT', severity: 'MODERATE',
      description: 'Current macro regime creates structural headwinds for this directional thesis. Consider reducing size.',
    });
  }

  if (Math.abs(biasScore) < 1.5) {
    risks.push({
      type: 'WEAK_SIGNAL', severity: 'LOW',
      description: `Bias magnitude (${biasScore?.toFixed(1)}) below conviction threshold — signal may not reflect institutional intent.`,
    });
  }

  if (cat === 'fx' && rawScores.carry_policy < 0.30) {
    risks.push({
      type: 'CARRY_HEADWIND', severity: 'MODERATE',
      description: 'CB policy divergence opposes carry direction — rate differential may erode accumulated P&L.',
    });
  }

  if (rawScores.execution < 0.30) {
    risks.push({
      type: 'EXECUTION_CONDITIONS', severity: 'LOW',
      description: 'Volatility or macro context restricts tactical entry timing. Wait for execution window.',
    });
  }

  if (rawScores.divergence === 0 || biasEntry.divergence?.state === 'EXHAUSTION') {
    // Already covered above, skip duplicate
  } else if (rawScores.divergence < 0.30) {
    risks.push({
      type: 'DIVERGENCE_CONFLICT', severity: 'MODERATE',
      description: `Divergence signal conflicts with ${direction} positioning thesis — price and institutional flow not aligned.`,
    });
  }

  return risks;
}

// ── SIGNAL CONFLICT DETECTOR ──────────────────────────────────────────────────

function detectConflicts(rawScores, cat) {
  const conflicts = [];
  if (rawScores.divergence < 0.30)   conflicts.push('Divergence opposes positioning direction');
  if (rawScores.macro_regime < 0.30) conflicts.push('Macro regime misaligned with COT thesis');
  if (rawScores.zscore < 0.30)       conflicts.push('Positioning at reversal-risk extreme (aligned with trade direction)');
  if (rawScores.carry_policy < 0.30 && cat === 'fx') conflicts.push('CB policy cycle creates carry headwind');
  if (rawScores.flow_persist < 0.30) conflicts.push('Insufficient flow persistence — thesis too early-stage');
  return conflicts;
}

// ── PUBLIC: CONVICTION PROFILE ────────────────────────────────────────────────

/**
 * Builds a full conviction profile for a single asset.
 *
 * @param {Object} biasEntry   — from buildBiasArray / cotBiasEngine
 * @param {Object} pairRow     — from parseTiffCombined
 * @param {Object} opts        — {
 *   riskRegime, cycleProfiles, exec, crossAssetCtx,
 *   carryConviction   string  — pre-computed from enrichCarryPairWithCycle
 * }
 *
 * @returns {ConvictionProfile}
 */
export function buildConvictionProfile(biasEntry, pairRow, opts = {}) {
  const { riskRegime, cycleProfiles, exec, crossAssetCtx, carryConviction } = opts;

  const cat       = (pairRow?.cat ?? biasEntry?.cat ?? 'fx').toLowerCase();
  const direction = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';
  const biasScore = biasEntry?.bias?.score ?? biasEntry?.score ?? 0;
  const streak    = pairRow?.signal?.strength ?? 0;
  const divState  = biasEntry?.divergence?.state ?? 'NONE';
  const zscore    = biasEntry?.zscore?.zscore ?? null;

  if (direction === 'neutral') {
    return {
      conviction_score:  15,
      conviction_label:  'INSUFFICIENT',
      confidence_tier:   'TIER_3',
      alignment_count:   0,
      conflict_count:    0,
      factors:           {},
      signal_conflicts:  ['No dominant directional bias — institutional positioning neutral'],
      risk_factors:      [],
      meta:              { direction, cat, pair: biasEntry?.pair },
    };
  }

  const weights = ASSET_WEIGHTS[cat] ?? ASSET_WEIGHTS.fx;

  const rawScores = {
    bias_strength: scoreBiasStrength(biasScore),
    divergence:    scoreDivergence(divState, direction),
    zscore:        scoreZscore(zscore, direction),
    flow_persist:  scoreFlowPersistence(streak),
    macro_regime:  scoreMacroRegime(riskRegime, direction, cat),
    carry_policy:  scoreCarryPolicy({ carryConviction, cycleProfiles, riskRegime }, cat, direction),
    cross_asset:   scoreCrossAsset(crossAssetCtx, direction),
    execution:     scoreExecution(exec),
  };

  // Weighted base score
  const baseScore = Object.entries(weights)
    .reduce((sum, [key, w]) => sum + (rawScores[key] ?? 0) * w * 100, 0);

  // Alignment bonus: every factor scoring > 0.60 counts as confirming
  const alignedCount  = Object.values(rawScores).filter(s => s > 0.60).length;
  const conflictCount = Object.values(rawScores).filter(s => s < 0.35).length;

  // Bonus: +1.5 per aligned factor above 4 (max +9), penalty: -2 per conflict above 2 (max -8)
  const bonus   = alignedCount  >= 5 ? Math.min(9, (alignedCount - 4)  * 1.5) : 0;
  const penalty = conflictCount >= 3 ? Math.min(8, (conflictCount - 2) * 2.0) : 0;

  const finalScore = Math.min(100, Math.max(0, Math.round(baseScore + bonus - penalty)));

  const conviction_label =
    finalScore >= 80 ? 'VERY HIGH' :
    finalScore >= 65 ? 'HIGH'      :
    finalScore >= 45 ? 'MODERATE'  :
    finalScore >= 30 ? 'LOW'       : 'VERY LOW';

  const confidence_tier =
    finalScore >= 70 ? 'TIER_1' :
    finalScore >= 50 ? 'TIER_2' : 'TIER_3';

  // Per-factor breakdown (for XLSX/JSON detail)
  const factors = {};
  for (const [key, w] of Object.entries(weights)) {
    const raw  = rawScores[key] ?? 0;
    const contrib = Math.round(raw * w * 100);
    factors[key] = {
      raw:          parseFloat(raw.toFixed(3)),
      weight:       w,
      contribution: contrib,
      status:       raw > 0.60 ? 'CONFIRMING' : raw < 0.35 ? 'CONFLICTING' : 'NEUTRAL',
    };
  }

  return {
    conviction_score:  finalScore,
    conviction_label,
    confidence_tier,
    alignment_count:   alignedCount,
    conflict_count:    conflictCount,
    factors,
    signal_conflicts:  detectConflicts(rawScores, cat),
    risk_factors:      buildRiskFactors(rawScores, biasEntry, direction, cat, biasScore),
    meta:              { direction, cat, pair: biasEntry?.pair, bias_score: biasScore, streak },
  };
}

// ── PUBLIC: PRIORITIZATION MATRIX ─────────────────────────────────────────────

/**
 * Ranks all assets into decision categories.
 * Call after building conviction profiles for all assets.
 *
 * @param {Array<DecisionAsset>} decisionAssets — array of:
 *   { pair, cat, direction, conviction, horizon, exec, biasEntry }
 *
 * @returns {PrioritizationMatrix}
 */
export function buildPrioritizationMatrix(decisionAssets) {
  if (!decisionAssets?.length) {
    return {
      top_opportunities: [], most_aligned: [], highest_conviction: [],
      regime_leaders: [], contrarian_extremes: [], crowded_trades: [],
      generated_at: new Date().toISOString(),
    };
  }

  const active = decisionAssets.filter(a =>
    a.conviction && a.direction && a.direction !== 'neutral',
  );
  const byScore = [...active].sort(
    (a, b) => (b.conviction.conviction_score ?? 0) - (a.conviction.conviction_score ?? 0),
  );

  // Summarize for list entries
  const toEntry = (a) => ({
    pair:             a.pair,
    cat:              a.cat,
    direction:        a.direction,
    conviction_score: a.conviction.conviction_score,
    conviction_label: a.conviction.conviction_label,
    confidence_tier:  a.conviction.confidence_tier,
    alignment_count:  a.conviction.alignment_count,
    swing_view:       a.horizon?.swing?.view    ?? null,
    macro_view:       a.horizon?.macro?.view    ?? null,
    exec_label:       a.exec?.permission?.label ?? 'UNKNOWN',
    key_factors:      Object.entries(a.conviction.factors ?? {})
      .filter(([, f]) => f.status === 'CONFIRMING')
      .sort(([, a], [, b]) => b.contribution - a.contribution)
      .slice(0, 3)
      .map(([name]) => name.replace(/_/g, ' ')),
  });

  // 1. Top Opportunities: high conviction AND favorable execution
  const top_opportunities = byScore
    .filter(a =>
      a.conviction.conviction_score >= 55 &&
      (a.exec?.permission?.label === 'FAVORABLE' || (a.exec?.score ?? 0) >= 60),
    )
    .slice(0, 6)
    .map(toEntry);

  // 2. Most Aligned: maximum confirming factors (5+)
  const most_aligned = byScore
    .filter(a => a.conviction.alignment_count >= 5)
    .slice(0, 5)
    .map(toEntry);

  // 3. Highest Conviction: pure score ranking
  const highest_conviction = byScore.slice(0, 5).map(toEntry);

  // 4. Regime Leaders: assets where macro_regime factor is confirming AND conviction is high
  const regime_leaders = byScore
    .filter(a => {
      const mf = a.conviction.factors?.macro_regime;
      return mf && mf.status === 'CONFIRMING' && a.conviction.conviction_score >= 50;
    })
    .slice(0, 5)
    .map(toEntry);

  // 5. Contrarian Extremes: extreme positioning (|z| ≥ 2.0) AGAINST current bias
  const contrarian_extremes = decisionAssets
    .filter(a => {
      const z   = a.biasEntry?.zscore?.zscore ?? null;
      const dir = a.direction;
      if (z == null) return false;
      const zAbs     = Math.abs(z);
      const aligned  = (z > 0 && dir === 'bullish') || (z < 0 && dir === 'bearish');
      // Extreme positioning ALIGNED with trade = crowding risk = contrarian fade opportunity
      return zAbs >= 2.0 && aligned;
    })
    .sort((a, b) => Math.abs(b.biasEntry?.zscore?.zscore ?? 0) - Math.abs(a.biasEntry?.zscore?.zscore ?? 0))
    .slice(0, 4)
    .map(a => ({
      ...toEntry(a),
      zscore:            a.biasEntry?.zscore?.zscore,
      percentile:        a.biasEntry?.zscore?.percentile,
      contrarian_signal: `Extreme ${a.direction} crowd — fade opportunity if divergence emerges`,
    }));

  // 6. Crowded Trades: extreme z-score + LOW conviction (signal quality + crowding = danger)
  const crowded_trades = decisionAssets
    .filter(a => {
      const z = a.biasEntry?.zscore?.zscore ?? null;
      return z != null && Math.abs(z) >= 1.8 && a.conviction.conviction_score < 50;
    })
    .sort((a, b) => Math.abs(b.biasEntry?.zscore?.zscore ?? 0) - Math.abs(a.biasEntry?.zscore?.zscore ?? 0))
    .slice(0, 4)
    .map(a => ({
      ...toEntry(a),
      zscore:  a.biasEntry?.zscore?.zscore,
      warning: 'Extreme positioning with weak multi-signal conviction — elevated reversal risk',
    }));

  return {
    top_opportunities,
    most_aligned,
    highest_conviction,
    regime_leaders,
    contrarian_extremes,
    crowded_trades,
    asset_count:    decisionAssets.length,
    active_count:   active.length,
    generated_at:   new Date().toISOString(),
  };
}

// ── CONVICTION COLOR / BADGE HELPERS ──────────────────────────────────────────

export const CONVICTION_COLORS = {
  'VERY HIGH': '#22c55e',
  'HIGH':      '#4ade80',
  'MODERATE':  '#f59e0b',
  'LOW':       '#f97316',
  'VERY LOW':  '#ef4444',
  'INSUFFICIENT': '#6b7280',
};

export const TIER_COLORS = {
  TIER_1: '#22c55e',
  TIER_2: '#f59e0b',
  TIER_3: '#6b7280',
};

export function convictionColor(label) {
  return CONVICTION_COLORS[label] ?? '#6b7280';
}
