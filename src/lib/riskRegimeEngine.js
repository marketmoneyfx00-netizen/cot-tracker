/**
 * riskRegimeEngine.js — Macro Risk Regime Classifier v1.0
 *
 * Detects the dominant macro regime from multi-asset COT positioning.
 * Works with whatever data is available — no hard dependencies on Combined upload.
 *
 * Data sources (priority order):
 *   1. allBiasArr   — scored assets from TFF Futures Only (SP500, NAS100, bonds, FX)
 *   2. combinedData — raw positioning from TFF Combined (adds GOLD, WTI, DXY, SILVER)
 *   3. macroSignal  — USD yield-spread bias from /api/macro
 *
 * Regimes:
 *   RISK_ON        — Equities bid, bonds sold, USD soft, demand commodities rising
 *   RISK_OFF       — Equities sold, bonds bid (safety), gold bid, USD strong
 *   STAGFLATION    — Bonds sold (rising yields), gold bid, oil bid, equities pressured
 *   DISINFLATION   — Bonds bid (falling yields), oil declining, gold neutral
 *   LIQUIDITY_STRESS — Dollar squeeze: forced de-risking across all asset classes
 *   TRANSITIONAL   — Mixed or insufficient signals
 */

// ── REGIME METADATA ───────────────────────────────────────────────────────────

export const REGIME_LABELS = {
  RISK_ON:          'Risk-On Expansion',
  RISK_OFF:         'Risk-Off / Defensive',
  STAGFLATION:      'Stagflationary Pressure',
  DISINFLATION:     'Disinflationary Repricing',
  LIQUIDITY_STRESS: 'Liquidity Stress',
  TRANSITIONAL:     'Transitional / Mixed',
};

export const REGIME_COLORS = {
  RISK_ON:          '#22c55e',
  RISK_OFF:         '#ef4444',
  STAGFLATION:      '#f97316',
  DISINFLATION:     '#60a5fa',
  LIQUIDITY_STRESS: '#dc2626',
  TRANSITIONAL:     '#8491a8',
};

const REGIME_DESCRIPTIONS = {
  RISK_ON:
    'Institutional flows reflect a risk-on posture: equity positioning is bid, bond selling ' +
    'pressure indicates rising yield tolerance, and demand-side commodity positioning supports ' +
    'the growth narrative.',
  RISK_OFF:
    'Multi-asset positioning reflects defensive institutional behavior: equity exposure is ' +
    'being reduced, fixed income is absorbing safe-haven demand, and gold positioning reinforces ' +
    'the risk-aversion signal.',
  STAGFLATION:
    'Positioning is consistent with a stagflationary environment: bond selling pressure implies ' +
    'rising inflation premium in yields, while simultaneous energy and gold accumulation reflects ' +
    'supply-driven inflation with deteriorating growth.',
  DISINFLATION:
    'Institutional positioning reflects a disinflationary regime: fixed income is bid ' +
    '(falling yield expectations), energy positioning is soft, and the demand structure ' +
    'suggests growth moderation without acute inflation pressure.',
  LIQUIDITY_STRESS:
    'Cross-asset positioning signals acute liquidity stress: forced de-risking across asset ' +
    'classes with USD demand elevated — consistent with margin-call dynamics or systemic ' +
    'funding pressure.',
  TRANSITIONAL:
    'Cross-asset COT positioning does not yet establish a dominant macro regime. Signals are ' +
    'mixed or insufficient to classify with confidence. Monitor for directional convergence ' +
    'across equities, bonds, and commodity markets.',
};

// ── SIGNAL EXTRACTION ─────────────────────────────────────────────────────────

function getAssetSignal(key, allBiasArr, combinedData) {
  // Prefer allBiasArr — fully scored by cotBiasEngine (more nuanced)
  const b = (allBiasArr ?? []).find(e => e.pair === key);
  if (b?.bias?.direction) {
    return {
      direction: b.bias.direction,
      score:     b.bias.score ?? 0,
      source:    'bias',
    };
  }

  // Fall back to combinedData — raw net positioning
  const c = combinedData?.byAsset?.[key];
  if (c?.latest) {
    const net = c.latest.smartNet ?? 0;
    return {
      direction: net > 5000 ? 'bullish' : net < -5000 ? 'bearish' : 'neutral',
      score:     net / 50000,
      source:    'combined',
    };
  }

  return null;
}

function combineEquities(sp500, nas100) {
  const dirs = [sp500?.direction, nas100?.direction].filter(Boolean);
  if (!dirs.length) return null;
  const bull = dirs.filter(d => d === 'bullish').length;
  const bear = dirs.filter(d => d === 'bearish').length;
  if (bull > bear)  return 'bullish';
  if (bear > bull)  return 'bearish';
  return 'neutral';
}

