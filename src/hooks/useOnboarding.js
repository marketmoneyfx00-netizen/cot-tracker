/**
 * useOnboarding.js
 * Manages onboarding state and Supabase persistence.
 *
 * FIX 1: The previous useState lazy initializer ran once with profile=null,
 *         permanently setting show=false. Profile arrives async via Supabase,
 *         so the initializer always missed it.
 *         → Now uses useEffect to react when profile loads.
 *
 * FIX 2: After complete() is called the local profile still has
 *         onboarding_completed=false until the DB round-trip + auth refresh.
 *         Without a guard the useEffect would immediately re-show the modal.
 *         → completedRef tracks intent so the effect is skipped.
 *
 * Reads/writes:
 *   users_access.onboarding_completed  boolean
 *   users_access.first_login_at        timestamptz
 *   users_access.market_selected       text
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

export function useOnboarding(profile) {
  // Start hidden — the effect below sets it correctly once profile arrives.
  const [show, setShow] = useState(false);

  // Tracks whether the user completed onboarding in this session.
  // Prevents the useEffect from re-showing the modal while the DB/auth
  // refresh propagates (profile.onboarding_completed may still be false
  // for a few hundred ms after complete() is called).
  const completedRef = useRef(false);

  // Sync with profile whenever it arrives or changes.
  // Dependencies: profile identity (id) + the specific flag we care about.
  useEffect(() => {
    if (completedRef.current) return;   // user already completed — stay hidden
    if (!profile) return;               // still loading
    const shouldShow = profile.onboarding_completed !== true;
    console.log('[onboarding] profile loaded → show:', shouldShow,
      '| onboarding_completed:', profile.onboarding_completed);
    setShow(shouldShow);
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    profile?.auth_user_id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    profile?.onboarding_completed,
  ]);

  /** Call when the user finishes or skips the tour.
   *  @param {object|string|null} data  - Either a data object { market, tradingLevel, tradingGoal }
   *                                      (new shape) or a bare market string (legacy compat).
   */
const complete = useCallback(async (data) => {
  completedRef.current = true;
  setShow(false);

  if (!profile?.auth_user_id) {
    console.warn('[onboarding] No auth_user_id — skipping DB update');
    return;
  }

  // Support both new { market, tradingLevel, tradingGoal } object and legacy string
  const marketSelected  = (typeof data === 'object' && data !== null) ? data.market        : data;
  const tradingLevel    = (typeof data === 'object' && data !== null) ? data.tradingLevel   : null;
  const tradingGoal     = (typeof data === 'object' && data !== null) ? data.tradingGoal    : null;

  const patch = {
    onboarding_completed: true,
    first_login_at: new Date().toISOString(),
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
    console.warn('[onboarding] Supabase update failed:', err?.message);
  }
}, [profile]);

  /** Re-show the tour (e.g. from Settings → "Ver tour de nuevo"). */
const reset = useCallback(async () => {
  completedRef.current = false;
  setShow(true); // ← FIX: optimistic show FIRST, before any async DB call
                 // Previously: setShow(true) was INSIDE the try block after
                 // the await, so if Supabase returned an error the modal
                 // never appeared. DB write is best-effort only.

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
