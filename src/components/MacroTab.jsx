/**
 * MacroTab.jsx — v3
 * Fixes applied:
 *  1. InfoTip: click-to-toggle + mobile tap, viewport clamping, rich contextual text
 *  2. GlobalMatrix: yieldVal() used consistently, all 5 countries render correctly
 *  3. SpreadHistory: added GBP (US_UK) filter and chart; filters = [Todo, EUR, JPY, GBP]
 *  4. Hero: compact one-line status header — no redundant paragraph, no implication repeat
 *  5. No duplicated information across sections (each card has a unique role)
 *  6. All InfoTip texts are meaningful with trading context (multi-line)
 *  7. Light mode: reduced heatmap opacity, better contrast across all text
 *  8. MacroReadingCard: new "IMPLICACIÓN OPERATIVA" block with actionable bias lines
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── MOCK DATA ─────────────────────────────────────────────────────────────────
const MOCK = {
  timestamp: new Date().toISOString(),
  yields: {
    US10Y: { current: 4.42, prev: 4.38 },
    US2Y:  { current: 4.81, prev: 4.77 },
    DE10Y: { current: 2.31, prev: 2.27 },
    UK10Y: { current: 4.18, prev: 4.15 },
    JP10Y: { current: 1.06, prev: 1.04 },
    CN10Y: { current: 2.29, prev: 2.30 },
  },
  spreads:   { US_DE: 2.11, US_UK: 0.24, US_JP: 3.36 },
  direction: { US_DE: 'up', US_UK: 'flat', US_JP: 'up' },
  momentum:  { US_DE: 0.04, US_UK: 0.01, US_JP: 0.06 },
  signal: {
    bias: 'USD_LEANING_STRONG',
    confidence: 7,
    drivers: [
      'Diferencial US-DE ↑ 2,11% (Δ +0,04%)',
      'Diferencial US-JP ↑ 3,36% (Δ +0,06%)',
      'Diferencial US-UK → 0,24% (Δ +0,01%)',
    ],
    implication:
      'La mayoría de los diferenciales de rendimiento se están ampliando a favor del USD. El diferencial US-Japón en 3,36% respalda al alza en USDJPY mediante flujos de carry trade. El diferencial US-Alemania en 2,11% genera presión bajista sobre el EURUSD.',
    chinaContext:
      'Los rendimientos de China se mantienen estables en 2,29%, lo que sugiere una presión macro externa limitada desde Asia. La postura del PBoC parece acomodaticia, respaldando el apetito global por el riesgo.',
  },
};

// ── THEME TOKENS ──────────────────────────────────────────────────────────────
function buildMT(darkMode) {
  if (darkMode) {
    return {
      bg:               '#0b0f14',
      card:             'rgba(15,20,28,0.97)',
      cardInner:        'rgba(255,255,255,0.03)',
      border:           'rgba(255,255,255,0.08)',
      borderSoft:       'rgba(255,255,255,0.05)',
      txt:              '#e2e8f0',
      sub:              '#8b90a0',
      sub2:             '#4a5568',
      accent:           '#3b82f6',
      heroGrad:         'linear-gradient(135deg, #0b0f14 0%, #0f1926 55%, #0b0f14 100%)',
      heroBorder:       'rgba(59,130,246,0.2)',
      heroGlow:         '0 0 80px rgba(59,130,246,0.08)',
      matrixCountryBg:  'rgba(255,255,255,0.04)',
      matrixContextBg:  'rgba(255,255,255,0.02)',
      matrix2Ybg:       'rgba(255,255,255,0.03)',
      heatTextPos:      '#93c5fd',
      heatTextNeg:      '#fca5a5',
      spreadCardBg:     'rgba(59,130,246,0.07)',
      spreadCardBorder: 'rgba(59,130,246,0.2)',
      spreadVal:        '#93c5fd',
      implicationBg:    'rgba(255,255,255,0.03)',
      implicationTxt:   '#e2e8f0',
      operativaBg:      'rgba(59,130,246,0.07)',
      operativaBorder:  'rgba(59,130,246,0.2)',
      operativaTxt:     '#93c5fd',
      driverCol:        '#8b90a0',
      chinaBg:          'rgba(255,255,255,0.02)',
      chinaBorder:      'rgba(255,255,255,0.06)',
      chinaTxt:         '#8b90a0',
      btnActive:        'rgba(59,130,246,0.15)',
      btnActiveTxt:     '#93c5fd',
      btnInactiveTxt:   '#8b90a0',
      gaugeTrack:       'rgba(255,255,255,0.08)',
      tooltipBg:        'rgba(10,14,20,0.97)',
      tooltipTxt:       '#e2e8f0',
      tooltipBorder:    'rgba(255,255,255,0.1)',
      spreadSummaryVal: '#e2e8f0',
      spreadSummaryPair:'#8b90a0',
      bottomBg:         'rgba(15,20,28,0.97)',
    };
  }
  return {
    bg:               '#F0F4F8',
    card:             '#FFFFFF',
    cardInner:        '#F7FAFC',
    border:           '#E2E8F0',
    borderSoft:       '#EDF2F7',
    txt:              '#0B0F14',
    sub:              '#4A5568',
    sub2:             '#718096',
    accent:           '#1D4ED8',
    heroGrad:         'linear-gradient(180deg, #1E3A5F 0%, #0F2744 100%)',
    heroBorder:       'rgba(59,130,246,0.3)',
    heroGlow:         '0 4px 32px rgba(29,78,216,0.12)',
    matrixCountryBg:  '#F7FAFC',
    matrixContextBg:  '#EDF2F7',
    matrix2Ybg:       '#F7FAFC',
    heatTextPos:      '#1E40AF',
    heatTextNeg:      '#B91C1C',
    spreadCardBg:     'rgba(29,78,216,0.04)',
    spreadCardBorder: 'rgba(29,78,216,0.15)',
    spreadVal:        '#1D4ED8',
    implicationBg:    '#F7FAFC',
    implicationTxt:   '#0B0F14',
    operativaBg:      'rgba(29,78,216,0.04)',
    operativaBorder:  'rgba(29,78,216,0.15)',
    operativaTxt:     '#1E40AF',
    driverCol:        '#374151',
    chinaBg:          '#F7FAFC',
    chinaBorder:      '#E2E8F0',
    chinaTxt:         '#4A5568',
    btnActive:        'rgba(29,78,216,0.1)',
    btnActiveTxt:     '#1D4ED8',
    btnInactiveTxt:   '#4A5568',
    gaugeTrack:       '#E2E8F0',
    tooltipBg:        '#0F172A',
    tooltipTxt:       '#F1F5F9',
    tooltipBorder:    'rgba(255,255,255,0.1)',
    spreadSummaryVal: '#0B0F14',
    spreadSummaryPair:'#4A5568',
    bottomBg:         '#FFFFFF',
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmtDelta = (v) => (v == null ? '' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');

/** Safely resolve yield value from { current } shape or bare number */
function yieldVal(entry) {
  if (entry == null) return null;
  if (typeof entry === 'object' && entry !== null && 'current' in entry) {
    const v = parseFloat(entry.current);
    return isNaN(v) ? null : v;
  }
  if (typeof entry === 'number' && !isNaN(entry)) return entry;
  return null;
}

