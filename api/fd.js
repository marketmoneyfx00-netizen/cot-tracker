// =============================================================================
// /api/fd — Financial Datasets Proxy
//
// Single serverless function to stay within Vercel function limits.
// Routes by ?type= query param.
//
// Supported types:
//   equity       ?ticker=SPY
//   financials   ?ticker=AAPL&period=annual&statement=income
//   earnings     ?ticker=AAPL&limit=8
//   prices       ?ticker=SPY&interval=day&start=YYYY-MM-DD&end=YYYY-MM-DD
//   snapshot     ?tickers=SPY,QQQ,TLT (comma-separated, max 10)
//   crypto-etf   (fixed set: IBIT, ETHA, COIN, MSTR)
//   macro-basket (fixed set: SPY, QQQ, TLT, GLD, HYG, EEM, UUP, IEF)
//   company      ?ticker=AAPL
// =============================================================================

import { setSecurityHeaders, handleCORS } from './_lib/security.js';
import { applyRateLimit }                  from './_lib/ratelimit.js';
import { verifyAuth }                      from './_lib/auth-middleware.js';

const FD_BASE  = 'https://api.financialdatasets.ai';
const API_KEY  = process.env.FINANCIAL_DATASETS_API_KEY ?? '';

// ── In-process cache (survives warm invocations) ──────────────────────────────
const _cache = new Map();

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { _cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data, ttlMs) {
  if (_cache.size > 500) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Safe ticker validation ────────────────────────────────────────────────────
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

// ── Financial Datasets HTTP client ───────────────────────────────────────────
async function fdFetch(path, ttlMs = 900_000) {
  const key = path;
  const cached = cacheGet(key);
  if (cached) return cached;

  if (!API_KEY) throw new Error('FINANCIAL_DATASETS_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  let res;
  try {
    res = await fetch(`${FD_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        'X-API-KEY': API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'cot-tracker/1.0',
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
  cacheSet(key, data, ttlMs);
  return data;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleEquity(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };

  const [income, balance, cashflow, snapshot] = await Promise.allSettled([
    fdFetch(`/financials/income-statements/?ticker=${ticker}&period=annual&limit=5`, 6 * 3600_000),
    fdFetch(`/financials/balance-sheets/?ticker=${ticker}&period=annual&limit=5`, 6 * 3600_000),
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

async function handleFinancials(q) {
  const ticker    = validateTicker(q.ticker);
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

async function handleEarnings(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  const limit = Math.min(parseInt(q.limit ?? '8', 10), 20);
  return fdFetch(`/earnings/?ticker=${ticker}&limit=${limit}`, 3600_000);
}

async function handlePrices(q) {
  const ticker   = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  const interval = ['minute', 'hour', 'day', 'week', 'month'].includes(q.interval) ? q.interval : 'day';
  const start    = /^\d{4}-\d{2}-\d{2}$/.test(q.start ?? '') ? q.start : null;
  const end      = /^\d{4}-\d{2}-\d{2}$/.test(q.end   ?? '') ? q.end   : null;

  let path = `/prices/?ticker=${ticker}&interval=${interval}`;
  if (start) path += `&start_date=${start}`;
  if (end)   path += `&end_date=${end}`;

  const ttl = interval === 'day' ? 3600_000 : 120_000;
  return fdFetch(path, ttl);
}

async function handleSnapshot(q) {
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

async function handleCryptoEtf() {
  const CRYPTO_ETF_TICKERS = ['IBIT', 'ETHA', 'COIN', 'MSTR', 'BTCO', 'FBTC'];
  const results = await Promise.allSettled(
    CRYPTO_ETF_TICKERS.map(t => fdFetch(`/prices/snapshot/?ticker=${t}`, 60_000))
  );

  const data = {};
  CRYPTO_ETF_TICKERS.forEach((t, i) => {
    data[t] = results[i].status === 'fulfilled' ? results[i].value : null;
  });

  // Fetch recent price history for trend analysis
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

  return { snapshots: data, history, fetchedAt: new Date().toISOString() };
}

async function handleMacroBasket() {
  const MACRO_TICKERS = ['SPY', 'QQQ', 'TLT', 'GLD', 'HYG', 'EEM', 'UUP', 'IEF', 'VIX', 'DXY'];
  const results = await Promise.allSettled(
    MACRO_TICKERS.map(t => fdFetch(`/prices/snapshot/?ticker=${t}`, 60_000))
  );

  const snapshots = {};
  MACRO_TICKERS.forEach((t, i) => {
    snapshots[t] = results[i].status === 'fulfilled' ? results[i].value : null;
  });

  // 30-day history for basket regime analysis
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

async function handleCompany(q) {
  const ticker = validateTicker(q.ticker);
  if (!ticker) return { error: 'Invalid ticker' };
  return fdFetch(`/company-facts/?ticker=${ticker}`, 24 * 3600_000);
}

// ── Route dispatch ────────────────────────────────────────────────────────────

const ROUTE_MAP = {
  equity:       handleEquity,
  financials:   handleFinancials,
  earnings:     handleEarnings,
  prices:       handlePrices,
  snapshot:     handleSnapshot,
  'crypto-etf': handleCryptoEtf,
  'macro-basket': handleMacroBasket,
  company:      handleCompany,
};

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (handleCORS(req, res)) return;

  // Rate limit (generous — internal proxy)
  const rl = applyRateLimit(req, 60, 60_000);
  if (rl.limited) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfter / 1000)));
    return res.status(429).json({ error: 'Too many requests', retryAfter: rl.retryAfter });
  }

  // Auth required — must have valid Supabase JWT
  const auth = await verifyAuth(req);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const q    = req.query ?? {};
  const type = String(q.type ?? '');

  const handler_fn = ROUTE_MAP[type];
  if (!handler_fn) {
    return res.status(400).json({
      error: 'Unknown type',
      available: Object.keys(ROUTE_MAP),
    });
  }

  if (!API_KEY) {
    return res.status(503).json({
      error: 'Financial Datasets API key not configured',
      hint: 'Set FINANCIAL_DATASETS_API_KEY in Vercel environment variables',
    });
  }

  try {
    const data = await handler_fn(q);

    if (data?.error) {
      return res.status(400).json(data);
    }

    // Short cache header to allow CDN edge caching
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, type, data });

  } catch (err) {
    const status = err.status ?? 500;
    console.error('[api/fd]', type, err.message);

    if (status === 429) {
      res.setHeader('Retry-After', err.retryAfter ?? '60');
      return res.status(429).json({ error: 'Upstream rate limit', retryAfter: err.retryAfter });
    }

    return res.status(status === 404 ? 404 : 502).json({
      error: 'Financial Datasets API error',
      message: err.message,
    });
  }
}
