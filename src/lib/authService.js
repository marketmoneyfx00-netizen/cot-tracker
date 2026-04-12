/**
 * authService.js — Supabase Auth Service
 *
 * Single source of truth for all authentication operations.
 * Uses Supabase Auth (Magic Link / OTP) — no passwords, no GAS, no localStorage session.
 *
 * Public API:
 *   loginWithEmail(email)       → sends OTP/magic link
 *   logout()                    → signs out and clears session
 *   getCurrentSession()         → returns active session or null
 *   getCurrentUser()            → returns auth user or null
 *   listenAuthChanges(callback) → subscribes to auth state changes, returns unsubscribe fn
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

// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * Send a magic link / OTP to the user's email.
 * Session will be created after clicking the email link.
 *
 * @param {string} email
 * @returns {{ error: Error|null }}
 */
export async function loginWithEmail(email) {
  try {
    const emailClean = normalizeEmail(email);

    if (!emailClean || !emailClean.includes('@')) {
      return { error: new Error('Email inválido') };
    }

    console.log('[AUTH] Sending magic link to:', emailClean);

    const { data, error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      console.error('[AUTH ERROR]', error);
      return { error };
    }

    console.log('[AUTH SUCCESS]', data);

    return { error: null };
  } catch (err) {
    console.error('[AUTH CATCH ERROR]', err);
    return { error: err };
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export async function logout() {
  const { error } = await supabase.auth.signOut();
  return { error: error || null };
}

// ─── GET CURRENT SESSION ──────────────────────────────────────────────────────
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error('[authService] getSession error:', error.message);
    return null;
  }

  return data?.session ?? null;
}

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error('[authService] getUser error:', error.message);
    return null;
  }

  return data?.user ?? null;
}

// ─── AUTH STATE LISTENER ──────────────────────────────────────────────────────
export function listenAuthChanges(callback) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(callback);

  return () => subscription.unsubscribe();
}

// ─── LOG LOGIN EVENT ──────────────────────────────────────────────────────────
export async function logLoginEvent(userId, success, failReason = null) {
  try {
    await supabase.from('login_logs').insert({
      user_id: userId,
      login_time: new Date().toISOString(),
      device: navigator.userAgent.slice(0, 250),
      success,
      fail_reason: failReason,
    });
  } catch (err) {
    console.warn('[authService] Failed to write login_log:', err.message);
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
    console.warn('[authService] Failed to update last_login:', err.message);
  }
}
