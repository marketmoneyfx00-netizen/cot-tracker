/**
 * api/fed-probability.js
 *
 * Returns CME-implied probability of a Fed rate cut at the specified FOMC meeting.
 * Source: 30-Day Fed Funds Futures (CBOT) price via Yahoo Finance public chart API.
 *
 * Formula: CME FedWatch method
 *   implied_avg_rate = 100 - futures_price
 *   P(cut) = (no_cut_avg - implied_avg) / (cut_size_bps * days_after / days_in_month)
 *
 * GET /api/fed-probability?month=june
 * GET /api/fed-probability?month=july
 *
 * Response: { probability: number|null, source: string, price: number|null, error?: string }
 *
 * Server-side cache: 1 hour. No API key required — Yahoo Finance public chart endpoint.
 */

// ── FOMC meeting config (update when new meetings are scheduled) ──────────────
// meetingDay = announcement day; daysInMonth = calendar days in month
const FOMC_MEETINGS = {
  june: { meetingDay: 18, daysInMonth: 30, year: 2025, futuresTicker: 'ZQM25.CBT' },
  july: { meetingDay: 30, daysInMonth: 31, year: 2025, futuresTicker: 'ZQN25.CBT' },
};

// Current Fed Funds target rate upper bound (update when Fed acts)
const CURRENT_FED_UPPER_BOUND = 4.50; // % — as of June 2025
const CUT_SIZE_BP = 0.25;             // standard 25bp cut

// ── Server-side in-memory cache (shared across invocations in same lambda instance) ─
let _cache = { probability: null, price: null, source: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Fed Funds Futures price fetcher ──────────────────────────────────────────
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

// ── CME FedWatch probability derivation ──────────────────────────────────────
function deriveCutProbability(futuresPrice, meeting) {
  const { meetingDay, daysInMonth } = meeting;
  const daysAfter  = daysInMonth - meetingDay + 1;

  // Monthly average if no cut: full month at current rate
  const noCutAvg = CURRENT_FED_UPPER_BOUND;

  // Implied monthly average rate from futures settlement price
  const impliedAvg = 100 - futuresPrice;

  // P(cut) = how much of the "full-cut scenario" is priced in
  // Full-cut scenario avg = noCutAvg - (CUT_SIZE * daysAfter/daysInMonth)
  const fullCutAdj = CUT_SIZE_BP * (daysAfter / daysInMonth);

  // P = (noCutAvg - impliedAvg) / fullCutAdj
  // Positive P = market prices cuts; negative = market prices hikes
  const probability = (noCutAvg - impliedAvg) / fullCutAdj;
  return Math.max(0, Math.min(1, probability));
}

// ── Vercel handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300');

  const month   = (req.query?.month ?? 'june').toLowerCase();
  const meeting = FOMC_MEETINGS[month];

  if (!meeting) {
    return res.status(400).json({ probability: null, source: 'error', error: `Unknown meeting month: ${month}` });
  }

  // Return cached value if fresh
  if (_cache.fetchedAt > 0 && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ ..._cache, cached: true });
  }

  // Try primary ticker, then fall back to continuous ZQ=F
  const tickers = [meeting.futuresTicker, 'ZQ=F'];
  let price  = null;
  let source = null;

  for (const ticker of tickers) {
    try {
      price  = await fetchFuturesPrice(ticker);
      source = `yahoo:${ticker}`;
      break;
    } catch {
      // try next ticker
    }
  }

  const probability = price !== null ? deriveCutProbability(price, meeting) : null;

  _cache = { probability, price, source: source ?? 'unavailable', fetchedAt: Date.now() };
  return res.json({ probability, price, source: source ?? 'unavailable' });
}
