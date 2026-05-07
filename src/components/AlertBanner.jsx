/**
 * AlertBanner.jsx — v6 Decision Panel
 * Hard guard: requires alert.verdict to render.
 * AVOID suppresses all intraday constraint noise.
 */
import { useState, useEffect } from 'react';

const VERDICT_CFG = {
  EXECUTE: {
    color:  '#22c55e',
    bg:     'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.28)',
    badge:  'EJECUTAR',
  },
  PREPARE: {
    color:  '#f59e0b',
    bg:     'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.28)',
    badge:  'PREPARAR',
  },
  AVOID: {
    color:  '#ef4444',
    bg:     'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.28)',
    badge:  'NO OPERAR',
  },
};

export default function AlertBanner({ alert, alertKey, intradayConstraint, intradayBlock, darkMode, T, pair }) {
  const [lastKey,    setLastKey]    = useState(null);
  const [dismissed,  setDismissed]  = useState(false);
  const [notifState, setNotifState] = useState('idle');

  useEffect(() => {
    if (alertKey && alertKey !== lastKey) {
      setLastKey(alertKey);
      setDismissed(false);
    }
  }, [alertKey]);

  // Hard guard — requires verdict field to render
  if (!alert || !alert.verdict || dismissed) return null;

  const vcfg = VERDICT_CFG[alert.verdict] || VERDICT_CFG.AVOID;

  const displayTitle   = alert.verdictTitle   ?? alert.title;
  const displayMessage = alert.verdictMessage ?? alert.message;
  const displayAction  = alert.verdictAction  ?? alert.action;
  const displayColor   = alert.verdictColor   ?? vcfg.color;
  const displayBadge   = vcfg.badge;

  const isExecute = alert.verdict === 'EXECUTE';
  const isAvoid   = alert.verdict === 'AVOID';

  const handleNotif = () => {
    if (!('Notification' in window)) { setNotifState('denied'); return; }
    Notification.requestPermission().then(perm => {
      setNotifState(perm === 'granted' ? 'granted' : 'denied');
      if (perm === 'granted') {
        new Notification('COT Tracker — ' + displayTitle, {
          body: displayMessage + '\n→ ' + displayAction,
          icon: '/favicon.ico',
        });
      }
    });
  };

  return (
    <div style={{
      background: vcfg.bg,
      border: `1px solid ${vcfg.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      marginBottom: 16,
      animation: 'fadeUp 0.3s ease both',
    }}>

      {/* ── Row 1: pair + badge + dismiss ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {pair && (
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.05em',
              color: T.txt,
              background: T.card2 || (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
              border: `1px solid ${T.border}`,
              padding: '3px 9px', borderRadius: 5,
              fontFamily: 'monospace',
            }}>
              {pair}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
            color: displayColor,
            background: displayColor + '1a',
            border: `1px solid ${displayColor}30`,
            padding: '3px 9px', borderRadius: 5,
          }}>
            {displayBadge}
          </span>
        </div>
        <button onClick={() => setDismissed(true)} aria-label="Cerrar" style={{
          background: 'transparent', border: 'none', color: T.sub2,
          cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2, opacity: 0.35,
        }}>✕</button>
      </div>

      {/* ── Row 2: verdict title ───────────────────────────────────────────── */}
      <div style={{
        fontSize: 18, fontWeight: 800, color: displayColor,
        lineHeight: 1.2, marginBottom: 4, letterSpacing: '-0.01em',
      }}>
        {displayTitle}
      </div>

      {/* ── Row 3: real-time label ─────────────────────────────────────────── */}
      <div style={{ fontSize: 10, color: T.sub2, marginBottom: 10 }}>
        Condición evaluada en tiempo real
      </div>

      {/* ── Row 4: message ─────────────────────────────────────────────────── */}
      <p style={{ margin: '0 0 12px', fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
        {displayMessage}
      </p>

      {/* ── Row 5: action block ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', borderRadius: 9,
        background: displayColor + '14',
        border: `1px solid ${displayColor}30`,
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: displayColor, flexShrink: 0 }}>→</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.txt, lineHeight: 1.4 }}>
          {displayAction}
        </span>
      </div>

      {/* ── Row 6: pairs (hidden on AVOID — no actionable pairs) ───────────── */}
      {!isAvoid && alert.pairs?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {alert.pairs.map(p => (
            <span key={p} style={{
              fontSize: 10, fontWeight: 700,
              color: displayColor,
              background: displayColor + '12',
              border: `1px solid ${displayColor}28`,
              padding: '3px 9px', borderRadius: 5,
            }}>{p}</span>
          ))}
        </div>
      )}

      {/* ── Row 7: high-conviction bonus (EXECUTE only) ────────────────────── */}
      {isExecute && alert.strength === 'high' && (
        <div style={{
          fontSize: 11, color: displayColor, fontStyle: 'italic',
          marginBottom: 12, paddingLeft: 2,
        }}>
          Este tipo de oportunidad no aparece todos los días.
        </div>
      )}

      {/* ── Row 8: intraday constraint — suppressed on AVOID ───────────────── */}
      {!isAvoid && intradayConstraint && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '9px 12px', borderRadius: 8, marginBottom: 12,
          background: intradayBlock ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
          border: `1px solid ${intradayBlock ? 'rgba(239,68,68,0.28)' : 'rgba(245,158,11,0.28)'}`,
        }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>{intradayBlock ? '⛔' : '⚠️'}</span>
          <div>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: intradayBlock ? '#ef4444' : '#f59e0b',
            }}>
              Condición de ejecución:{' '}
            </span>
            <span style={{ fontSize: 11, color: T.sub }}>
              {intradayConstraint.message}
            </span>
          </div>
        </div>
      )}

      {/* ── Row 9: notification (EXECUTE only) ────────────────────────────── */}
      {isExecute && !intradayBlock && notifState === 'idle' && (
        <button onClick={handleNotif} style={{
          fontSize: 11, fontWeight: 600,
          color: displayColor,
          background: 'transparent',
          border: `1px solid ${displayColor}40`,
          borderRadius: 7, padding: '5px 12px', cursor: 'pointer',
        }}>
          🔔 Avisarme cuando haya oportunidades reales
        </button>
      )}
      {notifState === 'granted' && (
        <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Notificaciones activadas</span>
      )}
      {notifState === 'denied' && (
        <span style={{ fontSize: 10, color: '#ef4444' }}>
          Notificaciones bloqueadas — actívalas en la configuración del navegador
        </span>
      )}
    </div>
  );
}
