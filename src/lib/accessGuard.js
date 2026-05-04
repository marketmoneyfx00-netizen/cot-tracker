/**
 * src/lib/accessGuard.js — v8 (DETERMINISTA, SIN BGLOOP)
 *
 * El background loop y el synthetic profile como solución prolongada
 * han sido ELIMINADOS. La garantía de fila en users_access es ahora
 * responsabilidad de AuthCallback antes de redirigir a la app.
 *
 * FLUJO DE CARGA:
 *   1. Retry × 5 con backoff (~4s total)
 *      — Cubre la race condition del trigger handle_new_user
 *      — Para nuevos usuarios: AuthCallback ya creó la fila, intento 0 la encuentra
 *      — Para re-logins: fila existe desde el primer login
 *
 *   2. RPC ensure_user_access (SECURITY DEFINER)
 *      — Último recurso si los 5 reintentos no encuentran fila
 *      — Cubre edge cases: DB delayed, usuario con password (no pasa por AuthCallback)
 *
 *   3. Re-fetch tras RPC
 *      — Confirma que la fila fue creada
 *
 *   4. Si aún no hay fila: error real (DB caída, RPC no deployado)
 *      — accessStatus.reason = 'db_error'
 *      — App muestra pantalla de error con retry, no bloqueo de paywall
 *      — NO synthetic profile de larga duración
 *
 * CASOS DE USO Y RESULTADO ESPERADO:
 *   Usuario nuevo vía magic link:        intento 0 → fila ya existe (AuthCallback)
 *   Re-login con contraseña:             intento 0 → fila existe (primer login la creó)
 *   Trigger retrasado:                   intento 2-3 → fila encontrada
 *   Trigger sin deployar + RPC OK:       retry × 5 → RPC crea fila → re-fetch OK
 *   DB temporalmente caída:              todos los intentos fallan → error explícito
 */

import { supabase } from './supabase.js';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [0, 600, 800, 1200, 1600]; // 5 intentos, ~4.2s total

const PROFILE_SELECT =
  'id, email, plan, status, auth_user_id, stripe_customer_id, ' +
  'expires_at, access_type, onboarding_completed, first_login_at, ' +
  'market_selected, telegram_username, created_at, last_login, ' +
  'password_created, trading_level, trading_goal';

// ─── LOAD PROFILE ─────────────────────────────────────────────────────────────

export async function loadUserProfile(authUid, authUser = null) {
  if (!authUid) {
    console.error('[accessGuard] No authUid');
    return { profile: null, error: new Error('authUid required') };
  }

  let lastError = null;

  // ── Capa 1: Retry con backoff ─────────────────────────────────────────────
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }

    try {
      const { data, error } = await supabase
        .from('users_access')
        .select(PROFILE_SELECT)
        .eq('auth_user_id', authUid)
        .maybeSingle();

      if (error) {
        console.warn(`[accessGuard] Attempt ${attempt + 1} DB error:`, error.message);
        lastError = error;
        continue;
      }

      if (data) {
        if (attempt > 0) {
          console.log(`[accessGuard] Profile found on retry ${attempt + 1} for:`, authUid);
        }
        return { profile: data, error: null };
      }

      if (attempt < RETRY_DELAYS_MS.length - 1) {
        console.log(`[accessGuard] No row (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}), retrying`);
      }

    } catch (err) {
      console.warn(`[accessGuard] Attempt ${attempt + 1} exception:`, err.message);
      lastError = err;
    }
  }

  // ── Capa 2: RPC ensure_user_access (SECURITY DEFINER) ────────────────────
  if (authUser?.id && authUser?.email) {
    console.warn('[accessGuard] Calling ensure_user_access RPC for:', authUser.email);

    try {
      const { error: rpcErr } = await supabase.rpc('ensure_user_access', {
        p_auth_user_id: authUser.id,
        p_email:        authUser.email,
      });

      if (rpcErr) {
        console.error('[accessGuard] RPC error:', rpcErr.code, rpcErr.message);
      }

      // ── Capa 3: Re-fetch tras RPC ─────────────────────────────────────────
      const { data: row, error: fetchErr } = await supabase
        .from('users_access')
        .select(PROFILE_SELECT)
        .eq('auth_user_id', authUser.id)
        .maybeSingle();

      if (!fetchErr && row) {
        console.log('[accessGuard] Profile created by RPC for:', authUser.email);
        return { profile: row, error: null };
      }
    } catch (err) {
      console.error('[accessGuard] RPC exception:', err.message);
      lastError = err;
    }
  }

  // ── Error real: DB no disponible o RPC no deployado ───────────────────────
  // Para usuarios que llegaron por AuthCallback: esto no debería ocurrir
  // (AuthCallback ya garantizó la fila). Si ocurre, es un error de infraestructura.
  // Para re-logins con contraseña: la fila existe desde el primer login.
  // Si llega aquí: la DB está caída o hay un problema grave.
  console.error(
    '[accessGuard] Profile unresolvable after all attempts for:', authUid,
    '— Likely DB connectivity issue or ensure_user_access RPC not deployed'
  );

  return {
    profile: null,
    error: lastError ?? new Error('db_error'),
  };
}

// ─── STUBS ────────────────────────────────────────────────────────────────────

export async function loadUserSubscription(_unused) {
  return { subscription: null, error: null };
}

// ─── ACCESS HELPERS ───────────────────────────────────────────────────────────

export function hasActiveAccess(profile) {
  if (!profile) return false;
  const status = (profile.status ?? '').toLowerCase();
  if (status !== 'active' && status !== 'trial' && status !== 'free') return false;
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

export function getAccessStatus(profile) {
  if (!profile) {
    return {
      hasAccess: false,
      reason:    'db_error',
      plan:      'none',
      status:    'error',
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
    else if (status === 'suspended') reason = 'suspended';
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
