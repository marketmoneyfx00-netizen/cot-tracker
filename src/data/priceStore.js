console.log('🔥 PRICE STORE INSTANCE');

// 🔥 listeners (suscriptores React)
let listeners = [];

let candles = [];

const MAX = 10;

// ── NOTIFICAR CAMBIOS ─────────────────────────────────
function notify() {
  listeners.forEach((cb) => cb([...candles]));
}

// ── SUBSCRIBIRSE ──────────────────────────────────────
export function subscribe(callback) {
  listeners.push(callback);

  // devolver unsubscribe
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

// ── INYECTAR VELA ─────────────────────────────────────
export function injectCandle(candle) {
  if (!candle || !candle.time) return;

  const index = candles.findIndex(c => c.time === candle.time);

  if (index !== -1) {
    candles[index] = candle;
  } else {
    candles.push(candle);
    if (candles.length > MAX) candles.shift();
  }

  console.log('📊 [priceStore UPDATED]', candles);

  notify(); // 🔥 CLAVE
}

// ── LEER VELAS ────────────────────────────────────────
export function getLastCandles(n = 3) {
  return candles.slice(-n);
}