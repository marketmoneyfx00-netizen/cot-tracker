/**
 * api/candles.js — Historical OHLC candles proxy
 *
 * GET /api/candles?symbol=EUR/USD&interval=4h&outputsize=30
 *
 * Fetches from TwelveData. Server-side cache: 15 minutes per symbol+interval.
 * Returns candles sorted oldest → newest (same convention as priceStore).
 */

import { setSecurityHeaders, handleCORS } from './_lib/security.js';
import { verifyAuth }                      from './_lib/auth-middleware.js';

// ── Server-side cache ─────────────────────────────────────────────────────────
const _cache    = new Map();
const CACHE_TTL = 15 * 60_000; // 15 minutes

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.candles;
}

// ── Symbol mapping ────────────────────────────────────────────────────────────
// TwelveData uses standard FX notation. Map internal app names to API symbols.
const SYMBOL_MAP = {
  'USD Index': 'DXY',
  'USD/Index': 'DXY',
};

function toTwelveSymbol(sym) {
  return SYMBOL_MAP[sym] || sym;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (handleCORS(req, res)) return;

  const authError = await verifyAuth(req, res);
  if (authError) return;

  const { symbol, interval = '4h', outputsize = '30' } = req.query;

  if (!symbol) {
    res.status(400).json({ error: 'symbol required' });
    return;
  }

  const apiSymbol  = toTwelveSymbol(symbol);
  const cacheKey   = `${apiSymbol}:${interval}:${outputsize}`;
  const cached     = getCached(cacheKey);

  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json({ symbol, interval, candles: cached, source: 'cache' });
    return;
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'TWELVEDATA_API_KEY not configured' });
    return;
  }

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(apiSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);

    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!r.ok) {
      res.status(502).json({ error: `TwelveData HTTP ${r.status}` });
      return;
    }

    const data = await r.json();

    if (data.status === 'error' || !Array.isArray(data.values)) {
      res.status(502).json({ error: data.message || 'TwelveData error', raw: data });
      return;
    }

    // TwelveData returns newest-first — reverse to oldest-first
    const candles = data.values
      .map(v => ({
        time:  Math.floor(new Date(v.datetime.replace(' ', 'T') + 'Z').getTime() / 1000),
        open:  parseFloat(v.open),
        high:  parseFloat(v.high),
        low:   parseFloat(v.low),
        close: parseFloat(v.close),
      }))
      .filter(c => !isNaN(c.close) && c.close > 0)
      .reverse(); // oldest → newest

    _cache.set(cacheKey, { candles, ts: Date.now() });

    res.setHeader('X-Cache', 'MISS');
    res.status(200).json({ symbol, interval, candles, source: 'twelvedata' });

  } catch (err) {
    if (err?.name === 'AbortError') {
      res.status(504).json({ error: 'TwelveData timeout' });
    } else {
      res.status(500).json({ error: err?.message || 'Unknown error' });
    }
  }
}
