// =============================================================================
// HeatmapGrid — Correlation / metric heatmap grid
// Props:
//   cells: [{ label, value, color?, tooltip?, subtitle? }]
//   columns: number (default 3)
//   T: theme tokens
// =============================================================================

export default function HeatmapGrid({ cells = [], columns = 3, title, T }) {
  if (!cells.length) return null;

  const subColor = T?.sub ?? 'var(--text-muted, #9ca3af)';
  const txtColor = T?.txt ?? 'var(--text, #f9fafb)';

  return (
    <div>
      {title && (
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: subColor,
          marginBottom: 6,
        }}>
          {title}
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 2,
      }}>
        {cells.map((cell, i) => (
          <HeatCell key={i} {...cell} subColor={subColor} txtColor={txtColor} T={T} />
        ))}
      </div>
    </div>
  );
}

function HeatCell({ label, value, color, subtitle, tooltip, subColor, txtColor, T }) {
  const bg     = color ? `${color}22` : (T?.card2 ? T.card2 : 'rgba(255,255,255,0.04)');
  const border = color ? `${color}44` : (T?.border ?? 'rgba(255,255,255,0.08)');

  return (
    <div
      title={tooltip}
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 4, padding: '5px 7px', cursor: tooltip ? 'help' : 'default' }}
    >
      <div style={{ fontSize: 9, color: subColor, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? txtColor, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </div>
      {subtitle && (
        <div style={{ fontSize: 9, color: color ?? subColor, marginTop: 1 }}>{subtitle}</div>
      )}
    </div>
  );
}
