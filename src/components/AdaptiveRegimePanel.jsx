/**
 * AdaptiveRegimePanel.jsx — Institutional Adaptive Regime + Intermarket Display
 *
 * Shows:
 *   1. Adaptive regime badge (9-state taxonomy)
 *   2. Regime conviction + momentum
 *   3. Transition risk warning
 *   4. Intermarket correlation grid
 *   5. Key divergence / breakdown signals
 *
 * Props:
 *   adaptiveRegime   — from computeAdaptiveRegime()
 *   intermarket      — from computeIntermarketSignals()
 *   darkMode         — boolean
 *   T                — theme tokens
 *   isMobile         — boolean
 */

import { useState } from 'react';
import { Label, Dot } from './ui/InstitutionalMicro';
import TooltipInfo from './TooltipInfo.jsx';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const DIR_ARROW = { bullish: '↑', bearish: '↓', neutral: '→' };
const DIR_COLOR = (dir, T) =>
  dir === 'bullish' ? T.green : dir === 'bearish' ? T.red : T.sub;

// ─── CONVICTION BAR ───────────────────────────────────────────────────────────

function ConvictionBar({ conviction, T }) {
  const color = conviction.level === 'high' ? T.green
              : conviction.level === 'medium' ? T.amber : T.sub;
  const width = (conviction.score / 10) * 100;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Label T={T}>Convicción</Label>
          <TooltipInfo text="Escala 0–10 que refleja la cohesión entre agentes. 8–10 = señales muy alineadas, alta confianza. 5–7 = alineación parcial, proceder con cautela. Bajo 5 = señales mixtas, no operar." />
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: '0.06em' }}>
          {conviction.level.toUpperCase()} ({conviction.score}/10)
        </span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ─── MOMENTUM BADGE ───────────────────────────────────────────────────────────

function MomentumBadge({ momentum, T }) {
  const cfg = {
    accelerating: { color: T.green,  icon: '▲', label: 'ACELERANDO'   },
    decelerating: { color: T.orange, icon: '▼', label: 'DESACELERANDO' },
    stable:       { color: T.sub,    icon: '→', label: 'ESTABLE'       },
  }[momentum.direction] || { color: T.sub, icon: '—', label: 'NEUTRAL' };

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 700, color: cfg.color,
      background: cfg.color + '15',
      border: `1px solid ${cfg.color}33`,
      padding: '3px 10px', borderRadius: 99,
    }}>
      <span style={{ fontSize: 9 }}>{cfg.icon}</span>
      {cfg.label}
    </div>
  );
}

// ─── INTERMARKET SIGNAL ROW ───────────────────────────────────────────────────

