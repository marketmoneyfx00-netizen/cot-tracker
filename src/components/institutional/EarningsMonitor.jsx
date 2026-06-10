// =============================================================================
// EarningsMonitor — Earnings regime + history panel
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
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    title: { fontSize: 12, fontWeight: 700, color: T?.txt ?? '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' },
    divider: { height: 1, background: T?.border ?? 'rgba(255,255,255,0.06)', margin: '10px 0' },
    badge: (color) => ({
      fontSize: 10, fontWeight: 700, color, background: `${color}18`,
      border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: 4,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }),
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' },
    label: { fontSize: 10, color: T?.sub ?? '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
    value: { fontSize: 12, fontWeight: 600, color: T?.txt ?? '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  };
}

function streakIcon(streak) {
  if (streak > 0) return `▲${streak} Aciertos`;
  if (streak < 0) return `▼${Math.abs(streak)} Fallos`;
  return '—';
}

function fmtSurprise(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export default function EarningsMonitor({ earningsRegime, T }) {
  const S = getS(T);

  if (!earningsRegime) {
    return (
      <div style={S.root}>
        <div style={S.header}><span style={S.title}>Monitor de Ganancias</span></div>
        <div style={{ color: T?.sub ?? '#475569', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>Sin datos de ganancias</div>
      </div>
    );
  }

  const { label, color, description, volatilityRegime, drift, revisionTrend, summary, qualitySignals } = earningsRegime;

  const statCells = [
    { label: 'Tasa de Acierto', value: summary?.beatRate != null ? `${Math.round(summary.beatRate * 100)}%` : '—', color: summary?.beatRate > 0.6 ? '#22c55e' : '#ef4444' },
    { label: 'Sorpresa Media',  value: fmtSurprise(summary?.avgSurprisePct), color: summary?.avgSurprisePct > 0 ? '#22c55e' : '#ef4444' },
    { label: 'Momentum Rev.',   value: fmtSurprise(summary?.revisionMomentum), color: summary?.revisionMomentum > 0 ? '#4ade80' : '#f87171' },
    { label: 'Racha EPS',       value: streakIcon(summary?.streak ?? 0), color: (summary?.streak ?? 0) > 0 ? '#22c55e' : '#ef4444' },
  ];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Monitor de Ganancias</span>
        <span style={S.badge(color ?? '#fbbf24')}>{label}</span>
      </div>

      <div style={{ fontSize: 11, color: T?.sub ?? '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>{description}</div>

      <HeatmapGrid cells={statCells} columns={4} T={T} />

      <div style={S.divider} />

      <div style={{ marginBottom: 8 }}>
        <div style={S.label}>Previsión Post-Ganancias</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: drift?.direction?.includes('POSITIVE') ? '#22c55e' : drift?.direction?.includes('NEGATIVE') ? '#ef4444' : '#fbbf24',
          }}>
            {drift?.direction ?? '—'}
          </span>
          <span style={{ fontSize: 10, color: T?.sub2 ?? '#475569' }}>
            {drift?.magnitude ? `· ${drift.magnitude}` : ''}
            {drift?.confidence ? ` · ${drift.confidence}` : ''}
          </span>
        </div>
      </div>

      <div style={S.row}>
        <span style={S.label}>Régimen de Volatilidad</span>
        <span style={{ fontSize: 11, color: T?.sub ?? '#94a3b8' }}>
          {volatilityRegime?.regime ?? '—'}{' '}
          {volatilityRegime?.expectedMove ? `(${volatilityRegime.expectedMove})` : ''}
        </span>
      </div>

      {revisionTrend && (
        <div style={S.row}>
          <span style={S.label}>Tendencia de Revisión</span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: revisionTrend.trend === 'IMPROVING' ? '#22c55e' : revisionTrend.trend === 'DETERIORATING' ? '#ef4444' : '#fbbf24',
          }}>
            {revisionTrend.trend === 'IMPROVING' ? 'MEJORANDO' : revisionTrend.trend === 'DETERIORATING' ? 'DETERIORANDO' : revisionTrend.trend} ({fmtSurprise(revisionTrend.delta)})
          </span>
        </div>
      )}

      {qualitySignals?.consistencyScore && (
        <div style={S.row}>
          <span style={S.label}>Consistencia</span>
          <span style={{ fontSize: 11, color: qualitySignals.consistencyScore === 'HIGH' ? '#22c55e' : '#fbbf24' }}>
            {qualitySignals.consistencyScore}
          </span>
        </div>
      )}
    </div>
  );
}
