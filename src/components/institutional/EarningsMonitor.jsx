// =============================================================================
// EarningsMonitor — Earnings regime + history panel
// =============================================================================

import HeatmapGrid from './shared/HeatmapGrid.jsx';

const S = {
  root: {
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '14px 16px',
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 12, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' },
  badge: (color) => ({
    fontSize: 10, fontWeight: 700, color, background: `${color}18`,
    border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: 4,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  }),
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' },
  label: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  value: { fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
};

function streakIcon(streak) {
  if (streak > 0) return `▲${streak} Beat`;
  if (streak < 0) return `▼${Math.abs(streak)} Miss`;
  return '—';
}

function fmtSurprise(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export default function EarningsMonitor({ earningsRegime }) {
  if (!earningsRegime) {
    return (
      <div style={S.root}>
        <div style={S.header}><span style={S.title}>Earnings Monitor</span></div>
        <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>No earnings data</div>
      </div>
    );
  }

  const { label, color, description, volatilityRegime, drift, revisionTrend, summary, qualitySignals } = earningsRegime;

  const statCells = [
    { label: 'Beat Rate',     value: summary?.beatRate != null ? `${Math.round(summary.beatRate * 100)}%` : '—', color: summary?.beatRate > 0.6 ? '#22c55e' : '#ef4444' },
    { label: 'Avg Surprise',  value: fmtSurprise(summary?.avgSurprisePct), color: summary?.avgSurprisePct > 0 ? '#22c55e' : '#ef4444' },
    { label: 'Rev Momentum',  value: fmtSurprise(summary?.revisionMomentum), color: summary?.revisionMomentum > 0 ? '#4ade80' : '#f87171' },
    { label: 'EPS Streak',    value: streakIcon(summary?.streak ?? 0), color: (summary?.streak ?? 0) > 0 ? '#22c55e' : '#ef4444' },
  ];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Earnings Monitor</span>
        <span style={S.badge(color ?? '#fbbf24')}>{label}</span>
      </div>

      {/* Description */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>{description}</div>

      {/* Stats grid */}
      <HeatmapGrid cells={statCells} columns={4} />

      <div style={S.divider} />

      {/* Drift prediction */}
      <div style={{ marginBottom: 8 }}>
        <div style={S.label}>Post-Earnings Drift Forecast</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: drift?.direction?.includes('POSITIVE') ? '#22c55e' : drift?.direction?.includes('NEGATIVE') ? '#ef4444' : '#fbbf24',
          }}>
            {drift?.direction ?? '—'}
          </span>
          <span style={{ fontSize: 10, color: '#475569' }}>
            {drift?.magnitude ? `· ${drift.magnitude} move` : ''}
            {drift?.confidence ? ` · ${drift.confidence} confidence` : ''}
          </span>
        </div>
      </div>

      {/* Volatility regime */}
      <div style={S.row}>
        <span style={S.label}>Vol Regime</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {volatilityRegime?.regime ?? '—'}{' '}
          {volatilityRegime?.expectedMove ? `(${volatilityRegime.expectedMove} expected)` : ''}
        </span>
      </div>

      {/* Revision trend */}
      {revisionTrend && (
        <div style={S.row}>
          <span style={S.label}>Revision Trend</span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: revisionTrend.trend === 'IMPROVING' ? '#22c55e' : revisionTrend.trend === 'DETERIORATING' ? '#ef4444' : '#fbbf24',
          }}>
            {revisionTrend.trend} ({fmtSurprise(revisionTrend.delta)})
          </span>
        </div>
      )}

      {/* Quality consistency */}
      {qualitySignals?.consistencyScore && (
        <div style={S.row}>
          <span style={S.label}>Consistency</span>
          <span style={{ fontSize: 11, color: qualitySignals.consistencyScore === 'HIGH' ? '#22c55e' : '#fbbf24' }}>
            {qualitySignals.consistencyScore}
          </span>
        </div>
      )}
    </div>
  );
}
