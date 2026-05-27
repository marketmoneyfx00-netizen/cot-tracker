// =============================================================================
// Financial Datasets Service — Public API
//
// The single entry point for all FD data access from React components/hooks.
// Handles caching, normalization, and error isolation.
//
// Usage:
//   import { fdService } from '@/services/financialDatasets';
//   const equity = await fdService.getEquity('AAPL');
// =============================================================================

import { fdClient }         from './client.js';
import { fdCache }          from './cache/FDCache.js';
import { adaptEquityBundle, adaptSnapshotBundle } from './adapters/equityAdapter.js';
import { adaptEarnings }    from './adapters/earningsAdapter.js';
import { adaptCryptoEtf }   from './adapters/cryptoAdapter.js';
import { normalizePriceHistory } from './normalizers/fundamentalsNormalizer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withCache(cacheKey, fetcher, setter) {
  const hit = fdCache.get(cacheKey);
  if (hit) return hit.data;

  const stale = fdCache.getStale(cacheKey);
  if (stale?.data) {
    fetcher().then(setter).catch(() => {});
    return stale.data;
  }

  const data = await fetcher();
  if (data) setter(data);
  return data;
}

// ── Public service ────────────────────────────────────────────────────────────

export const fdService = {

  /** Full equity intelligence bundle for a single ticker */
  async getEquity(ticker) {
    return withCache(
      `equity:${ticker}`,
      () => fdClient.getEquity(ticker),
      (raw) => fdCache.setEquity(ticker, adaptEquityBundle(raw)),
    ).then(raw => typeof raw?.ticker === 'string' ? raw : adaptEquityBundle(raw));
  },

  /** Earnings history + quality signals */
  async getEarnings(ticker, limit = 8) {
    const hit = fdCache.getEarnings(ticker);
    if (hit) return hit.data;

    const raw = await fdClient.getEarnings(ticker, limit);
    const adapted = adaptEarnings(raw, ticker);
    if (adapted) fdCache.setEarnings(ticker, adapted);
    return adapted;
  },

  /** Price snapshot for one or multiple tickers */
  async getSnapshot(tickers) {
    const tickerList = Array.isArray(tickers) ? tickers : [tickers];
    const missingTickers = tickerList.filter(t => !fdCache.getSnapshot(t)?.data);

    if (missingTickers.length > 0) {
      const raw = await fdClient.getSnapshot(missingTickers);
      if (raw?.snapshots) {
        const adapted = adaptSnapshotBundle(raw.snapshots);
        for (const [ticker, data] of Object.entries(adapted)) {
          if (data) fdCache.setSnapshot(ticker, data);
        }
      }
    }

    const result = {};
    for (const ticker of tickerList) {
      result[ticker] = fdCache.getSnapshot(ticker)?.data ?? null;
    }
    return result;
  },

  /** Historical daily prices */
  async getPriceHistory(ticker, start, end) {
    const hit = fdCache.getPrices(ticker);
    if (hit) return hit.data;

    const raw = await fdClient.getPrices(ticker, 'day', start, end);
    const normalized = normalizePriceHistory(raw);
    if (normalized) fdCache.setPrices(ticker, normalized);
    return normalized;
  },

  /** Macro ETF basket (SPY, QQQ, TLT, GLD, HYG, EEM, UUP, IEF) */
  async getMacroBasket() {
    const hit = fdCache.getMacroBasket();
    if (hit) return hit.data;

    const raw = await fdClient.getMacroBasket();
    if (raw) fdCache.setMacroBasket(raw);
    return raw;
  },

  /** Crypto ETF basket (IBIT, ETHA, COIN, MSTR...) */
  async getCryptoEtf() {
    const hit = fdCache.getCryptoEtf();
    if (hit) return hit.data;

    const raw = await fdClient.getCryptoEtf();
    const adapted = adaptCryptoEtf(raw);
    if (adapted) fdCache.setCryptoEtf(adapted);
    return adapted;
  },

  /** Is the FD API available (circuit breaker not open) */
  isAvailable: () => fdClient.isAvailable(),

  /** Manual cache reset */
  resetCache:  () => fdCache.clear(),

  /** Cache statistics for monitoring */
  cacheStats:  () => fdCache.stats(),

  /** Prefetch common data in background (call once on app mount) */
  async prefetch() {
    if (!fdClient.isAvailable()) return;
    await Promise.allSettled([
      this.getMacroBasket(),
      this.getCryptoEtf(),
    ]);
  },
};

export { fdCache } from './cache/FDCache.js';
export { fdClient } from './client.js';
