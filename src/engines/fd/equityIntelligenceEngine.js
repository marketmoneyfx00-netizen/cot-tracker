// =============================================================================
// Equity Intelligence Engine
//
// Scores an equity on institutional quality from Financial Datasets data.
// Output: score 0-100, tier, direction, key drivers, narrative.
//
// Pure stateless function — no side effects.
// =============================================================================

import { clamp, weightedAvg, scoreLabel, directionLabel, convictionLabel, fmtPct, fmtLarge }
  from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Sector benchmarks (institutional consensus averages) ──────────────────────
const SECTOR_BENCHMARKS = {
  default:    { netMargin: 10, roe: 15, debtEq: 1.0, revGrowth: 8,  grossMargin: 35 },
  tech:       { netMargin: 20, roe: 25, debtEq: 0.5, revGrowth: 15, grossMargin: 60 },
  financials: { netMargin: 20, roe: 12, debtEq: 8.0, revGrowth: 5,  grossMargin: 50 },
  healthcare: { netMargin: 12, roe: 18, debtEq: 0.8, revGrowth: 8,  grossMargin: 55 },
  energy:     { netMargin: 8,  roe: 10, debtEq: 1.5, revGrowth: 5,  grossMargin: 25 },
  consumer:   { netMargin: 6,  roe: 20, debtEq: 1.2, revGrowth: 5,  grossMargin: 30 },
  industrials:{ netMargin: 8,  roe: 15, debtEq: 1.0, revGrowth: 6,  grossMargin: 30 },
  realestate: { netMargin: 20, roe: 8,  debtEq: 2.0, revGrowth: 5,  grossMargin: 65 },
};

function getBenchmark(sector) {
  const key = (sector ?? '').toLowerCase();
  for (const [k, v] of Object.entries(SECTOR_BENCHMARKS)) {
    if (k !== 'default' && key.includes(k)) return v;
  }
  return SECTOR_BENCHMARKS.default;
}

// ── Sub-scorers (each returns 0-100) ─────────────────────────────────────────

function scoreProfitability(income, bench) {
  if (!income?.ratios) return null;
  const { netMargin, grossMargin, operatingMargin, ebitdaMargin } = income.ratios;

  const items = [
    netMargin     != null ? { value: scoreVsBench(netMargin,     bench.netMargin,   40), weight: 0.35 } : null,
    grossMargin   != null ? { value: scoreVsBench(grossMargin,   bench.grossMargin, 60), weight: 0.25 } : null,
    operatingMargin != null ? { value: scoreVsBench(operatingMargin, bench.netMargin * 1.5, 30), weight: 0.25 } : null,
    ebitdaMargin  != null ? { value: clamp((ebitdaMargin / 35) * 60 + 20, 0, 100), weight: 0.15 } : null,
  ].filter(Boolean);

  return items.length ? weightedAvg(items) : null;
}

function scoreGrowth(income, bench) {
  if (!income?.ratios) return null;
  const { revenueGrowthYoY, netIncomeGrowthYoY, epsGrowthYoY } = income.ratios;

  const items = [
    revenueGrowthYoY  != null ? { value: scoreGrowthRate(revenueGrowthYoY,  bench.revGrowth), weight: 0.40 } : null,
    netIncomeGrowthYoY != null ? { value: scoreGrowthRate(netIncomeGrowthYoY, bench.revGrowth * 1.2), weight: 0.35 } : null,
    epsGrowthYoY      != null ? { value: scoreGrowthRate(epsGrowthYoY,       bench.revGrowth * 1.2), weight: 0.25 } : null,
  ].filter(Boolean);

  return items.length ? weightedAvg(items) : null;
}

function scoreFinancialHealth(balance, cashflow) {
  if (!balance?.ratios) return null;
  const { currentRatio, debtToEquity, cashToDebt } = balance.ratios;

  const items = [
    currentRatio  != null ? { value: scoreCurrentRatio(currentRatio),  weight: 0.30 } : null,
    debtToEquity  != null ? { value: scoreDebtEq(debtToEquity),        weight: 0.35 } : null,
    cashToDebt    != null ? { value: clamp(cashToDebt * 50, 0, 100),   weight: 0.20 } : null,
  ];

  if (cashflow?.ratios) {
    if (cashflow.ratios.fcfTrend != null) {
      items.push({ value: scoreGrowthRate(cashflow.ratios.fcfTrend, 10), weight: 0.15 });
    }
  }

  return weightedAvg(items.filter(Boolean));
}

function scoreValuation(snapshot) {
  if (!snapshot) return null;
  const { pe, forwardPe, dividendYield } = snapshot;

  const items = [
    pe        != null && pe > 0 ? { value: scorePE(pe),     weight: 0.40 } : null,
    forwardPe != null && forwardPe > 0 ? { value: scorePE(forwardPe) * 1.1, weight: 0.40 } : null,
    dividendYield != null ? { value: clamp(dividendYield * 10, 0, 30) + 50, weight: 0.20 } : null,
  ].filter(Boolean);

  return items.length ? clamp(weightedAvg(items), 0, 100) : null;
}

function scoreCapitalReturns(cashflow) {
  if (!cashflow?.latest) return null;
  const { dividendsPaid, buybacks, operatingCF } = cashflow.latest;
  if (operatingCF == null || operatingCF <= 0) return null;

  const totalReturn = (dividendsPaid ?? 0) + (buybacks ?? 0);
  const payoutRatio = totalReturn / operatingCF;

  if (payoutRatio < 0)    return 20;
  if (payoutRatio < 0.3)  return 60;
  if (payoutRatio < 0.7)  return 80;
  if (payoutRatio < 1.0)  return 65;
  return 40; // over-returning cash (potentially unsustainable)
}

// ── Helper scorers ────────────────────────────────────────────────────────────

