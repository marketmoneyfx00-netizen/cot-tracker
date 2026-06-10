/**
 * src/lib/accessGuard.js — v11
 *
 * Con el fix de AuthProvider (setTimeout(0)), loadUserProfile ya NO se llama
 * desde dentro del lock de Supabase. getSession() puede completarse sin
 * deadlock. Los reintentos aquí son para el caso de "row not found" (el trigger
 * de DB que crea la fila puede tardar unos ms) no para errores de lock.
 */

import { supabase } from './supabase.js';

const PROFILE_SELECT =
  'id, email, plan, status, auth_user_id, stripe_customer_id, ' +
  'expires_at, access_type, onboarding_completed, first_login_at, ' +
  'market_selected, telegram_username, created_at, last_login, ' +
  'password_created, trading_level, trading_goal';

// Delays para "row not found" — el trigger de DB puede tardar unos ms
const RETRY_DELAYS = [0, 500, 800, 1200, 1800];

// Lock global: evita dos loadUserProfile simultáneos
// Expiry garantiza liberación tras 30s aunque el fetch cuelgue (iOS Safari)
let isLoadingProfile = false;
let _lockExpiry      = 0;
const LOCK_TIMEOUT_MS = 30_000;

export async function loadUserProfile(authUid, authUser = null) {
  if (!authUid) {
    console.error('[accessGuard] No authUid');
    return { profile: null, error: new Error('authUid required') };
  }

  const lockStale = isLoadingProfile && Date.now() > _lockExpiry;
  if (lockStale) {
    console.warn('[accessGuard] Stale lock detected — forcing release');
    isLoadingProfile = false;
  }

  if (isLoadingProfile) {
    console.warn('[accessGuard] Prevented duplicate call');
    return { profile: null, error: new Error('already_loading') };
  }

  isLoadingProfile = true;
  _lockExpiry      = Date.now() + LOCK_TIMEOUT_MS;

  try {
    let lastError = null;

    // ── Fase 1: reintentos simples (el trigger puede tardar en crear la fila) ──
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      if (RETRY_DELAYS[i] > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
      }

      try {
        const { data, error } = await supabase
          .from('users_access')
          .select(PROFILE_SELECT)
          .eq('auth_user_id', authUid)
          .maybeSingle();

        if (error) {
          console.warn(`[accessGuard] Attempt ${i + 1} error:`, error.message);
          lastError = error;

          // Si es un error de lock inesperado, esperar más antes de reintentar
          const isLock = error.message?.toLowerCase().includes('lock') ||
                         error.message?.toLowerCase().includes('stole');
          if (isLock) {
            await new Promise(r => setTimeout(r, 2000));
          }
          continue;
        }

        if (data) {
          console.log('[accessGuard] Profile found on attempt', i + 1);
          return { profile: data, error: null };
        }

        console.log(`[accessGuard] Row not yet available (attempt ${i + 1})`);

      } catch (err) {
        console.warn(`[accessGuard] Attempt ${i + 1} exception:`, err.message);
        lastError = err;
      }
    }

    // ── Fase 2: RPC fallback (una sola vez) ──────────────────────────────────
    if (authUser?.id && authUser?.email) {
      console.warn('[accessGuard] Calling ensure_user_access RPC');

      try {
        const { error: rpcErr } = await supabase.rpc('ensure_user_access', {
          p_auth_user_id: authUser.id,
          p_email:        authUser.email,
        });

        if (rpcErr) console.error('[accessGuard] RPC error:', rpcErr.message);

        await new Promise(r => setTimeout(r, 500));

        const { data: row, error: fetchErr } = await supabase
          .from('users_access')
          .select(PROFILE_SELECT)
          .eq('auth_user_id', authUser.id)
          .maybeSingle();

        if (!fetchErr && row) {
          console.log('[accessGuard] Profile created via RPC');
          return { profile: row, error: null };
        }

      } catch (err) {
        console.error('[accessGuard] RPC exception:', err.message);
        lastError = err;
      }
    }

    console.error('[accessGuard] Profile could not be resolved');
    return { profile: null, error: lastError ?? new Error('db_error') };

  } finally {
    isLoadingProfile = false;
    _lockExpiry      = 0;
  }
}

export async function loadUserSubscription() {
  return { subscription: null, error: null };
}

export function hasActiveAccess(profile) {
  if (!profile) return false;
  const status = (profile.status ?? '').toLowerCase();

  // Statuses that can have access (subject to expiry check):
  //   active, trial, free — full access
  //   past_due             — grace period: access while valid_until has not expired
  const ALLOWED_STATUSES = ['active', 'trial', 'free', 'past_due'];
  if (!ALLOWED_STATUSES.includes(status)) return false;

  // Expiry check applies to ALL statuses (including past_due grace window)
  const expiry = profile.expires_at ?? profile.valid_until ?? null;
  if (expiry && new Date(expiry) < new Date()) return false;

  return true;
}

export function isTrialExpired(profile) {
  if (!profile) return true;
  const plan = (profile.plan ?? '').toLowerCase();
  if (plan !== 'trial') return false;
  const expires = profile.expires_at ?? null;
  if (!expires) return false;
  return new Date(expires) < new Date();
}

export function getAccessStatus(profile) {
  if (!profile) {
    return { hasAccess: false, reason: 'db_error', plan: 'none', status: 'error', expiresAt: null, isExpired: false };
  }

  const active = hasActiveAccess(profile);
  const status = profile.status  ?? 'unknown';
  const plan   = profile.plan    ?? 'none';
  const expiry = profile.expires_at ?? null;

  let reason = 'active';
  if (!active) {
    if (isTrialExpired(profile))     reason = 'trial_expired';
    else if (status === 'past_due')  reason = 'past_due';
    else if (status === 'cancelled') reason = 'cancelled';
    else if (status === 'expired')   reason = 'expired';
    else if (status === 'suspended') reason = 'suspended';
    else                             reason = 'no_access';
  } else if (status === 'past_due') {
    reason = 'past_due_grace'; // active but in grace period
  }

  return { hasAccess: active, reason, plan, status, expiresAt: expiry, isExpired: isTrialExpired(profile) };
}
