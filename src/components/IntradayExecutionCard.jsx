/**
 * IntradayExecutionCard.jsx — Intraday Execution Layer
 *
 * Contextual permission card for day traders.
 * Fuses HTF institutional bias with intraday macro context.
 *
 * ⚠️ Does NOT generate buy/sell signals.
 *    Shows execution permission context ONLY.
 */

import { useState, useEffect, useRef } from 'react';
import { calculateExecutionScore } from '../intradayExecutionEngine.js';

// ─── MINI PROGRESS BAR ────────────────────────────────────────────────────────
function FactorBar({ label, points, max, weight, darkMode, T }) {
  const pct = max > 0 ? Math.round((points / max) * 100) : 0;
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: T.sub, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: T.sub, fontFamily: 'monospace' }}>
          {points}/{max}
          <span style={{ color: T.sub2 ?? T.sub, marginLeft: 4, fontSize: 10 }}>{weight}</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          borderRadius: 99,
          background: color,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

// ─── STAT PILL ────────────────────────────────────────────────────────────────
function StatPill({ label, value, color, bg, border, isMobile }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: isMobile ? '8px 10px' : '10px 14px',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      minWidth: isMobile ? 70 : 90,
      flex: 1,
    }}>
      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4, textAlign: 'center' }}>{label}</span>
      <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color, textAlign: 'center', lineHeight: 1.2 }}>{value}</span>
    </div>
  );
}

