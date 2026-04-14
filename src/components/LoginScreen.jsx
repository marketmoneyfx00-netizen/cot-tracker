/**
 * LoginScreen.jsx — Hybrid Auth: Password-first + Magic Link fallback
 *
 * Modes:
 *   'password'      — email + password form (default)
 *   'magic_link'    — email only, send OTP link
 *   'forgot'        — email only, send reset link
 *
 * Auth is handled by:
 *   loginWithPassword()  → supabase.auth.signInWithPassword()
 *   loginWithEmail()     → supabase.auth.signInWithOtp()
 *   resetPassword()      → supabase.auth.resetPasswordForEmail()
 *
 * Session is picked up by AuthProvider.onAuthStateChange — no prop callbacks needed.
 */

import { useState } from 'react';
import { loginWithPassword, loginWithEmail, resetPassword, updatePassword, normalizeEmail } from '../lib/authService.js';

// ─── Shared input style ───────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12,
  border: '1.5px solid #e5e5ea', fontSize: 15, color: '#1c1c1e',
  background: '#f9f9fb', boxSizing: 'border-box',
  fontFamily: "inherit", transition: 'all 0.2s',
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#8e8e93',
  marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
};

const ErrorBox = ({ msg }) => msg ? (
  <div style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>
    {msg}
  </div>
) : null;

