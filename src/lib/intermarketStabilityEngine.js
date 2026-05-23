/**
 * intermarketStabilityEngine.js — Cross-Asset Correlation Stability Engine v1.0
 *
 * Measures whether current institutional positioning is COHERENT with established
 * cross-asset relationships, or whether correlation breakdowns suggest structural
 * stress, regime dislocation, or transitional instability.
 *
 * Detects classic anomaly patterns:
 *   1. Yields up + Equities up   — bonds sold while equities bid (late-cycle or supply shock)
 *   2. Gold up + USD up          — both havens bid simultaneously (extreme stress / geopolitical)
 *   3. Oil up + Bonds bid        — cost-push inflation + recession fear simultaneously
 *   4. Equities down + Bonds down— forced de-risking (liquidity stress) or stagflation
 *   5. Gold down + Risk-Off      — gold sold for cash (margin calls) during supposed haven demand
 *   6. Regime incoherence        — asset directions don't match current regime's expected fingerprint
 *
 * Outputs:
 *   stability_score:    0–100   (100 = fully coherent, 0 = full breakdown)
 *   regime_coherence:   HIGH | MODERATE | LOW | INCOHERENT
 *   breakdowns:         Array<{ type, assets, severity, interpretation }>
 *   anomalies:          string[]   (human-readable summaries)
 *   structural_integrity: 0–100
 *
 * Design:
 *   - Pure functions. No side effects. No state. No React.
 *   - Works with whatever key assets are available — graceful degradation.
 *   - No minimum asset requirement; fewer assets = lower confidence output.
 *
 * Input:  riskRegime, allBiasArr (scored entries for all available assets), opts
 * Output: IntermarketStabilityProfile
 */

// ── BREAKDOWN SEVERITY ────────────────────────────────────────────────────────

export const BREAKDOWN_SEVERITY = {
  MILD:     'MILD',
  MODERATE: 'MODERATE',
  SEVERE:   'SEVERE',
  CRITICAL: 'CRITICAL',
};

export const SEVERITY_DEDUCTIONS = {
  MILD:     8,
  MODERATE: 18,
  SEVERE:   30,
  CRITICAL: 45,
};

export const COHERENCE_LEVELS = {
  HIGH:       'HIGH',
  MODERATE:   'MODERATE',
  LOW:        'LOW',
  INCOHERENT: 'INCOHERENT',
};

// ── REGIME FINGERPRINTS ───────────────────────────────────────────────────────
// What direction should each key asset be in, under each regime?

const REGIME_FINGERPRINTS = {
  RISK_ON: {
    equity: 'bullish', bonds: 'bearish',  gold: 'bearish',  oil: 'bullish', usd: 'bearish',
  },
  RISK_OFF: {
    equity: 'bearish', bonds: 'bullish',  gold: 'bullish',  oil: 'bearish', usd: 'bullish',
  },
  STAGFLATION: {
    equity: 'bearish', bonds: 'bearish',  gold: 'bullish',  oil: 'bullish', usd: 'neutral',
  },
  DISINFLATION: {
    equity: 'bullish', bonds: 'bullish',  gold: 'neutral',  oil: 'bearish', usd: 'neutral',
  },
  LIQUIDITY_STRESS: {
    equity: 'bearish', bonds: 'neutral',  gold: 'bearish',  oil: 'bearish', usd: 'bullish',
  },
  TRANSITIONAL: {
    equity: 'neutral', bonds: 'neutral',  gold: 'neutral',  oil: 'neutral', usd: 'neutral',
  },
};

// ── ASSET ROLE EXTRACTION ─────────────────────────────────────────────────────

const ROLE_ALIASES = {
  equity: ['SP500', 'NAS100', 'ES', 'NQ', 'SPX', 'NDX'],
  bonds:  ['US10Y', 'US2Y', 'US30Y', 'ZN', 'ZB', 'ZT'],
  gold:   ['GOLD', 'GC', 'XAU', 'GLD'],
  oil:    ['WTI', 'CL', 'OIL', 'CRUDE', 'BRENT'],
  usd:    ['DXY', 'USDX', 'USD'],
};

function resolveRole(pair) {
  const up = (pair ?? '').replace('/', '').toUpperCase();
  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    if (aliases.some(a => up === a || up.startsWith(a))) return role;
  }
  return null;
}

