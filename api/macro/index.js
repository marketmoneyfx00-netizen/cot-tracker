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

// ─────────────────────────────────────────────────────────────────────────────

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

  // Rate limiting — protege cuotas de FRED API
  if (applyRateLimit(req, res, 'api')) return;

  const { user: authUser } = await verifyAuth(req);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

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
