// =============================================================================
// POLYMARKET × COT TRACKER — DATA FETCHER
// src/polymarket/fetcher/DataFetcher.js
//
// All API calls to Polymarket endpoints.
// Handles retries, rate limits, normalization, error classification.
//
// NOTE ON CORS: Polymarket's public APIs support CORS for browser requests.
// If CORS issues arise in production, proxy through api/polymarket.js on Vercel.
// =============================================================================

const GAMMA_API  = 'https://gamma-api.polymarket.com';
const CLOB_API   = 'https://clob.polymarket.com';
const DATA_API   = 'https://data-api.polymarket.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Polymarket uses seconds in CLOB history, ms in WS, ISO strings in Gamma.
 * @param {number|string} raw
 * @returns {number} Unix ms
 */
export function normalizeTimestamp(raw) {
  if (typeof raw === 'string') return new Date(raw).getTime();
  if (raw > 1e12) return raw;   // already milliseconds
  return raw * 1000;             // seconds → ms
}

/**
 * Fetch with retry + exponential backoff.
 * @param {string} url
 * @param {{ retries?: number, retryDelayMs?: number, timeoutMs?: number }} opts
 */
async function fetchWithRetry(url, opts = {}) {
  const { retries = 3, retryDelayMs = 1000, timeoutMs = 10_000 } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);

      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') ?? '10', 10) * 1000;
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        if (attempt >= retries) throw new Error(`HTTP ${res.status} for ${url}`);
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();

    } catch (err) {
      clearTimeout(tid);
      if (attempt >= retries) throw err;
      const delay = retryDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[DataFetcher] Retry ${attempt + 1}/${retries} — ${err.message}`);
      await sleep(delay);
    }
  }
  throw new Error(`Max retries exceeded: ${url}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHER
// ─────────────────────────────────────────────────────────────────────────────

export class DataFetcher {
  // ── Market resolution: slug → conditionId + tokenIds ─────────────────────

  async resolveMarketBySlug(slug) {
    try {
      const data = await fetchWithRetry(
        `${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}&limit=1`
      );
      if (!data || data.length === 0) return null;
      const m = data[0];
      if (!m.conditionId || !m.clobTokenIds) return null;
      return {
        conditionId: m.conditionId,
        yesTokenId:  m.clobTokenIds[0],
        noTokenId:   m.clobTokenIds[1],
      };
    } catch {
      return null;
    }
  }

  // ── Full snapshot for a single market ────────────────────────────────────

  async fetchSnapshot(market) {
    try {
      const [gammaResult, bookResult, oiResult] = await Promise.allSettled([
        fetchWithRetry(`${GAMMA_API}/markets?conditionId=${market.conditionId}&limit=1`),
        fetchWithRetry(`${CLOB_API}/book?token_id=${market.yesTokenId}`),
        fetchWithRetry(`${DATA_API}/oi?market=${market.conditionId}`),
      ]);

      // Book is the minimum required (gives us price)
      if (bookResult.status === 'rejected') return null;
      const book = bookResult.value;

      const bestBid = book.bids?.length > 0 ? parseFloat(book.bids[0].price) : 0;
      const bestAsk = book.asks?.length > 0 ? parseFloat(book.asks[0].price) : 1;
      const spread  = bestAsk - bestBid;
      const midpoint = (bestBid + bestAsk) / 2;
      const lastTradePrice = parseFloat(book.last_trade_price || String(midpoint));

      let volume24h = 0;
      let liquidityDepth = 0;
      let question = market.description;
      let expiryTimestamp = Date.now() + 30 * 24 * 60 * 60 * 1000;

      if (gammaResult.status === 'fulfilled' && gammaResult.value?.length > 0) {
        const gm = gammaResult.value[0];
        volume24h     = gm.volume24hr ?? 0;
        liquidityDepth = gm.liquidity  ?? 0;
        question       = gm.question   ?? question;
        expiryTimestamp = new Date(gm.endDateIso).getTime() || expiryTimestamp;
      }

      let openInterest = 0;
      if (oiResult.status === 'fulfilled' && oiResult.value?.length > 0) {
        openInterest = oiResult.value[0].value ?? 0;
      } else if (gammaResult.status === 'fulfilled' && gammaResult.value?.length > 0) {
        openInterest = gammaResult.value[0].liquidity ?? 0;
      }

      const daysToExpiry = Math.max(0, (expiryTimestamp - Date.now()) / (24 * 60 * 60 * 1000));
      const qualityScore = this._computeQualityScore(openInterest, spread, volume24h);
      const isReliable   = this._isReliable(market, spread, openInterest, volume24h, daysToExpiry);

      return {
        conditionId:    market.conditionId,
        slug:           market.slug,
        question,
        category:       market.category,
        priority:       market.priority,
        midpoint,
        bestBid,
        bestAsk,
        spread,
        lastTradePrice,
        openInterest,
        volume24h,
        liquidityDepth,
        qualityScore,
        isReliable,
        isStale:          false,
        manipulationFlag: false,
        fetchedAt:        Date.now(),
        expiryTimestamp,
        daysToExpiry,
      };

    } catch (err) {
      console.error(`[DataFetcher] Snapshot failed for ${market.slug}:`, err.message);
      return null;
    }
  }

  // ── Price history ─────────────────────────────────────────────────────────

  async fetchPriceHistory(market, interval = '1w', fidelityMinutes = 60) {
    try {
      const url = `${CLOB_API}/prices-history` +
        `?market=${market.yesTokenId}` +
        `&interval=${interval}` +
        `&fidelity=${fidelityMinutes}`;

      const data = await fetchWithRetry(url);
      if (!data?.history) return null;

      const prices = data.history
        .map(p => ({ timestamp: normalizeTimestamp(p.t), price: p.p }))
        .sort((a, b) => a.timestamp - b.timestamp);

      return {
        conditionId: market.conditionId,
        slug:        market.slug,
        prices,
        fetchedAt:   Date.now(),
        interval:    interval === '1w' ? '1w' : interval === '1d' ? '1d' : '1h',
      };

    } catch (err) {
      console.error(`[DataFetcher] History failed for ${market.slug}:`, err.message);
      return null;
    }
  }

  // ── Market discovery (used by weekly auto-expansion) ─────────────────────

  async discoverTopMacroMarkets(limit = 100) {
    try {
      const events = await fetchWithRetry(
        `${GAMMA_API}/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=${limit}`
      );
      const markets = [];
      for (const ev of (events ?? [])) {
        if (ev.markets) markets.push(...ev.markets);
      }
      return markets.filter(m =>
        m.active && !m.closed && m.enableOrderBook && m.volume24hr > 5_000
      );
    } catch (err) {
      console.error('[DataFetcher] Discovery failed:', err.message);
      return [];
    }
  }

  // ── Large trades (for Narrative Transition Score) ─────────────────────────

  async fetchLargeTrades(conditionId, minAmountUSD = 5_000, limit = 200) {
    try {
      const url = `${DATA_API}/trades` +
        `?market=${conditionId}` +
        `&filterType=CASH` +
        `&filterAmount=${minAmountUSD}` +
        `&limit=${limit}`;
      return await fetchWithRetry(url);
    } catch {
      return [];
    }
  }

  // ── Private quality helpers ────────────────────────────────────────────────

  _computeQualityScore(oi, spread, vol24h) {
    const oiScore       = Math.min(1, oi / 1_000_000) * 40;
    const spreadScore   = Math.max(0, (0.12 - spread) / 0.12) * 30;
    const activityScore = Math.min(1, vol24h / 50_000) * 30;
    return Math.round(oiScore + spreadScore + activityScore);
  }

  _isReliable(market, spread, oi, vol24h, daysToExpiry) {
    return (
      oi >= market.minOI &&
      oi >= 50_000 &&              // global floor
      spread <= market.maxSpread &&
      spread <= 0.18 &&            // global ceiling
      vol24h >= market.minVolume24h &&
      daysToExpiry >= market.minDaysToExpiry
    );
  }
}