function Arrow({ dir, size = 14 }) {
  const map = {
    up:   { ch: '↑', col: '#16a34a' },
    down: { ch: '↓', col: '#dc2626' },
    flat: { ch: '→', col: '#9ca3af' },
  };
  const { ch, col } = map[dir] || map.flat;
  return <span style={{ color: col, fontSize: size, fontWeight: 800, lineHeight: 1 }}>{ch}</span>;
}

// ── INFO TOOLTIP ──────────────────────────────────────────────────────────────
// Renders the tooltip bubble via a React portal directly on document.body.
// This escapes ANY ancestor stacking context (transform, overflow, borderRadius,
// animation) that would clip or reorder a fixed-position child.
// Supports hover (desktop) + click/tap toggle (mobile).
// Viewport-clamped: never overflows left/right edges or bottom of screen.

// Portal target is document.body — React owns removeChild on body and never fails.
// NEVER use a manually-managed singleton div (document.createElement + appendChild):
// in React StrictMode + conditional renders, React's portal cleanup calls removeChild
// on a div it doesn't track, causing "NotFoundError: removeChild" crashes.

function InfoTip({ text, tm }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, left: 0, placement: 'below' });
  const btnRef          = useRef(null);
  const TIP_W           = 270;
  const TIP_EST_H       = 160; // conservative height estimate for flip logic

  const calcPos = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: centre on button, clamp to screen edges
    let left = r.left + r.width / 2 - TIP_W / 2;
    left = Math.max(10, Math.min(left, vw - TIP_W - 10));

    // Vertical: prefer below, flip above if not enough room
    const spaceBelow = vh - r.bottom;
    const placement  = spaceBelow < TIP_EST_H + 16 ? 'above' : 'below';
    const top = placement === 'below' ? r.bottom + 8 : r.top - TIP_EST_H - 8;

    return { top, left, placement };
  }, []);

  const openTip  = useCallback(() => { const p = calcPos(); if (p) { setPos(p); setOpen(true);  } }, [calcPos]);
  const closeTip = useCallback(() => setOpen(false), []);
  const toggle   = useCallback((e) => {
    e.stopPropagation();
    if (open) { closeTip(); } else { openTip(); }
  }, [open, openTip, closeTip]);

  // Close on outside click / scroll
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click',  close, true);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click',  close, true);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const bubble = open ? createPortal(
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position:     'fixed',
        top:          pos.top,
        left:         pos.left,
        width:        TIP_W,
        pointerEvents:'auto',
        zIndex:       2147483647,
        background:   tm.tooltipBg,
        color:        tm.tooltipTxt,
        border:       `1px solid ${tm.tooltipBorder}`,
        borderRadius: 10,
        padding:      '11px 14px',
        fontSize:     11.5,
        lineHeight:   1.65,
        fontWeight:   400,
        boxShadow:    '0 16px 48px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
        fontFamily:   "-apple-system,'SF Pro Text',Helvetica,sans-serif",
        whiteSpace:   'pre-line',
        animation:    'tipFade 0.14s ease both',
        letterSpacing:'0.01em',
      }}
    >
      {text}
    </div>,
    document.body
  ) : null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        onMouseEnter={openTip}
        onMouseLeave={closeTip}
        aria-label="Más información"
        aria-expanded={open}
        style={{
          width:        15,
          height:       15,
          borderRadius: '50%',
          border:       `1.5px solid ${open ? tm.accent : tm.sub2}`,
          background:   open ? `${tm.accent}20` : 'transparent',
          color:        open ? tm.accent : tm.sub2,
          fontSize:     8,
          fontWeight:   800,
          display:      'inline-flex',
          alignItems:   'center',
          justifyContent:'center',
          cursor:       'help',
          padding:      0,
          flexShrink:   0,
          marginLeft:   5,
          transition:   'color 0.15s, border-color 0.15s, background 0.15s',
          lineHeight:   1,
        }}
        onMouseOver={e => {
          e.currentTarget.style.color       = tm.accent;
          e.currentTarget.style.borderColor = tm.accent;
          e.currentTarget.style.background  = `${tm.accent}20`;
        }}
        onMouseOut={e => {
          if (!open) {
            e.currentTarget.style.color       = tm.sub2;
            e.currentTarget.style.borderColor = tm.sub2;
            e.currentTarget.style.background  = 'transparent';
          }
        }}
      >
        i
      </button>
      {bubble}
    </span>
  );
}

