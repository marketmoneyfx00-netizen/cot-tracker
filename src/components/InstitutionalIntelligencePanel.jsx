/**
 * InstitutionalIntelligencePanel.jsx
 *
 * Multi-agent decision system UI — Bloomberg Terminal meets institutional AI.
 * Displays real-time agent consensus, risk conditions, and probabilistic outlook.
 *
 * Props:
 *   consensus  — output of useAgentConsensus()
 *   darkMode   — boolean
 *   T          — theme tokens from buildTheme()
 *   isMobile   — boolean
 */

import { useState } from 'react';
import { Label, Chip, ScoreBar, SignalList } from './ui/InstitutionalMicro';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SCORE_COLOR = (score, T) =>
  score >= 68 ? T.green : score >= 52 ? T.amber : score >= 36 ? T.orange : T.red;

const CONF_LABEL = { high: 'HIGH', medium: 'MED', low: 'LOW', unavailable: 'N/A' };
const CONF_COLOR = (c, T) =>
  c === 'high' ? T.green : c === 'medium' ? T.amber : T.sub;

const RISK_COLOR = (level, T) =>
  level === 'LOW' ? T.green : level === 'MODERATE' ? T.amber : level === 'HIGH' ? T.orange : T.red;

// ─── AGENT CARD ───────────────────────────────────────────────────────────────

