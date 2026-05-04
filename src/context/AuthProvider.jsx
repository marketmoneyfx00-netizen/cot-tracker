/**
 * AuthProvider.jsx — v8 (DETERMINISTA)
 *
 * Sin callback onRealProfile. Sin synthetic prolongado.
 *
 * Si accessGuard devuelve profile=null (DB caída, RPC no deployado):
 *   → accessStatus.reason = 'db_error'
 *   → App.jsx muestra pantalla de error de conexión con botón Reintentar
 *   → NO se bloquea como paywall
 *   → NO se da acceso falso
 *
 * Para nuevos usuarios vía magic link:
 *   AuthCallback garantizó la fila antes de llegar aquí.
 *   loadProfile encuentra la fila en el intento 0.
 *   profile nunca es null para usuarios que pasaron por AuthCallback.
 *
 * Para re-logins con contraseña:
 *   La fila existe desde el primer login.
 *   profile nunca es null.
 *
 * El único caso donde profile=null es un error real de DB.
 */

import {
  createContext, useContext, useEffect,
  useState, useCallback, useRef
} from 'react';
import { listenAuthChanges, logLoginEvent, updateLastLogin } from '../lib/authService.js';
import { loadUserProfile, getAccessStatus } from '../lib/accessGuard.js';

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

export function AuthProvider({ children }) {
  const [loading,      setLoading]      = useState(true);
  const [session,      setSession]      = useState(null);
  const [user,         setUser]         = useState(null);
  const [profile,      setProfile]      = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [accessStatus, setAccessStatus] = useState(null);

  const loadingProfileRef = useRef(false);
  const initializedRef    = useRef(false);
  const userRef           = useRef(null);

  // ── loadProfile ────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser?.id) {
      setProfile(null);
      setSubscription(null);
      setAccessStatus(null);
      return;
    }

    if (loadingProfileRef.current) {
      console.log('[AUTH] loadProfile already running — skipping');
      return;
    }
    loadingProfileRef.current = true;

    try {
      console.log('[AUTH] Loading profile for:', authUser.email, '| uid:', authUser.id);

      const { profile: p, error } = await loadUserProfile(authUser.id, authUser);

      if (error || !p) {
        // DB caída o RPC no deployado — error de infraestructura real
        console.error('[AUTH] DB error loading profile for:', authUser.email, error?.message);
        setProfile(null);
        setSubscription(null);
        // reason='db_error' → App.jsx muestra pantalla de error con retry
        // NO 'hasAccess:true' — queremos que el usuario vea el error
        // y pueda reintentar, no que entre con estado inconsistente
        setAccessStatus({
          hasAccess: false,
          reason:    'db_error',
          plan:      'none',
          status:    'error',
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

      // Side effects (fire-and-forget)
      updateLastLogin(authUser.id).catch(() => {});
      logLoginEvent(authUser.id, true).catch(() => {});

    } catch (err) {
      console.error('[AUTH] loadProfile exception:', err.message);
      setProfile(null);
      setAccessStatus({
        hasAccess: false,
        reason:    'db_error',
        plan:      'none',
        status:    'error',
      });
    } finally {
      loadingProfileRef.current = false;
    }
  }, []);

  // ── refreshProfile ─────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    const currentUser = userRef.current;
    if (currentUser) {
      loadingProfileRef.current = false;
      await loadProfile(currentUser);
    }
  }, [loadProfile]);

  // ── Auth state listener ────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AUTH] Subscribing to auth state changes');

    const unsubscribe = listenAuthChanges(async (event, newSession) => {
      console.log('[AUTH] Auth event:', event);

      try {
        if (new URLSearchParams(window.location.search).get('mode') === 'reset-password') {
          setLoading(false);
          return;
        }

        const authUser = newSession?.user ?? null;
        userRef.current = authUser;
        setSession(newSession);
        setUser(authUser);

        if (authUser) {
          const isFirstInit = !initializedRef.current;
          initializedRef.current = true;

          if (isFirstInit) {
            // Primera inicialización: esperar perfil completo antes de mostrar UI.
            // Elimina el flash spinner → app con accessStatus=null.
            await loadProfile(authUser);
            setLoading(false);
          } else {
            // Evento posterior (TOKEN_REFRESHED, etc.)
            // Si ya tenemos perfil: no recargar innecesariamente.
            setLoading(false);
            if (!profile) {
              loadingProfileRef.current = false;
              loadProfile(authUser).catch(console.error);
            }
          }

        } else {
          initializedRef.current = true;
          userRef.current = null;
          setProfile(null);
          setSubscription(null);
          setAccessStatus(null);
          setLoading(false);

          // Limpiar tokens corruptos
          try {
            const key = Object.keys(localStorage).find(
              k => k.startsWith('sb-') && k.endsWith('-auth-token')
            );
            if (key) {
              const stored = JSON.parse(localStorage.getItem(key) || '{}');
              if (!stored?.access_token) {
                localStorage.removeItem(key);
                console.log('[AUTH] Cleared stale token');
              }
            }
          } catch { /* best-effort */ }
        }

      } catch (err) {
        console.error('[AUTH] event error:', err);
        setLoading(false);
      } finally {
        console.log('[AUTH] Render ready');
      }
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{
      loading, session, user, profile, subscription, accessStatus, refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}
