/**
 * accessGuard.js — Access Validation Layer
 *
 * Determines whether an authenticated user has active access to COT Tracker.
 * Access is determined ONLY by server-side data (users_access + subscriptions).
 * Never trusts frontend state alone.
 *
 * Public API:
 *   loadUserProfile(email)              → fetches users_access row
 *   loadUserSubscription(userId)        → fetches subscriptions row
 *   hasActiveAccess(profile, sub)       → boolean: is access currently valid?
 *   isTrialExpired(profile)             → boolean: trial window has closed
 *   getAccessStatus(profile, sub)       → detailed status object for UI
 */

import { supabase } from './supabase.js';
import { normalizeEmail } from './authService.js';

// ─── LOAD PROFILE ─────────────────────────────────────────────────────────────
/**
 * Fetch the users_access row for a given email.
 *
 * @param {string} email
 * @returns {{ profile: Object|null, error: Error|null }}
 */
export async function loadUserProfile(email) {
  const emailClean = normalizeEmail(email);

  const { data, error } = await supabase
    .from('users_access')
    .select('*')
    .eq('email', emailClean)
    .maybeSingle();

  if (error) {
    console.error('[accessGuard] loadUserProfile error:', error.message);
    return { profile: null, error };
  }

  return { profile: data ?? null, error: null };
}

// ─── LOAD SUBSCRIPTION ────────────────────────────────────────────────────────
/**
 * Fetch the most recent active subscription for a user_id.
 *
 * @param {string} userId  - UUID from users_access.id
 * @returns {{ subscription: Object|null, error: Error|null }}
 */
export async function loadUserSubscription(userId) {
  if (!userId) return { subscription: null, error: null };

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
}

// ─── TRIAL EXPIRED ────────────────────────────────────────────────────────────
/**
 * Returns true if the user is on a trial plan that has expired.
 *
 * @param {Object|null} profile - users_access row
 * @returns {boolean}
 */
export function isTrialExpired(profile) {
  if (!profile) return true;
  if (profile.plan !== 'trial') return false;

  const expires = profile.expires_at;
  if (!expires) return false;  // no expiry set = still valid

  return new Date(expires) < new Date();
}

// ─── HAS ACTIVE ACCESS ────────────────────────────────────────────────────────
/**
 * Returns true if the user currently has valid access.
 *
 * Rules (all must pass):
 *   1. Profile exists and status is 'active' or 'trial'
 *   2. If trial: not expired
 *   3. If subscription exists: status must be 'active'
 *
 * @param {Object|null} profile       - users_access row
 * @param {Object|null} subscription  - subscriptions row (optional)
 * @returns {boolean}
 */
export function hasActiveAccess(profile, subscription) {
  if (!profile) return false;

  const validStatuses = ['active', 'trial'];
  if (!validStatuses.includes(profile.status)) return false;

  // Trial expiry check
  if (profile.plan === 'trial' && isTrialExpired(profile)) return false;

  // If there's a subscription record, it must also be active
  if (subscription && subscription.status !== 'active') return false;

  return true;
}

// ─── GET ACCESS STATUS (for UI) ───────────────────────────────────────────────
/**
 * Returns a detailed status object for displaying access state in the UI.
 *
 * @param {Object|null} profile
 * @param {Object|null} subscription
 * @returns {{
 *   hasAccess: boolean,
 *   reason: string,
 *   plan: string,
 *   status: string,
 *   expiresAt: string|null,
 *   isExpired: boolean,
 * }}
 */
export function getAccessStatus(profile, subscription) {
  if (!profile) {
    return {
      hasAccess: false,
      reason:    'profile_not_found',
      plan:      '—',
      status:    'unknown',
      expiresAt: null,
      isExpired: false,
    };
  }

  const trialExpired = isTrialExpired(profile);
  const active       = hasActiveAccess(profile, subscription);

  let reason = 'active';
  if (!active) {
    if (trialExpired)                              reason = 'trial_expired';
    else if (profile.status === 'suspended')       reason = 'suspended';
    else if (profile.status === 'cancelled')       reason = 'cancelled';
    else if (subscription?.status === 'past_due')  reason = 'payment_failed';
    else                                           reason = 'no_access';
  }

  return {
    hasAccess: active,
    reason,
    plan:      profile.plan      ?? 'trial',
    status:    profile.status    ?? 'unknown',
    expiresAt: profile.expires_at ?? null,
    isExpired: trialExpired,
  };
}
