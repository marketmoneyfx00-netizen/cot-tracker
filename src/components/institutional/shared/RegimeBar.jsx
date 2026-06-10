// =============================================================================
// RegimeBar — Horizontal regime indicator with color band
// =============================================================================

export default function RegimeBar({ score, regime, regimeColor, label, compact = false, T }) {
  const pct = Math.max(0, Math.min(100, score ?? 50));
  const subColor = T?.sub ?? 'var(--text-muted, #9ca3af)';
  const trackBg  = T?.card2 ?? T?.border ?? 'rgba(255,255,255,0.08)';
  const markerBg = T?.border ?? 'rgba(255,255,255,0.2)';
  const color    = regimeColor ?? '#fbbf24';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 2 : 4 }}>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: subColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label ?? 'Régimen'}
          </span>
          <span style={{
            fontSize: 10, color, fontWeight: 600,
            background: `${color}18`, padding: '1px 6px', borderRadius: 3,
          }}>
            {regime ?? 'NEUTRAL'}
          </span>
        </div>
      )}
      <div style={{ position: 'relative', height: compact ? 4 : 6, background: trackBg, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`, background: color, borderRadius: 999,
          transition: 'width 0.5s ease',
        }} />
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: markerBg }} />
      </div>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: subColor }}>Bajista</span>
          <span style={{ fontSize: 9, color: subColor }}>Neutral</span>
          <span style={{ fontSize: 9, color: subColor }}>Alcista</span>
        </div>
      )}
    </div>
  );
}
