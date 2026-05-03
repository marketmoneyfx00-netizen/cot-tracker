/**
 * CreatePasswordModal.jsx
 * Shown after first magic link login.
 * Prompts user to create a password for faster future access.
 *
 * Calls supabase.auth.updateUser({ password }) via authService.updatePassword().
 * On success: sets users_access.password_created = true, cleans URL, unmounts.
 */

import { useState, useEffect, useCallback } from 'react';
import { updatePassword } from '../lib/authService.js';
import { supabase } from '../lib/supabase.js';

// Password strength scorer
function scorePassword(pw) {
  if (!pw) return { level: 0, label: '', color: '#263041' };
  const has8  = pw.length >= 8;
  const hasL  = /[a-zA-Z]/.test(pw);
  const hasN  = /[0-9]/.test(pw);
  const hasS  = /[^a-zA-Z0-9]/.test(pw);
  const score = [has8, hasL, hasN, hasS].filter(Boolean).length;
  if (score <= 1) return { level: 1, label: 'Débil',    color: '#ef4444' };
  if (score === 2) return { level: 2, label: 'Regular',  color: '#f59e0b' };
  if (score === 3) return { level: 3, label: 'Buena',    color: '#22c55e' };
  return              { level: 4, label: 'Excelente', color: '#0055cc' };
}

const CSS = `
  @keyframes cp-in   { from{opacity:0;transform:scale(0.97) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes cp-fade { from{opacity:0} to{opacity:1} }
  .cp-backdrop { position:fixed;inset:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(14px);
    z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;
    animation:cp-fade 0.2s ease; }
  .cp-card { background:#11161d;border:1px solid #263041;border-radius:20px;
    width:100%;max-width:420px;padding:36px 38px 32px;
    box-shadow:0 40px 100px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04);
    animation:cp-in 0.3s cubic-bezier(.34,1.4,.64,1); }
  .cp-input { width:100%;padding:12px 40px 12px 14px;border-radius:10px;
    border:1.5px solid #263041;background:#0b0f14;color:#e8eaf0;
    font-size:14px;box-sizing:border-box;font-family:inherit;outline:none;
    transition:border-color 0.15s; }
  .cp-input:focus { border-color:#0055cc;box-shadow:0 0 0 3px rgba(0,85,204,0.12); }
  .cp-btn { width:100%;padding:14px;border-radius:11px;border:none;
    background:#0055cc;color:white;font-size:15px;font-weight:700;
    cursor:pointer;font-family:inherit;transition:background 0.15s,transform 0.1s; }
  .cp-btn:hover:not(:disabled) { background:#0047b3;transform:translateY(-1px); }
  .cp-btn:disabled { opacity:0.4;cursor:default; }
  .cp-skip { width:100%;padding:11px;border-radius:11px;border:1px solid #263041;
    background:transparent;color:#5a6070;font-size:13px;font-weight:600;
    cursor:pointer;font-family:inherit;margin-top:9px;transition:all 0.15s; }
  .cp-skip:hover { border-color:#5a6070;color:#8b90a0; }
`;

