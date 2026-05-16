/**
 * src/services/priceService.js — v3 (AUTH-SAFE + JWT)
 */

import { injectCandle } from '../data/priceStore.js';
import { supabase }     from '../lib/supabase.js';

// ── Estado interno ─────────────────────────────────────────────
let _interval         = null;
let _currentCandle    = null;
let _currentMinute    = null;
let _isFetching       = false;
let _isRunning        = false;
let _consecutiveFails = 0;
const MAX_BACKOFF_MS  = 60_000; // 1 min máximo entre reintentos tras fallos

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
  if (_isFetching) return;
  _isFetching = true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // Obtener el JWT de la sesión activa para autenticar la petición
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { 'Accept': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const res = await fetch(
      `/api/price?symbol=${encodeURIComponent(symbol)}`,
      { method: 'GET', headers, signal: controller.signal }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[priceService] /api/price HTTP ${res.status} for ${symbol}`);
      return;
    }

    const data = await res.json();

    if (typeof data?.price !== 'number' || data.price === 0) {
      console.warn('[priceService] Invalid price:', data);
      _consecutiveFails++;
      return;
    }

    _consecutiveFails = 0;
    buildCandle(data.price);

  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[priceService] Fetch error:', err?.message ?? err);
    }
    _consecutiveFails++;
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
    // Back-off exponencial tras fallos consecutivos (max MAX_BACKOFF_MS)
    if (_consecutiveFails > 0) {
      const backoff = Math.min(intervalMs * Math.pow(2, _consecutiveFails - 1), MAX_BACKOFF_MS);
      const sinceLastFail = Date.now() % backoff;
      if (sinceLastFail < intervalMs) return; // skip este tick
    }
    fetchPrice(symbol);
  }, intervalMs);
}

export function stopPricePolling() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }

  _isRunning        = false;
  _isFetching       = false;
  _consecutiveFails = 0;

  _currentCandle = null;
  _currentMinute = null;

  console.log('[priceService] Polling stopped');
}
