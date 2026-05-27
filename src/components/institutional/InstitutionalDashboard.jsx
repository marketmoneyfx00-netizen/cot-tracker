// =============================================================================
// InstitutionalDashboard — Bloomberg/Koyfin-style institutional intelligence
//
// Displays the full Financial Datasets institutional layer for the selected pair.
// Props:
//   pair          {string}   — selected FX pair (e.g. "EUR/USD")
//   cotBiasScore  {number}   — from cotBiasEngine
//   macroSignal   {object}   — from useMacroSignal
//   compact       {boolean}  — minimal mode (sidebar)
// =============================================================================

import { useInstitutionalData }        from '../../hooks/useInstitutionalData.js';
import InstitutionalCompositeScore     from './InstitutionalCompositeScore.jsx';
import EquityIntelligencePanel         from './EquityIntelligencePanel.jsx';
import EarningsMonitor                 from './EarningsMonitor.jsx';
import CryptoMacroPanel                from './CryptoMacroPanel.jsx';
import BalanceSheetStressPanel         from './BalanceSheetStressPanel.jsx';
import TooltipInfo                     from '../TooltipInfo.jsx';

const S = {
  root: {
    background: '#080e1a',
    minHeight: 400,
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 14,
  },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { fontSize: 11, fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em' },
  pairBadge: {
    fontSize: 11, color: '#94a3b8', background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.08)',
    padding: '2px 8px', borderRadius: 4,
  },
  freshness: { fontSize: 10, color: '#374151' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  errorBox: {
    background: '#1c0a0a', border: '1px solid #7f1d1d',
    borderRadius: 8, padding: 14, textAlign: 'center',
  },
  narrativeBox: {
    background: '#0f1729',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 10,
  },
  narrativeTitle: { fontSize: 9, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 },
  narrativeText: { fontSize: 11, color: '#94a3b8', lineHeight: 1.6 },
  divTag: (label, color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 7px', borderRadius: 4, marginRight: 4, marginBottom: 3,
    background: `${color}15`, border: `1px solid ${color}33`,
    fontSize: 9, fontWeight: 600, color, letterSpacing: '0.05em',
  }),
  loadingShimmer: {
    height: 200, background: 'linear-gradient(90deg, #0f172a 25%, #1e293b 50%, #0f172a 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
    borderRadius: 8,
  },
};

function RelativeTime({ iso }) {
  if (!iso) return null;
  const d = new Date(iso);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <span style={S.freshness}>Updated {timeStr}</span>;
}

function NarrativePanel({ narrative }) {
  if (!narrative?.primaryNarrative) return null;

  const { primaryNarrative, divergences, positioningSummary } = narrative;

  return (
    <div style={S.narrativeBox}>
      <div style={S.narrativeTitle}>Institutional Narrative</div>
      <p style={S.narrativeText}>{primaryNarrative}</p>

      {divergences?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Divergences Detected ({divergences.length})
          </div>
          {divergences.slice(0, 2).map((d, i) => (
            <div key={i} style={{
              padding: '5px 8px', background: '#1c0a0a',
              border: '1px solid #7f1d1d33', borderRadius: 4, marginBottom: 3,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#fca5a5' }}>{d.description}</div>
              <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>{d.implication}</div>
            </div>
          ))}
        </div>
      )}

      {positioningSummary?.signals?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Signal Alignment
          </div>
          <div>
            {positioningSummary.signals.map((sig, i) => (
              <span key={i} style={S.divTag(sig.label, sig.color)}>
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
  const { institutionalData, loading, error, lastUpdated, retry } = useInstitutionalData({
    pair,
    cotBiasScore,
    macroSignal,
    enabled: !!pair,
  });

  if (!pair) {
    return (
      <div style={{ ...S.root, padding: '20px 0', textAlign: 'center', color: '#374151', fontSize: 11 }}>
        Select a pair to view institutional intelligence
      </div>
    );
  }

  return (
    <div style={S.root}>
      {/* Purpose statement */}
      <div style={{
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: 8, padding: '10px 14px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', letterSpacing: '0.1em' }}>
            INSTITUTIONAL PANEL
          </span>
          <TooltipInfo text="This panel layers equity fundamentals, earnings regime, crypto macro flows, and balance-sheet stress onto your COT analysis. It answers: are institutional actors fundamentally aligned with the current positioning bias? A high score (65+) means broad institutional tailwinds. A low score (below 45) signals structural headwinds or uncertainty." />
        </div>
        <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.55 }}>
          Combines equity fundamentals, earnings regime, crypto macro flows, and balance-sheet stress to produce
          a single institutional conviction score for the selected pair.
          <span style={{ color: '#6366f1', marginLeft: 4 }}>
            Score 65+ = institutional tailwind · 45–65 = neutral · below 45 = structural headwind.
          </span>
        </p>
      </div>

      {/* Top bar */}
      <div style={S.topBar}>
        <div style={S.topBarLeft}>
          <span style={S.title}>Institutional Intelligence</span>
          <span style={S.pairBadge}>{pair}</span>
          {loading && <span style={{ fontSize: 9, color: '#6366f1' }}>● LIVE</span>}
        </div>
        <RelativeTime iso={lastUpdated} />
      </div>

      {/* Error state */}
      {error && !institutionalData && (
        <div style={S.errorBox}>
          <div style={{ color: '#fca5a5', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {error.isCircuitOpen ? 'API Temporarily Unavailable' : 'Data Load Failed'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 8 }}>{error.message}</div>
          <button
            onClick={retry}
            style={{
              fontSize: 10, padding: '4px 12px', borderRadius: 4,
              background: '#1e293b', border: '1px solid #374151',
              color: '#94a3b8', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !institutionalData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={S.loadingShimmer} />
          <div style={{ ...S.loadingShimmer, height: 120 }} />
        </div>
      )}

      {/* Main content */}
      {institutionalData && (
        <>
          {/* Composite score — full width */}
          <div style={{ marginBottom: 10 }}>
            <InstitutionalCompositeScore composite={institutionalData.composite} />
          </div>

          {/* Narrative */}
          {!compact && <NarrativePanel narrative={institutionalData.narrative} />}

          {/* 2-column grid for sub-panels */}
          <div style={compact ? {} : S.grid}>
            <EquityIntelligencePanel
              equityIntel={institutionalData.equityIntel}
              equityProxy={institutionalData.equityProxy}
            />
            <EarningsMonitor earningsRegime={institutionalData.earningsRegime} />
            {!compact && (
              <>
                <CryptoMacroPanel cryptoLayer={institutionalData.cryptoLayer} />
                <BalanceSheetStressPanel stressEngine={institutionalData.stressEngine} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
