/**
 * src/services/priceService.js — Polling de precio via proxy serverless
 *
 * REEMPLAZA: twelveDataService.js y finnhubRESTService.js
 *
 * En lugar de llamar directamente a Finnhub/TwelveData desde el navegador
 * (exponiendo las API keys en el bundle), este servicio hace polling a
 * /api/price — un endpoint serverless que guarda las keys en el servidor.
 *
 * La lógica de construcción de velas OHLC se mantiene idéntica al
 * twelveDataService.js original para no romper nada en App.jsx.
 *
 * Uso (igual que antes):
 *   import { startPricePolling, stopPricePolling } from './services/priceService.js';
 *   startPricePolling('EUR/USD');
 *   return () => stopPricePolling();
 */

import { injectCandle } from '../data/priceStore.js';

// ── Estado interno ────────────────────────────────────────────────────────────
let _interval       = null;
let _currentCandle  = null;
let _currentMinute  = null;

// ── Constructor de vela OHLC 1 minuto ─────────────────────────────────────────
// Lógica idéntica a twelveDataService.js original
function buildCandle(price) {
  const now = Math.floor(Date.now() / 60_000);

  if (_currentMinute !== now) {
    // Cierre de vela anterior
    if (_currentCandle) {
      injectCandle(_currentCandle);
    }

    // Nueva vela
    _currentMinute = now;
    _currentCandle = {
      time:  now * 60,
      open:  price,
      high:  price,
      low:   price,
      close: price,
    };
  } else if (_currentCandle) {
    // Actualizar vela en curso
    _currentCandle.high  = Math.max(_currentCandle.high, price);
    _currentCandle.low   = Math.min(_currentCandle.low,  price);
    _currentCandle.close = price;
    injectCandle({ ..._currentCandle });
  }
}

// ── Fetch al proxy serverless ─────────────────────────────────────────────────
async function fetchPrice(symbol) {
  try {
    const res = await fetch(
      `/api/price?symbol=${encodeURIComponent(symbol)}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8_000),
      }
    );

    if (!res.ok) {
      console.warn(`[priceService] /api/price HTTP ${res.status} for ${symbol}`);
      return;
    }

    const data = await res.json();

    if (typeof data?.price !== 'number' || data.price === 0) {
      console.warn('[priceService] Invalid price in response:', data);
      return;
    }

    buildCandle(data.price);

  } catch (err) {
    // AbortError es esperado cuando stopPricePolling cancela el fetch
    if (err?.name !== 'AbortError') {
      console.error('[priceService] Fetch error:', err?.message ?? err);
    }
  }
}

// ── API pública ───────────────────────────────────────────────────────────────
export function startPricePolling(symbol = 'EUR/USD', intervalMs = 10_000) {
  stopPricePolling();

  console.log(`[priceService] Starting polling for ${symbol} every ${intervalMs}ms`);

  // Fetch inmediato al arrancar
  fetchPrice(symbol);

  _interval = setInterval(() => {
    fetchPrice(symbol);
  }, intervalMs);
}

export function stopPricePolling() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  // Resetear estado de vela para que la próxima sesión empiece limpia
  _currentCandle = null;
  _currentMinute = null;
}
