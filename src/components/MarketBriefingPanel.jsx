/**
 * MarketBriefingPanel.jsx — Institutional Daily Market Briefing
 *
 * Surfaces ONLY the highest-priority signals. Suppresses noise.
 * Answers the trader's core question: "What matters right now?"
 *
 * Design: compact, readable, actionable. Never overwhelming.
 *
 * Props:
 *   priority  — output of computeSignalPriority()
 *   T         — theme tokens
 *   isMobile  — boolean
 *   darkMode  — boolean
 */

import { useState } from 'react';
import { Label } from './ui/InstitutionalMicro';

const PRIORITY_META = {
  P1: { label: 'CRITICAL', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)' },
  P2: { label: 'HIGH',     color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)' },
  P3: { label: 'MODERATE', color: '#8491a8', bg: 'rgba(132,145,168,0.06)', border: 'rgba(132,145,168,0.2)' },
  P4: { label: 'LOW',      color: '#4a5568', bg: 'rgba(74,85,104,0.05)',   border: 'rgba(74,85,104,0.15)' },
};

function SignalCard({ signal, T }) {
  const pm = PRIORITY_META[signal.priority] || PRIORITY_META.P3;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px',
      background: pm.bg,
      border: `1px solid ${pm.border}`,
      borderLeft: `3px solid ${signal.color}`,
      borderRadius: 6,
    }}>
      {/* Priority tag */}
      <div style={{ flexShrink: 0, paddingTop: 1 }}>
        <span style={{
          fontSize: 8, fontWeight: 800, color: pm.color,
          letterSpacing: '0.08em',
        }}>
          {pm.label}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: signal.color }}>
            {signal.title}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
            color: T.sub2, background: T.card2 || 'rgba(255,255,255,0.05)',
            border: `1px solid ${T.border}`,
            padding: '1px 6px', borderRadius: 99,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {signal.category}
          </span>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: T.sub, lineHeight: 1.55 }}>
          {signal.detail}
        </p>
        {signal.action && (
          <div style={{ marginTop: 4 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: signal.color,
              letterSpacing: '0.07em',
            }}>
              → {signal.action}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketBriefingPanel({ priority, T, darkMode }) {
  const [showAll, setShowAll] = useState(false);

  if (!priority?.hasData) return null;

  const { signals, briefing, criticalCount } = priority;
  const visibleSignals = showAll ? signals : signals.slice(0, 5);
  const hasCritical    = criticalCount > 0;

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${hasCritical ? '#ef444433' : T.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: "'Inter','SF Pro Text',Helvetica,sans-serif",
      boxShadow: hasCritical ? '0 0 0 1px #ef444412' : 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${T.border}`,
        background: hasCritical ? '#ef444408' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: hasCritical ? '#ef4444' : T.accent,
            boxShadow: hasCritical ? '0 0 6px #ef4444' : 'none',
          }} />
          <Label T={T}>Market Briefing</Label>
          {hasCritical && (
            <span style={{
              fontSize: 9, fontWeight: 800, color: '#ef4444',
              background: '#ef444415', border: '1px solid #ef444433',
              padding: '1px 7px', borderRadius: 99,
            }}>
              {criticalCount} CRITICAL
            </span>
          )}
        </div>
        <span style={{ fontSize: 9, color: T.sub2 }}>
          {signals.length} signal{signals.length !== 1 ? 's' : ''} ranked
        </span>
      </div>

      {/* Briefing text */}
      {briefing?.length > 0 && (
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
        }}>
          <div style={{ marginBottom: 6 }}>
            <Label T={T}>Institutional Summary</Label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {briefing.map((line, i) => (
              <p key={i} style={{
                margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.65,
                paddingLeft: 10,
                borderLeft: `2px solid ${i === 0 ? T.accent : T.border}`,
              }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Priority signals */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleSignals.map(signal => (
          <SignalCard key={signal.id} signal={signal} T={T} />
        ))}

        {signals.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: T.sub, fontSize: 12 }}>
            Awaiting data — upload COT file and allow macro signals to load.
          </div>
        )}
      </div>

      {/* Toggle */}
      {signals.length > 5 && (
        <div style={{
          padding: '8px 16px',
          borderTop: `1px solid ${T.border}`,
        }}>
          <button
            onClick={() => setShowAll(s => !s)}
            style={{
              fontSize: 10, color: T.accent, background: 'none',
              border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0,
            }}
          >
            {showAll
              ? '↑ Show top 5 signals only'
              : `↓ Show all ${signals.length} signals (${signals.length - 5} more)`}
          </button>
        </div>
      )}
    </div>
  );
}
