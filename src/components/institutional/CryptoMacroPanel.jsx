// =============================================================================
// CryptoMacroPanel — Crypto macro intelligence layer
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
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 12, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' },
  badge: (color) => ({
    fontSize: 10, fontWeight: 700, color, background: `${color}18`,
    border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
  }),
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' },
  label: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  implRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 7px', borderRadius: 4,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.05)',
    marginBottom: 3,
  },
};

function riskColor(regime) {
  if (regime === 'RISK_ON')  return '#22c55e';
  if (regime === 'RISK_OFF') return '#ef4444';
  return '#fbbf24';
}

function fmtChange(v) {
  if (v == null) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function corrColor(v) {
  if (v == null) return '#64748b';
  return Math.abs(v) > 0.6 ? '#f97316' : Math.abs(v) > 0.3 ? '#fbbf24' : '#22c55e';
}

export default function CryptoMacroPanel({ cryptoLayer }) {
  if (!cryptoLayer) {
    return (
      <div style={S.root}>
        <div style={S.header}><span style={S.title}>Crypto Macro</span></div>
        <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>No crypto data</div>
      </div>
    );
  }

  const { riskSignal, institutional, correlations, fxImplication, btcDemand, ethDemand, volatility } = cryptoLayer;

  const regimeColor = riskColor(riskSignal?.regime);

  const corrCells = correlations ? [
    { label: 'BTC/QQQ',  value: correlations.btcVsNasdaq != null ? correlations.btcVsNasdaq.toFixed(2) : '—', color: corrColor(correlations.btcVsNasdaq) },
    { label: 'BTC/DXY',  value: correlations.btcVsDxy != null ? correlations.btcVsDxy.toFixed(2) : '—', color: corrColor(correlations.btcVsDxy) },
    { label: 'BTC/Yield',value: correlations.btcVsYields != null ? correlations.btcVsYields.toFixed(2) : '—', color: corrColor(correlations.btcVsYields) },
    { label: 'BTC/Gold', value: correlations.btcVsGold != null ? correlations.btcVsGold.toFixed(2) : '—', color: corrColor(correlations.btcVsGold) },
  ] : [];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Crypto Macro Layer</span>
        <span style={S.badge(regimeColor)}>{riskSignal?.regime ?? 'NEUTRAL'}</span>
      </div>

      {/* Risk signal */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={S.label}>Risk Signal Score</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: regimeColor }}>{riskSignal?.score ?? '—'}<span style={{ fontSize: 12, color: '#475569' }}>/100</span></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={S.label}>Institutional Demand</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: institutional?.color ?? '#94a3b8' }}>{institutional?.label ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#475569' }}>{institutional?.score != null ? `${institutional.score}/100` : ''}</div>
        </div>
      </div>

      {/* BTC / ETH demand */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 10px' }}>
          <div style={S.label}>BTC ETFs</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: btcDemand?.avgChangePercent >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtChange(btcDemand?.avgChangePercent)}
          </div>
          <div style={{ fontSize: 10, color: '#475569' }}>{btcDemand?.direction ?? '—'}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 10px' }}>
          <div style={S.label}>ETH ETFs</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ethDemand?.changePercent >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtChange(ethDemand?.changePercent)}
          </div>
          <div style={{ fontSize: 10, color: '#475569' }}>{ethDemand?.direction ?? '—'}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 10px' }}>
          <div style={S.label}>Crypto Vol</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>
            {volatility?.annualizedVol != null ? `${volatility.annualizedVol}%` : '—'}
          </div>
          <div style={{ fontSize: 10, color: '#475569' }}>{volatility?.regime ?? '—'}</div>
        </div>
      </div>

      {/* Correlations */}
      {corrCells.length > 0 && (
        <>
          <HeatmapGrid cells={corrCells} columns={4} title="Correlations (30d)" />
          <div style={S.divider} />
        </>
      )}

      {/* FX implications */}
      {fxImplication?.length > 0 && (
        <div>
          <div style={S.label}>FX Implications</div>
          <div style={{ marginTop: 4 }}>
            {fxImplication.map((impl, i) => (
              <div key={i} style={S.implRow}>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: impl.direction === 'bullish' ? '#22c55e' : '#ef4444',
                  background: impl.direction === 'bullish' ? '#22c55e18' : '#ef444418',
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {impl.currency} {impl.direction.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', flex: 1 }}>{impl.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
