// ESM — convertido desde CJS (package.json tiene "type":"module")
import { getYields }        from './getYields.js';
import { calculateSpreads } from './calculateSpreads.js';
import { buildMacroSignal } from './buildMacroSignal.js';

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')    { res.status(405).json({ error: 'Method not allowed' }); return; }

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
