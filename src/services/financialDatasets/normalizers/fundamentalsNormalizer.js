// =============================================================================
// Fundamentals Normalizer
//
// Converts raw Financial Datasets API responses into consistent
// institutional-grade data structures used by the engines.
// All functions are stateless pure transformations.
// =============================================================================

// ── Utility ───────────────────────────────────────────────────────────────────

function safeDiv(a, b) {
  if (b === 0 || b == null || a == null) return null;
  return a / b;
}

function yoyGrowth(current, prior) {
  if (prior == null || prior === 0 || current == null) return null;
  return (current - prior) / Math.abs(prior);
}

function pct(value) {
  return value != null ? Math.round(value * 10000) / 100 : null; // as percentage
}

function round2(v) {
  return v != null ? Math.round(v * 100) / 100 : null;
}

// ── Income Statement ──────────────────────────────────────────────────────────

export function normalizeIncomeStatement(raw) {
  if (!raw?.income_statements?.length) return null;

  const stmts = raw.income_statements
    .map(s => ({
      period:           s.period_of_report ?? s.date,
      revenue:          s.revenue ?? s.total_revenue,
      grossProfit:      s.gross_profit,
      operatingIncome:  s.operating_income,
      netIncome:        s.net_income,
      eps:              s.earnings_per_share ?? s.eps_basic,
      epsD:             s.eps_diluted,
      ebitda:           s.ebitda,
      interestExpense:  s.interest_expense,
      taxExpense:       s.income_tax_expense,
      sharesBasic:      s.shares_outstanding ?? s.basic_shares_outstanding,
      sharesDiluted:    s.diluted_shares_outstanding,
    }))
    .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));

  if (stmts.length < 2) return { statements: stmts, ratios: null };

  const cur  = stmts[0];
  const prev = stmts[1];

  const ratios = {
    grossMargin:     pct(safeDiv(cur.grossProfit, cur.revenue)),
    operatingMargin: pct(safeDiv(cur.operatingIncome, cur.revenue)),
    netMargin:       pct(safeDiv(cur.netIncome, cur.revenue)),
    ebitdaMargin:    pct(safeDiv(cur.ebitda, cur.revenue)),
    revenueGrowthYoY:  pct(yoyGrowth(cur.revenue, prev.revenue)),
    netIncomeGrowthYoY: pct(yoyGrowth(cur.netIncome, prev.netIncome)),
    epsGrowthYoY:    pct(yoyGrowth(cur.eps, prev.eps)),
  };

  return { statements: stmts, ratios, latest: cur };
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

export function normalizeBalanceSheet(raw) {
  if (!raw?.balance_sheets?.length) return null;

  const sheets = raw.balance_sheets
    .map(s => ({
      period:          s.period_of_report ?? s.date,
      cash:            s.cash_and_cash_equivalents ?? s.cash,
      totalAssets:     s.total_assets,
      totalLiabilities:s.total_liabilities,
      currentAssets:   s.current_assets,
      currentLiabilities: s.current_liabilities,
      totalEquity:     s.total_stockholders_equity ?? s.total_equity,
      longTermDebt:    s.long_term_debt,
      totalDebt:       s.total_debt ?? (s.long_term_debt ?? 0) + (s.short_term_debt ?? 0),
      goodwill:        s.goodwill,
      inventory:       s.inventory,
      accountsReceivable: s.accounts_receivable,
    }))
    .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));

  if (sheets.length === 0) return null;
  const sheets_ref = sheets;

  const cur  = sheets_ref[0];
  const prev = sheets_ref[1] ?? null;

  const ratios = {
    currentRatio:     round2(safeDiv(cur.currentAssets, cur.currentLiabilities)),
    debtToEquity:     round2(safeDiv(cur.totalDebt, cur.totalEquity)),
    debtToAssets:     round2(safeDiv(cur.totalDebt, cur.totalAssets)),
    cashToDebt:       round2(safeDiv(cur.cash, cur.totalDebt)),
    equityMultiplier: round2(safeDiv(cur.totalAssets, cur.totalEquity)),
    // Trend
    debtTrend:        prev ? pct(yoyGrowth(cur.totalDebt, prev.totalDebt)) : null,
    cashTrend:        prev ? pct(yoyGrowth(cur.cash, prev.cash)) : null,
  };

  return { sheets: sheets_ref, ratios, latest: cur };
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────

export function normalizeCashFlow(raw) {
  if (!raw?.cash_flow_statements?.length) return null;

  const flows = raw.cash_flow_statements
    .map(s => ({
      period:          s.period_of_report ?? s.date,
      operatingCF:     s.net_cash_provided_by_operating_activities ?? s.operating_cash_flow,
      capex:           Math.abs(s.capital_expenditures ?? s.capex ?? 0),
      freeCashFlow:    s.free_cash_flow,
      dividendsPaid:   Math.abs(s.dividends_paid ?? 0),
      buybacks:        Math.abs(s.repurchases_of_stock ?? s.share_repurchases ?? 0),
      investingCF:     s.net_cash_used_for_investing_activities ?? s.investing_cash_flow,
      financingCF:     s.net_cash_used_for_financing_activities ?? s.financing_cash_flow,
    }))
    .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));

  if (flows.length === 0) return null;
  const cur  = flows[0];

  // Compute FCF if not provided
  if (cur.freeCashFlow == null && cur.operatingCF != null) {
    cur.freeCashFlow = cur.operatingCF - (cur.capex ?? 0);
  }

  const ratios = {
    capexIntensity: null, // requires revenue from income stmt
    fcfTrend: flows.length > 1 ? pct(yoyGrowth(cur.freeCashFlow, flows[1].freeCashFlow)) : null,
    operatingCFTrend: flows.length > 1 ? pct(yoyGrowth(cur.operatingCF, flows[1].operatingCF)) : null,
  };

  return { flows, ratios, latest: cur };
}

