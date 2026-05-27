// =============================================================================
// Financial Datasets — HTTP Client
//
// Wraps /api/fd proxy calls with:
//   - Exponential backoff retry (3 attempts)
//   - 15s timeout per request
//   - Circuit breaker (open after 5 consecutive errors, resets after 60s)
//   - Rate limit awareness (respects Retry-After)
//   - Auth via Supabase session JWT
// =============================================================================

import { supabase } from '../../lib/supabase.js';

// ── Circuit breaker state ─────────────────────────────────────────────────────
const _breaker = {
  failures:  0,
  openUntil: 0,
  THRESHOLD: 5,
  RESET_MS:  60_000,
};

function breakerIsOpen() {
  if (_breaker.openUntil > Date.now()) return true;
  if (_breaker.openUntil > 0) {
    _breaker.failures  = 0;
    _breaker.openUntil = 0;
  }
  return false;
}

function breakerRecord(success) {
  if (success) {
    _breaker.failures = 0;
    return;
  }
  _breaker.failures++;
  if (_breaker.failures >= _breaker.THRESHOLD) {
    _breaker.openUntil = Date.now() + _breaker.RESET_MS;
    console.warn('[FDClient] Circuit breaker OPEN for 60s — too many FD API errors');
  }
}

// ── JWT helper ────────────────────────────────────────────────────────────────
async function getJwt() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// ── Core fetch with retry ─────────────────────────────────────────────────────
const BASE_URL = '/api/macro';
const MAX_RETRY = 3;

async function fdRequest(type, params = {}, retryCount = 0) {
  if (breakerIsOpen()) {
    throw Object.assign(new Error('FD API circuit breaker open'), { code: 'CIRCUIT_OPEN' });
  }

  const jwt = await getJwt();
  const qs  = new URLSearchParams({ fd_type: type, ...params }).toString();
  const url = `${BASE_URL}?${qs}`;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      breakerRecord(false);
      throw Object.assign(new Error('FD request timeout'), { code: 'TIMEOUT' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10) * 1000;
    if (retryCount < MAX_RETRY) {
      await sleep(retryAfter);
      return fdRequest(type, params, retryCount + 1);
    }
    throw Object.assign(new Error('Rate limited'), { code: 'RATE_LIMITED' });
  }

  if (!res.ok) {
    breakerRecord(false);
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), {
      code: 'HTTP_ERROR',
      status: res.status,
    });
  }

  const json = await res.json();
  if (!json.ok) {
    breakerRecord(false);
    throw Object.assign(new Error(json.error ?? 'Unknown error from FD proxy'), { code: 'API_ERROR' });
  }

  breakerRecord(true);
  return json.data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

export const fdClient = {
  /** Full equity bundle: income + balance + cashflow + snapshot */
  getEquity: (ticker) =>
    fdRequest('equity', { ticker }),

  /** Single financial statement */
  getFinancials: (ticker, statement = 'income', period = 'annual', limit = 10) =>
    fdRequest('financials', { ticker, statement, period, limit }),

  /** Earnings history with estimates */
  getEarnings: (ticker, limit = 8) =>
    fdRequest('earnings', { ticker, limit }),

  /** Historical OHLCV prices */
  getPrices: (ticker, interval = 'day', start, end) =>
    fdRequest('prices', { ticker, interval, ...(start ? { start } : {}), ...(end ? { end } : {}) }),

  /** Real-time price snapshot for multiple tickers */
  getSnapshot: (tickers) =>
    fdRequest('snapshot', { tickers: Array.isArray(tickers) ? tickers.join(',') : tickers }),

  /** Crypto ETF basket (IBIT, ETHA, COIN, MSTR...) */
  getCryptoEtf: () =>
    fdRequest('crypto-etf', {}),

  /** Macro ETF basket (SPY, QQQ, TLT, GLD...) */
  getMacroBasket: () =>
    fdRequest('macro-basket', {}),

  /** Company fundamentals metadata */
  getCompany: (ticker) =>
    fdRequest('company', { ticker }),

  /** Check if circuit breaker is open */
  isAvailable: () => !breakerIsOpen(),

  /** Reset circuit breaker manually (for testing / UI refresh) */
  resetBreaker: () => {
    _breaker.failures  = 0;
    _breaker.openUntil = 0;
  },
};
