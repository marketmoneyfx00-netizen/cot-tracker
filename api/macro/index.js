// ESM — convertido desde CJS (package.json tiene "type":"module")
import { getYields }        from './getYields.js';
import { calculateSpreads } from './calculateSpreads.js';
import { buildMacroSignal } from './buildMacroSignal.js';
import { verifyAuth }       from '../_lib/auth-middleware.js';
import { applyRateLimit }   from '../_lib/ratelimit.js';

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

// ── Fed Probability sub-handler (merged from api/fed-probability.js) ──────────
// GET /api/macro?type=fed-probability&month=june
// Source: 30-Day Fed Funds Futures (Yahoo Finance public chart API)
// No API key required. Server-side cache 1h.

const FOMC_MEETINGS = {
  june: { meetingDay: 18, daysInMonth: 30, year: 2025, futuresTicker: 'ZQM25.CBT' },
  july: { meetingDay: 30, daysInMonth: 31, year: 2025, futuresTicker: 'ZQN25.CBT' },
};
const CURRENT_FED_UPPER_BOUND = 4.50;
const CUT_SIZE_BP = 0.25;

let _fedProbCache = { probability: null, price: null, source: null, fetchedAt: 0 };
const FED_PROB_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchFuturesPrice(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; COTTracker/1.0)',
      'Accept':     'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price !== 'number' || price <= 0) throw new Error('No valid price in response');
  return price;
}

function deriveCutProbability(futuresPrice, meeting) {
  const { meetingDay, daysInMonth } = meeting;
  const daysAfter  = daysInMonth - meetingDay + 1;
  const noCutAvg   = CURRENT_FED_UPPER_BOUND;
  const impliedAvg = 100 - futuresPrice;
  const fullCutAdj = CUT_SIZE_BP * (daysAfter / daysInMonth);
  const probability = (noCutAvg - impliedAvg) / fullCutAdj;
  return Math.max(0, Math.min(1, probability));
}

async function handleFedProbability(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300');

  const month   = (req.query?.month ?? 'june').toLowerCase();
  const meeting = FOMC_MEETINGS[month];
  if (!meeting) {
    return res.status(400).json({ probability: null, source: 'error', error: `Unknown meeting month: ${month}` });
  }

  if (_fedProbCache.fetchedAt > 0 && Date.now() - _fedProbCache.fetchedAt < FED_PROB_TTL_MS) {
    return res.json({ ..._fedProbCache, cached: true });
  }

  const tickers = [meeting.futuresTicker, 'ZQ=F'];
  let price  = null;
  let source = null;

  for (const ticker of tickers) {
    try {
      price  = await fetchFuturesPrice(ticker);
      source = `yahoo:${ticker}`;
      break;
    } catch { /* try next ticker */ }
  }

  const probability = price !== null ? deriveCutProbability(price, meeting) : null;
  _fedProbCache = { probability, price, source: source ?? 'unavailable', fetchedAt: Date.now() };
  return res.json({ probability, price, source: source ?? 'unavailable' });
}

// =============================================================================
// Financial Datasets sub-router (merged from api/fd.js)
// GET /api/macro?fd_type=equity&ticker=SPY
// GET /api/macro?fd_type=macro-basket
// GET /api/macro?fd_type=crypto-etf
// ... etc.
// Requires auth. Uses FINANCIAL_DATASETS_API_KEY (server-side only).
// =============================================================================

const FD_BASE   = 'https://api.financialdatasets.ai';
const FD_APIKEY = process.env.FINANCIAL_DATASETS_API_KEY ?? '';

// ── In-process cache ──────────────────────────────────────────────────────────
const _fdCache = new Map();

function fdCacheGet(key) {
  const hit = _fdCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { _fdCache.delete(key); return null; }
  return hit.data;
}

