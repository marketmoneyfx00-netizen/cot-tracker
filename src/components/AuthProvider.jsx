/**
 * AuthProvider.jsx — React Auth Context
 *
 * Manages authentication state globally.
 * Exposes: loading, session, user, profile, subscription, accessStatus
 *
 * Usage:
 *   Wrap <App> with <AuthProvider>
 *   Access state via: const { user, profile, accessStatus } = useAuth()
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  getCurrentSession,
  listenAuthChanges,
  logLoginEvent,
  updateLastLogin,
} from '../lib/authService.js';
import {
  loadUserProfile,
  loadUserSubscription,
  getAccessStatus,
} from '../lib/accessGuard.js';

// ─── CONTEXT ──────────────────────────────────────────────────────────────────
const AuthContext = createContext({
  loading: true,
  session: null,
  user: null,
  profile: null,
  subscription: null,
  accessStatus: null,
  refreshProfile: async () => {},
});

// ─── HOOK ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  return useContext(AuthContext);
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [accessStatus, setAccessStatus] = useState(null);

  // ── Load profile + subscription from Supabase ─────────────────────────────
  const loadProfile = useCallback(async (authUser) => {
  try {
    if (!authUser?.email) {
      setProfile(null);
      setSubscription(null);
      setAccessStatus(null);
      return;
    }

    const { profile: p } = await loadUserProfile(authUser.email);

    if (!p) {
      console.warn('[AuthProvider] Perfil no encontrado:', authUser.email);

      const fallbackProfile = {
        email: authUser.email,
        telegram_username: authUser.email.split('@')[0],
        plan: 'Trial',
        status: 'trial'
      };

      setProfile(fallbackProfile);
      setSubscription(null);
      setAccessStatus({
        hasAccess: true,
        plan: 'Trial'
      });

      return;
    }

    const { subscription: sub } = p?.id
      ? await loadUserSubscription(p.id)
      : { subscription: null };

    const status = getAccessStatus(p, sub);

    setProfile(p);
    setSubscription(sub);
    setAccessStatus(status);

    updateLastLogin(authUser.email);
    logLoginEvent(p.id ?? authUser.id, true);

  } catch (error) {
    console.error('[AuthProvider] loadProfile error:', error);

    const fallbackProfile = {
      email: authUser?.email || 'unknown',
      telegram_username: authUser?.email?.split('@')[0] || 'Usuario',
      plan: 'Trial',
      status: 'trial'
    };

    setProfile(fallbackProfile);
    setSubscription(null);
    setAccessStatus({
      hasAccess: true,
      plan: 'Trial'
    });
  }
}, []);

  // ── Expose refreshProfile for manual reload ───────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user);
  }, [user, loadProfile]);

  // ── Boot: restore session on mount ───────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const sessionData = await getCurrentSession();

        if (!mounted) return;

        const restoredSession = sessionData?.session ?? null;
        const restoredUser = restoredSession?.user ?? null;

        setSession(restoredSession);
        setUser(restoredUser);

        if (restoredUser) {
          await loadProfile(restoredUser);
        }
      } catch (error) {
        console.error('[AuthProvider] Session restore error:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [loadProfile]);

  // ── Auth state listener: login, logout, token refresh ────────────────────
  useEffect(() => {
    const unsubscribe = listenAuthChanges(async (event, newSession) => {
      const authUser = newSession?.user ?? null;

      setSession(newSession);
      setUser(authUser);

      if (authUser) {
        await loadProfile(authUser);
      } else {
        setProfile(null);
        setSubscription(null);
        setAccessStatus(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, [loadProfile]);

  const value = {
    loading,
    session,
    user,
    profile,
    subscription,
    accessStatus,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