function scoreVsBench(value, benchmark, spread) {
  const delta = value - benchmark;
  return clamp(50 + (delta / spread) * 30, 0, 100);
}

function scoreGrowthRate(growth, benchGrowth) {
  if (growth >= benchGrowth * 2) return 95;
  if (growth >= benchGrowth)     return 75;
  if (growth >= 0)               return 50;
  if (growth >= -10)             return 30;
  return 10;
}

function scoreCurrentRatio(ratio) {
  if (ratio >= 3)   return 75;
  if (ratio >= 2)   return 90;
  if (ratio >= 1.5) return 80;
  if (ratio >= 1)   return 60;
  if (ratio >= 0.8) return 35;
  return 10;
}

function scoreDebtEq(de) {
  if (de < 0)    return 40; // negative equity (can be okay in financials)
  if (de < 0.25) return 90;
  if (de < 0.5)  return 80;
  if (de < 1.0)  return 70;
  if (de < 2.0)  return 50;
  if (de < 4.0)  return 30;
  return 10;
}

function scorePE(pe) {
  if (pe < 0)   return 20; // negative earnings
  if (pe < 10)  return 85; // cheap
  if (pe < 20)  return 75; // fair value
  if (pe < 30)  return 60; // growth premium
  if (pe < 50)  return 40; // expensive
  if (pe < 100) return 25; // speculative
  return 10;               // bubble territory
}

// ── Key drivers extraction ────────────────────────────────────────────────────

function extractDrivers(bundle, scores, bench) {
  const drivers = [];
  const { income, balance, snapshot } = bundle;

  if (scores.profitability != null) {
    const m = income?.ratios?.netMargin;
    if (m != null) {
      if (m > bench.netMargin * 1.5) drivers.push({ label: 'Margin expansion', signal: 'positive', value: fmtPct(m) });
      else if (m < bench.netMargin * 0.5) drivers.push({ label: 'Margin compression', signal: 'negative', value: fmtPct(m) });
    }
  }

  if (scores.growth != null) {
    const g = income?.ratios?.revenueGrowthYoY;
    if (g != null) {
      if (g > bench.revGrowth * 1.5) drivers.push({ label: 'Accelerating revenue', signal: 'positive', value: fmtPct(g) });
      else if (g < 0) drivers.push({ label: 'Revenue decline', signal: 'negative', value: fmtPct(g) });
    }
  }

  if (scores.financialHealth != null) {
    const de = balance?.ratios?.debtToEquity;
    if (de != null && de > 2) drivers.push({ label: 'High leverage', signal: 'negative', value: `${de.toFixed(1)}x` });
    const cr = balance?.ratios?.currentRatio;
    if (cr != null && cr < 1) drivers.push({ label: 'Liquidity stress', signal: 'negative', value: `${cr.toFixed(2)}x` });
  }

  if (snapshot?.changePercent != null && Math.abs(snapshot.changePercent) > 3) {
    drivers.push({
      label: snapshot.changePercent > 0 ? 'Positive momentum' : 'Selling pressure',
      signal: snapshot.changePercent > 0 ? 'positive' : 'negative',
      value: fmtPct(snapshot.changePercent),
    });
  }

  return drivers.slice(0, 5);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} bundle - adaptEquityBundle output
 * @param {string} sector - optional sector hint
 * @returns {object} EquityIntelResult
 */
export function computeEquityIntelligence(bundle, sector = null) {
  if (!bundle) return null;

  const bench = getBenchmark(sector);
  const { income, balance, cashflow, snapshot } = bundle;

  const rawScores = {
    profitability:  scoreProfitability(income, bench),
    growth:         scoreGrowth(income, bench),
    financialHealth:scoreFinancialHealth(balance, cashflow, income),
    valuation:      scoreValuation(snapshot),
    capitalReturns: scoreCapitalReturns(cashflow),
  };

  const items = [
    rawScores.profitability  != null ? { value: rawScores.profitability,   weight: 0.25 } : null,
    rawScores.growth         != null ? { value: rawScores.growth,          weight: 0.30 } : null,
    rawScores.financialHealth != null ? { value: rawScores.financialHealth, weight: 0.25 } : null,
    rawScores.valuation      != null ? { value: rawScores.valuation,       weight: 0.15 } : null,
    rawScores.capitalReturns != null ? { value: rawScores.capitalReturns,  weight: 0.05 } : null,
  ].filter(Boolean);

  const compositeScore = items.length ? clamp(Math.round(weightedAvg(items)), 0, 100) : null;

  const drivers = extractDrivers(bundle, rawScores, bench);

  return {
    ticker:          bundle.ticker,
    compositeScore,
    direction:       compositeScore != null ? directionLabel(compositeScore) : 'neutral',
    conviction:      compositeScore != null ? convictionLabel(compositeScore) : 'LOW',
    label:           compositeScore != null ? scoreLabel(compositeScore) : 'Insufficient Data',
    scores:          rawScores,
    drivers,
    snapshot: snapshot ? {
      price:     snapshot.price,
      change:    fmtPct(snapshot.changePercent),
      marketCap: fmtLarge(snapshot.marketCap),
      pe:        snapshot.pe?.toFixed(1) ?? 'N/A',
      forwardPe: snapshot.forwardPe?.toFixed(1) ?? 'N/A',
    } : null,
    fundamentals: {
      netMargin:        income?.ratios?.netMargin,
      revenueGrowth:    income?.ratios?.revenueGrowthYoY,
      debtToEquity:     balance?.ratios?.debtToEquity,
      currentRatio:     balance?.ratios?.currentRatio,
      freeCashFlow:     cashflow?.latest?.freeCashFlow,
    },
    sector,
    benchmark: bench,
    computedAt: new Date().toISOString(),
  };
}