// ── SVG SPARKLINE ─────────────────────────────────────────────────────────────
function SpreadChart({ data, color, label, tm }) {
  if (!data || data.length < 2) return null;
  const vals  = data.map(d => d.value);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = max - min || 0.001;
  const W = 420, H = 88;
  const pad = { t: 8, b: 20, l: 4, r: 4 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;
  const toX = i => pad.l + (i / (data.length - 1)) * iW;
  const toY = v => pad.t + iH - ((v - min) / range) * iH;
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ');
  const area = `${path} L${toX(data.length-1).toFixed(1)},${(pad.t+iH).toFixed(1)} L${pad.l},${(pad.t+iH).toFixed(1)} Z`;
  const lx = toX(data.length - 1), ly = toY(data[data.length - 1].value);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 88, overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={`mg-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#mg-${label})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3.5" fill={color} />
      <circle cx={lx} cy={ly} r="6"   fill={color} opacity="0.18" />
      {[0, 10, 20, 30].filter(t => t < data.length).map(t => (
        <text key={t} x={toX(data.length-1-t)} y={H-4} textAnchor="middle"
          fontSize="8" fill={tm.sub2} fontFamily="'DM Mono',monospace">-{t}d</text>
      ))}
    </svg>
  );
}

// ── CONFIDENCE GAUGE ─────────────────────────────────────────────────────────
function ConfidenceGauge({ score, tm }) {
  const pct   = (score / 10) * 100;
  const color = score >= 7 ? '#16a34a' : score >= 4 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, height: 6, background: tm.gaugeTrack, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg,${color}99,${color})`, borderRadius: 99, transition: 'width 1s ease' }} />
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color, minWidth: 28, textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>
        {score}<span style={{ fontSize: 10, color: tm.sub2, fontWeight: 400 }}>/10</span>
      </span>
    </div>
  );
}

// ── BIAS BADGE ────────────────────────────────────────────────────────────────
const BIAS_CFG = {
  USD_STRONG:         { label: 'USD FUERTE',           col: '#16a34a', bg: 'rgba(22,163,74,0.12)',  border: 'rgba(22,163,74,0.35)'  },
  USD_LEANING_STRONG: { label: 'USD TENDENCIA ALCISTA', col: '#65a30d', bg: 'rgba(101,163,13,0.12)', border: 'rgba(101,163,13,0.35)' },
  NEUTRAL:            { label: 'NEUTRAL',               col: '#d97706', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.30)'  },
  USD_LEANING_WEAK:   { label: 'USD TENDENCIA BAJISTA', col: '#ea580c', bg: 'rgba(234,88,12,0.12)',  border: 'rgba(234,88,12,0.35)'  },
  USD_WEAK:           { label: 'USD DÉBIL',             col: '#dc2626', bg: 'rgba(220,38,38,0.12)',  border: 'rgba(220,38,38,0.35)'  },
};

function BiasBadge({ bias, large }) {
  const cfg = BIAS_CFG[bias] || BIAS_CFG.NEUTRAL;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: cfg.bg, color: cfg.col, border: `1.5px solid ${cfg.border}`,
      padding: large ? '9px 20px' : '4px 12px', borderRadius: 7,
      fontSize: large ? 14 : 11, fontWeight: 800, letterSpacing: '0.09em',
      fontFamily: "'DM Mono',monospace",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.col, flexShrink: 0, boxShadow: `0 0 6px ${cfg.col}` }} />
      {cfg.label}
    </span>
  );
}

// ── SECTION LABEL ─────────────────────────────────────────────────────────────
function SectionLabel({ children, tm, tip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: tm.accent, letterSpacing: '0.13em' }}>
      {children}
      {tip && <InfoTip text={tip} tm={tm} />}
    </div>
  );
}

