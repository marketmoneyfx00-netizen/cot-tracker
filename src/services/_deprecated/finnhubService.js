const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

let _interval = null;
let _currentCandle = null;
let _currentMinute = null;

import { injectCandle } from '../hooks/usePriceStore.js';

function buildCandle(price) {
  const candle = {
    time: Math.floor(Date.now() / 1000),
    open: price,
    high: price,
    low: price,
    close: price,
  };

  console.log('[CANDLE]', candle);
  injectCandle(candle);
}

async function fetchPrice(symbol) {
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${API_KEY}`
    );

    const data = await res.json();

    console.log('[TWELVE RAW]', data); // 👈 DEBUG REAL

    if (!data || !data.price) {
      console.warn('[TWELVE ERROR]', data);
      return;
    }

    const price = parseFloat(data.price);

    console.log('[PRICE RAW]', symbol, price);

    buildCandle(price);

  } catch (err) {
    console.error('[TwelveData] Error:', err);
  }
}

export function startREST(symbol = 'OANDA:EUR_USD', intervalMs = 5000) {
  if (!API_KEY) {
    console.error('[Finnhub REST] API KEY no configurada');
    return;
  }

  stopREST();

  console.log(`[REST] Iniciando polling para ${symbol}`);

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