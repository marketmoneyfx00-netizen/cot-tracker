/**
 * AuthCallback.jsx — v8 (DETERMINISTA)
 *
 * GARANTÍA: el usuario NO sale de esta página hasta que su fila
 * en users_access está confirmada en la DB. Zero eventual consistency.
 *
 * FLUJO:
 *   1. Detectar token en hash (implicit flow) o code param (OAuth)
 *   2. Obtener sesión (supabase.auth.getSession)
 *   3. Si es recovery → redirigir inmediatamente (no necesita fila)
 *   4. Si es magic link → llamar ensureRow() antes de redirigir:
 *        a. RPC ensure_user_access (SECURITY DEFINER, bypasa RLS)
 *        b. SELECT users_access WHERE auth_user_id = user.id
 *        c. Retry hasta 5 veces con backoff ~3s total
 *        d. Si confirmado → redirigir a /?setup=1
 *        e. Si falla → mostrar error con botón reintentar
 *
 * RESULTADO:
 *   Cuando el usuario llega a la app, su fila EXISTS en users_access.
 *   loadUserProfile() en accessGuard la encuentra en el intento 0.
 *   No hay synthetic profile para nuevos usuarios. No hay bgloop.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const APP_URL = 'https://app.cot-tracker.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Garantía de fila en users_access ────────────────────────────────────────
/**
 * Llama al RPC ensure_user_access y verifica con SELECT.
 * Retry hasta MAX_ATTEMPTS veces.
 * Devuelve true si la fila existe/fue creada. false si falló todo.
 */
const MAX_ATTEMPTS = 5;
const ATTEMPT_DELAYS = [0, 600, 700, 800, 900]; // total ~3s

async function ensureRow(userId, userEmail) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (ATTEMPT_DELAYS[i] > 0) {
      await new Promise(r => setTimeout(r, ATTEMPT_DELAYS[i]));
    }

    try {
      // Paso A: RPC (SECURITY DEFINER — siempre puede escribir)
      const { error: rpcErr } = await supabase.rpc('ensure_user_access', {
        p_auth_user_id: userId,
        p_email:        userEmail,
      });

      if (rpcErr) {
        // El RPC puede fallar si la función no está deployada todavía.
        // En ese caso el trigger debería haber creado la fila.
        // Continuamos al SELECT para verificar.
        console.warn(`[AuthCallback] RPC attempt ${i + 1} error:`, rpcErr.code, rpcErr.message);
      }

      // Paso B: verificar que la fila existe
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
        console.log(
          `[AuthCallback] Row confirmed (attempt ${i + 1}):`,
          { id: data.id, status: data.status, plan: data.plan }
        );
        return { ok: true, profile: data };
      }

      console.log(`[AuthCallback] Row not found yet (attempt ${i + 1}/${MAX_ATTEMPTS})`);

    } catch (err) {
      console.warn(`[AuthCallback] Exception attempt ${i + 1}:`, err.message);
    }
  }

  return { ok: false, profile: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthCallback() {
  // 'processing' | 'creating' | 'success' | 'error' | 'retrying'
  const [status,   setStatus]   = useState('processing');
  const [msg,      setMsg]      = useState('');
  const [attempts, setAttempts] = useState(0);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode double-invoke guard
    ranRef.current = true;
    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCallback() {
    try {
      // ── 1. Detectar errores en URL ──────────────────────────────────────
      const errorCode  = getParam('error_code');
      const errorParam = getParam('error');
      const errorDesc  = getParam('error_description');

      if (errorParam || errorCode) {
        console.warn('[AuthCallback] URL error:', errorParam, errorCode);
        throw new Error(friendlyError(errorCode || errorParam, errorDesc));
      }

      // ── 2. Esperar a que el SDK procese el hash/code ────────────────────
      // Con implicit flow, detectSessionInUrl procesa el hash al cargar el cliente.
      // Una pequeña espera garantiza que getSession() ya tiene los tokens.
      await new Promise(r => setTimeout(r, 150));

      // ── 3. Obtener sesión ───────────────────────────────────────────────
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();

      if (sessionErr) throw sessionErr;

      if (!session?.user) {
        // No hay sesión — puede ser un code OAuth que necesita exchange
        const code = getParam('code');
        const type = getParam('type') ?? '';

        if (code) {
          console.log('[AuthCallback] Exchanging code for session');
          const { data: exchangeData, error: exchErr } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (exchErr) throw exchErr;

          if (type === 'recovery') {
            window.location.replace(`${APP_URL}/?mode=reset-password`);
            return;
          }

          // Re-run with the new session (await para no perder errores)
          ranRef.current = false;
          await handleCallback();
          return;
        }

        // Sin sesión y sin código — ir al login
        console.warn('[AuthCallback] No session, no code — going home');
        window.location.replace(`${APP_URL}/`);
        return;
      }

      const { id: userId, email: userEmail } = session.user;

      // ── 4. Recovery (reset password) — redirigir directo ───────────────
      const hash = window.location.hash;
      const hp   = hash ? new URLSearchParams(hash.slice(1)) : null;
      const type = hp?.get('type') ?? getParam('type') ?? '';

      if (type === 'recovery') {
        console.log('[AuthCallback] Recovery → redirect to reset form');
        window.location.replace(`${APP_URL}/?mode=reset-password`);
        return;
      }

      // ── 5. GARANTÍA: asegurar fila en users_access ──────────────────────
      console.log('[AuthCallback] Session OK for:', userEmail, '— ensuring DB row');
      setStatus('creating');

      const { ok } = await ensureRow(userId, userEmail);

      if (ok) {
        // Fila confirmada → redirigir a la app
        setStatus('success');
        setTimeout(() => window.location.replace(`${APP_URL}/?setup=1`), 350);
        return;
      }

      // ── 6. Todos los intentos fallaron ──────────────────────────────────
      // Mostrar error con botón de reintento — NO redirigir a la app.
      console.error('[AuthCallback] Failed to confirm DB row after all attempts');
      setStatus('error');
      setMsg(
        'Hubo un problema al configurar tu acceso. ' +
        'Pulsa "Reintentar" — suele resolverse en segundos.'
      );

    } catch (err) {
      console.error('[AuthCallback] Error:', err.message);
      setStatus('error');
      setMsg(friendlyError(err.code, err.message));
    }
  }

  async function handleRetry() {
    setAttempts(a => a + 1);
    setStatus('processing');
    setMsg('');
    ranRef.current = false;
    await handleCallback();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight:   '100vh',
      display:     'flex',
      alignItems:  'center',
      justifyContent: 'center',
      background:  '#0b0f14',
      fontFamily:  "-apple-system,'SF Pro Text',Helvetica,sans-serif",
      touchAction: 'manipulation',
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

        {/* Logo */}
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
              {status === 'creating'
                ? 'Creando tu cuenta en la plataforma'
                : 'Un momento'}
            </p>
          </>
        )}

        {/* Success */}
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

        {/* Error */}
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

            {/* Retry — only for DB errors (not expired links) */}
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
