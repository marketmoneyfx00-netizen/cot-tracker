/**
 * useAllPairCandles.js — Fetches 4H historical OHLC candles for all FX pairs.
 *
 * - Fetches on mount with 400ms stagger between pairs (avoids TwelveData burst)
 * - Refreshes every 30 minutes (4H candles don't change fast)
 * - Returns a map: { 'EUR/USD': [{time,open,high,low,close}, ...], ... }
 * - Candles are sorted oldest → newest
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { ALL_PAIRS } from '../services/multiPriceService.js';

const REFRESH_MS  = 30 * 60_000; // 30 minutes
const STAGGER_MS  = 400;          // 400ms between each pair fetch
const INTERVAL    = '4h';
const OUTPUT_SIZE = '30';         // 30 × 4H = 5 days context

async function fetchCandles(pair, signal) {
  const sym = pair === 'USD Index' ? 'DXY' : pair;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {
      Accept: 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
    const r = await fetch(
      `/api/candles?symbol=${encodeURIComponent(sym)}&interval=${INTERVAL}&outputsize=${OUTPUT_SIZE}`,
      { headers, signal }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data.candles) && data.candles.length > 0 ? data.candles : null;
  } catch {
    return null;
  }
}

export function useAllPairCandles() {
  const [candleMap, setCandleMap] = useState({});
  const timersRef  = useRef([]);
  const abortRef   = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function scheduleRefresh() {
      // Clear any previous timers
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current = [];
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      const { signal } = abortRef.current;

      ALL_PAIRS.forEach((pair, i) => {
        const t = setTimeout(async () => {
          if (cancelled) return;
          const candles = await fetchCandles(pair, signal);
          if (candles && !cancelled) {
            setCandleMap(prev => ({ ...prev, [pair]: candles }));
          }
        }, i * STAGGER_MS);
        timersRef.current.push(t);
      });

      // Schedule next refresh
      const refreshId = setTimeout(() => {
        if (!cancelled) scheduleRefresh();
      }, REFRESH_MS);
      timersRef.current.push(refreshId);
    }

    scheduleRefresh();

    return () => {
      cancelled = true;
      timersRef.current.forEach(t => clearTimeout(t));
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return candleMap;
}
