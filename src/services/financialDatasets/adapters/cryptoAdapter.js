// =============================================================================
// Crypto Adapter
//
// Adapts /api/fd?type=crypto-etf response into CryptoIntelBundle
// used by cryptoMacroLayer.
// =============================================================================

import { normalizeSnapshot, normalizePriceHistory } from '../normalizers/fundamentalsNormalizer.js';

const CRYPTO_ETF_META = {
  IBIT:  { name: 'iShares Bitcoin Trust',    asset: 'BTC', issuer: 'BlackRock', launchYear: 2024 },
  ETHA:  { name: 'iShares Ethereum Trust',   asset: 'ETH', issuer: 'BlackRock', launchYear: 2024 },
  FBTC:  { name: 'Fidelity Wise Origin BTC', asset: 'BTC', issuer: 'Fidelity',  launchYear: 2024 },
  BTCO:  { name: 'Invesco Galaxy Bitcoin',   asset: 'BTC', issuer: 'Invesco',   launchYear: 2024 },
  COIN:  { name: 'Coinbase Global',          asset: 'CRYPTO_PROXY', issuer: 'Coinbase', launchYear: 2021 },
  MSTR:  { name: 'MicroStrategy',            asset: 'BTC_PROXY',    issuer: 'MSTR',     launchYear: 1989 },
};

export function adaptCryptoEtf(raw) {
  if (!raw?.snapshots) return null;

  const instruments = {};
  for (const [ticker, snapshotRaw] of Object.entries(raw.snapshots)) {
    const meta = CRYPTO_ETF_META[ticker];
    if (!meta) continue;

    instruments[ticker] = {
      ...meta,
      ticker,
      snapshot:   normalizeSnapshot(snapshotRaw),
      history:    normalizePriceHistory(raw.history?.[ticker] ?? null),
    };
  }

  // Aggregate BTC demand signal from IBIT + FBTC + BTCO
  const btcEtfs  = ['IBIT', 'FBTC', 'BTCO'].map(t => instruments[t]).filter(Boolean);
  const btcFlows = computeAggregateFlow(btcEtfs);

  // ETH demand from ETHA
  const ethFlows = instruments.ETHA ? computeSingleFlow(instruments.ETHA) : null;

  // Institutional appetite proxy from COIN + MSTR
  const institutionalProxies = ['COIN', 'MSTR'].map(t => instruments[t]).filter(Boolean);
  const institutionalSignal  = computeAggregateFlow(institutionalProxies);

  return {
    instruments,
    aggregates: {
      btcDemand:     btcFlows,
      ethDemand:     ethFlows,
      institutional: institutionalSignal,
    },
    fetchedAt: raw.fetchedAt ?? new Date().toISOString(),
    source: 'financial-datasets-crypto-etf',
  };
}

function computeSingleFlow(instrument) {
  const snap = instrument.snapshot;
  if (!snap) return null;
  return {
    changePercent: snap.changePercent,
    volume:        snap.volume,
    price:         snap.price,
    trend:         deriveTrend(instrument.history),
  };
}

function computeAggregateFlow(instruments) {
  if (!instruments.length) return null;
  const snaps = instruments.map(i => i.snapshot).filter(Boolean);
  if (!snaps.length) return null;

  const avgChange = snaps.reduce((s, snap) => s + (snap.changePercent ?? 0), 0) / snaps.length;
  const trends    = instruments.map(i => deriveTrend(i.history)).filter(Boolean);

  return {
    avgChangePercent: Math.round(avgChange * 100) / 100,
    direction: avgChange > 1 ? 'INFLOW' : avgChange < -1 ? 'OUTFLOW' : 'FLAT',
    trend: trends[0] ?? null,
  };
}

function deriveTrend(history) {
  if (!history?.prices?.length) return null;
  const prices = history.prices.map(p => p.close);
  if (prices.length < 5) return null;

  const recent5  = prices.slice(-5);
  const prior5   = prices.slice(-10, -5);
  if (!prior5.length) return null;

  const avgRecent = recent5.reduce((s, v) => s + v, 0) / recent5.length;
  const avgPrior  = prior5.reduce((s, v) => s + v, 0) / prior5.length;
  const change    = (avgRecent - avgPrior) / avgPrior;

  return {
    fiveDayReturn: Math.round(change * 10000) / 100,
    direction: change > 0.02 ? 'UP' : change < -0.02 ? 'DOWN' : 'SIDEWAYS',
  };
}
