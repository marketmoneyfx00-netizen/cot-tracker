// =============================================================================
// Crypto Macro Layer
//
// Integrates crypto-ETF data with macro context to generate:
//   - Risk-on / risk-off crypto signal
//   - BTC/ETH correlation vs DXY, yields, NASDAQ
//   - Stablecoin flow signal (via ETH ETF proxy)
//   - Institutional demand score
//   - Crypto-driven FX macro implication
//
// Pure stateless engine. Inputs from cryptoAdapter + macroBasket.
// =============================================================================

import { clamp, weightedAvg, correlation, annualizedVol, rollingReturns }
  from '../../services/financialDatasets/normalizers/metricNormalizer.js';

// ── Macro Basket helpers ──────────────────────────────────────────────────────

function extractReturns(basket, ticker) {
  const hist = basket?.history?.[ticker];
  if (!hist?.prices?.length) return null;
  const prices = hist.prices.map(p => p.close);
  return rollingReturns(prices, 1); // daily returns
}

function extractPriceChg(basket, ticker) {
  const snap = basket?.snapshots?.[ticker];
  return snap?.price?.changePercent ?? snap?.changePercent ?? null;
}

// ── Correlations ──────────────────────────────────────────────────────────────

function computeCorrelationMatrix(cryptoBundle, macroBasket) {
  const ibitReturns = cryptoBundle?.instruments?.IBIT?.history?.returns?.map(r => r.return);
  if (!ibitReturns?.length) return null;

  const qqqReturns = extractReturns(macroBasket, 'QQQ');
  const tltReturns = extractReturns(macroBasket, 'TLT');
  const uupReturns = extractReturns(macroBasket, 'UUP');
  const gldReturns = extractReturns(macroBasket, 'GLD');

  const len = Math.min(ibitReturns.length, ...[qqqReturns, tltReturns, uupReturns, gldReturns]
    .filter(Boolean).map(r => r.length));

  if (len < 10) return null;

  const btc = ibitReturns.slice(0, len);

  return {
    btcVsNasdaq: qqqReturns ? Math.round(correlation(btc, qqqReturns.slice(0, len)) * 100) / 100 : null,
    btcVsYields: tltReturns ? Math.round(correlation(btc, tltReturns.slice(0, len)) * -100) / 100 : null, // inverse TLT = yield proxy
    btcVsDxy:    uupReturns ? Math.round(correlation(btc, uupReturns.slice(0, len)) * 100) / 100 : null,
    btcVsGold:   gldReturns ? Math.round(correlation(btc, gldReturns.slice(0, len)) * 100) / 100 : null,
    periodDays:  len,
  };
}

// ── Risk signal ───────────────────────────────────────────────────────────────

function deriveRiskSignal(cryptoBundle, macroBasket, correlations) {
  const btcChange   = cryptoBundle?.aggregates?.btcDemand?.avgChangePercent ?? 0;
  const ethChange   = cryptoBundle?.instruments?.ETHA?.snapshot?.changePercent ?? 0;
  const spyChange   = extractPriceChg(macroBasket, 'SPY') ?? 0;
  const qqqChange   = extractPriceChg(macroBasket, 'QQQ') ?? 0;
  const hygChange   = extractPriceChg(macroBasket, 'HYG') ?? 0; // credit spread proxy

  // If BTC & QQQ both up → risk-on
  // If BTC up but bonds also up → crypto-specific demand (not macro risk-on)
  // If BTC down while SPY up → crypto underperformance signal

  const cryptoAvg  = (btcChange + ethChange) / 2;
  const equityAvg  = (spyChange + qqqChange) / 2;
  const creditComp = hygChange;

  let score = 50;

  if (cryptoAvg > 1 && equityAvg > 0.5 && creditComp > 0) {
    score = 80; // classic risk-on
  } else if (cryptoAvg > 2 && equityAvg < -0.5) {
    score = 65; // crypto-specific institutional demand
  } else if (cryptoAvg < -1 && equityAvg < -0.5 && creditComp < -0.5) {
    score = 20; // synchronized risk-off
  } else if (cryptoAvg < -1 && equityAvg > 0) {
    score = 35; // crypto-specific selling
  } else if (cryptoAvg > 0 && equityAvg > 0) {
    score = 60; // mild risk-on
  } else {
    score = 45;
  }

  // Correlation adjustment: low BTC/NASDAQ correlation → cryptospecific dynamic
  if (correlations?.btcVsNasdaq != null) {
    if (Math.abs(correlations.btcVsNasdaq) < 0.3 && cryptoAvg > 1) score += 5;
  }

  return {
    score: clamp(score, 0, 100),
    regime: score >= 65 ? 'RISK_ON' : score <= 35 ? 'RISK_OFF' : 'NEUTRAL',
    cryptoAvgChange: Math.round(cryptoAvg * 100) / 100,
    equityAvgChange: Math.round(equityAvg * 100) / 100,
  };
}

