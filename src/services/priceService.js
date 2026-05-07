/**
 * src/services/priceService.js — v2 (AUTH-SAFE + LOCK-PROOF)
 *
 * FIXES:
 * - No arranca si ya está corriendo (evita duplicados)
 * - No lanza múltiples fetch simultáneos (evita lock Supabase)
 * - Controla estado interno robusto
 * - Preparado para ejecutarse SOLO cuando el usuario esté listo
 */

import { injectCandle } from '../data/priceStore.js';

// ── Estado interno ─────────────────────────────────────────────
let _interval       = null;
let _currentCandle  = null;
let _currentMinute  = null;
let _isFetching     = false;
let _isRunning      = false;

// ── Constructor de vela OHLC 1 minuto ─────────────────────────
function buildCandle(price) {
  const now = Math.floor(Date.now() / 60_000);

  if (_currentMinute !== now) {
    if (_currentCandle) {
      injectCandle(_currentCandle);
    }

    _currentMinute = now;
    _currentCandle = {
      time:  now * 60,
      open:  price,
      high:  price,
      low:   price,
      close: price,
    };
  } else if (_currentCandle) {
    _currentCandle.high  = Math.max(_currentCandle.high, price);
    _currentCandle.low   = Math.min(_currentCandle.low,  price);
    _currentCandle.close = price;

    injectCandle({ ..._currentCandle });
  }
}

// ── Fetch protegido ───────────────────────────────────────────
async function fetchPrice(symbol) {
  // 🚨 evita llamadas concurrentes (clave del bug)
  if (_isFetching) {
    return;
  }

  _isFetching = true;

  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 8000);

    const res = await fetch(
      `/api/price?symbol=${encodeURIComponent(symbol)}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[priceService] /api/price HTTP ${res.status} for ${symbol}`);
      return;
    }

    const data = await res.json();

    if (typeof data?.price !== 'number' || data.price === 0) {
      console.warn('[priceService] Invalid price:', data);
      return;
    }

    buildCandle(data.price);

  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[priceService] Fetch error:', err?.message ?? err);
    }
  } finally {
    _isFetching = false;
  }
}

// ── API pública ───────────────────────────────────────────────
export function startPricePolling(symbol = 'EUR/USD', intervalMs = 10_000) {
  // 🚨 evita múltiples instancias
  if (_isRunning) {
    console.log('[priceService] Already running — skip');
    return;
  }

  stopPricePolling();

  _isRunning = true;

  console.log(`[priceService] Starting polling for ${symbol} every ${intervalMs}ms`);

  // Fetch inicial
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

  _isRunning = false;
  _isFetching = false;

  _currentCandle = null;
  _currentMinute = null;

  console.log('[priceService] Polling stopped');
}