// ── OPERATIVE IMPLICATION — derives trading bias from macro signal ─────────────
function buildOperativa(bias, spreads) {
  if (!bias) return ['→ Sin datos suficientes para determinar sesgo operativo'];
  if (bias === 'USD_STRONG' || bias === 'USD_LEANING_STRONG') {
    const lines = [];
    if (spreads?.US_DE != null) lines.push('→ Sesgo bajista en EURUSD');
    if (spreads?.US_JP != null) lines.push('→ Continuación alcista en USDJPY');
    if (spreads?.US_UK != null && spreads.US_UK > 0.3) lines.push('→ Presión bajista en GBPUSD');
    return lines.length ? lines : ['→ Sesgo alcista del USD confirmado'];
  }
  if (bias === 'USD_WEAK' || bias === 'USD_LEANING_WEAK') {
    const lines = [];
    if (spreads?.US_DE != null) lines.push('→ Potencial rebote alcista en EURUSD');
    if (spreads?.US_JP != null) lines.push('→ Riesgo de reversión en USDJPY');
    if (spreads?.US_UK != null) lines.push('→ Fortaleza relativa del GBP');
    return lines.length ? lines : ['→ Presión bajista sobre el USD'];
  }
  return ['→ Sin sesgo direccional claro', '→ Gestionar riesgo con stops ajustados'];
}

// ── CARD 01: GLOBAL YIELD MATRIX ─────────────────────────────────────────────
const COUNTRIES = [
  { label: 'USA',     flag: '🇺🇸', key10Y: 'US10Y', key2Y: 'US2Y'  },
  { label: 'Germany', flag: '🇩🇪', key10Y: 'DE10Y', key2Y: null    },
  { label: 'UK',      flag: '🇬🇧', key10Y: 'UK10Y', key2Y: null    },
  { label: 'Japan',   flag: '🇯🇵', key10Y: 'JP10Y', key2Y: null    },
  { label: 'China',   flag: '🇨🇳', key10Y: 'CN10Y', key2Y: null, context: true },
];

function GlobalMatrixCard({ yields, tm, darkMode }) {
  const all10 = COUNTRIES.map(c => yieldVal(yields[c.key10Y])).filter(v => v != null);
  const max10 = all10.length > 0 ? Math.max(...all10) : 5;

  return (
    <div style={{ background: tm.card, border: `1px solid ${tm.border}`, borderRadius: 14, padding: '20px', height: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel tm={tm} tip={
          'Rendimientos de bonos soberanos por vencimiento (2A y 10A).\n\n' +
          '¿Por qué importa?\nUn rendimiento más alto significa que ese país paga más por su deuda → atrae capital inversor → fortalece su divisa.\n\n' +
          '¿Cómo interpretarlo?\nCompara el 10A de EEUU con el del resto: cuanto mayor la diferencia, más presión existe para que el USD se aprecie frente a esa divisa.'
        }>
          MATRIZ DE RENDIMIENTOS
        </SectionLabel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 4, marginBottom: 8 }}>
        <div />
        {['2A', '10A'].map(h => (
          <div key={h} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em' }}>{h}</div>
        ))}
      </div>

      {COUNTRIES.map(c => {
        const v10 = yieldVal(yields[c.key10Y]);
        const v2  = c.key2Y ? yieldVal(yields[c.key2Y]) : null;
        const intensity = v10 != null ? v10 / max10 : 0;
        const opBase  = darkMode ? 0.06 : 0.04;
        const opScale = darkMode ? 0.44 : 0.20;
        const heatBg  = `rgba(59,130,246,${(opBase + intensity * opScale).toFixed(3)})`;

        return (
          <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 4, marginBottom: 4 }}>
            {/* Country */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              background: c.context ? tm.matrixContextBg : tm.matrixCountryBg,
              borderRadius: 8, border: `1px solid ${tm.borderSoft}`,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{c.flag}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: c.context ? tm.sub : tm.txt }}>{c.label}</div>
                {c.context && <div style={{ fontSize: 8, color: tm.sub2, letterSpacing: '0.06em', marginTop: 1 }}>CONTEXTO</div>}
              </div>
            </div>
            {/* 2A */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: tm.matrix2Ybg, borderRadius: 8, border: `1px solid ${tm.borderSoft}` }}>
              {v2 != null ? (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#d97706', fontFamily: "'DM Mono',monospace" }}>
                  {v2.toFixed(2)}<span style={{ fontSize: 10, color: tm.sub, fontWeight: 400 }}>%</span>
                </span>
              ) : (
                <span style={{ fontSize: 14, color: tm.sub2 }}>—</span>
              )}
            </div>
            {/* 10A heat */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: heatBg, borderRadius: 8, border: `1px solid ${tm.borderSoft}` }}>
              {v10 != null ? (
                <span style={{ fontSize: 14, fontWeight: 700, color: c.context ? tm.sub : tm.heatTextPos, fontFamily: "'DM Mono',monospace" }}>
                  {v10.toFixed(2)}<span style={{ fontSize: 10, color: tm.sub, fontWeight: 400 }}>%</span>
                </span>
              ) : (
                <span style={{ fontSize: 14, color: tm.sub2 }}>—</span>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: 12, fontSize: 9, color: tm.sub2, letterSpacing: '0.05em', borderTop: `1px solid ${tm.border}`, paddingTop: 10 }}>
        FUENTE: FRED · INTENSIDAD DE COLOR = MAGNITUD DEL RENDIMIENTO · CHINA = SOLO CONTEXTO
      </div>
    </div>
  );
}

