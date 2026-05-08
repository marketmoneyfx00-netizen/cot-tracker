/**
 * LoginScreen.jsx — Social-first auth
 *
 * Primary: OAuth buttons (Google, GitHub, Apple)
 * Secondary: email + password / magic link / forgot / reset
 *
 * OAuth flow: signInWithOAuth() → provider → /auth/callback → AuthProvider fires
 * Email flow: signInWithPassword() / signInWithOtp() → same AuthProvider pickup
 */

import { useState, useEffect } from 'react';
import {
  loginWithPassword, loginWithEmail, loginWithOAuth,
  resetPassword, updatePassword, normalizeEmail,
} from '../lib/authService.js';

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12,
  border: '1.5px solid #e5e5ea', fontSize: 15, color: '#1c1c1e',
  background: '#f9f9fb', boxSizing: 'border-box',
  fontFamily: 'inherit', transition: 'all 0.2s',
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#8e8e93',
  marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
};

// ─── Small components ─────────────────────────────────────────────────────────
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

const PasswordToast = ({ visible }) => {
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, minWidth: 320, maxWidth: '90vw',
      background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(34,197,94,0.12)',
      padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12,
      animation: 'toastFadeIn 0.3s cubic-bezier(.4,0,.2,1)',
      fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
    }}>
      <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✅</span>
      <div>
        <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 700, color: '#14532d' }}>
          Contraseña actualizada correctamente
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
          Tu nueva contraseña ya está activa.
        </p>
      </div>
    </div>
  );
};

const Logo = () => (
  <div style={{ width: 60, height: 60, borderRadius: 18, background: 'linear-gradient(135deg,#0055cc,#0077ed)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 8px 24px rgba(0,85,204,0.3)' }}>
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </div>
);

// ─── OAuth provider icons (inline SVG) ────────────────────────────────────────
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269-317.3 65 0 120 43.1 161.3 43.1 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
  </svg>
);

