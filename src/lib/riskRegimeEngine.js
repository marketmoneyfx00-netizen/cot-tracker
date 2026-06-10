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
  RISK_ON:          'Expansión Risk-On',
  RISK_OFF:         'Risk-Off / Defensivo',
  STAGFLATION:      'Presión Estanflacionaria',
  DISINFLATION:     'Reajuste Desinflacionario',
  LIQUIDITY_STRESS: 'Estrés de Liquidez',
  TRANSITIONAL:     'Transición / Mixto',
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
    'Los flujos institucionales reflejan una postura risk-on: el posicionamiento en renta variable ' +
    'está comprado, la presión vendedora en bonos indica mayor tolerancia al rendimiento y el ' +
    'posicionamiento en materias primas por el lado de la demanda respalda la narrativa de crecimiento.',
  RISK_OFF:
    'El posicionamiento multi-activo refleja un comportamiento institucional defensivo: la exposición ' +
    'a renta variable se está reduciendo, la renta fija absorbe la demanda de refugio seguro y el ' +
    'posicionamiento en oro refuerza la señal de aversión al riesgo.',
  STAGFLATION:
    'El posicionamiento es coherente con un entorno estanflacionario: la presión vendedora en bonos ' +
    'implica una prima de inflación creciente en los rendimientos, mientras que la acumulación ' +
    'simultánea de energía y oro refleja inflación de costes con deterioro del crecimiento.',
  DISINFLATION:
    'El posicionamiento institucional refleja un régimen desinflacionario: la renta fija está comprada ' +
    '(expectativas de tipos a la baja), el posicionamiento en energía es débil y la estructura de ' +
    'demanda sugiere moderación del crecimiento sin presión inflacionaria aguda.',
  LIQUIDITY_STRESS:
    'El posicionamiento multi-activo señala estrés de liquidez agudo: reducción de riesgo forzada ' +
    'en todas las clases de activos con la demanda de USD elevada — coherente con dinámicas de ' +
    'margin call o presión sistémica de financiación.',
  TRANSITIONAL:
    'El posicionamiento COT multi-activo aún no establece un régimen macro dominante. Las señales ' +
    'son mixtas o insuficientes para clasificar con confianza. Monitorizar convergencia direccional ' +
    'en renta variable, bonos y mercados de materias primas.',
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
    if (eq  === 'bullish') d.push('Leveraged Money construyendo exposición neta larga en futuros de índices');
    if (bnd === 'bearish') d.push('Futuros de bonos neto corto — mayor tolerancia al rendimiento coherente con optimismo de crecimiento');
    if (oil === 'bullish') d.push('Posicionamiento en energía refleja confianza en la demanda');
    if (usd === 'bearish') d.push('Debilidad del dólar respalda flujos hacia activos de riesgo');
  } else if (regime === 'RISK_OFF') {
    if (eq  === 'bearish') d.push('Exposición institucional en renta variable deteriorándose o neta corta');
    if (bnd === 'bullish') d.push('Renta fija absorbiendo demanda de refugio seguro — posicionamiento neto largo elevado');
    if (gld === 'bullish') d.push('Acumulación de oro confirma demanda de refugio por parte de Leveraged Money');
    if (usd === 'bullish') d.push('Posicionamiento en dólar refleja concentración defensiva de capital');
  } else if (regime === 'STAGFLATION') {
    if (bnd === 'bearish') d.push('Presión vendedora en bonos señala prima de inflación creciente en la curva de rendimientos');
    if (gld === 'bullish') d.push('Acumulación institucional de oro coherente con posicionamiento en cobertura de inflación');
    if (oil === 'bullish') d.push('Largos netos en energía reflejan expectativas de inflación de costes por el lado de la oferta');
    if (eq  === 'bearish') d.push('Venta de renta variable coherente con compresión de márgenes en condiciones estanflacionarias');
  } else if (regime === 'DISINFLATION') {
    if (bnd === 'bullish') d.push('Compra de bonos señala expectativa institucional de rendimientos a la baja');
    if (oil === 'bearish') d.push('Cortos netos en energía reflejan debilidad de demanda y presión deflacionaria en materias primas');
    if (gld === 'bearish') d.push('Posicionamiento en oro implica reducción de prima de inflación en carteras institucionales');
  } else if (regime === 'LIQUIDITY_STRESS') {
    if (usd === 'bullish') d.push('Posicionamiento en dólar fuertemente neto largo — coherente con demanda de financiación o squeeze del USD');
    if (eq  === 'bearish') d.push('Futuros de renta variable neto corto señala reducción de riesgo institucional forzada');
    d.push('Patrón de reducción de riesgo multi-activo coherente con ventas forzadas por margin call o redenciones');
  }

  if (available < 3) {
    d.push('Nota: menos de 3 clases de activos disponibles — confianza en el régimen limitada');
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