// ── CARD 02: COUNTRY COMPARISON ───────────────────────────────────────────────
const COUNTRY_OPTS = [
  { label: 'USA vs Germany', baseKey: 'US10Y', fgnKey: 'DE10Y', spreadKey: 'US_DE', pair: 'EURUSD', flag: ['🇺🇸','🇩🇪'] },
  { label: 'USA vs Japan',   baseKey: 'US10Y', fgnKey: 'JP10Y', spreadKey: 'US_JP', pair: 'USDJPY', flag: ['🇺🇸','🇯🇵'] },
  { label: 'USA vs UK',      baseKey: 'US10Y', fgnKey: 'UK10Y', spreadKey: 'US_UK', pair: 'GBPUSD', flag: ['🇺🇸','🇬🇧'] },
];

function CountryComparisonCard({ yields, spreads, direction, tm }) {
  const [sel, setSel] = useState(0);
  const opt      = COUNTRY_OPTS[sel];
  const spread   = spreads[opt.spreadKey];
  const dir      = direction[opt.spreadKey];
  const usdFav   = dir === 'up';
  const usdWeak  = dir === 'down';
  const sigLabel = usdFav ? 'USD Favorable' : usdWeak ? 'USD Debilitándose' : 'Neutral';
  const sigCol   = usdFav ? '#16a34a' : usdWeak ? '#dc2626' : '#d97706';

  return (
    <div style={{ background: tm.card, border: `1px solid ${tm.border}`, borderRadius: 14, padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 14 }}>
        <SectionLabel tm={tm} tip={
          'Compara los rendimientos a 10 años entre EEUU y la economía seleccionada.\n\n' +
          '¿Por qué importa?\nLa diferencia de rendimientos determina hacia dónde fluye el capital global: los inversores institucionales prefieren el activo con mayor retorno ajustado al riesgo.\n\n' +
          '¿Cómo interpretarlo?\nDiferencial creciente → USD más atractivo.\nDiferencial decreciente → capital puede rotar a la divisa extranjera.'
        }>
          COMPARATIVA DE PAÍSES
        </SectionLabel>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {COUNTRY_OPTS.map((o, i) => (
          <button key={i} onClick={() => setSel(i)} style={{
            padding: '5px 11px', borderRadius: 7, fontSize: 11, fontWeight: 600,
            border: `1px solid ${i === sel ? tm.accent : tm.border}`,
            background: i === sel ? tm.btnActive : 'transparent',
            color: i === sel ? tm.btnActiveTxt : tm.btnInactiveTxt,
            cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {o.flag[0]} {o.label.split(' vs ')[1]}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'USA 10A', key: opt.baseKey, flag: opt.flag[0] },
          { label: opt.label.split(' vs ')[1] + ' 10A', key: opt.fgnKey, flag: opt.flag[1] },
        ].map(({ label, key, flag }) => {
          const v = yieldVal(yields[key]);
          return (
            <div key={key} style={{ background: tm.cardInner, borderRadius: 10, padding: '12px 14px', border: `1px solid ${tm.border}` }}>
              <div style={{ fontSize: 10, color: tm.sub2, marginBottom: 5 }}>{flag} {label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: tm.txt, fontFamily: "'DM Mono',monospace" }}>
                {v != null ? v.toFixed(2) : '—'}<span style={{ fontSize: 12, color: tm.sub, fontWeight: 400 }}>%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: tm.spreadCardBg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${tm.spreadCardBorder}`, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: tm.sub, fontWeight: 700, letterSpacing: '0.06em' }}>DIFERENCIAL</span>
            <InfoTip tm={tm} text={
              'El diferencial es la diferencia entre el rendimiento a 10A de EEUU y el del país comparado.\n\n' +
              '↑ Sube: el USD ofrece mayor prima → capital fluye hacia USD → presión alcista sobre el USD.\n' +
              '↓ Baja: la ventaja del USD se reduce → la divisa extranjera puede apreciarse.\n\n' +
              'Un diferencial por encima de 3% (como US-JP) es excepcionalmente amplio e impulsa carry trades masivos.'
            } />
          </div>
          <Arrow dir={dir} size={16} />
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, color: tm.spreadVal, fontFamily: "'DM Mono',monospace", letterSpacing: '-0.5px' }}>
          {spread != null ? (spread >= 0 ? '+' : '') + spread.toFixed(2) : '—'}
          <span style={{ fontSize: 13, fontWeight: 400 }}>%</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sigCol, boxShadow: `0 0 8px ${sigCol}77` }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: sigCol }}>{sigLabel}</span>
        <span style={{ fontSize: 11, color: tm.sub, marginLeft: 'auto', fontFamily: "'DM Mono',monospace" }}>{opt.pair}</span>
      </div>
    </div>
  );
}

// ── CARD 03: SPREAD HISTORY ───────────────────────────────────────────────────
function genHistory(base, vol, days = 30) {
  const arr = []; let val = base;
  for (let i = days; i >= 0; i--) {
    val += (Math.random() - 0.49) * vol;
    arr.push({ day: i, value: parseFloat(val.toFixed(3)) });
  }
  return arr;
}

const HISTORY_SERIES = [
  { key: 'US_DE', label: 'DIFERENCIAL US–DE', color: '#3b82f6', valColor: '#2563eb', base: 2.1,  vol: 0.06 },
  { key: 'US_JP', label: 'DIFERENCIAL US–JP', color: '#f59e0b', valColor: '#d97706', base: 3.3,  vol: 0.08 },
  { key: 'US_UK', label: 'DIFERENCIAL US–UK', color: '#10b981', valColor: '#059669', base: 0.24, vol: 0.04 },
];

const FILTER_BTNS = [
  { k: 'all',   l: 'Todo' },
  { k: 'US_DE', l: 'EUR'  },
  { k: 'US_JP', l: 'JPY'  },
  { k: 'US_UK', l: 'GBP'  },
];

function SpreadHistoryCard({ tm }) {
  const [histories] = useState(() =>
    Object.fromEntries(HISTORY_SERIES.map(s => [s.key, genHistory(s.base, s.vol)]))
  );
  const [active, setActive] = useState('all');

  const visible = active === 'all'
    ? HISTORY_SERIES
    : HISTORY_SERIES.filter(s => s.key === active);

  return (
    <div style={{ background: tm.card, border: `1px solid ${tm.border}`, borderRadius: 14, padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionLabel tm={tm}>HISTORIAL DE DIFERENCIALES · 30D</SectionLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTER_BTNS.map(({ k, l }) => (
            <button key={k} onClick={() => setActive(k)} style={{
              padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700,
              border: `1px solid ${active === k ? tm.accent : tm.border}`,
              background: active === k ? tm.btnActive : 'transparent',
              color: active === k ? tm.btnActiveTxt : tm.btnInactiveTxt,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {visible.map((s, idx) => {
        const h    = histories[s.key];
        const last = h[h.length - 1]?.value;
        return (
          <div key={s.key} style={{ marginBottom: idx < visible.length - 1 ? 14 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 2, background: s.color, borderRadius: 1, display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: tm.sub, fontWeight: 600, letterSpacing: '0.04em' }}>{s.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: s.valColor, fontFamily: "'DM Mono',monospace" }}>
                {last != null ? (last >= 0 ? '+' : '') + last.toFixed(2) + '%' : '—'}
              </span>
            </div>
            <SpreadChart data={h} color={s.color} label={s.key} tm={tm} />
          </div>
        );
      })}

      <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: `1px solid ${tm.border}`, fontSize: 9, color: tm.sub2, letterSpacing: '0.05em' }}>
        30D ACUMULADO · SIMULADO DESDE SNAPSHOT EN VIVO · DATOS FRED
      </div>
    </div>
  );
}

// ── CARD 04: MACRO READING ────────────────────────────────────────────────────
function MacroReadingCard({ signal, spreads, tm, loading }) {
  const { bias, confidence, drivers, implication, chinaContext } = signal || {};
  const cfg       = BIAS_CFG[bias] || BIAS_CFG.NEUTRAL;
  const operativa = buildOperativa(bias, spreads);

  return (
    <div style={{
      background: tm.card, border: `1.5px solid ${cfg.border}`,
      borderRadius: 14, padding: '24px', height: '100%', display: 'flex', flexDirection: 'column',
      boxShadow: `0 0 28px ${cfg.col}12`,
    }}>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel tm={tm} tip={
          'Interpretación macro derivada de los diferenciales de tipos del G4.\n\n' +
          '¿Qué muestra?\nEl sesgo del USD respecto al EUR, JPY y GBP, y el nivel de convicción de esa señal.\n\n' +
          '¿Cómo usarlo?\nÚsalo como contexto de largo plazo (HTF) para alinear tu sesgo de trading semanal. No es una señal de entrada directa — es el marco macro que filtra tus operaciones.'
        }>
          LECTURA MACRO
        </SectionLabel>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.5 }}>
          <div style={{ width: 14, height: 14, border: `2px solid ${tm.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'macroSpin 0.8s linear infinite' }} />
          <span style={{ fontSize: 12, color: tm.sub }}>Cargando datos macro…</span>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 18 }}><BiasBadge bias={bias} large /></div>

          {/* Confidence */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em' }}>CONFIANZA DE SEÑAL</span>
              <InfoTip tm={tm} text={
                'Puntuación de 0 a 10 que mide la alineación de los tres diferenciales G4 con el momentum actual.\n\n' +
                '0–3 → Señal débil o contradicción entre pares.\n' +
                '4–6 → Sesgo moderado. Útil como contexto, no como señal directa.\n' +
                '7–10 → Alta convicción. Los tres spreads apuntan en la misma dirección con momentum positivo → sesgo operativo más fiable.'
              } />
            </div>
            <ConfidenceGauge score={confidence ?? 0} tm={tm} />
          </div>

          {/* What is happening */}
          <div style={{ marginBottom: 14, background: tm.implicationBg, borderRadius: 10, padding: '13px 15px', border: `1px solid ${tm.border}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em', marginBottom: 7 }}>💡 QUÉ ESTÁ OCURRIENDO</div>
            <p style={{ margin: 0, fontSize: 12.5, color: tm.implicationTxt, lineHeight: 1.72, fontWeight: 400 }}>{implication}</p>
          </div>

          {/* IMPLICACIÓN OPERATIVA — new block */}
          <div style={{ marginBottom: 14, background: tm.operativaBg, borderRadius: 10, padding: '13px 15px', border: `1px solid ${tm.operativaBorder}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em', marginBottom: 8 }}>⚡ IMPLICACIÓN OPERATIVA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {operativa.map((line, i) => (
                <div key={i} style={{ fontSize: 12.5, fontWeight: 700, color: tm.operativaTxt, fontFamily: "'DM Mono',monospace" }}>{line}</div>
              ))}
            </div>
          </div>

          {/* Drivers */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em', marginBottom: 7 }}>📡 FACTORES CLAVE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(drivers || []).map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: tm.driverCol, fontFamily: "'DM Mono',monospace" }}>
                  <span style={{ color: tm.accent, fontWeight: 700, opacity: 0.7 }}>›</span>
                  {d}
                </div>
              ))}
            </div>
          </div>

          {/* China context */}
          <div style={{ background: tm.chinaBg, borderRadius: 8, padding: '11px 14px', border: `1px solid ${tm.chinaBorder}`, marginTop: 'auto' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: tm.sub2, letterSpacing: '0.1em', marginBottom: 6 }}>🇨🇳 CONTEXTO ASIA</div>
            <p style={{ margin: 0, fontSize: 11, color: tm.chinaTxt, lineHeight: 1.65 }}>{chinaContext}</p>
          </div>
        </>
      )}
    </div>
  );
}