// ─── Social button ────────────────────────────────────────────────────────────
function SocialButton({ icon, label, onClick, loading, style = {} }) {
  return (
    <button
      type="button"
      className="lsbtn"
      onClick={onClick}
      disabled={loading}
      style={{
        width: '100%', padding: '12px 16px', borderRadius: 12,
        border: '1.5px solid #e5e5ea', cursor: loading ? 'not-allowed' : 'pointer',
        background: 'white', color: '#1c1c1e', fontSize: 14, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        transition: 'all 0.2s', boxSizing: 'border-box',
        opacity: loading ? 0.6 : 1,
        ...style,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Password strength ────────────────────────────────────────────────────────
function pwStrength(pw) {
  if (!pw) return null;
  const has8 = pw.length >= 8;
  const hasL = /[a-zA-Z]/.test(pw);
  const hasN = /[0-9]/.test(pw);
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

  const [mode, setMode]           = useState(initialMode);
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null); // 'google' | 'github' | 'apple'
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [showToast, setShowToast] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [resendTimer, setResendTimer]   = useState(0);

  const EMAIL_RE   = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  const emailValid = EMAIL_RE.test(normalizeEmail(email));
  const showEmailError = emailTouched && email.length > 0 && !emailValid;

  const reset = (newMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
    setEmailTouched(false);
    setResendTimer(0);
  };

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => {
      setShowToast(false);
      if (mode === 'reset') {
        setSuccess(''); setError('');
        setMode('password'); setPassword('');
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [showToast, mode]);

  // ── OAuth login ─────────────────────────────────────────────────────────────
  const handleOAuth = async (provider) => {
    setOauthLoading(provider);
    setError('');
    const { error: oauthErr } = await loginWithOAuth(provider);
    // If error, show message; otherwise the page redirects (no state update needed)
    if (oauthErr) {
      setOauthLoading(null);
      const msg = oauthErr.message?.toLowerCase() ?? '';
      if (msg.includes('provider') || msg.includes('not enabled') || msg.includes('unsupported')) {
        const names = { google: 'Google', github: 'GitHub', apple: 'Apple' };
        setError(`${names[provider] || provider} no está habilitado todavía. Usa email o contacta con soporte.`);
      } else {
        setError('No se pudo conectar con el proveedor. Inténtalo de nuevo.');
      }
    }
    // On success the browser redirects — no need to reset oauthLoading
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
      if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('wrong password') || msg.includes('user not found') || msg.includes('no user')) {
        setError('Email o contraseña incorrectos. Verifica tus datos o inicia sesión con Google.');
      } else if (msg.includes('email not confirmed')) {
        setError('Confirma tu email primero. Revisa tu bandeja de entrada.');
      } else if (msg.includes('rate limit') || msg.includes('too many')) {
        setError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setError('Error de conexión. Verifica tu internet e inténtalo de nuevo.');
      } else {
        setError('No se pudo iniciar sesión. Inténtalo de nuevo o usa Google.');
      }
    }
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
    setSuccess('Enlace enviado. Revisa tu bandeja de entrada (y la carpeta spam).');
    setResendTimer(60);
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
      const msg = authError.message?.toLowerCase() ?? '';
      if (msg.includes('rate limit') || msg.includes('too many')) {
        setError('Demasiados intentos. Espera unos minutos.');
      } else {
        setError('No se pudo enviar el enlace. Inténtalo de nuevo.');
      }
      return;
    }
    setSuccess('Te hemos enviado un enlace para restablecer tu contraseña.');
  };

  const str = (mode === 'password' || mode === 'reset') ? pwStrength(password) : null;

  return (
    <div style={{ fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif", background: '#f2f2f7', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastFadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        input:focus{outline:none!important;border-color:#0055cc!important;box-shadow:0 0 0 3px rgba(0,85,204,0.12)!important;}
        .lsbtn:hover:not(:disabled){opacity:0.88;}
        .lsbtn:active:not(:disabled){transform:scale(0.98);}
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

      <PasswordToast visible={showToast} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: 400, animation: 'fadeIn 0.35s ease' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <Logo />
            {mode === 'password'   && <h1 style={{ margin: '0 0 5px', fontSize: 22, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Bienvenido a COT Tracker</h1>}
            {mode === 'magic_link' && <h1 style={{ margin: '0 0 5px', fontSize: 22, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Acceso por enlace</h1>}
            {mode === 'forgot'     && <h1 style={{ margin: '0 0 5px', fontSize: 22, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Restablecer contraseña</h1>}
            {mode === 'reset'      && <h1 style={{ margin: '0 0 5px', fontSize: 22, fontWeight: 700, color: '#1c1c1e', letterSpacing: '-0.4px' }}>Nueva contraseña</h1>}
            <p style={{ margin: 0, fontSize: 13, color: '#8e8e93' }}>
              {mode === 'password'   && 'Inicia sesión para acceder a tu dashboard'}
              {mode === 'magic_link' && 'Te enviaremos un enlace seguro al email'}
              {mode === 'forgot'     && 'Introduce tu email para recibir el enlace'}
              {mode === 'reset'      && 'Introduce tu nueva contraseña'}
            </p>
          </div>

          {/* Card */}
          <div style={{ background: 'white', borderRadius: 20, padding: '22px 20px', boxShadow: '0 2px 20px rgba(0,0,0,0.08)' }}>
            <ErrorBox msg={error} />
            <SuccessBox msg={success} />

            {/* ── PASSWORD MODE — social first ── */}
            {mode === 'password' && !success && (
              <form onSubmit={e => { e.preventDefault(); handlePasswordLogin(); }} noValidate>

                {/* Social login buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                  <SocialButton
                    icon={<GoogleIcon />}
                    label={oauthLoading === 'google' ? 'Redirigiendo…' : 'Continuar con Google'}
                    loading={oauthLoading === 'google'}
                    onClick={() => handleOAuth('google')}
                  />
                  <SocialButton
                    icon={<GitHubIcon />}
                    label={oauthLoading === 'github' ? 'Redirigiendo…' : 'Continuar con GitHub'}
                    loading={oauthLoading === 'github'}
                    onClick={() => handleOAuth('github')}
                    style={{ color: '#24292f' }}
                  />
                  <SocialButton
                    icon={<AppleIcon />}
                    label={oauthLoading === 'apple' ? 'Redirigiendo…' : 'Continuar con Apple'}
                    loading={oauthLoading === 'apple'}
                    onClick={() => handleOAuth('apple')}
                    style={{ background: '#000', color: '#fff', border: '1.5px solid #000' }}
                  />
                </div>

                {/* Divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{ flex: 1, height: 1, background: '#e5e5ea' }}/>
                  <span style={{ fontSize: 11, color: '#8e8e93', fontWeight: 600 }}>o continúa con email</span>
                  <div style={{ flex: 1, height: 1, background: '#e5e5ea' }}/>
                </div>

                {/* Email */}
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle} htmlFor="ls-email">Correo electrónico</label>
                  <input
                    id="ls-email" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com" autoComplete="email"
                    style={inputStyle}
                  />
                </div>

                {/* Password */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="ls-password">Contraseña</label>
                    <button type="button" onClick={() => reset('forgot')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#0055cc', fontWeight: 600, padding: 0 }}>
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="ls-password" type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password"
                      style={{ ...inputStyle, paddingRight: 44 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8e8e93', fontSize: 18, padding: 0, lineHeight: 1 }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {str && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ height: 3, borderRadius: 99, background: '#f0f0f0', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(str.score / 3) * 100}%`, background: str.color, borderRadius: 99, transition: 'width 0.3s, background 0.3s' }}/>
                    </div>
                    {str.label && <span style={{ fontSize: 10, color: str.color, fontWeight: 600, marginTop: 3, display: 'block' }}>{str.label}</span>}
                  </div>
                )}

                <button type="submit" className="lsbtn" disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, boxShadow: loading ? 'none' : '0 4px 14px rgba(0,85,204,0.32)', transition: 'all 0.2s', marginBottom: 12 }}>
                  {loading ? 'Iniciando sesión…' : 'Acceder con email'}
                </button>

                <button type="button" className="lsbtn" onClick={() => reset('magic_link')}
                  style={{ width: '100%', padding: '11px', borderRadius: 14, border: '1.5px solid #e5e5ea', cursor: 'pointer', background: 'white', color: '#1c1c1e', fontSize: 13, fontWeight: 600, transition: 'all 0.2s' }}>
                  📧 Recibir enlace por email (sin contraseña)
                </button>
              </form>
            )}

            {/* ── MAGIC LINK MODE ── */}
            {mode === 'magic_link' && !success && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    onBlur={() => setEmailTouched(true)}
                    onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
                    placeholder="tu@email.com" autoComplete="email"
                    style={{ ...inputStyle, borderColor: showEmailError ? '#ef4444' : undefined }}
                  />
                  {showEmailError && (
                    <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>
                      Introduce un email válido
                    </span>
                  )}
                </div>
                <button className="lsbtn" onClick={handleMagicLink} disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, boxShadow: loading ? 'none' : '0 4px 14px rgba(0,85,204,0.32)', transition: 'all 0.2s', marginBottom: 14 }}>
                  {loading ? 'Enviando enlace…' : 'Enviar enlace seguro'}
                </button>
                <button onClick={() => reset('password')}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: '#0055cc', fontSize: 13, fontWeight: 600, padding: '6px 0' }}>
                  ← Volver al inicio de sesión
                </button>
              </>
            )}

            {/* ── MAGIC LINK SUCCESS ── */}
            {mode === 'magic_link' && success && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
                <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#1a7a4a' }}>
                  ¡Enlace enviado!
                </p>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5a6a6a', lineHeight: 1.6 }}>
                  Revisa <strong>{email}</strong> — si no lo ves, mira la carpeta de spam.
                  El enlace caduca en 60 minutos.
                </p>
                <button
                  onClick={() => { setSuccess(''); setResendTimer(0); }}
                  disabled={resendTimer > 0}
                  style={{ background: 'none', border: '1.5px solid #e5e5ea', borderRadius: 10, cursor: resendTimer > 0 ? 'default' : 'pointer', color: resendTimer > 0 ? '#8e8e93' : '#0055cc', fontSize: 13, fontWeight: 600, padding: '9px 18px', transition: 'all 0.2s' }}>
                  {resendTimer > 0 ? `Reenviar en ${resendTimer}s` : 'No lo recibí — reenviar'}
                </button>
              </div>
            )}

            {/* ── FORGOT MODE ── */}
            {mode === 'forgot' && !success && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleForgot()}
                    placeholder="tu@email.com" autoComplete="email" style={inputStyle}
                  />
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
                <div style={{ marginBottom: 6 }}>
                  <label style={labelStyle}>Nueva contraseña</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Introduce nueva contraseña" autoComplete="new-password"
                      style={{ ...inputStyle, paddingRight: 44 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8e8e93', fontSize: 18, padding: 0, lineHeight: 1 }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                {str && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ height: 3, borderRadius: 99, background: '#f0f0f0', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(str.score / 3) * 100}%`, background: str.color, borderRadius: 99, transition: 'width 0.3s, background 0.3s' }}/>
                    </div>
                    {str.label && <span style={{ fontSize: 10, color: str.color, fontWeight: 600, marginTop: 3, display: 'block' }}>{str.label}</span>}
                  </div>
                )}
                <button
                  className="lsbtn"
                  onClick={async () => {
                    if (!password || password.length < 8) {
                      setError('La contraseña debe tener al menos 8 caracteres.');
                      return;
                    }
                    setLoading(true); setError('');
                    const { error } = await updatePassword(password);
                    setLoading(false);
                    if (error) {
                      setError('No se pudo actualizar la contraseña. Solicita un nuevo enlace.');
                      return;
                    }
                    setSuccess('Contraseña actualizada correctamente.');
                    setShowToast(true);
                  }}
                  disabled={loading}
                  style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#c7d9f4' : 'linear-gradient(135deg,#0055cc,#0077ed)', color: 'white', fontSize: 15, fontWeight: 700, transition: 'all 0.2s', marginBottom: 14 }}>
                  {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
                </button>
              </>
            )}

            {/* ── SUCCESS STATE ── */}
            {success && mode !== 'magic_link' && (
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
