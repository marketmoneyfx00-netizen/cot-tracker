/**
 * finnhubRESTService.js — Precio real via Finnhub REST (polling cada 5s)
 */

import { injectCandle } from '../data/priceStore.js';

// ── Estado del servicio ───────────────────────────────────────────────────────
let _interval = null;
let _currentCandle = null;
let _currentMinute = null;
let _lastInjectedTime = null; // 🔥 evita duplicados EXACTOS

// ── Constructor de vela OHLC 1 minuto ─────────────────────────────────────────
function buildCandle(price) {
  const now = Math.floor(Date.now() / 60000);

  console.log('🔥 buildCandle ejecutándose', price);

  // 🟢 PRIMERA VELA
  if (!_currentCandle) {
    _currentMinute = now;

    _currentCandle = {
      time: now * 60,
      open: price,
      high: price,
      low: price,
      close: price,
    };

    console.log('🟢 Primera vela creada', _currentCandle);

    _lastInjectedTime = _currentCandle.time;
    injectCandle({ ..._currentCandle });

    return;
  }

  // 🔴 CAMBIO DE MINUTO
  if (_currentMinute !== now) {
    console.log('🔴 Cierre de vela', _currentCandle);

    injectCandle({ ..._currentCandle });

    _currentMinute = now;

    _currentCandle = {
      time: now * 60,
      open: price,
      high: price,
      low: price,
      close: price,
    };

    console.log('🆕 Nueva vela abierta', _currentCandle);

    _lastInjectedTime = _currentCandle.time;
    injectCandle({ ..._currentCandle });

    return;
  }

  // 🟡 ACTUALIZACIÓN EN TIEMPO REAL
  _currentCandle.high = Math.max(_currentCandle.high, price);
  _currentCandle.low = Math.min(_currentCandle.low, price);
  _currentCandle.close = price;

  // 🚫 evitar spam inútil si no cambia nada
  if (_lastInjectedTime === _currentCandle.time && price === _currentCandle.close) {
    return;
  }

  console.log('🟡 Actualizando vela en vivo', _currentCandle);

  _lastInjectedTime = _currentCandle.time;

  injectCandle({
    time: _currentCandle.time,
    open: _currentCandle.open,
    high: _currentCandle.high,
    low: _currentCandle.low,
    close: _currentCandle.close,
  });
}

// ── Fetch de precio ───────────────────────────────────────────────────────────
async function fetchPrice(symbol) {
  const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

  if (!API_KEY) {
    console.error('[Finnhub REST] VITE_FINNHUB_API_KEY no configurada.');
    stopREST();
    return;
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`
    );

    if (!res.ok) {
      console.warn(`[Finnhub REST] HTTP ${res.status} para ${symbol}`);
      return;
    }

    const data = await res.json();

    if (!data || typeof data.c !== 'number' || data.c === 0) {
      console.warn('[Finnhub REST] Precio inválido:', data);
      return;
    }

    console.log('📡 PRICE RAW', symbol, data.c);

    // 🧪 TEST DIRECTO (CLAVE PARA DEBUG)
    if (!window.__TESTED__) {
      window.__TESTED__ = true;

      console.log('🧪 TEST directo a injectCandle');

      injectCandle({
        time: Date.now(),
        open: data.c,
        high: data.c,
        low: data.c,
        close: data.c,
      });
    }

    buildCandle(data.c);

  } catch (err) {
    console.error('[Finnhub REST] Error de red:', err?.message ?? err);
  }
}

// ── API pública ───────────────────────────────────────────────────────────────
export function startREST(symbol = 'OANDA:EUR_USD', intervalMs = 5000) {
  const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

  if (!API_KEY) {
    console.error('[Finnhub REST] API KEY no configurada');
    return;
  }

  stopREST();

  console.log(`🚀 REST iniciado para ${symbol} cada ${intervalMs}ms`);

  fetchPrice(symbol);

  _interval = setInterval(() => {
    fetchPrice(symbol);
  }, intervalMs);
}

export function stopREST() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}