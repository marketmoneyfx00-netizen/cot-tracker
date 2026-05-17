import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

const POLL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetches /api/macro (auth-protected) and returns the nested `signal` object.
 * Shape: { bias, confidence, drivers, implication, chinaContext }
 * Where bias is one of: USD_STRONG | USD_LEANING_STRONG | USD_WEAK | USD_LEANING_WEAK | NEUTRAL
 */
export function useMacroSignal() {
  const [macroSignal, setMacroSignal] = useState(null);
  const timer = useRef(null);

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        Accept: 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const r = await fetch('/api/macro', { headers });
      if (!r.ok) return;
      const payload = await r.json();
      // /api/macro wraps the signal inside payload.signal — extract it
      if (payload?.signal && typeof payload.signal === 'object') {
        setMacroSignal(payload.signal);
      }
    } catch (_) {}
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  return macroSignal;
}