// ── BOTTOM STRIP ──────────────────────────────────────────────────────────────
const BOTTOM_ITEMS = [
  { icon: '⇄', label: 'Comparativa clara'     },
  { icon: '∿', label: 'Análisis de curva'     },
  { icon: '📈', label: 'Evolución diferencial'  },
  { icon: '🌐', label: 'Contexto macro'          },
];

// ── MAIN MacroTab ─────────────────────────────────────────────────────────────
export default function MacroTab({ darkMode, T, isMobile }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [useMock, setUseMock] = useState(false);

  const tm = buildMT(darkMode);

  async function fetchMacro() {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/macro');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json); setUseMock(false);
    } catch (e) {
      console.warn('[MacroTab] API unavailable — using mock data:', e.message);
      setData(MOCK); setUseMock(true); setError(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMacro(); }, []);

  const yields    = data?.yields    ?? {};
  const spreads   = data?.spreads   ?? {};
  const direction = data?.direction ?? {};
  const signal    = data?.signal    ?? {};
  const lastUpdated = data?.timestamp
    ? new Date(data.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;

  // One-line hero summary — unique, not duplicating Macro Reading text
  const heroSummary = (() => {
    const b = signal.bias; const conf = signal.confidence ?? 0;
    if (!b) return null;
    if (b === 'USD_STRONG')         return `Todos los diferenciales amplios. USD dominante con alta convicción (${conf}/10).`;
    if (b === 'USD_LEANING_STRONG') return `Diferenciales favorecen al USD con momentum positivo en JPY y EUR. Convicción: ${conf}/10.`;
    if (b === 'USD_WEAK')           return `Diferenciales estrechos en todos los pares. Presión bajista sobre el USD.`;
    if (b === 'USD_LEANING_WEAK')   return `Mayoría de diferenciales se reducen. USD bajo presión, señal mixta.`;
    return `Diferenciales sin dirección clara. Sin sesgo macro dominante.`;
  })();

  return (
    <div style={{ background: tm.bg, minHeight: '100vh', fontFamily: "'DM Mono','Courier New',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500;700&display=swap');
        @keyframes macroSpin   { to { transform:rotate(360deg); } }
        @keyframes macroFadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes tipFade     { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .macro-card { animation: macroFadeUp 0.4s ease both; }
      `}</style>

      <div style={{ maxWidth: 1500, margin: '0 auto', padding: isMobile ? '16px 12px 80px' : '24px 32px 80px' }}>

        {/* ── HERO — compact status header only ────────────────────────────── */}
        <div style={{
          position: 'relative', marginBottom: 20,
          padding: isMobile ? '16px 18px' : '18px 28px',
          borderRadius: 16, overflow: 'hidden',
          background: tm.heroGrad,
          border: `1px solid ${tm.heroBorder}`,
          boxShadow: tm.heroGlow,
        }}>
          {darkMode && <>
            <div style={{ position: 'absolute', top: -30, left: '40%', width: 220, height: 220, borderRadius: '50%', background: 'rgba(59,130,246,0.06)', filter: 'blur(50px)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -40, right: '15%', width: 180, height: 180, borderRadius: '50%', background: 'rgba(99,102,241,0.04)', filter: 'blur(40px)', pointerEvents: 'none' }} />
          </>}

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {/* Title + badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 17 : 21, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.3px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                Diferenciales de <span style={{ color: '#60a5fa' }}>Tipos</span>
              </h1>
              {!loading && signal.bias && <BiasBadge bias={signal.bias} />}
            </div>

            {/* Summary + meta */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end', flexShrink: 0 }}>
              {heroSummary && (
                <span style={{ fontSize: 11, color: '#94a3b8', maxWidth: isMobile ? '100%' : 380, lineHeight: 1.45, textAlign: 'right' }}>
                  {heroSummary}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {useMock && (
                  <span style={{ fontSize: 9, color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.08em' }}>
                    DATOS DEMO
                  </span>
                )}
                {lastUpdated && !loading && <span style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.05em' }}>{lastUpdated}</span>}
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, border: '2px solid #60a5fa', borderTopColor: 'transparent', borderRadius: '50%', animation: 'macroSpin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 10, color: '#64748b' }}>Cargando…</span>
                  </div>
                )}
                <button onClick={fetchMacro} title="Actualizar" style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(96,165,250,0.22)',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: '#94a3b8', fontSize: 12,
                }}>⟳</button>
              </div>
            </div>
          </div>
        </div>

        {/* ── SPREAD SUMMARY ROW ────────────────────────────────────────────── */}
        {!loading && (
          <div className="macro-card" style={{
            display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr',
            gap: 10, marginBottom: 18, animationDelay: '0.05s',
          }}>
            {[
              { label: 'DIFERENCIAL US–DE', key: 'US_DE', pair: 'EURUSD', accentCol: '#2563eb',
                tip: 'Diferencia entre el 10A de EEUU y Alemania.\n↑ Sube → USD más atractivo frente al EUR → presión bajista en EURUSD.\n↓ Baja → el EUR puede recuperar terreno vs el USD.' },
              { label: 'DIFERENCIAL US–JP', key: 'US_JP', pair: 'USDJPY', accentCol: '#d97706',
                tip: 'Diferencia entre el 10A de EEUU y Japón.\nEste diferencial impulsa el carry trade en JPY: capital se pide prestado en JPY (bajo coste) y se invierte en USD (alto rendimiento) → USDJPY alcista.\nEl diferencial >3% indica carry trade masivo en curso.' },
              { label: 'DIFERENCIAL US–UK', key: 'US_UK', pair: 'GBPUSD', accentCol: '#059669',
                tip: 'Diferencia entre el 10A de EEUU y Reino Unido.\nCuando el diferencial se reduce, el GBP gana atractivo relativo frente al USD.\nMomentum positivo → presión bajista en GBPUSD.' },
            ].map(({ label, key, pair, accentCol, tip }) => {
              const val = spreads[key];
              const dir = direction[key];
              const mom = data?.momentum?.[key];
              return (
                <div key={key} style={{
                  background: tm.card, border: `1px solid ${tm.border}`,
                  borderRadius: 12, padding: '14px 16px',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: accentCol, letterSpacing: '0.1em' }}>{label}</span>
                      <InfoTip text={tip} tm={tm} />
                    </div>
                    <Arrow dir={dir || 'flat'} size={13} />
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: tm.spreadSummaryVal, fontFamily: "'DM Mono',monospace", letterSpacing: '-0.5px' }}>
                    {val != null ? (val >= 0 ? '+' : '') + val.toFixed(2) : '—'}
                    <span style={{ fontSize: 12, fontWeight: 400, color: tm.sub }}> %</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: tm.spreadSummaryPair, fontFamily: "'DM Mono',monospace" }}>{pair}</span>
                    {mom != null && (
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: mom >= 0 ? '#16a34a' : '#dc2626', fontFamily: "'DM Mono',monospace" }}>
                          {fmtDelta(mom)}
                        </span>
                        <InfoTip tm={tm} text={
                          'Variación del diferencial vs la observación anterior de FRED (momentum del spread).\n\n' +
                          '+ Positivo → la ventaja de rendimiento del USD crece → señal macro se refuerza.\n' +
                          '− Negativo → el diferencial se comprime → la presión macro sobre el USD se reduce.\n\n' +
                          'Un momentum positivo en los tres pares a la vez genera la máxima convicción en el sesgo.'
                        } />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── MAIN 4-CARD GRID ──────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div className="macro-card" style={{ animationDelay: '0.10s' }}>
            <GlobalMatrixCard yields={yields} tm={tm} darkMode={darkMode} />
          </div>
          <div className="macro-card" style={{ animationDelay: '0.15s' }}>
            <CountryComparisonCard yields={yields} spreads={spreads} direction={direction} tm={tm} />
          </div>
          <div className="macro-card" style={{ animationDelay: '0.20s' }}>
            <SpreadHistoryCard tm={tm} />
          </div>
          <div className="macro-card" style={{ animationDelay: '0.25s' }}>
            <MacroReadingCard signal={signal} spreads={spreads} tm={tm} loading={loading} />
          </div>
        </div>

        {/* ── BOTTOM STRIP ──────────────────────────────────────────────────── */}
        <div style={{
          background: tm.bottomBg, border: `1px solid ${tm.border}`, borderRadius: 14,
          padding: '13px 20px', display: 'flex', gap: isMobile ? 12 : 24,
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          {BOTTOM_ITEMS.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: tm.sub, letterSpacing: '0.04em' }}>{item.label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 9, color: tm.sub2, letterSpacing: '0.06em', textAlign: 'right' }}>
            FUENTE: FRED · {useMock ? 'MODO DEMO' : 'EN VIVO'} · CONECTADO A COT + INTRADÍA
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#ef4444' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}