function combineBonds(us10y, us2y) {
  const dirs = [us10y?.direction, us2y?.direction].filter(Boolean);
  if (!dirs.length) return null;
  const bull = dirs.filter(d => d === 'bullish').length;
  const bear = dirs.filter(d => d === 'bearish').length;
  if (bull > bear)  return 'bullish';
  if (bear > bull)  return 'bearish';
  return 'neutral';
}

function classifyUSD(macroUsdBias, dxySignal) {
  if (macroUsdBias === 'USD_STRONG'       || macroUsdBias === 'USD_LEANING_STRONG') return 'bullish';
  if (macroUsdBias === 'USD_WEAK'         || macroUsdBias === 'USD_LEANING_WEAK')   return 'bearish';
  if (dxySignal?.direction)                                                          return dxySignal.direction;
  return null;
}

// ── REGIME SCORING ────────────────────────────────────────────────────────────
// Each function scores how well the observed signals fit that regime.
// Higher = more consistent with that regime.

function scoreRiskOn(eq, bnd, gld, oil, usd) {
  let s = 0;
  if (eq  === 'bullish') s += 4;  // primary requirement
  if (eq  === 'bearish') s -= 3;
  if (bnd === 'bearish') s += 2;  // selling bonds = yield tolerance = growth
  if (bnd === 'bullish') s -= 1;
  if (gld === 'bearish') s += 1;  // no safe-haven demand
  if (gld === 'bullish') s -= 1;
  if (oil === 'bullish') s += 1;  // demand-side energy bid
  if (usd === 'bearish') s += 1;  // soft dollar = risk appetite
  if (usd === 'bullish') s -= 1;
  return s;
}

function scoreRiskOff(eq, bnd, gld, oil, usd) {
  let s = 0;
  if (eq  === 'bearish') s += 4;  // primary requirement
  if (eq  === 'bullish') s -= 3;
  if (bnd === 'bullish') s += 3;  // flight to safety in fixed income
  if (bnd === 'bearish') s -= 1;
  if (gld === 'bullish') s += 2;  // gold as haven
  if (oil === 'bearish') s += 1;  // demand destruction fear
  if (usd === 'bullish') s += 2;  // dollar safe-haven bid
  if (usd === 'bearish') s -= 1;
  return s;
}

function scoreStagflation(eq, bnd, gld, oil, _usd) {
  let s = 0;
  if (bnd === 'bearish') s += 4;  // inflation premium in yields — key signal
  if (gld === 'bullish') s += 3;  // inflation hedge demand
  if (oil === 'bullish') s += 3;  // supply-driven cost push
  if (eq  === 'bearish') s += 2;  // margin compression
  if (eq  === 'neutral') s += 1;
  if (eq  === 'bullish') s -= 1;
  if (bnd === 'bullish') s -= 3;  // bond rally ≠ stagflation
  return s;
}

function scoreDisinflation(eq, bnd, gld, oil, _usd) {
  let s = 0;
  if (bnd === 'bullish') s += 4;  // bond rally = falling yield expectations
  if (oil === 'bearish') s += 2;  // deflationary commodity pressure
  if (gld === 'bearish') s += 1;  // no inflation premium needed
  if (gld === 'neutral') s += 1;
  if (eq  === 'bullish') s += 1;  // rate-cut optimism
  if (bnd === 'bearish') s -= 3;
  if (oil === 'bullish') s -= 2;
  return s;
}

function scoreLiquidityStress(eq, bnd, gld, oil, usd) {
  let s = 0;
  if (usd === 'bullish') s += 5;  // dollar squeeze is the defining signal
  if (eq  === 'bearish') s += 3;  // forced equity de-risking
  if (oil === 'bearish') s += 2;  // growth/demand collapse
  if (gld === 'bearish') s += 1;  // gold sold for cash (margin calls)
  // bonds: ambiguous in liquidity stress (first bid, then sold) — no penalty
  return s;
}

// ── KEY DRIVERS ───────────────────────────────────────────────────────────────