const SuccessBox = ({ msg }) => msg ? (
  <div style={{ background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#1a7a4a', lineHeight: 1.5 }}>
    {msg}
  </div>
) : null;

// ─── Logo mark ────────────────────────────────────────────────────────────────
const Logo = () => (
  <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg,#0055cc,#0077ed)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(0,85,204,0.3)' }}>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </div>
);

// ─── Password strength indicator ─────────────────────────────────────────────
function pwStrength(pw) {
  if (!pw) return null;
  const has8  = pw.length >= 8;
  const hasL  = /[a-zA-Z]/.test(pw);
  const hasN  = /[0-9]/.test(pw);
  const score = [has8, hasL, hasN].filter(Boolean).length;
  const colors = ['#ef4444', '#f59e0b', '#22c55e'];
  const labels = ['Débil', 'Regular', 'Segura'];
  return { score, color: colors[score - 1] || '#e5e5ea', label: labels[score - 1] || '' };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LoginScreen() {
  const initialMode =
    new URLSearchParams(window.location.search).get('mode') === 'reset-password'
      ? 'reset'
      : 'password';

  const [mode, setMode] = useState(initialMode); // 'password' | 'magic_link' | 'forgot' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const reset = (newMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
  };

  // ── Password login ──────────────────────────────────────────────────────────
  const handlePasswordLogin = async () => {
    const emailClean = normalizeEmail(email);
    if (!emailClean || !emailClean.includes('@') || !emailClean.includes('.')) {
      setError('Introduce un email válido.'); return;
    }
    if (!password) { setError('Introduce tu contraseña.'); return; }

    setLoading(true); setError('');
    const { error: authError } = await loginWithPassword(emailClean, password);
    setLoading(false);

    if (authError) {
      const msg = authError.message?.toLowerCase() ?? '';
      if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('wrong password')) {
        setError('Email o contraseña incorrectos. Verifica tus datos o usa el enlace por email.');
      } else if (msg.includes('user not found') || msg.includes('no user')) {
        setError('Correo no registrado. Contacta al administrador.');
      } else if (msg.includes('email not confirmed')) {
        setError('Confirma tu email primero. Revisa tu bandeja de entrada.');
      } else {
        setError(`Error: ${authError.message}`);
      }
    }
    // On success: AuthProvider.onAuthStateChange fires → app opens automatically
  };

  // ── Magic link ──────────────────────────────────────────────────────────────
  const handleMagicLink = async () => {
    const emailClean = normalizeEmail(email);
    if (!emailClean || !emailClean.includes('@') || !emailClean.includes('.')) {
      setError('Introduce un email válido.'); return;
    }

    setLoading(true); setError('');
    const { error: authError } = await loginWithEmail(emailClean);
    setLoading(false);

    if (authError) {
      const msg = authError.message?.toLowerCase() ?? '';
      if (msg.includes('rate limit') || msg.includes('too many')) {
        setError('Demasiados intentos. Espera unos minutos.');
      } else {
        setError(`Error: ${authError.message}`);
      }
      return;
    }
    setSuccess('Enlace enviado. Revisa tu bandeja de entrada (y spam).');
  };

  // ── Forgot password ─────────────────────────────────────────────────────────
  const handleForgot = async () => {
    const emailClean = normalizeEmail(email);
    if (!emailClean || !emailClean.includes('@') || !emailClean.includes('.')) {
      setError('Introduce un email válido.'); return;
    }

    setLoading(true); setError('');
    const { error: authError } = await resetPassword(emailClean);
    setLoading(false);

    if (authError) {
      setError(`Error: ${authError.message}`); return;
    }
    setSuccess('Te hemos enviado un enlace para restablecer tu contraseña.');
  };

  const str = mode === 'password' ? pwStrength(password) : null;

  return (
    <div style={{ fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif", background: '#f2f2f7', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        input:focus{outline:none!important;border-color:#0055cc!important;box-shadow:0 0 0 3px rgba(0,85,204,0.12)!important;}
        .lsbtn:hover{opacity:0.88;}
        .lsbtn:active{transform:scale(0.98);}
      `}</style>

      {/* Top bar */}
      <div style={{ background: 'white', borderBottom: '1px solid #e5e5ea', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#0055cc,#0077ed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.2px' }}>COT Tracker</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8e8e93', background: '#f2f2f7', padding: '2px 9px', borderRadius: 99 }}>by MarketMoneyFX</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: 400, animation: 'fadeIn 0.35s ease' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Logo />
            {mode === 'password'    && <h1 style={{ margin: '0 0 5px', fontSize: 23, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Bienvenido de nuevo</h1>}
{mode === 'magic_link'  && <h1 style={{ margin: '0 0 5px', fontSize: 23, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Acceso por enlace</h1>}
{mode === 'forgot'      && <h1 style={{ margin: '0 0 5px', fontSize: 23, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Restablecer contraseña</h1>}
{mode === 'reset'       && <h1 style={{ margin: '0 0 5px', fontSize: 23, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Nueva contraseña</h1>}

<p style={{ margin: 0, fontSize: 13, color: '#8e8e93' }}>
  {mode === 'password'   && 'Introduce tu email y contraseña'}
  {mode === 'magic_link' && 'Te enviaremos un enlace seguro'}
  {mode === 'forgot'     && 'Introduce tu email para recibir el enlace'}
  {mode === 'reset'      && 'Introduce tu nueva contraseña'}
</p>
          </div>

          {/* Card */}
          <div style={{ background: 'white', borderRadius: 20, padding: '22px 20px', boxShadow: '0 2px 20px rgba(0,0,0,0.08)' }}>
            <ErrorBox msg={error} />
            <SuccessBox msg={success} />

            {/* ── PASSWORD MODE ── */}
            {mode === 'password' && !success && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    placeholder="tu@email.com" autoComplete="email" style={inputStyle}/>
                </div>

                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Contraseña</label>
                    <button onClick={() => reset('forgot')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#0055cc', fontWeight: 600, padding: 0 }}>
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                      placeholder="••••••••" autoComplete="current-password"
                      style={{ ...inputStyle, paddingRight: 44 }}/>
                    <button onClick={() => setShowPw(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8e8e93', fontSize: 18, padding: 0, lineHeight: 1 }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {/* Password strength bar */}
                {str && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ height: 3, borderRadius: 99, background: '#f0f0f0', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(str.score / 3) * 100}%`, background: str.color, borderRadius: 99, transition: 'width 0.3s, background 0.3s' }}/>
                    </div>
                    {str.label && <span style={{ fontSize: 10, color: str.color, fontWeight: 600, marginTop: 3, display: 'block' }}>{str.label}</span>}
                  </div>
                )}

                <button className="lsbtn" onClick={handlePasswordLogin} disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, boxShadow: loading ? 'none' : '0 4px 14px rgba(0,85,204,0.32)', transition: 'all 0.2s', marginBottom: 16 }}>
                  {loading ? 'Iniciando sesión…' : 'Acceder'}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ flex: 1, height: 1, background: '#e5e5ea' }}/>
                  <span style={{ fontSize: 11, color: '#8e8e93', fontWeight: 600 }}>o</span>
                  <div style={{ flex: 1, height: 1, background: '#e5e5ea' }}/>
                </div>

                <button className="lsbtn" onClick={() => reset('magic_link')}
                  style={{ width: '100%', padding: '12px', borderRadius: 14, border: '1.5px solid #e5e5ea', cursor: 'pointer', background: 'white', color: '#1c1c1e', fontSize: 14, fontWeight: 600, transition: 'all 0.2s' }}>
                  📧 Recibir enlace por email
                </button>
              </>
            )}

            {/* ── MAGIC LINK MODE ── */}
            {mode === 'magic_link' && !success && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
                    placeholder="tu@email.com" autoComplete="email" style={inputStyle}/>
                </div>

                <button className="lsbtn" onClick={handleMagicLink} disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, boxShadow: loading ? 'none' : '0 4px 14px rgba(0,85,204,0.32)', transition: 'all 0.2s', marginBottom: 14 }}>
                  {loading ? 'Enviando enlace…' : 'Enviar enlace seguro'}
                </button>

                <button onClick={() => reset('password')}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: '#0055cc', fontSize: 13, fontWeight: 600, padding: '6px 0' }}>
                  ← Volver a contraseña
                </button>
              </>
            )}

            {/* ── FORGOT MODE ── */}
            {mode === 'forgot' && !success && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleForgot()}
                    placeholder="tu@email.com" autoComplete="email" style={inputStyle}/>
                </div>

                <button className="lsbtn" onClick={handleForgot} disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, transition: 'all 0.2s', marginBottom: 14 }}>
                  {loading ? 'Enviando enlace…' : 'Enviar enlace de recuperación'}
                </button>

                <button onClick={() => reset('password')}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: '#0055cc', fontSize: 13, fontWeight: 600, padding: '6px 0' }}>
                  ← Volver al inicio de sesión
                </button>
              </>
            )}
            {/* ── RESET MODE ── */}
            {mode === 'reset' && !success && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Nueva contraseña</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Introduce nueva contraseña"
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </div>

                <button
                  className="lsbtn"
                  onClick={async () => {
                    if (!password || password.length < 8) {
                      setError('La contraseña debe tener al menos 8 caracteres.');
                      return;
                    }

                    setLoading(true);
                    setError('');

                    const { error } = await updatePassword(password);

                    setLoading(false);

                    if (error) {
                      setError(error.message);
                      return;
                    }

                    setSuccess('Contraseña actualizada correctamente.');
                  }}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '13px',
                    borderRadius: 14,
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    background: loading
                      ? '#c7d9f4'
                      : 'linear-gradient(135deg,#0055cc,#0077ed)',
                    color: 'white',
                    fontSize: 15,
                    fontWeight: 700,
                    transition: 'all 0.2s',
                    marginBottom: 14
                  }}
                >
                  {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
                </button>
              </>
            )}
            {/* ── SUCCESS STATE (any mode) ── */}
            {success && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <button onClick={() => { setSuccess(''); setError(''); setMode('password'); }}
                  style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#0055cc', fontWeight: 600, fontSize: 13 }}>
                  Volver al inicio de sesión
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