function extractRoleMap(allBiasArr) {
  const roleMap = {};
  for (const b of allBiasArr ?? []) {
    const role = resolveRole(b.pair);
    if (role && !roleMap[role]) {
      roleMap[role] = {
        direction: b.bias?.direction ?? b.direction ?? 'neutral',
        score:     b.bias?.score     ?? b.score     ?? 0,
        pair:      b.pair,
      };
    }
  }
  return roleMap;  // { equity: {direction, score, pair}, bonds: ..., ... }
}

// ── ANOMALY DETECTORS ─────────────────────────────────────────────────────────

/**
 * Anomaly 1: Yields-Equities Coupling
 * Both bonds bearish (yields up) AND equities bullish.
 * Normally: bonds bearish → equities also under pressure (crowding out).
 * Anomalous if sustained: suggests late-cycle growth/inflation surge.
 */
function detectYieldsEquitiesAnomaly(equity, bonds) {
  if (!equity || !bonds) return null;
  // Both selling bonds + equities both bid = unusual late-cycle or supply shock
  if (bonds.direction === 'bearish' && equity.direction === 'bullish') {
    return {
      type:           'YIELDS_EQUITIES_COUPLING',
      assets:         [bonds.pair ?? 'Bonds', equity.pair ?? 'Equities'],
      severity:       BREAKDOWN_SEVERITY.MODERATE,
      interpretation: 'Bonds sold (yields rising) while equities also bid — late-cycle growth/inflation surge or supply shock. ' +
                      'Historically precedes multiple compression when yields rise far enough.',
    };
  }
  // Both bid simultaneously = stagflation signal or policy confusion
  if (bonds.direction === 'bullish' && equity.direction === 'bullish') {
    return {
      type:           'EQUITIES_BONDS_BOTH_BID',
      assets:         [equity.pair ?? 'Equities', bonds.pair ?? 'Bonds'],
      severity:       BREAKDOWN_SEVERITY.MILD,
      interpretation: 'Both equities and bonds accumulating — goldilocks positioning or early-cycle rotation. ' +
                      'Watch for which trend is leading; divergence expected as cycle matures.',
    };
  }
  return null;
}

/**
 * Anomaly 2: Gold-Dollar Coupling
 * Both gold and USD simultaneously bullish.
 * Normally inversely correlated — gold up typically means USD down.
 * Both up = extreme geopolitical stress or severe systemic fear.
 */
function detectGoldDollarAnomaly(gold, usd) {
  if (!gold || !usd) return null;
  if (gold.direction === 'bullish' && usd.direction === 'bullish') {
    return {
      type:           'GOLD_DOLLAR_COUPLING',
      assets:         [gold.pair ?? 'Gold', usd.pair ?? 'USD'],
      severity:       BREAKDOWN_SEVERITY.SEVERE,
      interpretation: 'Both gold and USD net long simultaneously — classically inversely correlated assets aligning. ' +
                      'Signals extreme systemic stress or geopolitical disruption. Historical analog: March 2020, Aug 2011.',
    };
  }
  // Both bearish = risk-on or complacency — less anomalous
  if (gold.direction === 'bearish' && usd.direction === 'bearish') {
    return {
      type:           'GOLD_DOLLAR_BOTH_SOLD',
      assets:         [gold.pair ?? 'Gold', usd.pair ?? 'USD'],
      severity:       BREAKDOWN_SEVERITY.MILD,
      interpretation: 'Both gold and USD in distribution — consistent with strong risk-on, but watch for ' +
                      'USD capitulation creating carry unwind risk.',
    };
  }
  return null;
}

/**
 * Anomaly 3: Oil-Bonds Contradiction
 * Oil bullish (inflationary) + Bonds also bullish (deflationary/haven).
 * Mutually contradictory: cost-push inflation should sell bonds, not bid them.
 */
function detectOilBondsAnomaly(oil, bonds) {
  if (!oil || !bonds) return null;
  if (oil.direction === 'bullish' && bonds.direction === 'bullish') {
    return {
      type:           'OIL_BONDS_CONTRADICTION',
      assets:         [oil.pair ?? 'Oil', bonds.pair ?? 'Bonds'],
      severity:       BREAKDOWN_SEVERITY.MODERATE,
      interpretation: 'Oil and bonds both net long — supply disruption creating stagflation fear while ' +
                      'fixed income simultaneously absorbs recessionary positioning. ' +
                      'Regime unclear; central bank credibility risk elevated.',
    };
  }
  return null;
}

