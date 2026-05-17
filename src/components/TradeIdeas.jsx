/**
 * TradeIdeas.jsx — v4
 * Respects full decision hierarchy.
 * tradeReadinessScore < 50 → visual block + opacity dim + no interaction.
 * intradayScore 60/70 thresholds → per-card warnings.
 */
import { useMemo } from 'react';
import { calculateBiasScore, deriveInputsFromPair } from '../cotBiasEngine.js';

const CONF_CFG = {
  HIGH:   { label: 'Favorable Context', color: '#22c55e' },
  MEDIUM: { label: 'Moderate Context',  color: '#f59e0b' },
  LOW:    { label: 'Low Confluence',    color: '#6b7280' },
};

function buildIdea(pair, biasScore, signal, strength, marketState) {
  if (marketState === 'compression' || marketState === 'distribution') return null;

  const biasDir = biasScore > 1.5 ? 'buy' : biasScore < -1.5 ? 'sell' : null;
  const tacDir  = signal === 'buy' ? 'buy' : signal === 'sell' ? 'sell' : null;

  if (!biasDir && !tacDir) return null;
  if (biasDir && tacDir && biasDir !== tacDir) return null;

  const dir      = biasDir || tacDir;
  const isLong   = dir === 'buy';
  const abs      = Math.abs(biasScore);
  const aligned  = biasDir && tacDir && biasDir === tacDir;

  const strLabel = abs >= 3 ? 'fuerte' : abs >= 2 ? 'moderado' : 'leve';
  const dirText  = isLong ? 'alcista' : 'bajista';

  const idea = aligned
    ? (isLong ? `Structural bullish bias · Monitoring pullbacks in ${pair}` : `Structural bearish bias · Monitoring bounces in ${pair}`)
    : biasDir
    ? (isLong ? `Bullish HTF bias in ${pair} · Awaiting tactical confirmation` : `Bearish HTF bias in ${pair} · Awaiting tactical confirmation`)
    : (isLong ? `Bullish tactical signal in ${pair} · No HTF institutional backing` : `Bearish tactical signal in ${pair} · No HTF institutional backing`);

  const context = aligned
    ? `HTF institutional flow ${dirText} (${strLabel}) — aligned with tactical signal`
    : biasDir
    ? `HTF institutional flow ${dirText} (${strLabel}) — tactical confirmation pending`
    : `Tactical signal only — no HTF institutional backing`;

  const confidence = aligned && abs >= 3 ? 'HIGH' : aligned || abs >= 2 ? 'MEDIUM' : 'LOW';

  return { pair, dir, isLong, idea, context, confidence, biasScore };
}

