// =============================================================================
// HeatmapGrid — Correlation / metric heatmap grid
// Props:
//   cells: [{ label, value, color?, tooltip? }]
//   columns: number (default 3)
// =============================================================================

export default function HeatmapGrid({ cells = [], columns = 3, title }) {
  if (!cells.length) return null;

  return (
    <div>
      {title && (
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--text-muted, #9ca3af)',
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
          <HeatCell key={i} {...cell} />
        ))}
      </div>
    </div>
  );
}

function HeatCell({ label, value, color, subtitle, tooltip }) {
  const bg = color ? `${color}22` : 'rgba(255,255,255,0.04)';
  const border = color ? `${color}44` : 'rgba(255,255,255,0.08)';

  return (
    <div
      title={tooltip}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: '5px 7px',
        cursor: tooltip ? 'help' : 'default',
      }}
    >
      <div style={{ fontSize: 9, color: 'var(--text-muted, #9ca3af)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? 'var(--text, #f9fafb)', fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </div>
      {subtitle && (
        <div style={{ fontSize: 9, color: color ?? '#9ca3af', marginTop: 1 }}>{subtitle}</div>
      )}
    </div>
  );
}
