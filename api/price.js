/**
 * api/price.js — Proxy seguro para precios de mercado en tiempo real
 *
 * Mueve las API keys de Finnhub y TwelveData fuera del bundle del cliente.
 * El frontend hace polling a /api/price en lugar de llamar directamente
 * a los proveedores externos con keys expuestas.
 *
 * GET /api/price?symbol=EUR/USD
 * GET /api/price?symbol=OANDA:EUR_USD&provider=finnhub
 *
 * Respuesta:
 *   { price: number, symbol: string, provider: string, ts: number }
 *
 * Caché en memoria: 8 segundos por símbolo.
 * Fallback automático: si Finnhub falla → TwelveData, y viceversa.
 *
 * Variables de entorno requeridas (SIN prefijo VITE_):
 *   FINNHUB_API_KEY
 *   TWELVEDATA_API_KEY
 */

import { setSecurityHeaders, handleCORS } from './_lib/security.js';
import { verifyAuth } from './_lib/auth-middleware.js';

// ── Caché en memoria ──────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS       = 8_000;         // 8s  — pares forex (cambian constantemente)
const CACHE_TTL_INDEX_MS = 5 * 60_000;   // 5min — índices como VIX (mueven más lento)
const INDEX_SYMS = new Set(['VIX', '^VIX', 'SPX', 'NDX', 'DJI', 'RUT']);

function getCached(symbol) {
  const entry = _cache.get(symbol);
  if (!entry) return null;
  const ttl = INDEX_SYMS.has(symbol) ? CACHE_TTL_INDEX_MS : CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) {
    _cache.delete(symbol);
    return null;
  }
  return entry;
}

function setCache(symbol, price, provider) {
  _cache.set(symbol, { price, provider, ts: Date.now() });
}

// ── Normalización de símbolo ──────────────────────────────────────────────────
// TwelveData: "EUR/USD"  → Finnhub: "OANDA:EUR_USD"
function toFinnhubSymbol(sym) {
  // Already in Finnhub format
  if (sym.includes(':')) return sym;
  // EUR/USD → OANDA:EUR_USD
  return 'OANDA:' + sym.replace('/', '_');
}

function toTwelveSymbol(sym) {
  // OANDA:EUR_USD → EUR/USD
  if (sym.includes(':')) return sym.split(':')[1].replace('_', '/');
  return sym;
}

// ── Proveedores ───────────────────────────────────────────────────────────────
async function fetchFinnhub(symbol) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY not configured');

  const fSym = toFinnhubSymbol(symbol);
  // Key en header para evitar exposición en logs de proxy y Referer
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(fSym)}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(6_000),
    headers: { 'X-Finnhub-Token': key },
  });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

  const data = await res.json();
  if (typeof data?.c !== 'number' || data.c === 0) {
    throw new Error(`Finnhub invalid price: ${JSON.stringify(data)}`);
  }

  return { price: data.c, provider: 'finnhub' };
}

async function fetchTwelveData(symbol) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY not configured');

  const tSym = toTwelveSymbol(symbol);
  // Key en header Authorization para evitar exposición en logs de proxy
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tSym)}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(6_000),
    headers: { 'Authorization': `apikey ${key}` },
  });
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);

  const data = await res.json();
  if (!data?.price) throw new Error(`TwelveData invalid response: ${JSON.stringify(data)}`);

  const price = parseFloat(data.price);
  if (isNaN(price) || price === 0) throw new Error(`TwelveData invalid price: ${data.price}`);

  return { price, provider: 'twelvedata' };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (handleCORS(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar JWT — solo usuarios autenticados pueden usar el proxy de precios
  const { user, error: authError } = await verifyAuth(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validar símbolo
  const rawSymbol = String(req.query?.symbol ?? '').trim();
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Missing required param: symbol' });
  }

  // Whitelist básica para evitar SSRF
  const SYMBOL_RE = /^[A-Z0-9_:/]{3,20}$/i;
  if (!SYMBOL_RE.test(rawSymbol)) {
    return res.status(400).json({ error: 'Invalid symbol format' });
  }

  const symbol = rawSymbol.toUpperCase();

  // Servir desde caché si está fresco
  const cached = getCached(symbol);
  if (cached) {
    res.setHeader('X-Price-Cache', 'HIT');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      price:    cached.price,
      symbol,
      provider: cached.provider,
      ts:       cached.ts,
      cached:   true,
    });
  }

  // Índices US (VIX, SPX, etc.) solo están disponibles en TwelveData —
  // Finnhub los mapearía a OANDA:VIX (forex pair incorrecto).
  const US_INDICES = new Set(['VIX', '^VIX', 'SPX', 'NDX', 'DJI', 'RUT']);
  const isIndex = US_INDICES.has(symbol) || symbol.startsWith('^');

  // Determinar orden de proveedores
  // Si el símbolo tiene formato OANDA:... preferimos Finnhub primero
  const preferFinnhub = !isIndex && (symbol.includes(':') || req.query?.provider === 'finnhub');
  const providers = isIndex
    ? [fetchTwelveData]
    : preferFinnhub
      ? [fetchFinnhub, fetchTwelveData]
      : [fetchTwelveData, fetchFinnhub];

  let lastError = null;

  for (const fetchFn of providers) {
    try {
      const { price, provider } = await fetchFn(symbol);
      setCache(symbol, price, provider);

      res.setHeader('X-Price-Cache', 'MISS');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        price,
        symbol,
        provider,
        ts: Date.now(),
        cached: false,
      });
    } catch (err) {
      console.warn(`[price] ${fetchFn.name} failed for ${symbol}:`, err.message);
      lastError = err;
    }
  }

  // Ambos fallaron
  console.error('[price] All providers failed for', symbol, ':', lastError?.message);
  return res.status(503).json({
    error:    'Price data temporarily unavailable',
    symbol,
    detail:   lastError?.message ?? 'Unknown error',
  });
}
