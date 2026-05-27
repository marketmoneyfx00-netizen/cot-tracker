// =============================================================================
// InstitutionalCompositeScore — Master scoring panel
// Bloomberg-style institutional composite score with breakdown
// =============================================================================

import ScoreGauge from './shared/ScoreGauge.jsx';

const S = {
  root: {
    background: 'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 10,
    padding: '16px',
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
  },
  header: { fontSize: 10, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' },
  componentRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
  },
  bar: (pct, color) => ({
    height: 4, width: `${pct}%`, background: color, borderRadius: 999,
    transition: 'width 0.5s ease',
  }),
};

function componentColor(score) {
  if (score >= 65) return '#22c55e';
  if (score >= 45) return '#fbbf24';
  return '#ef4444';
}

function regimeBadge(regime, color) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
      color, background: `${color}1a`, border: `1px solid ${color}33`,
      padding: '2px 7px', borderRadius: 3,
    }}>
      {regime}
    </span>
  );
}

export default function InstitutionalCompositeScore({ composite }) {
  if (!composite) {
    return (
      <div style={S.root}>
        <div style={S.header}>Institutional Composite Score</div>
        <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>Computing…</div>
      </div>
    );
  }

  const { compositeScore, conviction, label, regime, regimeColor, regimeDesc, breakdown, dataCompleteness } = composite;

  const scoreColor = compositeScore >= 65 ? '#22c55e' : compositeScore >= 45 ? '#fbbf24' : '#ef4444';

  return (
    <div style={S.root}>
      <div style={S.header}>Institutional Composite Score</div>

      {/* Main score row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div style={{ position: 'relative', width: 96, height: 96 }}>
          <ScoreGauge score={compositeScore} color={scoreColor} size={96} showLabel={false} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
            {compositeScore}<span style={{ fontSize: 14, color: '#475569' }}>/100</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginTop: 4 }}>{label}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {regimeBadge(regime, regimeColor)}
            <span style={{ fontSize: 9, fontWeight: 600, color: scoreColor, background: `${scoreColor}1a`, border: `1px solid ${scoreColor}33`, padding: '2px 7px', borderRadius: 3 }}>
              {conviction} CONVICTION
            </span>
          </div>
          {regimeDesc && (
            <div style={{ fontSize: 10, color: '#475569', marginTop: 6, lineHeight: 1.4 }}>{regimeDesc}</div>
          )}
        </div>
      </div>

      <div style={S.divider} />

      {/* Component breakdown */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        Component Breakdown
      </div>

      {breakdown?.map(comp => {
        const bColor = componentColor(comp.score);
        return (
          <div key={comp.key} style={S.componentRow}>
            <div style={{ fontSize: 10, color: '#64748b', width: 110, flexShrink: 0 }}>{comp.label}</div>
            <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={S.bar(comp.score, bColor)} />
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: bColor, width: 30, textAlign: 'right', flexShrink: 0 }}>
              {comp.score}
            </div>
            <div style={{ fontSize: 9, color: '#374151', width: 28, flexShrink: 0, textAlign: 'right' }}>
              {Math.round(comp.weight * 100)}%
            </div>
          </div>
        );
      })}

      {/* Data completeness */}
      {dataCompleteness != null && dataCompleteness < 100 && (
        <div style={{ marginTop: 8, fontSize: 9, color: '#374151' }}>
          Data completeness: {dataCompleteness}% — some signals unavailable
        </div>
      )}
    </div>
  );
}
