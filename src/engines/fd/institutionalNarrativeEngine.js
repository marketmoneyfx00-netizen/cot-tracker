// =============================================================================
// Institutional Narrative Engine
//
// Generates contextual institutional narrative by connecting:
//   - COT positioning data
//   - Equity intelligence scores
//   - Earnings regime
//   - Balance sheet stress
//   - Crypto macro layer
//   - Macro context (yields, DXY, risk regime)
//
// Output: structured narrative with primary thesis, risk factors, divergences.
// =============================================================================

import { fmtPct } from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Sentence templates ────────────────────────────────────────────────────────

const POSITIONING = {
  bullish:  'los gestores de activos mantienen posición neta larga',
  bearish:  'los gestores de activos están rotando a corto',
  neutral:  'el posicionamiento es mixto',
  extreme_long:  'el posicionamiento está en niveles extremos largos',
  extreme_short: 'el posicionamiento está en niveles extremos cortos',
};

const EARNINGS_TEMPLATES = {
  BEAT_ACCELERATION:  'el momentum de resultados se está acelerando con sorpresas positivas consecutivas',
  STABLE_BEAT:        'la calidad de resultados es sólida con sorpresas positivas consistentes',
  BEAT_DECELERATION:  'la racha de sorpresas positivas muestra desaceleración',
  MISS_ACCELERATION:  'el deterioro de resultados empeora — momentum de decepciones en construcción',
  MISS_RECOVERY:      'los resultados muestran señales tempranas de recuperación tras decepciones recientes',
  TRANSITION:         'los resultados están en transición — probable cambio de régimen en marcha',
  INSUFFICIENT_DATA:  null,
};

const EQUITY_TEMPLATES = {
  bullish: (score) => `los fundamentales de renta variable son sólidos (puntuación de calidad ${score}/100)`,
  neutral: (score) => `los fundamentales de renta variable son mixtos (puntuación de calidad ${score}/100)`,
  bearish: (score) => `los fundamentales de renta variable muestran tensión (puntuación de calidad ${score}/100)`,
};

// ── Divergence detection ──────────────────────────────────────────────────────

function detectDivergences(inputs) {
  const divergences = [];

  const { cotBias, equityIntel, earningsRegime, stressEngine, macroContext } = inputs;

  // COT long but equity fundamentals weak
  if (cotBias?.direction === 'bullish' && equityIntel?.compositeScore != null && equityIntel.compositeScore < 40) {
    divergences.push({
      type: 'COT_EQUITY_DIVERGENCE',
      severity: 'HIGH',
      description: `Gestores de activos posicionados largos pero fundamentales de renta variable puntúan solo ${equityIntel.compositeScore}/100`,
      implication: 'Riesgo potencial de deshacimiento de posición a medida que los fundamentales se erosionan',
    });
  }

  // Earnings miss acceleration but still long
  if (cotBias?.direction === 'bullish' && earningsRegime?.regime === 'MISS_ACCELERATION') {
    divergences.push({
      type: 'POSITIONING_EARNINGS_DIVERGENCE',
      severity: 'HIGH',
      description: 'El posicionamiento largo persiste a pesar de las decepciones de resultados en aceleración',
      implication: 'El momentum de resultados presionará probablemente un ajuste en el posicionamiento',
    });
  }

  // Balance sheet stress in risk-on environment
  if (stressEngine?.stressScore != null && stressEngine.stressScore > 65 && macroContext?.riskRegime === 'risk_on') {
    divergences.push({
      type: 'STRESS_REGIME_DIVERGENCE',
      severity: 'MEDIUM',
      description: 'Estrés de balance elevado en entorno de risk-on',
      implication: 'El riesgo crediticio puede estar infravalorado — vigila los diferenciales HY',
    });
  }

  // Earnings acceleration but high P/E
  if (earningsRegime?.regime === 'BEAT_ACCELERATION' && equityIntel?.scores?.valuation != null && equityIntel.scores.valuation < 35) {
    divergences.push({
      type: 'GROWTH_VALUATION_DIVERGENCE',
      severity: 'LOW',
      description: 'Sólido momentum de resultados pero múltiplos de valoración elevados',
      implication: 'Listón alto para continuar la expansión de múltiplos — riesgo de ejecución elevado',
    });
  }

  return divergences;
}

// ── Primary narrative builder ─────────────────────────────────────────────────