function IntermarketRow({ signal, T, expanded }) {
  const dirAArrow  = DIR_ARROW[signal.assetA.direction] || '?';
  const dirBArrow  = DIR_ARROW[signal.assetB.direction] || '?';
  const dirAColor  = signal.assetA.direction ? DIR_COLOR(signal.assetA.direction, T) : T.sub;
  const dirBColor  = signal.assetB.direction ? DIR_COLOR(signal.assetB.direction, T) : T.sub;

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: `1px solid ${T.border}`,
      background: signal.status === 'BREAKDOWN' ? T.red + '06'
                : signal.status === 'DIVERGING'  ? T.amber + '06' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status icon */}
        <span style={{ fontSize: 12, color: signal.color, flexShrink: 0 }}>{signal.icon}</span>

        {/* Asset pair */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.txt }}>{signal.description}</span>
            <span style={{
              fontSize: 8, fontWeight: 700, color: signal.color,
              background: signal.color + '18', border: `1px solid ${signal.color}33`,
              padding: '1px 6px', borderRadius: 99, letterSpacing: '0.06em',
            }}>
              {signal.statusLabel}
            </span>
          </div>
          {expanded && signal.hasData && (
            <div style={{ fontSize: 10, color: T.sub, marginTop: 2, lineHeight: 1.5 }}>
              {signal.insight}
            </div>
          )}
        </div>

        {/* Direction arrows */}
        {signal.hasData ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: dirAColor, fontFamily: 'monospace' }}>
              {dirAArrow}
            </span>
            <span style={{ fontSize: 9, color: T.sub2 }}>{signal.correlation === 'inverse' ? '≠' : '='}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: dirBColor, fontFamily: 'monospace' }}>
              {dirBArrow}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 9, color: T.sub2, flexShrink: 0 }}>Sin datos</span>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function AdaptiveRegimePanel({
  adaptiveRegime,
  intermarket,
  T,
  isMobile,
}) {
  const [imExpanded, setImExpanded] = useState(false);

  if (!adaptiveRegime || !intermarket) return null;

  const { meta, conviction, momentum, exhaustion, transition, adaptiveDrivers } = adaptiveRegime;
  const { signals, health, keyDivergences } = intermarket;

  const hasDivergences = keyDivergences.length > 0;
  const hasTransitionRisk = transition.isPending;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 12,
      fontFamily: "'Inter','SF Pro Text',Helvetica,sans-serif",
    }}>

      {/* ── LEFT: ADAPTIVE REGIME ── */}
      <div style={{
        background: T.card,
        border: `1px solid ${meta.color}44`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: `0 0 0 1px ${meta.color}12`,
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: meta.color + '0a',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Dot color={meta.color} pulse={meta.intensity === 'extreme'} />
              <Label T={T}>Régimen Adaptativo</Label>
            </div>
            <MomentumBadge momentum={momentum} T={T} />
          </div>

          {/* Regime name */}
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontSize: 16, fontWeight: 800, color: meta.color,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              {meta.label}
            </div>
            <div style={{ fontSize: 11, color: T.sub, marginTop: 4, lineHeight: 1.5, maxWidth: 340 }}>
              {meta.desc}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Conviction */}
          <ConvictionBar conviction={conviction} T={T} />

          {/* Action bias */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Label T={T}>Postura Recomendada</Label>
              <TooltipInfo text="Orientación operativa derivada del régimen actual. AGRESIVO: contexto muy favorable, buscar setups activamente. MODERADO: contexto parcial, reducir tamaño. DEFENSIVO: evitar nuevas posiciones. NEUTRAL: esperar confirmación." />
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: meta.color,
              background: meta.color + '15', border: `1px solid ${meta.color}33`,
              padding: '2px 10px', borderRadius: 99, letterSpacing: '0.06em',
            }}>
              {meta.actionBias.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Exhaustion warning */}
          {exhaustion.isExhausted && (
            <div style={{
              padding: '8px 10px',
              background: T.amber + '12',
              border: `1px solid ${T.amber}33`,
              borderRadius: 6,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.amber, marginBottom: 3 }}>
                ⚠ Agotamiento de Posicionamiento Detectado
              </div>
              {exhaustion.extremePairs.slice(0, 2).map((p, i) => (
                <div key={i} style={{ fontSize: 10, color: T.sub }}>
                  {p.pair} — {p.direction} ({p.percentile?.toFixed(0)}th percentile)
                </div>
              ))}
            </div>
          )}

          {/* Transition risk */}
          {hasTransitionRisk && (
            <div style={{
              padding: '8px 10px',
              background: T.orange + '10',
              border: `1px solid ${T.orange}33`,
              borderRadius: 6,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.orange, marginBottom: 3 }}>
                🔄 Riesgo de Transición de Régimen: {transition.transitionRisk.toUpperCase()}
              </div>
              {transition.signals.slice(0, 2).map((s, i) => (
                <div key={i} style={{ fontSize: 10, color: T.sub, marginBottom: 2 }}>• {s}</div>
              ))}
            </div>
          )}

          {/* Adaptive drivers */}
          {adaptiveDrivers.length > 0 && (
            <div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Label T={T}>Factores Clave Institucionales</Label>
                <TooltipInfo text="Drivers identificados por los agentes que explican el régimen actual. Origen: posicionamiento COT, spreads de tipos y condiciones de liquidez. Interpretar como contexto de fondo, no como señales de entrada directas." />
              </span>
              <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {adaptiveDrivers.map((d, i) => (
                  <li key={i} style={{
                    fontSize: 11, color: T.sub, lineHeight: 1.5,
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                  }}>
                    <span style={{ color: meta.color, fontSize: 8, marginTop: 3, flexShrink: 0 }}>◆</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: INTERMARKET CORRELATION ── */}
      <div style={{
        background: T.card,
        border: `1px solid ${health.color}44`,
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: health.color + '08',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Dot color={health.color} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Label T={T}>Correlación Intermercado</Label>
              <TooltipInfo text="Mide la coherencia entre activos correlacionados (renta variable, bonos, USD, oro). ALINEADOS: todos apuntan en la misma dirección — señal más fiable. DIVERGENTES: señales mixtas — precaución. RUPTURA: correlación histórica rota — alto riesgo, evitar operar." />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: health.color,
              background: health.color + '18', border: `1px solid ${health.color}33`,
              padding: '2px 8px', borderRadius: 99, letterSpacing: '0.06em',
            }}>
              {health.label}
            </span>
            <span style={{ fontSize: 9, color: T.sub2 }}>{health.score}/100</span>
          </div>
        </div>

        {/* Stats row */}
        {intermarket.hasData && (
          <div style={{
            display: 'flex', gap: 0,
            borderBottom: `1px solid ${T.border}`,
          }}>
            {[
              { label: 'Alineados',  value: health.aligned   ?? 0, color: T.green  },
              { label: 'Divergentes', value: health.diverging ?? 0, color: T.amber  },
              { label: 'Ruptura',   value: health.breakdowns ?? 0, color: T.red    },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1, padding: '8px 0', textAlign: 'center',
                borderRight: label !== 'Breakdown' ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color }}>
                  {value}
                </div>
                <div style={{ fontSize: 8, color: T.sub, letterSpacing: '0.08em', marginTop: 1 }}>
                  {label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Signal rows */}
        <div
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setImExpanded(e => !e)}
        >
          {signals.slice(0, imExpanded ? signals.length : 5).map(signal => (
            <IntermarketRow
              key={signal.id}
              signal={signal}
              T={T}
              expanded={imExpanded}
            />
          ))}
        </div>

        {/* Toggle */}
        <div style={{
          padding: '8px 12px',
          borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button
            onClick={() => setImExpanded(e => !e)}
            style={{
              fontSize: 10, color: T.accent, background: 'none',
              border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0,
            }}
          >
            {imExpanded ? '↑ Mostrar menos' : `↓ Ver todos los ${signals.length} pares + análisis`}
          </button>
          {hasDivergences && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: T.amber,
              background: T.amber + '15', border: `1px solid ${T.amber}33`,
              padding: '2px 8px', borderRadius: 99,
            }}>
              {keyDivergences.length} DIVERGENCIA{keyDivergences.length > 1 ? 'S' : ''}
            </span>
          )}
        </div>

        {/* Key divergence callouts */}
        {hasDivergences && imExpanded && (
          <div style={{
            padding: '10px 14px',
            borderTop: `1px solid ${T.border}`,
            background: T.amber + '06',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Label T={T}>Señales de Divergencia Clave</Label>
              <TooltipInfo text="Divergencias detectadas entre activos correlacionados. Indican que la relación histórica se ha roto: por ejemplo, renta variable sube pero USD también sube (relación inversa normal). Las divergencias suelen preceder a reversiones o cambios de régimen. Cuantas más divergencias, mayor la incertidumbre." />
            </span>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {keyDivergences.slice(0, 3).map((d, i) => (
                <div key={i} style={{
                  fontSize: 10, color: T.sub, lineHeight: 1.55,
                  padding: '5px 8px',
                  background: T.amber + '0a',
                  border: `1px solid ${T.amber}20`,
                  borderRadius: 5,
                }}>
                  {d}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