// ─── PAIR SELECTOR ────────────────────────────────────────────────────────────
function PairSelector({ pairs, selected, onChange, darkMode, T }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selectedPair = pairs.find(p => p.pair === selected) ?? pairs[0];
  if (!selectedPair) return null;

  const sig = selectedPair.signal?.signal;
  const sigColor = sig === 'buy' ? '#22c55e' : sig === 'sell' ? '#ef4444' : '#94a3b8';

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger pill */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: open
            ? (darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)')
            : (darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
          border: `1px solid ${open ? T.accent + '80' : T.border}`,
          borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sigColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.txt ?? T.sub, letterSpacing: '0.02em' }}>
          {selected}
        </span>
        <span style={{
          fontSize: 8, color: T.sub,
          display: 'inline-block',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
          marginLeft: 2,
        }}>▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
          background: darkMode ? '#1a1d24' : '#ffffff',
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          minWidth: 160,
          overflow: 'hidden',
        }}>
          {pairs.map((p, i) => {
            const s = p.signal?.signal;
            const sc = s === 'buy' ? '#22c55e' : s === 'sell' ? '#ef4444' : '#94a3b8';
            const isActive = p.pair === selected;
            return (
              <button
                key={p.pair}
                onClick={() => { onChange(p.pair); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 14px',
                  background: isActive
                    ? (darkMode ? 'rgba(0,85,204,0.18)' : 'rgba(0,85,204,0.07)')
                    : 'transparent',
                  border: 'none',
                  borderBottom: i < pairs.length - 1 ? `1px solid ${T.border}` : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : (T.txt ?? T.sub), flex: 1 }}>
                  {p.pair}
                </span>
                {isActive && (
                  <span style={{ fontSize: 9, color: T.accent }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function IntradayExecutionCard({
  biasResult,
  sentimentData,
  riskData,
  availablePairs,   // new: array of { pair, signal, bias } from App.jsx
  darkMode,
  T,
  isMobile,
}) {
  const [expanded, setExpanded] = useState(false);

  const defaultPair = availablePairs?.[0]?.pair ?? '—';
  const [selectedPair, setSelectedPair] = useState(defaultPair);

  // Fix 1: sync selectedPair when availablePairs loads async or changes
  useEffect(() => {
    if (!availablePairs || availablePairs.length === 0) return;
    const exists = availablePairs.some(p => p.pair === selectedPair);
    if (!exists) setSelectedPair(availablePairs[0].pair);
  }, [availablePairs, selectedPair]);

  const activePair = availablePairs?.some(p => p.pair === selectedPair) ? selectedPair : defaultPair;

  // Use the selected pair's precomputed bias if available, else fall back to passed biasResult
  const pairData      = availablePairs?.find(p => p.pair === activePair);
  const activeBias    = pairData?.bias ?? biasResult;

  // Safe extraction from activeBias
  const biasScore     = activeBias?.score     ?? 0;
  const biasDirection = activeBias?.direction ?? 'neutral';

  // Safe extraction from sentimentData
  const fg        = sentimentData?.fg        ?? 50;
  const vix       = sentimentData?.vix       ?? 18;
  const highCount = sentimentData?.highCount ?? 0;
  const midCount  = sentimentData?.midCount  ?? 0;

  // Safe extraction from riskData
  const riskScore = riskData?.score ?? 0;

  // Compute execution score for the selected pair
  const result = calculateExecutionScore({
    biasScore,
    biasDirection,
    riskScore,
    fg,
    vix,
    highCount,
    midCount,
  });

  if (!result) return null;

  const { score, permission, biasAlignment, macroRisk, volatilityState, breakdown } = result;

  const gaugePct = score;
  const trackBg  = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${permission.border}`,
      borderRadius: 14,
      padding: isMobile ? '14px 14px' : '18px 20px',
      marginBottom: 12,
      boxShadow: `0 0 0 1px ${permission.color}18, 0 4px 20px rgba(0,0,0,0.12)`,
    }}>
      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: permission.color,
            boxShadow: `0 0 6px ${permission.color}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: '0.09em', whiteSpace: 'nowrap' }}>
            INTRADAY EXECUTION LAYER
          </span>
        </div>

        {/* Pair selector — top-right of header */}
        {availablePairs && availablePairs.length > 0 && (
          <PairSelector
            pairs={availablePairs}
            selected={activePair}
            onChange={setSelectedPair}
            darkMode={darkMode}
            T={T}
          />
        )}
      </div>

      {/* ── PERMISSION + SCORE ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 20, marginBottom: 16 }}>
        <div style={{
          width: isMobile ? 56 : 68, height: isMobile ? 56 : 68,
          borderRadius: '50%',
          border: `3px solid ${permission.color}`,
          background: permission.bg,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: `0 0 16px ${permission.color}35`,
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: permission.color, letterSpacing: '0.04em', lineHeight: 1 }}>EXEC</span>
          <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 800, color: permission.color, lineHeight: 1.2 }}>{permission.label}</span>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: isMobile ? 26 : 32, fontWeight: 800, color: permission.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', transition: 'color 0.3s' }}>
              {score}
            </span>
            <span style={{ fontSize: 14, color: T.sub, fontWeight: 500 }}>/100</span>
          </div>
          <div style={{ fontSize: isMobile ? 11 : 12, color: T.sub, lineHeight: 1.5 }}>
            Start looking for price action setups only when permission is{' '}
            <span style={{ color: '#22c55e', fontWeight: 700 }}>HIGH</span>
          </div>
          <div style={{ fontSize: 10, color: T.sub, marginTop: 4, letterSpacing: '0.03em' }}>
            Context for{' '}
            <span style={{ fontWeight: 700, color: T.sub }}>{activePair}</span>
          </div>
        </div>
      </div>

      {/* ── CONFIDENCE GAUGE ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: T.sub, fontWeight: 600 }}>CONFIDENCE SCORE</span>
          <span style={{ fontSize: 10, color: T.sub }}>0 — 100</span>
        </div>
        <div style={{ position: 'relative', height: 8, borderRadius: 99, background: trackBg, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${gaugePct}%`,
            background: `linear-gradient(90deg, ${permission.color}88, ${permission.color})`,
            borderRadius: 99,
            transition: 'width 0.7s ease',
          }} />
        </div>
        <div style={{ position: 'relative', marginTop: 3 }}>
          {[{ pct: 45, label: '45 Med' }, { pct: 70, label: '70 High' }].map(({ pct, label }) => (
            <div key={pct} style={{
              position: 'absolute', left: `${pct}%`,
              transform: 'translateX(-50%)',
              fontSize: 9, color: T.sub, fontWeight: 600,
              borderLeft: `1px dashed ${T.border}`,
              paddingLeft: 3, lineHeight: 1,
            }}>{label}</div>
          ))}
        </div>
      </div>

      {/* ── STAT PILLS ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, marginTop: 8 }}>
        <StatPill
          label="BIAS ALIGNMENT"
          value={biasAlignment.label}
          color={biasAlignment.color}
          bg={`${biasAlignment.color}14`}
          border={`${biasAlignment.color}35`}
          isMobile={isMobile}
        />
        <StatPill
          label="MACRO RISK"
          value={macroRisk.label}
          color={macroRisk.color}
          bg={`${macroRisk.color}14`}
          border={`${macroRisk.color}35`}
          isMobile={isMobile}
        />
        <StatPill
          label="VOLATILITY"
          value={volatilityState.label}
          color={volatilityState.color}
          bg={`${volatilityState.color}14`}
          border={`${volatilityState.color}35`}
          isMobile={isMobile}
        />
      </div>

      {/* ── BREAKDOWN TOGGLE ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'transparent',
          border: `1px solid ${expanded ? `${permission.color}60` : T.border}`,
          borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          color: T.sub, fontSize: 11, fontWeight: 600,
          transition: 'border-color 0.2s',
        }}>
        <span>{expanded ? 'Ocultar desglose' : 'Ver desglose de factores'}</span>
        <span style={{
          fontSize: 9, display: 'inline-block',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.25s ease',
        }}>▼</span>
      </button>

      {/* ── BREAKDOWN DETAIL ── */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '12px 14px',
          }}>
            <FactorBar label="HTF Bias Strength"     points={breakdown.htfBias.points}      max={breakdown.htfBias.max}      weight={breakdown.htfBias.weight}      darkMode={darkMode} T={T} />
            <FactorBar label="Macro Event Risk"       points={breakdown.macroRisk.points}    max={breakdown.macroRisk.max}    weight={breakdown.macroRisk.weight}    darkMode={darkMode} T={T} />
            <FactorBar label="Fear / Greed Index"     points={breakdown.fearGreed.points}    max={breakdown.fearGreed.max}    weight={breakdown.fearGreed.weight}    darkMode={darkMode} T={T} />
            <FactorBar label="Volatility State"       points={breakdown.volatility.points}   max={breakdown.volatility.max}   weight={breakdown.volatility.weight}   darkMode={darkMode} T={T} />
            <FactorBar label="Calendar Sentiment"     points={breakdown.calSentiment.points} max={breakdown.calSentiment.max} weight={breakdown.calSentiment.weight} darkMode={darkMode} T={T} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 10, paddingTop: 10,
              borderTop: `1px solid ${T.border}`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.txt ?? T.sub }}>CONFIDENCE SCORE</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: permission.color, fontVariantNumeric: 'tabular-nums' }}>
                {score}/100
              </span>
            </div>
          </div>
          <p style={{
            fontSize: 10, color: T.sub, marginTop: 8, lineHeight: 1.5,
            padding: '6px 10px',
            background: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            borderRadius: 6, border: `1px solid ${T.border}`,
          }}>
            ⚠️ Este módulo no genera señales de entrada. Es un filtro de contexto y permiso operativo basado en datos institucionales y macro del día.
          </p>
        </div>
      )}
    </div>
  );
}
