/**
 * authService.js — Supabase Auth Service (Hybrid: Password + Magic Link)
 *
 * Supports:
 *   loginWithPassword(email, password)  → email + password login
 *   loginWithEmail(email)               → OTP / magic link (fallback)
 *   resetPassword(email)                → sends password reset email
 *   updatePassword(newPassword)         → sets/changes password for logged-in user
 *   logout()                            → signs out
 *   listenAuthChanges(callback)         → single auth state listener
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
/**
 * Email + password login. Primary method for returning users.
 * @returns {{ data, error }}
 */
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
 * Sends a magic link / OTP email. Used for first access or as fallback.
 * @returns {{ error }}
 */
export async function loginWithEmail(email) {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@')) {
    return { error: new Error('Email inválido') };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: emailClean,
    options: {
      emailRedirectTo: window.location.origin,
      shouldCreateUser: false,
    },
  });

  return { error };
}

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
/**
 * Sends a password reset email.
 * @returns {{ error }}
 */
export async function resetPassword(email) {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@')) {
    return { error: new Error('Email inválido') };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(emailClean, {
    redirectTo: `${window.location.origin}?mode=reset-password`,
  });

  return { error };
}

// ─── UPDATE PASSWORD (for logged-in users) ────────────────────────────────────
/**
 * Sets or changes the password for the currently authenticated user.
 * Password lives ONLY in Supabase Auth — no custom tables touched.
 * @returns {{ error }}
 */
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
    await supabase.from('login_logs').insert({
      user_id:     userId,
      login_time:  new Date().toISOString(),
      device:      navigator.userAgent.slice(0, 250),
      success,
      fail_reason: failReason,
    });
  } catch (err) {
    console.warn('[authService] login_log failed:', err.message);
  }
}

// ─── UPDATE LAST LOGIN ────────────────────────────────────────────────────────
export async function updateLastLogin(email) {
  try {
    await supabase
      .from('users_access')
      .update({ last_login: new Date().toISOString() })
      .eq('email', normalizeEmail(email));
  } catch (err) {
    console.warn('[authService] updateLastLogin failed:', err.message);
  }
}