// ── Institutional demand ──────────────────────────────────────────────────────

function computeInstitutionalDemand(cryptoBundle) {
  const btc     = cryptoBundle?.aggregates?.btcDemand;
  const eth     = cryptoBundle?.aggregates?.ethDemand;
  const instit  = cryptoBundle?.aggregates?.institutional;

  const items = [
    btc?.avgChangePercent != null ? { value: clamp(50 + btc.avgChangePercent * 5, 0, 100), weight: 0.45 } : null,
    eth?.changePercent    != null ? { value: clamp(50 + eth.changePercent * 5,   0, 100), weight: 0.30 } : null,
    instit?.avgChangePercent != null ? { value: clamp(50 + instit.avgChangePercent * 3, 0, 100), weight: 0.25 } : null,
  ].filter(Boolean);

  const score = items.length ? Math.round(weightedAvg(items)) : null;

  let label, color;
  if (score == null)  { label = 'Desconocido'; color = '#6b7280'; }
  else if (score > 65){ label = 'Creciendo';  color = '#22c55e'; }
  else if (score > 50){ label = 'Positivo';   color = '#4ade80'; }
  else if (score > 35){ label = 'Neutral';    color = '#fbbf24'; }
  else                { label = 'Declinando'; color = '#ef4444'; }

  return { score, label, color };
}

// ── FX macro implication ──────────────────────────────────────────────────────

function deriveFxImplication(riskSignal, correlations) {
  const regime = riskSignal.regime;
  const btcVsDxy = correlations?.btcVsDxy;

  const implications = [];

  if (regime === 'RISK_ON' && btcVsDxy != null && btcVsDxy < -0.3) {
    implications.push({
      currency: 'USD',
      direction: 'bearish',
      reason: 'BTC risk-on demand with negative DXY correlation signals USD weakness',
    });
  }

  if (regime === 'RISK_OFF') {
    implications.push({
      currency: 'JPY',
      direction: 'bullish',
      reason: 'Crypto risk-off aligned with classic safe-haven JPY demand',
    });
    implications.push({
      currency: 'CHF',
      direction: 'bullish',
      reason: 'Synchronized risk-off supports CHF',
    });
  }

  if (regime === 'RISK_ON') {
    implications.push({
      currency: 'AUD',
      direction: 'bullish',
      reason: 'Crypto risk-on typically aligned with AUD commodity/risk appetite',
    });
  }

  return implications;
}

// ── Volatility regime ─────────────────────────────────────────────────────────

function computeCryptoVol(cryptoBundle) {
  const ibitHistory = cryptoBundle?.instruments?.IBIT?.history;
  if (!ibitHistory?.returns?.length) return null;

  const returns = ibitHistory.returns.map(r => r.return ?? 0);
  const vol     = annualizedVol(returns);

  return {
    annualizedVol:  vol != null ? Math.round(vol * 10000) / 100 : null,
    regime: vol == null ? 'UNKNOWN' : vol > 1.0 ? 'EXTREME' : vol > 0.6 ? 'HIGH' : vol > 0.4 ? 'NORMAL' : 'LOW',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} cryptoBundle  - from cryptoAdapter.adaptCryptoEtf()
 * @param {object} macroBasket   - raw from /api/fd?type=macro-basket
 * @param {object} macroContext  - { dxyTrend, yieldTrend, fedStance } optional
 */
export function computeCryptoMacroLayer(cryptoBundle, macroBasket) {
  if (!cryptoBundle) return null;

  const correlations = computeCorrelationMatrix(cryptoBundle, macroBasket);
  const riskSignal   = deriveRiskSignal(cryptoBundle, macroBasket, correlations);
  const institutional = computeInstitutionalDemand(cryptoBundle);
  const fxImplication = deriveFxImplication(riskSignal, correlations);
  const volData      = computeCryptoVol(cryptoBundle);

  return {
    riskSignal,
    institutional,
    correlations,
    fxImplication,
    volatility: volData,
    btcDemand:  cryptoBundle.aggregates?.btcDemand ?? null,
    ethDemand:  cryptoBundle.aggregates?.ethDemand ?? null,
    computedAt: new Date().toISOString(),
  };
}
