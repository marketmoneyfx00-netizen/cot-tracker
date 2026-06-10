import { useState, useMemo } from "react";
import TooltipInfo from "./TooltipInfo.jsx";
import { CROSS_ASSET_FLOW_ASSETS } from "../parseTiffCombined.js";

// ─── Signal config ──────────────────────────────────────────────────────────
const SIGNAL_CFG_CAF = {
  buy:        { icon:"▲", label:"Alcista",    color:"#22c55e", bg:"rgba(34,197,94,0.10)",   border:"rgba(34,197,94,0.25)"  },
  sell:       { icon:"▼", label:"Bajista",    color:"#ef4444", bg:"rgba(239,68,68,0.10)",   border:"rgba(239,68,68,0.25)"  },
  wait:       { icon:"–", label:"Neutro",     color:"#6b7280", bg:"rgba(107,114,128,0.08)", border:"rgba(107,114,128,0.2)" },
  indecision: { icon:"↔", label:"Divergente", color:"#f59e0b", bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.2)"  },
};

function CAFAssetCard({ asset, darkMode, T, isMobile, isExp, onToggle }) {
  const [hovered, setHovered] = useState(false);
  const { latest, signal, emoji, asset:assetKey } = asset;
  const cfg      = SIGNAL_CFG_CAF[signal?.signal] || SIGNAL_CFG_CAF.wait;
  const pctL     = latest?.smartPctL ?? 50;
  const netColor = latest?.smartNet > 0 ? "#22c55e" : latest?.smartNet < 0 ? "#ef4444" : T.sub;

  const fK = n => {
    if (n == null || isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1000000) return (n < 0 ? "-" : "+") + (a / 1000000).toFixed(1) + "M";
    if (a >= 1000)    return (n < 0 ? "-" : "+") + (a / 1000).toFixed(1) + "K";
    return (n > 0 ? "+" : "") + n;
  };
  const fKChg = n => {
    if (n == null || isNaN(n) || n === 0) return null;
    const a = Math.abs(n); const sign = n > 0 ? "▲ +" : "▼ ";
    return sign + (a >= 1000 ? (a/1000).toFixed(1)+"K" : a);
  };
  const chgStr   = fKChg(latest?.levChgNet);
  const chgColor = latest?.levChgNet > 0 ? "#22c55e" : latest?.levChgNet < 0 ? "#ef4444" : T.sub2;

  // Card bg: always dark, slight lift on hover/expand
  const cardBg = isExp
    ? (darkMode ? "rgba(139,92,246,0.08)" : "rgba(139,92,246,0.05)")
    : hovered
    ? (darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)")
    : "transparent";

  const detailBg = darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: cardBg,
        border: `1px solid ${isExp ? "rgba(139,92,246,0.35)" : hovered ? T.border : T.border}`,
        borderRadius: 10,
        padding: isMobile ? "10px 11px 0" : "12px 14px 0",
        transition: "background 0.15s, border-color 0.15s",
        overflow: "visible", // never clip tooltips
      }}
    >
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ fontSize: isMobile ? 12 : 14 }}>{emoji}</span>
          <span style={{ fontSize: isMobile ? 11 : 12, fontWeight:700, color:T.txt, fontFamily:"monospace", letterSpacing:"0.03em" }}>
            {assetKey}
          </span>
        </div>
        <span style={{
          fontSize:9, fontWeight:700, color:cfg.color,
          background:cfg.bg, border:`1px solid ${cfg.border}`,
          padding:"2px 7px", borderRadius:99, letterSpacing:"0.04em",
        }}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      {/* Net position */}
      <div style={{ fontSize: isMobile ? 18 : 22, fontWeight:800, color:netColor,
        fontFamily:"monospace", letterSpacing:"-0.5px", marginBottom: chgStr ? 2 : 6 }}>
        {fK(latest?.smartNet)}
      </div>

      {/* Weekly change */}
      {chgStr && (
        <div style={{ fontSize:10, fontWeight:600, color:chgColor, marginBottom:6 }}>
          {chgStr} sem.
        </div>
      )}

      {/* Sentiment micro-bar */}
      <div style={{ height:3, background:T.border, borderRadius:99, overflow:"hidden", marginBottom:3 }}>
        <div style={{ width:`${pctL}%`, height:"100%", borderRadius:99,
          background:`linear-gradient(90deg, #ef4444, #22c55e)`, transition:"width 0.5s" }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 8 }}>
        <span style={{ fontSize:8, color:T.sub2 }}>B {100-pctL}%</span>
        <span style={{ fontSize:8, color:T.sub2 }}>L {pctL}%</span>
      </div>

      {/* Expanded detail */}
      {isExp && (
        <div style={{ paddingBottom:12, borderTop:`1px solid ${T.border}`, paddingTop:10, marginTop:2 }}>
          <div style={{ fontSize:9, color:T.sub, lineHeight:1.6, marginBottom:8 }}>
            {signal?.reason}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
            {[
              { label:"Largo Apalancado",  val:fK(latest?.levLong),   color:"#22c55e" },
              { label:"Corto Apalancado", val:fK(latest?.levShort),  color:"#ef4444" },
              { label:"Neto Activos",     val:fK(latest?.assetNet),  color:(latest?.assetNet??0)>=0?"#22c55e":"#ef4444" },
              { label:"Neto Dealer",      val:fK(latest?.dealerNet), color:(latest?.dealerNet??0)>=0?"#22c55e":"#ef4444" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background:detailBg, borderRadius:6, padding:"6px 8px" }}>
                <div style={{ fontSize:8, color:T.sub2, marginBottom:2, letterSpacing:"0.05em" }}>{label}</div>
                <div style={{ fontSize:12, fontWeight:700, color, fontFamily:"monospace" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA — always visible */}
      <button
        onClick={onToggle}
        style={{
          width:"100%", background:"transparent",
          border:"none", borderTop:`1px solid ${T.border}`,
          padding:"7px 0", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:5,
          color: isExp ? "#8b5cf6" : T.sub2,
          fontSize:10, fontWeight:600, letterSpacing:"0.02em",
          transition:"color 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "#8b5cf6"}
        onMouseLeave={e => e.currentTarget.style.color = isExp ? "#8b5cf6" : T.sub2}
      >
        <span>Ver desglose de factores</span>
        <span style={{
          fontSize:8, display:"inline-block",
          transform: isExp ? "rotate(180deg)" : "rotate(0deg)",
          transition:"transform 0.2s ease",
        }}>▼</span>
      </button>
    </div>
  );
}

function CrossAssetFlow({ combinedData, darkMode, T, isMobile, isPremium = true, onUpgrade }) {
  const [expanded, setExpanded] = useState(new Set());

  if (!combinedData || combinedData.assetCount === 0) return null;

  const { byAsset, reportDate } = combinedData;
  const displayAssets = CROSS_ASSET_FLOW_ASSETS.map(k => byAsset[k]).filter(Boolean);
  if (displayAssets.length === 0) return null;

  const allSignals  = displayAssets.map(a => a.signal?.signal).filter(Boolean);
  const bullCount   = allSignals.filter(s => s === "buy").length;
  const bearCount   = allSignals.filter(s => s === "sell").length;
  const totalAbsNet = displayAssets.reduce((s, a) => s + Math.abs(a.latest?.smartNet || 0), 0);
  const weightedBull= displayAssets.filter(a => a.signal?.signal === "buy")
    .reduce((s, a) => s + Math.abs(a.latest?.smartNet || 0), 0);
  const flowBias  = totalAbsNet > 0 ? Math.round((weightedBull / totalAbsNet) * 100) : 50;
  const flowColor = flowBias >= 55 ? "#22c55e" : flowBias <= 45 ? "#ef4444" : "#f59e0b";

  const GROUP_LABELS = { fx:"FX & USD", index:"Índices", bonds:"Bonos EE.UU.", commodities:"Materias Primas" };
  const GROUP_ICONS  = { fx:"💱", index:"📈", bonds:"🏛️", commodities:"🥇" };
  const GROUP_COLS   = { fx:4, index:3, bonds:4, commodities:4 };

  return (
    <div style={{
      marginBottom:16, background:T.card,
      border:`1px solid ${T.border}`, borderRadius:14,
    }}>
      {/* HEADER */}
      <div style={{
        padding: isMobile ? "14px 14px 12px" : "16px 20px 14px",
        borderBottom:`1px solid ${T.border}`,
        background: darkMode ? "rgba(139,92,246,0.04)" : "rgba(139,92,246,0.02)",
        borderRadius:"14px 14px 0 0",
      }}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:"#8b5cf6",boxShadow:"0 0 8px #8b5cf6",flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:700,color:T.sub,letterSpacing:"0.08em"}}>INSTITUTIONAL CROSS ASSET FLOW</span>
            <TooltipInfo text="Flujo institucional multi-activo basado en CFTC TFF Futures+Options Combined. Muestra posicionamiento neto de Leveraged Money en FX, índices y bonos simultáneamente." align="left"/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:9,color:T.sub2,background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)",
              border:`1px solid ${T.border}`,padding:"2px 8px",borderRadius:99,letterSpacing:"0.06em"}}>
              COMBINED · {reportDate}
            </span>
            <span style={{fontSize:10,fontWeight:700,color:"#8b5cf6",background:"rgba(139,92,246,0.12)",
              border:"1px solid rgba(139,92,246,0.3)",padding:"2px 8px",borderRadius:99}}>
              {combinedData.assetCount} activos
            </span>
          </div>
        </div>
        {/* Global Market Flow bar */}
        <div style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:9,fontWeight:700,color:T.sub2,letterSpacing:"0.07em",textTransform:"uppercase"}}>
              Global Market Flow
            </span>
            <TooltipInfo
              text="Balance agregado de posicionamiento institucional (Leveraged Money) ponderado por volumen en los 16 activos del informe Combined. Horizonte: semanal. Un valor >55% indica flujo neto alcista institucional. No mide dirección inmediata del precio."
              align="left"
            />
            <div style={{flex:1}}/>
            <span style={{fontSize:9,fontWeight:700,color:"#ef4444",opacity:0.7,letterSpacing:"0.04em"}}>Risk-Off</span>
            <div style={{width:120,height:5,background:T.border,borderRadius:99,overflow:"hidden",position:"relative"}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${flowBias}%`,
                background:`linear-gradient(90deg,#ef4444 0%,${flowColor} 50%,#22c55e 100%)`,
                borderRadius:99,transition:"width 0.7s ease"}}/>
              <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:T.sub2,opacity:0.3}}/>
            </div>
            <span style={{fontSize:9,fontWeight:700,color:"#22c55e",opacity:0.7,letterSpacing:"0.04em"}}>Risk-On</span>
            <span style={{fontSize:16,fontWeight:900,color:flowColor,minWidth:42,textAlign:"right",
              fontFamily:"monospace",letterSpacing:"-0.5px"}}>{flowBias}%</span>
          </div>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            {[{label:`${bullCount} alcistas`,color:"#22c55e"},{label:`${bearCount} bajistas`,color:"#ef4444"},
              {label:`${displayAssets.length-bullCount-bearCount} neutros`,color:T.sub2}].map(({label,color})=>(
              <span key={label} style={{fontSize:10,fontWeight:600,color}}>{label}</span>
            ))}
            <span style={{fontSize:9,color:T.sub2,marginLeft:"auto",fontStyle:"italic"}}>
              Lectura agregada · No equivale a dirección inmediata del precio
            </span>
          </div>
        </div>
      </div>

      {/* ASSET GRID */}
      <div style={{padding: isMobile ? "12px" : "16px 20px", position:'relative'}}>
        <style>{"@keyframes cafFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}"}</style>
        {["fx","index","bonds","commodities"].map((groupKey, groupIdx) => {
          const groupAssets = displayAssets.filter(a => a.group === groupKey);
          if (groupAssets.length === 0) return null;
          const cols = isMobile ? 2 : Math.min(groupAssets.length, GROUP_COLS[groupKey]||4);
          // Free users: FX group visible, index+bonds blurred
          const isLocked = !isPremium && groupIdx > 0;
          return (
            <div key={groupKey} style={{marginBottom:16, position:'relative'}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                <span style={{fontSize:14,lineHeight:1}}>{GROUP_ICONS[groupKey]}</span>
                <span style={{fontSize:10,fontWeight:700,color:T.sub,letterSpacing:"0.08em",textTransform:"uppercase"}}>
                  {GROUP_LABELS[groupKey]}
                </span>
                <div style={{flex:1,height:1,background:T.border}}/>
                <span style={{fontSize:9,color:T.sub2}}>
                  {groupAssets.filter(a=>a.signal?.signal==="buy").length}↑{" "}
                  {groupAssets.filter(a=>a.signal?.signal==="sell").length}↓
                </span>
              </div>
              <div style={{
                display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:isMobile?7:10,
                filter: isLocked ? 'blur(3px)' : 'none',
                opacity: isLocked ? 0.5 : 1,
                pointerEvents: isLocked ? 'none' : 'auto',
                userSelect: isLocked ? 'none' : 'auto',
                transition:'filter 0.2s, opacity 0.2s',
              }}>
                {groupAssets.map((asset,idx) => (
                  <div key={asset.asset} style={{animation:"cafFadeIn 0.2s ease both",animationDelay:`${idx*0.04}s`}}>
                    <CAFAssetCard
                      asset={asset} darkMode={darkMode} T={T} isMobile={isMobile}
                      isExp={expanded.has(asset.asset)}
                      onToggle={()=>setExpanded(prev=>{const s=new Set(prev);s.has(asset.asset)?s.delete(asset.asset):s.add(asset.asset);return s;})}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Paywall CTA — free users only */}
        {!isPremium && (
          <div style={{
            padding:'12px 14px', marginBottom:8,
            borderRadius:10,
            background: darkMode ? 'rgba(0,85,204,0.07)' : 'rgba(0,85,204,0.04)',
            border:'1px solid rgba(0,85,204,0.18)',
            display:'flex', alignItems:'center', gap:12,
          }}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:700,color: darkMode ? '#c8d0e0' : '#1e293b',marginBottom:3}}>
                Sin estos datos estás operando sin contexto completo
              </div>
              <div style={{fontSize:10,color:T.sub,lineHeight:1.4}}>
                Los datos completos están reservados para usuarios premium.
              </div>
            </div>
            <button
              onClick={onUpgrade}
              style={{
                flexShrink:0, padding:'8px 14px', borderRadius:8,
                border:'none', background:'#0055cc', color:'white',
                fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                boxShadow:'0 2px 8px rgba(0,85,204,0.3)',
              }}
            >
              Ver el análisis completo ahora
            </button>
          </div>
        )}

        <div style={{fontSize:9,color:T.sub2,textAlign:"center",paddingTop:10,
          borderTop:`1px solid ${T.border}`,letterSpacing:"0.03em"}}>
          Posicionamiento institucional · CFTC TFF Futures+Options Combined · Leveraged Money
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLUENCE ENGINE — Market Decision Layer logic
// ─────────────────────────────────────────────────────────────────────────────

export { CrossAssetFlow, CAFAssetCard, SIGNAL_CFG_CAF };
export default CrossAssetFlow;