export default function TradeIdeas({ fxPairs, darkMode, T, isPremium, onUpgrade, marketState, intradayScore, tradeReadinessScore, selectedPair, finalDecision, tacState }) {
  // Use finalDecision as the single source of truth when available.
  // Fallback to local computation for backward compatibility.
  const allowExecution  = finalDecision ? finalDecision.allowExecution : true;
  const isMacroBlocked  = finalDecision ? finalDecision.isMacroBlocked : (typeof tradeReadinessScore === 'number' && tradeReadinessScore < 50);
  const isIntradayBlock = finalDecision ? finalDecision.isIntradayBlocked : (typeof intradayScore === 'number' && intradayScore < 60);
  const isPreparing     = finalDecision?.verdict === 'PREPARE'
    || (!isMacroBlocked && !isIntradayBlock && typeof intradayScore === 'number' && intradayScore < 70);

  // Legacy aliases kept for card-level warnings below
  const blocked     = isIntradayBlock;
  const constrained = isPreparing;

  const ideas = useMemo(() => {
    if (!fxPairs?.length) return [];
    if (marketState === 'compression' || marketState === 'distribution') return [];
    return fxPairs
      .map(p => {
        if (!p || p.pair.includes('Index')) return null;
        const inp  = deriveInputsFromPair(p); if (!inp) return null;
        const bias = calculateBiasScore(inp);  if (!bias) return null;
        return buildIdea(p.pair, bias.score, p.signal?.signal, p.signal?.strength, marketState);
      })
      .filter(Boolean)
      .sort((a, b) => {
        const r = { HIGH: 2, MEDIUM: 1, LOW: 0 };
        return (r[b.confidence] - r[a.confidence]) || (Math.abs(b.biasScore) - Math.abs(a.biasScore));
      });
  }, [fxPairs, marketState]);

  // Filter to selectedPair when provided — single source of truth
  const displayIdeas = selectedPair
    ? ideas.filter(i => i.pair === selectedPair)
    : ideas;

  const showEmpty = marketState === 'compression' || marketState === 'distribution' || displayIdeas.length === 0;

  return (
    <div style={{ marginBottom: 16 }}>

      {/* ── VERDICT BANNER — macro block ── */}
      {isMacroBlocked && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 10, borderRadius: 10,
          background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.28)',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🚫</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#ef4444', fontSize: 11 }}>
              No hay condiciones para operar
            </span>
            <span style={{ fontSize: 11, color: T.sub }}>
              {' '}— riesgo macro elevado. Estas ideas son contexto, no deben ejecutarse.
            </span>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, flexShrink: 0,
            padding: '2px 7px', borderRadius: 99,
            background: 'rgba(239,68,68,0.12)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.28)', letterSpacing: '0.06em',
          }}>AVOID</span>
        </div>
      )}

      {/* ── VERDICT BANNER — intraday block ── */}
      {!isMacroBlocked && isIntradayBlock && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 10, borderRadius: 10,
          background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.28)',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#f59e0b', fontSize: 11 }}>
              Permiso intradía insuficiente
            </span>
            <span style={{ fontSize: 11, color: T.sub }}>
              {' '}— contexto COT válido pero condiciones de ejecución no están listas.
            </span>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, flexShrink: 0,
            padding: '2px 7px', borderRadius: 99,
            background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
            border: '1px solid rgba(245,158,11,0.28)', letterSpacing: '0.06em',
          }}>AVOID</span>
        </div>
      )}

      {/* ── VERDICT BANNER — prepare ── */}
      {!isMacroBlocked && !isIntradayBlock && isPreparing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 10, borderRadius: 10,
          background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.22)',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
          <span style={{ fontSize: 11, color: T.sub }}>
            <span style={{ fontWeight: 700, color: '#06b6d4' }}>Modo preparación</span>
            {' '}— condiciones mejorando. Confirmar antes de ejecutar.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.1em' }}>
          CONTEXT OPPORTUNITIES
        </span>
        <span style={{ flex: 1, height: 1, background: T.border }} />
        <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.05em', fontWeight: 500 }}>
          COT · STRUCTURAL CONTEXT · NOT ENTRY SIGNALS
        </span>
      </div>

      {/* Tactical state banner — shown when price pressure conflicts with structural bias */}
      {tacState && tacState.pressure !== 'insufficient' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', marginBottom: 8, borderRadius: 8,
          background: tacState.pressure === 'bearish' ? 'rgba(249,115,22,0.07)' : 'rgba(34,197,94,0.07)',
          border: `1px solid ${tacState.pressure === 'bearish' ? 'rgba(249,115,22,0.22)' : 'rgba(34,197,94,0.22)'}`,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: tacState.color,
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: tacState.color, letterSpacing: '0.04em' }}>
            MARKET STATE: {tacState.label.toUpperCase()}
          </span>
          {tacState.description && (
            <span style={{ fontSize: 10, color: T.sub, marginLeft: 4 }}>
              · {tacState.description}
            </span>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: T.sub2, marginBottom: 8, fontStyle: 'italic' }}>
        Pairs shown have valid institutional confluence · swing perspective only
      </div>

      {showEmpty ? (
        <div style={{
          background: darkMode ? 'rgba(107,114,128,0.07)' : 'rgba(107,114,128,0.05)',
          border: `1px solid rgba(107,114,128,0.2)`,
          borderRadius: 12, padding: '14px 16px',
          fontSize: 13, color: T.sub, textAlign: 'center',
        }}>
          No hay oportunidades con contexto institucional válido
          {(marketState === 'compression' || marketState === 'distribution') && (
            <div style={{ fontSize: 11, color: T.sub2, marginTop: 4 }}>
              El estado actual del mercado no permite buscar entradas
            </div>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
          gap: 8,
        }}>
          {displayIdeas.slice(0, isPremium ? displayIdeas.length : 2).map(idea => {
            const conf = CONF_CFG[idea.confidence];
            // When execution is blocked, mute direction color and mark as context-only
            const dirColor = !allowExecution
              ? T.sub
              : idea.isLong ? '#22c55e' : '#ef4444';
            return (
              <div key={idea.pair} style={{
                background: darkMode ? 'rgba(255,255,255,0.03)' : '#fff',
                border: `1px solid ${!allowExecution ? T.border : T.border}`,
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 5,
                opacity: !allowExecution ? 0.75 : 1,
                transition: 'opacity 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: T.txt }}>{idea.pair}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {!allowExecution && (
                      <span style={{
                        fontSize: 8, fontWeight: 700,
                        color: isMacroBlocked ? '#ef4444' : '#f59e0b',
                        background: isMacroBlocked ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
                        border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                        padding: '1px 5px', borderRadius: 99,
                      }}>
                        {isMacroBlocked ? 'NO EXEC' : 'ESPERAR'}
                      </span>
                    )}
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: conf.color,
                      background: conf.color + '15', border: `1px solid ${conf.color}28`,
                      padding: '2px 7px', borderRadius: 4,
                    }}>
                      {conf.label}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dirColor }}>{idea.idea}</div>
                <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>{idea.context}</div>
                <div style={{ fontSize: 10, color: T.sub2, fontStyle: 'italic', marginTop: 2 }}>
                  Weekly COT context · swing perspective · no tactical entry implied
                </div>
                {/* Per-card footer status — derived from finalDecision */}
                {isMacroBlocked && (
                  <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, marginTop: 4 }}>
                    🚫 Setup válido pero no ejecutable — macro risk activo
                  </div>
                )}
                {!isMacroBlocked && blocked && (
                  <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, marginTop: 4 }}>
                    ⛔ Evitar ejecución — condiciones intradía no favorables
                  </div>
                )}
                {!isMacroBlocked && !blocked && constrained && (
                  <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, marginTop: 4 }}>
                    ⚠️ Confirmar condiciones intradía antes de ejecutar
                  </div>
                )}
              </div>
            );
          })}

          {!isPremium && displayIdeas.length > 2 && (
            <div onClick={onUpgrade} style={{
              background: darkMode ? 'rgba(0,85,204,0.08)' : 'rgba(0,85,204,0.05)',
              border: `1px dashed ${T.accent}40`, borderRadius: 12,
              padding: '12px 14px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 5, minHeight: 80,
            }}>
              <span style={{ fontSize: 13, color: T.accent, fontWeight: 700 }}>
                +{displayIdeas.length - 2} oportunidades con confluencia institucional
              </span>
              <span style={{ fontSize: 11, color: T.sub }}>Desbloquear con Premium</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
