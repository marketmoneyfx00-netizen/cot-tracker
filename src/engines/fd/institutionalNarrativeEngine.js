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
  bullish:  'Asset Managers remain net long',
  bearish:  'Asset Managers are rotating short',
  neutral:  'positioning is mixed',
  extreme_long:  'positioning is at extreme long levels',
  extreme_short: 'positioning is at extreme short levels',
};

const EARNINGS_TEMPLATES = {
  BEAT_ACCELERATION:  'earnings momentum is accelerating with consecutive beats',
  STABLE_BEAT:        'earnings quality is solid with consistent beats',
  BEAT_DECELERATION:  'earnings beat streak is showing deceleration',
  MISS_ACCELERATION:  'earnings deterioration is worsening — miss momentum building',
  MISS_RECOVERY:      'earnings showing early recovery signals from recent misses',
  TRANSITION:         'earnings in transition — regime shift likely underway',
  INSUFFICIENT_DATA:  null,
};

const EQUITY_TEMPLATES = {
  bullish: (score) => `equity fundamentals are strong (${score}/100 quality score)`,
  neutral: (score) => `equity fundamentals are mixed (${score}/100 quality score)`,
  bearish: (score) => `equity fundamentals show stress (${score}/100 quality score)`,
};

// ── Divergence detection ──────────────────────────────────────────────────────

function detectDivergences(inputs) {
  const divergences = [];

  const { cotBias, equityIntel, earningsRegime, stressEngine, cryptoLayer, macroContext } = inputs;

  // COT long but equity fundamentals weak
  if (cotBias?.direction === 'bullish' && equityIntel?.compositeScore != null && equityIntel.compositeScore < 40) {
    divergences.push({
      type: 'COT_EQUITY_DIVERGENCE',
      severity: 'HIGH',
      description: `Asset Managers positioned long but equity fundamentals score only ${equityIntel.compositeScore}/100`,
      implication: 'Potential positioning unwind risk as fundamentals erode',
    });
  }

  // Earnings miss acceleration but still long
  if (cotBias?.direction === 'bullish' && earningsRegime?.regime === 'MISS_ACCELERATION') {
    divergences.push({
      type: 'POSITIONING_EARNINGS_DIVERGENCE',
      severity: 'HIGH',
      description: 'Long positioning persists despite accelerating earnings misses',
      implication: 'Earnings momentum will likely pressure positioning adjustment',
    });
  }

  // Balance sheet stress in risk-on environment
  if (stressEngine?.stressScore != null && stressEngine.stressScore > 65 && macroContext?.riskRegime === 'risk_on') {
    divergences.push({
      type: 'STRESS_REGIME_DIVERGENCE',
      severity: 'MEDIUM',
      description: 'Balance sheet stress elevated in risk-on environment',
      implication: 'Credit risk may be underpriced — watch HY spreads',
    });
  }

  // Crypto risk-on but DXY strengthening
  if (cryptoLayer?.riskSignal?.regime === 'RISK_ON' && macroContext?.dxyTrend === 'RISING') {
    divergences.push({
      type: 'CRYPTO_DXY_DIVERGENCE',
      severity: 'MEDIUM',
      description: 'Crypto demand signals risk-on while DXY is strengthening',
      implication: 'Potential crypto-specific demand not aligned with broader risk sentiment',
    });
  }

  // Earnings acceleration but high P/E
  if (earningsRegime?.regime === 'BEAT_ACCELERATION' && equityIntel?.scores?.valuation != null && equityIntel.scores.valuation < 35) {
    divergences.push({
      type: 'GROWTH_VALUATION_DIVERGENCE',
      severity: 'LOW',
      description: 'Strong earnings momentum but elevated valuation multiples',
      implication: 'High bar for continued multiple expansion — execution risk elevated',
    });
  }

  return divergences;
}

// ── Primary narrative builder ─────────────────────────────────────────────────

