// =============================================================================
// EquityIntelligencePanel — Institutional equity analysis view
// =============================================================================

import HeatmapGrid from './shared/HeatmapGrid.jsx';
import RegimeBar   from './shared/RegimeBar.jsx';
import ScoreGauge  from './shared/ScoreGauge.jsx';

const S = {
  root: {
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '14px 16px',
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 12, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' },
  ticker: { fontSize: 11, color: '#64748b', background: '#1e293b', padding: '2px 7px', borderRadius: 4 },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' },
  label: { fontSize: 10, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' },
  value: { fontSize: 13, fontWeight: 600, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' },
  driverRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  dot: (signal) => ({
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    background: signal === 'positive' ? '#22c55e' : signal === 'negative' ? '#ef4444' : '#fbbf24',
  }),
};

function pctColor(v) {
  if (v == null) return '#64748b';
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#fbbf24';
}

function fmt(v, suffix = '') {
  if (v == null) return '—';
  return `${v}${suffix}`;
}

export default function EquityIntelligencePanel({ equityIntel, equityProxy }) {
  if (!equityIntel) {
    return (
      <div style={S.root}>
        <div style={S.header}>
          <span style={S.title}>Equity Intelligence</span>
        </div>
        <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>
          {equityProxy ? `Loading ${equityProxy.ticker}…` : 'No equity proxy for this pair'}
        </div>
      </div>
    );
  }

  const { snapshot, fundamentals, scores, drivers, label, direction, compositeScore, sector } = equityIntel;

  const scoreColor = compositeScore >= 65 ? '#22c55e' : compositeScore >= 45 ? '#fbbf24' : '#ef4444';

  const fundCells = [
    { label: 'Net Margin',    value: fmt(fundamentals?.netMargin, '%'), color: fundamentals?.netMargin > 10 ? '#22c55e' : '#fbbf24' },
    { label: 'Rev Growth',    value: fmt(fundamentals?.revenueGrowth, '%'), color: pctColor(fundamentals?.revenueGrowth) },
    { label: 'D/E Ratio',     value: fmt(fundamentals?.debtToEquity != null ? `${fundamentals.debtToEquity}x` : null), color: fundamentals?.debtToEquity < 1 ? '#22c55e' : '#ef4444' },
    { label: 'Current Ratio', value: fmt(fundamentals?.currentRatio != null ? `${fundamentals.currentRatio}x` : null), color: fundamentals?.currentRatio > 1.5 ? '#22c55e' : '#ef4444' },
    { label: 'P/E',           value: snapshot?.pe ?? '—', color: '#94a3b8' },
    { label: 'Fwd P/E',       value: snapshot?.forwardPe ?? '—', color: '#94a3b8' },
  ];

  const scoreCells = scores ? [
    { label: 'Profitability', value: scores.profitability != null ? `${Math.round(scores.profitability)}/100` : '—', color: scoreColor },
    { label: 'Growth',        value: scores.growth != null ? `${Math.round(scores.growth)}/100` : '—', color: scoreColor },
    { label: 'Fin. Health',   value: scores.financialHealth != null ? `${Math.round(scores.financialHealth)}/100` : '—', color: scoreColor },
    { label: 'Valuation',     value: scores.valuation != null ? `${Math.round(scores.valuation)}/100` : '—', color: '#94a3b8' },
  ] : [];

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>Equity Intelligence</span>
        {equityProxy && (
          <span style={S.ticker}>{equityProxy.ticker} — {equityProxy.label}</span>
        )}
      </div>

      {/* Score + Price row */}
      <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', width: 80, height: 80 }}>
          <ScoreGauge score={compositeScore} color={scoreColor} size={80} />
        </div>
        <div style={{ flex: 1, paddingLeft: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: scoreColor, marginBottom: 4 }}>{label}</div>
          {snapshot && (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {snapshot.price != null ? `$${snapshot.price}` : ''}{' '}
                <span style={{ color: pctColor(parseFloat(snapshot.change)) }}>{snapshot.change}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                MktCap: {snapshot.marketCap} · {sector ?? ''}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Regime bar */}
      <RegimeBar
        score={compositeScore}
        regime={direction?.toUpperCase()}
        regimeColor={scoreColor}
        label="Institutional Quality"
      />

      <div style={S.divider} />

      {/* Fundamentals heatmap */}
      <HeatmapGrid cells={fundCells} columns={3} title="Fundamentals" />

      {scoreCells.length > 0 && (
        <>
          <div style={{ ...S.divider, marginTop: 8 }} />
          <HeatmapGrid cells={scoreCells} columns={4} title="Sub-Scores" />
        </>
      )}

      {/* Key drivers */}
      {drivers?.length > 0 && (
        <>
          <div style={{ ...S.divider, marginTop: 8 }} />
          <div style={S.label}>Key Drivers</div>
          {drivers.map((d, i) => (
            <div key={i} style={S.driverRow}>
              <div style={S.dot(d.signal)} />
              <span style={{ fontSize: 11, color: '#cbd5e1', flex: 1 }}>{d.label}</span>
              {d.value && <span style={{ fontSize: 11, color: pctColor(parseFloat(d.value)) }}>{d.value}</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
