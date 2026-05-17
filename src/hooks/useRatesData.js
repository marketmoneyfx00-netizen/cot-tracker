import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

const POLL_MS = 4 * 60 * 60 * 1000; // 4 hours — matches server cache TTL

/**
 * Fetches /api/rates (auth-protected) and returns the full payload.
 * Shape: { timestamp, banks: { FED: {...stanceScore}, ... }, pairs: [{pair:'EURUSD', carry_score, stance_divergence, ...}] }
 * Note: pairs[].pair uses NO-SLASH format (EURUSD). Use normalizePairKey() for lookups.
 */
export function useRatesData() {
  const [ratesData, setRatesData] = useState(null);
  const timer = useRef(null);

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        Accept: 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const r = await fetch('/api/rates', { headers });
      if (!r.ok) return;
      const d = await r.json();
      if (d && typeof d === 'object') setRatesData(d);
    } catch (_) {}
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  return ratesData;
}
