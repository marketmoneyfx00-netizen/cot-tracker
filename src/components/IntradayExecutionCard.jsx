/**
 * IntradayExecutionCard.jsx — Intraday Execution Layer
 * Premium visual refactor — logic unchanged.
 */

import { useState, useEffect, useRef } from 'react';
import { calculateExecutionScore } from '../intradayExecutionEngine.js';
import TooltipInfo from './TooltipInfo.jsx';

// ─── FACTOR BAR ───────────────────────────────────────────────────────────────
function FactorBar({ label, tooltip, points, max, weight, darkMode, T }) {
  const pct   = max > 0 ? Math.round((points / max) * 100) : 0;
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const sub2  = T.sub2 ?? T.sub;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: T.sub, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 2 }}>
          {label}
          {tooltip && <TooltipInfo text={tooltip} align="left"/>}
        </span>
        <span style={{ fontSize: 10, color: sub2, fontVariantNumeric: 'tabular-nums' }}>
          {points}<span style={{ opacity: 0.5 }}>/{max}</span>
          <span style={{ color: sub2, marginLeft: 5, fontSize: 9, letterSpacing: '0.04em' }}>{weight}</span>
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: color, transition: 'width 0.65s ease' }} />
      </div>
    </div>
  );
}

// ─── STAT PILL ────────────────────────────────────────────────────────────────
function StatPill({ label, tooltip, value, color, bg, border, isMobile }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: isMobile ? '9px 10px' : '11px 14px',
      background: bg, border: `1px solid ${border}`,
      borderRadius: 10, minWidth: isMobile ? 72 : 88, flex: 1,
    }}>
      <span style={{
        fontSize: 9, color: '#94a3b8', fontWeight: 700,
        letterSpacing: '0.07em', marginBottom: 5,
        textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
      }}>
        {label}
        {tooltip && <TooltipInfo text={tooltip} align="center"/>}
      </span>
      <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color, textAlign: 'center', lineHeight: 1.2 }}>{value}</span>
    </div>
  );
}

