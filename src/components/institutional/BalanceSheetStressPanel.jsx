// =============================================================================
// BalanceSheetStressPanel — Financial health and stress monitoring
// =============================================================================

import HeatmapGrid from './shared/HeatmapGrid.jsx';

function getS(T) {
  return {
    root: {
      background: T?.card ?? '#0f172a',
      border: `1px solid ${T?.border ?? 'rgba(255,255,255,0.08)'}`,
      borderRadius: 8,
      padding: '14px 16px',
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
    },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    title: { fontSize: 12, fontWeight: 700, color: T?.txt ?? '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' },
    divider: { height: 1, background: T?.border ?? 'rgba(255,255,255,0.06)', margin: '8px 0' },
    label: { fontSize: 10, color: T?.sub ?? '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 },
    flagRow: {
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '4px 0', borderBottom: `1px solid ${T?.border ?? 'rgba(255,255,255,0.04)'}`,
      fontSize: 10, color: T?.txt ?? '#cbd5e1',
    },
  };
}

function StressMeter({ score, T }) {
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const color = score >= 65 ? '#ef4444' : score >= 50 ? '#f97316' : score >= 35 ? '#fbbf24' : '#22c55e';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: T?.sub ?? '#64748b' }}>NIVEL DE ESTRÉS</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{Math.round(pct)}/100</span>
      </div>
      <div style={{ height: 8, background: T?.card2 ?? 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color, borderRadius: 999,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

export default function BalanceSheetStressPanel({ stressEngine, T }) {
  const S = getS(T);

  if (!stressEngine) {
    return (
      <div style={S.root}>
        <div style={S.header}><span style={S.title}>Estrés de Balance</span></div>
        <div style={{ color: T?.sub ?? '#475569', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>Sin datos financieros</div>
      </div>
    );
  }

  const { stressScore, level, trend, components, allFlags } = stressEngine;

  const componentCells = [
    { label: 'Liquidez',  value: components.liquidity?.score != null ? `${Math.round(components.liquidity.score)}` : '—', color: components.liquidity?.score < 50 ? '#22c55e' : '#ef4444', subtitle: 'score' },
    { label: 'Solvencia', value: components.solvency?.score  != null ? `${Math.round(components.solvency.score)}`  : '—', color: components.solvency?.score < 50  ? '#22c55e' : '#ef4444', subtitle: 'score' },
    { label: 'Flujo de Caja', value: components.cashflow?.score  != null ? `${Math.round(components.cashflow.score)}`  : '—', color: components.cashflow?.score < 50  ? '#22c55e' : '#ef4444', subtitle: 'score' },
    { label: 'Ganancias', value: components.earnings?.score  != null ? `${Math.round(components.earnings.score)}`  : '—', color: components.earnings?.score < 50  ? '#22c55e' : '#ef4444', subtitle: 'score' },
  ];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Estrés de Balance</span>
        {level && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: level.color, background: `${level.color}18`,
            border: `1px solid ${level.color}44`, padding: '2px 8px', borderRadius: 4,
          }}>
            {level.label}
          </span>
        )}
      </div>

      <StressMeter score={stressScore} T={T} />

      <div style={S.divider} />

      <HeatmapGrid cells={componentCells} columns={4} title="Componentes (menor = más sano)" T={T} />

      {trend && (
        <>
          <div style={S.divider} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>Tendencia del Balance</span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: trend.direction === 'IMPROVING' ? '#22c55e' : trend.direction === 'DETERIORATING' ? '#ef4444' : '#fbbf24',
            }}>
              {trend.direction === 'IMPROVING' ? 'MEJORANDO' : trend.direction === 'DETERIORATING' ? 'DETERIORANDO' : trend.direction}
            </span>
          </div>
          {trend.signals?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {trend.signals.slice(0, 3).map((sig, i) => (
                <span key={i} style={{
                  display: 'inline-block', fontSize: 10,
                  color: sig.severity === 'positive' ? '#22c55e' : '#f87171',
                  background: sig.severity === 'positive' ? '#22c55e14' : '#ef444414',
                  padding: '1px 5px', borderRadius: 3, marginRight: 4, marginBottom: 3,
                }}>
                  {sig.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {allFlags?.length > 0 && (
        <>
          <div style={S.divider} />
          <div style={S.label}>Alertas de Riesgo</div>
          <div style={{ marginTop: 4 }}>
            {allFlags.slice(0, 4).map((flag, i) => (
              <div key={i} style={S.flagRow}>
                <span style={{ color: '#ef4444', flexShrink: 0 }}>▲</span>
                <span>{flag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
