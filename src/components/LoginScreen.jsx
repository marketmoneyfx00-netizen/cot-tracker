/**
 * LoginScreen.jsx — Premium dark SaaS auth screen
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

// ─── Small components ─────────────────────────────────────────────────────────
const ErrorBox = ({ msg }) => msg ? (
  <div style={{
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 10, padding: '11px 14px', marginBottom: 14,
    fontSize: 13, color: '#fca5a5', lineHeight: 1.55,
  }}>
    {msg}
  </div>
) : null;

const SuccessBox = ({ msg }) => msg ? (
  <div style={{
    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
    borderRadius: 10, padding: '11px 14px', marginBottom: 14,
    fontSize: 13, color: '#86efac', lineHeight: 1.55,
  }}>
    {msg}
  </div>
) : null;

const PasswordToast = ({ visible }) => {
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, minWidth: 320, maxWidth: '90vw',
      background: '#0d1526', border: '1px solid rgba(34,197,94,0.25)',
      borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
      padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12,
      animation: 'toastFadeIn 0.3s cubic-bezier(.4,0,.2,1)',
      fontFamily: "Inter,-apple-system,Helvetica,sans-serif",
    }}>
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✅</span>
      <div>
        <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 700, color: '#e8eaf0' }}>
          Contraseña actualizada correctamente
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#8b90a0', lineHeight: 1.5 }}>
          Tu nueva contraseña ya está activa.
        </p>
      </div>
    </div>
  );
};

// ─── OAuth provider icons (inline SVG) ────────────────────────────────────────
const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269-317.3 65 0 120 43.1 161.3 43.1 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
  </svg>
);

// ─── Password strength ────────────────────────────────────────────────────────
function pwStrength(pw) {
  if (!pw) return null;
  const has8 = pw.length >= 8;
  const hasL = /[a-zA-Z]/.test(pw);
  const hasN = /[0-9]/.test(pw);
  const score = [has8, hasL, hasN].filter(Boolean).length;
  const colors = ['#ef4444', '#f59e0b', '#22c55e'];
  const labels = ['Débil', 'Regular', 'Segura'];
  return { score, color: colors[score - 1] || 'rgba(255,255,255,0.08)', label: labels[score - 1] || '' };
}

// ─── Shared input/label styles (dark) ─────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.1)', fontSize: 14, color: '#e8eaf0',
  background: 'rgba(255,255,255,0.05)', boxSizing: 'border-box',
  fontFamily: "Inter,-apple-system,Helvetica,sans-serif",
  transition: 'all 0.18s', caretColor: '#3b82f6',
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#5a6070',
  marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase',
};

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
  const [oauthLoading, setOauthLoading] = useState(null);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [showToast, setShowToast] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [resendTimer, setResendTimer]   = useState(0);

  const EMAIL_RE   = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  const emailValid = EMAIL_RE.test(normalizeEmail(email));
  const showEmailError = emailTouched && email.length > 0 && !emailValid;

  const reset = (newMode) => {
    setMode(newMode); setError(''); setSuccess('');
    setEmailTouched(false); setResendTimer(0);
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
      if (mode === 'reset') { setSuccess(''); setError(''); setMode('password'); setPassword(''); }
    }, 3000);
    return () => clearTimeout(timer);
  }, [showToast, mode]);

  // ── OAuth ───────────────────────────────────────────────────────────────────
  const handleOAuth = async (provider) => {
    setOauthLoading(provider); setError('');
    const { error: oauthErr } = await loginWithOAuth(provider);
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

  const titles = {
    password:   'Bienvenido a COT Tracker',
    magic_link: 'Acceso por enlace',
    forgot:     'Restablecer contraseña',
    reset:      'Nueva contraseña',
  };
  const subtitles = {
    password:   'Inicia sesión para acceder a tu dashboard',
    magic_link: 'Te enviaremos un enlace seguro al email',
    forgot:     'Introduce tu email para recibir el enlace',
    reset:      'Introduce tu nueva contraseña segura',
  };

  return (
    <div style={{
      fontFamily: "Inter,-apple-system,Helvetica,sans-serif",
      background: '#050810',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastFadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes orb1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(30px,50px) scale(1.1)}}
        @keyframes orb2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-40px,30px) scale(1.08)}}
        @keyframes livePulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0)}}
        .ls-input:focus{outline:none!important;border-color:rgba(59,130,246,0.5)!important;box-shadow:0 0 0 3px rgba(59,130,246,0.12)!important;background:rgba(255,255,255,0.08)!important;}
        .ls-btn:hover:not(:disabled){opacity:0.9;}
        .ls-btn:active:not(:disabled){transform:scale(0.98);}
        .ls-oauth-btn:hover:not(:disabled){background:rgba(255,255,255,0.09)!important;border-color:rgba(255,255,255,0.18)!important;}
        .ls-link-btn:hover{color:#60a5fa!important;}
        .ls-ghost-btn:hover:not(:disabled){background:rgba(255,255,255,0.06)!important;border-color:rgba(255,255,255,0.15)!important;}
      `}</style>

      {/* Gradient orbs */}
      <div aria-hidden="true" style={{ position:'fixed', width:500, height:500, borderRadius:'50%', background:'#2563eb', filter:'blur(130px)', opacity:0.25, top:-160, left:-100, animation:'orb1 18s ease-in-out infinite', pointerEvents:'none' }}/>
      <div aria-hidden="true" style={{ position:'fixed', width:400, height:400, borderRadius:'50%', background:'#7c3aed', filter:'blur(130px)', opacity:0.2,  top:-80, right:-80, animation:'orb2 22s ease-in-out infinite', pointerEvents:'none' }}/>

      {/* Dot grid */}
      <div aria-hidden="true" style={{ position:'fixed', inset:0, backgroundImage:'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize:'28px 28px', pointerEvents:'none' }}/>

      {/* Top bar */}
      <div style={{
        position: 'relative', zIndex: 10,
        background: 'rgba(5,8,16,0.8)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 20px', height: 54,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#2563eb,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 10px rgba(37,99,235,0.4)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontSize:15, fontWeight:800, color:'#e8eaf0', letterSpacing:'-0.3px' }}>COT Tracker</span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#22c55e', background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.2)', padding:'3px 10px', borderRadius:99 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e', display:'inline-block', animation:'livePulse 1.8s ease infinite' }}/>
          CFTC · Activo
        </div>
      </div>

      <PasswordToast visible={showToast} />

      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px', position:'relative', zIndex:1 }}>
        <div style={{ width:'100%', maxWidth:400, animation:'fadeIn 0.4s cubic-bezier(.4,0,.2,1)' }}>

          {/* Logo + header */}
          <div style={{ textAlign:'center', marginBottom:24 }}>
            <div style={{
              width:56, height:56, borderRadius:16, margin:'0 auto 16px',
              background:'linear-gradient(135deg,#2563eb,#7c3aed)',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 8px 24px rgba(37,99,235,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={{ margin:'0 0 6px', fontSize:22, fontWeight:800, color:'#e8eaf0', letterSpacing:'-0.5px' }}>
              {titles[mode]}
            </h1>
            <p style={{ margin:0, fontSize:13, color:'#5a6070' }}>
              {subtitles[mode]}
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: 'rgba(13,21,38,0.75)',
            backdropFilter: 'blur(24px) saturate(180%)',
            borderRadius: 20,
            padding: '22px 20px',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          }}>
            <ErrorBox msg={error} />
            <SuccessBox msg={success} />

            {/* ── PASSWORD MODE ── */}
            {mode === 'password' && !success && (
              <form onSubmit={e => { e.preventDefault(); handlePasswordLogin(); }} noValidate>

                {/* Google */}
                <button
                  type="button"
                  className="ls-btn"
                  onClick={() => handleOAuth('google')}
                  disabled={!!oauthLoading}
                  style={{
                    width:'100%', padding:'12px 16px', borderRadius:11, marginBottom:8,
                    border:'1.5px solid rgba(255,255,255,0.1)',
                    cursor: oauthLoading ? 'not-allowed' : 'pointer',
                    background: 'rgba(255,255,255,0.06)',
                    color:'#e8eaf0', fontSize:14, fontWeight:600,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                    transition:'all 0.18s', boxSizing:'border-box',
                    opacity: oauthLoading && oauthLoading !== 'google' ? 0.4 : 1,
                  }}
                >
                  {oauthLoading === 'google'
                    ? <span style={{ width:17, height:17, borderRadius:'50%', border:'2px solid rgba(255,255,255,0.2)', borderTopColor:'#4285F4', display:'inline-block', animation:'spin 0.7s linear infinite' }}/>
                    : <GoogleIcon />
                  }
                  {oauthLoading === 'google' ? 'Conectando con Google…' : 'Continuar con Google'}
                </button>

                {/* GitHub + Apple */}
                <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                  {[
                    { provider:'github', icon:<GitHubIcon />, label:'GitHub' },
                    { provider:'apple',  icon:<AppleIcon />,  label:'Apple'  },
                  ].map(({ provider, icon, label }) => (
                    <button
                      key={provider}
                      type="button"
                      className="ls-btn ls-oauth-btn"
                      onClick={() => handleOAuth(provider)}
                      disabled={!!oauthLoading}
                      style={{
                        flex:1, padding:'11px 10px', borderRadius:11,
                        border:'1.5px solid rgba(255,255,255,0.1)',
                        cursor: oauthLoading ? 'not-allowed' : 'pointer',
                        background: 'rgba(255,255,255,0.05)',
                        color:'#e8eaf0', fontSize:13, fontWeight:600,
                        display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                        transition:'all 0.18s', boxSizing:'border-box',
                        opacity: oauthLoading && oauthLoading !== provider ? 0.4 : 1,
                      }}
                    >
                      {oauthLoading === provider
                        ? <span style={{ width:14, height:14, borderRadius:'50%', border:'2px solid rgba(255,255,255,0.2)', borderTopColor:'#fff', display:'inline-block', animation:'spin 0.7s linear infinite' }}/>
                        : icon
                      }
                      {label}
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
                  <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                  <span style={{ fontSize:11, color:'#3e4a60', fontWeight:600 }}>o continúa con email</span>
                  <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                </div>

                {/* Email */}
                <div style={{ marginBottom:12 }}>
                  <label style={labelStyle} htmlFor="ls-email">Correo electrónico</label>
                  <input
                    id="ls-email" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com" autoComplete="email"
                    className="ls-input"
                    style={inputStyle}
                  />
                </div>

                {/* Password */}
                <div style={{ marginBottom:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <label style={{ ...labelStyle, marginBottom:0 }} htmlFor="ls-password">Contraseña</label>
                    <button type="button" onClick={() => reset('forgot')} className="ls-link-btn"
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'#3b82f6', fontWeight:600, padding:0, transition:'color .15s' }}>
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div style={{ position:'relative' }}>
                    <input
                      id="ls-password" type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password"
                      className="ls-input"
                      style={{ ...inputStyle, paddingRight:44 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#5a6070', fontSize:16, padding:0, lineHeight:1 }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {str && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ height:3, borderRadius:99, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${(str.score/3)*100}%`, background:str.color, borderRadius:99, transition:'width 0.3s, background 0.3s' }}/>
                    </div>
                    {str.label && <span style={{ fontSize:10, color:str.color, fontWeight:600, marginTop:3, display:'block' }}>{str.label}</span>}
                  </div>
                )}

                <button type="submit" className="ls-btn" disabled={loading}
                  style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', cursor:loading?'not-allowed':'pointer', background:loading?'rgba(37,99,235,0.5)':'linear-gradient(135deg,#2563eb,#7c3aed)', color:'white', fontSize:15, fontWeight:700, boxShadow:loading?'none':'0 4px 18px rgba(37,99,235,0.45)', transition:'all 0.2s', marginBottom:10 }}>
                  {loading ? 'Iniciando sesión…' : 'Acceder con email'}
                </button>

                <button type="button" className="ls-btn ls-ghost-btn" onClick={() => reset('magic_link')}
                  style={{ width:'100%', padding:'11px', borderRadius:12, border:'1.5px solid rgba(255,255,255,0.1)', cursor:'pointer', background:'transparent', color:'#8b90a0', fontSize:13, fontWeight:600, transition:'all 0.2s' }}>
                  📧 Recibir enlace por email (sin contraseña)
                </button>
              </form>
            )}

            {/* ── MAGIC LINK MODE ── */}
            {mode === 'magic_link' && !success && (
              <>
                <div style={{ marginBottom:16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    onBlur={() => setEmailTouched(true)}
                    onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
                    placeholder="tu@email.com" autoComplete="email"
                    className="ls-input"
                    style={{ ...inputStyle, borderColor: showEmailError ? 'rgba(239,68,68,0.4)' : undefined }}
                  />
                  {showEmailError && <span style={{ fontSize:11, color:'#fca5a5', marginTop:4, display:'block' }}>Introduce un email válido</span>}
                </div>
                <button className="ls-btn" onClick={handleMagicLink} disabled={loading}
                  style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', cursor:loading?'not-allowed':'pointer', background:loading?'rgba(37,99,235,0.5)':'linear-gradient(135deg,#2563eb,#7c3aed)', color:'white', fontSize:15, fontWeight:700, boxShadow:loading?'none':'0 4px 18px rgba(37,99,235,0.45)', transition:'all 0.2s', marginBottom:12 }}>
                  {loading ? 'Enviando enlace…' : 'Enviar enlace seguro'}
                </button>
                <button onClick={() => reset('password')} className="ls-link-btn"
                  style={{ width:'100%', background:'none', border:'none', cursor:'pointer', color:'#5a6070', fontSize:13, fontWeight:600, padding:'6px 0', transition:'color .15s' }}>
                  ← Volver al inicio de sesión
                </button>
              </>
            )}

            {/* ── MAGIC LINK SUCCESS ── */}
            {mode === 'magic_link' && success && (
              <div style={{ textAlign:'center', padding:'8px 0' }}>
                <div style={{ fontSize:38, marginBottom:14 }}>📧</div>
                <p style={{ margin:'0 0 6px', fontSize:15, fontWeight:700, color:'#86efac' }}>¡Enlace enviado!</p>
                <p style={{ margin:'0 0 18px', fontSize:13, color:'#5a6070', lineHeight:1.65 }}>
                  Revisa <strong style={{ color:'#8b90a0' }}>{email}</strong> — si no lo ves, mira la carpeta de spam. El enlace caduca en 60 minutos.
                </p>
                <button
                  onClick={() => { setSuccess(''); setResendTimer(0); }}
                  disabled={resendTimer > 0}
                  className="ls-btn ls-ghost-btn"
                  style={{ background:'transparent', border:'1.5px solid rgba(255,255,255,0.1)', borderRadius:10, cursor:resendTimer>0?'default':'pointer', color:resendTimer>0?'#3e4a60':'#8b90a0', fontSize:13, fontWeight:600, padding:'9px 18px', transition:'all 0.2s' }}>
                  {resendTimer > 0 ? `Reenviar en ${resendTimer}s` : 'No lo recibí — reenviar'}
                </button>
              </div>
            )}

            {/* ── FORGOT MODE ── */}
            {mode === 'forgot' && !success && (
              <>
                <div style={{ marginBottom:16 }}>
                  <label style={labelStyle}>Correo electrónico</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleForgot()}
                    placeholder="tu@email.com" autoComplete="email"
                    className="ls-input" style={inputStyle}
                  />
                </div>
                <button className="ls-btn" onClick={handleForgot} disabled={loading}
                  style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', cursor:loading?'not-allowed':'pointer', background:loading?'rgba(37,99,235,0.5)':'linear-gradient(135deg,#2563eb,#7c3aed)', color:'white', fontSize:15, fontWeight:700, transition:'all 0.2s', marginBottom:12 }}>
                  {loading ? 'Enviando enlace…' : 'Enviar enlace de recuperación'}
                </button>
                <button onClick={() => reset('password')} className="ls-link-btn"
                  style={{ width:'100%', background:'none', border:'none', cursor:'pointer', color:'#5a6070', fontSize:13, fontWeight:600, padding:'6px 0', transition:'color .15s' }}>
                  ← Volver al inicio de sesión
                </button>
              </>
            )}

            {/* ── RESET MODE ── */}
            {mode === 'reset' && !success && (
              <>
                <div style={{ marginBottom:6 }}>
                  <label style={labelStyle}>Nueva contraseña</label>
                  <div style={{ position:'relative' }}>
                    <input
                      type={showPw?'text':'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Introduce nueva contraseña" autoComplete="new-password"
                      className="ls-input"
                      style={{ ...inputStyle, paddingRight:44 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      aria-label={showPw?'Ocultar contraseña':'Mostrar contraseña'}
                      style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#5a6070', fontSize:16, padding:0, lineHeight:1 }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                {str && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ height:3, borderRadius:99, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${(str.score/3)*100}%`, background:str.color, borderRadius:99, transition:'width 0.3s, background 0.3s' }}/>
                    </div>
                    {str.label && <span style={{ fontSize:10, color:str.color, fontWeight:600, marginTop:3, display:'block' }}>{str.label}</span>}
                  </div>
                )}
                <button
                  className="ls-btn"
                  onClick={async () => {
                    if (!password || password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
                    setLoading(true); setError('');
                    const { error } = await updatePassword(password);
                    setLoading(false);
                    if (error) { setError('No se pudo actualizar la contraseña. Solicita un nuevo enlace.'); return; }
                    setSuccess('Contraseña actualizada correctamente.');
                    setShowToast(true);
                  }}
                  disabled={loading}
                  style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', cursor:loading?'not-allowed':'pointer', background:loading?'rgba(37,99,235,0.5)':'linear-gradient(135deg,#2563eb,#7c3aed)', color:'white', fontSize:15, fontWeight:700, transition:'all 0.2s', marginBottom:14 }}>
                  {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
                </button>
              </>
            )}

            {/* ── SUCCESS STATE ── */}
            {success && mode !== 'magic_link' && (
              <div style={{ textAlign:'center', padding:'8px 0' }}>
                <div style={{ fontSize:38, marginBottom:14 }}>✅</div>
                <button onClick={() => { setSuccess(''); setError(''); setMode('password'); }} className="ls-link-btn"
                  style={{ marginTop:8, background:'none', border:'none', cursor:'pointer', color:'#3b82f6', fontWeight:600, fontSize:13, transition:'color .15s' }}>
                  Volver al inicio de sesión
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <p style={{ textAlign:'center', fontSize:11, color:'#3e4a60', marginTop:20, lineHeight:1.5 }}>
            🔒 Cifrado end-to-end · Pago seguro con Stripe ·{' '}
            <a href="https://cot-tracker.com" target="_blank" rel="noopener noreferrer" style={{ color:'#5a6070', textDecoration:'underline', textDecorationColor:'rgba(255,255,255,0.1)' }}>cot-tracker.com</a>
          </p>
        </div>
      </div>
    </div>
  );
}