function fdCacheSet(key, data, ttlMs) {
  if (_fdCache.size > 500) {
    const oldest = [..._fdCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) _fdCache.delete(oldest[0]);
  }
  _fdCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Ticker validation ─────────────────────────────────────────────────────────
const TICKER_RE = /^[A-Z0-9=.^-]{1,12}$/;

function validateTicker(raw) {
  if (!raw) return null;
  const t = String(raw).toUpperCase().trim();
  return TICKER_RE.test(t) ? t : null;
}

function validateTickers(raw, maxCount = 10) {
  if (!raw) return null;
  const list = String(raw).toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  if (list.length > maxCount) return null;
  if (list.some(t => !TICKER_RE.test(t))) return null;
  return list;
}

// ── Financial Datasets HTTP client ────────────────────────────────────────────
async function fdFetch(path, ttlMs = 900_000) {
  const cached = fdCacheGet(path);
  if (cached) return cached;

  if (!FD_APIKEY) throw new Error('FINANCIAL_DATASETS_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  let res;
  try {
    res = await fetch(`${FD_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        'X-API-KEY':    FD_APIKEY,
        'Accept':       'application/json',
        'User-Agent':   'cot-tracker/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    throw Object.assign(new Error('Rate limited by Financial Datasets API'), { status: 429, retryAfter });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`FD API ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }

  const data = await res.json();
  fdCacheSet(path, data, ttlMs);
  return data;
}

// ── FD Route handlers ─────────────────────────────────────────────────────────

async function handleFdEquity(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };

  const [income, balance, cashflow, snapshot] = await Promise.allSettled([
    fdFetch(`/financials/income-statements/?ticker=${ticker}&period=annual&limit=5`, 6 * 3600_000),
    fdFetch(`/financials/balance-sheets/?ticker=${ticker}&period=annual&limit=5`,    6 * 3600_000),
    fdFetch(`/financials/cash-flow-statements/?ticker=${ticker}&period=annual&limit=5`, 6 * 3600_000),
    fdFetch(`/prices/snapshot/?ticker=${ticker}`, 60_000),
  ]);

  return {
    ticker,
    income:    income.status    === 'fulfilled' ? income.value    : null,
    balance:   balance.status   === 'fulfilled' ? balance.value   : null,
    cashflow:  cashflow.status  === 'fulfilled' ? cashflow.value  : null,
    snapshot:  snapshot.status  === 'fulfilled' ? snapshot.value  : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function handleFdFinancials(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };

  const period    = q.period === 'quarterly' ? 'quarterly' : 'annual';
  const statement = ['income', 'balance', 'cashflow'].includes(q.statement) ? q.statement : 'income';
  const limit     = Math.min(parseInt(q.limit ?? '10', 10), 20);

  const endpointMap = {
    income:   `/financials/income-statements/?ticker=${ticker}&period=${period}&limit=${limit}`,
    balance:  `/financials/balance-sheets/?ticker=${ticker}&period=${period}&limit=${limit}`,
    cashflow: `/financials/cash-flow-statements/?ticker=${ticker}&period=${period}&limit=${limit}`,
  };

  return fdFetch(endpointMap[statement], period === 'annual' ? 6 * 3600_000 : 900_000);
}

async function handleFdEarnings(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  const limit = Math.min(parseInt(q.limit ?? '8', 10), 20);
  return fdFetch(`/earnings/?ticker=${ticker}&limit=${limit}`, 3600_000);
}

async function handleFdPrices(q) {
  const ticker   = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  const interval = ['minute', 'hour', 'day', 'week', 'month'].includes(q.interval) ? q.interval : 'day';
  const start    = /^\d{4}-\d{2}-\d{2}$/.test(q.start ?? '') ? q.start : null;
  const end      = /^\d{4}-\d{2}-\d{2}$/.test(q.end   ?? '') ? q.end   : null;

  let path = `/prices/?ticker=${ticker}&interval=${interval}`;
  if (start) path += `&start_date=${start}`;
  if (end)   path += `&end_date=${end}`;

  return fdFetch(path, interval === 'day' ? 3600_000 : 120_000);
}

async function handleFdSnapshot(q) {
  const tickers = validateTickers(q.tickers ?? q.ticker);
  if (!tickers || tickers.length === 0) return { error: 'Invalid tickers' };

  const results = await Promise.allSettled(
    tickers.map(t => fdFetch(`/prices/snapshot/?ticker=${t}`, 30_000))
  );

  const snapshots = {};
  tickers.forEach((t, i) => {
    snapshots[t] = results[i].status === 'fulfilled' ? results[i].value : null;
  });

  return { snapshots, fetchedAt: new Date().toISOString() };
}

async function handleFdCryptoEtf() {
  const CRYPTO_ETF_TICKERS = ['IBIT', 'ETHA', 'COIN', 'MSTR', 'BTCO', 'FBTC'];

  const results = await Promise.allSettled(
    CRYPTO_ETF_TICKERS.map(t => fdFetch(`/prices/snapshot/?ticker=${t}`, 60_000))
  );

  const snapshots = {};
  CRYPTO_ETF_TICKERS.forEach((t, i) => {
    snapshots[t] = results[i].status === 'fulfilled' ? results[i].value : null;
  });

  const yesterday = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const today     = new Date().toISOString().slice(0, 10);

  const historyResults = await Promise.allSettled(
    CRYPTO_ETF_TICKERS.map(t =>
      fdFetch(`/prices/?ticker=${t}&interval=day&start_date=${yesterday}&end_date=${today}`, 3600_000)
    )
  );

  const history = {};
  CRYPTO_ETF_TICKERS.forEach((t, i) => {
    history[t] = historyResults[i].status === 'fulfilled' ? historyResults[i].value : null;
  });

  return { snapshots, history, fetchedAt: new Date().toISOString() };
}

async function handleFdMacroBasket() {
  const MACRO_TICKERS = ['SPY', 'QQQ', 'TLT', 'GLD', 'HYG', 'EEM', 'UUP', 'IEF', 'VIX', 'DXY'];

  const results = await Promise.allSettled(
    MACRO_TICKERS.map(t => fdFetch(`/prices/snapshot/?ticker=${t}`, 60_000))
  );

  const snapshots = {};
  MACRO_TICKERS.forEach((t, i) => {
    snapshots[t] = results[i].status === 'fulfilled' ? results[i].value : null;
  });

  const past30   = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const today    = new Date().toISOString().slice(0, 10);
  const histKeys = ['SPY', 'QQQ', 'TLT', 'GLD', 'HYG'];

  const histResults = await Promise.allSettled(
    histKeys.map(t =>
      fdFetch(`/prices/?ticker=${t}&interval=day&start_date=${past30}&end_date=${today}`, 3600_000)
    )
  );

  const history = {};
  histKeys.forEach((t, i) => {
    history[t] = histResults[i].status === 'fulfilled' ? histResults[i].value : null;
  });

  return { snapshots, history, fetchedAt: new Date().toISOString() };
}

async function handleFdCompany(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  return fdFetch(`/company-facts/?ticker=${ticker}`, 24 * 3600_000);
}

const FD_ROUTE_MAP = {
  equity:           handleFdEquity,
  financials:       handleFdFinancials,
  earnings:         handleFdEarnings,
  prices:           handleFdPrices,
  snapshot:         handleFdSnapshot,
  'crypto-etf':     handleFdCryptoEtf,
  'macro-basket':   handleFdMacroBasket,
  company:          handleFdCompany,
};

async function handleFdDispatch(req, res) {
  if (!FD_APIKEY) {
    return res.status(503).json({
      error: 'Financial Datasets API key not configured',
      hint:  'Set FINANCIAL_DATASETS_API_KEY in Vercel environment variables',
    });
  }

  const q        = req.query ?? {};
  const fdType   = String(q.fd_type ?? '');
  const routeFn  = FD_ROUTE_MAP[fdType];

  if (!routeFn) {
    return res.status(400).json({
      error:     'Unknown fd_type',
      available: Object.keys(FD_ROUTE_MAP),
    });
  }

  try {
    const data = await routeFn(q);
    if (data?.error) return res.status(400).json(data);
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, type: fdType, data });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[api/macro/fd]', fdType, err.message);
    if (status === 429) {
      res.setHeader('Retry-After', err.retryAfter ?? '60');
      return res.status(429).json({ error: 'Upstream rate limit', retryAfter: err.retryAfter });
    }
    return res.status(status === 404 ? 404 : 502).json({
      error:   'Financial Datasets API error',
      message: err.message,
    });
  }
}

// =============================================================================
// Main handler
// =============================================================================

export default async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://app.cot-tracker.com';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Sub-route: ?type=fed-probability (no auth required — public futures data)
  if (req.query?.type === 'fed-probability') {
    return handleFedProbability(req, res);
  }

  // Rate limiting — protege cuotas de FRED API y FD API
  if (applyRateLimit(req, res, 'api')) return;

  const { user: authUser } = await verifyAuth(req);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

  // Sub-routes: ?fd_type=... (Financial Datasets proxy — auth already verified above)
  if (req.query?.fd_type) {
    return handleFdDispatch(req, res);
  }

  // ── Macro signal (original handler logic) ────────────────────────────────────
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', `public, max-age=${Math.floor((CACHE_TTL_MS - (now - _cacheTs)) / 1000)}`);
    res.setHeader('X-Macro-Cache', 'HIT');
    return res.status(200).json(_cache);
  }

  try {
    const yields = await getYields();

    if (!yields.US10Y?.current || !yields.DE10Y?.current) {
      console.error('[macro] Critical data missing — US10Y or DE10Y unavailable');
      if (_cache) {
        res.setHeader('X-Macro-Cache', 'STALE');
        return res.status(200).json({ ..._cache, stale: true, warning: 'Critical macro data temporarily unavailable — serving cached data' });
      }
      return res.status(503).json({
        error:   'Critical macro data unavailable',
        missing: ['US10Y', 'DE10Y'].filter(k => !yields[k]?.current),
      });
    }

    const missingOptional = ['UK10Y', 'JP10Y', 'CN10Y'].filter(k => !yields[k]?.current);
    const warning = missingOptional.length > 0
      ? `Partial macro data unavailable: ${missingOptional.join(', ')}`
      : null;
    if (warning) console.warn(`[macro] ${warning}`);

    const spreadResult = calculateSpreads(yields);
    const signal       = buildMacroSignal(spreadResult, yields);

    const payload = {
      timestamp: new Date().toISOString(),
      yields,
      spreads:   spreadResult.spreads,
      direction: spreadResult.direction,
      momentum:  spreadResult.momentum,
      signal,
      ...(warning ? { warning } : {}),
    };

    _cache   = payload;
    _cacheTs = now;

    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_MS / 1000}`);
    res.setHeader('X-Macro-Cache', 'MISS');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[macro] handler error:', err.message);
    if (_cache) {
      res.setHeader('X-Macro-Cache', 'STALE');
      return res.status(200).json({ ..._cache, stale: true });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
