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

// ─── Normalize email (same as was used in App.jsx) ───────────────────────────
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
 * Does NOT return a session immediately — session arrives via onAuthStateChange
 * after the user clicks the link.
 *
 * @param {string} email
 * @returns {{ error: Error|null }}
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
      // Prevents creating a new account if email doesn't exist
      shouldCreateUser: false,
    },
  });

  return { error: error || null };
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
/**
 * Sign out the current user and clear all Supabase session data.
 * @returns {{ error: Error|null }}
 */
export async function logout() {
  const { error } = await supabase.auth.signOut();
  return { error: error || null };
}

// ─── GET CURRENT SESSION ──────────────────────────────────────────────────────
/**
 * Returns the active Supabase session, or null if not authenticated.
 * Safe to call on app boot.
 *
 * @returns {Promise<Session|null>}
 */
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[authService] getSession error:', error.message);
    return null;
  }
  return data?.session ?? null;
}

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
/**
 * Returns the authenticated Supabase user, or null.
 *
 * @returns {Promise<User|null>}
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('[authService] getUser error:', error.message);
    return null;
  }
  return data?.user ?? null;
}

// ─── AUTH STATE LISTENER ──────────────────────────────────────────────────────
/**
 * Subscribe to authentication state changes (login, logout, token refresh).
 * Returns an unsubscribe function — call it in useEffect cleanup.
 *
 * @param {(event: string, session: Session|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function listenAuthChanges(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}

// ─── LOG LOGIN EVENT ──────────────────────────────────────────────────────────
/**
 * Write a login event to login_logs table.
 * Non-blocking — failures are logged to console only, never thrown.
 *
 * @param {string}  userId
 * @param {boolean} success
 * @param {string}  [failReason]
 */
export async function logLoginEvent(userId, success, failReason = null) {
  try {
    await supabase.from('login_logs').insert({
      user_id:    userId,
      login_time: new Date().toISOString(),
      device:     navigator.userAgent.slice(0, 250),
      success,
      fail_reason: failReason,
    });
  } catch (err) {
    console.warn('[authService] Failed to write login_log:', err.message);
  }
}

// ─── UPDATE LAST LOGIN ────────────────────────────────────────────────────────
/**
 * Update last_login timestamp in users_access.
 * Non-blocking.
 *
 * @param {string} email
 */
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