/**
 * Anomaly 4: Equities-Bonds Both Sold
 * Both equities bearish AND bonds bearish = forced de-risking or stagflation.
 */
function detectEquityBondSelloff(equity, bonds) {
  if (!equity || !bonds) return null;
  if (equity.direction === 'bearish' && bonds.direction === 'bearish') {
    return {
      type:           'EQUITY_BOND_JOINT_SELLOFF',
      assets:         [equity.pair ?? 'Equities', bonds.pair ?? 'Bonds'],
      severity:       BREAKDOWN_SEVERITY.SEVERE,
      interpretation: 'Both equities and bonds in net short positioning — simultaneous de-risking. ' +
                      'Consistent with liquidity stress (forced selling) or entrenched stagflation. ' +
                      'Duration and growth both repriced negatively.',
    };
  }
  return null;
}

/**
 * Anomaly 5: Gold Sold During Risk-Off
 * In a risk-off regime, gold should be bid. Gold selling = margin calls / forced liquidation.
 */
function detectGoldSoldInRiskOff(gold, regime) {
  if (!gold || regime !== 'RISK_OFF') return null;
  if (gold.direction === 'bearish') {
    return {
      type:           'GOLD_SOLD_RISK_OFF',
      assets:         [gold.pair ?? 'Gold'],
      severity:       BREAKDOWN_SEVERITY.SEVERE,
      interpretation: 'Gold positioning net short during apparent risk-off regime — classic margin-call liquidation ' +
                      'pattern. Institutional forced selling overrides haven demand. Potential liquidity stress escalation.',
    };
  }
  return null;
}

/**
 * Anomaly 6: USD Weak During Risk-Off
 * In risk-off, USD should strengthen. USD weakness = possible regime misclassification
 * or DM currency stress (alternative havens like CHF, JPY taking USD's place).
 */
function detectUsdWeakRiskOff(usd, regime) {
  if (!usd || regime !== 'RISK_OFF') return null;
  if (usd.direction === 'bearish') {
    return {
      type:           'USD_WEAK_RISK_OFF',
      assets:         [usd.pair ?? 'DXY'],
      severity:       BREAKDOWN_SEVERITY.MODERATE,
      interpretation: 'USD positioning net short during risk-off — haven demand flowing to alternative currencies ' +
                      '(CHF, JPY, gold) rather than USD. May indicate USD-specific risk or Fed credibility issue.',
    };
  }
  return null;
}

// ── REGIME COHERENCE SCORING ──────────────────────────────────────────────────