// ─── PAIR SELECTOR ────────────────────────────────────────────────────────────
function PairSelector({ pairs, selected, onChange, darkMode, T }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedPair = pairs.find(p => p.pair === selected) ?? pairs[0];
  if (!selectedPair) return null;

  const sig = selectedPair.signal?.signal;
  const sigColor = sig === 'buy' ? '#22c55e' : sig === 'sell' ? '#ef4444' : '#94a3b8';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: open ? (darkMode ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)') : 'transparent',
        border: `1px solid ${open ? T.accent + '70' : T.border}`,
        borderRadius: 8, padding: '4px 9px', cursor: 'pointer', transition: 'all 0.15s',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sigColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.txt ?? T.sub, letterSpacing: '0.01em' }}>{selected}</span>
        <span style={{ fontSize: 7, color: T.sub, display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 60,
          background: darkMode ? '#1a1d24' : '#fff',
          border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,0.22)', minWidth: 150, overflow: 'hidden',
        }}>
          {pairs.map((p, i) => {
            const s = p.signal?.signal;
            const sc = s === 'buy' ? '#22c55e' : s === 'sell' ? '#ef4444' : '#94a3b8';
            const active = p.pair === selected;
            return (
              <button key={p.pair} onClick={() => { onChange(p.pair); setOpen(false); }} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px',
                background: active ? (darkMode ? 'rgba(0,85,204,0.16)' : 'rgba(0,85,204,0.07)') : 'transparent',
                border: 'none', borderBottom: i < pairs.length - 1 ? `1px solid ${T.border}` : 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? T.accent : (T.txt ?? T.sub), flex: 1 }}>{p.pair}</span>
                {active && <span style={{ fontSize: 9, color: T.accent }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PERMISSION BADGE ─────────────────────────────────────────────────────────
function PermissionBadge({ permission, score, isMobile }) {
  return (
    <div style={{
      width: isMobile ? 64 : 76, height: isMobile ? 64 : 76,
      borderRadius: '50%',
      border: `2.5px solid ${permission.color}`,
      background: permission.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: `0 0 0 4px ${permission.color}14, 0 4px 16px ${permission.color}28`,
      transition: 'border-color 0.3s, box-shadow 0.3s',
      gap: 1,
    }}>
      <span style={{ fontSize: 8, fontWeight: 700, color: permission.color, letterSpacing: '0.06em', lineHeight: 1 }}>EXEC</span>
      <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: permission.color, lineHeight: 1.1, letterSpacing: '-0.3px' }}>{permission.label}</span>
      <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, color: permission.color, opacity: 0.75, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function IntradayExecutionCard({ biasResult, sentimentData, riskData, availablePairs, darkMode, T, isMobile }) {
  const [expanded, setExpanded] = useState(false);

  const defaultPair = availablePairs?.[0]?.pair ?? '—';
  const [selectedPair, setSelectedPair] = useState(defaultPair);

  useEffect(() => {
    if (!availablePairs?.length) return;
    if (!availablePairs.some(p => p.pair === selectedPair)) setSelectedPair(availablePairs[0].pair);
  }, [availablePairs, selectedPair]);

  const activePair   = availablePairs?.some(p => p.pair === selectedPair) ? selectedPair : defaultPair;
  const pairData     = availablePairs?.find(p => p.pair === activePair);
  const activeBias   = pairData?.bias ?? biasResult;

  const biasScore     = activeBias?.score     ?? 0;
  const biasDirection = activeBias?.direction ?? 'neutral';
  const fg            = sentimentData?.fg        ?? 50;
  const vix           = sentimentData?.vix       ?? 18;
  const highCount     = sentimentData?.highCount ?? 0;
  const midCount      = sentimentData?.midCount  ?? 0;
  const riskScore     = riskData?.score ?? 0;

  const result = calculateExecutionScore({ biasScore, biasDirection, riskScore, fg, vix, highCount, midCount });
  if (!result) return null;

  const { score, permission, biasAlignment, macroRisk, volatilityState, breakdown } = result;
  const trackBg = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const sub2    = T.sub2 ?? T.sub;

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${permission.border}`,
      borderRadius: 14,
      padding: isMobile ? '14px' : '18px 20px',
      marginBottom: 12,
      boxShadow: `0 0 0 3px ${permission.color}10, 0 4px 20px rgba(0,0,0,0.10)`,
    }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: permission.color, boxShadow: `0 0 6px ${permission.color}`, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: sub2, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            INTRADAY EXECUTION LAYER
          </span>
        </div>
        {availablePairs?.length > 0 && (
          <PairSelector pairs={availablePairs} selected={activePair} onChange={setSelectedPair} darkMode={darkMode} T={T} />
        )}
      </div>

      {/* ── SCORE BLOCK ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 18, marginBottom: 18 }}>
        <PermissionBadge permission={permission} score={score} isMobile={isMobile} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Big score number */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 3 }}>
            <span style={{ fontSize: isMobile ? 28 : 34, fontWeight: 800, color: permission.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', transition: 'color 0.3s' }}>
              {score}
            </span>
            <span style={{ fontSize: 13, color: sub2, fontWeight: 500 }}>/100</span>
          </div>
          {/* Descriptor */}
          <div style={{ fontSize: isMobile ? 11 : 12, color: T.sub, lineHeight: 1.55, marginBottom: 3 }}>
            Busca setups solo cuando el permiso sea{' '}
            <span style={{ color: '#22c55e', fontWeight: 700 }}>HIGH</span>
          </div>
          {/* Context line */}
          <div style={{ fontSize: 9, color: sub2, letterSpacing: '0.05em', fontWeight: 500 }}>
            CONTEXTO PARA: <span style={{ fontWeight: 700, color: T.sub }}>{activePair}</span>
          </div>
        </div>
      </div>

      {/* ── CONFIDENCE GAUGE ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 9, color: sub2, fontWeight: 700, letterSpacing: '0.07em', display: 'flex', alignItems: 'center', gap: 3 }}>
            CONFIDENCE SCORE
            <TooltipInfo text="Permiso operativo intradía. Mide si el contexto actual favorece buscar setups. No genera señales por sí solo." align="left"/>
          </span>
          <span style={{ fontSize: 9, color: sub2, letterSpacing: '0.04em' }}>0 ── 100</span>
        </div>
        {/* Gauge track */}
        <div style={{ position: 'relative', height: 7, borderRadius: 99, background: trackBg, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${score}%`,
            background: `linear-gradient(90deg, ${permission.color}70, ${permission.color})`,
            borderRadius: 99, transition: 'width 0.7s ease',
          }} />
        </div>
        {/* Threshold markers */}
        <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
          {[{ pct: 45, label: '45' }, { pct: 70, label: '70' }].map(({ pct, label }) => (
            <div key={pct} style={{
              position: 'absolute', left: `${pct}%`, top: 0,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <div style={{ width: 1, height: 4, background: T.border }} />
              <span style={{ fontSize: 8, color: sub2, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
            </div>
          ))}
          <span style={{ position: 'absolute', left: '45%', top: 8, fontSize: 8, color: sub2, transform: 'translateX(-50%) translateX(2px)', opacity: 0.6 }}>MED</span>
          <span style={{ position: 'absolute', left: '70%', top: 8, fontSize: 8, color: sub2, transform: 'translateX(-50%) translateX(2px)', opacity: 0.6 }}>HIGH</span>
        </div>
      </div>

      {/* ── STAT PILLS ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <StatPill label="BIAS" value={biasAlignment.label} color={biasAlignment.color} bg={`${biasAlignment.color}14`} border={`${biasAlignment.color}30`} isMobile={isMobile} />
        <StatPill label="MACRO RISK" tooltip="Riesgo por eventos macro y calendario. Si es alto, reduce la confianza operativa." value={macroRisk.label} color={macroRisk.color} bg={`${macroRisk.color}14`} border={`${macroRisk.color}30`} isMobile={isMobile} />
        <StatPill label="VOLATILITY" value={volatilityState.label} color={volatilityState.color} bg={`${volatilityState.color}14`} border={`${volatilityState.color}30`} isMobile={isMobile} />
      </div>

      {/* ── BREAKDOWN TOGGLE ── */}
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', background: 'transparent',
        border: `1px solid ${expanded ? `${permission.color}50` : T.border}`,
        borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        color: T.sub, fontSize: 11, fontWeight: 600, transition: 'border-color 0.2s',
      }}>
        <span>{expanded ? 'Ocultar desglose' : 'Ver desglose de factores'}</span>
        <span style={{ fontSize: 8, display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>▼</span>
      </button>

      {/* ── BREAKDOWN ── */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            background: darkMode ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)',
            border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px',
          }}>
            <FactorBar label="HTF Bias Strength"  tooltip="Fuerza del sesgo HTF dentro del score. Cuanto mayor sea, más peso tiene el contexto semanal."     points={breakdown.htfBias.points}      max={breakdown.htfBias.max}      weight={breakdown.htfBias.weight}      darkMode={darkMode} T={T} />
            <FactorBar label="Macro Event Risk"   tooltip="Riesgo por eventos macro y calendario. Si es alto, reduce la confianza operativa."                  points={breakdown.macroRisk.points}    max={breakdown.macroRisk.max}    weight={breakdown.macroRisk.weight}    darkMode={darkMode} T={T} />
            <FactorBar label="Fear / Greed"       points={breakdown.fearGreed.points}    max={breakdown.fearGreed.max}    weight={breakdown.fearGreed.weight}    darkMode={darkMode} T={T} />
            <FactorBar label="Volatility State"   points={breakdown.volatility.points}   max={breakdown.volatility.max}   weight={breakdown.volatility.weight}   darkMode={darkMode} T={T} />
            <FactorBar label="Calendar Sentiment" points={breakdown.calSentiment.points} max={breakdown.calSentiment.max} weight={breakdown.calSentiment.weight} darkMode={darkMode} T={T} />
            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.txt ?? T.sub, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 3 }}>
                CONFIDENCE SCORE
                <TooltipInfo text="Permiso operativo intradía. Mide si el contexto actual favorece buscar setups. No genera señales por sí solo." align="left"/>
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, color: permission.color, fontVariantNumeric: 'tabular-nums' }}>{score}/100</span>
            </div>
          </div>
          <p style={{
            fontSize: 10, color: T.sub, marginTop: 8, lineHeight: 1.55,
            padding: '7px 11px',
            background: darkMode ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.018)',
            borderRadius: 7, border: `1px solid ${T.border}`,
          }}>
            ⚠️ Este módulo no genera señales de entrada. Es un filtro de contexto y permiso operativo basado en datos institucionales y macro del día.
          </p>
        </div>
      )}
    </div>
  );
}
