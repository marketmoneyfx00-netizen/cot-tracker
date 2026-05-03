/**
 * AuthCallback.jsx — handles PKCE magic link / OAuth callbacks
 *
 * Flow: /auth/callback?code=XXXX → exchangeCodeForSession → session set →
 *       onAuthStateChange SIGNED_IN → AuthProvider loads profile → dashboard
 *
 * FIXES:
 *
 * 1. Error params are now checked FIRST — before any async work.
 *    Previously, if a `code` param was present alongside an `error` param,
 *    the code branch ran first, calling exchangeCodeForSession which could
 *    hang indefinitely on iPhone Safari's in-app browser (SFSafariViewController).
 *    Moving the error check to the top stops that dead-end immediately.
 *
 * 2. Hash-based error detection added.
 *    Supabase can deliver errors in the URL fragment as well as query params
 *    (#error=access_denied&error_code=otp_expired). The fragment is never
 *    visible to window.location.search, so params.get('error') would return
 *    null and the callback would silently redirect to '/' with no message.
 *
 * 3. exchangeCodeForSession is wrapped in a 12-second timeout.
 *    On iPhone Mail → SFSafariViewController, network requests can stall
 *    with no rejection. Without a timeout the component stays on the
 *    "Verificando acceso…" spinner forever.
 *
 * 4. otp_expired gets a distinct, human-readable message in Spanish.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the first truthy value for `key` found in search params OR hash. */
function getParam(key) {
  const fromSearch = new URLSearchParams(window.location.search).get(key);
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    return new URLSearchParams(hash.slice(1)).get(key) ?? null;
  }
  return null;
}

/** Wraps a promise with a hard timeout. Rejects with the given message. */
function withTimeout(promise, ms, timeoutMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMsg)), ms)
    ),
  ]);
}

/** Returns a friendly Spanish string for known Supabase error codes. */
function friendlyError(errorCode, errorDescription) {
  if (errorCode === 'otp_expired' || errorCode === 'token_expired') {
    return 'El enlace ha expirado. Los enlaces de acceso solo son válidos por 60 minutos.';
  }
  if (errorCode === 'access_denied') {
    return 'El enlace ya fue usado o no es válido. Solicita uno nuevo.';
  }
  if (errorDescription) return errorDescription;
  return 'No se pudo procesar el enlace. Solicita uno nuevo.';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuthCallback() {
  const [status, setStatus] = useState('processing');
  const [msg, setMsg]       = useState('');

  useEffect(() => {
    async function handleCallback() {
      try {
        // ── STEP 1: Check for error params BEFORE any async work ─────────────
        // Supabase delivers errors in search params OR in the hash fragment.
        // We must check both, and bail out immediately without touching
        // exchangeCodeForSession, which can hang on iPhone Safari.
        const errorCode   = getParam('error_code')   ?? getParam('error');
        const errorParam  = getParam('error');
        const errorDesc   = getParam('error_description');

        if (errorParam || errorCode) {
          console.warn('[AuthCallback] Error in URL params:', { errorParam, errorCode, errorDesc });
          throw new Error(friendlyError(errorCode, errorDesc));
        }

        // ── STEP 2: PKCE code exchange ───────────────────────────────────────
        const url    = window.location.href;
        const code   = getParam('code');
        const type   = getParam('type') ?? '';

        if (code) {
          console.log('[AuthCallback] Exchanging PKCE code, type:', type);

          // Wrap in timeout — iPhone Safari webview can stall network requests
          // with no rejection. 12 s is well above any real server round-trip.
          const { data, error } = await withTimeout(
            supabase.auth.exchangeCodeForSession(url),
            12_000,
            'El servidor tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.'
          );

          if (error) throw error;

          if (type === 'recovery') {
            // Valid reset-password token — go to the password-change screen.
            console.log('[AuthCallback] Recovery code exchanged — redirecting to reset form');
            window.location.replace('/?mode=reset-password');
            return;
          }

          // Normal magic-link / OTP login
          setStatus('success');
          setTimeout(() => window.location.replace(window.location.origin + '/?setup=1'), 400);
          return;
        }

        // ── STEP 3: Implicit (hash) flow ─────────────────────────────────────
        const hash = window.location.hash;
        if (hash && hash.includes('access_token=')) {
          const hp        = new URLSearchParams(hash.slice(1));
          const hashType  = hp.get('type') ?? '';

          if (hashType === 'recovery') {
            console.log('[AuthCallback] Hash recovery token — redirecting to reset form');
            window.location.replace(window.location.origin + '/?mode=reset-password');
            return;
          }

          setStatus('success');
          setTimeout(() => window.location.replace(window.location.origin + '/?setup=1'), 400);
          return;
        }

        // ── STEP 4: No recognised params — go home ───────────────────────────
        console.warn('[AuthCallback] No code, no hash, no error — redirecting home');
        window.location.replace('/');

      } catch (err) {
        console.error('[AuthCallback] Error:', err.message);
        setStatus('error');
        setMsg(err.message || 'No se pudo procesar el enlace.');
      }
    }

    handleCallback();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0b0f14',
      fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
      // Prevent double-tap zoom on iPhone
      touchAction: 'manipulation',
    }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>

      <div style={{ textAlign: 'center', maxWidth: 340, padding: '0 24px', width: '100%' }}>
        {/* Logo mark */}
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'linear-gradient(135deg,#0055cc,#0077ed)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 28px',
          boxShadow: '0 8px 24px rgba(0,85,204,0.4)',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Processing */}
        {status === 'processing' && (
          <>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '3px solid rgba(0,85,204,0.2)',
              borderTopColor: '#0055cc',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 18px',
            }}/>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e8eaf0' }}>
              Verificando acceso…
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5a6070' }}>
              Redirigiendo al dashboard
            </p>
          </>
        )}

        {/* Success */}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#22c55e' }}>
              Acceso verificado
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5a6070' }}>
              Entrando al dashboard…
            </p>
          </>
        )}

        {/* Error — expired or invalid link */}
        {status === 'error' && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 26,
            }}>
              ⏱
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: '#e8eaf0' }}>
              El enlace expiró o ya fue usado
            </p>
            <p style={{
              margin: '0 0 24px', fontSize: 13, color: '#8b90a0',
              lineHeight: 1.65,
            }}>
              {msg || 'Solicita un nuevo enlace desde la pantalla de acceso.'}
            </p>
            <button
              onClick={() => window.location.replace('/')}
              style={{
                display: 'block',
                width: '100%',
                padding: '13px 24px',
                borderRadius: 12,
                border: 'none',
                background: '#0055cc',
                color: 'white',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                // iOS minimum tap target
                minHeight: 44,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              Solicitar nuevo enlace
            </button>
          </>
        )}
      </div>
    </div>
  );
}