function buildPrimaryNarrative(inputs) {
  const { cotBias, equityIntel, earningsRegime, stressEngine, cryptoLayer, pair } = inputs;

  const sentences = [];

  // Opening: COT positioning context
  if (cotBias?.direction && pair) {
    const posLabel = POSITIONING[cotBias.direction] ?? POSITIONING.neutral;
    sentences.push(
      `In ${pair}, institutional positioning shows ${posLabel} with a bias score of ${cotBias.score ?? 'N/A'}.`
    );
  }

  // Equity fundamental context
  if (equityIntel?.compositeScore != null) {
    const dir = equityIntel.direction;
    const tmpl = EQUITY_TEMPLATES[dir] ?? EQUITY_TEMPLATES.neutral;
    sentences.push(`Underlying ${tmpl(equityIntel.compositeScore)}`
      + (equityIntel.fundamentals?.revenueGrowth != null
        ? ` with revenue growth at ${fmtPct(equityIntel.fundamentals.revenueGrowth)}.`
        : '.'));
  }

  // Earnings regime
  if (earningsRegime?.regime && earningsRegime.regime !== 'INSUFFICIENT_DATA') {
    const earningsTmpl = EARNINGS_TEMPLATES[earningsRegime.regime];
    if (earningsTmpl) {
      sentences.push(`Corporate ${earningsTmpl}` +
        (earningsRegime.drift?.direction === 'STRONG_POSITIVE'
          ? ' — positive post-earnings drift expected.'
          : earningsRegime.drift?.direction === 'STRONG_NEGATIVE'
          ? ' — elevated downside drift risk.'
          : '.'));
    }
  }

  // Crypto macro signal
  if (cryptoLayer?.riskSignal?.regime) {
    const cRegime = cryptoLayer.riskSignal.regime;
    if (cRegime === 'RISK_ON') {
      sentences.push(`Crypto institutional demand is ${cryptoLayer.institutional?.label?.toLowerCase() ?? 'positive'}, supporting a risk-on backdrop for risk assets.`);
    } else if (cRegime === 'RISK_OFF') {
      sentences.push(`Synchronized crypto and equity selling signals risk-off pressure across asset classes.`);
    }
  }

  // Balance sheet health
  if (stressEngine?.stressScore != null) {
    if (stressEngine.stressScore > 65) {
      sentences.push(`Balance sheet stress is ${stressEngine.level?.label?.toLowerCase() ?? 'elevated'} — heightened credit risk warrants defensive positioning.`);
    } else if (stressEngine.stressScore < 25) {
      sentences.push(`Balance sheet health is strong, providing structural support for the thesis.`);
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
    risks.push({ factor: 'Earnings miss momentum', value: `${earningsRegime.summary?.streak} consecutive misses`, source: 'earnings' });
  }

  if (macroContext?.yieldEnv === 'HIGH') {
    risks.push({ factor: 'High yield environment compresses multiples', value: null, source: 'macro' });
  }

  return risks.slice(0, 5);
}

// ── Positioning summary ───────────────────────────────────────────────────────

function buildPositioningSummary(inputs) {
  const { cotBias, equityIntel, earningsRegime, cryptoLayer } = inputs;

  const signals = [];

  if (cotBias?.direction) {
    signals.push({
      label: 'COT Positioning',
      value: cotBias.direction.toUpperCase(),
      weight: 'HIGH',
      color: cotBias.direction === 'bullish' ? '#22c55e' : cotBias.direction === 'bearish' ? '#ef4444' : '#fbbf24',
    });
  }

  if (equityIntel?.direction) {
    signals.push({
      label: 'Equity Fundamentals',
      value: equityIntel.direction.toUpperCase(),
      weight: 'HIGH',
      color: equityIntel.direction === 'bullish' ? '#22c55e' : equityIntel.direction === 'bearish' ? '#ef4444' : '#fbbf24',
    });
  }

  if (earningsRegime?.regime && earningsRegime.regime !== 'INSUFFICIENT_DATA') {
    signals.push({
      label: 'Earnings Regime',
      value: earningsRegime.label,
      weight: 'MEDIUM',
      color: earningsRegime.color,
    });
  }

  if (cryptoLayer?.riskSignal?.regime) {
    signals.push({
      label: 'Crypto Risk Signal',
      value: cryptoLayer.riskSignal.regime,
      weight: 'LOW',
      color: cryptoLayer.riskSignal.regime === 'RISK_ON' ? '#22c55e' : cryptoLayer.riskSignal.regime === 'RISK_OFF' ? '#ef4444' : '#fbbf24',
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
 * @param {object} inputs - { cotBias, equityIntel, earningsRegime, stressEngine, cryptoLayer, macroContext, pair }
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
