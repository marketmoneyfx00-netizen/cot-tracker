/**
 * src/lib/accessGuard.js — v5 (RETRY para nuevos usuarios)
 *
 * PROBLEMA RESUELTO:
 *   Cuando un usuario nuevo hace click en el magic link:
 *   1. Supabase crea auth.users (SIGNED_IN event)
 *   2. El trigger on_auth_user_created crea users_access
 *   3. El frontend consulta users_access inmediatamente
 *   → La fila puede no existir todavía (race condition de ~200-800ms)
 *
 * SOLUCIÓN: loadUserProfile con retry exponencial
 *   - Intento 1: inmediato
 *   - Intento 2: 600ms después
 *   - Intento 3: 1.4s después
 *   - Intento 4: 2.6s después
 *   - Intento 5: 4.2s después
 *   Total máx: ~5s antes de darse por vencido
 *
 * Si tras todos los reintentos no hay fila:
 *   → Usuario nuevo sin trigger configurado, o trigger falló
 *   → Crear fila mínima via RPC create_user_access_if_missing
 *   → El usuario entra con plan 'trial'
 */

import { supabase } from './supabase.js';

// ─── RETRY CONFIG ─────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [0, 600, 800, 1200, 1600]; // 5 intentos, total ~4.2s

// ─── LOAD PROFILE WITH RETRY ──────────────────────────────────────────────────
/**
 * Carga el perfil del usuario con retry para manejar la race condition
 * entre auth.users creado y el trigger que crea users_access.
 *
 * @param {string} authUid - auth.users.id (obligatorio)
 * @param {object} authUser - objeto completo del usuario autenticado (para fallback)
 * @returns {{ profile: object|null, error: Error|null }}
 */
export async function loadUserProfile(authUid, authUser = null) {
  if (!authUid) {
    console.error('[accessGuard] loadUserProfile called without authUid');
    return { profile: null, error: new Error('authUid required') };
  }

  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    // Esperar antes del intento (excepto el primero)
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }

    try {
      const { data, error } = await supabase
        .from('users_access')
        .select(
          'id, email, plan, status, auth_user_id, stripe_customer_id, ' +
          'expires_at, access_type, onboarding_completed, first_login_at, ' +
          'market_selected, telegram_username, created_at, last_login'
        )
        .eq('auth_user_id', authUid)
        .maybeSingle();

      if (error) {
        console.warn(`[accessGuard] DB error (attempt ${attempt + 1}):`, error.message);
        lastError = error;
        continue; // reintentar en errores de red
      }

      if (data) {
        if (attempt > 0) {
          console.log(`[accessGuard] Profile found on retry ${attempt + 1} | auth_user_id:`, authUid);
        } else {
          console.log(
            '[accessGuard] Profile found | auth_user_id:', authUid,
            '| status:', data.status,
            '| plan:', data.plan
          );
        }
        return { profile: data, error: null };
      }

      // data es null — fila no existe todavía
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        console.log(
          `[accessGuard] No profile yet (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}) ` +
          `— retrying in ${RETRY_DELAYS_MS[attempt + 1]}ms...`
        );
      }

    } catch (err) {
      console.warn(`[accessGuard] Exception (attempt ${attempt + 1}):`, err.message);
      lastError = err;
    }
  }

  // Todos los reintentos fallaron → usuario nuevo sin trigger
  // Intentar crear la fila via RPC de seguridad
  console.warn(
    '[accessGuard] Profile not found after all retries for:', authUid,
    '— attempting auto-create'
  );

  if (authUser?.id) {
    const created = await ensureUserAccessExists(authUser);
    if (created) {
      return { profile: created, error: null };
    }
  }

  console.error('[accessGuard] Failed to load or create profile for:', authUid);
  return { profile: null, error: lastError ?? new Error('profile_not_found') };
}

// ─── AUTO-CREATE FALLBACK ─────────────────────────────────────────────────────
/**
 * Crea una fila mínima en users_access si no existe.
 * Solo se usa como fallback cuando el trigger falla.
 * Llama al RPC ensure_user_access (ver migration SQL).
 */
async function ensureUserAccessExists(authUser) {
  if (!authUser?.id || !authUser?.email) return null;

  try {
    const { data, error } = await supabase.rpc('ensure_user_access', {
      p_auth_user_id: authUser.id,
      p_email:        authUser.email,
    });

    if (error) {
      console.error('[accessGuard] ensure_user_access RPC failed:', error.message);
      return null;
    }

    console.log('[accessGuard] ensure_user_access created row for:', authUser.email);

    // Re-fetch the profile after creation
    const { data: profile } = await supabase
      .from('users_access')
      .select(
        'id, email, plan, status, auth_user_id, stripe_customer_id, ' +
        'expires_at, access_type, onboarding_completed, first_login_at, ' +
        'market_selected, telegram_username, created_at, last_login'
      )
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    return profile ?? null;
  } catch (err) {
    console.error('[accessGuard] ensureUserAccessExists exception:', err.message);
    return null;
  }
}

// Stub — mantenido para compatibilidad de imports
export async function loadUserSubscription(_unused) {
  return { subscription: null, error: null };
}

// ─── HAS ACTIVE ACCESS ────────────────────────────────────────────────────────
export function hasActiveAccess(profile) {
  if (!profile) return false;
  const status = (profile.status ?? '').toLowerCase();
  if (status !== 'active' && status !== 'trial') return false;
  const expiry = profile.expires_at ?? profile.valid_until ?? null;
  if (expiry && new Date(expiry) < new Date()) return false;
  return true;
}

export function isTrialExpired(profile) {
  if (!profile) return true;
  const plan = (profile.plan ?? profile.plan_id ?? '').toLowerCase();
  if (plan !== 'trial') return false;
  const expires = profile.expires_at ?? profile.valid_until ?? null;
  if (!expires) return false;
  return new Date(expires) < new Date();
}

// ─── GET ACCESS STATUS ────────────────────────────────────────────────────────
export function getAccessStatus(profile) {
  if (!profile) {
    return {
      hasAccess: false,
      reason: 'not_purchased',
      plan: 'none',
      status: 'inactive',
      expiresAt: null,
      isExpired: false,
    };
  }

  const active = hasActiveAccess(profile);
  const status = profile.status ?? 'unknown';
  const plan   = profile.plan ?? profile.plan_id ?? 'none';
  const expiry = profile.expires_at ?? profile.valid_until ?? null;

  let reason = 'active';
  if (!active) {
    if (isTrialExpired(profile))     reason = 'trial_expired';
    else if (status === 'cancelled') reason = 'cancelled';
    else if (status === 'expired')   reason = 'expired';
    else                             reason = 'no_access';
  }

  return {
    hasAccess: active,
    reason,
    plan,
    status,
    expiresAt: expiry,
    isExpired: isTrialExpired(profile),
  };
}