export default function CreatePasswordModal({ profile, onDone }) {
  const [pw,      setPw]      = useState('');
  const [pw2,     setPw2]     = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [done,    setDone]    = useState(false);

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const strength = scorePassword(pw);
  const match    = pw && pw2 && pw === pw2;
  const mismatch = pw2 && pw !== pw2;

  const handleSubmit = useCallback(async () => {
    if (pw.length < 8)  { setError('Mínimo 8 caracteres.'); return; }
    if (pw !== pw2)     { setError('Las contraseñas no coinciden.'); return; }

    setLoading(true);
    setError('');

    const { error: updateErr } = await updatePassword(pw);
    if (updateErr) {
      setLoading(false);
      setError(updateErr.message || 'Error al guardar la contraseña.');
      return;
    }

    // Mark password_created in users_access
    // FIX: use auth_user_id (RLS policy) not id (row pk) or email
    try {
      const patch = { password_created: true };
      if (profile?.auth_user_id) {
        await supabase.from('users_access').update(patch).eq('auth_user_id', profile.auth_user_id);
      } else if (profile?.id) {
        await supabase.from('users_access').update(patch).eq('id', profile.id);
      }
    } catch (_) { /* non-critical */ }

    setDone(true);
    setLoading(false);

    // Clean ?setup=1 from URL without reload
    const url = new URL(window.location.href);
    url.searchParams.delete('setup');
    window.history.replaceState({}, '', url.pathname + url.search);

    setTimeout(() => onDone(), 900);
  }, [pw, pw2, profile, onDone]);

  const handleSkip = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('setup');
    window.history.replaceState({}, '', url.pathname + url.search);
    onDone();
  }, [onDone]);

  return (
    <>
      <style>{CSS}</style>
      <div className="cp-backdrop">
        <div className="cp-card">
          {/* Icon */}
          <div style={{ width:52, height:52, borderRadius:14,
            background:'rgba(0,85,204,0.12)', border:'1px solid rgba(0,85,204,0.25)',
            display:'flex', alignItems:'center', justifyContent:'center',
            marginBottom:22, fontSize:24 }}>
            🔐
          </div>

          {done ? (
            /* ── Success state ── */
            <div style={{ textAlign:'center', padding:'8px 0' }}>
              <div style={{ fontSize:42, marginBottom:14 }}>✅</div>
              <p style={{ margin:'0 0 6px', fontSize:18, fontWeight:700, color:'#e8eaf0' }}>
                Contraseña guardada
              </p>
              <p style={{ margin:0, fontSize:13, color:'#8b90a0' }}>
                Continuando al dashboard…
              </p>
            </div>
          ) : (
            /* ── Form ── */
            <>
              <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:800,
                color:'#e8eaf0', letterSpacing:'-0.3px' }}>
                Protege tu cuenta
              </h2>
              <p style={{ margin:'0 0 24px', fontSize:14, color:'#8b90a0', lineHeight:1.6 }}>
                Crea una contraseña para entrar más rápido en futuros accesos.
              </p>

              {error && (
                <div style={{ padding:'10px 13px', borderRadius:9, marginBottom:16,
                  background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)',
                  fontSize:12, color:'#ef4444', lineHeight:1.5 }}>
                  {error}
                </div>
              )}

              {/* Password field */}
              <div style={{ marginBottom:12 }}>
                <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#5a6070',
                  marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                  Nueva contraseña
                </label>
                <div style={{ position:'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => { setPw(e.target.value); setError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    autoFocus
                    className="cp-input"
                    style={{ paddingRight:40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                      background:'none', border:'none', cursor:'pointer', color:'#5a6070',
                      fontSize:17, padding:0, lineHeight:1 }}>
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>

                {/* Strength bar */}
                {pw && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ height:3, borderRadius:99, background:'#1a2230',
                      overflow:'hidden', marginBottom:4 }}>
                      <div style={{ height:'100%', borderRadius:99,
                        width:`${(strength.level / 4) * 100}%`,
                        background:strength.color, transition:'width 0.3s,background 0.3s' }}/>
                    </div>
                    <span style={{ fontSize:10, fontWeight:600, color:strength.color }}>
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm field */}
              <div style={{ marginBottom:20 }}>
                <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#5a6070',
                  marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                  Confirmar contraseña
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pw2}
                  onChange={e => { setPw2(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                  className="cp-input"
                  style={{
                    borderColor: mismatch ? '#ef4444' : match ? '#22c55e' : undefined,
                  }}
                />
                {mismatch && (
                  <span style={{ fontSize:11, color:'#ef4444', marginTop:4, display:'block' }}>
                    Las contraseñas no coinciden
                  </span>
                )}
                {match && (
                  <span style={{ fontSize:11, color:'#22c55e', marginTop:4, display:'block' }}>
                    ✓ Coinciden
                  </span>
                )}
              </div>

              <button
                className="cp-btn"
                onClick={handleSubmit}
                disabled={loading || !pw || !pw2 || pw !== pw2 || pw.length < 8}
              >
                {loading ? 'Guardando…' : 'Guardar y continuar →'}
              </button>
              <button className="cp-skip" onClick={handleSkip}>
                Ahora no — entrar sin contraseña
              </button>

              <p style={{ margin:'16px 0 0', fontSize:11, color:'#5a6070',
                textAlign:'center', lineHeight:1.5 }}>
                También podrás crear una contraseña desde Ajustes en cualquier momento.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
