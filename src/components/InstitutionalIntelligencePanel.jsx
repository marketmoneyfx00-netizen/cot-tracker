/**
 * InstitutionalIntelligencePanel.jsx
 */

import { useState } from 'react';
import { Label, Chip, ScoreBar, SignalList } from './ui/InstitutionalMicro';
import TooltipInfo from './TooltipInfo.jsx';

const SCORE_COLOR = (score, T) =>
  score >= 68 ? T.green : score >= 52 ? T.amber : score >= 36 ? T.orange : T.red;

const CONF_LABEL = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA', unavailable: 'N/D' };
const CONF_COLOR = (c, T) =>
  c === 'high' ? T.green : c === 'medium' ? T.amber : T.sub;

const RISK_COLOR = (level, T) =>
  level === 'LOW' ? T.green : level === 'MODERATE' ? T.amber : level === 'HIGH' ? T.orange : T.red;

function AgentCard({ title, subtitle, score, confidence, direction, signals, warnings, color, T, darkMode, isVeto, isRiskManager, riskLevel, tooltip }) {
  const [expanded, setExpanded] = useState(false);
  const isUnavailable = confidence === 'unavailable';
  const barColor = isUnavailable ? T.sub2 : (color || SCORE_COLOR(score, T));
  const showWarnings = warnings?.length > 0;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: darkMode ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
        border: `1px solid ${isVeto ? T.red + '55' : barColor + '33'}`,
        borderRadius: 8, padding: '12px 14px',
        cursor: 'pointer', transition: 'border-color 0.15s', userSelect: 'none',
        ...(isVeto ? { boxShadow: `0 0 0 1px ${T.red}33` } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Label T={T}>{title}</Label>
          {tooltip && <TooltipInfo text={tooltip} />}
          {subtitle && <span style={{ fontSize: 9, color: T.sub2, marginLeft: 4 }}>{subtitle}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {confidence && !isRiskManager && (
            <span style={{ fontSize: 9, color: CONF_COLOR(confidence, T), fontWeight: 700 }}>
              {CONF_LABEL[confidence] || confidence}
            </span>
          )}
          {direction && direction !== 'neutral' && !isUnavailable && (
            <Chip
              label={direction.toUpperCase()}
              color={direction === 'bull' || direction === 'LONG BIAS' ? T.green : T.red}
              T={T}
            />
          )}
        </div>
      </div>

      {isRiskManager ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.02em',
            color: isVeto ? T.red : T.green,
          }}>
            {isVeto ? 'VETO ACTIVO' : 'VETO INACTIVO'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Nivel de riesgo
            </span>
            <Chip label={riskLevel} color={RISK_COLOR(riskLevel, T)} T={T} />
          </div>
          <span style={{ fontSize: 9, color: T.sub2 }}>
            {warnings?.length ? `${warnings.length} condición${warnings.length > 1 ? 'es' : ''} de riesgo detectada${warnings.length > 1 ? 's' : ''}` : 'Sin condiciones de riesgo activas'}
          </span>
        </div>
      ) : isUnavailable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: T.sub2, letterSpacing: '-0.02em' }}>
            N/D
          </span>
          <span style={{ fontSize: 10, color: T.sub2 }}>Datos insuficientes</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: barColor, letterSpacing: '-0.02em' }}>
              {score ?? '—'}
            </span>
            <span style={{ fontSize: 9, color: T.sub, fontWeight: 700 }}>/100</span>
          </div>
          <ScoreBar score={score} color={barColor} T={T} />
        </>
      )}

      {showWarnings && !expanded && !isRiskManager && (
        <div style={{ marginTop: 7 }}>
          <span style={{ fontSize: 10, color: T.amber }}>
            ⚠ {warnings.length} factor{warnings.length > 1 ? 'es' : ''} de riesgo
          </span>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          {signals?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Label T={T}>Señales</Label>
              <div style={{ marginTop: 4 }}>
                <SignalList items={signals} color={barColor} T={T} />
              </div>
            </div>
          )}
          {warnings?.length > 0 && (
            <div>
              <Label T={T}>Factores de Riesgo</Label>
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

function EnvironmentBadge({ environment, envConfig, score, direction, T, validCount, totalCount }) {
  const color = envConfig?.color || T.sub;
  const unavailableCount = totalCount - validCount;
  const coveragePct = totalCount > 0 ? Math.round((validCount / totalCount) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
        border: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: color + '12', boxShadow: `0 0 20px ${color}22`,
      }}>
        <span style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace', color, lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontSize: 8, color: T.sub, letterSpacing: '0.08em', marginTop: 1 }}>PUNTUACIÓN</span>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {envConfig?.label || environment}
          </span>
          {direction && (
            <Chip
              label={direction}
              color={direction.includes('LONG') || direction.includes('LARGO') ? T.green : direction.includes('SHORT') || direction.includes('CORTO') ? T.red : T.sub}
            />
          )}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.5, maxWidth: 380, marginBottom: 6 }}>
          {envConfig?.desc || ''}
        </p>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 9, color: unavailableCount > 0 ? T.amber : T.sub2,
          background: unavailableCount > 0 ? `${T.amber}10` : 'transparent',
          border: unavailableCount > 0 ? `1px solid ${T.amber}33` : `1px solid ${T.border}`,
          padding: '2px 8px', borderRadius: 99, letterSpacing: '0.04em',
        }}>
          Cobertura de datos: {validCount}/{totalCount} agentes ({coveragePct}%)
          {unavailableCount > 0 && ` · ${unavailableCount} sin datos`}
        </div>
      </div>
    </div>
  );
}

