/**
 * multiPriceService.js — Real-time price polling for all FX pairs.
 *
 * Polls /api/price for each pair on a staggered schedule to avoid
 * bursting the API. Each pair is polled every POLL_INTERVAL_MS,
 * with STAGGER_MS delay between pairs.
 *
 * Pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CAD, AUD/USD, NZD/USD, DXY
 */

import { setLivePrice } from '../data/livePriceStore.js';
import { supabase }     from '../lib/supabase.js';

export const ALL_PAIRS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
  'USD/CAD', 'AUD/USD', 'NZD/USD', 'USD Index',
];

const POLL_INTERVAL_MS = 15_000; // poll each pair every 15s
const STAGGER_MS       = 1_800;  // 1.8s between pairs → full cycle in ~14s
const FETCH_TIMEOUT_MS = 8_000;

// Map app pair names to API symbols
const API_SYMBOL_MAP = {
  'USD Index': 'DXY',
};
function toApiSymbol(pair) {
  return API_SYMBOL_MAP[pair] || pair;
}

let _timers  = [];
let _running = false;

async function getAuthHeaders() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }
      : { Accept: 'application/json' };
  } catch {
    return { Accept: 'application/json' };
  }
}

async function fetchPairPrice(pair) {
  const sym = toApiSymbol(pair);
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const headers    = await getAuthHeaders();

    const r = await fetch(`/api/price?symbol=${encodeURIComponent(sym)}`, {
      method: 'GET', headers, signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) return;
    const data = await r.json();
    if (typeof data?.price === 'number' && data.price > 0) {
      setLivePrice(pair, data.price, data.provider || 'api');
    }
  } catch { /* silent — network errors are non-critical */ }
}

export function startMultiPricePolling() {
  if (_running) return;
  _running = true;

  ALL_PAIRS.forEach((pair, i) => {
    // Initial staggered fetch
    const initDelay = setTimeout(() => fetchPairPrice(pair), i * STAGGER_MS);

    // Recurring poll — staggered so all pairs don't hit at exactly the same time
    const id = setInterval(() => fetchPairPrice(pair), POLL_INTERVAL_MS);

    _timers.push(initDelay, id);
  });
}

export function stopMultiPricePolling() {
  _timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  _timers  = [];
  _running = false;
}
