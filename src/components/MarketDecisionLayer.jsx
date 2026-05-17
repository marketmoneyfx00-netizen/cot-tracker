import { useMemo } from "react";
import TooltipInfo from "./TooltipInfo.jsx";
import { calculateBiasScore, deriveInputsFromPair } from "../cotBiasEngine.js";
import { useLivePrices } from "../hooks/useLivePrices.js";

// ─── Confluence config ───────────────────────────────────────────────────────
const CONFLUENCE_CFG = {
  CONFIRMED_BULL: { label:"STRUCTURAL ALIGNMENT ▲", color:"#22c55e", bg:"rgba(34,197,94,0.10)",    border:"rgba(34,197,94,0.25)"    },
  CONFIRMED_BEAR: { label:"STRUCTURAL ALIGNMENT ▼", color:"#ef4444", bg:"rgba(239,68,68,0.10)",    border:"rgba(239,68,68,0.25)"    },
  CONFLICT:       { label:"HTF/TACTICAL CONFLICT",  color:"#f97316", bg:"rgba(249,115,22,0.10)",   border:"rgba(249,115,22,0.25)"   },
  PULLBACK_BULL:  { label:"PULLBACK MONITORING ▲",  color:"#f59e0b", bg:"rgba(245,158,11,0.10)",   border:"rgba(245,158,11,0.25)"   },
  PULLBACK_BEAR:  { label:"PULLBACK MONITORING ▼",  color:"#f59e0b", bg:"rgba(245,158,11,0.10)",   border:"rgba(245,158,11,0.25)"   },
  EARLY_BULL:     { label:"EARLY ROTATION ▲",       color:"#06b6d4", bg:"rgba(6,182,212,0.10)",    border:"rgba(6,182,212,0.25)"    },
  EARLY_BEAR:     { label:"EARLY ROTATION ▼",       color:"#06b6d4", bg:"rgba(6,182,212,0.10)",    border:"rgba(6,182,212,0.25)"    },
  NEUTRAL:        { label:"NEUTRAL / AWAIT",        color:"#6b7280", bg:"rgba(107,114,128,0.08)",  border:"rgba(107,114,128,0.20)"  },
};

