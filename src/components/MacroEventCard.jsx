/**
 * MacroEventCard.jsx
 *
 * Visual macro decision panel — "¿qué dice el dato más importante del día?"
 *
 * Diseño: terminal de tipos estilo TradingView adaptado al sistema COT Tracker.
 *
 * Props:
 *   event         — CalendarEvent único (ya seleccionado en App.jsx)
 *                   { event, country, impact, actual, previous, estimate, date }
 *   finalDecision — { verdict, allowExecution, isMacroBlocked, isIntradayBlocked }
 *   darkMode      — boolean
 *   T             — buildTheme(darkMode) object
 *   isMobile      — boolean (optional)
 */

import { useState } from 'react';
import { usePolymarketContext } from '../polymarket/hooks/usePolymarketContext.js';

// ─── HELPERS LOCALES (autocontenidos, no duplican App.jsx) ────────────────────

const COUNTRY_CCY = {
  US:'USD', EU:'EUR', GB:'GBP', JP:'JPY', CA:'CAD',
  AU:'AUD', NZ:'NZD', CH:'CHF', DE:'EUR', FR:'EUR',
  CN:'CNY', NL:'EUR', IT:'EUR', ES:'EUR',
};
const CCY_FLAG = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵',
  CAD:'🇨🇦', AUD:'🇦🇺', NZD:'🇳🇿', CHF:'🇨🇭',
};

function evCcy(country) {
  return COUNTRY_CCY[(country||'').toUpperCase()] || country || '—';
}
function evFlag(country) {
  return CCY_FLAG[evCcy(country)] || '🌐';
}

/** Parsea string con %, K, M, B, T a número */
function parseVal(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(
    String(v)
      .replace('%','').replace('K','e3').replace('M','e6')
      .replace('B','e9').replace('T','e12')
  );
  return isNaN(n) ? null : n;
}

/** Formatea número: si tiene decimales significativos muestra 2, si no entero */
function fmtNum(v, unit = '') {
  if (v === null || v === undefined) return '—';
  const n = parseVal(v);
  if (n === null) return String(v);
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toFixed(decimals) + unit;
}

/** Extrae la unidad del valor (%, K, M, B) */
function extractUnit(v) {
  const s = String(v || '');
  if (s.includes('%')) return '%';
  if (s.toUpperCase().includes('K')) return 'K';
  if (s.toUpperCase().includes('M')) return 'M';
  if (s.toUpperCase().includes('B')) return 'B';
  return '';
}
function detectType(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('interest rate') || n.includes('rate decision') ||
      n.includes('tipos de interés') || n.includes('base rate') ||
      n.includes('cash rate') || n.includes('overnight rate')) return 'RATE';
  if (n.includes('cpi') || n.includes('consumer price') || n.includes('inflation') ||
      n.includes('ipc') || n.includes('pce')) return 'CPI';
  if (n.includes('ppi') || n.includes('producer price')) return 'PPI';
  if (n.includes('non-farm') || n.includes('nonfarm') || n.includes('payroll') ||
      n.includes('nfp')) return 'NFP';
  if (n.includes('unemployment rate') || n.includes('tasa de desempleo')) return 'UNEMPLOYMENT';
  if (n.includes('gdp') || n.includes('gross domestic') || n.includes('pib')) return 'GDP';
  if (n.includes('pmi') || n.includes('purchasing managers') ||
      n.includes('ism ') || n.includes('manufacturing index')) return 'PMI';
  if (n.includes('retail sales') || n.includes('ventas minoristas')) return 'RETAIL';
  if (n.includes('fomc') || n.includes('meeting minutes') || n.includes('actas')) return 'MINUTES';
  if (n.includes('jobless') || n.includes('claims') || n.includes('peticiones')) return 'CLAIMS';
  if (n.includes('adp')) return 'ADP';
  if (n.includes('durable goods') || n.includes('bienes duraderos')) return 'DURABLE';
  return 'OTHER';
}