function buildKeyDrivers(regime, eq, bnd, gld, oil, usd, available) {
  const d = [];

  if (regime === 'RISK_ON') {
    if (eq  === 'bullish') d.push('Leveraged Money building net long equity exposure across index futures');
    if (bnd === 'bearish') d.push('Bond futures net short — rising yield tolerance consistent with growth optimism');
    if (oil === 'bullish') d.push('Energy positioning reflects demand-side confidence');
    if (usd === 'bearish') d.push('Dollar softness supports flows into risk-sensitive assets');
  } else if (regime === 'RISK_OFF') {
    if (eq  === 'bearish') d.push('Institutional equity exposure deteriorating or net short');
    if (bnd === 'bullish') d.push('Fixed income absorbing safe-haven demand — net long bond positioning elevated');
    if (gld === 'bullish') d.push('Gold accumulation confirms haven demand from Leveraged Money');
    if (usd === 'bullish') d.push('Dollar positioning reflects defensive capital concentration');
  } else if (regime === 'STAGFLATION') {
    if (bnd === 'bearish') d.push('Bond selling pressure signals rising inflation premium in yield curve');
    if (gld === 'bullish') d.push('Institutional gold accumulation consistent with inflation hedge positioning');
    if (oil === 'bullish') d.push('Energy net longs reflect supply-driven cost-push inflation expectations');
    if (eq  === 'bearish') d.push('Equity selling consistent with margin compression under stagflationary conditions');
  } else if (regime === 'DISINFLATION') {
    if (bnd === 'bullish') d.push('Bond buying signals institutional expectation of declining yields');
    if (oil === 'bearish') d.push('Energy net shorts reflect demand softness and deflationary commodity pressure');
    if (gld === 'bearish') d.push('Gold positioning implies reduced inflation premium in institutional portfolios');
  } else if (regime === 'LIQUIDITY_STRESS') {
    if (usd === 'bullish') d.push('Dollar positioning strongly net long — consistent with funding demand or dollar squeeze');
    if (eq  === 'bearish') d.push('Equity futures net short signals forced institutional de-risking');
    d.push('Cross-asset de-risking pattern consistent with margin-call or redemption-driven selling');
  }

  if (available < 3) {
    d.push('Note: fewer than 3 asset classes available — regime confidence is limited');
  }

  return d.slice(0, 4);
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Detects the dominant macro risk regime from available multi-asset COT data.
 *
 * @param {{ allBiasArr?: Array, combinedData?: Object, macroSignal?: Object }}
 * @returns {{
 *   regime: string,
 *   confidence: number,
 *   label: string,
 *   color: string,
 *   description: string,
 *   signals: { equities, bonds, gold, oil, usd },
 *   scores: Object,
 *   keyDrivers: string[],
 *   availableSignals: number,
 * }}
 */
export function computeRiskRegime({ allBiasArr = [], combinedData = null, macroSignal = null } = {}) {
  const sp500  = getAssetSignal('SP500',  allBiasArr, combinedData);
  const nas100 = getAssetSignal('NAS100', allBiasArr, combinedData);
  const gold   = getAssetSignal('GOLD',   allBiasArr, combinedData);
  const wti    = getAssetSignal('WTI',    allBiasArr, combinedData);
  const us10y  = getAssetSignal('US10Y',  allBiasArr, combinedData);
  const us2y   = getAssetSignal('US2Y',   allBiasArr, combinedData);
  const dxy    = getAssetSignal('DXY',    allBiasArr, combinedData);

  const eq  = combineEquities(sp500, nas100);
  const bnd = combineBonds(us10y, us2y);
  const gld = gold?.direction ?? null;
  const oil = wti?.direction  ?? null;
  const usd = classifyUSD(macroSignal?.bias, dxy);

  const available = [eq, bnd, gld, oil, usd].filter(Boolean).length;

  const scores = {
    RISK_ON:          scoreRiskOn(eq, bnd, gld, oil, usd),
    RISK_OFF:         scoreRiskOff(eq, bnd, gld, oil, usd),
    STAGFLATION:      scoreStagflation(eq, bnd, gld, oil, usd),
    DISINFLATION:     scoreDisinflation(eq, bnd, gld, oil, usd),
    LIQUIDITY_STRESS: scoreLiquidityStress(eq, bnd, gld, oil, usd),
  };

  const sorted   = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topScore = sorted[0][1];
  const topLabel = sorted[0][0];
  const gap      = topScore - (sorted[1]?.[1] ?? 0);

  let confidence = 0;
  if      (available >= 4 && gap >= 5) confidence = 85;
  else if (available >= 3 && gap >= 4) confidence = 70;
  else if (available >= 3 && gap >= 2) confidence = 55;
  else if (available >= 2 && gap >= 3) confidence = 45;
  else if (available >= 2 && gap >= 1) confidence = 30;
  else if (available >= 1)             confidence = 15;

  const regime = (confidence < 30 || topScore <= 0) ? 'TRANSITIONAL' : topLabel;

  return {
    regime,
    confidence,
    label:            REGIME_LABELS[regime]       ?? 'Transitional',
    color:            REGIME_COLORS[regime]        ?? '#8491a8',
    description:      REGIME_DESCRIPTIONS[regime]  ?? REGIME_DESCRIPTIONS.TRANSITIONAL,
    signals:          { equities: eq, bonds: bnd, gold: gld, oil, usd },
    scores,
    keyDrivers:       buildKeyDrivers(regime, eq, bnd, gld, oil, usd, available),
    availableSignals: available,
  };
}
