/**
 * AuthProvider.jsx — v5 (NUEVOS USUARIOS: retry + onboarding flow)
 *
 * CAMBIOS RESPECTO A v4:
 *   1. loadProfile pasa authUser completo (no solo id) → accessGuard puede
 *      crear fila de fallback si el trigger no llegó a tiempo
 *   2. Para usuarios nuevos (isNewUser), marca accessStatus con hasAccess:true
 *      y reason:'new_user' para que App.jsx muestre onboarding
 *   3. Setup mode (?setup=1) se detecta aquí para forzar refreshProfile
 *      después de que el trigger tenga tiempo de ejecutarse
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

  const loadingProfileRef = useRef(false);

  // ── Load profile con retry (key change: pasa authUser completo) ───────────
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser?.id) {
      console.log('[AUTH] No authUser.id — clearing profile');
      setProfile(null);
      setSubscription(null);
      setAccessStatus(null);
      return;
    }

    if (loadingProfileRef.current) {
      console.log('[AUTH] loadProfile already in progress — skipping duplicate');
      return;
    }
    loadingProfileRef.current = true;

    try {
      console.log('[AUTH] Loading profile for:', authUser.email, '| uid:', authUser.id);

      // Pasar authUser completo → accessGuard puede crear fila si trigger tardó
      const { profile: p, error: profileError } = await loadUserProfile(
        authUser.id,
        authUser   // ← NUEVO: objeto completo para fallback
      );

      if (profileError || !p) {
        // Ni retry ni auto-create funcionaron
        // Marcar como sin acceso — el usuario verá el paywall con opción de soporte
        console.error('[AUTH] Profile unresolvable for:', authUser.email);
        setProfile(null);
        setSubscription(null);
        setAccessStatus({
          hasAccess: false,
          plan: 'none',
          reason: 'profile_not_found',
          status: 'inactive',
        });
        return;
      }

      const status = getAccessStatus(p);

      setProfile(p);
      setSubscription(null);
      setAccessStatus(status);

      console.log(
        '[AUTH] Profile loaded:', p.email,
        '| plan:', p.plan,
        '| status:', p.status,
        '| hasAccess:', status.hasAccess,
        '| onboarding_completed:', p.onboarding_completed
      );

      // Side effects non-blocking
      updateLastLogin(authUser.id).catch(() => {});
      logLoginEvent(authUser.id, true).catch(() => {});

    } catch (err) {
      console.error('[AUTH] loadProfile caught error:', err.message);
      setProfile(null);
      setSubscription(null);
      setAccessStatus({ hasAccess: false, plan: 'none', reason: 'db_error', status: 'inactive' });

    } finally {
      loadingProfileRef.current = false;
    }
  }, []);

  // ── refreshProfile ─────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (user) {
      loadingProfileRef.current = false;
      await loadProfile(user);
    }
  }, [user, loadProfile]);

  // ── SINGLE auth effect ─────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AUTH] Subscribing to auth state changes');

    const unsubscribe = listenAuthChanges(async (event, newSession) => {
      console.log('[AUTH] Auth event:', event);

      try {
        const forceResetMode =
          new URLSearchParams(window.location.search).get('mode') === 'reset-password';

        if (forceResetMode) {
          console.log('[AUTH] Reset mode detected — releasing loading gate');
          setLoading(false);
          return;
        }

        const authUser = newSession?.user ?? null;

        setSession(newSession);
        setUser(authUser);

        if (authUser) {
          console.log('[AUTH] Session active for:', authUser.email);
          setLoading(false);

          // loadProfile incluye retry — maneja race condition del trigger
          loadProfile(authUser).catch(err => {
            console.error('[AUTH] background profile load error:', err);
          });

        } else {
          console.log('[AUTH] No session — clearing state');
          setProfile(null);
          setSubscription(null);
          setAccessStatus(null);
          setLoading(false);

          // Limpiar tokens corruptos
          try {
            const storageKey = Object.keys(localStorage).find(
              k => k.startsWith('sb-') && k.endsWith('-auth-token')
            );
            if (storageKey) {
              const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
              if (!stored?.access_token) {
                localStorage.removeItem(storageKey);
                console.log('[AUTH] Cleared stale auth token from storage');
              }
            }
          } catch (e) { /* best-effort */ }
        }

      } catch (err) {
        console.error('[AUTH] auth callback error:', err);
        setLoading(false);
      } finally {
        console.log('[AUTH] Render ready');
      }
    });

    return () => {
      console.log('[AUTH] Unsubscribing from auth state changes');
      unsubscribe();
    };
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{
      loading, session, user, profile, subscription, accessStatus, refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}
