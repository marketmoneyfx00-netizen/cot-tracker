// =============================================================================
// InstitutionalDashboard — Bloomberg/Koyfin-style institutional intelligence
//
// Displays the full Financial Datasets institutional layer for the selected pair.
// Props:
//   pair          {string}   — selected FX pair (e.g. "EUR/USD")
//   cotBiasScore  {number}   — from cotBiasEngine
//   macroSignal   {object}   — from useMacroSignal
//   compact       {boolean}  — minimal mode (sidebar)
//   T             {object}   — theme tokens from buildTheme()
// =============================================================================

import { useInstitutionalData }        from '../../hooks/useInstitutionalData.js';
import InstitutionalCompositeScore     from './InstitutionalCompositeScore.jsx';
import EquityIntelligencePanel         from './EquityIntelligencePanel.jsx';
import EarningsMonitor                 from './EarningsMonitor.jsx';
import BalanceSheetStressPanel         from './BalanceSheetStressPanel.jsx';
import TooltipInfo                     from '../TooltipInfo.jsx';

function getS(T) {
  return {
    root: {
      background: T?.bg ?? 'var(--cot-bg, #070b14)',
      minHeight: 400,
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
    },
    topBar: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0 12px',
      borderBottom: `1px solid ${T?.border ?? 'rgba(255,255,255,0.06)'}`,
      marginBottom: 14,
    },
    topBarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
    title: { fontSize: 11, fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em' },
    pairBadge: {
      fontSize: 11, color: T?.sub ?? '#94a3b8', background: T?.card2 ?? '#1e293b',
      border: `1px solid ${T?.border ?? 'rgba(255,255,255,0.08)'}`,
      padding: '2px 8px', borderRadius: 4,
    },
    freshness: { fontSize: 10, color: T?.sub2 ?? '#64748b' },
    grid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
    },
    errorBox: {
      background: T?.card ?? '#1c0a0a', border: `1px solid ${T?.red ?? '#7f1d1d'}55`,
      borderRadius: 8, padding: 14, textAlign: 'center',
    },
    narrativeBox: {
      background: T?.card ?? '#0f1729',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 8,
      padding: '12px 14px',
      marginBottom: 10,
    },
    narrativeTitle: { fontSize: 9, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 },
    narrativeText: { fontSize: 11, color: T?.sub ?? '#94a3b8', lineHeight: 1.6 },
    divTag: (color) => ({
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 4, marginRight: 4, marginBottom: 3,
      background: `${color}15`, border: `1px solid ${color}33`,
      fontSize: 9, fontWeight: 600, color, letterSpacing: '0.05em',
    }),
    loadingShimmer: (T) => ({
      height: 200,
      background: `linear-gradient(90deg, ${T?.card ?? '#0f172a'} 25%, ${T?.card2 ?? '#1e293b'} 50%, ${T?.card ?? '#0f172a'} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      borderRadius: 8,
    }),
  };
}

function RelativeTime({ iso, T }) {
  if (!iso) return null;
  const d = new Date(iso);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <span style={{ fontSize: 10, color: T?.sub2 ?? '#64748b' }}>Actualizado {timeStr}</span>;
}

function NarrativePanel({ narrative, T }) {
  if (!narrative?.primaryNarrative) return null;
  const S = getS(T);
  const { primaryNarrative, divergences, positioningSummary } = narrative;

  return (
    <div style={S.narrativeBox}>
      <div style={S.narrativeTitle}>Narrativa Institucional</div>
      <p style={S.narrativeText}>{primaryNarrative}</p>

      {divergences?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Divergencias Detectadas ({divergences.length})
          </div>
          {divergences.slice(0, 2).map((d, i) => (
            <div key={i} style={{
              padding: '5px 8px',
              background: T?.card2 ?? '#1c0a0a',
              border: `1px solid ${T?.red ?? '#ef4444'}33`,
              borderRadius: 4, marginBottom: 3,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T?.red ?? '#fca5a5' }}>{d.description}</div>
              <div style={{ fontSize: 9, color: T?.sub ?? '#6b7280', marginTop: 2 }}>{d.implication}</div>
            </div>
          ))}
        </div>
      )}

      {positioningSummary?.signals?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: T?.sub ?? '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Alineación de Señales
          </div>
          <div>
            {positioningSummary.signals.map((sig, i) => (
              <span key={i} style={S.divTag(sig.color)}>
                {sig.label}: {sig.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InstitutionalDashboard({ pair, cotBiasScore, macroSignal, compact = false, T }) {
  const S = getS(T);
  const { institutionalData, loading, error, lastUpdated, retry } = useInstitutionalData({
    pair,
    cotBiasScore,
    macroSignal,
    enabled: !!pair,
  });

  if (!pair) {
    return (
      <div style={{ ...S.root, padding: '20px 0', textAlign: 'center', color: T?.sub ?? '#64748b', fontSize: 11 }}>
        Selecciona un par para ver la inteligencia institucional
      </div>
    );
  }

  return (
    <div style={S.root}>
      {/* Purpose statement */}
      <div style={{
        background: 'rgba(99,102,241,0.07)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '10px 14px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', letterSpacing: '0.1em' }}>
            PANEL INSTITUCIONAL
          </span>
          <TooltipInfo text="Este panel combina fundamentos de renta variable, régimen de ganancias y estrés de balance para producir una puntuación de convicción institucional. Score 65+ = viento de cola · 45–65 = neutral · bajo 45 = viento en contra." />
        </div>
        <p style={{ margin: 0, fontSize: 11, color: T?.sub ?? '#94a3b8', lineHeight: 1.55 }}>
          Combina fundamentos de renta variable, régimen de ganancias y estrés de balance para generar
          una puntuación de convicción institucional para el par seleccionado.
          <span style={{ color: '#6366f1', marginLeft: 4 }}>
            Score 65+ = impulso institucional · 45–65 = neutral · bajo 45 = resistencia estructural.
          </span>
        </p>
      </div>

      {/* Top bar */}
      <div style={S.topBar}>
        <div style={S.topBarLeft}>
          <span style={S.title}>Inteligencia Institucional</span>
          <span style={S.pairBadge}>{pair}</span>
          {loading && <span style={{ fontSize: 9, color: '#6366f1' }}>● EN VIVO</span>}
        </div>
        <RelativeTime iso={lastUpdated} T={T} />
      </div>

      {/* Error state */}
      {error && !institutionalData && (
        <div style={S.errorBox}>
          <div style={{ color: T?.red ?? '#fca5a5', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {error.isCircuitOpen ? 'API Temporalmente No Disponible' : 'Error al Cargar Datos Institucionales'}
          </div>
          <div style={{ color: T?.sub ?? '#6b7280', fontSize: 10, marginBottom: 6 }}>
            {error.isCircuitOpen
              ? 'El circuit breaker se activó tras varios errores consecutivos. La API se reiniciará automáticamente en ~60 segundos, o pulsa Reintentar para forzar el reset ahora.'
              : error.message}
          </div>
          {error.code && error.code !== 'CIRCUIT_OPEN' && (
            <div style={{ color: T?.sub2 ?? '#475569', fontSize: 9, marginBottom: 8, fontFamily: 'monospace' }}>
              Código: {error.code}
            </div>
          )}
          <button
            onClick={retry}
            style={{
              fontSize: 10, padding: '4px 12px', borderRadius: 4,
              background: T?.card2 ?? '#1e293b', border: `1px solid ${T?.border ?? '#374151'}`,
              color: T?.sub ?? '#94a3b8', cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !institutionalData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={S.loadingShimmer(T)} />
          <div style={{ ...S.loadingShimmer(T), height: 120 }} />
        </div>
      )}

      {/* Main content */}
      {institutionalData && (
        <>
          {/* Composite score — full width */}
          <div style={{ marginBottom: 10 }}>
            <InstitutionalCompositeScore composite={institutionalData.composite} T={T} />
          </div>

          {/* Narrative */}
          {!compact && <NarrativePanel narrative={institutionalData.narrative} T={T} />}

          {/* Proxy info — shown when fundamentals are loaded */}
          {institutionalData.equityProxy && institutionalData.equityIntel && (
            <div style={{
              background: 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 6, padding: '8px 14px', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#6366f1', letterSpacing: '0.07em' }}>PROXY RENTA VARIABLE</span>
              <span style={{ fontSize: 10, color: T?.sub ?? '#94a3b8' }}>
                {pair} → <strong style={{ color: T?.txt ?? '#e2e8f0' }}>{institutionalData.equityProxy.ticker}</strong>{' '}
                ({institutionalData.equityProxy.label})
              </span>
            </div>
          )}

          {/* 2-column grid for sub-panels */}
          <div style={compact ? {} : S.grid}>
            <EquityIntelligencePanel
              equityIntel={institutionalData.equityIntel}
              equityProxy={institutionalData.equityProxy}
              T={T}
            />
            <EarningsMonitor earningsRegime={institutionalData.earningsRegime} T={T} />
            {!compact && (
              <BalanceSheetStressPanel stressEngine={institutionalData.stressEngine} T={T} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