function computeRegimeCoherence(roleMap, regime) {
  const fingerprint = REGIME_FINGERPRINTS[regime] ?? REGIME_FINGERPRINTS.TRANSITIONAL;
  let aligned = 0;
  let checked = 0;

  for (const [role, expected] of Object.entries(fingerprint)) {
    if (expected === 'neutral') continue;
    const actual = roleMap[role];
    if (!actual) continue;
    checked++;
    if (actual.direction === expected) aligned++;
  }

  if (checked === 0) return { score: 50, label: COHERENCE_LEVELS.MODERATE, checked: 0, aligned: 0 };

  const ratio = aligned / checked;
  const label = ratio >= 0.80 ? COHERENCE_LEVELS.HIGH
    : ratio >= 0.60 ? COHERENCE_LEVELS.MODERATE
    : ratio >= 0.40 ? COHERENCE_LEVELS.LOW
    : COHERENCE_LEVELS.INCOHERENT;

  return { score: Math.round(ratio * 100), label, checked, aligned };
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Builds an intermarket stability analysis from available cross-asset positioning.
 *
 * @param {Object}  riskRegime   — current macro risk regime
 * @param {Array}   allBiasArr   — all scored bias entries (FX + index + bonds + commodities)
 * @param {Object}  [opts]
 * @returns {IntermarketStabilityProfile}
 */
export function buildIntermarketStability(riskRegime, allBiasArr) {
  const regime     = riskRegime?.regime     ?? 'TRANSITIONAL';
  const confidence = riskRegime?.confidence ?? 50;

  const roleMap = extractRoleMap(allBiasArr ?? []);
  const { equity, bonds, gold, oil, usd } = roleMap;

  const availableRoles = Object.keys(roleMap).length;

  // Run all anomaly detectors
  const detectedBreakdowns = [
    detectYieldsEquitiesAnomaly(equity, bonds),
    detectGoldDollarAnomaly(gold, usd),
    detectOilBondsAnomaly(oil, bonds),
    detectEquityBondSelloff(equity, bonds),
    detectGoldSoldInRiskOff(gold, regime),
    detectUsdWeakRiskOff(usd, regime),
  ].filter(Boolean);

  // Compute stability score: start from regime confidence, deduct per breakdown
  let stabilityScore = confidence;
  for (const breakdown of detectedBreakdowns) {
    stabilityScore -= SEVERITY_DEDUCTIONS[breakdown.severity] ?? 15;
  }

  // Coherence bonus: if most assets align with regime, add stability
  const coherence = computeRegimeCoherence(roleMap, regime);
  stabilityScore += (coherence.score - 50) * 0.3;  // blend toward coherence

  stabilityScore = Math.round(Math.max(0, Math.min(100, stabilityScore)));

  const regimeCoherenceLabel = coherence.label;

  // Structural integrity: separate from stability — measures how internally consistent
  // the cross-asset picture is, regardless of regime label
  const contradictions = detectedBreakdowns.filter(b =>
    b.severity === 'SEVERE' || b.severity === 'CRITICAL',
  ).length;
  const structuralIntegrity = Math.round(Math.max(0, Math.min(100,
    100 - (contradictions * 30) - (detectedBreakdowns.length * 5),
  )));

  // Human-readable anomaly summaries
  const anomalies = detectedBreakdowns.map(b => {
    const assetStr = b.assets.join(' + ');
    const sevStr   = b.severity === 'CRITICAL' ? '🔴 CRITICAL' : b.severity === 'SEVERE' ? '🟠 SEVERE'
      : b.severity === 'MODERATE' ? '🟡 MODERATE' : '⚪ MILD';
    return `${sevStr}: ${b.type.replace(/_/g, ' ')} — ${assetStr}`;
  });

  // Key observations
  const observations = buildObservations(regime, roleMap, detectedBreakdowns, coherence);

  return {
    stability_score:      stabilityScore,
    regime_coherence:     regimeCoherenceLabel,
    coherence_details: {
      score:   coherence.score,
      checked: coherence.checked,
      aligned: coherence.aligned,
    },
    structural_integrity: structuralIntegrity,
    breakdowns:           detectedBreakdowns,
    anomalies,
    observations,
    available_roles:      availableRoles,
    signal_coverage:      availableRoles >= 4 ? 'HIGH' : availableRoles >= 2 ? 'MODERATE' : 'LOW',
    meta: {
      regime_at_analysis: regime,
      regime_confidence:  confidence,
      roles_detected:     Object.keys(roleMap),
    },
  };
}

function buildObservations(regime, roleMap, breakdowns, coherence) {
  const obs = [];

  if (coherence.label === 'HIGH') {
    obs.push(`Cross-asset positioning is highly coherent with ${regime} regime — institutional flows are structurally aligned`);
  } else if (coherence.label === 'INCOHERENT') {
    obs.push(`Cross-asset positioning is incoherent with declared ${regime} regime — regime label may be transitional or stale`);
  }

  if (breakdowns.length === 0) {
    obs.push('No significant cross-asset correlation anomalies detected — standard inter-market relationships holding');
  }

  if (breakdowns.some(b => b.type === 'GOLD_DOLLAR_COUPLING')) {
    obs.push('Gold-Dollar coupling is the most historically reliable early indicator of systemic stress — monitor closely');
  }

  if (breakdowns.some(b => b.type === 'EQUITY_BOND_JOINT_SELLOFF')) {
    obs.push('Joint equity-bond selloff pattern historically precedes central bank intervention — watch for policy pivot signals');
  }

  // Coverage observation
  if (Object.keys(roleMap).length < 3) {
    obs.push('Limited cross-asset data coverage — stability analysis is partial; upload Combined COT file for full intermarket picture');
  }

  return obs.slice(0, 3);
}
