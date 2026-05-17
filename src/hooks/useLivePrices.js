/**
 * useLivePrices.js — Subscribes to multi-symbol live price store.
 * Returns { 'EUR/USD': { price, ts, source }, ... } updated in real-time.
 */

import { useState, useEffect } from 'react';
import { getAllLivePrices, subscribeLivePrices } from '../data/livePriceStore.js';

export function useLivePrices() {
  const [prices, setPrices] = useState(() => getAllLivePrices());

  useEffect(() => {
    setPrices(getAllLivePrices());
    return subscribeLivePrices(setPrices);
  }, []);

  return prices;
}
