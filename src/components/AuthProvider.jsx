/**
 * AuthProvider.jsx — React Auth Context
 *
 * FIX: Eliminado el useEffect de initAuth() que llamaba getCurrentSession()
 * en paralelo con onAuthStateChange, causando lock contention en Supabase v2.
 *
 * En Supabase JS v2, onAuthStateChange dispara INITIAL_SESSION inmediatamente
 * al suscribirse, entregando la sesión actual. No hay necesidad de llamar
 * getSession() por separado — eso era la causa del lock stealing.
 *
 * Flujo correcto (serializado):
 *   onAuthStateChange(INITIAL_SESSION) → setUser → loadProfile → setLoading(false)
 *   onAuthStateChange(SIGNED_IN/OUT)   → setUser → loadProfile/clear
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { listenAuthChanges, logLoginEvent, updateLastLogin } from '../lib/authService.js';
import { loadUserProfile, loadUserSubscription, getAccessStatus } from '../lib/accessGuard.js';

// ─── CONTEXT ──────────────────────────────────────────────────────────────────
const AuthContext = createContext({
  loading:        true,
  session:        null,
  user:           null,
  profile:        null,
  subscription:   null,
  accessStatus:   null,
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [loading,      setLoading]      = useState(true);
  const [session,      setSession]      = useState(null);
  const [user,         setUser]         = useState(null);
  const [profile,      setProfile]      = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [accessStatus, setAccessStatus] = useState(null);

  // Serialization guard: prevents simultaneous loadProfile calls
  const loadingProfileRef = useRef(false);

  // ── Load profile + subscription (single serialized entry point) ───────────
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser?.email) {
      console.log('[AUTH] No authUser.email — clearing profile');
      setProfile(null);
      setSubscription(null);
      setAccessStatus(null);
      return;
    }

    // Prevent parallel calls
if (loadingProfileRef.current) {
  console.log('[AUTH] loadProfile already in progress — skipping duplicate');
  setLoading(false);
  return;
}
    loadingProfileRef.current = true;

    try {
      console.log('[AUTH] Loading profile for:', authUser.email, '| uid:', authUser.id);
      // Pass both email (fallback) and auth UID (primary attempt)
      const { profile: p, error: profileError } = await loadUserProfile(authUser.email, authUser.id);

      if (profileError || !p) {
        // Profile not in DB — create safe fallback so app can open
        console.warn('[AUTH] Fallback profile created for:', authUser.email);
        const fallback = {
          email:             authUser.email,
          telegram_username: authUser.email.split('@')[0],
          plan:              'Trial',
          status:            'active',
        };
        setProfile(fallback);
        setSubscription(null);
        setAccessStatus({ hasAccess: true, plan: 'Trial', reason: 'active' });
        return;
      }

      const { subscription: sub } = p?.id
        ? await loadUserSubscription(p.id)
        : { subscription: null };

      const status = getAccessStatus(p, sub);

      setProfile(p);
      setSubscription(sub);
      setAccessStatus(status);

      console.log('[AUTH] Profile loaded:', p.email, '| plan:', p.plan);

      // Non-blocking side effects
      updateLastLogin(authUser.email).catch(() => {});
      logLoginEvent(p.id ?? authUser.id, true).catch(() => {});

  } catch (err) {
    // Network/DB error — use fallback, never crash
    console.error('[AUTH] loadProfile caught error:', err.message);

    const fallback = {
      email: authUser?.email ?? 'unknown',
      telegram_username: authUser?.email?.split('@')[0] ?? 'Usuario',
      plan: 'Trial',
      status: 'active',
    };

    setProfile(fallback);
    setSubscription(null);
    setAccessStatus({ hasAccess: true, plan: 'Trial', reason: 'active' });

  } finally {
    loadingProfileRef.current = false;
  }
}, []);

  // ── refreshProfile for manual reload ──────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (user) {
      loadingProfileRef.current = false; // allow forced refresh
      await loadProfile(user);
    }
  }, [user, loadProfile]);

  // ── SINGLE auth effect — onAuthStateChange handles EVERYTHING ─────────────
  // DO NOT add a second useEffect calling getCurrentSession() / getSession().
  // Supabase v2 fires INITIAL_SESSION on subscribe → eliminates lock contention.
  useEffect(() => {
    console.log('[AUTH] Subscribing to auth state changes');

const unsubscribe = listenAuthChanges(async (event, newSession) => {
  console.log('[AUTH] Auth event:', event);

  try {
    const forceResetMode =
      new URLSearchParams(window.location.search).get('mode') === 'reset-password';

    if (forceResetMode) {
      console.log('[AUTH] Reset mode detected - skipping session restore');
      return;
    }

    const authUser = newSession?.user ?? null;

    setSession(newSession);
    setUser(authUser);

if (authUser) {
  console.log('[AUTH] Session active for:', authUser.email);

  // libera UI inmediatamente
  setLoading(false);

  // carga perfil en background
  loadProfile(authUser).catch(err => {
    console.error('[AUTH] background profile load error:', err);
  });

} else {
  console.log('[AUTH] No session — clearing state');
  setProfile(null);
  setSubscription(null);
  setAccessStatus(null);
  setLoading(false);
}

} catch (err) {
  console.error('[AUTH] auth callback error:', err);
} finally {
  console.log('[AUTH] Render ready');
}
})

    return () => {
      console.log('[AUTH] Unsubscribing from auth state changes');
      unsubscribe();
    };
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ loading, session, user, profile, subscription, accessStatus, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
