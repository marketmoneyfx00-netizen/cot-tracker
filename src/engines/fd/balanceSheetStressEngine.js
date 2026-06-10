// =============================================================================
// Balance Sheet Stress Engine
//
// Detects financial deterioration, liquidity stress, and solvency risk.
// Input: normalizedBalanceSheet + normalizeCashFlow + macroContext
// Output: stress score (0-100 where 100=extreme stress), risk flags, narrative.
// =============================================================================

import { clamp, weightedAvg }
  from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Stress level classification ───────────────────────────────────────────────

const STRESS_LEVELS = {
  CRITICAL:    { min: 80, label: 'Estrés Crítico',    color: '#dc2626', emoji: '🔴' },
  HIGH:        { min: 65, label: 'Estrés Alto',        color: '#ef4444', emoji: '🟠' },
  ELEVATED:    { min: 50, label: 'Riesgo Elevado',     color: '#f97316', emoji: '🟡' },
  MODERATE:    { min: 35, label: 'Riesgo Moderado',    color: '#fbbf24', emoji: '🟡' },
  LOW:         { min: 15, label: 'Riesgo Bajo',        color: '#4ade80', emoji: '🟢' },
  NEGLIGIBLE:  { min: 0,  label: 'Riesgo Negligible',  color: '#22c55e', emoji: '🟢' },
};

function stressLevel(score) {
  for (const [key, meta] of Object.entries(STRESS_LEVELS)) {
    if (score >= meta.min) return { key, ...meta };
  }
  return { key: 'NEGLIGIBLE', ...STRESS_LEVELS.NEGLIGIBLE };
}

// ── Sub-scorers (each returns stress 0-100, where 100 = maximum stress) ──────

function liquidityStress(balance) {
  if (!balance?.ratios) return { score: null, flags: [] };
  const { currentRatio, cashToDebt } = balance.ratios;
  const flags = [];

  let score = 50; // neutral baseline

  if (currentRatio != null) {
    if (currentRatio < 0.8)  { score = 90; flags.push('Critical liquidity: current ratio < 0.8'); }
    else if (currentRatio < 1)   { score = 75; flags.push('Liquidity below 1.0 — potential cash crunch'); }
    else if (currentRatio < 1.5) { score = 50; }
    else if (currentRatio >= 2)  { score = 20; }
    else score = 35;
  }

  if (cashToDebt != null && cashToDebt < 0.05) {
    score = Math.max(score, 70);
    flags.push('Minimal cash vs debt — refinancing risk');
  }

  return { score, flags };
}

function solvencyStress(balance) {
  if (!balance?.ratios) return { score: null, flags: [] };
  const { debtToEquity, debtToAssets } = balance.ratios;
  const flags = [];
  const items = [];

  if (debtToEquity != null) {
    const de = debtToEquity;
    if (de > 5)   { items.push(90); flags.push(`Extreme leverage: D/E ${de.toFixed(1)}x`); }
    else if (de > 3)   items.push(75);
    else if (de > 2)   items.push(60);
    else if (de > 1)   items.push(40);
    else if (de > 0.5) items.push(25);
    else               items.push(10);
  }

  if (debtToAssets != null) {
    const da = debtToAssets;
    if (da > 0.8) { items.push(85); flags.push(`Debt > 80% of assets`); }
    else if (da > 0.6) items.push(65);
    else if (da > 0.4) items.push(40);
    else               items.push(20);
  }

  if (balance.sheets?.length >= 2) {
    const debtTrend = balance.ratios.debtTrend;
    if (debtTrend != null && debtTrend > 30) {
      flags.push(`Rapid debt build-up: ${debtTrend.toFixed(0)}% YoY increase`);
    }
  }

  const score = items.length ? items.reduce((s, v) => s + v, 0) / items.length : null;
  return { score, flags };
}

function cashFlowStress(cashflow) {
  if (!cashflow?.latest) return { score: null, flags: [] };
  const { operatingCF, freeCashFlow } = cashflow.latest;
  const flags = [];
  const items = [];

  if (operatingCF != null) {
    if (operatingCF < 0) {
      items.push(85); flags.push('Negative operating cash flow — burning cash');
    } else {
      items.push(20);
    }
  }

  if (freeCashFlow != null) {
    if (freeCashFlow < 0) {
      items.push(70); flags.push('Negative free cash flow');
    } else {
      items.push(15);
    }
  }

  if (cashflow.ratios?.fcfTrend != null && cashflow.ratios.fcfTrend < -30) {
    flags.push('FCF deterioration > 30% YoY');
    items.push(65);
  }

  const score = items.length ? items.reduce((s, v) => s + v, 0) / items.length : null;
  return { score, flags };
}

