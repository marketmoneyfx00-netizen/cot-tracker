/**
 * useOnboarding.js — v3 (IDEMPOTENT, DOUBLE-PERSISTED)
 *
 * Root cause of the repeat-popup bug:
 *   1. forceSetup=true (URL ?setup=1) bypassed the DB flag check for returning users
 *      when profile.onboarding_completed hadn't propagated yet from the DB round-trip.
 *   2. The useEffect fired again on every SIGNED_IN event (AuthProvider re-emits it
 *      on token refresh), resetting `show` to true if the profile object was re-created.
 *   3. No localStorage guard → page reload with ?setup=1 in URL = popup again.
 *
 * Fix: dual persistence.
 *   - localStorage 'cot_onboarding_done' = 'true'  → set on complete(), checked on init
 *   - users_access.onboarding_completed = true       → DB source of truth
 *   Either flag being true prevents the popup from ever showing again.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

const LS_KEY = 'cot_onboarding_done';

export function useOnboarding(profile) {
  const [show, setShow] = useState(false);

  // Tracks whether the user completed onboarding in this session.
  // Prevents the useEffect from re-showing the modal while the DB/auth
  // refresh propagates (profile.onboarding_completed may still be false
  // for a few hundred ms after complete() is called).
  const completedRef = useRef(false);

  // Sync with profile whenever it arrives or changes.
  useEffect(() => {
    // Already completed in this session → never re-show
    if (completedRef.current) return;

    // localStorage check: fastest guard, survives page reloads
    if (localStorage.getItem(LS_KEY) === 'true') return;

    if (!profile) return; // still loading

    const shouldShow = profile.onboarding_completed !== true;
    console.log('[onboarding] profile loaded → show:', shouldShow,
      '| onboarding_completed:', profile.onboarding_completed);

    // If DB says completed → also stamp localStorage (covers stale sessions)
    if (!shouldShow) {
      localStorage.setItem(LS_KEY, 'true');
    }

    setShow(shouldShow);
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    profile?.auth_user_id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    profile?.onboarding_completed,
  ]);

  /** Call when the user finishes or skips the tour. */
  const complete = useCallback(async (data) => {
    completedRef.current = true;
    setShow(false);

    // Stamp localStorage IMMEDIATELY — this is the primary guard against
    // re-showing on page reload or token refresh before DB propagates.
    localStorage.setItem(LS_KEY, 'true');

    if (!profile?.auth_user_id) {
      console.warn('[onboarding] No auth_user_id — skipping DB update');
      return;
    }

    // Support both new { market, tradingLevel, tradingGoal } object and legacy string
    const marketSelected = (typeof data === 'object' && data !== null) ? data.market       : data;
    const tradingLevel   = (typeof data === 'object' && data !== null) ? data.tradingLevel  : null;
    const tradingGoal    = (typeof data === 'object' && data !== null) ? data.tradingGoal   : null;

    const patch = {
      onboarding_completed: true,
      ...(profile?.first_login_at ? {} : { first_login_at: new Date().toISOString() }),
      ...(marketSelected ? { market_selected: marketSelected } : {}),
      ...(tradingLevel   ? { trading_level: tradingLevel }     : {}),
      ...(tradingGoal    ? { trading_goal: tradingGoal }       : {}),
    };

    try {
      await supabase
        .from('users_access')
        .update(patch)
        .eq('auth_user_id', profile.auth_user_id);

      console.log('[onboarding] DB updated:', patch);
    } catch (err) {
      console.warn('[onboarding] Supabase update failed (localStorage guard still active):', err?.message);
    }
  }, [profile]);

  /** Re-show the tour (e.g. from Settings → "Ver tour de nuevo"). */
  const reset = useCallback(async () => {
    completedRef.current = false;
    // Clear localStorage so the popup is allowed again
    localStorage.removeItem(LS_KEY);
    setShow(true); // optimistic show FIRST

    if (!profile?.auth_user_id) {
      console.warn('[onboarding] No auth_user_id — showing modal locally only');
      return;
    }

    try {
      await supabase
        .from('users_access')
        .update({ onboarding_completed: false })
        .eq('auth_user_id', profile.auth_user_id);

      console.log('[onboarding] reset OK');
    } catch (err) {
      console.warn('[onboarding] reset DB write failed (non-fatal):', err?.message);
    }
  }, [profile]);

  return { show, complete, reset };
}
