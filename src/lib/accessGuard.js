/**
 * accessGuard.js — Access Validation Layer
 *
 * LOOKUP STRATEGY (dual, consistent):
 *
 * loadUserProfile(email, authUid) intenta dos lookups en orden:
 *
 *   1. Por auth UID → .eq('id', authUid)
 *      Funciona si users_access.id = auth.users.id (foreign key a auth.users)
 *
 *   2. Por email    → .eq('email', emailClean)
 *      Fallback siempre válido (email es UNIQUE en users_access)
 *
 * Si la tabla fue creada con id = auth.users.id (patrón común Supabase),
 * el lookup por UID es más fiable y no depende de normalización de email.
 * Si la tabla tiene su propio UUID auto-generado, el fallback por email actúa.
 *
 * AuthProvider debe pasar ambos: loadUserProfile(authUser.email, authUser.id)
 */

import { supabase } from './supabase.js';
import { normalizeEmail } from './authService.js';

// ─── LOAD PROFILE ─────────────────────────────────────────────────────────────
/**
 * @param {string}      email    - auth user email (fallback key)
 * @param {string|null} authUid  - auth.users.id (primary key attempt)
 * @returns {{ profile: Object|null, error: Error|null }}
 */
export async function loadUserProfile(email, authUid = null) {
  try {
    // ── Attempt 1: lookup by auth UID ─────────────────────────────────────
    if (authUid) {
      const { data: byId, error: uidError } = await supabase
        .from('users_access')
        .select('*')
        .eq('id', authUid)
        .maybeSingle();

      if (!uidError && byId) {
        console.log('[accessGuard] Profile found by UID');
        return { profile: byId, error: null };
      }

      if (uidError) {
        console.warn('[accessGuard] UID lookup failed, trying email:', uidError.message);
      }
    }

    // ── Attempt 2: fallback lookup by email ───────────────────────────────
    const emailClean = normalizeEmail(email);
    const { data: byEmail, error: emailError } = await supabase
      .from('users_access')
      .select('*')
      .eq('email', emailClean)
      .maybeSingle();

    if (emailError) {
      console.error('[accessGuard] Email lookup error:', emailError.message);
      return { profile: null, error: emailError };
    }

    if (byEmail) {
      console.log('[accessGuard] Profile found by email');
    }

    return { profile: byEmail ?? null, error: null };

  } catch (err) {
    console.error('[accessGuard] loadUserProfile caught:', err.message);
    return { profile: null, error: err };
  }
}

// ─── LOAD SUBSCRIPTION ────────────────────────────────────────────────────────
/**
 * @param {string} userId - users_access.id (not necessarily = auth.users.id)
 */
export async function loadUserSubscription(userId) {
  if (!userId) return { subscription: null, error: null };

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[accessGuard] loadUserSubscription error:', error.message);
      return { subscription: null, error };
    }

    return { subscription: data ?? null, error: null };

  } catch (err) {
    console.error('[accessGuard] loadUserSubscription caught:', err.message);
    return { subscription: null, error: err };
  }
}

// ─── TRIAL EXPIRED ────────────────────────────────────────────────────────────
export function isTrialExpired(profile) {
  if (!profile) return true;
  const plan = (profile.plan ?? '').toLowerCase();
  if (plan !== 'trial') return false;
  const expires = profile.expires_at;
  if (!expires) return false;
  return new Date(expires) < new Date();
}

// ─── HAS ACTIVE ACCESS ────────────────────────────────────────────────────────
export function hasActiveAccess(profile, subscription) {
  if (!profile) return false;
  const validStatuses = ['active', 'trial'];
  const status = (profile.status ?? '').toLowerCase();
  if (!validStatuses.includes(status)) return false;
  if ((profile.plan ?? '').toLowerCase() === 'trial' && isTrialExpired(profile)) return false;
  if (subscription && subscription.status !== 'active') return false;
  return true;
}

// ─── GET ACCESS STATUS ────────────────────────────────────────────────────────
export function getAccessStatus(profile, subscription) {
  if (!profile) {
    return {
      hasAccess: false, reason: 'profile_not_found',
      plan: '—', status: 'unknown', expiresAt: null, isExpired: false,
    };
  }

  const trialExpired = isTrialExpired(profile);
  const active       = hasActiveAccess(profile, subscription);

  let reason = 'active';
  if (!active) {
    if (trialExpired)                             reason = 'trial_expired';
    else if (profile.status === 'suspended')      reason = 'suspended';
    else if (profile.status === 'cancelled')      reason = 'cancelled';
    else if (subscription?.status === 'past_due') reason = 'payment_failed';
    else                                          reason = 'no_access';
  }

  return {
    hasAccess: active,
    reason,
    plan:      profile.plan       ?? 'trial',
    status:    profile.status     ?? 'unknown',
    expiresAt: profile.expires_at ?? null,
    isExpired: trialExpired,
  };
}
