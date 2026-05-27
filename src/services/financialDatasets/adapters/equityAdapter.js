// =============================================================================
// Equity Adapter
//
// Transforms a raw /api/fd?type=equity response into the canonical
// EquityBundle used by equityIntelligenceEngine.
// =============================================================================

import {
  normalizeIncomeStatement,
  normalizeBalanceSheet,
  normalizeCashFlow,
  normalizeSnapshot,
} from '../normalizers/fundamentalsNormalizer.js';

export function adaptEquityBundle(raw) {
  if (!raw) return null;

  return {
    ticker:    raw.ticker,
    income:    normalizeIncomeStatement(raw.income),
    balance:   normalizeBalanceSheet(raw.balance),
    cashflow:  normalizeCashFlow(raw.cashflow),
    snapshot:  normalizeSnapshot(raw.snapshot),
    fetchedAt: raw.fetchedAt ?? new Date().toISOString(),
    source:    'financial-datasets',
  };
}

export function adaptSnapshotBundle(snapshotsMap) {
  if (!snapshotsMap) return {};
  const result = {};
  for (const [ticker, raw] of Object.entries(snapshotsMap)) {
    result[ticker] = normalizeSnapshot(raw);
  }
  return result;
}

/** Derive institutional-grade quality tier from equity data */
export function deriveQualityTier(bundle) {
  if (!bundle) return 'UNKNOWN';

  const income  = bundle.income?.ratios;
  const balance = bundle.balance?.ratios;

  if (!income || !balance) return 'INSUFFICIENT_DATA';

  const netMargin = income.netMargin ?? 0;
  const roe       = deriveROE(bundle);
  const debtEq    = balance.debtToEquity ?? 99;
  const currentR  = balance.currentRatio ?? 0;
  const revGrowth = income.revenueGrowthYoY ?? 0;

  let score = 0;
  if (netMargin > 20)   score += 2;
  else if (netMargin > 10) score += 1;
  if (roe != null && roe > 20) score += 2;
  else if (roe != null && roe > 10) score += 1;
  if (debtEq < 0.5) score += 2;
  else if (debtEq < 1.5) score += 1;
  if (currentR > 2) score += 1;
  if (revGrowth > 15) score += 2;
  else if (revGrowth > 5) score += 1;

  if (score >= 8)  return 'TIER_1';
  if (score >= 5)  return 'TIER_2';
  if (score >= 2)  return 'TIER_3';
  return 'SPECULATIVE';
}

function deriveROE(bundle) {
  const netIncome   = bundle.income?.latest?.netIncome;
  const totalEquity = bundle.balance?.latest?.totalEquity;
  if (netIncome == null || totalEquity == null || totalEquity === 0) return null;
  return (netIncome / Math.abs(totalEquity)) * 100;
}