function earningsInstabilityStress(income) {
  if (!income?.ratios) return { score: null, flags: [] };
  const { netIncomeGrowthYoY, operatingMargin } = income.ratios;
  const flags = [];
  let score = 30; // default low stress

  if (netIncomeGrowthYoY != null && netIncomeGrowthYoY < -30) {
    score = 75;
    flags.push(`Earnings collapse: ${netIncomeGrowthYoY.toFixed(0)}% YoY`);
  } else if (netIncomeGrowthYoY != null && netIncomeGrowthYoY < -15) {
    score = 55;
    flags.push('Significant earnings decline');
  }

  if (operatingMargin != null && operatingMargin < 0) {
    score = Math.max(score, 80);
    flags.push('Negative operating margin');
  }

  return { score, flags };
}

// ── Trend analysis (deterioration vs improvement) ─────────────────────────────

function analyzeTrend(balance) {
  if (!balance?.sheets?.length || balance.sheets.length < 2) return null;

  const current = balance.sheets[0];
  const prior   = balance.sheets[1];

  const cashChange = prior.cash > 0
    ? ((current.cash ?? 0) - prior.cash) / prior.cash * 100
    : null;
  const debtChange = prior.totalDebt > 0
    ? ((current.totalDebt ?? 0) - prior.totalDebt) / prior.totalDebt * 100
    : null;
  const equityChange = prior.totalEquity != null && prior.totalEquity !== 0
    ? ((current.totalEquity ?? 0) - prior.totalEquity) / Math.abs(prior.totalEquity) * 100
    : null;

  const signals = [];
  if (cashChange != null && cashChange < -20) signals.push({ label: 'Quema de caja', severity: 'negative' });
  if (debtChange != null && debtChange > 20)  signals.push({ label: 'Aumento de deuda', severity: 'negative' });
  if (equityChange != null && equityChange < -10) signals.push({ label: 'Erosión de capital', severity: 'negative' });
  if (cashChange != null && cashChange > 20)  signals.push({ label: 'Acumulación de caja', severity: 'positive' });
  if (debtChange != null && debtChange < -10) signals.push({ label: 'Reducción de deuda', severity: 'positive' });

  const direction = signals.filter(s => s.severity === 'negative').length > signals.filter(s => s.severity === 'positive').length
    ? 'DETERIORATING' : signals.length === 0 ? 'STABLE' : 'IMPROVING';

  return { signals, direction, cashChange, debtChange, equityChange };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} normalizedBalance   - from normalizeBalanceSheet()
 * @param {object} normalizedCashflow  - from normalizeCashFlow()
 * @param {object} normalizedIncome    - from normalizeIncomeStatement()
 * @param {object} macroContext        - { riskRegime, interestRateEnv } optional
 */
export function computeBalanceSheetStress(
  normalizedBalance,
  normalizedCashflow,
  normalizedIncome,
  macroContext = {}
) {
  const liquidity    = liquidityStress(normalizedBalance);
  const solvency     = solvencyStress(normalizedBalance);
  const cashflowS    = cashFlowStress(normalizedCashflow);
  const earnings     = earningsInstabilityStress(normalizedIncome);

  const items = [
    liquidity.score  != null ? { value: liquidity.score,  weight: 0.30 } : null,
    solvency.score   != null ? { value: solvency.score,   weight: 0.35 } : null,
    cashflowS.score  != null ? { value: cashflowS.score,  weight: 0.25 } : null,
    earnings.score   != null ? { value: earnings.score,   weight: 0.10 } : null,
  ].filter(Boolean);

  let compositeStress = items.length ? weightedAvg(items) : null;

  // Macro amplification: high interest rate env amplifies debt stress
  if (macroContext.interestRateEnv === 'HIGH' && compositeStress != null) {
    compositeStress = clamp(compositeStress * 1.15, 0, 100);
  }
  if (macroContext.riskRegime === 'risk_off' && compositeStress != null) {
    compositeStress = clamp(compositeStress * 1.10, 0, 100);
  }

  const stressScore  = compositeStress != null ? Math.round(compositeStress) : null;
  const level        = stressScore != null ? stressLevel(stressScore) : null;
  const trend        = analyzeTrend(normalizedBalance);

  const allFlags = [
    ...liquidity.flags,
    ...solvency.flags,
    ...cashflowS.flags,
    ...earnings.flags,
  ];

  return {
    stressScore,
    level,
    trend,
    components: {
      liquidity:    { score: liquidity.score,  flags: liquidity.flags  },
      solvency:     { score: solvency.score,   flags: solvency.flags   },
      cashflow:     { score: cashflowS.score,  flags: cashflowS.flags  },
      earnings:     { score: earnings.score,   flags: earnings.flags   },
    },
    allFlags,
    highPriority: allFlags.filter(f => typeof f === 'string' && f.includes(':')),
    macroAdjusted: macroContext.interestRateEnv === 'HIGH' || macroContext.riskRegime === 'risk_off',
    computedAt: new Date().toISOString(),
  };
}