function buildPrimaryNarrative(inputs) {
  const { cotBias, equityIntel, earningsRegime, stressEngine, pair } = inputs;

  const sentences = [];

  // Opening: COT positioning context
  if (cotBias?.direction && pair) {
    const posLabel = POSITIONING[cotBias.direction] ?? POSITIONING.neutral;
    sentences.push(
      `En ${pair}, ${posLabel} con una puntuación de sesgo de ${cotBias.score ?? 'N/D'}.`
    );
  }

  // Equity fundamental context
  if (equityIntel?.compositeScore != null) {
    const dir = equityIntel.direction;
    const tmpl = EQUITY_TEMPLATES[dir] ?? EQUITY_TEMPLATES.neutral;
    sentences.push(`Subyacente: ${tmpl(equityIntel.compositeScore)}`
      + (equityIntel.fundamentals?.revenueGrowth != null
        ? ` con crecimiento de ingresos del ${fmtPct(equityIntel.fundamentals.revenueGrowth)}.`
        : '.'));
  }

  // Earnings regime
  if (earningsRegime?.regime && earningsRegime.regime !== 'INSUFFICIENT_DATA') {
    const earningsTmpl = EARNINGS_TEMPLATES[earningsRegime.regime];
    if (earningsTmpl) {
      sentences.push(`Corporativo: ${earningsTmpl}` +
        (earningsRegime.drift?.direction === 'STRONG_POSITIVE'
          ? ' — se espera deriva positiva post-resultados.'
          : earningsRegime.drift?.direction === 'STRONG_NEGATIVE'
          ? ' — riesgo de deriva bajista elevado.'
          : '.'));
    }
  }

  // Balance sheet health
  if (stressEngine?.stressScore != null) {
    if (stressEngine.stressScore > 65) {
      sentences.push(`El estrés del balance es ${stressEngine.level?.label?.toLowerCase() ?? 'elevado'} — el riesgo crediticio elevado exige posicionamiento defensivo.`);
    } else if (stressEngine.stressScore < 25) {
      sentences.push(`La salud del balance es sólida, proporcionando soporte estructural a la tesis.`);
    }
  }

  return sentences.join(' ');
}

// ── Risk factor extraction ────────────────────────────────────────────────────

function extractRiskFactors(inputs) {
  const { equityIntel, earningsRegime, stressEngine, macroContext } = inputs;
  const risks = [];

  if (equityIntel?.drivers) {
    equityIntel.drivers
      .filter(d => d.signal === 'negative')
      .forEach(d => risks.push({ factor: d.label, value: d.value, source: 'equity' }));
  }

  if (stressEngine?.allFlags?.length) {
    stressEngine.allFlags.slice(0, 2).forEach(f =>
      risks.push({ factor: f, value: null, source: 'balance_sheet' })
    );
  }

  if (earningsRegime?.regime === 'MISS_ACCELERATION') {
    risks.push({ factor: 'Momentum de decepciones en resultados', value: `${earningsRegime.summary?.streak} decepciones consecutivas`, source: 'earnings' });
  }

  if (macroContext?.yieldEnv === 'HIGH') {
    risks.push({ factor: 'Entorno de tipos altos comprime múltiplos', value: null, source: 'macro' });
  }

  return risks.slice(0, 5);
}

// ── Positioning summary ───────────────────────────────────────────────────────

function buildPositioningSummary(inputs) {
  const { cotBias, equityIntel, earningsRegime } = inputs;

  const signals = [];

  if (cotBias?.direction) {
    signals.push({
      label: 'Posicionamiento COT',
      value: cotBias.direction.toUpperCase(),
      weight: 'HIGH',
      color: cotBias.direction === 'bullish' ? '#22c55e' : cotBias.direction === 'bearish' ? '#ef4444' : '#fbbf24',
    });
  }

  if (equityIntel?.direction) {
    signals.push({
      label: 'Fundamentales de Renta Variable',
      value: equityIntel.direction.toUpperCase(),
      weight: 'HIGH',
      color: equityIntel.direction === 'bullish' ? '#22c55e' : equityIntel.direction === 'bearish' ? '#ef4444' : '#fbbf24',
    });
  }

  if (earningsRegime?.regime && earningsRegime.regime !== 'INSUFFICIENT_DATA') {
    signals.push({
      label: 'Régimen de Resultados',
      value: earningsRegime.label,
      weight: 'MEDIUM',
      color: earningsRegime.color,
    });
  }

  const bullishCount = signals.filter(s => ['BULLISH', 'RISK_ON', 'BEAT_ACCELERATION', 'STABLE_BEAT'].includes(s.value)).length;
  const bearishCount = signals.filter(s => ['BEARISH', 'RISK_OFF', 'MISS_ACCELERATION'].includes(s.value)).length;

  const overallAlignment = bullishCount > bearishCount ? 'ALIGNED_BULLISH'
    : bearishCount > bullishCount ? 'ALIGNED_BEARISH'
    : 'MIXED';

  return { signals, overallAlignment, bullishCount, bearishCount };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} inputs - { cotBias, equityIntel, earningsRegime, stressEngine, macroContext, pair }
 * @returns {object} InstitutionalNarrative
 */
export function generateInstitutionalNarrative(inputs) {
  const divergences        = detectDivergences(inputs);
  const primaryNarrative   = buildPrimaryNarrative(inputs);
  const riskFactors        = extractRiskFactors(inputs);
  const positioningSummary = buildPositioningSummary(inputs);

  return {
    primaryNarrative,
    divergences,
    riskFactors,
    positioningSummary,
    hasDivergences:   divergences.length > 0,
    highSeverityRisks: divergences.filter(d => d.severity === 'HIGH').length,
    computedAt: new Date().toISOString(),
  };
}
