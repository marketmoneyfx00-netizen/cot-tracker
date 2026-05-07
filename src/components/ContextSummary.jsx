/**
 * ContextSummary.jsx — v2
 */
import { useMemo } from 'react';
import { calculateBiasScore, deriveInputsFromPair } from '../cotBiasEngine.js';

function strengthLabel(abs) {
  if (abs >= 4) return 'muy fuerte';
  if (abs >= 3) return 'fuerte';
  if (abs >= 2) return 'moderado';
  return 'leve';
}

function pillLabel(score) {
  const abs = Math.abs(score);
  const dir = score > 0 ? '▲' : '▼';
  return `${dir} ${abs >= 4 ? 'muy fuerte' : abs >= 3 ? 'fuerte' : abs >= 2 ? 'moderado' : 'leve'}`;
}

function buildText(results) {
  const sorted  = [...results].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const top     = sorted[0];
  const top2    = sorted[1];
  const dxy     = results.find(r => r.pair === 'USD Index');
  const usdWeak = dxy && dxy.score < -1;
  const usdStr  = dxy && dxy.score > 1;
  const bullish = results.filter(r => r.score > 1.5 && !r.pair.includes('Index'));
  const bearish = results.filter(r => r.score < -1.5 && !r.pair.includes('Index'));
  const lines   = [];

  // DXY context
  if (dxy) {
    const dStr = strengthLabel(Math.abs(dxy.score));
    if (usdWeak)     lines.push(`El dólar muestra debilidad institucional ${dStr} — el flujo CFTC esta semana favorece los activos frente al USD.`);
    else if (usdStr) lines.push(`El dólar mantiene fortaleza institucional ${dStr} — el posicionamiento CFTC apoya al USD frente al resto de divisas.`);
    else             lines.push(`El dólar está en zona neutral según el posicionamiento institucional — sin ventaja direccional definida esta semana.`);
  }

  // Top pair
  if (top && Math.abs(top.score) >= 2) {
    const d = top.score > 0 ? 'alcista' : 'bajista';
    lines.push(`El par con mayor convicción institucional es ${top.pair} — sesgo ${d} ${strengthLabel(Math.abs(top.score))}.`);
    if (top2 && Math.abs(top2.score) >= 2) {
      const d2 = top2.score > 0 ? 'alcista' : 'bajista';
      lines.push(`Le sigue ${top2.pair} con sesgo ${d2} ${strengthLabel(Math.abs(top2.score))}, en la misma línea de flujo institucional.`);
    }
  }

  // Convergence
  if (bullish.length >= 2 && !usdStr) {
    lines.push(`Flujo institucional alcista convergente en ${bullish.slice(0, 2).map(r => r.pair).join(' y ')} — señal de acumulación amplia en divisas frente al USD.`);
  } else if (bearish.length >= 2 && !usdWeak) {
    lines.push(`Flujo institucional bajista convergente en ${bearish.slice(0, 2).map(r => r.pair).join(' y ')} — consistente con fortaleza del USD.`);
  }

  // Conflicts
  const conflicts = results.filter(r => {
    if (r.pair.includes('Index') || !r.pair.includes('USD') || !dxy) return false;
    const base = r.pair.startsWith('USD/');
    return (base && r.score > 1 && dxy.score < -1) || (!base && r.score > 1 && dxy.score > 1);
  });
  if (conflicts.length) {
    lines.push(`Divergencia detectada en ${conflicts[0].pair} vs DXY — aumenta el riesgo de movimientos erráticos. Evitar este par hasta resolución.`);
  }

  // Closing decision line
  if (usdWeak && bullish.length >= 1) {
    lines.push(`Sesgo institucional favorable para buscar compras en retrocesos.`);
  } else if (usdStr && bearish.length >= 1) {
    lines.push(`Sesgo institucional favorable para buscar ventas en retrocesos.`);
  } else {
    lines.push(`Sesgo institucional débil o mixto — priorizar preservación de capital esta semana.`);
  }

  return { lines, top, top2, bullish, bearish, conflicts };
}

export default function ContextSummary({ fxPairs, darkMode, T }) {
  const results = useMemo(() => {
    if (!fxPairs?.length) return [];
    return fxPairs.map(p => {
      if (!p) return null;
      const inputs = deriveInputsFromPair(p); if (!inputs) return null;
      const bias   = calculateBiasScore(inputs); if (!bias) return null;
      return { pair: p.pair, score: bias.score };
    }).filter(Boolean);
  }, [fxPairs]);

  const data = useMemo(() => results.length ? buildText(results) : null, [results]);
  if (!data) return null;

  const { lines } = data;
  const isDecision = (l) => l.includes('favorable para') || l.includes('preservación');

  return (
    <div style={{
      background: darkMode ? 'rgba(0,85,204,0.06)' : 'rgba(0,85,204,0.04)',
      border: `1px solid ${darkMode ? 'rgba(0,85,204,0.2)' : 'rgba(0,85,204,0.15)'}`,
      borderRadius: 12, padding: '12px 16px', marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>🧭</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: '0.08em' }}>
          CONTEXTO INSTITUCIONAL ACTUAL
        </span>
        <span style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.05em' }}>COT · CFTC · SEMANAL</span>
      </div>

      {/* Lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {lines.map((line, i) => {
          const isDec  = isDecision(line);
          const isWarn = line.startsWith('Divergencia');
          const color  = isWarn ? '#f59e0b' : isDec ? T.txt : T.sub;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: isWarn ? '#f59e0b' : T.accent, marginTop: 2, flexShrink: 0 }}>
                {isWarn ? '⚠' : isDec ? '✦' : '→'}
              </span>
              <span style={{ fontSize: isDec ? 13.5 : 12.5, fontWeight: isDec ? 700 : 400, color, lineHeight: 1.55 }}>
                {line}
              </span>
            </div>
          );
        })}
      </div>

      {/* Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {results
          .filter(r => Math.abs(r.score) >= 1)
          .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          .slice(0, 6)
          .map(r => {
            const bull  = r.score > 0;
            const abs   = Math.abs(r.score);
            const color = abs >= 3 ? (bull ? '#22c55e' : '#ef4444') : abs >= 1.5 ? (bull ? '#4ade80' : '#f87171') : '#94a3b8';
            return (
              <span key={r.pair} style={{
                fontSize: 10, fontWeight: 600,
                color, background: color + '18', border: `1px solid ${color}30`,
                padding: '2px 8px', borderRadius: 5,
              }}>
                {r.pair} {pillLabel(r.score)}
              </span>
            );
          })}
      </div>
    </div>
  );
}