function buildPairConfluence(biasScore, tacSignal, tacStrength) {
  const biasDir = biasScore > 1.5 ? 1 : biasScore < -1.5 ? -1 : 0;
  const tacDir  = tacSignal==="buy" ? 1 : tacSignal==="sell" ? -1 : 0;
  const biasAbs = Math.abs(biasScore);
  const str     = Math.min(tacStrength||0, 3);

  let alignment = 50;
  if (biasDir!==0 && tacDir!==0) {
    alignment = biasDir===tacDir
      ? Math.min(99, Math.round(55 + biasAbs*7 + str*4))
      : Math.max(5,  Math.round(45 - biasAbs*7 - str*4));
  } else if (biasDir!==0) {
    alignment = Math.min(72, Math.round(45 + biasAbs*4));
  } else if (tacDir!==0) {
    alignment = Math.min(62, Math.round(42 + str*5));
  }

  let confluenceKey;
  if      (biasDir>0 && tacDir>0) confluenceKey="CONFIRMED_BULL";
  else if (biasDir<0 && tacDir<0) confluenceKey="CONFIRMED_BEAR";
  else if (biasDir>0 && tacDir<0) confluenceKey="CONFLICT";
  else if (biasDir<0 && tacDir>0) confluenceKey="CONFLICT";
  else if (biasDir>0)             confluenceKey="PULLBACK_BULL";
  else if (biasDir<0)             confluenceKey="PULLBACK_BEAR";
  else if (tacDir>0)              confluenceKey="EARLY_BULL";
  else if (tacDir<0)              confluenceKey="EARLY_BEAR";
  else                            confluenceKey="NEUTRAL";

  const USE_CASES = {
    CONFIRMED_BULL:"Structural momentum aligned · Monitoring pullback levels",
    CONFIRMED_BEAR:"Structural momentum aligned · Monitoring bounce levels",
    CONFLICT:      "HTF/Tactical conflict · Await structural resolution",
    PULLBACK_BULL: "HTF bullish bias · Pullback phase active",
    PULLBACK_BEAR: "HTF bearish bias · Bounce phase active",
    EARLY_BULL:    "Early bullish rotation · Pending COT confirmation",
    EARLY_BEAR:    "Early bearish rotation · Pending COT confirmation",
    NEUTRAL:       "No directional edge · Await COT confirmation",
  };

  const conviction = alignment>=75 ? "HIGH" : alignment>=50 ? "MEDIUM" : "LOW";
  const CONVICTION_CFG = {
    HIGH:   {label:"High Alignment",     color:"#22c55e", dots:3},
    MEDIUM: {label:"Moderate Alignment", color:"#f59e0b", dots:2},
    LOW:    {label:"Low Alignment",      color:"#ef4444", dots:1},
  };

  return {
    alignment,
    confluenceKey,
    cfg:          CONFLUENCE_CFG[confluenceKey]||CONFLUENCE_CFG.NEUTRAL,
    useCase:      USE_CASES[confluenceKey]||USE_CASES.NEUTRAL,
    conviction,
    convictionCfg:CONVICTION_CFG[conviction],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET DECISION LAYER — Premium interpretation card
// ─────────────────────────────────────────────────────────────────────────────
function MarketDecisionLayer({ fxPairs, darkMode, T, isMobile, isPremium = true, onUpgrade, finalDecision, tacState, tacStateMap, selectedPair }) {
  if (!fxPairs || fxPairs.length===0) return null;
  const livePrices = useLivePrices();

  const allowExecution  = finalDecision?.allowExecution ?? true;
  const isMacroBlocked  = finalDecision?.isMacroBlocked  ?? false;
  const isIntradayBlock = finalDecision?.isIntradayBlocked ?? false;
  const verdict         = finalDecision?.verdict ?? 'EXECUTE';

  const SIGNAL_LABELS = {
    buy:        {label:"Alcista",    color:"#22c55e", icon:"▲"},
    sell:       {label:"Bajista",    color:"#ef4444", icon:"▼"},
    wait:       {label:"Neutro",     color:"#6b7280", icon:"–"},
    indecision: {label:"Divergente", color:"#f59e0b", icon:"↔"},
  };

  const pairData = fxPairs.map(p => {
    if (!p) return null;
    const inputs = deriveInputsFromPair(p);
    if (!inputs) return null;
    const bias = calculateBiasScore(inputs);
    if (!bias) return null;
    const conf = buildPairConfluence(bias.score, p.signal?.signal, p.signal?.strength);
    return { pair:p.pair, bias, signal:p.signal, conf };
  }).filter(Boolean);

  if (pairData.length===0) return null;

  // Sort: confirmed trends first, then highest alignment
  const sorted = [...pairData].sort((a,b)=>{
    const aP = a.conf.confluenceKey.startsWith("CONFIRMED")?1:0;
    const bP = b.conf.confluenceKey.startsWith("CONFIRMED")?1:0;
    if (aP!==bP) return bP-aP;
    return b.conf.alignment - a.conf.alignment;
  }).slice(0,3);

  const detailBg = darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)";

  return (
    <div style={{marginBottom:16,background:T.card,border:`1px solid ${T.border}`,borderRadius:14}}>
      {/* Header */}
      <div style={{
        padding: isMobile?"12px 14px 10px":"14px 20px 12px",
        borderBottom:`1px solid ${T.border}`,
        background: darkMode?"rgba(0,85,204,0.06)":"rgba(0,85,204,0.03)",
        borderRadius:"14px 14px 0 0",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:T.accent,boxShadow:`0 0 8px ${T.accent}`,flexShrink:0}}/>
          <span style={{fontSize:11,fontWeight:700,color:T.sub,letterSpacing:"0.08em"}}>
            MARKET DECISION LAYER
          </span>
          <TooltipInfo text="Capa de interpretación automática que combina el sesgo macro institucional (HTF) con el flujo táctico semanal (LTF). Genera una lectura operativa clara por par. No es señal de entrada directa." align="left"/>
        </div>
        <span style={{fontSize:9,color:T.sub2,letterSpacing:"0.06em",
          background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)",
          border:`1px solid ${T.border}`,padding:"2px 8px",borderRadius:99}}>
          COT · SEMANAL · HTF+LTF
        </span>
      </div>

      {/* ── VERDICT BANNER — shown whenever execution is not permitted ── */}
      {!allowExecution && (
        <div style={{
          margin: '0 14px 0',
          padding: '9px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: isMacroBlocked
            ? 'rgba(239,68,68,0.08)'
            : 'rgba(245,158,11,0.08)',
          border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          borderRadius: 8,
          marginTop: 10,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>{isMacroBlocked ? '🚫' : '⚠️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: isMacroBlocked ? '#ef4444' : '#f59e0b',
            }}>
              {isMacroBlocked
                ? 'Análisis disponible · ejecución bloqueada por macro risk'
                : 'Análisis disponible · permiso operativo bajo'}
            </span>
            <div style={{ fontSize: 10, color: T.sub, marginTop: 1 }}>
              {isMacroBlocked
                ? 'Trade Readiness bloqueado — usa esta lectura para planificación, no para ejecución inmediata'
                : 'Intraday Execution por debajo del umbral — esperar mejora del contexto'}
            </div>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, flexShrink: 0,
            padding: '3px 8px', borderRadius: 99,
            background: isMacroBlocked ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
            color: isMacroBlocked ? '#ef4444' : '#f59e0b',
            border: `1px solid ${isMacroBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
            letterSpacing: '0.06em',
          }}>
            {verdict}
          </span>
        </div>
      )}

      {/* Cards */}
      <div style={{
        padding: isMobile?"12px":"14px 20px",
        display:"grid",
        gridTemplateColumns: isMobile?"1fr":`repeat(${sorted.length},1fr)`,
        gap: isMobile?8:12,
      }}>
        {sorted.map(({pair,bias,signal,conf})=>{
          const sigCfg = SIGNAL_LABELS[signal?.signal]||SIGNAL_LABELS.wait;
          const alignColor = conf.alignment>=75?"#22c55e":conf.alignment>=50?"#f59e0b":"#ef4444";
          const biasColor  = (bias.score||0)>0?"#22c55e":(bias.score||0)<0?"#ef4444":"#6b7280";

          return (
            <div key={pair} style={{
              background: darkMode?"rgba(255,255,255,0.025)":"rgba(0,0,0,0.02)",
              border:`1px solid ${conf.cfg.border}`,
              borderRadius:12,
              padding: isMobile?"12px":"14px 16px",
              boxShadow:`0 0 0 1px ${conf.cfg.color}10`,
              display:"flex",flexDirection:"column",gap:0,
            }}>
              {/* Pair + confluence badge */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:16,fontWeight:800,color:T.txt,fontFamily:"monospace",letterSpacing:"0.03em"}}>
                    {pair}
                  </span>
                  {livePrices[pair]?.price && (
                    <span style={{fontSize:10,fontWeight:600,color:T.sub,fontFamily:"monospace",letterSpacing:"0.02em"}}>
                      {livePrices[pair].price.toFixed(pair.includes('JPY') ? 3 : 5)}
                      <span style={{fontSize:8,color:T.sub2,marginLeft:4,letterSpacing:"0.04em"}}>LIVE</span>
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
                      {isMacroBlocked ? '🚫 NO EXEC' : '⚠️ ESPERAR'}
                    </span>
                  )}
                  <span style={{
                    fontSize:9,fontWeight:700,color:conf.cfg.color,
                    background:conf.cfg.bg,border:`1px solid ${conf.cfg.border}`,
                    padding:"2px 8px",borderRadius:99,letterSpacing:"0.04em",
                    whiteSpace:"nowrap",
                  }}>{conf.cfg.label}</span>
                </div>
              </div>

              {/* Macro + Tactical row */}
              {(() => {
                // Use per-pair tacState from tacStateMap if available, else fall back to selectedPair tacState
                const pairTac = (tacStateMap && tacStateMap[pair]) || (pair === selectedPair ? tacState : null);
                const hasRealTac = pairTac && pairTac.pressure !== 'insufficient';
                const biasDir = (bias.score||0) > 1.5 ? 'bullish' : (bias.score||0) < -1.5 ? 'bearish' : null;
                const tacConflict = hasRealTac && biasDir && biasDir !== pairTac.pressure && pairTac.pressure !== 'neutral';
                return (
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom: tacConflict ? 6 : 10}}>
                      <div style={{background:detailBg,borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,fontWeight:700,color:T.sub2,letterSpacing:"0.08em",marginBottom:4,textTransform:"uppercase"}}>HTF Macro Bias</div>
                        <div style={{display:"flex",alignItems:"baseline",gap:5}}>
                          <span style={{fontSize:20,fontWeight:900,color:biasColor,fontFamily:"monospace",lineHeight:1}}>
                            {(bias.score||0)>0?"+":""}{bias.score||0}
                          </span>
                          <span style={{fontSize:9,color:T.sub,lineHeight:1.3,maxWidth:60}}>
                            {(bias.label||"Neutral").split(" ").slice(0,3).join(" ")}
                          </span>
                        </div>
                      </div>
                      <div style={{background:detailBg,borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:8,fontWeight:700,color:T.sub2,letterSpacing:"0.08em",marginBottom:4,textTransform:"uppercase"}}>
                          {hasRealTac ? "Tactical Pressure" : "Institutional Flow"}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          {hasRealTac ? (
                            <>
                              <span style={{fontSize:11,lineHeight:1}}>{pairTac.pressure==='bearish'?'↓':pairTac.pressure==='bullish'?'↑':'–'}</span>
                              <span style={{fontSize:10,fontWeight:700,color:pairTac.color}}>{pairTac.label}</span>
                            </>
                          ) : (
                            <>
                              <span style={{fontSize:16,fontWeight:800,color:sigCfg.color,lineHeight:1}}>{sigCfg.icon}</span>
                              <span style={{fontSize:10,fontWeight:700,color:sigCfg.color}}>{sigCfg.label}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Tactical conflict warning */}
                    {tacConflict && (
                      <div style={{
                        marginBottom:10,padding:"6px 10px",borderRadius:7,
                        background:"rgba(249,115,22,0.08)",border:"1px solid rgba(249,115,22,0.22)",
                        display:"flex",alignItems:"center",gap:6,
                      }}>
                        <span style={{fontSize:10}}>↔</span>
                        <div style={{flex:1}}>
                          <span style={{fontSize:9,fontWeight:700,color:"#f97316"}}>
                            {biasDir==='bullish' ? 'Bullish' : 'Bearish'} HTF bias · Tactical pressure {pairTac.pressure}
                          </span>
                          <div style={{fontSize:9,color:T.sub,marginTop:1}}>
                            {pairTac.description || 'Short-term price action diverges from structural bias. Monitor for stabilization before acting.'}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Alignment score */}
              <div style={{marginBottom:10, position:'relative'}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,
                  filter: isPremium ? 'none' : 'blur(4px)',
                  userSelect: isPremium ? 'auto' : 'none',
                }}>
                  <span style={{fontSize:8,fontWeight:700,color:T.sub2,letterSpacing:"0.07em",textTransform:"uppercase"}}>Alignment Score</span>
                  <span style={{fontSize:24,fontWeight:900,color:alignColor,fontFamily:"monospace",
                    letterSpacing:"-1px",lineHeight:1}}>{conf.alignment}</span>
                </div>
                <div style={{height:4,background:T.border,borderRadius:99,overflow:"hidden",
                  filter: isPremium ? 'none' : 'blur(3px)',
                }}>
                  <div style={{
                    width:`${conf.alignment}%`,height:"100%",borderRadius:99,
                    background:"linear-gradient(90deg,#ef4444 0%,#f59e0b 40%,#22c55e 75%)",
                    transition:"width 0.8s ease",
                  }}/>
                </div>
              </div>

              {/* Use case + conviction */}
              <div style={{paddingTop:8,borderTop:`1px solid ${T.border}`,position:'relative'}}>
                <div style={{
                  filter: isPremium ? 'none' : 'blur(3px)',
                  opacity: isPremium ? 1 : 0.5,
                  userSelect: isPremium ? 'auto' : 'none',
                }}>
                  <div style={{fontSize:10,color:T.sub,lineHeight:1.5,marginBottom:5}}>
                    🎯 {conf.useCase}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    {[1,2,3].map(i=>(
                      <div key={i} style={{
                        width:6,height:6,borderRadius:"50%",
                        background:i<=conf.convictionCfg.dots?conf.convictionCfg.color:T.border,
                        transition:"background 0.2s",
                      }}/>
                    ))}
                    <span style={{fontSize:9,color:conf.convictionCfg.color,fontWeight:600,marginLeft:2}}>
                      {conf.convictionCfg.label}
                    </span>
                  </div>
                </div>
                {/* Paywall inline lock — only for first card, not all 3 */}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer legend */}
      <div style={{
        padding: isMobile?"8px 12px 12px":"8px 20px 12px",
        display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        borderTop:`1px solid ${T.border}`,
      }}>
        {[
          {label:"STRUCTURAL ALIGNMENT", color:"#22c55e"},
          {label:"PULLBACK MONITORING",  color:"#f59e0b"},
          {label:"HTF/TACTICAL CONFLICT",color:"#f97316"},
          {label:"EARLY ROTATION",       color:"#06b6d4"},
        ].map(({label,color})=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:6,height:6,borderRadius:1,background:color,flexShrink:0}}/>
            <span style={{fontSize:8,color:T.sub2,letterSpacing:"0.04em"}}>{label}</span>
          </div>
        ))}
        <span style={{fontSize:8,color:T.sub2,marginLeft:"auto",opacity:0.7}}>
          No es señal de entrada · Macro HTF + Táctico LTF
        </span>
      </div>

      {/* ── PAYWALL CTA (free users only) ── */}
      {!isPremium && (
        <div style={{
          margin:'0 16px 14px',
          padding:'12px 14px',
          borderRadius:10,
          background: darkMode ? 'rgba(0,85,204,0.07)' : 'rgba(0,85,204,0.04)',
          border:'1px solid rgba(0,85,204,0.18)',
          display:'flex',
          alignItems:'center',
          gap:12,
        }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:700, color: darkMode ? '#c8d0e0' : '#1e293b', marginBottom:3 }}>
              Sin estos datos estás operando sin contexto completo
            </div>
            <div style={{ fontSize:10, color:T.sub, lineHeight:1.4 }}>
              Los datos completos están reservados para usuarios premium.
            </div>
          </div>
          <button
            onClick={onUpgrade}
            style={{
              flexShrink:0,
              padding:'8px 14px',
              borderRadius:8,
              border:'none',
              background:'#0055cc',
              color:'white',
              fontSize:11,
              fontWeight:700,
              cursor:'pointer',
              whiteSpace:'nowrap',
              boxShadow:'0 2px 8px rgba(0,85,204,0.3)',
            }}
          >
            Ver el análisis completo ahora
          </button>
        </div>
      )}
    </div>
  );
}



export { CONFLUENCE_CFG, buildPairConfluence, MarketDecisionLayer };
export default MarketDecisionLayer;
