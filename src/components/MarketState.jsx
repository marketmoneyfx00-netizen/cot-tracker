/**
 * MarketState.jsx — v2
 */
import { useMemo } from 'react';
import { calculateBiasScore, deriveInputsFromPair } from '../cotBiasEngine.js';

function detectState(results) {
  if (!results.length) return null;

  const pairs = results.filter(r => !r.pair.includes('Index'));
  const rows  = pairs.map(r => {
    const av = Math.abs(r.weeklyDelta);
    const ab = Math.abs(r.score);
    const pL = r.pctL;
    let s = 'compression';
    if ((pL > 75 || pL < 25) && av > 15000 && r.weeklyDelta * r.score < 0) s = 'distribution';
    else if (ab >= 2 && av > 10000) s = 'expansion';
    else if (ab >= 1.5 || av >= 3000) s = 'building';
    return { ...r, s };
  });

  const tot = rows.length || 1;
  const ex  = rows.filter(r => r.s === 'expansion');
  const di  = rows.filter(r => r.s === 'distribution');
  const co  = rows.filter(r => r.s === 'compression');

  // Global direction from strongest expansion or building pairs
  const active = rows.filter(r => r.s === 'expansion' || r.s === 'building');
  const longs  = active.filter(r => r.score > 0).length;
  const shorts = active.filter(r => r.score < 0).length;
  const globalDirection = longs > shorts ? 'alcista' : shorts > longs ? 'bajista' : null;
  const dirLabel = globalDirection || 'mixto';

  // Distribution dominant
  if (di.length >= 2 || (di.length >= 1 && tot <= 3)) {
    const pp = di.slice(0, 2).map(r => r.pair);
    return {
      state: 'distribution', icon: '⚠️', color: '#f59e0b',
      bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.22)',
      title: `Reducción de posiciones institucionales`,
      message: `Los institucionales están disminuyendo exposición en ${pp.join(', ')}. No es necesariamente un cambio de tendencia, pero sí menor convicción.`,
      action: 'No añadir posiciones — reducir tamaño si estás dentro',
      footer: 'Basado en flujo institucional semanal (CFTC)',
    };
  }

  // Expansion dominant
  if (ex.length > tot / 2) {
    const pp = ex.slice(0, 2).map(r => r.pair);
    return {
      state: 'expansion', icon: '🔥', color: '#22c55e',
      bg: 'rgba(34,197,94,0.07)', border: 'rgba(34,197,94,0.22)',
      title: `Flujo institucional en fase de expansión — dominancia ${dirLabel}`,
      message: `Posicionamiento institucional activo y direccional. ${pp.join(' y ')} lideran el movimiento con sesgo ${dirLabel}.`,
      action: dirLabel === 'alcista'
        ? 'Buscar compras en retrocesos — confirmar estructura antes de entrar'
        : dirLabel === 'bajista'
        ? 'Buscar ventas en rebotes — confirmar estructura antes de entrar'
        : 'Seleccionar pares con mayor convicción — evitar cruces mixtos',
      footer: 'Basado en flujo institucional semanal (CFTC)',
    };
  }

  // Compression dominant
  if (co.length > tot / 2) {
    return {
      state: 'compression', icon: '⚠️', color: '#6b7280',
      bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.2)',
      title: 'Mercado en compresión institucional',
      message: 'El posicionamiento CFTC no muestra dirección dominante. Evitar operar en rango — el precio aún no ha confirmado expansión.',
      action: 'No operar — esperar ruptura de estructura con volumen confirmado',
      footer: 'Basado en flujo institucional semanal (CFTC)',
    };
  }

  // Mixed
  const topB = rows.filter(r => r.s !== 'compression').sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return {
    state: 'mixed', icon: '🔄', color: '#06b6d4',
    bg: 'rgba(6,182,212,0.07)', border: 'rgba(6,182,212,0.2)',
    title: `Flujo institucional ${dirLabel} — señales en construcción`,
    message: `${topB.length} pares construyendo sesgo. El mercado no ha alcanzado expansión plena — las señales aún se están confirmando.`,
    action: 'Centrarse en pares con mayor convicción · Reducir tamaño hasta confirmación',
    footer: 'Basado en flujo institucional semanal (CFTC)',
  };
}

export default function MarketState({ fxPairs, darkMode, T }) {
  const results = useMemo(() => {
    if (!fxPairs?.length) return [];
    return fxPairs.map(p => {
      if (!p) return null;
      const inp  = deriveInputsFromPair(p); if (!inp) return null;
      const bias = calculateBiasScore(inp);  if (!bias) return null;
      const latest = p.weeks?.[0], prev = p.weeks?.[1];
      return {
        pair: p.pair, score: bias.score,
        pctL: latest?.smartPctL ?? 50,
        weeklyDelta: latest && prev ? latest.smartNet - prev.smartNet : 0,
      };
    }).filter(Boolean);
  }, [fxPairs]);

  const s = useMemo(() => detectState(results), [results]);
  if (!s) return null;

  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 12, padding: '12px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>{s.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: s.color, letterSpacing: '0.08em' }}>
          ESTADO DEL MERCADO
        </span>
        <span style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{
          fontSize: 9, fontWeight: 700, color: s.color,
          background: s.color + '18', padding: '2px 7px', borderRadius: 4,
        }}>
          {s.state.toUpperCase()}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginBottom: 5 }}>{s.title}</div>
      <p style={{ margin: '0 0 8px', fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>{s.message}</p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 8,
        background: s.color + '10', border: `1px solid ${s.color}25`,
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: s.color, flexShrink: 0 }}>→</span>
        <span style={{ fontSize: 12, color: T.txt, lineHeight: 1.5 }}>{s.action}</span>
      </div>

      <div style={{ fontSize: 10, color: T.sub2, fontStyle: 'italic' }}>{s.footer}</div>
    </div>
  );
}
