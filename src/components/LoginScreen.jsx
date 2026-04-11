/**
 * LoginScreen.jsx — Supabase Magic Link / OTP Login
 *
 * Drop-in replacement for the old GAS-based LoginScreen.
 * Props are compatible: onLogin(user) is called after session is confirmed by AuthProvider.
 *
 * Flow:
 *   1. User enters email → loginWithEmail() sends OTP/magic link
 *   2. User clicks link in email → Supabase redirects back to app
 *   3. AuthProvider.onAuthStateChange fires → user is set → gate opens
 *
 * No passwords. No localStorage session. No GAS.
 */

import { useState } from 'react';
import { loginWithEmail, normalizeEmail } from '../lib/authService.js';

export default function LoginScreen({ onNewAccount }) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');

const handleLogin = async () => {
  const emailClean = normalizeEmail(email);

  if (!emailClean || !emailClean.includes('@') || !emailClean.includes('.')) {
    setError('Introduce un email válido.');
    return;
  }

  setLoading(true);
  setError('');

  const { error: authError } = await loginWithEmail(emailClean);

  setLoading(false);

  if (authError) {
    console.error('[LOGIN ERROR]', authError);

    const message = authError.message?.toLowerCase() || '';

    if (
      message.includes('user not found') ||
      message.includes('not found')
    ) {
      setError('Correo no registrado. Regístrate primero.');
      return;
    }

    if (
      message.includes('rate limit') ||
      message.includes('too many requests')
    ) {
      setError('Demasiados intentos. Espera unos minutos.');
      return;
    }

    setError(`Error Supabase: ${authError.message}`);
    return;
  }

  setSent(true);
};

  return (
    <div style={{
      fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
      background: '#f2f2f7', minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        input:focus{outline:none!important;border-color:#0066cc!important;box-shadow:0 0 0 3px rgba(0,102,204,0.12)!important;}
      `}</style>

      {/* Top bar */}
      <div style={{ background:'white', borderBottom:'1px solid #e5e5ea', padding:'14px 20px', display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#0066cc,#0077ed)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 3px 10px rgba(0,102,204,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontSize:16, fontWeight:700, color:'#1c1c1e', letterSpacing:'-0.3px' }}>COT Tracker</span>
        <span style={{ marginLeft:'auto', fontSize:11, color:'#8e8e93', background:'#f2f2f7', padding:'3px 10px', borderRadius:99 }}>by MarketMoneyFX</span>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px' }}>
        <div style={{ width:'100%', maxWidth:400, animation:'fadeIn 0.4s ease' }}>

          {/* Icon + title */}
          <div style={{ textAlign:'center', marginBottom:28 }}>
            <div style={{ width:64, height:64, borderRadius:20, background:'linear-gradient(135deg,#0066cc,#0077ed)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', boxShadow:'0 8px 24px rgba(0,102,204,0.3)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={{ margin:'0 0 6px', fontSize:24, fontWeight:700, color:'#1c1c1e', letterSpacing:'-0.5px' }}>Bienvenido de nuevo</h1>
            <p style={{ margin:0, fontSize:14, color:'#8e8e93' }}>Accede con tu email registrado</p>
          </div>

          <div style={{ background:'white', borderRadius:20, padding:'22px 20px', boxShadow:'0 2px 16px rgba(0,0,0,0.08)' }}>

            {/* Sent state */}
            {sent ? (
              <div style={{ textAlign:'center', padding:'12px 0' }}>
                <div style={{ fontSize:36, marginBottom:12 }}>📧</div>
                <p style={{ fontWeight:700, fontSize:16, color:'#1c1c1e', marginBottom:8 }}>Enlace enviado</p>
                <p style={{ fontSize:13, color:'#8e8e93', lineHeight:1.6 }}>
                  Revisa tu bandeja de entrada y haz clic en el enlace para acceder.<br/>
                  Revisa también tu carpeta de spam.
                </p>
                <button
                  onClick={() => { setSent(false); setEmail(''); }}
                  style={{ marginTop:16, background:'none', border:'none', cursor:'pointer', color:'#0066cc', fontWeight:600, fontSize:13 }}>
                  Volver
                </button>
              </div>
            ) : (
              <>
                {error && (
                  <div style={{ background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.2)', borderRadius:10, padding:'10px 14px', marginBottom:14, fontSize:13, color:'#c0392b' }}>
                    {error}
                  </div>
                )}

                <div style={{ marginBottom:18 }}>
                  <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#8e8e93', marginBottom:6, letterSpacing:'0.04em', textTransform:'uppercase' }}>
                    Correo electrónico
                  </label>
                  <input
                    type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    placeholder="tu@email.com"
                    style={{ width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid #e5e5ea', fontSize:15, color:'#1c1c1e', background:'#f9f9fb', boxSizing:'border-box', fontFamily:'inherit', transition:'all 0.2s' }}
                  />
                </div>

                <button
                  onClick={handleLogin}
                  disabled={loading}
                  style={{ width:'100%', padding:'14px', borderRadius:14, border:'none', cursor:loading?'not-allowed':'pointer', background:loading?'#c7e0f4':'linear-gradient(135deg,#0066cc,#0077ed)', color:'white', fontSize:15, fontWeight:700, boxShadow:loading?'none':'0 4px 16px rgba(0,102,204,0.35)', transition:'all 0.2s' }}>
                  {loading ? 'Enviando enlace…' : 'Acceder → recibir enlace'}
                </button>

                <p style={{ textAlign:'center', fontSize:12, color:'#8e8e93', marginTop:14, lineHeight:1.5 }}>
                  Recibirás un enlace seguro en tu email. Sin contraseña.
                </p>
              </>
            )}
          </div>

          {onNewAccount && (
            <div style={{ marginTop:16, textAlign:'center' }}>
              <p style={{ margin:0, fontSize:13, color:'#8e8e93' }}>
                ¿No tienes cuenta?{' '}
                <button onClick={onNewAccount} style={{ background:'none', border:'none', cursor:'pointer', color:'#0066cc', fontWeight:600, fontSize:13, padding:0 }}>
                  Ver planes →
                </button>
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
