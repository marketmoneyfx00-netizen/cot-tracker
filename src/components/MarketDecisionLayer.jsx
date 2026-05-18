import { useMemo }                           from "react";
import TooltipInfo                           from "./TooltipInfo.jsx";
import { computeConfidenceDecay, computeExecutionReadiness, EXECUTION_READINESS_CFG } from "../confidenceDecayEngine.js";
import { buildNarrative }                    from "../narrativeEngine.js";
import { computeMarketRegime }               from "../marketRegimeEngine.js";
import { computeMarketState }                from "../marketStateEngine.js";

// ── Market State Panel ────────────────────────────────────────────────────────
// Renders the synthesis result for the selected pair above the per-pair cards.
function MarketStatePanel({ result, darkMode, T, isMobile }) {
  if (!result || result.isEmpty) return null;

  const pad = isMobile ? '11px 14px' : '12px 18px';

  return (
    <div style={{
      margin: isMobile ? '10px 10px 0' : '10px 14px 0',
      padding: pad,
      borderRadius: 10,
      background: result.bg,
      border: `1px solid ${result.border}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>

      {/* Header row — state badge + alignment score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>{result.icon}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: result.color, letterSpacing: '0.02em' }}>
                {result.label}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em',
                background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                border: `1px solid ${T.border}`, padding: '1px 5px', borderRadius: 99,
              }}>
                MARKET STATE
              </span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 9, color: T.sub, lineHeight: 1.4 }}>
              {result.description}
            </p>
          </div>
        </div>

        {/* Alignment score pill */}
        <div style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 2, minWidth: 44,
        }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: result.color, fontFamily: 'monospace', lineHeight: 1 }}>
            {result.alignmentScore}
          </span>
          <span style={{ fontSize: 7, color: T.sub2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Alignment
          </span>
        </div>
      </div>

      {/* Signal row — 3 key layers at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
        {[
          {
            label: 'Institutional',
            value: result.institutionalBias === 'BULLISH' ? 'Bullish'
                 : result.institutionalBias === 'BEARISH' ? 'Bearish' : 'Neutral',
            color: result.institutionalBias === 'BULLISH' ? '#22c55e'
                 : result.institutionalBias === 'BEARISH' ? '#ef4444' : '#6b7280',
          },
          {
            label: 'Structure',
            value: result.structureBias === 'BULLISH'     ? 'Bullish'
                 : result.structureBias === 'BEARISH'     ? 'Bearish'
                 : result.structureBias === 'COMPRESSION' ? 'Compressed'
                 : result.structureBias === 'EXPANSION'   ? 'Expanding'
                 : result.structureBias === 'RANGING'     ? 'Ranging'
                 : 'No data',
            color: result.structureBias === 'BULLISH'     ? '#22c55e'
                 : result.structureBias === 'BEARISH'     ? '#ef4444'
                 : result.structureBias === 'EXPANSION'   ? '#f97316' : '#6b7280',
          },
          {
            label: 'Timing Phase',
            value: result.timingLabel,
            color: result.timingState === 'EXPANSION'          ? '#22c55e'
                 : result.timingState === 'CONFIRMATION'       ? '#4ade80'
                 : result.timingState === 'EARLY_ACCUMULATION' ? '#f59e0b'
                 : result.timingState === 'LATE_TREND'         ? '#f97316'
                 : result.timingState === 'EXHAUSTION'         ? '#ef4444' : '#6b7280',
          },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
            borderRadius: 7, padding: '5px 8px',
          }}>
            <div style={{ fontSize: 7, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 2 }}>
              {label}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Execution context — observational text */}
      <div style={{
        padding: '6px 10px', borderRadius: 7,
        background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        borderLeft: `2px solid ${result.color}50`,
      }}>
        <span style={{ fontSize: 9, color: T.sub, lineHeight: 1.45 }}>
          {result.executionContext}
        </span>
      </div>

      {/* Volatility + Crowding mini-badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8, color: T.sub2, letterSpacing: '0.04em' }}>Context:</span>
        {[
          {
            key: 'volatility',
            label: `Volatility: ${result.volatilityLabel}`,
            color: result.volatilityState === 'EXPANSION' ? '#f97316'
                 : result.volatilityState === 'ELEVATED'  ? '#f59e0b'
                 : result.volatilityState === 'NORMAL'    ? '#22c55e' : '#6b7280',
          },
          {
            key: 'crowding',
            label: `Crowding: ${result.crowdingMeta.label}`,
            color: result.crowdingMeta.color,
          },
        ].map(({ key, label, color }) => (
          <span key={key} style={{
            fontSize: 8, fontWeight: 600, color,
            background: `${color}10`,
            border: `1px solid ${color}28`,
            padding: '1px 7px', borderRadius: 99, letterSpacing: '0.03em',
          }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET DECISION LAYER — Institutional Contextual Interpretation
// ─────────────────────────────────────────────────────────────────────────────
function MarketDecisionLayer({
  fxPairs,
  darkMode,
  T,
  isMobile,
  isPremium = true,
  onUpgrade,
  finalDecision,
  tacState,
  tacStateMap,
  selectedPair,
  livePrices = {},
  biasArr = [],
  macroSignal = null,
  cotDataDate = null,
  sentimentData = null,
}) {
  if (!fxPairs || fxPairs.length === 0) return null;

  const allowExecution  = finalDecision?.allowExecution  ?? true;
  const isMacroBlocked  = finalDecision?.isMacroBlocked  ?? false;
  const verdict         = finalDecision?.verdict         ?? 'EXECUTE';

  // ── Market Regime (cross-pair context) ──────────────────────────────────
  const regime = useMemo(
    () => computeMarketRegime(tacStateMap ?? {}, biasArr, macroSignal),
    [tacStateMap, biasArr, macroSignal],
  );

  // ── Market State (per selected-pair synthesis) ───────────────────────────
  const marketStateResult = useMemo(() => {
    const biasEntry = biasArr.find(r => r.pair === selectedPair) ?? biasArr[0] ?? null;
    const pairTac   = (tacStateMap && tacStateMap[selectedPair]) ?? (tacState ?? null);
    return computeMarketState(biasEntry, pairTac, macroSignal, sentimentData);
  }, [biasArr, selectedPair, tacStateMap, tacState, macroSignal, sentimentData]);

  // ── Per-pair data ────────────────────────────────────────────────────────
  // Single source of truth: use biasArr (already computed with macroConfidence,
  // real price change, carry, and z-score) — no re-derivation from fxPairs.
  const pairData = useMemo(() => {
    return (biasArr ?? []).map(entry => {
      if (!entry?.bias) return null;
      const { pair, bias } = entry;

      const biasDir    = bias.score > 1.5 ? 'bullish' : bias.score < -1.5 ? 'bearish' : 'neutral';
      const pairTac    = (tacStateMap && tacStateMap[pair]) ?? (pair === selectedPair ? tacState : null);
      const hasRealTac = pairTac && pairTac.pressure !== 'insufficient';

      // Confidence decay
      const decay = computeConfidenceDecay({
        biasScore: bias.score,
        biasDir,
        tacState: hasRealTac ? pairTac : null,
      });

      // Execution readiness
      const execReadiness = computeExecutionReadiness({
        biasDir,
        tacState: hasRealTac ? pairTac : null,
        decayLevel: decay.level,
        biasScore: bias.score,
      });

      // Narrative
      const narrative = buildNarrative({
        biasScore:          bias.score,
        biasDirection:      biasDir,
        tacState:           hasRealTac ? pairTac : null,
        conflictLevel:      decay.conflictLevel,
        executionReadiness: execReadiness,
      });

      return { pair, bias, biasDir, pairTac, hasRealTac, decay, execReadiness, narrative };
    }).filter(Boolean);
  }, [biasArr, tacStateMap, tacState, selectedPair]);

  if (pairData.length === 0) return null;

  // Sort: high alignment first, then by bias magnitude
  const sorted = [...pairData]
    .sort((a, b) => b.decay.score - a.decay.score || Math.abs(b.bias.score) - Math.abs(a.bias.score))
    .slice(0, 3);

  const detailBg = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  return (
    <div style={{ marginBottom: 16, background: T.card, border: `1px solid ${T.border}`, borderRadius: 14 }}>

      {/* ── Header ── */}
      <div style={{
        padding: isMobile ? '12px 14px 10px' : '14px 20px 12px',
        borderBottom: `1px solid ${T.border}`,
        background: darkMode ? 'rgba(0,85,204,0.06)' : 'rgba(0,85,204,0.03)',
        borderRadius: '14px 14px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, boxShadow: `0 0 8px ${T.accent}`, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: '0.08em' }}>
              MARKET DECISION LAYER
            </span>
            <TooltipInfo text="Institutional contextual interpretation. Fuses HTF structural bias (COT) with tactical momentum to generate a coherent narrative per pair. Not a signal — context and timing intelligence." align="left" />
          </div>
          <span style={{
            fontSize: 9, color: T.sub2, letterSpacing: '0.06em',
            background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${T.border}`, padding: '2px 8px', borderRadius: 99,
          }}>
            {cotDataDate ? `COT del ${cotDataDate}` : 'COT · HTF BIAS'} · HORIZONTE 1–4 SEM
          </span>
        </div>

        {/* Market Regime strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 8,
          background: regime.bg, border: `1px solid ${regime.border}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: regime.color, flexShrink: 0, display: 'block' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: regime.color, letterSpacing: '0.04em' }}>
            {regime.label.toUpperCase()}
          </span>
          <span style={{ fontSize: 10, color: T.sub, flex: 1 }}>— {regime.description}</span>
          <span style={{
            fontSize: 8, color: T.sub2, letterSpacing: '0.04em', flexShrink: 0,
            background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${T.border}`, padding: '1px 6px', borderRadius: 99,
          }}>
            días–semanas
          </span>
        </div>
      </div>

      {/* ── Execution block banner ── */}
      {!allowExecution && (
        <div style={{
          margin: '0 14px 0', padding: '9px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: isMacroBlocked ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          borderRadius: 8, marginTop: 10,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>{isMacroBlocked ? '🚫' : '⚠️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: isMacroBlocked ? '#ef4444' : '#f59e0b' }}>
              {isMacroBlocked
                ? 'Macro risk elevated — analysis available for planning only'
                : 'Execution conditions below threshold — await improvement'}
            </span>
            <div style={{ fontSize: 10, color: T.sub, marginTop: 1 }}>
              {isMacroBlocked
                ? 'Trade Readiness score blocked. Use this context for forward planning, not immediate execution.'
                : 'Intraday Execution score below threshold. Institutional context remains valid for directional awareness.'}
            </div>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, flexShrink: 0, padding: '3px 8px', borderRadius: 99,
            background: isMacroBlocked ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
            color: isMacroBlocked ? '#ef4444' : '#f59e0b',
            border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
            letterSpacing: '0.06em',
          }}>
            {isMacroBlocked ? 'SIN CONTEXTO' : 'SESGO EN FORMACIÓN'}
          </span>
        </div>
      )}

      {/* ── Market State Panel (selected pair synthesis) ── */}
      <MarketStatePanel result={marketStateResult} darkMode={darkMode} T={T} isMobile={isMobile} />

      {/* ── Pair cards ── */}
      <div style={{
        padding: isMobile ? '12px' : '14px 20px',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : `repeat(${sorted.length}, 1fr)`,
        gap: isMobile ? 8 : 12,
      }}>
        {sorted.map(({ pair, bias, biasDir, pairTac, hasRealTac, decay, execReadiness, narrative }) => {
          const biasColor     = bias.score > 0 ? '#22c55e' : bias.score < 0 ? '#ef4444' : '#6b7280';
          // Key visual rule: when conflict present, card border uses decay color (amber/orange)
          const cardBorder    = decay.color;
          const execCfg       = EXECUTION_READINESS_CFG[execReadiness] ?? EXECUTION_READINESS_CFG.await_confirmation;
          const confluenceData = biasArr.find(r => r.pair === pair)?.confluence ?? null;

          // Conflict warning: show when levels are weak or structural_conflict
          const showConflictBanner = decay.conflictLevel === 'moderate' || decay.conflictLevel === 'severe';

          return (
            <div key={pair} style={{
              background: darkMode ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
              border: `1px solid ${cardBorder}22`,
              borderRadius: 12,
              padding: isMobile ? '12px' : '14px 16px',
              boxShadow: `0 0 0 1px ${cardBorder}10`,
              display: 'flex', flexDirection: 'column', gap: 0,
            }}>

              {/* Pair header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: T.txt, fontFamily: 'monospace', letterSpacing: '0.03em' }}>
                    {pair}
                  </span>
                  {livePrices[pair]?.price && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: T.sub, fontFamily: 'monospace' }}>
                      {livePrices[pair].price.toFixed(pair.includes('JPY') ? 3 : 5)}
                      <span style={{ fontSize: 8, color: T.sub2, marginLeft: 4, letterSpacing: '0.04em' }}>LIVE</span>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {!allowExecution && (
                    <span style={{
                      fontSize: 8, fontWeight: 700,
                      color: isMacroBlocked ? '#ef4444' : '#f59e0b',
                      background: isMacroBlocked ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
                      border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                      padding: '2px 6px', borderRadius: 99, letterSpacing: '0.05em',
                    }}>
                      {isMacroBlocked ? '🚫 MACRO BLOCK' : '⚠️ AWAIT'}
                    </span>
                  )}
                  {/* Alignment badge — color reflects UNCERTAINTY, not opportunity */}
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: decay.color,
                    background: `${decay.color}14`,
                    border: `1px solid ${decay.color}30`,
                    padding: '2px 8px', borderRadius: 99, letterSpacing: '0.04em', whiteSpace: 'nowrap',
                  }}>
                    {decay.label.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* HTF Bias + Tactical Pressure row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <div style={{ background: detailBg, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 4, textTransform: 'uppercase' }}>
                    Institutional Bias
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: biasColor, fontFamily: 'monospace', lineHeight: 1 }}>
                      {bias.score > 0 ? '+' : ''}{bias.score}
                    </span>
                    <span style={{ fontSize: 9, color: T.sub, lineHeight: 1.3, maxWidth: 60 }}>
                      {(bias.label ?? 'Neutral').split(' ').slice(0, 3).join(' ')}
                    </span>
                  </div>
                </div>
                <div style={{ background: detailBg, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 4, textTransform: 'uppercase' }}>
                    {hasRealTac ? 'Tactical Pressure' : 'Flow Signal'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {hasRealTac ? (
                      <>
                        <span style={{ fontSize: 11, lineHeight: 1, color: pairTac.color }}>
                          {pairTac.pressure === 'bearish' ? '↓' : pairTac.pressure === 'bullish' ? '↑' : '–'}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: pairTac.color }}>{pairTac.label}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: T.sub }}>Awaiting data</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Confluence strip — multi-factor signal agreement */}
              {confluenceData && confluenceData.confluenceScore > 0 && (
                <div style={{
                  marginBottom: 6, padding: '5px 10px', borderRadius: 7,
                  background: `${confluenceData.color}0d`,
                  border: `1px solid ${confluenceData.color}22`,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: confluenceData.color, letterSpacing: '0.07em' }}>
                    CONFLUENCE
                  </span>
                  <div style={{ flex: 1, height: 3, background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${confluenceData.confluenceScore}%`, height: '100%', background: confluenceData.color, borderRadius: 99, transition: 'width 0.6s ease' }} />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: confluenceData.color, fontFamily: 'monospace', minWidth: 24, textAlign: 'right' }}>
                    {confluenceData.confluenceScore}
                  </span>
                  <span style={{ fontSize: 8, color: T.sub2 }}>{confluenceData.label}</span>
                </div>
              )}

              {/* Conflict warning — shown when decay is weak/structural */}
              {showConflictBanner && hasRealTac && (
                <div style={{
                  marginBottom: 8, padding: '6px 10px', borderRadius: 7,
                  background: decay.conflictLevel === 'severe'
                    ? 'rgba(239,68,68,0.07)'
                    : 'rgba(249,115,22,0.07)',
                  border: `1px solid ${decay.conflictLevel === 'severe'
                    ? 'rgba(239,68,68,0.20)'
                    : 'rgba(249,115,22,0.20)'}`,
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1 }}>↔</span>
                  <div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: decay.conflictLevel === 'severe' ? '#ef4444' : '#f97316' }}>
                      {biasDir === 'bullish' ? 'Bullish' : 'Bearish'} HTF Bias · Tactical Pressure {pairTac.pressure}
                    </span>
                    <div style={{ fontSize: 9, color: T.sub, marginTop: 1, lineHeight: 1.4 }}>
                      {pairTac.description ?? 'Short-term price action diverges from structural bias.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Confidence decay bar — color reflects uncertainty level */}
              <div style={{ marginBottom: 8, position: 'relative' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
                  filter: isPremium ? 'none' : 'blur(4px)',
                  userSelect: isPremium ? 'auto' : 'none',
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    Alignment Score
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: decay.color, fontFamily: 'monospace', letterSpacing: '-1px', lineHeight: 1 }}>
                    {decay.score}
                  </span>
                </div>
                <div style={{ height: 4, background: T.border, borderRadius: 99, overflow: 'hidden', filter: isPremium ? 'none' : 'blur(3px)' }}>
                  <div style={{
                    width: `${decay.score}%`, height: '100%', borderRadius: 99,
                    background: `linear-gradient(90deg, #ef4444 0%, #f59e0b 40%, ${decay.score >= 75 ? '#22c55e' : '#f59e0b'} 100%)`,
                    transition: 'width 0.8s ease',
                  }} />
                </div>
              </div>

              {/* Narrative — primary interpretation */}
              <div style={{
                marginBottom: 8, padding: '8px 10px', borderRadius: 8,
                background: detailBg,
                filter: isPremium ? 'none' : 'blur(3px)',
                userSelect: isPremium ? 'auto' : 'none',
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', marginBottom: 4, textTransform: 'uppercase' }}>
                  Contextual Interpretation
                </div>
                <p style={{ fontSize: 10, color: T.sub, lineHeight: 1.5, margin: 0 }}>
                  {narrative.primary}
                </p>
              </div>

              {/* Execution Readiness — explicitly separate from direction */}
              <div style={{
                paddingTop: 8, borderTop: `1px solid ${T.border}`,
                filter: isPremium ? 'none' : 'blur(3px)',
                userSelect: isPremium ? 'auto' : 'none',
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em', marginBottom: 5, textTransform: 'uppercase' }}>
                  Execution Readiness
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 8, padding: '2px 8px', borderRadius: 99,
                    fontWeight: 700, letterSpacing: '0.05em',
                    color: execCfg.color,
                    background: `${execCfg.color}12`,
                    border: `1px solid ${execCfg.color}28`,
                  }}>
                    {execCfg.label.toUpperCase()}
                  </span>
                </div>
                <p style={{ fontSize: 9, color: T.sub, lineHeight: 1.45, margin: 0 }}>
                  {narrative.execution}
                </p>
              </div>

              {/* Invalidation scenarios */}
              {narrative.invalidation && isPremium && (
                <div style={{
                  marginTop: 8, padding: '7px 10px', borderRadius: 8,
                  background: darkMode ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.03)',
                  border: `1px solid rgba(239,68,68,0.14)`,
                }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: '#ef4444', letterSpacing: '0.07em', marginBottom: 3, textTransform: 'uppercase', opacity: 0.7 }}>
                    Tesis se invalida si…
                  </div>
                  <p style={{ fontSize: 9, color: T.sub, lineHeight: 1.45, margin: 0, fontStyle: 'italic' }}>
                    {narrative.invalidation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer legend ── */}
      <div style={{
        padding: isMobile ? '8px 12px 12px' : '8px 20px 12px',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        borderTop: `1px solid ${T.border}`,
      }}>
        {[
          { label: 'HIGH ALIGNMENT',      color: '#22c55e' },
          { label: 'MODERATE ALIGNMENT',  color: '#f59e0b' },
          { label: 'WEAK ALIGNMENT',      color: '#f97316' },
          { label: 'STRUCTURAL CONFLICT', color: '#ef4444' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 1, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: T.sub2, letterSpacing: '0.04em' }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize: 8, color: T.sub2, marginLeft: 'auto', opacity: 0.7 }}>
          Institutional context only · Not a trading signal
        </span>
      </div>

      {/* ── Paywall CTA (free users only) ── */}
      {!isPremium && (
        <div style={{
          margin: '0 16px 14px', padding: '12px 14px', borderRadius: 10,
          background: darkMode ? 'rgba(0,85,204,0.07)' : 'rgba(0,85,204,0.04)',
          border: '1px solid rgba(0,85,204,0.18)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: darkMode ? '#c8d0e0' : '#1e293b', marginBottom: 3 }}>
              Full institutional context requires premium access
            </div>
            <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.4 }}>
              Narrative intelligence, alignment decay, and execution readiness are reserved for premium users.
            </div>
          </div>
          <button
            onClick={onUpgrade}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 8,
              border: 'none', background: '#0055cc', color: 'white',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,85,204,0.3)',
            }}
          >
            Unlock full context
          </button>
        </div>
      )}
    </div>
  );
}

export { MarketDecisionLayer };
export default MarketDecisionLayer;
