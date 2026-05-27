// =============================================================================
// RegimeBar — Horizontal regime indicator with color band
// =============================================================================

export default function RegimeBar({ score, regime, regimeColor, label, compact = false }) {
  const pct = Math.max(0, Math.min(100, score ?? 50));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 2 : 4 }}>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label ?? 'Regime'}
          </span>
          <span style={{
            fontSize: 10,
            color: regimeColor ?? '#fbbf24',
            fontWeight: 600,
            background: `${regimeColor ?? '#fbbf24'}18`,
            padding: '1px 6px',
            borderRadius: 3,
          }}>
            {regime ?? 'NEUTRAL'}
          </span>
        </div>
      )}
      {/* Track */}
      <div style={{
        position: 'relative',
        height: compact ? 4 : 6,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 999,
        overflow: 'hidden',
      }}>
        {/* Filled bar */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: regimeColor ?? '#fbbf24',
          borderRadius: 999,
          transition: 'width 0.5s ease',
        }} />
        {/* Center marker */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: 0, bottom: 0,
          width: 1,
          background: 'rgba(255,255,255,0.2)',
        }} />
      </div>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: '#6b7280' }}>Bearish</span>
          <span style={{ fontSize: 9, color: '#6b7280' }}>Neutral</span>
          <span style={{ fontSize: 9, color: '#6b7280' }}>Bullish</span>
        </div>
      )}
    </div>
  );
}