export default function InstitutionalIntelligencePanel({ consensus, darkMode, T, isMobile }) {
  if (!consensus) {
    return (
      <div style={{
        maxWidth: 1100, margin: '0 auto', padding: isMobile ? '16px 12px' : '24px 20px',
        textAlign: 'center', color: T.sub, paddingTop: 60,
      }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Inicializando sistema de agentes...</div>
        <div style={{ fontSize: 12 }}>Cargando señales de mercado</div>
      </div>
    );
  }

  const { agents, consensus: con, environment, envConfig, probability, risk, conditions, summary } = consensus;

  const AGENT_DEFS = [
    {
      key: 'cot',
      title: 'Agente COT',
      subtitle: 'Posicionamiento CFTC',
      tooltip: 'Mide el posicionamiento neto de Leveraged Money (dinero inteligente) en futuros de divisas según los informes CFTC (Commitment of Traders). Score 68+ = sesgo alcista fuerte · 36–68 = zona intermedia · bajo 36 = sesgo bajista. Los datos se publican semanalmente con 3 días de retraso.',
      data: agents.cot,
      color: agents.cot?.direction === 'bull' ? T.green : agents.cot?.direction === 'bear' ? T.red : T.sub,
    },
    {
      key: 'macro',
      title: 'Agente Macro',
      subtitle: 'Spreads de Rendimiento / USD',
      tooltip: 'Analiza spreads de tipos de interés entre bancos centrales, política monetaria (hawkish/dovish) e impacto en divisas. Spreads positivos favorecen a la divisa base. La política del banco central es el motor macro más potente en FX a medio plazo.',
      data: agents.macro,
      color: agents.macro?.biasNum > 0 ? T.red : agents.macro?.biasNum < 0 ? T.green : T.sub,
    },
    {
      key: 'liquidity',
      title: 'Agente Liquidez',
      subtitle: 'Régimen / Condiciones',
      tooltip: 'Evalúa las condiciones de liquidez global y riesgo sistémico. AMPLE = liquidez abundante, favorable para riesgo. TIGHT = condiciones tensas, riesgo elevado. STRESSED = crisis potencial, reducir exposición. Incorpora spreads de crédito y condiciones financieras.',
      data: agents.liquidity,
      color: agents.liquidity?.condition === 'AMPLE' ? T.green
           : agents.liquidity?.condition === 'TIGHT' ? T.amber : T.red,
    },
    {
      key: 'intraday',
      title: 'Agente Ejecución',
      subtitle: 'Calidad Intradía',
      tooltip: 'Mide la calidad del timing intradía para buscar setups. Combina sesgo HTF, riesgo de eventos macro del calendario, Fear & Greed, VIX y sentimiento de sesión. No genera señales de entrada — es un filtro de permiso operativo. Score 70+ = momento favorable para buscar setups.',
      data: agents.intraday,
      color: agents.intraday?.quality === 'HIGH' ? T.green
           : agents.intraday?.quality === 'MEDIUM' ? T.amber
           : agents.intraday?.quality === 'LOW' ? T.orange : T.red,
    },
    {
      key: 'riskManager',
      title: 'Gestor de Riesgo',
      subtitle: 'AUTORIDAD DE VETO',
      tooltip: 'Tiene autoridad de veto sobre todos los demás agentes. Activa bloqueo cuando el riesgo sistémico es extremo, cuando hay varios agentes en conflicto severo, o cuando el riesgo de eventos macro supera el umbral. Con VETO ACTIVO: no buscar setups, proteger capital.',
      data: agents.riskManager,
      color: RISK_COLOR(risk.level, T),
      isVeto: risk.veto,
    },
  ];

  // Risk Manager has no score concept — count it as covered (it always evaluates).
  const validAgentCount = AGENT_DEFS.filter(
    ({ key, data }) => key === 'riskManager' || data?.confidence !== 'unavailable'
  ).length;

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto',
      padding: isMobile ? '12px 10px' : '24px 20px',
      fontFamily: "'Inter','SF Pro Text',Helvetica,sans-serif",
    }}>

      {/* ── CABECERA ── */}
      <div style={{
        background: T.card,
        border: `1px solid ${envConfig?.color || T.border}44`,
        borderRadius: 12, padding: isMobile ? '16px' : '20px 24px',
        marginBottom: 16,
        boxShadow: `0 0 0 1px ${(envConfig?.color || T.accent) + '15'}, 0 4px 24px rgba(0,0,0,0.15)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: envConfig?.color || T.accent,
              boxShadow: `0 0 8px ${envConfig?.color || T.accent}`,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.1em' }}>
              SISTEMA DE INTELIGENCIA INSTITUCIONAL
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Chip label={`RIESGO: ${risk.level}`} color={RISK_COLOR(risk.level, T)} />
            <span style={{ fontSize: 9, color: T.sub2 }}>
              {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })} UTC
            </span>
          </div>
        </div>

        <EnvironmentBadge
          environment={environment}
          envConfig={envConfig}
          score={con.score}
          direction={con.direction}
          T={T}
          validCount={validAgentCount}
          totalCount={AGENT_DEFS.length}
        />

        {risk.veto && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: T.red + '15', border: `1px solid ${T.red}44`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.red }}>
              ⛔ VETO DEL GESTOR DE RIESGO — {risk.vetoReason}
            </span>
          </div>
        )}

        <div style={{
          marginTop: 14, padding: '8px 12px',
          background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${T.border}`, borderRadius: 6,
        }}>
          <span style={{ fontSize: 11, color: T.sub, fontFamily: 'monospace', letterSpacing: '0.02em' }}>
            {summary}
          </span>
        </div>
      </div>

      {/* ── AGENTES ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <Label T={T}>Estado de Agentes</Label>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)',
          gap: 8,
        }}>
          {AGENT_DEFS.map(({ key, title, subtitle, tooltip, data, color, isVeto }) => (
            <AgentCard
              key={key}
              title={title}
              subtitle={subtitle}
              tooltip={tooltip}
              score={key === 'riskManager' ? undefined : data?.score}
              confidence={data?.confidence}
              direction={data?.direction || data?.condition}
              signals={data?.signals}
              warnings={data?.warnings}
              color={color}
              T={T}
              darkMode={darkMode}
              isVeto={isVeto}
              isRiskManager={key === 'riskManager'}
              riskLevel={risk.level}
            />
          ))}
        </div>
      </div>

      {/* ── PROBABILIDADES ── */}
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: isMobile ? '14px' : '18px 20px', marginBottom: 16,
      }}>
        <div style={{ marginBottom: 12 }}>
          <Label T={T}>Evaluación de Probabilidades</Label>
          <span style={{ fontSize: 9, color: T.sub2, marginLeft: 8 }}>
            (consenso ponderado de agentes · no es una garantía)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          {[
            { label: 'Continuación de Tendencia', value: probability.continuation, color: T.green },
            { label: 'Reversión a la Media',      value: probability.reversal,     color: T.red   },
            { label: 'Trampa Institucional',       value: probability.trap,         color: T.amber },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, minWidth: isMobile ? 'calc(50% - 4px)' : 0,
              background: color + '08', border: `1px solid ${color}33`,
              borderRadius: 8, padding: '12px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: T.sub, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                {label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color, letterSpacing: '-0.02em' }}>
                {value}%
              </div>
              <div style={{ marginTop: 4 }}>
                <ScoreBar score={value} color={color} T={T} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CONDICIONES ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 12, marginBottom: 16,
      }}>
        <div style={{
          background: T.card, border: `1px solid ${T.green}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        }}>
          <ConditionsList
            title="Condiciones Favorables"
            items={conditions.best}
            icon="✓"
            color={T.green}
            T={T}
          />
          {!conditions.best?.length && (
            <p style={{ margin: 0, fontSize: 12, color: T.sub }}>
              Datos insuficientes para determinar condiciones favorables.
            </p>
          )}
        </div>
        <div style={{
          background: T.card, border: `1px solid ${T.red}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        }}>
          <ConditionsList
            title="Evitar / Precaución"
            items={conditions.avoid}
            icon="⚠"
            color={T.amber}
            T={T}
          />
          {!conditions.avoid?.length && (
            <p style={{ margin: 0, fontSize: 12, color: T.sub }}>
              No hay condiciones específicas de precaución activas.
            </p>
          )}
        </div>
      </div>

      {/* ── FACTORES DE RIESGO ── */}
      {risk.factors?.length > 0 && (
        <div style={{
          background: T.card, border: `1px solid ${T.amber}33`,
          borderRadius: 12, padding: isMobile ? '14px' : '18px 20px', marginBottom: 16,
        }}>
          <div style={{ marginBottom: 10 }}>
            <Label T={T}>Factores de Riesgo Activos</Label>
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
                background: T.amber + '08', border: `1px solid ${T.amber}22`, borderRadius: 6,
              }}>
                <span style={{ color: T.amber, fontSize: 10, flexShrink: 0, marginTop: 1 }}>⚠</span>
                <span style={{ fontSize: 11, color: T.txt, lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PIE ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
        <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em' }}>
          COT TRACKER · INTELIGENCIA INSTITUCIONAL · CONSENSO DE 6 AGENTES
        </span>
        <span style={{ fontSize: 9, color: T.sub2 }}>
          Confianza: {CONF_LABEL[con.confidence] || con.confidence} · Agentes: {validAgentCount}/{AGENT_DEFS.length} activos
        </span>
      </div>
    </div>
  );
}
