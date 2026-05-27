/**
 * OverviewSummaryStrip.jsx — Command-center summary bar for the Overview tab.
 *
 * Answers in one glance:
 *   - What regime are we in?
 *   - What is the conviction?
 *   - Are there any critical signals right now?
 *   - Where to go for the full analysis.
 *
 * Intentionally concise. Deep analysis belongs in Intelligence.
 */

import { useMemo } from 'react';
import TooltipInfo from './TooltipInfo.jsx';

const REGIME_COLORS = {
  RISK_ON_ACCELERATION: '#22c55e',
  RISK_ON:              '#4ade80',
  RISK_ON_EXHAUSTION:   '#f59e0b',
  RISK_OFF_EXTREME:     '#dc2626',
  RISK_OFF:             '#ef4444',
  STAGFLATION:          '#f97316',
  DISINFLATION:         '#60a5fa',
  LIQUIDITY_STRESS:     '#dc2626',
  TRANSITIONAL:         '#8491a8',
};

const PRIORITY_COLORS = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#8491a8',
};

function regimeColor(regime) {
  return REGIME_COLORS[regime] || '#8491a8';
}

export default function OverviewSummaryStrip({ adaptiveRegime, signalPriority, T, isMobile, onNavigate }) {
  const regime     = adaptiveRegime?.regime      || 'TRANSITIONAL';
  const conviction = adaptiveRegime?.conviction  || { level: 'low', score: 0 };
  const posture    = adaptiveRegime?.meta?.actionBias?.replace(/_/g, ' ') || null;
  const rColor     = regimeColor(regime);

  // Top 2 signals only — this is a summary strip, not the full briefing
  const topSignals = useMemo(() => {
    if (!signalPriority?.signals?.length) return [];
    return signalPriority.signals.slice(0, 2);
  }, [signalPriority]);

  const convLabel = conviction.level === 'high'   ? 'HIGH'
                  : conviction.level === 'medium' ? 'MED' : 'LOW';
  const convColor = conviction.level === 'high'   ? T.green
                  : conviction.level === 'medium' ? T.amber : T.sub;

  return (
    <div style={{
      maxWidth: 1400, margin: '0 auto',
      padding: isMobile ? '12px 12px 0' : '16px 20px 0',
    }}>
      <div style={{
        background: T.card,
        border: `1px solid ${rColor}33`,
        borderRadius: 10,
        padding: isMobile ? '14px' : '14px 18px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: isMobile ? 10 : 20,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
      }}>

        {/* ── Regime block ── */}
        <div style={{ flexShrink: 0, minWidth: isMobile ? '100%' : 220 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: T.sub, letterSpacing: '0.1em' }}>
              MARKET REGIME
            </span>
            <TooltipInfo text="The adaptive regime classifies the current macro environment across 9 states based on COT positioning, yield spreads, and VIX. It determines what strategies and position sizes are appropriate right now." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 14, fontWeight: 800, color: rColor, letterSpacing: '0.04em',
            }}>
              {regime.replace(/_/g, ' ')}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, color: convColor,
              background: convColor + '18', border: `1px solid ${convColor}33`,
              padding: '2px 7px', borderRadius: 99, letterSpacing: '0.06em',
            }}>
              {convLabel} CONVICTION
            </span>
          </div>
          {posture && (
            <div style={{ fontSize: 10, color: T.sub, marginTop: 4, letterSpacing: '0.02em' }}>
              Posture: <span style={{ color: T.txt, fontWeight: 600 }}>{posture}</span>
            </div>
          )}
        </div>

        {/* Divider */}
        {!isMobile && (
          <div style={{ width: 1, background: T.border, alignSelf: 'stretch', flexShrink: 0 }} />
        )}

        {/* ── Top signals ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: T.sub, letterSpacing: '0.1em' }}>
              TOP SIGNALS
            </span>
            <TooltipInfo text="The two highest-priority signals active right now. Critical (P1) signals require immediate attention. For the full ranked signal list, open the Intelligence tab." />
          </div>
          {topSignals.length === 0 ? (
            <p style={{ margin: 0, fontSize: 11, color: T.sub2 }}>No critical signals — conditions are within normal range.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {topSignals.map((s, i) => {
                const pc = PRIORITY_COLORS[s.priority] || T.sub;
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '7px 10px',
                    background: pc + '0a',
                    border: `1px solid ${pc}33`,
                    borderLeft: `3px solid ${pc}`,
                    borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 8, fontWeight: 800, color: pc, letterSpacing: '0.07em', flexShrink: 0, paddingTop: 2 }}>
                      {s.priority}
                    </span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: pc }}>{s.title}</div>
                      {s.detail && (
                        <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.45, marginTop: 1 }}>{s.detail}</div>
                      )}
                    </div>
                    {s.category && (
                      <span style={{
                        fontSize: 8, fontWeight: 600, color: T.sub2,
                        background: T.border, border: `1px solid ${T.border}`,
                        padding: '1px 5px', borderRadius: 99,
                        whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 'auto',
                      }}>
                        {s.category}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── CTA to Intelligence ── */}
        {!isMobile && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
            <button
              onClick={() => onNavigate?.('intelligence')}
              style={{
                padding: '8px 16px', borderRadius: 6,
                border: `1px solid ${T.accent}66`,
                background: T.accent + '12',
                color: T.accent, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
                letterSpacing: '0.03em',
              }}
            >
              Full Analysis →
            </button>
            <span style={{ fontSize: 9, color: T.sub2, textAlign: 'right' }}>Intelligence tab</span>
          </div>
        )}
      </div>

      {/* Mobile CTA */}
      {isMobile && onNavigate && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => onNavigate('intelligence')}
            style={{
              width: '100%', padding: '10px', borderRadius: 6,
              border: `1px solid ${T.accent}44`, background: T.accent + '10',
              color: T.accent, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            Open Intelligence for Full Analysis →
          </button>
        </div>
      )}
    </div>
  );
}
