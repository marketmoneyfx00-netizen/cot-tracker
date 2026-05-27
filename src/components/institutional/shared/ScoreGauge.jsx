// =============================================================================
// ScoreGauge — Institutional score circular gauge
// =============================================================================

export default function ScoreGauge({ score, label, color, size = 80, showLabel = true }) {
  if (score == null) {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: 11 }}>N/A</div>
      </div>
    );
  }

  const r        = (size / 2) - 6;
  const cx       = size / 2;
  const cy       = size / 2;
  const circumf  = 2 * Math.PI * r;
  const filled   = (score / 100) * circumf;
  const gap      = circumf - filled;

  const trackColor = 'rgba(255,255,255,0.08)';
  const gaugeColor = color ?? scoreToColor(score);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={5}
        />
        {/* Score arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={gaugeColor}
          strokeWidth={5}
          strokeDasharray={`${filled} ${gap}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      {/* Center text */}
      <div style={{
        position: 'absolute',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size, height: size,
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: size / 4, fontWeight: 700, color: gaugeColor, fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(score)}
        </span>
      </div>
      {showLabel && label && (
        <div style={{ fontSize: 10, color: 'var(--text-muted, #9ca3af)', textAlign: 'center', maxWidth: size + 20 }}>
          {label}
        </div>
      )}
    </div>
  );
}

function scoreToColor(score) {
  if (score >= 65) return '#22c55e';
  if (score >= 45) return '#fbbf24';
  return '#ef4444';
}