const TYPE_LABEL = {
  RATE: 'Tipos de Interés', CPI: 'Inflación', PPI: 'Precios Producción',
  NFP: 'Empleo NFP', UNEMPLOYMENT: 'Tasa Desempleo', GDP: 'PIB',
  PMI: 'PMI', RETAIL: 'Ventas Minoristas', MINUTES: 'Actas Fed',
  CLAIMS: 'Peticiones Desempleo', ADP: 'ADP Empleo', DURABLE: 'Bienes Duraderos',
  OTHER: 'Indicador Macro',
};

/**
 * Interpretación Hawkish / Dovish / Neutral / Growth / etc.
 * Regla simple: actual vs consensus, ajustada por tipo de evento.
 * Tipos "inversos" (más alto = peor): UNEMPLOYMENT, CLAIMS.
 */
function getRegime(type, actual, consensus) {
  const a = parseVal(actual);
  const c = parseVal(consensus);
  if (a === null || c === null) return null;

  const INVERSE = new Set(['UNEMPLOYMENT', 'CLAIMS']);
  const diff = INVERSE.has(type) ? c - a : a - c;   // positivo = buena sorpresa
  const pct  = c !== 0 ? Math.abs(diff / c) * 100 : 0;

  if (Math.abs(diff) < 0.001 && pct < 0.05) {
    return { label: 'NEUTRAL', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚖️',
      desc: 'Dato en línea con el consenso — impacto limitado' };
  }

  const good = diff > 0;

  switch (type) {
    case 'RATE':
      return good
        ? { label: 'HAWKISH', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴',
            desc: 'Decisión más restrictiva — presión alcista en divisa y yields' }
        : { label: 'DOVISH', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢',
            desc: 'Decisión más acomodaticia — expectativas de recortes' };

    case 'CPI': case 'PPI':
      return good
        ? { label: 'HAWKISH', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴',
            desc: 'Inflación por encima del consenso — presión para subir tipos' }
        : { label: 'DOVISH', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢',
            desc: 'Inflación por debajo del consenso — abre puerta a recortes' };

    case 'NFP': case 'ADP': case 'UNEMPLOYMENT': case 'CLAIMS':
      return good
        ? { label: 'HAWKISH', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴',
            desc: 'Mercado laboral fuerte — banco central puede mantener tipos altos' }
        : { label: 'DOVISH', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢',
            desc: 'Mercado laboral débil — presión para recortar tipos' };

    case 'GDP': case 'RETAIL': case 'DURABLE':
      return good
        ? { label: 'GROWTH', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢',
            desc: 'Fortaleza económica — respalda divisa y activos de riesgo' }
        : { label: 'RECESIÓN', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴',
            desc: 'Señal de desaceleración — puede aumentar expectativas de recortes' };

    case 'PMI': {
      const v = parseVal(actual);
      if (v !== null) {
        if (v >= 55) return { label: 'EXPANSIÓN FUERTE', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢', desc: `PMI ${v}: crecimiento sólido` };
        if (v >= 50) return { label: 'EXPANSIÓN', color: '#84cc16', bg: 'rgba(132,204,22,0.12)', icon: '🟡', desc: `PMI ${v}: sector en expansión` };
        if (v >= 45) return { label: 'CONTRACCIÓN', color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '🟠', desc: `PMI ${v}: sector en contracción` };
        return { label: 'RECESIÓN', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴', desc: `PMI ${v}: contracción severa` };
      }
      return good
        ? { label: 'GROWTH', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢', desc: 'PMI por encima del consenso' }
        : { label: 'CONTRACCIÓN', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴', desc: 'PMI por debajo del consenso' };
    }

    default:
      return good
        ? { label: 'POSITIVO', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢', desc: 'Dato mejor de lo esperado' }
        : { label: 'NEGATIVO', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴', desc: 'Dato peor de lo esperado' };
  }
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

/** Mini SVG sparkline — sin ejes, línea limpia + punto final */
function Sparkline({ values, color, blocked, height = 44 }) {
  const [tooltip, setTooltip] = useState(null);

  if (!values || values.length < 2) return null;

  const W = 260, H = height;
  const PAD = { x: 6, y: 6 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = PAD.x + (i / (values.length - 1)) * (W - PAD.x * 2);
    const y = H - PAD.y - ((v - min) / range) * (H - PAD.y * 2);
    return { x, y, v };
  });

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Area fill under line
  const areaD = `${pathD} L ${pts[pts.length-1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

  const lastPt = pts[pts.length - 1];
  const lineColor = blocked ? '#6b7280' : color;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', overflow: 'visible' }}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* Area */}
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={blocked ? 0.05 : 0.18} />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkGrad)" />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={blocked ? 0.4 : 1}
      />

      {/* Hover hit areas */}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={8}
          fill="transparent"
          style={{ cursor: 'default' }}
          onMouseEnter={() => setTooltip({ x: p.x, y: p.y, v: p.v, i })}
        />
      ))}

      {/* Last point dot */}
      <circle cx={lastPt.x} cy={lastPt.y} r={3.5} fill={lineColor} opacity={blocked ? 0.5 : 1} />
      <circle cx={lastPt.x} cy={lastPt.y} r={6} fill={lineColor} opacity={blocked ? 0.06 : 0.18} />

      {/* Tooltip */}
      {tooltip && (
        <g>
          <circle cx={tooltip.x} cy={tooltip.y} r={3.5} fill={lineColor} />
          <rect
            x={Math.min(tooltip.x - 22, W - 48)}
            y={tooltip.y - 26}
            width={44} height={17}
            rx={4} fill={blocked ? '#374151' : lineColor + 'ee'}
          />
          <text
            x={Math.min(tooltip.x - 22, W - 48) + 22}
            y={tooltip.y - 14}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={700}
            fill="#fff"
          >
            {tooltip.v.toFixed(2)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Badge de impacto (estrellas) */
function ImpactStars({ impact, color }) {
  const n = impact === 'High' ? 3 : impact === 'Medium' ? 2 : 1;
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1,2,3].map(i => (
        <span key={i} style={{ fontSize: 12, color: i <= n ? color : 'rgba(150,150,150,0.25)' }}>★</span>
      ))}
    </span>
  );
}

/** Pill de cambio vs anterior (+0.25% / -0.10) */
function DeltaPill({ actual, previous, inverted = false }) {
  const a = parseVal(actual);
  const p = parseVal(previous);
  if (a === null || p === null) return null;
  const raw = a - p;
  if (Math.abs(raw) < 0.0001) return null;
  const good = inverted ? raw < 0 : raw > 0;
  const color = good ? '#22c55e' : '#ef4444';
  const sign  = raw > 0 ? '+' : '';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      background: color + '18',
      border: `1px solid ${color}30`,
      padding: '1px 6px', borderRadius: 99,
    }}>
      {sign}{raw.toFixed(2)}
    </span>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export default function MacroEventCard({ event, finalDecision, darkMode, T, isMobile }) {
  // Polymarket macro context — must be called unconditionally (rules of hooks).
  const polyCtx = usePolymarketContext();

  // ── Null guard — si no hay evento publicado, no renderizar nada ─────────────
  if (!event) return null;

  const isMacroBlocked = finalDecision?.isMacroBlocked ?? false;

  const actualVal = event.actual ?? event.result ?? event.value;
  const estimate  = event.estimate ?? event.forecast ?? event.consensus;
  const previous  = event.previous;

  const hasActual = actualVal !== null && actualVal !== undefined &&
                    String(actualVal).trim() !== '' && String(actualVal) !== 'null';

  // Si no hay dato publicado — fallback visual con contexto pre-evento
  if (!hasActual) {
    // Derive macro context badge from Polymarket composites (if available)
    const mscVal  = polyCtx.msc?.value  ?? null;
    const rrcVal  = polyCtx.rrc?.value  ?? null;
    const rrcReg  = polyCtx.rrc?.regime ?? null;
    const gtrpVal = polyCtx.gtrp?.value ?? null;

    let macroLine = null;
    if (polyCtx.isLoaded) {
      if (typeof mscVal === 'number' && mscVal >= 65) {
        macroLine = { text: `Estrés macro elevado (MSC ${mscVal})`, color: '#ef4444' };
      } else if (rrcReg === 'HIGH_RISK' || rrcReg === 'SEVERE') {
        macroLine = { text: `Riesgo de recesión en precio (RRC ${Math.round(rrcVal ?? 0)})`, color: '#f97316' };
      } else if (typeof gtrpVal === 'number' && gtrpVal >= 0.60) {
        macroLine = { text: `Riesgo geopolítico de cola elevado`, color: '#f59e0b' };
      } else if (typeof mscVal === 'number' && mscVal >= 48) {
        macroLine = { text: `Sensibilidad macro moderada`, color: '#f59e0b' };
      }
    }

    return (
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: '20px',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>⏳</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.sub }}>
            Sin datos macro publicados disponibles
          </div>
          <div style={{ fontSize: 11, color: T.sub2, marginTop: 2 }}>
            Los datos aparecerán cuando se publiquen en el calendario económico
          </div>
          {macroLine && (
            <div style={{
              marginTop: 10,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 99,
              background: macroLine.color + '14',
              border: `1px solid ${macroLine.color}30`,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: macroLine.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: macroLine.color, letterSpacing: '0.03em' }}>
                {macroLine.text}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const type     = detectType(event.event);
  const unit     = extractUnit(actualVal ?? estimate ?? previous ?? '');
  const regime   = getRegime(type, actualVal, estimate);
  const ccy      = evCcy(event.country);
  const flag     = evFlag(event.country);
  const impColor = event.impact === 'High' ? '#ef4444' : event.impact === 'Medium' ? '#f59e0b' : '#6b7280';

  // Sparkline: extraemos previous como punto -1, estimate como punto 0, actual como punto final
  const sparkValues = [
    parseVal(previous),
    parseVal(estimate),
    parseVal(actualVal),
  ].filter(v => v !== null);

  const lineColor = isMacroBlocked ? '#6b7280' : (regime?.color ?? '#22c55e');

  const cardBorderColor = isMacroBlocked
    ? 'rgba(239,68,68,0.35)'
    : (regime?.color ?? T.border) + '60';

  const INVERSE_TYPES = new Set(['UNEMPLOYMENT', 'CLAIMS']);
  const isInverted = INVERSE_TYPES.has(type);

  const evTime = event.date
    ? new Date(event.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;
  const evDate = event.date
    ? new Date(event.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    : null;

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${cardBorderColor}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
      transition: 'border-color 0.3s',
      filter: isMacroBlocked ? 'saturate(0.55)' : 'none',
      boxShadow: isMacroBlocked
        ? 'none'
        : `0 0 0 1px ${(regime?.color ?? '#22c55e')}12, 0 4px 20px rgba(0,0,0,0.08)`,
    }}>

      {/* ── MACRO BLOCK BANNER ───────────────────────────────────────────────── */}
      {isMacroBlocked && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(239,68,68,0.10)',
          borderBottom: '1px solid rgba(239,68,68,0.25)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 13 }}>🚫</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>
            Macro Risk: Market Blocked
          </span>
          <span style={{ fontSize: 10, color: T.sub, marginLeft: 4 }}>
            — datos visibles como contexto, no para ejecución
          </span>
          <span style={{
            marginLeft: 'auto', fontSize: 9, fontWeight: 700,
            padding: '2px 7px', borderRadius: 99,
            background: 'rgba(239,68,68,0.15)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.30)', letterSpacing: '0.06em',
          }}>
            SIN CONTEXTO
          </span>
        </div>
      )}

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <div style={{
        padding: isMobile ? '12px 14px 10px' : '14px 20px 12px',
        borderBottom: `1px solid ${T.border}`,
        background: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{flag}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.06em', marginBottom: 2 }}>
              {ccy} · {TYPE_LABEL[type] || 'INDICADOR MACRO'}
            </div>
            <div style={{
              fontSize: isMobile ? 12 : 13, fontWeight: 700, color: T.txt, lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {event.event}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <ImpactStars impact={event.impact} color={impColor} />
          {evTime && (
            <span style={{ fontSize: 10, color: T.sub2, fontFamily: 'monospace' }}>
              {evDate} · {evTime}
            </span>
          )}
          <span style={{
            fontSize: 8, color: T.sub2, letterSpacing: '0.04em',
            background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${T.border}`, padding: '1px 6px', borderRadius: 99,
          }}>
            horas–días
          </span>
        </div>
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? '14px' : '16px 20px' }}>

        {/* ROW 1: ACTUAL GRANDE + REGIME BADGE */}
        <div style={{
          display: 'flex', alignItems: 'flex-end',
          justifyContent: 'space-between', marginBottom: 14, gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', marginBottom: 3 }}>
              ACTUAL
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: isMobile ? 34 : 42,
                fontWeight: 900, fontFamily: 'monospace',
                letterSpacing: '-1px', lineHeight: 1,
                color: isMacroBlocked ? T.sub : (regime?.color ?? T.txt),
                transition: 'color 0.3s',
              }}>
                {fmtNum(actualVal)}
              </span>
              {unit && <span style={{ fontSize: 16, color: T.sub, fontWeight: 600 }}>{unit}</span>}
              <DeltaPill actual={actualVal} previous={previous} inverted={isInverted} />
            </div>
          </div>

          {regime && (
            <div style={{
              padding: '8px 14px',
              background: isMacroBlocked ? 'rgba(107,114,128,0.10)' : regime.bg,
              border: `1px solid ${isMacroBlocked ? 'rgba(107,114,128,0.25)' : regime.color + '40'}`,
              borderRadius: 10, textAlign: 'center', flexShrink: 0,
            }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{regime.icon}</div>
              <div style={{
                fontSize: 11, fontWeight: 800,
                color: isMacroBlocked ? T.sub : regime.color,
                letterSpacing: '0.05em',
              }}>
                {regime.label}
              </div>
            </div>
          )}
        </div>

        {/* ROW 2: PREVIOUS + CONSENSUS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Anterior', value: previous },
            { label: 'Consenso', value: estimate },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
              border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '8px 12px',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', marginBottom: 3 }}>
                {label.toUpperCase()}
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: T.sub }}>
                {value !== null && value !== undefined && String(value).trim() !== ''
                  ? fmtNum(value) + unit : '—'}
              </span>
            </div>
          ))}
        </div>

        {/* ROW 3: INTERPRETACIÓN */}
        {regime && (
          <div style={{
            fontSize: 11, color: T.sub, lineHeight: 1.55,
            marginBottom: 14, padding: '8px 12px',
            background: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            borderRadius: 8, borderLeft: `3px solid ${isMacroBlocked ? '#6b7280' : regime.color}40`,
          }}>
            {regime.desc}
          </div>
        )}

        {/* ROW 4: SPARKLINE (previous → estimate → actual) */}
        {sparkValues.length >= 2 && (
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.06em' }}>
                ANTERIOR → CONSENSO → ACTUAL
              </span>
              <span style={{ fontSize: 9, color: T.sub2 }}>
                {Math.min(...sparkValues).toFixed(2)} — {Math.max(...sparkValues).toFixed(2)}{unit}
              </span>
            </div>
            <Sparkline values={sparkValues} color={lineColor} blocked={isMacroBlocked} height={44} />
            {isMacroBlocked && (
              <div style={{
                position: 'absolute', inset: 0,
                background: darkMode ? 'rgba(11,15,20,0.45)' : 'rgba(240,244,248,0.50)',
                borderRadius: 4, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, letterSpacing: '0.05em' }}>
                  BLOCKED
                </span>
              </div>
            )}
          </div>
        )}

        {/* FOOTER */}
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 9, color: T.sub2, fontStyle: 'italic' }}>
            Fuente: Calendario económico · datos en tiempo real
          </span>
          {regime && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: isMacroBlocked ? T.sub2 : regime.color,
              background: isMacroBlocked ? 'rgba(107,114,128,0.08)' : regime.bg,
              border: `1px solid ${isMacroBlocked ? 'rgba(107,114,128,0.20)' : regime.color + '30'}`,
              padding: '2px 7px', borderRadius: 99, letterSpacing: '0.04em',
            }}>
              {regime.icon} {regime.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