function AgentCard({ title, subtitle, score, confidence, direction, signals, warnings, color, T, darkMode, isVeto }) {
  const [expanded, setExpanded] = useState(false);
  const barColor = color || SCORE_COLOR(score, T);
  const showWarnings = warnings?.length > 0;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: darkMode ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
        border: `1px solid ${isVeto ? T.red + '55' : barColor + '33'}`,
        borderRadius: 8,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        userSelect: 'none',
        ...(isVeto ? { boxShadow: `0 0 0 1px ${T.red}33` } : {}),
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <Label T={T}>{title}</Label>
          {subtitle && (
            <span style={{ fontSize: 9, color: T.sub2, marginLeft: 6 }}>{subtitle}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {confidence && (
            <span style={{ fontSize: 9, color: CONF_COLOR(confidence, T), fontWeight: 700 }}>
              {CONF_LABEL[confidence] || confidence}
            </span>
          )}
          {direction && direction !== 'neutral' && (
            <Chip
              label={direction.toUpperCase()}
              color={direction === 'bull' || direction === 'LONG BIAS' ? T.green : T.red}
              T={T}
            />
          )}
        </div>
      </div>

      {/* Score */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
        <span style={{
          fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
          color: barColor, letterSpacing: '-0.02em',
        }}>
          {score ?? '—'}
        </span>
        <span style={{ fontSize: 9, color: T.sub, fontWeight: 700 }}>/100</span>
        {isVeto && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: T.red,
            background: T.red + '18', border: `1px solid ${T.red}44`,
            padding: '1px 7px', borderRadius: 99, marginLeft: 8,
          }}>
            VETO ACTIVE
          </span>
        )}
      </div>
      <ScoreBar score={score} color={barColor} T={T} />

      {/* Warning pill */}
      {showWarnings && !expanded && (
        <div style={{ marginTop: 7 }}>
          <span style={{ fontSize: 10, color: T.amber }}>
            ⚠ {warnings.length} risk factor{warnings.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          {signals?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Label T={T}>Signals</Label>
              <div style={{ marginTop: 4 }}>
                <SignalList items={signals} color={barColor} T={T} />
              </div>
            </div>
          )}
          {warnings?.length > 0 && (
            <div>
              <Label T={T}>Risk Factors</Label>
              <div style={{ marginTop: 4 }}>
                <SignalList items={warnings} color={T.amber} T={T} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CONDITIONS SECTION ──────────────────────────────────────────────────────

function ConditionsList({ title, items, icon, color, T }) {
  if (!items?.length) return null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 11 }}>{icon}</span>
        <Label T={T}>{title}</Label>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 12, color: T.txt, lineHeight: 1.6,
            paddingBottom: 5, opacity: 0.9,
          }}>
            <span style={{ color, flexShrink: 0, marginTop: 3, fontSize: 9 }}>●</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── ENVIRONMENT BADGE ───────────────────────────────────────────────────────

function EnvironmentBadge({ environment, envConfig, score, direction, T }) {
  const color = envConfig?.color || T.sub;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      flexWrap: 'wrap',
    }}>
      {/* Big score circle */}
      <div style={{
        width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
        border: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: color + '12',
        boxShadow: `0 0 20px ${color}22`,
      }}>
        <span style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace', color, lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontSize: 8, color: T.sub, letterSpacing: '0.08em', marginTop: 1 }}>SCORE</span>
      </div>

      {/* Labels */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 13, fontWeight: 800, color,
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {envConfig?.label || environment}
          </span>
          {direction && (
            <Chip
              label={direction}
              color={direction.includes('LONG') ? T.green : direction.includes('SHORT') ? T.red : T.sub}
            />
          )}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.5, maxWidth: 380 }}>
          {envConfig?.desc || ''}
        </p>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function InstitutionalIntelligencePanel({ consensus, darkMode, T, isMobile }) {
  if (!consensus) {
    return (
      <div style={{
        maxWidth: 1100, margin: '0 auto', padding: isMobile ? '16px 12px' : '24px 20px',
        textAlign: 'center', color: T.sub, paddingTop: 60,
      }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Initializing agent system...</div>
        <div style={{ fontSize: 12 }}>Loading market signals</div>
      </div>
    );
  }

  const { agents, consensus: con, environment, envConfig, probability, risk, conditions, summary } = consensus;

  const AGENT_DEFS = [
    {
      key: 'cot',
      title: 'COT Agent',
      subtitle: 'CFTC Positioning',
      data: agents.cot,
      color: agents.cot?.direction === 'bull' ? T.green : agents.cot?.direction === 'bear' ? T.red : T.sub,
    },
    {
      key: 'macro',
      title: 'Macro Agent',
      subtitle: 'Yield Spreads / USD',
      data: agents.macro,
      color: agents.macro?.biasNum > 0 ? T.red : agents.macro?.biasNum < 0 ? T.green : T.sub,
    },
    {
      key: 'liquidity',
      title: 'Liquidity Agent',
      subtitle: 'Regime / Conditions',
      data: agents.liquidity,
      color: agents.liquidity?.condition === 'AMPLE' ? T.green
           : agents.liquidity?.condition === 'TIGHT' ? T.amber : T.red,
    },
    {
      key: 'intraday',
      title: 'Execution Agent',
      subtitle: 'Intraday Quality',
      data: agents.intraday,
      color: agents.intraday?.quality === 'HIGH' ? T.green
           : agents.intraday?.quality === 'MEDIUM' ? T.amber
           : agents.intraday?.quality === 'LOW' ? T.orange : T.red,
    },
    {
      key: 'cryptoFlow',
      title: 'Crypto Flow',
      subtitle: 'BTC / Risk Regime',
      data: agents.cryptoFlow,
      color: agents.cryptoFlow?.cryptoRegime === 'RISK_ON' ? T.green
           : agents.cryptoFlow?.cryptoRegime === 'RISK_OFF' ? T.red : T.amber,
    },
    {
      key: 'riskManager',
      title: 'Risk Manager',
      subtitle: 'VETO AUTHORITY',
      data: agents.riskManager,
      color: RISK_COLOR(risk.level, T),
      isVeto: risk.veto,
    },
  ];

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto',
      padding: isMobile ? '12px 10px' : '24px 20px',
      fontFamily: "'Inter','SF Pro Text',Helvetica,sans-serif",
    }}>

      {/* ── HEADER ── */}
      <div style={{
        background: T.card,
        border: `1px solid ${envConfig?.color || T.border}44`,
        borderRadius: 12,
        padding: isMobile ? '16px' : '20px 24px',
        marginBottom: 16,
        boxShadow: `0 0 0 1px ${(envConfig?.color || T.accent) + '15'}, 0 4px 24px rgba(0,0,0,0.15)`,
      }}>
        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: envConfig?.color || T.accent,
              boxShadow: `0 0 8px ${envConfig?.color || T.accent}`,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.1em' }}>
              INSTITUTIONAL INTELLIGENCE SYSTEM
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Chip
              label={`RISK: ${risk.level}`}
              color={RISK_COLOR(risk.level, T)}
            />
            <span style={{ fontSize: 9, color: T.sub2 }}>
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} UTC
            </span>
          </div>
        </div>

        {/* Environment */}
        <EnvironmentBadge
          environment={environment}
          envConfig={envConfig}
          score={con.score}
          direction={con.direction}
          T={T}
        />

        {/* Veto banner */}
        {risk.veto && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: T.red + '15', border: `1px solid ${T.red}44`,
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.red }}>
              ⛔ RISK MANAGER VETO — {risk.vetoReason}
            </span>
          </div>
        )}

        {/* Summary */}
        <div style={{
          marginTop: 14, padding: '8px 12px',
          background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${T.border}`,
          borderRadius: 6,
        }}>
          <span style={{ fontSize: 11, color: T.sub, fontFamily: 'monospace', letterSpacing: '0.02em' }}>
            {summary}
          </span>
        </div>
      </div>

      {/* ── AGENT GRID ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <Label T={T}>Agent Status</Label>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)',
          gap: 8,
        }}>
          {AGENT_DEFS.map(({ key, title, subtitle, data, color, isVeto }) => (
            <AgentCard
              key={key}
              title={title}
              subtitle={subtitle}
              score={data?.score ?? 50}
              confidence={data?.confidence}
              direction={data?.direction || data?.cryptoRegime || data?.condition}
              signals={data?.signals}
              warnings={data?.warnings}
              color={color}
              T={T}
              darkMode={darkMode}
              isVeto={isVeto}
            />
          ))}
        </div>
      </div>

      {/* ── PROBABILITY ROW ── */}
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        marginBottom: 16,
      }}>
        <div style={{ marginBottom: 12 }}>
          <Label T={T}>Probability Assessment</Label>
          <span style={{ fontSize: 9, color: T.sub2, marginLeft: 8 }}>
            (weighted agent consensus · not a guarantee)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          {[
            { label: 'Trend Continuation', value: probability.continuation, color: T.green },
            { label: 'Mean Reversion',     value: probability.reversal,     color: T.red   },
            { label: 'Institutional Trap', value: probability.trap,         color: T.amber },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, minWidth: isMobile ? 'calc(50% - 4px)' : 0,
              background: color + '08',
              border: `1px solid ${color}33`,
              borderRadius: 8, padding: '12px', textAlign: 'center',
            }}>
              <div style={{
                fontSize: 9, color: T.sub, letterSpacing: '0.08em',
                textTransform: 'uppercase', marginBottom: 6,
              }}>
                {label}
              </div>
              <div style={{
                fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
                color, letterSpacing: '-0.02em',
              }}>
                {value}%
              </div>
              <div style={{ marginTop: 4 }}>
                <ScoreBar score={value} color={color} T={T} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CONDITIONS ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 12,
        marginBottom: 16,
      }}>
        {/* Best conditions */}
        <div style={{
          background: T.card, border: `1px solid ${T.green}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        }}>
          <ConditionsList
            title="Favorable Conditions"
            items={conditions.best}
            icon="✓"
            color={T.green}
            T={T}
          />
          {!conditions.best?.length && (
            <p style={{ margin: 0, fontSize: 12, color: T.sub }}>
              Insufficient data to determine favorable conditions.
            </p>
          )}
        </div>

        {/* Avoid conditions */}
        <div style={{
          background: T.card, border: `1px solid ${T.red}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        }}>
          <ConditionsList
            title="Avoid / Caution"
            items={conditions.avoid}
            icon="⚠"
            color={T.amber}
            T={T}
          />
          {!conditions.avoid?.length && (
            <p style={{ margin: 0, fontSize: 12, color: T.sub }}>
              No specific avoidance conditions flagged.
            </p>
          )}
        </div>
      </div>

      {/* ── RISK FACTORS ── */}
      {risk.factors?.length > 0 && (
        <div style={{
          background: T.card, border: `1px solid ${T.amber}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
          marginBottom: 16,
        }}>
          <div style={{ marginBottom: 10 }}>
            <Label T={T}>Active Risk Factors</Label>
            <Chip label={risk.level} color={RISK_COLOR(risk.level, T)} style={{ marginLeft: 8 }} />
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: 6,
          }}>
            {risk.factors.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 10px',
                background: T.amber + '08',
                border: `1px solid ${T.amber}22`,
                borderRadius: 6,
              }}>
                <span style={{ color: T.amber, fontSize: 10, flexShrink: 0, marginTop: 1 }}>⚠</span>
                <span style={{ fontSize: 11, color: T.txt, lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
        <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em' }}>
          COT TRACKER · INSTITUTIONAL INTELLIGENCE · 6-AGENT CONSENSUS
        </span>
        <span style={{ fontSize: 9, color: T.sub2 }}>
          Confidence: {CONF_LABEL[con.confidence] || con.confidence} · Agents: 6/6 active
        </span>
      </div>
    </div>
  );
}
