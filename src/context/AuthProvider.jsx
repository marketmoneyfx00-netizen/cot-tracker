/**
 * AuthProvider.jsx — v12 (DEADLOCK-FREE)
 *
 * ROOT CAUSE DEL LOCK:
 * Supabase JS v2.103+ usa initializePromise como prerequisito de getSession().
 * El callback de onAuthStateChange se ejecuta DENTRO del lock de _initialize().
 * Si desde el callback llamamos supabase.from() → _getAccessToken() → getSession()
 * → await initializePromise → DEADLOCK circular (initializePromise no puede resolver
 * hasta que _initialize() termine, pero _initialize() espera al callback, que espera
 * a initializePromise).
 * Después de 5s el lock se roba a sí mismo → "lock was released because another
 * request stole it".
 *
 * FIX: setTimeout(0) en el callback saca loadProfile del contexto del lock de
 * Supabase (macrotask nueva). Para entonces initializePromise ya está resuelta
 * y getSession() funciona sin conflictos.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';

import {
  listenAuthChanges,
  logLoginEvent,
  updateLastLogin,
} from '../lib/authService.js';

import {
  loadUserProfile,
  getAccessStatus,
} from '../lib/accessGuard.js';

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

  // ── Refs — never cause re-renders, no closure staleness ──────────────────
  const loadingProfileRef = useRef(false);
  const lastUserIdRef     = useRef(null);
  const profileRef        = useRef(null);
  const userRef           = useRef(null);

  // ─────────────────────────────────────────────────────────────────────────
  // LOAD PROFILE
  // deps = [] — reference never changes, no closure issues.
  // Uses refs for all guards so closures over state are never stale.
  // ─────────────────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser?.id) return;

    if (lastUserIdRef.current === authUser.id && profileRef.current) {
      console.log('[AUTH] Profile already loaded — skip');
      return;
    }

    if (loadingProfileRef.current) {
      console.log('[AUTH] loadProfile skipped (already running)');
      return;
    }

    loadingProfileRef.current = true;

    try {
      console.log('[AUTH] Loading profile for user:', authUser.id.slice(0, 8) + '…');

      const { profile: p, error } = await loadUserProfile(authUser.id, authUser);

      if (error || !p) {
        console.error('[AUTH] DB ERROR:', error?.message);
        profileRef.current = null;
        setProfile(null);
        setSubscription(null);
        setAccessStatus({ hasAccess: false, reason: 'db_error', plan: 'none', status: 'error' });
        return;
      }

      lastUserIdRef.current = authUser.id;
      profileRef.current    = p;

      const status = getAccessStatus(p);
      setProfile(p);
      setSubscription(null);
      setAccessStatus(status);

      console.log('[AUTH] Profile OK | plan:', p.plan, '| status:', p.status);

      updateLastLogin(authUser.id).catch(() => {});
      logLoginEvent(authUser.id, true).catch(() => {});

    } catch (err) {
      console.error('[AUTH] loadProfile EXCEPTION:', err.message);
      profileRef.current = null;
      setProfile(null);
      setAccessStatus({ hasAccess: false, reason: 'db_error', plan: 'none', status: 'error' });

    } finally {
      loadingProfileRef.current = false;
      setLoading(false);
    }
  }, []); // NO DEPS — never recreated, listener never dies

  // ─────────────────────────────────────────────────────────────────────────
  // REFRESH MANUAL
  // ─────────────────────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;

    lastUserIdRef.current     = null;
    profileRef.current        = null;
    loadingProfileRef.current = false;

    setLoading(true);
    await loadProfile(currentUser);
  }, [loadProfile]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH LISTENER
  // deps = [] → registered ONCE, never recreated, never unsubscribed early.
  //
  // KEY FIX: loadProfile is called via setTimeout(0).
  // Supabase v2.103+ fires onAuthStateChange callbacks INSIDE _initialize()'s
  // Web Locks API lock. Any call to supabase.from() from within the callback
  // triggers _getAccessToken() → getSession() → await initializePromise, which
  // creates a circular deadlock (initializePromise can't resolve until the
  // callback finishes, which waits for getSession, which waits for
  // initializePromise). After 5 s the lock steals itself.
  //
  // setTimeout(0) moves loadProfile to a new macrotask. By then _initialize()
  // has completed, initializePromise is resolved, and getSession() works fine.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AUTH] INIT listener');

    // Safety timeout: if auth never resolves (iOS Safari Web Locks freeze,
    // slow networks, Supabase init hang), unblock the loading screen after 10s.
    const safetyTimer = setTimeout(() => {
      if (loading) {
        console.warn('[AUTH] Safety timeout — forcing loading=false');
        setLoading(false);
      }
    }, 10_000);

    const unsubscribe = listenAuthChanges((event, newSession) => {
      clearTimeout(safetyTimer);
      console.log('[AUTH EVENT]', event);

      const authUser = newSession?.user ?? null;

      userRef.current = authUser;
      setSession(newSession);
      setUser(authUser);

      if (!authUser) {
        lastUserIdRef.current     = null;
        profileRef.current        = null;
        loadingProfileRef.current = false;

        setProfile(null);
        setSubscription(null);
        setAccessStatus(null);
        setLoading(false);
        return;
      }

      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') {
        console.log('[AUTH] Ignored event:', event);
        setLoading(false);
        return;
      }

      // ✅ FIX: defer DB call to outside Supabase's internal lock context.
      // setTimeout(0) moves this to a macrotask. By then initializePromise
      // is resolved and getSession() works without deadlock.
      // setLoading(false) happens inside loadProfile's finally block.
      setTimeout(() => {
        loadProfile(authUser).catch((err) => {
          console.error('[AUTH] deferred loadProfile error:', err.message);
          setLoading(false);
        });
      }, 0);
    });

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe?.();
    };
  }, []); // EMPTY DEPS — registered once, lives forever

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user,
        profile,
        subscription,
        accessStatus,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