// ── Price Snapshot ────────────────────────────────────────────────────────────

export function normalizeSnapshot(raw) {
  if (!raw) return null;
  const p = raw.price ?? raw.snapshot ?? raw;
  return {
    ticker:       p.ticker,
    price:        p.price ?? p.close,
    open:         p.open,
    high:         p.high,
    low:          p.low,
    volume:       p.volume,
    marketCap:    p.market_cap,
    pe:           p.pe_ratio ?? p.pe,
    forwardPe:    p.forward_pe,
    eps:          p.eps,
    dividendYield:p.dividend_yield,
    fiftyTwoWeekHigh: p.fifty_two_week_high ?? p['52_week_high'],
    fiftyTwoWeekLow:  p.fifty_two_week_low  ?? p['52_week_low'],
    changePercent:    p.change_percent ?? p.percent_change,
    fetchedAt:    new Date().toISOString(),
  };
}

// ── Earnings ──────────────────────────────────────────────────────────────────

export function normalizeEarnings(raw) {
  if (!raw?.earnings?.length) return null;

  const earnings = raw.earnings
    .map(e => ({
      period:       e.period_of_report ?? e.period ?? e.date,
      epsActual:    e.eps_actual ?? e.actual_eps,
      epsEstimate:  e.eps_estimate ?? e.estimated_eps,
      epsSurprise:  e.eps_surprise ?? e.surprise,
      epsSurprisePct: e.eps_surprise_percent ?? e.surprise_percent,
      revenueActual: e.revenue_actual ?? e.revenue,
      revenueEstimate: e.revenue_estimate,
      revenueSurprise: e.revenue_surprise,
      revenueSurprisePct: e.revenue_surprise_percent,
    }))
    .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));

  // Derived metrics
  const beats = earnings.filter(e => (e.epsSurprisePct ?? e.epsSurprise ?? 0) > 0);
  const misses = earnings.filter(e => (e.epsSurprisePct ?? e.epsSurprise ?? 0) < 0);

  const avgSurprise = earnings.reduce((sum, e) => sum + (e.epsSurprisePct ?? 0), 0) / (earnings.length || 1);
  const beatRate    = beats.length / (earnings.length || 1);

  // Revision trend: last quarter surprise minus average of 4 prior
  const last  = earnings[0];
  const prior = earnings.slice(1, 5);
  const priorAvgSurprise = prior.reduce((s, e) => s + (e.epsSurprisePct ?? 0), 0) / (prior.length || 1);
  const revisionMomentum = last ? (last.epsSurprisePct ?? 0) - priorAvgSurprise : 0;

  return {
    earnings,
    summary: {
      count:            earnings.length,
      beatCount:        beats.length,
      missCount:        misses.length,
      beatRate:         round2(beatRate),
      avgSurprisePct:   round2(avgSurprise),
      revisionMomentum: round2(revisionMomentum),
      streak:           computeStreak(earnings),
    },
    latest: last ?? null,
  };
}

function computeStreak(earnings) {
  if (earnings.length === 0) return 0;
  const sign = (earnings[0].epsSurprisePct ?? 0) >= 0 ? 1 : -1;
  let count = 0;
  for (const e of earnings) {
    const s = (e.epsSurprisePct ?? 0) >= 0 ? 1 : -1;
    if (s !== sign) break;
    count++;
  }
  return sign * count; // positive = beat streak, negative = miss streak
}

// ── Historical prices ─────────────────────────────────────────────────────────

export function normalizePriceHistory(raw) {
  if (!raw?.prices?.length) return null;

  const prices = raw.prices
    .map(p => ({
      date:   p.time ?? p.date ?? p.datetime,
      open:   parseFloat(p.open),
      high:   parseFloat(p.high),
      low:    parseFloat(p.low),
      close:  parseFloat(p.close),
      volume: parseInt(p.volume ?? 0, 10),
    }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  if (prices.length < 2) return { prices, returns: [] };

  const returns = prices.slice(1).map((p, i) => ({
    date:   p.date,
    return: safeDiv(p.close - prices[i].close, prices[i].close),
  }));

  const closes  = prices.map(p => p.close);
  const mu      = closes.reduce((s, v) => s + v, 0) / closes.length;
  const variance = closes.reduce((s, v) => s + (v - mu) ** 2, 0) / closes.length;
  const stdDev  = Math.sqrt(variance);

  return { prices, returns, stats: { mean: round2(mu), stdDev: round2(stdDev), count: prices.length } };
}
