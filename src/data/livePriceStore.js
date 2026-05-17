/**
 * livePriceStore.js — Multi-symbol live price store.
 *
 * Stores the latest spot price per trading pair.
 * Subscriptions fire whenever ANY price updates.
 */

const prices    = {}; // { 'EUR/USD': { price, ts, source } }
let   listeners = [];

export function setLivePrice(symbol, price, source = 'api') {
  if (typeof price !== 'number' || price <= 0) return;
  prices[symbol] = { price, ts: Date.now(), source };
  listeners.forEach(cb => cb({ ...prices }));
}

export function getLivePrice(symbol) {
  return prices[symbol]?.price ?? null;
}

export function getAllLivePrices() {
  return { ...prices };
}

export function subscribeLivePrices(callback) {
  listeners.push(callback);
  return () => { listeners = listeners.filter(l => l !== callback); };
}
