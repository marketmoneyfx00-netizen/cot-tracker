const API_KEY = import.meta.env.VITE_TWELVEDATA_API_KEY;

let _interval = null;
let _currentCandle = null;
let _currentMinute = null;

// 👉 IMPORTANTE: usa tu injectCandle real
import { injectCandle } from '../data/priceStore.js';

function buildCandle(price) {
  const now = Math.floor(Date.now() / 60000);

  if (_currentMinute !== now) {
    if (_currentCandle) {
      console.log('[CANDLE]', _currentCandle);
      injectCandle(_currentCandle);
    }

    _currentMinute = now;
    _currentCandle = {
      time: now * 60,
      open: price,
      high: price,
      low: price,
      close: price,
    };
  } else {
    _currentCandle.high = Math.max(_currentCandle.high, price);
    _currentCandle.low = Math.min(_currentCandle.low, price);
    _currentCandle.close = price;
  }
}

async function fetchPrice(symbol) {
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${API_KEY}`
    );

    const data = await res.json();

    if (!data || !data.price) {
      console.warn('[TwelveData] Sin precio', data);
      return;
    }

    const price = parseFloat(data.price);

    console.log('[PRICE RAW]', symbol, price);

    buildCandle(price);

  } catch (err) {
    console.error('[TwelveData] Error:', err);
  }
}

export function startTwelveData(symbol = 'EUR/USD', intervalMs = 10000) {
  if (!API_KEY) {
    console.error('[TwelveData] API KEY no configurada');
    return;
  }

  stopTwelveData();

  console.log(`[TwelveData] Iniciando ${symbol}`);

  _interval = setInterval(() => {
    fetchPrice(symbol);
  }, intervalMs);
}

export function stopTwelveData() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}