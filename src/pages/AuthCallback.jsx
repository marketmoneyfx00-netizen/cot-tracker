/**
 * AuthCallback.jsx — v10 (IMPLICIT FLOW, SIN RACE CONDITIONS)
 *
 * Con implicit flow, detectSessionInUrl procesa el hash (#access_token=...)
 * de forma síncrona al inicializar el cliente Supabase. Cuando este componente
 * monta, los tokens ya están en localStorage. Basta con llamar getSession()
 * tras un pequeño delay (300ms) para garantizar que el proceso terminó.
 *
 * NO usar onAuthStateChange aquí: con implicit flow el evento SIGNED_IN
 * ya se emitió antes de que React monte el componente. El listener lo perdería.
 *
 * FLUJO:
 *   1. Detectar errores en URL
 *   2. Esperar 300ms (detectSessionInUrl completa el hash processing)
 *   3. getSession() → sesión disponible en localStorage
 *   4. Si recovery → redirect a reset form
 *   5. ensureRow() → garantiza fila en users_access
 *   6. Redirect a /?setup=1
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const APP_URL = 'https://app.cot-tracker.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getParam(key) {
  const fromSearch = new URLSearchParams(window.location.search).get(key);
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    return new URLSearchParams(hash.slice(1)).get(key) ?? null;
  }
  return null;
}

function friendlyError(code, desc) {
  if (code === 'otp_expired' || code === 'token_expired') {
    return 'El enlace ha expirado (válido 60 min). Solicita uno nuevo.';
  }
  if (code === 'access_denied') {
    return 'El enlace ya fue usado o no es válido. Solicita uno nuevo.';
  }
  return desc || 'No se pudo procesar el enlace. Solicita uno nuevo.';
}

// ── Garantía de fila en users_access ──────────────────────────────────────────

const MAX_ATTEMPTS   = 5;
const ATTEMPT_DELAYS = [0, 600, 700, 800, 900];

async function ensureRow(userId, userEmail) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (ATTEMPT_DELAYS[i] > 0) {
      await new Promise(r => setTimeout(r, ATTEMPT_DELAYS[i]));
    }

    try {
      const { error: rpcErr } = await supabase.rpc('ensure_user_access', {
        p_auth_user_id: userId,
        p_email:        userEmail,
      });

      if (rpcErr) {
        console.warn(`[AuthCallback] RPC attempt ${i + 1} error:`, rpcErr.code, rpcErr.message);
      }

      const { data, error: selErr } = await supabase
        .from('users_access')
        .select('id, auth_user_id, status, plan')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (selErr) {
        console.warn(`[AuthCallback] SELECT attempt ${i + 1} error:`, selErr.message);
        continue;
      }

      if (data) {
        console.log(`[AuthCallback] Row confirmed (attempt ${i + 1}):`, {
          id: data.id, status: data.status, plan: data.plan,
        });
        return { ok: true, profile: data };
      }

      console.log(`[AuthCallback] Row not found yet (attempt ${i + 1}/${MAX_ATTEMPTS})`);

    } catch (err) {
      console.warn(`[AuthCallback] Exception attempt ${i + 1}:`, err.message);
    }
  }

  return { ok: false, profile: null };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuthCallback() {
  const [status,   setStatus]   = useState('processing');
  const [msg,      setMsg]      = useState('');
  const [attempts, setAttempts] = useState(0);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode guard
    ranRef.current = true;
    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCallback() {
    try {
      // ── 1. Errores en URL ────────────────────────────────────────────────
      const errorCode  = getParam('error_code');
      const errorParam = getParam('error');
      const errorDesc  = getParam('error_description');

      if (errorParam || errorCode) {
        console.warn('[AuthCallback] URL error:', errorParam, errorCode);
        throw new Error(friendlyError(errorCode || errorParam, errorDesc));
      }

      // ── 2. Esperar a que detectSessionInUrl procese el hash ──────────────
      // Con implicit flow, el SDK parsea #access_token al inicializarse.
      // 300ms es suficiente para que la operación (síncrona + localStorage write)
      // termine antes de que llamemos getSession().
      await new Promise(r => setTimeout(r, 300));

      // ── 3. Obtener sesión desde localStorage ─────────────────────────────
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();

      if (sessionErr) throw sessionErr;

      if (!session?.user) {
        // Sin sesión: puede ser un enlace expirado o ya usado.
        // Intentar con exchangeCodeForSession por si hubiera un code param (PKCE futuro).
        const code = getParam('code');
        if (code) {
          console.log('[AuthCallback] Trying code exchange');
          const { data: ex, error: exErr } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (exErr) throw exErr;
          if (ex?.session?.user) {
            return continueWithSession(ex.session);
          }
        }

        console.warn('[AuthCallback] No session — going home');
        window.location.replace(`${APP_URL}/`);
        return;
      }

      await continueWithSession(session);

    } catch (err) {
      console.error('[AuthCallback] Error:', err.message);
      setStatus('error');
      setMsg(friendlyError(err.code, err.message));
    }
  }

  async function continueWithSession(session) {
    const { id: userId, email: userEmail } = session.user;

    // ── 4. Recovery ──────────────────────────────────────────────────────
    const hash = window.location.hash;
    const hp   = hash ? new URLSearchParams(hash.slice(1)) : null;
    const type = hp?.get('type') ?? getParam('type') ?? '';

    if (type === 'recovery') {
      console.log('[AuthCallback] Recovery → redirect to reset form');
      window.location.replace(`${APP_URL}/?mode=reset-password`);
      return;
    }

    // ── 5. Garantía: fila en users_access ───────────────────────────────
    console.log('[AuthCallback] Session OK for:', userEmail, '— ensuring DB row');
    setStatus('creating');

    const { ok } = await ensureRow(userId, userEmail);

    if (ok) {
      setStatus('success');
      setTimeout(() => window.location.replace(`${APP_URL}/?setup=1`), 350);
      return;
    }

    console.error('[AuthCallback] Failed to confirm DB row after all attempts');
    setStatus('error');
    setMsg(
      'Hubo un problema al configurar tu acceso. ' +
      'Pulsa "Reintentar" — suele resolverse en segundos.'
    );
  }

  async function handleRetry() {
    setAttempts(a => a + 1);
    setStatus('processing');
    setMsg('');
    ranRef.current = false;
    await handleCallback();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     '#0b0f14',
      fontFamily:     "-apple-system,'SF Pro Text',Helvetica,sans-serif",
      touchAction:    'manipulation',
    }}>
      <style>{`
        @keyframes cb-spin { to { transform: rotate(360deg); } }
        @keyframes cb-in   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div style={{
        textAlign: 'center', maxWidth: 340,
        padding: '0 24px', width: '100%',
        animation: 'cb-in 0.25s ease both',
      }}>

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

        {(status === 'processing' || status === 'creating') && (
          <>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '3px solid rgba(0,85,204,0.2)',
              borderTopColor: '#0055cc',
              animation: 'cb-spin 0.8s linear infinite',
              margin: '0 auto 18px',
            }}/>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e8eaf0' }}>
              {status === 'creating' ? 'Configurando tu acceso…' : 'Verificando enlace…'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5a6070' }}>
              {status === 'creating' ? 'Creando tu cuenta en la plataforma' : 'Un momento'}
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 42, marginBottom: 12 }}>✅</div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#22c55e' }}>
              Acceso confirmado
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5a6070' }}>
              Entrando al dashboard…
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 26,
            }}>
              {attempts > 0 ? '🔄' : '⏱'}
            </div>

            <p style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: '#e8eaf0' }}>
              {msg.includes('expirado') || msg.includes('usado')
                ? 'Enlace expirado o ya usado'
                : 'Error al configurar el acceso'}
            </p>

            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#8b90a0', lineHeight: 1.65 }}>
              {msg || 'Hubo un problema. Intenta de nuevo.'}
            </p>

            {!msg.includes('expirado') && !msg.includes('usado') && !msg.includes('válido') && (
              <button
                onClick={handleRetry}
                style={{
                  display: 'block', width: '100%',
                  padding: '13px 24px', borderRadius: 12,
                  border: 'none', background: '#0055cc',
                  color: 'white', fontSize: 15, fontWeight: 700,
                  cursor: 'pointer', minHeight: 44, marginBottom: 10,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                Reintentar
              </button>
            )}

            <button
              onClick={() => window.location.replace(`${APP_URL}/`)}
              style={{
                display: 'block', width: '100%',
                padding: '11px 24px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent',
                color: '#8b90a0', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', minHeight: 44,
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
