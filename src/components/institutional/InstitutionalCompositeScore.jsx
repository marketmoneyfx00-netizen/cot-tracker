// =============================================================================
// InstitutionalCompositeScore — Master scoring panel
// Bloomberg-style institutional composite score with breakdown
// =============================================================================

import ScoreGauge from './shared/ScoreGauge.jsx';
import TooltipInfo from '../TooltipInfo.jsx';

function getS(T) {
  return {
    root: {
      background: T
        ? `linear-gradient(135deg, ${T.card} 0%, ${T.card2} 100%)`
        : 'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 10,
      padding: '16px',
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
    },
    header: { fontSize: 10, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 },
    divider: { height: 1, background: T?.border ?? 'rgba(255,255,255,0.06)', margin: '10px 0' },
    componentRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 },
    bar: (pct, color) => ({
      height: 4, width: `${pct}%`, background: color, borderRadius: 999,
      transition: 'width 0.5s ease',
    }),
    trackBg: { flex: 1, height: 4, background: T?.border ?? 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' },
  };
}

function componentColor(score) {
  if (score >= 65) return '#22c55e';
  if (score >= 45) return '#fbbf24';
  return '#ef4444';
}

function RegimeBadge({ regime, color }) {
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

export default function InstitutionalCompositeScore({ composite, T }) {
  const S = getS(T);

  if (!composite) {
    return (
      <div style={S.root}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={S.header}>Puntuación Compuesta Institucional</span>
          <TooltipInfo text="Combinación ponderada de Entorno Macro, Riesgo Crypto, Calidad de Renta Variable y Estrés de Balance. Score 65+ = viento de cola · 45–65 = neutral · bajo 45 = resistencia estructural." />
        </div>
        <div style={{ color: T?.sub ?? '#475569', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>Calculando…</div>
      </div>
    );
  }

  const { compositeScore, conviction, label, regime, regimeColor, regimeDesc, breakdown, dataCompleteness } = composite;
  const scoreColor = compositeScore >= 65 ? '#22c55e' : compositeScore >= 45 ? '#fbbf24' : '#ef4444';

  return (
    <div style={S.root}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={S.header}>Puntuación Compuesta Institucional</span>
        <TooltipInfo text="Combinación ponderada de 4 sub-puntuaciones: Entorno Macro (40%), Señal de Riesgo Crypto (30%), Calidad de Renta Variable (20%) y Estrés de Balance (10%). Score 65–100 = viento de cola institucional. Score 45–65 = neutral. Score bajo 45 = resistencia estructural. Fiable cuando la completitud de datos supera el 70%." />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div style={{ position: 'relative', width: 96, height: 96 }}>
          <ScoreGauge score={compositeScore} color={scoreColor} size={96} showLabel={false} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
            {compositeScore}<span style={{ fontSize: 14, color: T?.sub2 ?? '#475569' }}>/100</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T?.txt ?? '#e2e8f0', marginTop: 4 }}>{label}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <RegimeBadge regime={regime} color={regimeColor} />
            <span style={{ fontSize: 9, fontWeight: 600, color: scoreColor, background: `${scoreColor}1a`, border: `1px solid ${scoreColor}33`, padding: '2px 7px', borderRadius: 3 }}>
              {conviction} CONVICCIÓN
            </span>
          </div>
          {regimeDesc && (
            <div style={{ fontSize: 10, color: T?.sub2 ?? '#475569', marginTop: 6, lineHeight: 1.4 }}>{regimeDesc}</div>
          )}
        </div>
      </div>

      <div style={S.divider} />

      <div style={{ fontSize: 10, fontWeight: 700, color: T?.sub ?? '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        Desglose de Componentes
      </div>

      {breakdown?.map(comp => {
        const bColor = componentColor(comp.score);
        return (
          <div key={comp.key} style={S.componentRow}>
            <div style={{ fontSize: 10, color: T?.sub ?? '#64748b', width: 110, flexShrink: 0 }}>{comp.label}</div>
            <div style={S.trackBg}>
              <div style={S.bar(comp.score, bColor)} />
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: bColor, width: 30, textAlign: 'right', flexShrink: 0 }}>
              {comp.score}
            </div>
            <div style={{ fontSize: 9, color: T?.sub2 ?? '#374151', width: 28, flexShrink: 0, textAlign: 'right' }}>
              {Math.round(comp.weight * 100)}%
            </div>
          </div>
        );
      })}

      {dataCompleteness != null && dataCompleteness < 100 && (
        <div style={{ marginTop: 8, fontSize: 9, color: T?.sub2 ?? '#374151' }}>
          Completitud de datos: {dataCompleteness}% — algunas señales no disponibles
        </div>
      )}
    </div>
  );
}
