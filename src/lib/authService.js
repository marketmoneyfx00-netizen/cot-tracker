/**
 * authService.js — v4 (NUEVO USUARIO: magic link con shouldCreateUser:true)
 *
 * CAMBIO CRÍTICO:
 *   shouldCreateUser: true  ← permite que usuarios nuevos se creen via magic link
 *
 * FLUJO CORRECTO PARA NUEVOS USUARIOS:
 *   1. Usuario introduce email
 *   2. signInWithOtp({ shouldCreateUser: true }) → Supabase crea auth.users si no existe
 *   3. Usuario recibe email con magic link
 *   4. Click en enlace → /auth/callback → exchangeCodeForSession → SIGNED_IN
 *   5. Trigger on_auth_user_created → crea fila en users_access automáticamente
 *   6. AuthProvider.loadProfile con retry → encuentra la fila
 *   7. Usuario entra al dashboard con onboarding modal
 *
 * Por qué shouldCreateUser:true es seguro aquí:
 *   - Sólo permite login a quien recibe el email (el email es la verificación)
 *   - El trigger crea users_access con plan='trial' y status='active'
 *   - El acceso real se controla por plan/expires_at, no por existir en auth.users
 */

import { supabase } from './supabase.js';

// ─── Normalize email ──────────────────────────────────────────────────────────
export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, '')
    .replace(/\uFEFF/g, '')
    .normalize('NFKC');
}

// ─── LOGIN WITH PASSWORD ──────────────────────────────────────────────────────
export async function loginWithPassword(email, password) {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@')) {
    return { data: null, error: new Error('Email inválido') };
  }
  if (!password) {
    return { data: null, error: new Error('Introduce tu contraseña') };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailClean,
    password,
  });

  return { data, error };
}

// ─── LOGIN WITH MAGIC LINK (OTP) ──────────────────────────────────────────────
/**
 * CRÍTICO: shouldCreateUser: true
 *
 * Esto permite que un usuario nuevo reciba el magic link y entre directamente.
 * Supabase crea la fila en auth.users al hacer click en el enlace.
 * El trigger on_auth_user_created crea la fila en users_access.
 *
 * Sin esto: los usuarios nuevos reciben 422 → mensaje de error → no pueden entrar.
 */
export async function loginWithEmail(email) {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@')) {
    return { error: new Error('Email inválido') };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: emailClean,
    options: {
      emailRedirectTo: 'https://cot-tracker.vercel.app/auth/callback',
      shouldCreateUser: true,  // ← CRÍTICO: permite nuevos usuarios
    },
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    // Rate limit
    if (msg.includes('rate limit') || msg.includes('too many') || error.status === 429) {
      return { error: new Error('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.') };
    }
    // Email inválido/bloqueado
    if (msg.includes('invalid email') || msg.includes('unable to validate')) {
      return { error: new Error('Email inválido. Comprueba que está bien escrito.') };
    }
    return { error };
  }

  return { error: null };
}

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
export async function resetPassword(email) {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@')) {
    return { error: new Error('Email inválido') };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(emailClean, {
    redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
  });

  return { error };
}

// ─── UPDATE PASSWORD (for logged-in users) ────────────────────────────────────
export async function updatePassword(newPassword) {
  if (!newPassword || newPassword.length < 8) {
    return { error: new Error('La contraseña debe tener al menos 8 caracteres') };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error };
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export async function logout() {
  const { error } = await supabase.auth.signOut();
  return { error: error || null };
}

// ─── GET SESSION ──────────────────────────────────────────────────────────────
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[authService] getSession error:', error.message);
    return null;
  }
  return data?.session ?? null;
}

// ─── GET USER ─────────────────────────────────────────────────────────────────
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
}

// ─── AUTH STATE LISTENER ──────────────────────────────────────────────────────
export function listenAuthChanges(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}

// ─── LOG LOGIN EVENT ──────────────────────────────────────────────────────────
export async function logLoginEvent(userId, success, failReason = null) {
  try {
    const { error } = await supabase.from('login_logs').insert({
      user_id:     userId,
      login_time:  new Date().toISOString(),
      device:      navigator.userAgent.slice(0, 250),
      success,
      fail_reason: failReason,
    });
    if (error && !error.message?.includes('42P01') && !error.code?.includes('42501')) {
      console.warn('[authService] login_log:', error.message);
    }
  } catch {
    // Fire-and-forget
  }
}

// ─── UPDATE LAST LOGIN ────────────────────────────────────────────────────────
export async function updateLastLogin(authUserId) {
  if (!authUserId) return;
  try {
    await supabase
      .from('users_access')
      .update({ last_login: new Date().toISOString() })
      .eq('auth_user_id', authUserId);
  } catch (err) {
    console.warn('[authService] updateLastLogin failed:', err.message);
  }
}
