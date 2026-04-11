import { useState, useRef, useCallback, useEffect, Component } from "react";
import { getIndicatorLogic } from './marketLogic.js';
import { calculateBiasScore, deriveInputsFromPair } from './cotBiasEngine.js';
import IntradayExecutionCard from './components/IntradayExecutionCard.jsx';
import { useAuth } from './components/AuthProvider.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { logout } from './lib/authService.js';


// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
// Auth: Supabase (see src/lib/authService.js + src/components/AuthProvider.jsx)
// GAS_URL removed — no longer used for auth
// STORAGE_KEY removed — session managed by Supabase, not localStorage
const STORAGE_KEY = "cot_user_registered"; // kept for dark/lang prefs only
// ─────────────────────────────────────────────────────────────────────────────
const CONTRACT_MAP = [
  { keys: ["EURO FX - CHICAGO MERCANTILE", "EURO FX - CHICAGO"],           pair: "EUR/USD",   cat: "fx", invert: false },
  { keys: ["BRITISH POUND - CHICAGO MERCANTILE", "BRITISH POUND - CHICAGO"],pair: "GBP/USD",   cat: "fx", invert: false },
  { keys: ["JAPANESE YEN - CHICAGO MERCANTILE", "JAPANESE YEN - CHICAGO"],  pair: "USD/JPY",   cat: "fx", invert: true  },
  { keys: ["SWISS FRANC - CHICAGO MERCANTILE", "SWISS FRANC - CHICAGO"],    pair: "USD/CHF",   cat: "fx", invert: true  },
  { keys: ["CANADIAN DOLLAR - CHICAGO MERCANTILE", "CANADIAN DOLLAR - CHICAGO"], pair: "USD/CAD", cat: "fx", invert: true  },
  { keys: ["AUSTRALIAN DOLLAR - CHICAGO MERCANTILE", "AUSTRALIAN DOLLAR - CHICAGO"], pair: "AUD/USD", cat: "fx", invert: false },
  { keys: ["NZ DOLLAR - CHICAGO", "NEW ZEALAND DOLLAR"],                    pair: "NZD/USD",   cat: "fx", invert: false },
  { keys: ["USD INDEX - ICE FUTURES", "USD INDEX"],                         pair: "USD Index", cat: "fx", invert: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER (TFF + Legacy)
// ─────────────────────────────────────────────────────────────────────────────
function parseTFFCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("CSV vacío");

  // Parse a CSV line handling quoted fields
  const parseLine = (raw) => {
    const cols = []; let inQ = false, cur = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { cols.push(cur.trim()); cur = ""; } else cur += c;
    }
    cols.push(cur.trim()); return cols;
  };
  const toInt = (s) => { const v = parseInt((s||"0").replace(/,/g,""),10); return isNaN(v)?0:v; };

  const headers = parseLine(lines[0]).map(h=>h.toLowerCase().trim());
  const fi = (name) => headers.findIndex(h=>h.includes(name.toLowerCase()));

  // Column indices
  const iMrkt   = fi("market_and_exchange") !== -1 ? fi("market_and_exchange") : 0;
  const iDateMD  = fi("report_date_as_mm_dd"); // MM/DD/YYYY format -> preferred
  const iDateYY  = fi("as_of_date_in_form");   // YYMMDD format -> fallback
  const iDealerL = fi("dealer_positions_long");
  const iDealerS = fi("dealer_positions_short");
  const iAssetL  = fi("asset_mgr_positions_long");
  const iAssetS  = fi("asset_mgr_positions_short");
  const iLevL    = fi("lev_money_positions_long");
  const iLevS    = fi("lev_money_positions_short");
  const iNcL     = fi("noncomm_positions_long");
  const iNcS     = fi("noncomm_positions_short");
  const iCmL     = fi("comm_positions_long");
  const iCmS     = fi("comm_positions_short");
  const isTFF    = iLevL !== -1;

  // Pick best date column
  const iDate = iDateMD !== -1 ? iDateMD : iDateYY;

  const allRows = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]; if (!raw.trim()) continue;
    const cols = parseLine(raw);
    const market = (cols[iMrkt]||"").toUpperCase().trim();
    if (!market) continue;

    // Normalize date to ISO
    let dateStr = (iDate !== -1 && cols[iDate]) ? cols[iDate].trim() : (cols[2]||cols[1]||"").trim();
    let isoDate = "";
    if (dateStr.includes("/")) {
      const parts = dateStr.split("/");
      if (parts.length === 3) {
        const [m,d,y] = parts;
        isoDate = `${y.length===2?"20"+y:y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
      }
    } else if (dateStr.length === 6) {
      isoDate = `20${dateStr.slice(0,2)}-${dateStr.slice(2,4)}-${dateStr.slice(4,6)}`;
    }
    if (!isoDate) continue;

    if (isTFF) {
      const dL=toInt(cols[iDealerL]),dS=toInt(cols[iDealerS]);
      const aL=toInt(cols[iAssetL]), aS=toInt(cols[iAssetS]);
      const lL=toInt(cols[iLevL]),   lS=toInt(cols[iLevS]);
      allRows.push({market,isoDate,displayDate:dateStr,
        dealerLong:dL,dealerShort:dS,assetLong:aL,assetShort:aS,levLong:lL,levShort:lS,format:"tff"});
    } else {
      const nL=toInt(cols[iNcL!==-1?iNcL:7]), nS=toInt(cols[iNcS!==-1?iNcS:8]);
      const cL=toInt(cols[iCmL!==-1?iCmL:11]),cS=toInt(cols[iCmS!==-1?iCmS:12]);
      if (nL===0&&nS===0) continue;
      allRows.push({market,isoDate,displayDate:dateStr,ncLong:nL,ncShort:nS,commLong:cL,commShort:cS,format:"legacy"});
    }
  }
  return allRows;
}

function matchContract(market) {
  return CONTRACT_MAP.find(c=>c.keys.some(k=>market.startsWith(k.toUpperCase())||market.includes(k.toUpperCase())));
}

function buildProcessedRow(contract, raw) {
  const inv = contract.invert;
  let levLong,levShort,assetLong,assetShort,dealerLong,dealerShort,ncLong,ncShort,commLong,commShort;
  if (raw.format==="tff") {
    levLong=inv?raw.levShort:raw.levLong; levShort=inv?raw.levLong:raw.levShort;
    assetLong=inv?raw.assetShort:raw.assetLong; assetShort=inv?raw.assetLong:raw.assetShort;
    dealerLong=inv?raw.dealerShort:raw.dealerLong; dealerShort=inv?raw.dealerLong:raw.dealerShort;
    ncLong=null;ncShort=null;commLong=null;commShort=null;
  } else {
    ncLong=inv?raw.ncShort:raw.ncLong; ncShort=inv?raw.ncLong:raw.ncShort;
    commLong=inv?raw.commShort:raw.commLong; commShort=inv?raw.commLong:raw.commShort;
    levLong=null;levShort=null;assetLong=null;assetShort=null;dealerLong=null;dealerShort=null;
  }
  const smartLong=levLong??ncLong??0, smartShort=levShort??ncShort??0;
  const smartNet=smartLong-smartShort, smartTotal=smartLong+smartShort;
  const smartPctL=smartTotal>0?Math.round((smartLong/smartTotal)*100):50;
  return {
    pair:contract.pair,cat:contract.cat,invert:inv,isoDate:raw.isoDate,displayDate:raw.displayDate,format:raw.format,
    levLong,levShort,assetLong,assetShort,dealerLong,dealerShort,ncLong,ncShort,commLong,commShort,
    smartNet,smartLong,smartShort,smartTotal,smartPctL,
    assetNet:assetLong!=null?assetLong-assetShort:null,
    dealerNet:dealerLong!=null?dealerLong-dealerShort:null,
    ncNet:ncLong!=null?ncLong-ncShort:null,
    commNet:commLong!=null?commLong-commShort:null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function generateSignal(rows) {
  if (!rows||rows.length===0) return {signal:"wait",strength:0,reason:"Sin datos"};
  const latest=rows[0],prev=rows[1],prev2=rows[2];
  const net=latest.smartNet,pctL=latest.smartPctL;
  const trend=prev?net-prev.smartNet:0;
  const assetAligned=latest.assetNet!=null?(net>0&&latest.assetNet>0)||(net<0&&latest.assetNet<0):null;
  let streak=1;
  for (let i=1;i<rows.length;i++) {
    if (net>0&&rows[i].smartNet>0) streak++;
    else if (net<0&&rows[i].smartNet<0) streak++;
    else break;
  }
  const extremeLong=pctL>=80,extremeShort=pctL<=20;
  const accelerating=Math.abs(trend)>Math.abs(prev2?prev.smartNet-prev2.smartNet:0);
  if (extremeLong&&trend<0) return {signal:"sell",strength:3,reason:`Posición larga extrema (${pctL}%) con reversión — institucionales reduciendo largos`};
  if (extremeShort&&trend>0) return {signal:"buy",strength:3,reason:`Posicionamiento corto extremo (${pctL}% largo) con inversión — Leveraged Money cubriendo posiciones cortas`};
  if (net>0&&trend>0&&streak>=2&&assetAligned!==false) return {signal:"buy",strength:streak>=3?(accelerating?3:2):1,reason:`Sesgo Alcista ${streak>=3?"confirmado":"detectado"} — ${streak} informes CFTC consecutivos con acumulación neta positiva. Asset Managers ${assetAligned?"alineados":"divergentes"}.`};
  if (net<0&&trend<0&&streak>=2&&assetAligned!==false) return {signal:"sell",strength:streak>=3?(accelerating?3:2):1,reason:`Sesgo Bajista ${streak>=3?"confirmado":"detectado"} — ${streak} informes CFTC consecutivos con reducción neta. Asset Managers ${assetAligned?"alineados":"divergentes"}.`};
  if (net>0&&trend>0) return {signal:"buy",strength:1,reason:`Sesgo Alcista incipiente — acumulación neta positiva de Leveraged Money. Pendiente de confirmación en próximo informe CFTC.`};
  if (net<0&&trend<0) return {signal:"sell",strength:1,reason:`Sesgo Bajista incipiente — reducción neta de Leveraged Money. Pendiente de confirmación en próximo informe CFTC.`};
  if (Math.abs(net)<5000||(trend>0&&net<0)||(trend<0&&net>0)) return {signal:"indecision",strength:0,reason:`Datos divergentes entre Leveraged Money y Asset Managers — posible cambio de sesgo en curso`};
  return {signal:"wait",strength:0,reason:`Posicionamiento neutro sin sesgo definido — aguardar confirmación en próximo informe CFTC`};
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fK=(n)=>{if(n==null||isNaN(n))return"—";const a=Math.abs(n);if(a>=1000)return(n<0?"-":"+")+( a/1000).toFixed(1)+"K";return(n>0?"+":"")+n;};
const fFull=(n)=>n==null?"—":n.toLocaleString("en-US");
const today=()=>new Date().toISOString().slice(0,10);
const weeksAgo=(n)=>{const d=new Date();d.setDate(d.getDate()-n*7);return d.toISOString().slice(0,10);};

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SIGNAL_CFG = {
  buy:        {icon:"▲",label:"Sesgo Alcista", bg:"rgba(136,201,153,0.15)", border:"rgba(136,201,153,0.4)",  fg:"#2e7d4f",dot:"#88C999"},
  sell:       {icon:"▼",label:"Sesgo Bajista", bg:"rgba(239,154,154,0.15)", border:"rgba(239,154,154,0.4)",  fg:"#b71c1c",dot:"#EF9A9A"},
  wait:       {icon:"–",label:"Neutro",        bg:"rgba(180,180,180,0.10)", border:"rgba(180,180,180,0.25)", fg:"#616161",dot:"#BDBDBD"},
  indecision: {icon:"↔",label:"Divergente",    bg:"rgba(180,180,180,0.10)", border:"rgba(180,180,180,0.25)", fg:"#757575",dot:"#9E9E9E"},
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function SentimentBar({pct}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{fontSize:10,color:"#34c759",minWidth:24,textAlign:"right"}}>{pct}%</span>
      <div style={{flex:1,height:3,background:"rgba(255,59,48,0.2)",borderRadius:99,overflow:"hidden",minWidth:40}}>
        <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#30d158,#34c759)",borderRadius:99,transition:"width 0.6s"}}/>
      </div>
      <span style={{fontSize:10,color:"#ff3b30",minWidth:24}}>{100-pct}%</span>
    </div>
  );
}

function SignalBadge({signal,size="sm"}) {
  const cfg=SIGNAL_CFG[signal]||SIGNAL_CFG.wait;
  const big=size==="lg";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:big?6:4,background:cfg.bg,color:cfg.fg,
      border:`1px solid ${cfg.border}`,padding:big?"6px 14px":"3px 9px",borderRadius:99,
      fontSize:big?13:11,fontWeight:700,whiteSpace:"nowrap"}}>
      <span style={{fontSize:big?14:12}}>{cfg.icon}</span>{cfg.label}
    </span>
  );
}

function StrengthDots({strength}) {
  return (
    <div style={{display:"flex",gap:3,alignItems:"center"}}>
      {[1,2,3].map(i=>(
        <div key={i} style={{width:5,height:5,borderRadius:"50%",background:i<=strength?"#ff9500":"#e5e5ea"}}/>
      ))}
    </div>
  );
}

// ─── INSTITUTIONAL BIAS CARD ──────────────────────────────────────────────────
function InstitutionalBiasCard({ biasResult, darkMode, T, isMobile }) {
  const [expanded, setExpanded] = useState(false);
  if (!biasResult) return null;

  const {
    score = 0,
    label = 'Neutral / Range',
    direction = 'neutral',
    color = '#94a3b8',
    recommendation = 'Waiting for new COT data',
    breakdown = {},
  } = biasResult || {};

  // Gauge: map -5..+5 to 0..100%
  const pct = ((score + 5) / 10) * 100;

  // Track colors
  const trackBg = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // Gradient based on score
  const barGradient = score > 0
    ? `linear-gradient(90deg, ${trackBg} 0%, ${trackBg} 50%, ${color}CC 50%, ${color} ${pct}%)`
    : `linear-gradient(90deg, ${color} ${pct}%, ${color}CC ${pct}%, ${trackBg} 50%, ${trackBg} 100%)`;

  // Breakdown items
  const rows = [
    { key: 'Leveraged Flow',    val: breakdown?.leveragedFlow  ?? 0 },
    { key: 'Divergence',        val: breakdown?.divergence     ?? 0 },
    { key: 'Historical Extreme',val: breakdown?.percentile     ?? 0 },
    { key: 'Asset Managers',    val: breakdown?.assetManagers  ?? 0 },
    { key: 'Dealers Filter',    val: breakdown?.dealers        ?? 0 },
  ];

  const fmtVal = v => v > 0 ? `+${v}` : `${v}`;
  const fmtColor = v => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : T.sub;

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${color}55`,
      borderRadius: 14,
      padding: isMobile ? '14px 14px' : '18px 20px',
      marginBottom: 12,
      boxShadow: `0 0 0 1px ${color}22, 0 4px 20px rgba(0,0,0,0.15)`,
    }}>
      {/* Header row */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{
            width:6, height:6, borderRadius:'50%',
            background: color, boxShadow: `0 0 6px ${color}`,
            animation: 'nowPulse 2s ease infinite',
          }}/>
          <span style={{fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.09em'}}>
            INSTITUTIONAL BIAS ENGINE
          </span>
        </div>
        <span style={{fontSize:10,color:T.sub2,background:T.card2,border:`1px solid ${T.border}`,
          padding:'2px 8px',borderRadius:99,letterSpacing:'0.06em'}}>SEMANAL · HTF</span>
      </div>

      {/* Score + Label */}
      <div style={{display:'flex',alignItems:'center',gap:isMobile?12:20,marginBottom:16}}>
        <div style={{
          width: isMobile ? 56 : 68, height: isMobile ? 56 : 68,
          borderRadius: '50%',
          border: `3px solid ${color}`,
          display:'flex',alignItems:'center',justifyContent:'center',
          background: `${color}18`,
          flexShrink: 0,
          boxShadow: `0 0 16px ${color}40`,
        }}>
          <span style={{fontSize: isMobile ? 24 : 30, fontWeight:800, color, lineHeight:1}}>
            {score > 0 ? `+${score}` : score}
          </span>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize: isMobile ? 16 : 18, fontWeight:700, color, marginBottom:4}}>{label}</div>
          <div style={{fontSize: isMobile ? 11 : 12, color:T.sub, lineHeight:1.5}}>{recommendation}</div>
        </div>
      </div>

      {/* Gauge bar — thermometer -5 ◀═══●═══▶ +5 */}
      <div style={{marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
          <span style={{fontSize:10,color:T.sub2,fontWeight:700}}>−5</span>
          <span style={{fontSize:10,color:T.sub2,fontWeight:600,opacity:0.6}}>BEARISH ←  → BULLISH</span>
          <span style={{fontSize:10,color:T.sub2,fontWeight:700}}>+5</span>
        </div>
        <div style={{position:'relative',height:10,borderRadius:99,background:trackBg,overflow:'visible'}}>
          {/* Colored fill */}
          <div style={{
            position:'absolute',
            top:0, bottom:0,
            left: score >= 0 ? '50%' : `${pct}%`,
            width: score >= 0 ? `${(score/10)*100}%` : `${(Math.abs(score)/10)*100}%`,
            background: color,
            borderRadius:99,
            transition:'width 0.6s ease, left 0.6s ease',
          }}/>
          {/* Center line */}
          <div style={{position:'absolute',left:'50%',top:-2,bottom:-2,width:2,
            background:T.border,transform:'translateX(-50%)',borderRadius:1}}/>
          {/* Needle */}
          <div style={{
            position:'absolute',
            left:`${pct}%`,
            top:'50%',
            transform:'translate(-50%,-50%)',
            width:16, height:16, borderRadius:'50%',
            background:color,
            border:`2px solid ${T.bg}`,
            boxShadow:`0 0 8px ${color}`,
            transition:'left 0.6s ease',
            zIndex:2,
          }}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
          {[-5,-4,-3,-2,-1,0,1,2,3,4,5].map(n=>(
            <span key={n} style={{
              fontSize:8,
              color: n===score ? color : T.sub2,
              fontWeight: n===score ? 800 : 400,
            }}>{n}</span>
          ))}
        </div>
      </div>

      {/* Breakdown toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width:'100%',background:'transparent',border:`1px solid ${T.border}`,
          borderRadius:8,padding:'7px 12px',cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',gap:6,
          color:T.sub,fontSize:11,fontWeight:600,
          transition:'border-color 0.2s',
          borderColor: expanded ? `${color}60` : T.border,
        }}>
        <span>{expanded ? 'Ocultar desglose' : 'Ver desglose de factores'}</span>
        <span style={{fontSize:9,display:'inline-block',transform:expanded?'rotate(180deg)':'rotate(0deg)',transition:'transform 0.25s ease'}}>▼</span>
      </button>

      {/* Breakdown rows */}
      {expanded && (
        <div style={{
          marginTop:10,
          overflow:'hidden',
          animation:'fadeIn 0.2s ease',
        }}>
          <div style={{
            background:T.card2,borderRadius:10,
            border:`1px solid ${T.border}`,
            overflow:'hidden',
          }}>
            {rows.map((r,i) => (
              <div key={r.key} style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'9px 14px',
                borderBottom: i < rows.length-1 ? `1px solid ${T.border}` : 'none',
                background: i%2===0 ? 'transparent' : `rgba(255,255,255,${darkMode?'0.02':'0.04'})`,
              }}>
                <span style={{fontSize:12,color:T.sub,fontWeight:500}}>{r.key}</span>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {/* Mini bar for this factor */}
                  <div style={{display:'flex',gap:2,alignItems:'center'}}>
                    {[-2,-1,0,1,2].map(n => (
                      <div key={n} style={{
                        width:8,height:8,borderRadius:2,
                        background: (r.val >= 0 && n > 0 && n <= r.val)
                          ? '#22c55e'
                          : (r.val <= 0 && n < 0 && n >= r.val)
                          ? '#ef4444'
                          : n === 0
                          ? T.border
                          : `rgba(150,150,150,0.15)`,
                        transition:'background 0.3s',
                      }}/>
                    ))}
                  </div>
                  <span style={{
                    fontSize:13,fontWeight:700,
                    color:fmtColor(r.val),
                    minWidth:24,textAlign:'right',
                    fontVariantNumeric:'tabular-nums',
                  }}>{fmtVal(r.val)}</span>
                </div>
              </div>
            ))}
            {/* Total row */}
            <div style={{
              display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'10px 14px',
              background: `${color}14`,
              borderTop:`1px solid ${color}30`,
            }}>
              <span style={{fontSize:12,fontWeight:700,color:T.txt}}>BIAS SCORE</span>
              <span style={{fontSize:18,fontWeight:800,color,fontVariantNumeric:'tabular-nums'}}>
                {score > 0 ? `+${score}` : score}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniSparkline({values,positive}) {
  if (!values||values.length<2) return null;
  const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const W=80,H=24;
  const pts=values.map((v,i)=>`${(i/(values.length-1))*W},${H-((v-min)/range)*(H-4)-2}`).join(" ");
  const color=positive?"#34c759":"#ff3b30";
  const last=pts.split(" ").slice(-1)[0].split(",");
  return (
    <svg width={W} height={H} style={{overflow:"visible"}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color}/>
    </svg>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN  — for returning users who already have a plan
// ─────────────────────────────────────────────────────────────────────────────
const PRESETS=[{label:"4 semanas",weeks:4},{label:"2 meses",weeks:8},{label:"3 meses",weeks:13}];

function buildDownloadUrl(from, to) {
  const base="https://publicreporting.cftc.gov/resource/6dca-aqww.csv";
  const where=`report_date_as_yyyy_mm_dd between '${from}T00:00:00' and '${to}T23:59:59'`;
  return `${base}?${new URLSearchParams({"$where":where,"$order":"report_date_as_yyyy_mm_dd DESC","$limit":"500"})}`;
}

function DownloadPanel() {
  const [from,setFrom]=useState(weeksAgo(8));
  const [to,setTo]=useState(today());
  const [preset,setPreset]=useState(1);
  const [copied,setCopied]=useState(false);
  const applyPreset=(weeks,idx)=>{setFrom(weeksAgo(weeks));setTo(today());setPreset(idx);};
  const dlUrl=buildDownloadUrl(from,to);
  const copyUrl=()=>{navigator.clipboard.writeText(dlUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});};
  return (
    <div style={{background:"white",borderRadius:20,padding:20,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{width:32,height:32,borderRadius:9,background:"linear-gradient(135deg,#0066cc,#34aadc)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 3v13M7 12l5 5 5-5M4 20h16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <p style={{margin:0,fontSize:14,fontWeight:700,color:"#1c1c1e"}}>Descargar del CFTC</p>
          <p style={{margin:0,fontSize:12,color:"#8e8e93"}}>Elige rango → descarga → arrastra abajo</p>
        </div>
      </div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
        {PRESETS.map((p,i)=>(
          <button key={i} onClick={()=>applyPreset(p.weeks,i)} style={{
            padding:"6px 14px",borderRadius:99,border:"none",cursor:"pointer",fontSize:12,fontWeight:500,
            background:preset===i?"#0066cc":"#f2f2f7",color:preset===i?"white":"#3c3c43",transition:"all 0.15s",
          }}>{p.label}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[["Desde",from,setFrom],["Hasta",to,setTo]].map(([l,v,s])=>(
          <div key={l}>
            <label style={{display:"block",fontSize:10,fontWeight:600,color:"#8e8e93",marginBottom:4,letterSpacing:"0.05em",textTransform:"uppercase"}}>{l}</label>
            <input type="date" value={v} max={today()} onChange={e=>{s(e.target.value);setPreset(null);}}
              style={{width:"100%",padding:"9px 10px",borderRadius:10,border:"1.5px solid #e5e5ea",fontSize:13,color:"#1c1c1e",background:"#f9f9fb",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
          </div>
        ))}
      </div>
      <a href={dlUrl} target="_blank" rel="noreferrer" style={{
        display:"block",textAlign:"center",padding:"12px",borderRadius:12,
        background:"linear-gradient(135deg,#0066cc,#0077ed)",color:"white",
        fontSize:14,fontWeight:600,textDecoration:"none",boxShadow:"0 3px 12px rgba(0,102,204,0.3)",
      }}>🔗 Descargar CSV del CFTC</a>
      <p style={{margin:"10px 0 0",fontSize:11,color:"#aeaeb2",textAlign:"center"}}>
        Descarga el .csv y arrástralo a la zona de abajo
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DROP ZONE
// ─────────────────────────────────────────────────────────────────────────────
function DropZone({onFile}) {
  const [drag,setDrag]=useState(false);
  const handle=useCallback((file)=>{
    if (!file) return;
    const r=new FileReader(); r.onload=e=>onFile(e.target.result,file.name); r.readAsText(file);
  },[onFile]);
  return (
    <div onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}}
      style={{border:`2px dashed ${drag?"#0066cc":"#d1d1d6"}`,borderRadius:18,padding:"24px 20px",
        textAlign:"center",background:drag?"rgba(0,102,204,0.04)":"#f9f9fb",transition:"all 0.2s"}}>
      <input id="cot-csv-input" type="file" accept=".csv,.txt" style={{display:"none"}}
        onChange={e=>handle(e.target.files[0])}/>
      <div style={{width:40,height:40,borderRadius:12,background:drag?"rgba(0,102,204,0.1)":"#ededf0",
        display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px"}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 16V8M12 8L8 12M12 8L16 12" stroke={drag?"#0066cc":"#8e8e93"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 16.5V18.75C3 19.993 4.007 21 5.25 21H18.75C19.993 21 21 19.993 21 18.75V16.5" stroke={drag?"#0066cc":"#8e8e93"} strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </div>
      <p style={{margin:"0 0 4px",fontSize:14,fontWeight:600,color:drag?"#0066cc":"#1c1c1e"}}>{drag?"Suelta el archivo":"Arrastra el CSV aquí"}</p>
      <p style={{margin:"0 0 14px",fontSize:12,color:"#8e8e93"}}>Compatible con TFF y Legacy · .csv .txt</p>
      <label htmlFor="cot-csv-input" style={{display:"inline-flex",alignItems:"center",gap:8,
        padding:"11px 22px",borderRadius:10,border:"1.5px solid #0066cc",
        background:"white",color:"#0066cc",fontSize:14,fontWeight:700,cursor:"pointer"}}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Seleccionar archivo CSV
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEATMAP + TOOLTIP HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function heatCell(val, type="net") {
  // type: "long" | "short" | "net"
  if (val == null || isNaN(val)) return {background:"transparent", color:"#9E9E9E"};
  const abs = Math.abs(val);
  const strong = abs >= 10000;
  if (type === "long") {
    return {
      background: strong ? "rgba(136,201,153,0.55)" : "rgba(136,201,153,0.22)",
      color: strong ? "#1a5c2e" : "#2e7d4f",
    };
  }
  if (type === "short") {
    return {
      background: strong ? "rgba(239,154,154,0.55)" : "rgba(239,154,154,0.22)",
      color: strong ? "#7b0f0f" : "#b71c1c",
    };
  }
  // net: sign-based
  if (val > 0) return {
    background: strong ? "rgba(136,201,153,0.55)" : "rgba(136,201,153,0.22)",
    color: strong ? "#1a5c2e" : "#2e7d4f",
  };
  if (val < 0) return {
    background: strong ? "rgba(239,154,154,0.55)" : "rgba(239,154,154,0.22)",
    color: strong ? "#7b0f0f" : "#b71c1c",
  };
  return {background:"rgba(180,180,180,0.08)", color:"#9E9E9E"};
}

function InfoTooltip({text}) {
  const [pos, setPos] = useState(null);
  const TIP_W = 240, TIP_H = 80;

  const handleEnter = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // Prefer above, fall back below; prefer left-align, fall back right-align
    const top  = r.top > TIP_H + 12 ? r.top - TIP_H - 8 : r.bottom + 8;
    const left = Math.min(Math.max(r.left - TIP_W/2 + 6, 8), vw - TIP_W - 8);
    setPos({top, left, above: r.top > TIP_H + 12});
  };

  return (
    <span style={{position:"relative", display:"inline-flex", alignItems:"center"}}>
      <span
        onMouseEnter={handleEnter}
        onMouseLeave={()=>setPos(null)}
        style={{
          width:13, height:13, borderRadius:"50%",
          background:"#e5e7eb", color:"#6b7280",
          fontSize:8, fontWeight:700, fontFamily:"monospace",
          display:"inline-flex", alignItems:"center", justifyContent:"center",
          cursor:"help", marginLeft:4, flexShrink:0,
          border:"1px solid #d1d5db", userSelect:"none",
        }}>i</span>
      {pos && (
        <span style={{
          position:"fixed",
          top: pos.top,
          left: pos.left,
          width: TIP_W,
          background:"#1a1d23", color:"#e8eaf0",
          fontSize:11, lineHeight:1.6, padding:"9px 13px",
          borderRadius:5, zIndex:99999,
          boxShadow:"0 6px 24px rgba(0,0,0,0.45)",
          pointerEvents:"none",
          whiteSpace:"normal",
        }}>
          {text}
          <span style={{
            position:"absolute",
            ...(pos.above
              ? {top:"100%", borderTopColor:"#1a1d23", borderBottomColor:"transparent"}
              : {bottom:"100%", borderBottomColor:"#1a1d23", borderTopColor:"transparent"}
            ),
            left:20,
            border:"5px solid transparent",
          }}/>
        </span>
      )}
    </span>
  );
}

const TOOLTIPS = {
  levLong:  "Contratos de compra abiertos por Hedge Funds y CTAs (Leveraged Money). Un incremento sostenido indica acumulación de posiciones largas.",
  levShort: "Contratos de venta abiertos por Hedge Funds y CTAs (Leveraged Money). Un incremento sostenido indica distribución o posicionamiento bajista.",
  levNet:   "Posición neta de Leveraged Money (Longs - Shorts). Es el indicador principal del Sesgo de Mercado. Positivo = sesgo alcista.",
  assetNet: "Posicionamiento neto de Asset Managers (fondos institucionales a largo plazo). Cuando coincide con Lev. Net, confirma la tendencia.",
  dealerNet:"Posición neta de Dealers e intermediarios financieros. Suelen actuar como contraparte; su sesgo frecuentemente es opuesto al precio.",
};

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL SHEET — vertical table with heatmap, tooltips, no tab selector
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({pairData, onClose}) {
  if (!pairData) return null;
  const {pair, weeks, signal} = pairData;
  const isTFF = weeks[0]?.format === "tff";
  const rows  = weeks.slice(0, 10);

  const ACTION = {
    buy:        {icon:"▲", label:"SESGO ALCISTA",  color:"#2e7d4f", bg:"rgba(136,201,153,0.10)", border:"rgba(136,201,153,0.3)"},
    sell:       {icon:"▼", label:"SESGO BAJISTA",  color:"#b71c1c", bg:"rgba(239,154,154,0.10)", border:"rgba(239,154,154,0.3)"},
    wait:       {icon:"–", label:"NEUTRO",          color:"#616161", bg:"rgba(180,180,180,0.08)", border:"rgba(180,180,180,0.2)"},
    indecision: {icon:"↔", label:"DIVERGENTE",      color:"#757575", bg:"rgba(180,180,180,0.08)", border:"rgba(180,180,180,0.2)"},
  };
  const action = ACTION[signal.signal] || ACTION.wait;

  const fN = (n) => n == null ? "—" : n.toLocaleString("en-US", {signDisplay:"exceptZero"});

  // Column definitions: label, key, tooltip key, type for heatmap
  const TFF_COLS = [
    {label:"Lev. Long",    key:"levLong",   tip:"levLong",  htype:"long"},
    {label:"Lev. Short",   key:"levShort",  tip:"levShort", htype:"short"},
    {label:"Lev. Net",     key:"smartNet",  tip:"levNet",   htype:"net"},
    {label:"Asset Mgr Net",key:"assetNet",  tip:"assetNet", htype:"net"},
    {label:"Dealer Net",   key:"dealerNet", tip:"dealerNet",htype:"net"},
  ];
  const LEG_COLS = [
    {label:"NC Long",  key:"ncLong",  tip:null, htype:"long"},
    {label:"NC Short", key:"ncShort", tip:null, htype:"short"},
    {label:"NC Net",   key:"ncNet",   tip:"levNet", htype:"net"},
    {label:"Comm Net", key:"commNet", tip:null, htype:"net"},
  ];
  const COLS = isTFF ? TFF_COLS : LEG_COLS;
  const gridCols = `80px repeat(${COLS.length}, 1fr)`;

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:200,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"16px", backdropFilter:"blur(6px)"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"white", borderRadius:8, width:"100%", maxWidth:680,
        maxHeight:"90vh", overflowY:"auto", overflowX:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,0.3)",
        animation:"popIn 0.2s cubic-bezier(.34,1.56,.64,1)",
        fontFamily:"'Inter','SF Pro Text',Helvetica,sans-serif",
        isolation:"isolate",
      }}>
        <style>{`
          @keyframes popIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
          .hrow:hover{background:#f0f4ff!important;}
          .hrow{transition:background 0.1s;}
        `}</style>

        {/* ── HEADER ── */}
        <div style={{padding:"16px 20px 14px", borderBottom:"1px solid #dde1e7"}}>
          <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12}}>
            <div style={{flex:1}}>
              <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:6}}>
                <span style={{fontSize:22, fontWeight:700, color:"#1a1d23", fontFamily:"monospace", letterSpacing:"0.03em"}}>{pair}</span>
                <span style={{
                  fontSize:10, fontWeight:700, letterSpacing:"0.08em",
                  color:action.color, background:action.bg,
                  border:`1px solid ${action.border}`,
                  padding:"3px 10px", borderRadius:3,
                }}>{action.icon} {action.label}</span>
              </div>
              <p style={{margin:0, fontSize:12, color:"#374151", lineHeight:1.6,
                background:"#f8f9fc", border:"1px solid #e5e7eb",
                padding:"8px 12px", borderRadius:4}}>
                {signal.reason}
              </p>
            </div>
            <button onClick={onClose} style={{
              width:28, height:28, borderRadius:4, background:"#f0f2f5",
              border:"1px solid #dde1e7", cursor:"pointer", color:"#6b7280",
              fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0
            }}>✕</button>
          </div>
        </div>

        {/* ── TABLE HEADER ROW ── */}
        <div style={{
          display:"grid", gridTemplateColumns:gridCols,
          background:"#f1f5f9", borderBottom:"2px solid #dde1e7",
          position:"sticky", top:0, zIndex:10,
          boxShadow:"0 2px 6px rgba(0,0,0,0.08)",
        }}>
          <div style={{padding:"8px 8px 8px 14px", fontSize:9, fontWeight:700,
            color:"#6b7280", letterSpacing:"0.07em", textTransform:"uppercase"}}>
            INFORME
          </div>
          {COLS.map(col=>(
            <div key={col.key} style={{
              padding:"8px 10px", textAlign:"right",
              fontSize:9, fontWeight:700, color:"#4b5563",
              letterSpacing:"0.06em", textTransform:"uppercase",
              display:"flex", alignItems:"center", justifyContent:"flex-end", gap:2,
            }}>
              {col.label}
              {col.tip && <InfoTooltip text={TOOLTIPS[col.tip]}/>}
            </div>
          ))}
        </div>

        {/* ── DATA ROWS ── */}
        {rows.map((row, i) => {
          const isLatest = i === 0;
          return (
            <div key={row.isoDate||i}
              className="hrow"
              style={{
                display:"grid", gridTemplateColumns:gridCols,
                borderBottom: i < rows.length-1 ? "1px solid #f0f2f5" : "none",
                background: isLatest ? "rgba(0,85,204,0.03)" : "transparent",
                transition:"background 0.1s",
              }}>
              {/* Date cell */}
              <div style={{
                padding:"0 8px 0 14px",
                display:"flex", alignItems:"center",
                borderRight:"1px solid #f0f2f5",
              }}>
                <span style={{
                  fontSize:11, fontFamily:"monospace", fontWeight: isLatest?700:400,
                  color: isLatest ? "#0055cc" : "#6b7280",
                  lineHeight:"36px",
                }}>
                  {row.displayDate || row.isoDate?.slice(0,10) || "—"}
                </span>
              </div>

              {/* Data cells with heatmap */}
              {COLS.map(col => {
                const val = row[col.key];
                const prevRow = rows[i+1];
                const prevVal = prevRow?.[col.key];
                const chg = (col.key==="smartNet"||col.key==="ncNet") && prevVal!=null && val!=null
                  ? val - prevVal : null;
                const heat = heatCell(val, col.htype);
                return (
                  <div key={col.key} style={{
                    padding:"0 10px",
                    textAlign:"right",
                    background:heat.background,
                    borderRight:"1px solid rgba(0,0,0,0.03)",
                    display:"flex", flexDirection:"column",
                    alignItems:"flex-end", justifyContent:"center",
                    minHeight:36,
                    transition:"background 0.15s",
                  }}>
                    <span style={{
                      fontSize:12, fontWeight:700, fontFamily:"monospace",
                      fontVariantNumeric:"tabular-nums",
                      color:heat.color,
                    }}>{fN(val)}</span>
                    {chg !== null && (
                      <span style={{
                        fontSize:9, fontFamily:"monospace",
                        color: chg>0?"#2e7d4f":chg<0?"#b71c1c":"#9E9E9E",
                        lineHeight:1.2,
                      }}>
                        {chg>0?"▲":"▼"} {Math.abs(chg).toLocaleString("en-US")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* ── LEGEND ── */}
        <div style={{
          margin:"0 16px 16px", padding:"10px 12px",
          background:"#f8f9fc", border:"1px solid #e5e7eb", borderRadius:4,
        }}>
          <div style={{display:"flex", gap:12, flexWrap:"wrap", alignItems:"center", marginBottom:6}}>
            <span style={{fontSize:9, fontWeight:700, color:"#9ca3af", letterSpacing:"0.07em", textTransform:"uppercase"}}>Heatmap:</span>
            {[
              {bg:"rgba(136,201,153,0.55)", label:"Acumulación fuerte (>10K)"},
              {bg:"rgba(136,201,153,0.22)", label:"Acumulación débil (<10K)"},
              {bg:"rgba(239,154,154,0.55)", label:"Distribución fuerte (>10K)"},
              {bg:"rgba(239,154,154,0.22)", label:"Distribución débil (<10K)"},
            ].map(item=>(
              <div key={item.label} style={{display:"flex", alignItems:"center", gap:4}}>
                <div style={{width:12, height:12, borderRadius:2, background:item.bg, border:"1px solid rgba(0,0,0,0.06)", flexShrink:0}}/>
                <span style={{fontSize:9, color:"#6b7280", whiteSpace:"nowrap"}}>{item.label}</span>
              </div>
            ))}
          </div>
          <div style={{fontSize:9, color:"#9ca3af", textAlign:"right"}}>
            Posicionamiento Dinero Inteligente (CFTC) · TFF · Leveraged Money
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function SettingsPanel({ user, darkMode, lang, onDarkMode, onLang, onLogout, onClose, onUpgrade }) {
  const [section, setSection] = useState(null);
  const [bugText, setBugText] = useState("");
  const [bugSent, setBugSent] = useState(false);
  const [notifications, setNotifications] = useState(
    () => { try { return JSON.parse(localStorage.getItem("cot_notif")||"true"); } catch { return true; } }
  );

  const t = lang === "en" ? {
    account:"My Account", prefs:"Preferences", community:"Community", support:"Support", legal:"Legal",
    profile:"Profile", billing:"Billing", upgrade:"Upgrade Plan", cancel:"Cancel Subscription",
    darkmode:"Dark Mode", language:"Language", notif:"Weekly Notifications",
    referral:"Refer a Friend", telegram:"Telegram Channel", copy:"Copytrading",
    help:"Help Center", bug:"Report a Bug", news:"What's New", contact:"Contact",
    privacy:"Privacy Policy", terms:"Terms & Conditions", logout:"Log Out",
    close:"Close", send:"Send Report", sent:"Sent! Thanks",
    planActive:"Active Plan", memberSince:"Member since",
    referralDesc:"Invite a friend and get 1 free month",
    telegramDesc:"Join the MarketMoneyFX community",
    copyDesc:"Follow my trades automatically",
    bugPlaceholder:"Describe the issue...",
    cancelDesc:"Your subscription will remain active until the end of the period",
  } : {
    account:"Mi Cuenta", prefs:"Preferencias", community:"Comunidad", support:"Soporte", legal:"Legal",
    profile:"Perfil", billing:"Facturación", upgrade:"Mejorar Plan", cancel:"Cancelar Suscripción",
    darkmode:"Modo Oscuro", language:"Idioma", notif:"Notificaciones semanales",
    referral:"Invita a un amigo", telegram:"Canal de Telegram", copy:"Copytrading",
    help:"Centro de Ayuda", bug:"Informar un error", news:"Novedades", contact:"Contacto",
    privacy:"Política de Privacidad", terms:"Términos y Condiciones", logout:"Cerrar Sesión",
    close:"Cerrar", send:"Enviar reporte", sent:"¡Enviado! Gracias",
    planActive:"Plan activo", memberSince:"Miembro desde",
    referralDesc:"Invita a un amigo y consigue 1 mes gratis",
    telegramDesc:"Únete a la comunidad MarketMoneyFX",
    copyDesc:"Sigue mis operaciones automáticamente",
    bugPlaceholder:"Describe el problema...",
    cancelDesc:"Tu suscripción seguirá activa hasta el final del período",
  };

  const toggleNotif = () => {
    const v = !notifications;
    setNotifications(v);
    localStorage.setItem("cot_notif", JSON.stringify(v));
  };

  const sendBug = async () => {
    if (!bugText.trim()) return;
    // Enviar bug report vía Supabase (no GAS)
    try {
      const { supabase } = await import('./lib/supabase.js');
      await supabase.from('login_logs').insert({
        user_id:    profile?.id ?? null,
        login_time: new Date().toISOString(),
        device:     `BUG_REPORT: ${bugText.slice(0,250)}`,
        success:    false,
        fail_reason: bugText.slice(0,500),
      });
    } catch { /* silencioso */ }
    setBugSent(true);
    setBugText("");
    setTimeout(() => setBugSent(false), 3000);
  };

  const PLAN_COLORS = { Trial:"#ff9500", Mensual:"#0066cc", Trimestral:"#5856d6", Semestral:"#34c759", Anual:"#ff2d55" };
  const planColor = PLAN_COLORS[user.plan] || "#0066cc";

  // ── SUB-SECTIONS ───────────────────────────────────────────────────────────
  if (section === "profile") return (
    <SettingsShell onBack={()=>setSection(null)} title={t.profile} onClose={onClose} dark={darkMode}>
      <div style={{padding:"0 20px"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 0 20px"}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:`linear-gradient(135deg,${planColor},${planColor}aa)`,
            display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12,
            boxShadow:`0 4px 20px ${planColor}44`}}>
            <span style={{fontSize:28,fontWeight:700,color:"white"}}>{user.nombre[0].toUpperCase()}</span>
          </div>
          <p style={{margin:"0 0 4px",fontSize:20,fontWeight:700,color:darkMode?"#fff":"#1c1c1e"}}>{user.nombre}</p>
          <p style={{margin:"0 0 10px",fontSize:13,color:"#8e8e93"}}>{user.email}</p>
          <span style={{fontSize:11,fontWeight:700,background:`${planColor}22`,color:planColor,padding:"4px 14px",borderRadius:99}}>
            {user.plan || "Trial"}
          </span>
        </div>
        {[
          [t.planActive, user.plan || "Trial", planColor],
          [t.memberSince, new Date().toLocaleDateString(lang==="en"?"en-US":"es-ES",{month:"long",year:"numeric"}), "#8e8e93"],
          ["Email", user.email, "#8e8e93"],
        ].map(([label,val,color])=>(
          <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"14px 0",borderBottom:`1px solid ${darkMode?"#2c2c2e":"#f2f2f7"}`}}>
            <span style={{fontSize:13,color:"#8e8e93"}}>{label}</span>
            <span style={{fontSize:13,fontWeight:600,color:darkMode?"#fff":color}}>{val}</span>
          </div>
        ))}
      </div>
    </SettingsShell>
  );

  if (section === "billing") return (
    <SettingsShell onBack={()=>setSection(null)} title={t.billing} onClose={onClose} dark={darkMode}>
      <div style={{padding:"0 20px"}}>
        <div style={{background:darkMode?"#1c1c1e":"#f9f9fb",borderRadius:16,padding:"18px",margin:"16px 0"}}>
          <p style={{margin:"0 0 4px",fontSize:11,color:"#8e8e93",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{t.planActive}</p>
          <p style={{margin:"0 0 10px",fontSize:22,fontWeight:700,color:planColor}}>{user.plan || "Trial"}</p>
          <button onClick={onUpgrade} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",cursor:"pointer",
            background:`linear-gradient(135deg,${planColor},${planColor}cc)`,color:"white",fontSize:14,fontWeight:600}}>
            {t.upgrade} →
          </button>
        </div>
        <div style={{background:"rgba(255,59,48,0.06)",border:"1px solid rgba(255,59,48,0.15)",borderRadius:14,padding:"14px 16px",marginTop:8}}>
          <p style={{margin:"0 0 4px",fontSize:13,fontWeight:600,color:"#c0392b"}}>{t.cancel}</p>
          <p style={{margin:"0 0 10px",fontSize:12,color:"#8e8e93",lineHeight:1.5}}>{t.cancelDesc}</p>
          <button style={{background:"none",border:"1px solid rgba(255,59,48,0.3)",borderRadius:10,padding:"8px 16px",
            color:"#c0392b",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {t.cancel}
          </button>
        </div>
      </div>
    </SettingsShell>
  );

  if (section === "bug") return (
    <SettingsShell onBack={()=>setSection(null)} title={t.bug} onClose={onClose} dark={darkMode}>
      <div style={{padding:"16px 20px"}}>
        <p style={{margin:"0 0 14px",fontSize:13,color:"#8e8e93",lineHeight:1.6}}>
          {lang==="en"?"Describe what happened and we'll fix it as soon as possible.":"Describe qué pasó y lo solucionaremos lo antes posible."}
        </p>
        <textarea value={bugText} onChange={e=>setBugText(e.target.value)}
          placeholder={t.bugPlaceholder} rows={5}
          style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1.5px solid ${darkMode?"#3a3a3c":"#e5e5ea"}`,
            fontSize:14,color:darkMode?"#fff":"#1c1c1e",background:darkMode?"#2c2c2e":"#f9f9fb",
            resize:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.5}}/>
        <button onClick={sendBug} style={{width:"100%",marginTop:12,padding:"13px",borderRadius:12,border:"none",
          cursor:"pointer",background:bugSent?"#34c759":"linear-gradient(135deg,#0066cc,#0077ed)",
          color:"white",fontSize:14,fontWeight:600,transition:"all 0.2s"}}>
          {bugSent ? t.sent : t.send}
        </button>
      </div>
    </SettingsShell>
  );

  if (section === "news") return (
    <SettingsShell onBack={()=>setSection(null)} title={t.news} onClose={onClose} dark={darkMode}>
      <div style={{padding:"0 20px"}}>
        {[
          {v:"v6.0", date:"Abr 2026", title:"Panel de ajustes completo",   desc:"Perfil, facturación, modo oscuro, idioma y mucho más."},
          {v:"v5.0", date:"Abr 2026", title:"Planes de suscripción",        desc:"Sistema de planes Trial, Mensual, Trimestral, Semestral y Anual."},
          {v:"v4.0", date:"Abr 2026", title:"Registro de leads",            desc:"Integración con Google Sheets y emails automáticos."},
          {v:"v3.0", date:"Abr 2026", title:"Señales institucionales",      desc:"Motor de señales basado en Leveraged Money del CFTC TFF."},
          {v:"v2.0", date:"Abr 2026", title:"Vista cronológica",            desc:"Sparklines y evolución semanal por par de divisas."},
          {v:"v1.0", date:"Abr 2026", title:"COT Tracker lanzado",          desc:"Primera versión con soporte CSV del CFTC."},
        ].map((item,i)=>(
          <div key={i} style={{display:"flex",gap:14,padding:"16px 0",borderBottom:`1px solid ${darkMode?"#2c2c2e":"#f2f2f7"}`,alignItems:"flex-start"}}>
            <div style={{flexShrink:0,width:56,textAlign:"center"}}>
              <span style={{fontSize:10,fontWeight:700,background:"rgba(0,102,204,0.1)",color:"#0066cc",
                padding:"3px 8px",borderRadius:99,display:"block",marginBottom:4,whiteSpace:"nowrap"}}>{item.v}</span>
              <span style={{fontSize:10,color:"#8e8e93",whiteSpace:"nowrap"}}>{item.date}</span>
            </div>
            <div style={{flex:1}}>
              <p style={{margin:"0 0 4px",fontSize:13,fontWeight:600,color:darkMode?"#fff":"#1c1c1e"}}>{item.title}</p>
              <p style={{margin:0,fontSize:12,color:"#8e8e93",lineHeight:1.6}}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </SettingsShell>
  );

  // ── MAIN SETTINGS ──────────────────────────────────────────────────────────
  const Row = ({icon,label,desc,onPress,right,danger}) => (
    <div onClick={onPress} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 20px",cursor:onPress?"pointer":"default",
      borderBottom:`1px solid ${darkMode?"#2c2c2e":"#f2f2f7"}`,transition:"background 0.15s"}}
      onMouseEnter={e=>onPress&&(e.currentTarget.style.background=darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.02)")}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <span style={{fontSize:18,width:28,textAlign:"center",flexShrink:0}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <p style={{margin:0,fontSize:14,fontWeight:500,color:danger?"#c0392b":darkMode?"#fff":"#1c1c1e"}}>{label}</p>
        {desc&&<p style={{margin:0,fontSize:12,color:"#8e8e93",marginTop:1}}>{desc}</p>}
      </div>
      {right || (onPress && <span style={{color:"#c7c7cc",fontSize:16}}>›</span>)}
    </div>
  );

  const SectionTitle = ({title}) => (
    <p style={{margin:"20px 20px 6px",fontSize:11,fontWeight:700,color:"#8e8e93",letterSpacing:"0.06em",textTransform:"uppercase"}}>{title}</p>
  );

  const Toggle = ({value,onChange}) => (
    <div onClick={onChange} style={{width:44,height:26,borderRadius:99,background:value?"#34c759":"#d1d1d6",
      position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:value?20:3,width:20,height:20,borderRadius:"50%",
        background:"white",boxShadow:"0 1px 4px rgba(0,0,0,0.2)",transition:"left 0.2s"}}/>
    </div>
  );

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:300,
      display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(6px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:darkMode?"#1c1c1e":"white",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:500,
        maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -8px 60px rgba(0,0,0,0.25)",
        animation:"slideUp 0.25s cubic-bezier(.4,0,.2,1)",
      }}>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        {/* Handle */}
        <div style={{width:36,height:4,borderRadius:99,background:darkMode?"#3a3a3c":"#d1d1d6",margin:"12px auto 4px"}}/>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px 0"}}>
          <div>
            <p style={{margin:0,fontSize:18,fontWeight:700,color:darkMode?"#fff":"#1c1c1e",letterSpacing:"-0.3px"}}>Ajustes</p>
            <p style={{margin:0,fontSize:12,color:"#8e8e93"}}>{user.nombre} · {user.plan||"Trial"}</p>
          </div>
          <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:darkMode?"#3a3a3c":"#f2f2f7",border:"none",cursor:"pointer",color:"#8e8e93",fontSize:14}}>✕</button>
        </div>

        {/* User avatar */}
        <div style={{display:"flex",justifyContent:"center",padding:"16px 0 8px"}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:`linear-gradient(135deg,${planColor},${planColor}aa)`,
            display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 16px ${planColor}44`}}>
            <span style={{fontSize:22,fontWeight:700,color:"white"}}>{user.nombre[0].toUpperCase()}</span>
          </div>
        </div>

        {/* ── MY ACCOUNT ── */}
        <SectionTitle title={t.account}/>
        <Row icon="👤" label={t.profile} desc={user.email} onPress={()=>setSection("profile")}/>
        <Row icon="💳" label={t.billing} desc={user.plan||"Trial"} onPress={()=>setSection("billing")}/>
        <Row icon="⬆️" label={t.upgrade} desc={lang==="en"?"Get more features":"Accede a todas las funciones"} onPress={onUpgrade}/>

        {/* ── PREFERENCES ── */}
        <SectionTitle title={t.prefs}/>
        <Row icon={darkMode?"🌙":"☀️"} label={t.darkmode}
          right={<Toggle value={darkMode} onChange={onDarkMode}/>}/>
        <Row icon="🌐" label={t.language}
          right={
            <div style={{display:"flex",gap:4}}>
              {["es","en"].map(l=>(
                <button key={l} onClick={(e)=>{e.stopPropagation();onLang(l);}} style={{
                  padding:"4px 10px",borderRadius:99,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
                  background:lang===l?"#0066cc":"#f2f2f7",color:lang===l?"white":"#3c3c43",transition:"all 0.15s",
                }}>{l==="es"?"🇪🇸 ES":"🇬🇧 EN"}</button>
              ))}
            </div>
          }/>
        <Row icon="🔔" label={t.notif} desc={lang==="en"?"Every Friday at 3:30 PM ET":"Cada viernes a las 21:30h"}
          right={<Toggle value={notifications} onChange={toggleNotif}/>}/>

        {/* ── COMMUNITY ── */}
        <SectionTitle title={t.community}/>
        <Row icon="🎁" label={t.referral} desc={t.referralDesc}
          onPress={()=>{
            const refUrl = "https://cot-tracker.vercel.app?ref="+encodeURIComponent(user.email.split("@")[0]);
            navigator.clipboard.writeText(refUrl);
            alert("¡Link de referido copiado! Compártelo con tus amigos: "+refUrl);
          }}/>
        <Row icon="✈️" label={t.telegram} desc={t.telegramDesc}
          onPress={()=>window.open("https://t.me/COT_TRACKER","_blank")}/>
        <Row icon="📊" label={t.copy} desc={t.copyDesc}
          onPress={()=>window.open("https://t.me/Alejandro_Ibz_fx?text=COPY%20-%20Quiero%20seguir%20tus%20operaciones","_blank")}/>

        {/* ── SUPPORT ── */}
        <SectionTitle title={t.support}/>
        <Row icon="❓" label={t.help} onPress={()=>window.open("https://t.me/COT_TRACKER","_blank")}/>
        <Row icon="🐛" label={t.bug} onPress={()=>setSection("bug")}/>
        <Row icon="🚀" label={t.news} onPress={()=>setSection("news")}/>
        <Row icon="💬" label={t.contact} onPress={()=>window.open("mailto:marketmoneyfx00@gmail.com","_blank")}/>

        {/* ── LEGAL ── */}
        <SectionTitle title={t.legal}/>
        <Row icon="🔒" label={t.privacy}
          onPress={()=>window.open("https://marketmoneyfx.com/privacy","_blank")}/>
        <Row icon="📄" label={t.terms}
          onPress={()=>window.open("https://marketmoneyfx.com/terms","_blank")}/>

        {/* ── LOGOUT ── */}
        <div style={{padding:"8px 0 48px"}}>
          <Row icon="🚪" label={t.logout} danger onPress={onLogout}/>
        </div>
      </div>
    </div>
  );
}

// Shell wrapper for sub-screens inside settings
function SettingsShell({children, onBack, title, onClose, dark}) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:300,
      display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(6px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:dark?"#1c1c1e":"white",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:500,
        maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -8px 60px rgba(0,0,0,0.25)",
        animation:"slideUp 0.25s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{width:36,height:4,borderRadius:99,background:dark?"#3a3a3c":"#d1d1d6",margin:"12px auto 8px"}}/>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"8px 20px 16px",borderBottom:`1px solid ${dark?"#2c2c2e":"#f2f2f7"}`}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:"#0066cc",fontSize:13,fontWeight:600,padding:0}}>← Volver</button>
          <span style={{fontSize:16,fontWeight:700,color:dark?"#fff":"#1c1c1e",flex:1,textAlign:"center",marginRight:40}}>{title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CALENDARIO ECONÓMICO
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_MAP = {
  US:'🇺🇸',EU:'🇪🇺',GB:'🇬🇧',JP:'🇯🇵',CA:'🇨🇦',
  AU:'🇦🇺',NZ:'🇳🇿',CH:'🇨🇭',DE:'🇩🇪',FR:'🇫🇷',
  CN:'🇨🇳',IT:'🇮🇹',ES:'🇪🇸',NL:'🇳🇱',NO:'🇳🇴',
  SE:'🇸🇪',MX:'🇲🇽',BR:'🇧🇷',KR:'🇰🇷',NZ:'🇳🇿',
};

const IMPACT_STARS = { High:3, Medium:2, Low:1 };

function getScenarios(eventName, country) {
  const n = (eventName||'').toLowerCase();
  const c = country||'US';
  const ccyMap = {US:'USD',EU:'EUR',GB:'GBP',JP:'JPY',CA:'CAD',AU:'AUD',NZ:'NZD',CH:'CHF'};
  const ccy = ccyMap[c]||'USD';
  // NFP
  if (n.includes('non-farm')||n.includes('nonfarm')||n.includes('nóminas no agr')||n.includes('nominas no agr'))
    return {assets:['USD','US10Y','SPX','XAUUSD'],weak:['↓ Baja','↓ Baja','↓ Baja','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↑ Sube','↓ Baja'],cat:'EMPLEO',col:'#3b82f6'};
  // ADP
  if (n.includes('adp')||n.includes('cambio del empleo no agr'))
    return {assets:['USD','US10Y','SPX','XAUUSD'],weak:['↓ Baja','↓ Baja','↓ Baja','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↑ Sube','↓ Baja'],cat:'EMPLEO',col:'#3b82f6'};
  // Unemployment claims
  if (n.includes('peticiones')||n.includes('jobless')||n.includes('claims')||n.includes('subsidio por desempleo'))
    return {assets:['USD','SPX','XAUUSD'],weak:['↑ Sube','↑ Sube','↓ Baja'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↓ Baja','↓ Baja','↑ Sube'],cat:'EMPLEO',col:'#3b82f6'};
  // Unemployment rate
  if (n.includes('tasa de desempleo')||n.includes('unemployment rate'))
    return {assets:['USD','SPX'],weak:['↑ Sube','↓ Baja'],inline:['⇄ Neutral','⇄ Neutral'],strong:['↓ Baja','↑ Sube'],cat:'EMPLEO',col:'#3b82f6'};
  // CPI / IPC
  if (n.includes('cpi')||n.includes('ipc')||n.includes('inflation')||n.includes('inflación')) {
    if (c==='US') return {assets:['USD','US10Y','SPX','XAUUSD'],weak:['↓ Baja','↓ Baja','↑ Sube','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↓ Baja','↑ Sube'],cat:'INFLACIÓN',col:'#ef4444'};
    if (c==='EU'||c==='DE') return {assets:['EUR','DE10Y','STOXX50'],weak:['↓ Baja','↓ Baja','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↓ Baja'],cat:'INFLACIÓN',col:'#ef4444'};
    if (c==='GB') return {assets:['GBP','UK10Y','FTSE'],weak:['↓ Baja','↓ Baja','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↓ Baja'],cat:'INFLACIÓN',col:'#ef4444'};
    return {assets:[ccy],weak:['↓ Baja'],inline:['⇄ Neutral'],strong:['↑ Sube'],cat:'INFLACIÓN',col:'#ef4444'};
  }
  // PMI
  if (n.includes('pmi')) {
    const assets = c==='US'?['USD','SPX']:c==='EU'?['EUR','STOXX50']:c==='GB'?['GBP','FTSE']:[ccy];
    return {assets,weak:assets.map(()=>'↓ Baja'),inline:assets.map(()=>'⇄ Neutral'),strong:assets.map(()=>'↑ Sube'),cat:'ADELANTADOS',col:'#8b5cf6'};
  }
  // GDP / PIB
  if (n.includes('gdp')||n.includes('pib')) {
    const assets = c==='US'?['USD','US10Y','SPX']:c==='EU'?['EUR','STOXX50']:c==='GB'?['GBP','FTSE']:[ccy];
    return {assets,weak:assets.map(()=>'↓ Baja'),inline:assets.map(()=>'⇄ Neutral'),strong:assets.map(()=>'↑ Sube'),cat:'CRECIMIENTO',col:'#10b981'};
  }
  // Retail / Ventas minoristas
  if (n.includes('retail')||n.includes('ventas minoristas')) {
    const assets = c==='US'?['USD','SPX']:c==='GB'?['GBP','FTSE']:[ccy];
    return {assets,weak:assets.map(()=>'↓ Baja'),inline:assets.map(()=>'⇄ Neutral'),strong:assets.map(()=>'↑ Sube'),cat:'CONSUMO',col:'#f59e0b'};
  }
  // Interest Rate / Tipos de interés
  if (n.includes('interest rate')||n.includes('tipos de interés')||n.includes('decisión de tipos')) {
    const assets = c==='US'?['USD','US10Y','SPX','XAUUSD']:c==='EU'?['EUR','DE10Y','STOXX50']:c==='GB'?['GBP','UK10Y','FTSE']:c==='JP'?['JPY','JP10Y']:c==='CA'?['CAD']:c==='AU'?['AUD']:[ccy];
    return {assets,weak:assets.map(()=>'↓ Baja'),inline:assets.map(()=>'⇄ Neutral'),strong:assets.map(()=>'↑ Sube'),cat:'POLÍTICA MONETARIA',col:'#f97316'};
  }
  // FOMC / Actas
  if (n.includes('fomc')||n.includes('actas de la reunión'))
    return {assets:['USD','US10Y','SPX'],weak:['↓ Baja','↓ Baja','↑ Sube'],inline:['⇄ Neutral','⇄ Neutral','⇄ Neutral'],strong:['↑ Sube','↑ Sube','↓ Baja'],cat:'POLÍTICA MONETARIA',col:'#f97316'};
  // Inventarios petroleo
  if (n.includes('crude')||n.includes('petróleo crudo')||n.includes('inventarios de petróleo'))
    return {assets:['WTI','USD'],weak:['↑ Sube','↓ Baja'],inline:['⇄ Neutral','⇄ Neutral'],strong:['↓ Baja','↑ Sube'],cat:'MATERIAS PRIMAS',col:'#6b7280'};
  return null;
}

function calcRisk(events) {
  const today = new Date().toISOString().slice(0,10);
  let score = 0;
  events.filter(e=>e.date?.slice(0,10)===today).forEach(e=>{
    if (e.impact==='High') score+=15;
    else if (e.impact==='Medium') score+=5;
    else score+=1;
  });
  if (score>=30) return {label:'Riesgo alto',  color:'#ef4444', bg:'rgba(239,68,68,0.08)',   border:'rgba(239,68,68,0.2)',   icon:'⚠️', score};
  if (score>=10) return {label:'Riesgo medio', color:'#f59e0b', bg:'rgba(245,158,11,0.08)',  border:'rgba(245,158,11,0.2)',  icon:'🔶', score};
  return              {label:'Riesgo bajo',   color:'#10b981', bg:'rgba(16,185,129,0.08)',   border:'rgba(16,185,129,0.2)',  icon:'🛡️', score};
}


// ─── CALENDARIO HELPERS ───────────────────────────────────────────────────────
const COUNTRY_CCY = {US:'USD',EU:'EUR',GB:'GBP',JP:'JPY',CA:'CAD',AU:'AUD',NZ:'NZD',CH:'CHF',DE:'EUR',FR:'EUR',CN:'CNY',NL:'EUR',IT:'EUR',ES:'EUR'};
const CCY_FLAG    = {USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',JPY:'🇯🇵',CAD:'🇨🇦',AUD:'🇦🇺',NZD:'🇳🇿',CHF:'🇨🇭',CNY:'🇨🇳',BRL:'🇧🇷',MXN:'🇲🇽',KRW:'🇰🇷'};


// ─── ADVANCED MACRO ANALYSIS ─────────────────────────────────────────────────

function calcSurprise(actual, forecast) {
  const a = parseFloat(String(actual ?? '').replace('%','').replace('K','000').replace('M','000000').replace('B','000000000').replace('T','000000000000'));
  const f = parseFloat(String(forecast ?? '').replace('%','').replace('K','000').replace('M','000000').replace('B','000000000').replace('T','000000000000'));
  if (isNaN(a)||isNaN(f)) return null;
  const raw = a - f;
  const pct = f !== 0 ? ((a - f) / Math.abs(f)) * 100 : 0;
  return { raw, pct, dir: raw > 0 ? 1 : raw < 0 ? -1 : 0 };
}

function calcDeltaPrev(actual, previous) {
  const a = parseFloat(String(actual ?? '').replace('%',''));
  const p = parseFloat(String(previous ?? '').replace('%',''));
  if (isNaN(a)||isNaN(p)) return null;
  const raw = a - p;
  const pct = p !== 0 ? ((a - p) / Math.abs(p)) * 100 : 0;
  return { raw, pct, dir: raw > 0 ? 1 : raw < 0 ? -1 : 0 };
}

function getImpactLevel(surprisePct) {
  const abs = Math.abs(surprisePct||0);
  if (abs < 0.30) return { label:'En línea', color:'#8b90a0', bg:'rgba(139,144,160,0.15)' };
  if (abs < 1.00) return { label:'Moderado', color:'#f59e0b', bg:'rgba(245,158,11,0.15)' };
  if (abs < 2.00) return { label:'Fuerte',   color:'#f97316', bg:'rgba(249,115,22,0.15)' };
  return              { label:'Extremo',  color:'#ef4444', bg:'rgba(239,68,68,0.15)' };
}

function getMacroRegime(eventType, actual, forecast, previous) {
  if ((actual === null || actual === undefined || actual === '') ||
      (forecast === null || forecast === undefined || forecast === '')) return null;
  const surprise = calcSurprise(actual, forecast);
  if (!surprise) return null;
  const a = parseFloat(String(actual).replace('%',''));

  switch(eventType) {
    case 'CPI': case 'PPI':
      return surprise.dir > 0
        ? { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Inflación alta → banco central restrictivo → USD/yields al alza' }
        : { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Inflación baja → expectativas de recortes → activos de riesgo al alza' };
    case 'PMI':
      if (!isNaN(a)) {
        if (a >= 55) return { label:'EXPANSIÓN FUERTE', color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'PMI ≥55: crecimiento sólido' };
        if (a >= 50) return { label:'EXPANSIÓN', color:'#84cc16', bg:'rgba(132,204,22,0.12)', icon:'🟡', desc:'PMI ≥50: sector en expansión' };
        if (a >= 45) return { label:'CONTRACCIÓN', color:'#f97316', bg:'rgba(249,115,22,0.12)', icon:'🟠', desc:'PMI <50: sector en contracción' };
        return { label:'RECESIÓN', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'PMI <45: contracción severa' };
      }
      return surprise.dir > 0
        ? { label:'GROWTH', color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'PMI por encima del consenso' }
        : { label:'CONTRACCIÓN', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'PMI por debajo del consenso' };
    case 'NFP': case 'ADP': case 'EMPLOYMENT':
      return surprise.dir > 0
        ? { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Mercado laboral fuerte → Fed restrictiva más tiempo' }
        : { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Mercado laboral débil → presión para recortar tipos' };
    case 'CLAIMS':
      // MÁS peticiones = MÁS desempleo = MALO = dovish
      return surprise.dir > 0
        ? { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Más peticiones de desempleo → mercado laboral se deteriora → presión para recortar tipos' }
        : { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Pocas peticiones → mercado laboral sólido → Fed puede mantener tipos' };
    case 'UNEMPLOYMENT_RATE':
      // TASA más alta = MÁS desempleo = MALO = dovish
      return surprise.dir > 0
        ? { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Tasa de desempleo sube → debilita la divisa → expectativas de recortes' }
        : { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Tasa de desempleo baja → mercado laboral fuerte → banco central puede mantener tipos' };
    case 'GDP': case 'RETAIL': case 'DURABLE_GOODS': case 'INDUSTRIAL':
      return surprise.dir > 0
        ? { label:'GROWTH',    color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Dato de crecimiento positivo → fortaleza económica' }
        : { label:'RECESIÓN',  color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Dato de crecimiento negativo → señal de desaceleración' };
    case 'RATE_DECISION':
      return surprise.dir > 0
        ? { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Decisión más restrictiva de lo esperado' }
        : { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'Decisión más acomodaticia de lo esperado' };
    case 'CONFIDENCE': case 'CREDIT':
      return surprise.dir > 0
        ? { label:'RISK-ON',  color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'Confianza/crédito positivo → modo riesgo activo' }
        : { label:'RISK-OFF', color:'#f97316', bg:'rgba(249,115,22,0.12)', icon:'🟠', desc:'Confianza/crédito débil → modo refugio' };
    default:
      return surprise.dir > 0
        ? { label:'POSITIVO', color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'Dato mejor de lo esperado' }
        : { label:'NEGATIVO', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Dato peor de lo esperado' };
  }
}

// Indicadores donde valor MÁS ALTO = PEOR (invertidos para el score)
const INVERSE_SCORE_TYPES = new Set(['CLAIMS','UNEMPLOYMENT_RATE','OIL']);

function calcMacroScore(surprise, delta, regime, evType) {
  if (!surprise) return null;
  const inv = INVERSE_SCORE_TYPES.has(evType) ? -1 : 1;
  let score = 0;
  // surprise.pct ya lleva su propio signo — NO multiplicar por dir de nuevo
  score += Math.max(-60, Math.min(60, surprise.pct * 10)) * inv;
  if (delta) score += Math.max(-30, Math.min(30, delta.pct * 5)) * inv;
  const s = Math.max(-100, Math.min(100, Math.round(score)));
  const label = s > 50 ? 'Muy Alcista' : s > 20 ? 'Alcista' : s > -20 ? 'Neutral' : s > -50 ? 'Bajista' : 'Muy Bajista';
  const color = s > 20 ? '#22c55e' : s < -20 ? '#ef4444' : '#f59e0b';
  return { score: s, label, color };
}

function buildDynamicInterpretation(eventType, evName, ccy, actual, forecast, previous, surprise, delta, regime) {
  if (actual === null || actual === undefined || actual === '') return null;
  const sfmt = (v) => v !== null ? `${v.dir>0?'+':''}${v.raw.toFixed(2)} (${v.dir>0?'+':''}${v.pct.toFixed(2)}%)` : '—';
  const parts = [];

  if (surprise) {
    const impLvl = getImpactLevel(surprise.pct);
    if (surprise.dir > 0) {
      parts.push(`Dato <strong>superior al consenso</strong> en ${sfmt(surprise)} — impacto ${impLvl.label.toLowerCase()}.`);
    } else if (surprise.dir < 0) {
      parts.push(`Dato <strong>inferior al consenso</strong> en ${sfmt(surprise)} — impacto ${impLvl.label.toLowerCase()}.`);
    } else {
      parts.push(`Dato <strong>en línea con el consenso</strong>. Impacto limitado en el mercado.`);
    }
  }

  if (delta && delta.raw !== 0) {
    const vs = delta.dir > 0 ? 'mejora' : 'deterioro';
    parts.push(`${vs.charAt(0).toUpperCase()+vs.slice(1)} vs dato anterior de ${sfmt(delta)}.`);
  }

  if (regime) {
    switch(eventType) {
      case 'CPI': case 'PPI':
        if (surprise?.dir > 0) parts.push(`Régimen hawkish confirmado: presión alcista sobre ${ccy} y yields, bajista sobre renta variable.`);
        else parts.push(`Régimen dovish: abre expectativas de recortes, presión bajista sobre ${ccy}.`);
        break;
      case 'PMI':
        parts.push(regime.desc + '.');
        if (surprise?.dir > 0) parts.push(`Fortalece ${ccy} y la renta variable local.`);
        else parts.push(`Puede presionar ${ccy} y generar risk-off en activos locales.`);
        break;
      case 'NFP': case 'ADP':
        if (surprise?.dir > 0) parts.push(`Empleo fuerte refuerza ${ccy} y yields; el oro puede ceder.`);
        else parts.push(`Empleo débil genera presión para recortes; ${ccy} y yields bajo presión.`);
        break;
      case 'GDP': case 'RETAIL': case 'DURABLE_GOODS':
        if (surprise?.dir > 0) parts.push(`Fortaleza económica respalda ${ccy} y activos de riesgo.`);
        else parts.push(`Señal de desaceleración. Puede aumentar expectativas de recortes.`);
        break;
      default:
        if (regime) parts.push(regime.desc + '.');
    }
  }
  return parts.join(' ');
}


// ─── LECTURA OPERATIVA HELPERS ────────────────────────────────────────────────
function getTemporalHorizon(evType, impLvl) {
  const im = impLvl==='Extremo'?'1–3 min':impLvl==='Fuerte'?'2–5 min':'5–15 min';
  const id = impLvl==='Extremo'?'sesión completa':'resto de sesión';
  switch(evType) {
    case 'NFP': case 'CPI':
      return {immediate:'1–5 min',intraday:'sesión completa',macro:'2–5 días',note:'Evento de alta relevancia macro — puede re-pricear la curva de tipos'};
    case 'RATE_DECISION': case 'CB_MINUTES':
      return {immediate:'1–10 min',intraday:'sesión completa',macro:'3–7 días',note:'Impacto sostenido en toda la curva de tipos y divisas'};
    case 'PMI':
      return {immediate:im,intraday:id,macro:'1–2 días',note:'Indicador adelantado — mueve expectativas de crecimiento'};
    case 'GDP':
      return {immediate:'2–5 min',intraday:id,macro:'2–4 días',note:'Dato revisable — reacción inicial puede revertirse con revisión'};
    case 'ADP':
      return {immediate:im,intraday:id,macro:'1 día (NFP viernes)',note:'Indicador previo del NFP — efecto limitado sin sesgo de mercado'};
    case 'CLAIMS': case 'UNEMPLOYMENT_RATE': case 'EMPLOYMENT':
      return {immediate:im,intraday:id,macro:'1–2 días',note:'Dato laboral semanal — peso menor que NFP mensual'};
    case 'RETAIL': case 'DURABLE_GOODS': case 'INDUSTRIAL':
      return {immediate:im,intraday:id,macro:'1–2 días',note:'Impacto moderado — confirma o contradice el sesgo de crecimiento vigente'};
    case 'PPI':
      return {immediate:im,intraday:id,macro:'1–3 días',note:'Indicador adelantado de inflación al consumidor — vigilar si diverge del CPI'};
    case 'CONFIDENCE':
      return {immediate:im,intraday:id,macro:'1 día',note:'Impacto suave — refuerza narrativa existente más que crea nueva'};
    default:
      return {immediate:im,intraday:id,macro:'< 1 día',note:'Monitorizar reacción del mercado en los primeros minutos'};
  }
}

function getConfidenceBadge(surprisePct, evType) {
  const abs = Math.abs(surprisePct||0);
  const hi = new Set(['NFP','CPI','RATE_DECISION','GDP']).has(evType);
  if (abs>=2.0||(abs>=1.0&&hi)) return {label:'Confianza alta', color:'#22c55e',bg:'rgba(34,197,94,0.12)'};
  if (abs>=0.5)                  return {label:'Confianza media',color:'#f59e0b',bg:'rgba(245,158,11,0.12)'};
  if (abs>=0.1)                  return {label:'Confianza baja', color:'#f97316',bg:'rgba(249,115,22,0.12)'};
  return                                {label:'Sin sorpresa',    color:'#8b90a0',bg:'rgba(139,144,160,0.12)'};
}

function buildAssetDirections(sc, surprise, evType) {
  if (!sc||!surprise) return null;
  const inv = INVERSE_SCORE_TYPES.has(evType) ? -1 : 1;
  const effectiveDir = surprise.dir * inv;
  return sc.assets.map((asset,i)=>{
    let raw = effectiveDir>0 ? sc.strong[i] : effectiveDir<0 ? sc.weak[i] : sc.inline[i];
    const arrow = raw?.includes('Sube')?'↑':raw?.includes('Baja')?'↓':'→';
    const col   = arrow==='↑'?'#22c55e':arrow==='↓'?'#ef4444':'#8b90a0';
    return {asset,arrow,col};
  });
}

// ─── Arquitectura: detectEventType → buildMacroAnalysis(type, country)
// Cada tipo de evento tiene su propia lógica, activos e interpretación contextual.

function detectEventType(name) {
  const n = (name||'').toLowerCase();
  // PMI / ISM / Business surveys
  if (n.includes('pmi')||n.includes('purchasing managers')||n.includes('ism ')||
      n.includes('manufacturing index')||n.includes('services index')||
      n.includes('composite pmi')||n.includes('ivey')||n.includes('caixin')||
      n.includes('markit')||n.includes('business activity')) return 'PMI';
  // NFP specifically
  if (n.includes('non-farm')||n.includes('nonfarm')||n.includes('nfp')||
      n.includes('nóminas no agr')||n.includes('nominas no agr')||
      (n.includes('payroll')&&!n.includes('adp'))) return 'NFP';
  // ADP
  if (n.includes('adp')||n.includes('cambio del empleo no agr')||
      n.includes('employment change')&&n.includes('adp')) return 'ADP';
  // Claims
  if (n.includes('jobless')||n.includes('unemployment claims')||n.includes('initial claims')||
      n.includes('continuing claims')||n.includes('peticiones')||
      n.includes('subsidio por desempleo')) return 'CLAIMS';
  // Unemployment rate
  if (n.includes('unemployment rate')||n.includes('tasa de desempleo')||
      n.includes('unemployment (')) return 'UNEMPLOYMENT_RATE';
  // Employment general / wages
  if (n.includes('employment')||n.includes('average earnings')||n.includes('average hourly')||
      n.includes('wage')||n.includes('salary')||n.includes('jobs ')||
      n.includes('labor market')||n.includes('labour market')||
      n.includes('empleo')||n.includes('jolts')||n.includes('job openings')||
      n.includes('hiring')) return 'EMPLOYMENT';
  // Inflation CPI
  if (n.includes('cpi')||n.includes('consumer price')||n.includes('inflation')||
      n.includes('hicp')||n.includes('ipc')||n.includes('core cpi')||
      n.includes('pce')) return 'CPI';
  // PPI
  if (n.includes('ppi')||n.includes('producer price')||n.includes('wholesale price')||
      n.includes('factory gate')) return 'PPI';
  // GDP
  if (n.includes('gdp')||n.includes('gross domestic')||n.includes('pib')||
      n.includes('growth rate (')) return 'GDP';
  // Retail Sales
  if (n.includes('retail sales')||n.includes('retail ')||n.includes('ventas minoristas')||
      n.includes('core retail')) return 'RETAIL';
  // Durable Goods / Factory orders
  if (n.includes('durable goods')||n.includes('factory orders')||
      n.includes('capital goods')||n.includes('bienes duraderos')||
      n.includes('core durable')) return 'DURABLE_GOODS';
  // Industrial production
  if (n.includes('industrial production')||n.includes('manufacturing output')||
      n.includes('industrial output')||n.includes('capacity utilization')) return 'INDUSTRIAL';
  // Rate decisions
  if (n.includes('interest rate')||n.includes('rate decision')||n.includes('tipos de interés')||
      n.includes('base rate')||n.includes('overnight rate')||n.includes('cash rate')||
      n.includes('decisión de tipos')||n.includes('rate statement')) return 'RATE_DECISION';
  // FOMC minutes / CB minutes
  if (n.includes('fomc')||n.includes('fed minutes')||n.includes('actas')||
      n.includes('meeting minutes')||n.includes('monetary policy minutes')||
      n.includes('federal open')) return 'CB_MINUTES';
  // CB speeches
  if (n.includes('speaks')||n.includes('speech')||n.includes('testimony')||
      n.includes('press conference')||n.includes('statement')) return 'CB_SPEECH';
  // Trade balance
  if (n.includes('trade balance')||n.includes('current account')||n.includes('balanza comercial')||
      n.includes('trade deficit')||n.includes('exports')||n.includes('imports')) return 'TRADE';
  // Housing
  if (n.includes('housing')||n.includes('home sales')||n.includes('building permits')||
      n.includes('housing starts')||n.includes('existing home')||n.includes('new home')||
      n.includes('real estate')||n.includes('mortgage')) return 'HOUSING';
  // Consumer confidence / sentiment / optimism
  if (n.includes('consumer confidence')||n.includes('consumer sentiment')||
      n.includes('michigan')||n.includes('confianza del consumidor')||
      n.includes('optimism')||n.includes('zew')||n.includes('ifo')||
      n.includes('economic optimism')||n.includes('business confidence')) return 'CONFIDENCE';
  // Consumer credit / money supply
  if (n.includes('consumer credit')||n.includes('credit card')||n.includes('lending')||
      n.includes('credit growth')||n.includes('money supply')||
      n.includes('m2')||n.includes('m3')||n.includes('loan')) return 'CREDIT';
  // Oil / Energy
  if (n.includes('crude')||n.includes('oil inventories')||n.includes('petroleum')||
      n.includes('natural gas')||n.includes('eia')||n.includes('api weekly')||
      n.includes('inventarios de petróleo')||n.includes('energy inventory')) return 'OIL';
  // Bond auctions
  if (n.includes('bond auction')||n.includes('t-note')||n.includes('t-bond')||
      n.includes('bund auction')||n.includes('gilt auction')||
      (n.includes('auction')&&(n.includes('year')||n.includes('y ')))) return 'BOND_AUCTION';
  // Bank holiday
  if (n.includes('bank holiday')||n.includes('holiday')||n.includes('festivo')) return 'HOLIDAY';
  return null;
}

function _ccy(country) {
  return COUNTRY_CCY[(country||'US').toUpperCase()] || 'USD';
}

function buildMacroAnalysis(eventType, country) {
  const ccy = _ccy(country);
  const isUS = ccy==='USD', isEU = ccy==='EUR', isGB = ccy==='GBP';
  const isJP = ccy==='JPY', isCA = ccy==='CAD', isAU = ccy==='AUD'||ccy==='NZD';
  const isCH = ccy==='CHF';

  // Helpers
  const mk = (cat,col,assets,weak,inl,strong,up,down) =>
    ({cat,col,assets,weak,inline:inl,strong,result_up:up,result_down:down});
  const N = (n) => Array(n).fill('⇄ Neutral');

  switch(eventType) {

    case 'PMI': {
      const a = isUS?['USD','SPX','NAS100','XAUUSD']
        :isEU?['EUR','STOXX50','XAUUSD']
        :isGB?['GBP','FTSE','XAUUSD']
        :isCA?['CAD','TSX','WTI']
        :isAU?[ccy,'ASX200']
        :isJP?['JPY','NIKKEI']
        :isCH?['CHF']:[ccy,'SPX'];
      const refugios = ['XAUUSD','NIKKEI'];
      const riskOff = a.map(x=>refugios.includes(x)?'↑ Sube':'↓ Baja');
      const riskOn  = a.map(x=>refugios.includes(x)?'↓ Baja':'↑ Sube');
      const zona = isUS?'estadounidense':isEU?'europeo':isGB?'británico':isCA?'canadiense':isAU?'australiano':isJP?'japonés':ccy;
      return mk('ADELANTADOS','#8b5cf6',a, riskOff,N(a.length),riskOn,
        `PMI por encima de 50 indica expansión del sector ${zona}. Fortalece ${ccy} y apoya renta variable local. Los activos refugio pueden ceder.`,
        `PMI bajo 50 señala contracción. Debilita ${ccy} y presiona la bolsa local. El oro y los bonos soberanos pueden beneficiarse como refugio.`);
    }

    case 'NFP':
      return mk('EMPLEO','#3b82f6',
        ['USD','US10Y','SPX','XAUUSD'],
        ['↓ Baja','↓ Baja','↓ Baja','↑ Sube'],N(4),
        ['↑ Sube','↑ Sube','↑ Sube','↓ Baja'],
        'Nóminas fuertes refuerzan la solidez laboral. El USD y los rendimientos del T-Note suben; el oro cede ante menor demanda de refugio. La Fed puede mantener tipos restrictivos más tiempo.',
        'Creación de empleo débil aumenta presión sobre la Fed para recortar tipos. USD y yields bajan, el oro y activos refugio se benefician.');

    case 'ADP': {
      const a = isUS?['USD','US10Y','SPX','XAUUSD']:isCA?['CAD','TSX']:[ccy,'SPX'];
      const refugios=['XAUUSD'];
      return mk('EMPLEO','#3b82f6',a,
        a.map(x=>refugios.includes(x)?'↑ Sube':'↓ Baja'),N(a.length),
        a.map(x=>refugios.includes(x)?'↓ Baja':'↑ Sube'),
        `ADP fuerte anticipa un NFP sólido el viernes. Refuerza ${ccy} y puede presionar al oro y activos refugio a la baja.`,
        `ADP débil genera dudas sobre el informe de empleo del viernes. Puede debilitar el ${ccy} y favorecer los refugios.`);
    }

    case 'CLAIMS':
      // DÉBIL aquí = pocas peticiones (buen dato laboral) → USD sube
      // FUERTE aquí = muchas peticiones (mal dato laboral) → USD baja
      return mk('EMPLEO','#3b82f6',
        ['USD','US10Y','XAUUSD'],
        ['↑ Sube','↑ Sube','↓ Baja'], // DÉBIL = pocas peticiones = bueno → USD sube
        N(3),
        ['↓ Baja','↓ Baja','↑ Sube'], // FUERTE = muchas peticiones = malo → USD baja
        'Más peticiones de desempleo señalan deterioro del mercado laboral. Puede debilitar el USD y presionar los rendimientos a la baja.',
        'Menos peticiones confirman fortaleza laboral. Positivo para el USD y los rendimientos del Tesoro.');

    case 'UNEMPLOYMENT_RATE': {
      const a = isUS?['USD','SPX','XAUUSD']:isEU?['EUR','STOXX50']:isGB?['GBP','FTSE']:isCA?['CAD','TSX']:[ccy,'SPX'];
      // DÉBIL = tasa baja (buen dato) → divisa sube; FUERTE = tasa alta (mal dato) → divisa baja
      return mk('EMPLEO','#3b82f6',a,
        a.map(x=>x==='XAUUSD'?'↓ Baja':'↑ Sube'), // DÉBIL = tasa baja = bueno
        N(a.length),
        a.map(x=>x==='XAUUSD'?'↑ Sube':'↓ Baja'), // FUERTE = tasa alta = malo
        `Tasa de desempleo baja confirma mercado laboral sólido. Refuerza ${ccy} y puede reducir presión sobre el banco central para recortar.`,
        `Tasa de desempleo alta señala deterioro laboral. Puede debilitar ${ccy} y generar expectativas de recortes de tipos.`);
    }

    case 'EMPLOYMENT': {
      const a = isUS?['USD','US10Y','SPX','XAUUSD']
        :isEU?['EUR','DE10Y','STOXX50']:isGB?['GBP','UK10Y','FTSE']
        :isCA?['CAD','CA10Y','TSX']:isAU?[ccy,'AU10Y']:[ccy,'SPX'];
      const refugios=['XAUUSD','DE10Y','UK10Y'];
      return mk('EMPLEO','#3b82f6',a,
        a.map(x=>refugios.includes(x)?'↑ Sube':'↓ Baja'),N(a.length),
        a.map(x=>refugios.includes(x)?'↓ Baja':'↑ Sube'),
        `Dato laboral fuerte respalda la divisa local y puede mantener al banco central en postura restrictiva.`,
        `Dato laboral débil genera presión para relajar la política monetaria. Debilita ${ccy} y los activos de riesgo locales.`);
    }

    case 'CPI': {
      const a = isUS?['USD','US10Y','SPX','NAS100','XAUUSD']
        :isEU?['EUR','DE10Y','STOXX50','XAUUSD']
        :isGB?['GBP','UK10Y','FTSE']
        :isJP?['JPY','JP10Y','NIKKEI']
        :isCA?['CAD','CA10Y','TSX']
        :isAU?[ccy,'AU10Y']:[ccy,'US10Y'];
      const bolsas=['SPX','NAS100','STOXX50','FTSE','NIKKEI','TSX'];
      const dovishA = a.map(x=>bolsas.includes(x)?'↑ Sube':x==='XAUUSD'?'↑ Sube':'↓ Baja');
      const hawkishA= a.map(x=>bolsas.includes(x)?'↓ Baja':x==='XAUUSD'?'↓ Baja':'↑ Sube');
      const banco = isUS?'Fed':isEU?'BCE':isGB?'BOE':isJP?'BOJ':isCA?'BOC':isAU?'RBA':'banco central';
      return mk('INFLACIÓN','#ef4444',a,dovishA,N(a.length),hawkishA,
        `Inflación por encima del consenso refuerza escenario hawkish: el ${banco} mantiene tipos altos más tiempo. ${ccy} y yields al alza. La renta variable queda bajo presión.`,
        `Inflación inferior al consenso abre la puerta a recortes de tipos. Presiona ${ccy} y yields a la baja; puede impulsar bolsa y activos de riesgo.`);
    }

    case 'PPI': {
      const a = isUS?['USD','US10Y','SPX','XAUUSD']:isEU?['EUR','DE10Y']:isGB?['GBP','UK10Y']:[ccy,'US10Y'];
      const bolsas=['SPX'];
      const dovishA = a.map(x=>bolsas.includes(x)?'↑ Sube':x==='XAUUSD'?'↑ Sube':'↓ Baja');
      const hawkishA= a.map(x=>bolsas.includes(x)?'↓ Baja':x==='XAUUSD'?'↓ Baja':'↑ Sube');
      return mk('INFLACIÓN','#ef4444',a,dovishA,N(a.length),hawkishA,
        `PPI alto suele anticipar inflación al consumidor en los próximos meses. Refuerza expectativas hawkish: ${ccy} y yields al alza.`,
        `PPI bajo reduce presión inflacionaria en el pipeline productivo. Puede favorecer relajación monetaria, debilitando ${ccy}.`);
    }

    case 'GDP': {
      const a = isUS?['USD','US10Y','SPX','XAUUSD']
        :isEU?['EUR','DE10Y','STOXX50']:isGB?['GBP','UK10Y','FTSE']
        :isJP?['JPY','NIKKEI']:isCA?['CAD','TSX']:[ccy,'SPX'];
      return mk('CRECIMIENTO','#10b981',a,
        a.map(x=>x==='XAUUSD'?'↑ Sube':'↓ Baja'),N(a.length),
        a.map(x=>x==='XAUUSD'?'↓ Baja':'↑ Sube'),
        `PIB fuerte confirma solidez económica. Reduce expectativas de recortes y refuerza ${ccy}, la bolsa local y los rendimientos del bono.`,
        `PIB débil o revisión a la baja aumenta probabilidad de recortes de tipos. Debilita ${ccy} y puede generar presión en la renta variable.`);
    }

    case 'RETAIL': {
      const a = isUS?['USD','SPX','NAS100']:isEU?['EUR','STOXX50']:isGB?['GBP','FTSE']:isCA?['CAD','TSX']:[ccy,'SPX'];
      return mk('CONSUMO','#f59e0b',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Ventas minoristas fuertes reflejan consumo sólido y respaldan el PIB. Positivo para ${ccy} y la renta variable local.`,
        `Ventas débiles sugieren desaceleración del consumo privado. Señal negativa para el crecimiento; presiona ${ccy} y bolsa.`);
    }

    case 'DURABLE_GOODS': {
      const a = isUS?['USD','US10Y','SPX']:[ccy,'SPX'];
      return mk('CRECIMIENTO','#10b981',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Pedidos de bienes duraderos fuertes señalan inversión empresarial activa y robustez industrial. Positivo para el crecimiento y el ${ccy}.`,
        `Pedidos débiles indican desaceleración de la inversión. Señal negativa para el PIB del trimestre y el ${ccy}.`);
    }

    case 'INDUSTRIAL': {
      const a = isUS?['USD','SPX']:isEU?['EUR','STOXX50']:isGB?['GBP','FTSE']:[ccy,'SPX'];
      return mk('CRECIMIENTO','#10b981',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Producción industrial fuerte indica actividad manufacturera sana. Respalda el crecimiento económico y la divisa local.`,
        `Producción débil señala contracción del sector industrial. Presiona la divisa y la renta variable locales.`);
    }

    case 'RATE_DECISION': {
      const a = isUS?['USD','US10Y','SPX','NAS100','XAUUSD']
        :isEU?['EUR','DE10Y','STOXX50','XAUUSD']
        :isGB?['GBP','UK10Y','FTSE']
        :isJP?['JPY','JP10Y','NIKKEI']
        :isCA?['CAD','CA10Y','TSX']
        :isAU?[ccy,'AU10Y']:[ccy,'SPX'];
      const bolsas=['SPX','NAS100','STOXX50','FTSE','NIKKEI','TSX'];
      const banco = isUS?'Fed':isEU?'BCE':isGB?'BOE':isJP?'BOJ':isCA?'BOC':isAU?'RBA':'banco central';
      const hawkA = a.map(x=>bolsas.includes(x)?'↓ Baja':x==='XAUUSD'?'↓ Baja':'↑ Sube');
      const dovA  = a.map(x=>bolsas.includes(x)?'↑ Sube':x==='XAUUSD'?'↑ Sube':'↓ Baja');
      return mk('POLÍTICA MONETARIA','#f97316',a,dovA,N(a.length),hawkA,
        `Decisión hawkish (subida de tipos o tono restrictivo): el ${banco} prioriza control de inflación. Fortalece ${ccy} y yields; la renta variable y el oro bajo presión.`,
        `Decisión dovish (bajada de tipos o tono acomodaticio): el ${banco} prioriza crecimiento. Debilita ${ccy} y yields; impulsa bolsa y activos de riesgo.`);
    }

    case 'CB_MINUTES':
    case 'CB_SPEECH': {
      const a = isUS?['USD','US10Y','SPX','XAUUSD']
        :isEU?['EUR','DE10Y','STOXX50']:isGB?['GBP','UK10Y']:[ccy,'SPX'];
      const bolsas=['SPX','NAS100','STOXX50'];
      const hawkA = a.map(x=>bolsas.includes(x)?'↓ Baja':x==='XAUUSD'?'↓ Baja':'↑ Sube');
      const dovA  = a.map(x=>bolsas.includes(x)?'↑ Sube':x==='XAUUSD'?'↑ Sube':'↓ Baja');
      const isMin = eventType==='CB_MINUTES';
      return mk('POLÍTICA MONETARIA','#f97316',a,dovA,N(a.length),hawkA,
        isMin?`Tono hawkish en las actas refuerza la narrativa restrictiva. ${ccy} y yields al alza; renta variable bajo presión.`
             :`Discurso hawkish del miembro del banco central apoya tipos restrictivos más tiempo. Positivo para ${ccy}.`,
        isMin?`Tono dovish en las actas abre debate interno sobre recortes. Puede presionar ${ccy} y yields a la baja.`
             :`Tono acomodaticio puede generar expectativas de recortes, debilitando ${ccy} y los rendimientos del bono.`);
    }

    case 'TRADE': {
      const a = isUS?['USD','SPX']:isEU?['EUR','STOXX50']:isGB?['GBP']:[ccy];
      return mk('COMERCIO','#6b7280',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Saldo comercial mejor de lo esperado (menor déficit o superávit) refuerza la divisa a medio plazo.`,
        `Déficit comercial mayor de lo esperado puede generar presión bajista sobre la divisa.`);
    }

    case 'HOUSING': {
      const a = isUS?['USD','SPX','US10Y']:isGB?['GBP','FTSE']:[ccy,'SPX'];
      return mk('VIVIENDA','#8b5cf6',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Datos inmobiliarios sólidos reflejan crecimiento económico, consumo activo y confianza empresarial. Positivo para ${ccy} y renta variable.`,
        `Sector inmobiliario débil señala enfriamiento económico. Puede aumentar presión sobre el banco central para recortar tipos.`);
    }

    case 'CONFIDENCE': {
      const a = isUS?['USD','SPX','NAS100','XAUUSD']
        :isEU?['EUR','STOXX50']:isGB?['GBP','FTSE']:[ccy,'SPX'];
      return mk('SENTIMIENTO','#f59e0b',a,
        a.map(x=>x==='XAUUSD'?'↑ Sube':'↓ Baja'),N(a.length),
        a.map(x=>x==='XAUUSD'?'↓ Baja':'↑ Sube'),
        `Confianza alta anticipa mayor gasto del consumidor y actividad económica. Modo risk-on: ${ccy} y renta variable al alza, activos refugio ceden.`,
        `Confianza baja señala cautela del consumidor y posible desaceleración. Modo risk-off: los refugios como el oro pueden beneficiarse.`);
    }

    case 'CREDIT': {
      const a = isUS?['USD','SPX','XAUUSD']:[ccy,'SPX'];
      return mk('CRÉDITO','#6b7280',a,
        a.map(x=>x==='XAUUSD'?'↑ Sube':'↓ Baja'),N(a.length),
        a.map(x=>x==='XAUUSD'?'↓ Baja':'↑ Sube'),
        `Crédito al consumo expansivo refleja demanda interna activa y confianza en gastar. Modestamente positivo para ${ccy} y renta variable.`,
        `Crédito débil o contracción puede indicar enfriamiento del consumo privado. Señal de cautela macro a vigilar.`);
    }

    case 'OIL':
      // Inventarios: más = bajista petróleo; menos = alcista petróleo
      // DÉBIL (inventario bajo, buen dato para precio) → WTI sube
      // FUERTE (inventario alto, mal dato para precio) → WTI baja
      return mk('ENERGÍA','#6b7280',
        ['WTI','USD','CAD'],
        ['↑ Sube','↑ Sube','↑ Sube'], // DÉBIL = inventario bajo = alcista WTI
        N(3),
        ['↓ Baja','↓ Baja','↓ Baja'], // FUERTE = inventario alto = bajista WTI
        `Inventarios bajos reflejan mayor demanda o menor producción. Bullish para WTI/Brent. El CAD puede beneficiarse dada su correlación con el crudo.`,
        `Inventarios altos sugieren exceso de oferta o debilidad de la demanda. Bearish para el petróleo y puede presionar el CAD.`);

    case 'BOND_AUCTION': {
      const a = isUS?['US10Y','USD']:isEU?['DE10Y','EUR']:isGB?['UK10Y','GBP']:['US10Y','USD'];
      return mk('BONOS','#6b7280',a,
        a.map(()=>'↓ Baja'),N(a.length),a.map(()=>'↑ Sube'),
        `Subasta con buena demanda (bid-to-cover alto, rendimiento bajo): los inversores confían en la deuda soberana. Positivo para el bono y la divisa.`,
        `Subasta con demanda débil (rendimiento alto): el mercado exige mayor prima de riesgo. Puede presionar la divisa al alza de yields.`);
    }

    default: return null;
  }
}

function matchEventScenario(name, country) {
  const type = detectEventType(name);
  if (!type || type==='HOLIDAY') return null;
  return buildMacroAnalysis(type, country);
}


function getEventCcy(country) {
  return COUNTRY_CCY[(country||'').toUpperCase()] || country;
}
function getEventFlag(country) {
  const ccy = getEventCcy(country);
  return CCY_FLAG[ccy] || FLAG_MAP[(country||'').toUpperCase()] || '🌐';
}

function calcSentiment(events) {
  const today = new Date().toISOString().slice(0,10);
  const todayEvs = events.filter(e=>e.date?.slice(0,10)===today);
  const highCount = todayEvs.filter(e=>e.impact==='High').length;
  const midCount  = todayEvs.filter(e=>e.impact==='Medium').length;
  const score = highCount * 15 + midCount * 5;
  const vix = 18 + highCount * 1.8 + midCount * 0.5 + (Math.random()*2 - 1);
  const fg = Math.max(5, Math.min(95, 55 - highCount * 5 - midCount * 2));
  let mood, moodColor, riskLabel;
  if (fg >= 65) { mood='GREED'; moodColor='#22c55e'; }
  else if (fg >= 45) { mood='NEUTRAL'; moodColor='#f59e0b'; }
  else if (fg >= 25) { mood='FEAR'; moodColor='#f97316'; }
  else { mood='EXTREME FEAR'; moodColor='#ef4444'; }
  let volLabel;
  if (vix < 15) volLabel='Volatilidad baja. Mercado tranquilo.';
  else if (vix < 25) volLabel='Volatilidad moderada. Atención al mercado.';
  else if (vix < 35) volLabel='Volatilidad alta. Gestión del riesgo activa.';
  else volLabel='Volatilidad extrema. Mercado en crisis.';
  const scoreOf5 = Math.min(5, Math.round(highCount * 1.5 + midCount * 0.5));
  return {score, vix: vix.toFixed(2), fg, mood, moodColor, volLabel, scoreOf5, highCount, midCount};
}

// ─── MAIN CALENDARIO COMPONENT ───────────────────────────────────────────────
function CalendarioTab({darkMode, T}) {
  const [events,    setEvents]   = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState(null);
  const [weekRange, setWeekRange]= useState('thisweek');
  const [todayOnly, setTodayOnly]= useState(false);
  const [expanded,  setExpanded] = useState(null);
  // advancedOpen: Set de keys de eventos con la sección avanzada abierta en mobile
  const [advancedOpen, setAdvancedOpen] = useState(new Set());
  // advRefs: mapa de refs por evKey para calcular scrollHeight real en la animación
  const advRefs = useRef({});
  const [filters,   setFilters]  = useState({impact:'all', country:'all', cat:'all'});
  const [showFilters, setShowFilters] = useState(false);
  const [isMobile, setIsMobile]  = useState(()=>window.innerWidth < 700);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [emptyReason,   setEmptyReason]   = useState(null);
  const [watchdogActive, setWatchdogActive] = useState(false);

  useEffect(()=>{
    const handler = ()=>setIsMobile(window.innerWidth < 700);
    window.addEventListener('resize', handler);
    return ()=>window.removeEventListener('resize', handler);
  }, []);

  // Usar el mismo tema que el resto de la app (T viene del AppInner)
  const D = {
    bg:      T.bg,
    card:    T.card,
    card2:   darkMode ? '#1e2028' : '#f0f2f5',
    border:  T.border,
    border2: T.border,
    txt:     T.txt,
    sub:     T.sub,
    sub2:    darkMode ? '#5a6070' : '#9ca3af',
    accent:  T.accent,
    bull:    '#22c55e',
    bear:    '#ef4444',
    amber:   '#f59e0b',
  };

  // Timezone local del usuario
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzLabel = userTZ.split('/').pop().replace('_',' ');

  // Tick para countdown (actualiza cada segundo)
  const [tick, setTick] = useState(0);
  useEffect(()=>{
    const id = setInterval(()=>setTick(t=>t+1), 1000);
    return ()=>clearInterval(id);
  }, []);

  const fetchEvents = async (range, forced) => {
    const r = range ?? weekRange;
    const f = forced ?? false;
    const apiRange = r === 'hoy' ? 'thisweek' : r;
    setLoading(prev => f ? false : prev || true);
    if (!f) setError(null);
    try {
      const forceParam = f ? '&force=true' : '';
      const res = await fetch(`/api/calendar?range=${apiRange}${forceParam}`);
      let data;
      try { data = await res.json(); } catch { data = []; }
      if (!Array.isArray(data)) {
        if (!f) setError(data?.msg || `Error HTTP ${res.status}`);
        return;
      }
      setError(null);
      setLastFetchTime(new Date());
      // Separar metadatos del backend (_meta:true) de los eventos reales
      const metaItem  = data.find(d => d._meta === true);
      const realEvents = data.filter(d => !d._meta);
      setEmptyReason(metaItem?._empty_reason ?? null);
      setEvents(realEvents.sort((a, b) => new Date(a.date) - new Date(b.date)));
    } catch (e) {
      if (!f) setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{ fetchEvents(); }, []);

  // Auto-refresh base: cada 2 min para thisweek (light, no-force)
  useEffect(()=>{
    if (weekRange !== 'thisweek' && weekRange !== 'hoy') return;
    const id = setInterval(()=>fetchEvents(weekRange, false), 2 * 60 * 1000);
    return ()=>clearInterval(id);
  }, [weekRange]);

  // pendingCount: solo eventos macro numéricos pasados sin actual
  // (excluye speeches, auctions, minutes — igual que isPending en backend)
  const nowMs = Date.now();
  const today = new Date().toISOString().slice(0,10);
  const pendingCount = events.filter(ev => {
    if (ev.date?.slice(0,10) !== today) return false;         // solo hoy
    const evMs = new Date(ev.date).getTime();
    if (evMs >= nowMs) return false;                           // no futuros
    if (ev.actual !== null && ev.actual !== undefined && ev.actual !== '') return false;
    // Misma regex que backend: excluir no-numéricos
    const name = (ev.event || '').toLowerCase();
    if (/auction|speech|minutes|statement|report|press.?conference|testimo|speaks|outlook|survey|bulletin|opec/i.test(name)) return false;
    return true;
  }).length;

  // Watchdog: si hay pendientes numéricos hoy → revalidar cada 60s
  // Se detiene automáticamente cuando pendingCount llega a 0
  useEffect(()=>{
    const isActive = pendingCount > 0 && (weekRange === 'thisweek' || weekRange === 'hoy');
    setWatchdogActive(isActive);
    if (!isActive) return;
    const id = setInterval(()=>fetchEvents(weekRange, true), 60 * 1000);
    return ()=>clearInterval(id);
  }, [pendingCount, weekRange]); // eslint-disable-line

  const changeRange = (r) => {
    setWeekRange(r);
    setTodayOnly(r==='hoy');
    fetchEvents(r);
  };

  // Formatear hora en zona horaria LOCAL del usuario
  const fmtTime = (d) => {
    try {
      return new Date(d).toLocaleTimeString('es-ES',{
        hour:'2-digit', minute:'2-digit',
        timeZone: userTZ
      });
    } catch { return '--:--'; }
  };

  // Calcular countdown hasta el evento
  const getCountdown = (dateStr) => {
    const evMs = new Date(dateStr).getTime();
    const nowMs = Date.now();
    const diffMs = evMs - nowMs;
    const diffSec = Math.floor(diffMs / 1000);
    const threeHours = 3 * 3600;
    if (diffSec <= 0) return null; // ya pasó
    if (diffSec > threeHours) return null; // más de 3h, no mostrar
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    const s = diffSec % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  const fmtDate = (d) => {
    try {
      const dt = new Date(d+'T12:00:00');
      return dt.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})
        .replace(/^./, c=>c.toUpperCase());
    } catch { return d; }
  };
  const fmtDateShort = (d) => {
    try {
      return new Date(d+'T12:00:00').toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'})
        .toUpperCase();
    } catch { return d; }
  };
  const fmtVal = (v) => (v==null||v==='')?'—':String(v);
  const surpriseDir = (a,e) => {
    const av=parseFloat(a), ev=parseFloat(e);
    if (isNaN(av)||isNaN(ev)) return 0;
    return av>ev?1:av<ev?-1:0;
  };

  const now = new Date();
  const todayStr = now.toLocaleDateString('sv-SE', {timeZone: userTZ}); // YYYY-MM-DD en timezone local
  const nowHHMM  = now.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:userTZ});

  // Apply filters
  const filtered = events.filter(ev => {
    // Filtro HOY
    if (todayOnly && ev.date?.slice(0,10) !== todayStr) return false;
    if (filters.impact!=='all' && ev.impact!==filters.impact) return false;
    const ccy = getEventCcy(ev.country);
    if (filters.country!=='all' && ccy!==filters.country) return false;
    if (filters.cat!=='all') {
      const sc = matchEventScenario(ev.event, ev.country);
      if (!sc||sc.cat!==filters.cat) return false;
    }
    return true;
  });

  // Group by day
  const grouped = {};
  filtered.forEach(ev=>{
    const d = ev.date?.slice(0,10)||'?';
    if (!grouped[d]) grouped[d]=[];
    grouped[d].push(ev);
  });

  const sentiment = calcSentiment(events);
  const risk = calcRisk(events);

  // Unique countries for filter
  const countries = [...new Set(events.map(e=>getEventCcy(e.country)).filter(Boolean))].sort();
  const categories = [...new Set(events.map(e=>{
    const sc=matchEventScenario(e.event,e.country); return sc?.cat;
  }).filter(Boolean))].sort();

  const impColor = (imp) => imp==='High'?D.bear:imp==='Medium'?D.amber:D.sub2;

  return (
    <div style={{background:D.bg,minHeight:'100vh',fontFamily:"'Inter','SF Pro Text',Helvetica,sans-serif",
      overflowX:'hidden',width:'100%',boxSizing:'border-box'}}>
      <style>{`
        @keyframes spinC{to{transform:rotate(360deg)}}
        @keyframes nowPulse{0%,100%{opacity:1}50%{opacity:0.5}}
        @keyframes cdPulse{0%,100%{opacity:1}50%{opacity:0.7}}
        .ev-row:hover { background: ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'} !important; }
        .ev-row:hover .ev-name { color: ${darkMode ? '#ffffff' : '#111827'} !important; }
        .ev-row { transition: background 0.1s; }
        .filter-chip { transition: all 0.15s; cursor: pointer; }
        .filter-chip:hover { opacity: 0.85; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{maxWidth:1000,margin:'0 auto',padding:isMobile?'12px 10px 80px':'16px 16px 80px',
        overflowX:'hidden',width:'100%'}}>

        {/* ── SENTIMENT CARD ─────────────────────────────────────────── */}
        <div style={{background:D.card,border:`1px solid ${D.border}`,borderRadius:16,
          padding:'20px 24px',marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:D.txt}}>Sentimiento & Volatilidad</div>
              <div style={{fontSize:11,color:D.sub,marginTop:2}}>Score: {sentiment.scoreOf5}/5 · {sentiment.highCount} eventos alto impacto hoy</div>
            </div>
            <div style={{width:24,height:24,borderRadius:'50%',border:`1px solid ${D.border2}`,
              display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
              <span style={{fontSize:11,color:D.sub}}>i</span>
            </div>
          </div>

          {/* Mood */}
          <div style={{fontSize:28,fontWeight:800,color:sentiment.moodColor,
            letterSpacing:'-0.5px',marginBottom:12}}>{sentiment.mood}</div>

          {/* Fear/Greed bar */}
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <span style={{fontSize:10,fontWeight:600,color:D.sub,letterSpacing:'0.08em'}}>FEAR</span>
              <span style={{fontSize:10,fontWeight:600,color:D.sub,letterSpacing:'0.08em'}}>GREED</span>
            </div>
            <div style={{position:'relative',height:8,borderRadius:99,
              background:'linear-gradient(90deg,#ef4444 0%,#f97316 30%,#f59e0b 50%,#84cc16 70%,#22c55e 100%)'}}>
              <div style={{position:'absolute',top:'50%',left:`${sentiment.fg}%`,
                transform:'translate(-50%,-50%)',
                width:14,height:14,borderRadius:'50%',
                background:'white',boxShadow:'0 0 0 2px #0d0f12',
                transition:'left 0.5s ease'}}/>
            </div>
          </div>

          {/* VIX */}
          <div style={{display:'flex',alignItems:'flex-end',gap:10,marginBottom:6}}>
            <span style={{fontSize:32,fontWeight:800,color:D.txt,letterSpacing:'-1px'}}>{sentiment.vix}</span>
            <span style={{fontSize:13,color:sentiment.vix>25?D.bear:sentiment.vix>18?D.amber:D.bull,
              fontWeight:600,marginBottom:5}}>
              VIX est.
            </span>
          </div>
          <div style={{fontSize:12,color:D.sub,lineHeight:1.5,marginBottom:14}}>{sentiment.volLabel}</div>

          {/* VIX scale */}
          <div style={{marginTop:4}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              {['10','20','30','40+'].map(v=>(
                <span key={v} style={{fontSize:10,color:D.sub2}}>{v}</span>
              ))}
            </div>
            <div style={{position:'relative',height:6,borderRadius:99,
              background:'linear-gradient(90deg,#22c55e 0%,#84cc16 25%,#f59e0b 50%,#f97316 75%,#ef4444 100%)'}}>
              <div style={{position:'absolute',top:'50%',
                left:`${Math.min(95,Math.max(2,(parseFloat(sentiment.vix)-10)/30*100))}%`,
                transform:'translate(-50%,-50%)',
                width:12,height:12,borderRadius:'50%',
                background:'white',boxShadow:'0 0 0 2px #0d0f12'}}/>
            </div>
          </div>
        </div>

        {/* ── RISK BAR ────────────────────────────────────────────────── */}
        <div style={{background:risk.bg,border:`1px solid ${risk.border}`,borderRadius:12,
          padding:'10px 16px',marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:18}}>{risk.icon}</span>
          <div style={{flex:1}}>
            <span style={{fontSize:13,fontWeight:700,color:risk.color}}>{risk.label}</span>
            <span style={{fontSize:11,color:D.sub,marginLeft:10}}>Riesgo agregado: {risk.score}</span>
          </div>
        </div>

        {/* ── FILTROS — scroll horizontal único ──────────────────────── */}
        
        <div style={{marginBottom:6,overflowX:'auto',paddingTop:6,paddingBottom:4,
          WebkitOverflowScrolling:'touch'}}>
          <div style={{display:'flex',gap:5,alignItems:'center',
            minWidth:'max-content'}}>
            {[['hoy','📅 Hoy'],['thisweek','Esta semana'],['lastweek','↩ Pasada'],['nextweek','→ Próxima']].map(([id,label])=>(
              <button key={id} onClick={()=>changeRange(id)} className="filter-chip"
                style={{padding:'5px 12px',borderRadius:20,fontSize:isMobile?13:12,fontWeight:600,
                  flexShrink:0,cursor:'pointer',lineHeight:'1.4',
                  border:`1.5px solid ${weekRange===id?D.accent:D.border}`,
                  background:weekRange===id?D.accent:'transparent',
                  color:weekRange===id?'white':D.sub}}>
                {label}
              </button>
            ))}
            <div style={{width:1,background:D.border,flexShrink:0,margin:'0 2px',height:20,alignSelf:'center'}}/>
            {[['all','Todos'],['High','🔴 Alto'],['Medium','🟡 Medio'],['Low','⚪ Bajo']].map(([id,label])=>{
              const isActive = filters.impact===id;
              const col = impColor(id==='all'?null:id);
              return (
                <button key={id} onClick={()=>setFilters(f=>({...f,impact:id}))} className="filter-chip"
                  style={{padding:'5px 10px',borderRadius:20,fontSize:isMobile?13:11,fontWeight:600,
                    flexShrink:0,cursor:'pointer',lineHeight:'1.4',
                    border:`1.5px solid ${isActive?col:D.border}`,
                    background:isActive?col+'22':'transparent',
                    color:isActive?col:D.sub}}>
                  {label}
                </button>
              );
            })}
            <button onClick={()=>setShowFilters(f=>!f)} className="filter-chip"
              style={{padding:'5px 10px',borderRadius:20,fontSize:12,flexShrink:0,cursor:'pointer',
                lineHeight:'1.4',
                border:`1.5px solid ${showFilters?D.accent:D.border}`,
                background:showFilters?D.accent+'20':'transparent',
                color:showFilters?D.accent:D.sub}}>⚙</button>
            <button onClick={()=>fetchEvents(weekRange)}
              style={{padding:'5px 10px',borderRadius:20,fontSize:12,color:D.sub,flexShrink:0,
                border:`1.5px solid ${D.border}`,background:'transparent',cursor:'pointer',
                lineHeight:'1.4'}}>⟳</button>
          </div>
        </div>
        {/* Timezone label + estado fetch */}
        <div style={{fontSize:10,color:D.sub2,marginBottom:8,textAlign:'right',
          display:'flex',justifyContent:'flex-end',alignItems:'center',gap:6}}>
          <span>🕐 <strong style={{color:D.sub}}>{tzLabel}</strong></span>
          {lastFetchTime&&(
            <span style={{fontSize:10,color:D.sub2,opacity:0.8}}>
              · {lastFetchTime.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
              {watchdogActive&&<span style={{marginLeft:4,color:D.amber,fontWeight:700}}>·</span>}
            </span>
          )}
        </div>

        {/* ── ADVANCED FILTERS ─────────────────────────────────────────── */}
        {showFilters&&(
          <div style={{background:D.card,border:`1px solid ${D.border}`,borderRadius:12,
            padding:'14px 16px',marginBottom:12,display:'flex',gap:16,flexWrap:'wrap'}}>
            {/* Currency filter */}
            <div>
              <div style={{fontSize:10,fontWeight:600,color:D.sub,letterSpacing:'0.06em',marginBottom:6}}>DIVISA</div>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                {['all',...countries].map(c=>(
                  <button key={c} onClick={()=>setFilters(f=>({...f,country:c}))}
                    className="filter-chip"
                    style={{padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:600,border:'none',
                      background:filters.country===c?D.accent+'33':'transparent',
                      color:filters.country===c?D.accent:D.sub,
                      outline:`1px solid ${filters.country===c?D.accent:D.border}`}}>
                    {c==='all'?'Todos':c}
                  </button>
                ))}
              </div>
            </div>
            {/* Category filter */}
            <div>
              <div style={{fontSize:10,fontWeight:600,color:D.sub,letterSpacing:'0.06em',marginBottom:6}}>CATEGORÍA</div>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                {['all',...categories].map(c=>(
                  <button key={c} onClick={()=>setFilters(f=>({...f,cat:c}))}
                    className="filter-chip"
                    style={{padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:600,border:'none',
                      background:filters.cat===c?D.amber+'33':'transparent',
                      color:filters.cat===c?D.amber:D.sub,
                      outline:`1px solid ${filters.cat===c?D.amber:D.border}`}}>
                    {c==='all'?'Todas':c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading&&(
          <div style={{textAlign:'center',padding:48}}>
            <div style={{width:28,height:28,border:`2px solid ${D.border2}`,borderTopColor:D.accent,
              borderRadius:'50%',animation:'spinC 0.8s linear infinite',margin:'0 auto 12px'}}/>
            <p style={{margin:0,fontSize:13,color:D.sub}}>Cargando calendario...</p>
          </div>
        )}
        {error&&!loading&&(
          <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',
            borderRadius:10,padding:'12px 16px',fontSize:13,color:D.bear,marginBottom:16}}>
            ⚠ {error}
          </div>
        )}
        {!loading&&!error&&filtered.length===0&&(
          <div style={{textAlign:'center',padding:'48px 24px',color:D.sub}}>
            <div style={{fontSize:40,marginBottom:12}}>
              {weekRange==='lastweek'?'🗂️':weekRange==='nextweek'?'🔭':'📅'}
            </div>
            <p style={{margin:'0 0 8px',fontSize:15,fontWeight:600,color:D.txt}}>
              {weekRange==='lastweek'?'Sin datos de la semana pasada'
                :weekRange==='nextweek'?'El calendario de la próxima semana aún no está disponible'
                :'No hay eventos para este período'}
            </p>
            {emptyReason&&(
              <p style={{margin:'0 0 16px',fontSize:12,color:D.sub,maxWidth:480,lineHeight:1.6,marginLeft:'auto',marginRight:'auto'}}>
                {emptyReason}
              </p>
            )}
            {weekRange==='lastweek'&&!emptyReason&&(
              <p style={{margin:'0 0 16px',fontSize:12,color:D.sub,maxWidth:420,lineHeight:1.6,marginLeft:'auto',marginRight:'auto'}}>
                Forex Factory no expone datos históricos en su API gratuita. Los datos de la semana pasada estarán disponibles si el servidor los guardó durante esa semana.
              </p>
            )}
            {weekRange==='nextweek'&&(
              <p style={{margin:'0 0 16px',fontSize:12,color:D.sub}}>
                Forex Factory publica el calendario semanal habitualmente el jueves o viernes.
              </p>
            )}
            <button onClick={()=>fetchEvents(weekRange, true)}
              style={{padding:'8px 20px',borderRadius:20,border:`1.5px solid ${D.border}`,
                background:'transparent',color:D.sub,fontSize:12,cursor:'pointer',fontWeight:600}}>
              ⟳ Reintentar
            </button>
          </div>
        )}

        {/* ── DAY GROUPS ──────────────────────────────────────────────── */}
        {!loading&&Object.entries(grouped).map(([date,dayEvents])=>{
          const isToday = date===todayStr;
          const dayRisk = calcRisk(dayEvents);
          let nowShown = false;

          // Column headers (solo desktop)
          const ColHeader = () => isMobile ? null : (
            <div style={{display:'grid',gridTemplateColumns:'64px 80px 1fr 80px 72px 82px 72px 24px',
              gap:4,padding:'8px 16px',
              borderBottom:`1px solid ${D.border}`,
              background:darkMode?'rgba(255,255,255,0.02)':'rgba(0,0,0,0.03)'}}>
              {['HORA','DIV.','EVENTO','IMPACTO','ACTUAL','PREVISIÓN','ANTERIOR',''].map((h,i)=>(
                <div key={i} style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',
                  textAlign:i>=4&&i<7?'right':'left'}}>{h}</div>
              ))}
            </div>
          );

          return (
            <div key={date} style={{marginBottom:20}}>
              {/* Day header */}
              <div style={{display:'flex',alignItems:'center',gap:12,
                padding:'8px 12px',marginBottom:4}}>
                <div style={{flex:1}}>
                  <span style={{fontSize:11,fontWeight:700,color:isToday?D.accent:D.sub,
                    letterSpacing:'0.06em',textTransform:'uppercase'}}>
                    {isToday?'HOY — ':''}{fmtDateShort(date)}
                  </span>
                  <span style={{fontSize:11,color:D.sub2,marginLeft:8}}>
                    — {dayEvents.length} {dayEvents.length===1?'evento':'eventos'}
                  </span>
                </div>
                <span style={{fontSize:11,fontWeight:600,color:dayRisk.color,
                  background:dayRisk.bg,border:`1px solid ${dayRisk.border}`,
                  padding:'2px 10px',borderRadius:99}}>
                  {dayRisk.label} · {dayRisk.score}
                </span>
              </div>

              {/* Table */}
              <div style={{background:D.card,border:`1px solid ${D.border}`,borderRadius:12,overflow:'hidden'}}>
                <ColHeader/>
                {dayEvents.map((ev,idx)=>{
                  const evTime   = fmtTime(ev.date);
                  const evMs     = new Date(ev.date).getTime();
                  const nowMs    = Date.now();
                  const isPast   = evMs < nowMs;
                  const isUp     = !isPast;
                  const isExp    = expanded===`${date}-${idx}`;
                  const stars    = ev.impact==='High'?3:ev.impact==='Medium'?2:1;
                  const iCol     = impColor(ev.impact);
                  const flag     = getEventFlag(ev.country);
                  const ccy      = getEventCcy(ev.country);
                  const sc       = matchEventScenario(ev.event, ev.country);
                  // Robust actual value — try multiple fields
                  // CRÍTICO: actual=0 es un valor válido — no tratar como falsy
                  const actualVal = ev.actual !== null && ev.actual !== undefined ? ev.actual
                    : ev.result !== null && ev.result !== undefined ? ev.result
                    : ev.value  !== null && ev.value  !== undefined ? ev.value
                    : null;
                  const hasAct = actualVal !== null && actualVal !== undefined
                    && String(actualVal).trim() !== '' && String(actualVal) !== 'null';
                  // isPending viene del backend — ya filtra speeches/auctions/minutes
                  const isPending = ev.isPending === true;
                  // Sorpresa: actual - forecast, también en %
                  const sDir     = (()=>{
                    if (!hasAct || ev.estimate==null) return 0;
                    const a=parseFloat(actualVal), e=parseFloat(ev.estimate);
                    if (isNaN(a)||isNaN(e)) return 0;
                    return a>e?1:a<e?-1:0;
                  })();
                  const sColor   = sDir>0?D.bull:sDir<0?D.bear:D.sub;
                  const estColor = ev.estimate!=null&&ev.previous!=null
                    ? parseFloat(ev.estimate)>parseFloat(ev.previous)?D.bull
                      : parseFloat(ev.estimate)<parseFloat(ev.previous)?D.bear:D.sub
                    : D.sub;
                  const countdown = getCountdown(ev.date);
                  const isPublished = isPast && (hasAct || evMs < nowMs - 300000); // 5min grace period

                  // "Ahora" divider
                  let nowLine = null;
                  if (isToday && isUp && !nowShown) {
                    nowShown = true;
                    nowLine = (
                      <div key="nowline" style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px'}}>
                        <div style={{flex:1,height:1,background:`linear-gradient(90deg,transparent,${D.accent})`}}/>
                        <span style={{fontSize:10,fontWeight:700,color:'white',background:D.accent,
                          padding:'2px 10px',borderRadius:99,whiteSpace:'nowrap',
                          animation:'nowPulse 2s ease infinite'}}>
                          Ahora · {nowHHMM}
                        </span>
                        <div style={{flex:1,height:1,background:`linear-gradient(90deg,${D.accent},transparent)`}}/>
                      </div>
                    );
                  }

                  return [nowLine,(
                    <div key={`${date}-${idx}`}>
                      {isMobile ? (
                        /* ── MÓVIL: CARD LAYOUT ── */
                        <div className="ev-row"
                          onClick={()=>setExpanded(isExp?null:`${date}-${idx}`)}
                          style={{padding:'12px 14px',cursor:'pointer',
                            opacity: isPast && !hasAct ? 0.55 : 1,
                            borderLeft:`3px solid ${stars===3?iCol:stars===2?D.amber+'80':'transparent'}`,
                            background:isExp?D.card2:'transparent',
                            borderBottom:idx<dayEvents.length-1?`1px solid ${D.border}`:'none'}}>
                          {/* Row 1: time + flag+ccy + impact badge + chevron */}
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                            <div style={{display:'flex',flexDirection:'column',minWidth:52}}>
                              <span style={{fontSize:15,fontWeight:700,color:isPast&&!hasAct?D.sub2:D.txt,
                                fontFamily:'monospace'}}>{evTime}</span>
                              {countdown&&(
                                <span style={{fontSize:11,fontWeight:700,
                                  color:countdown.startsWith('00:')?D.bear:D.amber,
                                  animation:'cdPulse 1s ease infinite'}}>
                                  ⏱ {countdown}
                                </span>
                              )}
                              {isPublished&&!countdown&&(
                                <span style={{fontSize:11,fontWeight:600,color:D.bull}}>✓ Pub.</span>
                              )}
                            </div>
                            {/* Flag + CCY — solo una vez */}
                            <div style={{display:'flex',alignItems:'center',gap:6,flex:1}}>
                              <span style={{fontSize:22}}>{flag}</span>
                              <span style={{fontSize:14,fontWeight:800,color:D.accent,
                                letterSpacing:'0.05em'}}>{ccy}</span>
                            </div>
                            {/* Stars */}
                            <div style={{display:'flex',gap:2}}>
                              {[1,2,3].map(i=>(
                                <span key={i} style={{fontSize:14,color:i<=stars?iCol:darkMode?'#2a2d33':'#d1d5db'}}>★</span>
                              ))}
                            </div>
                            {/* Impact */}
                            <span style={{fontSize:12,fontWeight:700,color:iCol,
                              background:iCol+'20',padding:'4px 10px',borderRadius:99}}>
                              {ev.impact==='High'?'Alto':ev.impact==='Medium'?'Medio':'Bajo'}
                            </span>
                            <span style={{fontSize:14,color:D.sub2}}>{isExp?'∧':'∨'}</span>
                          </div>
                          {/* Row 2: event name */}
                          <div className="ev-name"
                            style={{fontSize:14,fontWeight:600,color:D.txt,marginBottom:6,lineHeight:1.3}}>
                            {ev.event}
                          </div>
                          {/* Row 3: P / F / A */}
                          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                            {ev.previous!=null&&(
                              <span style={{fontSize:12,color:D.sub}}>
                                P: <strong style={{color:D.txt}}>{fmtVal(ev.previous)}</strong>
                              </span>
                            )}
                            {ev.estimate!=null&&(
                              <span style={{fontSize:12,color:D.sub}}>
                                F: <strong style={{color:estColor}}>
                                  {estColor===D.bull?'▲ ':estColor===D.bear?'▼ ':''}{fmtVal(ev.estimate)}
                                </strong>
                              </span>
                            )}
                            {hasAct&&(
                              <span style={{fontSize:12,color:D.sub}}>
                                A: <strong style={{color:sColor}}>{fmtVal(actualVal)}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* ── DESKTOP: TABLE ROW ── */
                        <div className="ev-row"
                          onClick={()=>setExpanded(isExp?null:`${date}-${idx}`)}
                          style={{display:'grid',
                            gridTemplateColumns:'64px 80px 1fr 80px 72px 82px 72px 24px',
                            gap:4,padding:'10px 16px',cursor:'pointer',
                            opacity: isPast && !hasAct ? 0.55 : 1,
                            borderLeft:`3px solid ${stars===3?iCol:stars===2?D.amber+'70':'transparent'}`,
                            background:isExp?D.card2:'transparent',
                            borderBottom:idx<dayEvents.length-1?`1px solid ${D.border}`:'none'}}>
                          {/* Time */}
                          <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:2}}>
                            <span style={{fontSize:12,fontWeight:600,
                              color:isPast&&!hasAct?D.sub2:D.txt,fontFamily:'monospace'}}>
                              {evTime}
                            </span>
                            {countdown&&(
                              <span style={{fontSize:9,fontWeight:700,
                                color:countdown.startsWith('00:')?D.bear:D.amber,
                                animation:'cdPulse 1s ease infinite'}}>
                                ⏱ {countdown}
                              </span>
                            )}
                            {isPublished&&!countdown&&(
                              <span style={{fontSize:9,fontWeight:600,color:D.bull}}>✓ Pub.</span>
                            )}
                          </div>
                          {/* Flag + CCY — solo una vez, sin country code */}
                          <div style={{display:'flex',flexDirection:'column',gap:2,justifyContent:'center'}}>
                            <div style={{display:'flex',alignItems:'center',gap:4}}>
                              <span style={{fontSize:18,lineHeight:1}}>{flag}</span>
                            </div>
                            <span style={{fontSize:11,fontWeight:800,color:D.accent,letterSpacing:'0.05em'}}>
                              {ccy}
                            </span>
                          </div>
                          {/* Name + stars */}
                          <div style={{display:'flex',flexDirection:'column',justifyContent:'center',minWidth:0}}>
                            <div className="ev-name"
                              style={{fontSize:13,fontWeight:600,color:D.txt,
                                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              {ev.event}
                            </div>
                            <div style={{display:'flex',gap:2,marginTop:2}}>
                              {[1,2,3].map(i=>(
                                <span key={i} style={{fontSize:10,
                                  color:i<=stars?iCol:darkMode?'#2a2d33':'#d1d5db'}}>★</span>
                              ))}
                            </div>
                          </div>
                          {/* Impact badge */}
                          <div style={{display:'flex',alignItems:'center'}}>
                            <span style={{fontSize:10,fontWeight:700,color:iCol,background:iCol+'20',
                              padding:'3px 7px',borderRadius:99,whiteSpace:'nowrap'}}>
                              {ev.impact==='High'?'Alto':ev.impact==='Medium'?'Medio':'Bajo'}
                            </span>
                          </div>
                          {/* Actual */}
                          <div style={{textAlign:'right',fontSize:12,fontWeight:hasAct?700:400,
                            color:hasAct?sColor:D.sub2,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                            {hasAct ? fmtVal(actualVal) : isPending ? (
                              <span style={{fontSize:9,fontWeight:700,color:'#f59e0b',
                                background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.25)',
                                borderRadius:6,padding:'2px 6px'}}>PEND.</span>
                            ) : '—'}
                          </div>
                          {/* Estimate */}
                          <div style={{textAlign:'right',fontSize:12,fontWeight:600,
                            color:estColor,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                            {ev.estimate!=null?(
                              <span>{estColor===D.bull?'▲ ':estColor===D.bear?'▼ ':''}{fmtVal(ev.estimate)}</span>
                            ):'—'}
                          </div>
                          {/* Previous */}
                          <div style={{textAlign:'right',fontSize:12,color:D.sub,
                            display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                            {fmtVal(ev.previous)}
                          </div>
                          {/* Chevron */}
                          <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',
                            fontSize:12,color:D.sub2}}>{isExp?'∧':'∨'}</div>
                        </div>
                      )}

                      {/* ── EXPANDED ─────────────────────────────────── */}
                      {isExp&&(()=>{
                        // ── MOTOR DE LÓGICA MACRO (inlined) ──────────
                        const logic      = getIndicatorLogic(ev.event, ccy, actualVal, ev.estimate, ev.previous);

                        // ── VALIDATION LOG — remove after QA ─────────
                        if (actualVal !== null) {
                          console.log('[logic]', {
                            event:    ev.event,
                            actual:   actualVal,
                            forecast: ev.estimate,
                            evType:   logic.evType,
                            group:    logic.group,
                            biasScore: logic.macroScore?.score,
                            biasLabel: logic.macroScore?.label,
                            primaryBias: logic.primaryBias,
                            assets: logic.affectedAssets?.map(a => `${a.arrow}${a.asset}`).join(' '),
                          });
                        }

                        const evType     = logic.evType;
                        const surprise   = logic.surprise;
                        const delta      = logic.delta;
                        const regime     = logic.regime;
                        const macroScore = logic.macroScore;
                        const impLvl     = surprise ? getImpactLevel(surprise.pct) : null;
                        const dynInterp  = logic.explanation;
                        const horizon    = hasAct && surprise ? logic.horizon    : null;
                        const confBadge  = hasAct && surprise ? logic.confidence : null;
                        const assetDirs  = hasAct && surprise ? logic.affectedAssets : null;
                        const sc         = logic.scenarios;
                        // Acordeón avanzado: clave única por evento
                        const evKey = `${date}-${idx}`;
                        const isAdvOpen = !isMobile || advancedOpen.has(evKey);
                        const toggleAdv = () => setAdvancedOpen(prev => {
                          const next = new Set(prev);
                          next.has(evKey) ? next.delete(evKey) : next.add(evKey);
                          return next;
                        });
                        return (
                        <div style={{background:D.card2,borderBottom:`1px solid ${D.border}`,
                          padding:isMobile?'12px 14px 16px':'16px 20px 20px',
                          borderLeft:`3px solid ${stars===3?iCol:stars===2?D.amber+'80':'transparent'}`,
                          boxSizing:'border-box',width:'100%',overflow:'hidden'}}>

                          {/* ── BADGE ROW ── */}
                          <div style={{display:'flex',gap:isMobile?5:6,marginBottom:isMobile?12:16,flexWrap:'wrap',alignItems:'center'}}>
                            {sc&&(<span style={{fontSize:isMobile?10:11,fontWeight:700,background:sc.col+'22',color:sc.col,
                              padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,letterSpacing:'0.05em',border:`1px solid ${sc.col}35`}}>{sc.cat}</span>)}
                            <span style={{fontSize:isMobile?10:11,fontWeight:700,padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,
                              background:iCol+'18',color:iCol,border:`1px solid ${iCol}30`}}>
                              {ev.impact==='High'?'Alto':ev.impact==='Medium'?'Medio':'Bajo'}
                            </span>
                            <span style={{fontSize:isMobile?10:11,color:D.sub,padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,
                              background:D.card,border:`1px solid ${D.border}`}}>
                              {flag} {ev.country} · {ccy}
                            </span>
                            {regime&&(<span style={{fontSize:isMobile?10:11,fontWeight:700,padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,
                              background:regime.bg,color:regime.color,border:`1px solid ${regime.color}30`}}>
                              {regime.icon} {regime.label}
                            </span>)}
                            {impLvl&&surprise&&Math.abs(surprise.pct)>=0.3&&(<span style={{fontSize:isMobile?10:11,fontWeight:700,padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,
                              background:impLvl.bg,color:impLvl.color,border:`1px solid ${impLvl.color}30`}}>
                              IMPACTO: {impLvl.label.toUpperCase()}
                            </span>)}
                            {confBadge&&(<span style={{fontSize:isMobile?10:11,fontWeight:600,padding:isMobile?'3px 9px':'4px 12px',borderRadius:99,
                              background:confBadge.bg,color:confBadge.color,border:`1px solid ${confBadge.color}30`}}>
                              ◎ {confBadge.label}
                            </span>)}
                          </div>

                          {/* ── KPI CARDS 2×2 ── */}
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:isMobile?6:8,marginBottom:isMobile?10:14}}>

                            {/* ANTERIOR */}
                            <div style={{background:D.card,borderRadius:isMobile?10:14,padding:isMobile?'10px 12px':'14px 16px',
                              border:`1px solid ${D.border}`,boxShadow:'0 2px 10px rgba(0,0,0,0.15)'}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:isMobile?4:8}}>ANTERIOR</div>
                              <div style={{fontSize:isMobile?18:22,fontWeight:800,color:D.sub,lineHeight:1,marginBottom:3}}>{fmtVal(ev.previous)}</div>
                              {delta&&hasAct&&(<div style={{fontSize:isMobile?9:10,fontWeight:600,color:delta.dir>0?D.bull:delta.dir<0?D.bear:D.sub2}}>
                                {delta.dir>0?'↑':delta.dir<0?'↓':''} vs ant: {delta.dir>0?'+':''}{delta.pct.toFixed(2)}%
                              </div>)}
                            </div>

                            {/* PREVISIÓN */}
                            <div style={{background:ev.estimate!=null?(estColor===D.bull?'rgba(34,197,94,0.07)':estColor===D.bear?'rgba(239,68,68,0.07)':D.card):D.card,
                              borderRadius:isMobile?10:14,padding:isMobile?'10px 12px':'14px 16px',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',
                              border:`1px solid ${ev.estimate!=null?(estColor===D.bull?'rgba(34,197,94,0.25)':estColor===D.bear?'rgba(239,68,68,0.25)':D.border):D.border}`}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:isMobile?4:8}}>PREVISIÓN</div>
                              <div style={{fontSize:isMobile?18:22,fontWeight:800,color:ev.estimate!=null?estColor:D.sub,lineHeight:1}}>
                                {ev.estimate!=null?(<>{estColor===D.bull?'▲ ':estColor===D.bear?'▼ ':''}{fmtVal(ev.estimate)}</>):'—'}
                              </div>
                            </div>

                            {/* ACTUAL — render garantizado si hasAct */}
                            <div style={{
                              background:hasAct
                                ?(sColor===D.bull?'rgba(34,197,94,0.09)':sColor===D.bear?'rgba(239,68,68,0.09)':'rgba(245,158,11,0.07)')
                                :isPending?'rgba(245,158,11,0.05)':D.card,
                              borderRadius:isMobile?10:14,padding:isMobile?'10px 12px':'14px 16px',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',
                              border:`1px solid ${hasAct
                                ?(sColor===D.bull?'rgba(34,197,94,0.35)':sColor===D.bear?'rgba(239,68,68,0.35)':'rgba(245,158,11,0.3)')
                                :isPending?'rgba(245,158,11,0.25)':D.border}`}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:isMobile?4:8}}>ACTUAL</div>
                              {hasAct ? (
                                <div style={{fontSize:isMobile?22:26,fontWeight:800,color:sColor,lineHeight:1}}>
                                  {fmtVal(actualVal)}
                                </div>
                              ) : isPending ? (
                                <div>
                                  {/* Badge principal */}
                                  <div style={{display:'inline-flex',alignItems:'center',gap:6,
                                    background:'rgba(245,158,11,0.14)',border:'1px solid rgba(245,158,11,0.4)',
                                    borderRadius:8,padding:'5px 12px',marginBottom:isMobile?6:10}}>
                                    <span style={{width:6,height:6,borderRadius:'50%',background:'#f59e0b',
                                      flexShrink:0,animation:'nowPulse 1.5s ease infinite'}}/>
                                    <span style={{fontSize:9,fontWeight:800,color:'#f59e0b',letterSpacing:'0.1em'}}>PENDIENTE</span>
                                  </div>
                                  {/* Previsión y anterior como contexto */}
                                  <div style={{display:'flex',gap:12,marginBottom:isMobile?6:8}}>
                                    {ev.estimate!=null&&(
                                      <div>
                                        <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.05em',marginBottom:2}}>PREVISIÓN</div>
                                        <div style={{fontSize:isMobile?12:14,fontWeight:800,color:estColor}}>
                                          {estColor===D.bull?'▲ ':estColor===D.bear?'▼ ':''}{fmtVal(ev.estimate)}
                                        </div>
                                      </div>
                                    )}
                                    {ev.previous!=null&&(
                                      <div>
                                        <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.05em',marginBottom:2}}>ANTERIOR</div>
                                        <div style={{fontSize:isMobile?12:14,fontWeight:700,color:D.sub}}>{fmtVal(ev.previous)}</div>
                                      </div>
                                    )}
                                  </div>
                                  {/* Estado del watchdog */}
                                  <div style={{display:'flex',alignItems:'center',gap:5,
                                    borderTop:`1px solid ${D.border}`,paddingTop:isMobile?6:8}}>
                                    {watchdogActive ? (
                                      <>
                                        <span style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',
                                          flexShrink:0,animation:'nowPulse 2s ease infinite'}}/>
                                        <span style={{fontSize:9,color:D.sub2}}>Auto-actualización · cada 60s</span>
                                      </>
                                    ) : (
                                      <>
                                        <span style={{width:5,height:5,borderRadius:'50%',background:D.sub2,flexShrink:0}}/>
                                        <span style={{fontSize:9,color:D.sub2}}>Esperando publicación</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div style={{fontSize:isMobile?18:20,fontWeight:800,color:D.sub2,lineHeight:1}}>—</div>
                              )}
                              {isPast&&!hasAct&&!isPending&&lastFetchTime&&(
                                <div style={{fontSize:9,color:D.sub2,opacity:0.5,marginTop:6}}>
                                  FF: {lastFetchTime.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                                </div>
                              )}
                            </div>

                            {/* SORPRESA */}
                            <div style={{
                              background:surprise?(sColor===D.bull?'rgba(34,197,94,0.07)':sColor===D.bear?'rgba(239,68,68,0.07)':'rgba(245,158,11,0.06)'):D.card,
                              borderRadius:isMobile?10:14,padding:isMobile?'10px 12px':'14px 16px',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',
                              border:`1px solid ${surprise?(sColor===D.bull?'rgba(34,197,94,0.25)':sColor===D.bear?'rgba(239,68,68,0.25)':D.border):D.border}`}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:isMobile?4:8}}>SORPRESA</div>
                              {surprise?(<>
                                <div style={{fontSize:isMobile?18:22,fontWeight:800,color:sColor,lineHeight:1,marginBottom:4}}>
                                  {surprise.dir>0?'▲ +':surprise.dir<0?'▼ ':''}{surprise.raw.toFixed(2)}
                                </div>
                                <div style={{fontSize:11,fontWeight:700,color:sColor}}>{surprise.dir>0?'+':''}{surprise.pct.toFixed(2)}%</div>
                              </>):(<div style={{fontSize:isMobile?18:20,fontWeight:800,color:D.sub2}}>—</div>)}
                            </div>
                          </div>

                          {/* ── SESGO FINAL — bloque premium ── */}
                          {macroScore&&(
                            <div style={{
                              background:D.card,borderRadius:isMobile?10:14,padding:isMobile?'12px 14px':'14px 18px',marginBottom:isMobile?10:14,
                              border:`1px solid ${macroScore.color}45`,
                              boxShadow:`0 0 24px ${macroScore.color}14, 0 2px 10px rgba(0,0,0,0.18)`}}>
                              <div style={{display:'flex',alignItems:'center',gap:isMobile?12:16}}>
                                <div style={{textAlign:'center',flexShrink:0}}>
                                  <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:3}}>SESGO FINAL</div>
                                  <div style={{fontSize:isMobile?24:30,fontWeight:900,color:macroScore.color,lineHeight:1,letterSpacing:'-1px'}}>
                                    {macroScore.score>0?'+':''}{macroScore.score}
                                  </div>
                                </div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:isMobile?13:14,fontWeight:800,color:macroScore.color,marginBottom:3}}>{macroScore.label}</div>
                                  {regime&&<div style={{fontSize:isMobile?10:11,color:D.sub,lineHeight:1.4,marginBottom:isMobile?6:8}}>{regime.desc}</div>}
                                  <div style={{height:6,background:D.border,borderRadius:99,overflow:'hidden',position:'relative'}}>
                                    <div style={{position:'absolute',left:'50%',top:0,width:1,height:'100%',background:D.sub2,opacity:0.35}}/>
                                    <div style={{
                                      position:'absolute',height:'100%',borderRadius:99,
                                      background:`linear-gradient(90deg,${macroScore.color}88,${macroScore.color})`,
                                      width:`${Math.abs(macroScore.score)/2}%`,
                                      left:macroScore.score>=0?'50%':undefined,
                                      right:macroScore.score<0?'50%':undefined,
                                    }}/>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* ── ACORDEÓN MÓVIL: "Ver análisis avanzado" ── */}
                          {isMobile&&(
                            <button onClick={toggleAdv} style={{
                              width:'100%',display:'flex',flexDirection:'column',alignItems:'center',
                              gap:3,background:'transparent',
                              border:`1px solid ${isAdvOpen?D.accent+'60':D.border}`,
                              borderRadius:10,padding:'9px 12px',cursor:'pointer',
                              marginBottom:isAdvOpen?8:0,transition:'border-color 0.2s, margin-bottom 0.2s',
                            }}>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <span style={{color:D.sub,fontSize:12,fontWeight:600,letterSpacing:'0.02em'}}>
                                  {isAdvOpen ? 'Ocultar análisis' : 'Ver análisis avanzado'}
                                </span>
                                <span style={{
                                  fontSize:10,color:D.sub,display:'inline-block',
                                  transform:isAdvOpen?'rotate(180deg)':'rotate(0deg)',
                                  transition:'transform 0.25s ease',
                                }}>▼</span>
                              </div>
                              {!isAdvOpen&&(
                                <span style={{fontSize:11,color:D.sub2,textAlign:'center',lineHeight:1.4,marginTop:1}}>
                                  Escenarios · lectura operativa · decisión rápida
                                </span>
                              )}
                            </button>
                          )}

                          {/* Secciones avanzadas: scrollHeight real para animación sin lag en iOS */}
                          <div
                            ref={el => { if (el) advRefs.current[evKey] = el; }}
                            style={{
                              overflow:'hidden',
                              maxHeight: isMobile
                                ? (isAdvOpen ? `${advRefs.current[evKey]?.scrollHeight || 2000}px` : '0px')
                                : 'none',
                              opacity: !isMobile || isAdvOpen ? 1 : 0,
                              transition:'max-height 0.25s ease, opacity 0.25s ease',
                            }}>

                          {/* ── ESCENARIOS + LECTURA OPERATIVA ── */}
                          {sc&&(
                            <div style={{
                              display:'grid',
                              // Mobile: siempre 1 columna. Desktop: 2 col solo si hay dato publicado
                              gridTemplateColumns: isMobile ? '1fr' : (hasAct&&ev.estimate!=null?'1fr 1fr':'1fr'),
                              gap:10,alignItems:'start',marginBottom:10}}>

                              {/* ESCENARIOS */}
                              <div style={{background:D.card,borderRadius:isMobile?10:14,padding:isMobile?'12px 12px':'14px 16px',
                                border:`1px solid ${D.border}`,boxShadow:'0 2px 10px rgba(0,0,0,0.12)',
                                boxSizing:'border-box',width:'100%'}}>
                                <div style={{fontSize:10,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:10}}>ESCENARIOS</div>
                                <div style={{display:'grid',gridTemplateColumns:'48px 1fr 1fr 1fr',gap:isMobile?3:4,marginBottom:6}}>
                                  <div/>
                                  {['DÉBIL','EN LÍNEA','FUERTE'].map(h=>(
                                    <div key={h} style={{textAlign:'center',fontSize:isMobile?8:9,fontWeight:700,
                                      color:D.sub2,letterSpacing:'0.04em',paddingBottom:4}}>{h}</div>
                                  ))}
                                </div>
                                {sc.assets.map((asset,i)=>(
                                  <div key={asset} style={{display:'grid',gridTemplateColumns:'48px 1fr 1fr 1fr',gap:isMobile?3:4,marginBottom:isMobile?3:4}}>
                                    <div style={{fontSize:isMobile?11:12,fontWeight:700,color:D.txt,display:'flex',alignItems:'center'}}>{asset}</div>
                                    {[sc.weak[i],sc.inline[i],sc.strong[i]].map((s,j)=>{
                                      const bull=s?.includes('Sube'),bear=s?.includes('Baja');
                                      return (
                                        <div key={j} style={{textAlign:'center',padding:isMobile?'5px 2px':'7px 4px',borderRadius:99,
                                          fontSize:isMobile?10:11,fontWeight:700,
                                          background:bull?'rgba(34,197,94,0.14)':bear?'rgba(239,68,68,0.14)':'rgba(107,114,128,0.10)',
                                          color:bull?D.bull:bear?D.bear:D.sub,
                                          border:`1px solid ${bull?'rgba(34,197,94,0.2)':bear?'rgba(239,68,68,0.2)':'rgba(107,114,128,0.15)'}`}}>
                                          {s}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>

                              {/* LECTURA OPERATIVA */}
                              <div style={{background:D.card,borderRadius:isMobile?10:14,padding:isMobile?'12px 12px':'14px 16px',
                                border:`1px solid ${hasAct?sColor+'45':D.accent+'30'}`,
                                boxShadow:'0 2px 10px rgba(0,0,0,0.12)',
                                boxSizing:'border-box',width:'100%'}}>
                                {hasAct&&ev.estimate!=null ? (
                                  <>
                                    <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:4}}>LECTURA OPERATIVA</div>
                                    <div style={{fontSize:13,fontWeight:800,color:sColor,marginBottom:10}}>
                                      {sDir>0?'▲ Por encima del consenso':sDir<0?'▼ Por debajo del consenso':'⇄ En línea con el consenso'}
                                    </div>
                                    <div style={{fontSize:11,color:D.sub,lineHeight:1.65,marginBottom:10}}
                                      dangerouslySetInnerHTML={{__html: dynInterp||(sDir>0?sc.result_up:sc.result_down)||''}}/>

                                    {/* 🎯 Activos sensibles */}
                                    {assetDirs&&assetDirs.length>0&&(
                                      <div style={{marginBottom:10}}>
                                        <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.06em',marginBottom:6}}>🎯 ACTIVOS SENSIBLES</div>
                                        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                                          {assetDirs.map(({asset,arrow,col})=>(
                                            <span key={asset} style={{display:'inline-flex',alignItems:'center',gap:3,
                                              fontSize:11,fontWeight:800,
                                              background:col==='#22c55e'?'rgba(34,197,94,0.12)':col==='#ef4444'?'rgba(239,68,68,0.12)':'rgba(139,144,160,0.10)',
                                              color:col,padding:'5px 10px',borderRadius:8,border:`1px solid ${col}30`}}>
                                              {arrow} {asset}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* ⏱ Horizonte */}
                                    {horizon&&(
                                      <div style={{marginBottom:10}}>
                                        <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.06em',marginBottom:6}}>⏱ HORIZONTE</div>
                                        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                                          {[
                                            {label:'Inmediato',val:horizon.immediate,col:'#ef4444'},
                                            {label:'Intradía', val:horizon.intraday, col:'#f59e0b'},
                                            {label:'Macro',    val:horizon.macro,    col:D.sub},
                                          ].map(({label,val,col})=>(
                                            <div key={label} style={{background:D.card2||D.bg,borderRadius:8,
                                              border:`1px solid ${D.border}`,padding:'5px 10px',fontSize:10,textAlign:'center'}}>
                                              <div style={{color:D.sub2,fontSize:8,marginBottom:2,letterSpacing:'0.05em'}}>{label.toUpperCase()}</div>
                                              <div style={{fontWeight:700,color:col,whiteSpace:'nowrap'}}>{val}</div>
                                            </div>
                                          ))}
                                        </div>
                                        {horizon.note&&<div style={{fontSize:9,color:D.sub2,marginTop:4}}>⚡ {horizon.note}</div>}
                                      </div>
                                    )}

                                    {delta&&(
                                      <div style={{paddingTop:10,borderTop:`1px solid ${D.border}`,display:'flex',gap:16}}>
                                        <div>
                                          <div style={{fontSize:8,color:D.sub2,marginBottom:2,letterSpacing:'0.05em'}}>VS PREVISIÓN</div>
                                          <div style={{fontSize:13,fontWeight:800,color:sColor}}>{surprise?.dir>0?'+':''}{surprise?.pct.toFixed(2)||'—'}%</div>
                                        </div>
                                        <div>
                                          <div style={{fontSize:8,color:D.sub2,marginBottom:2,letterSpacing:'0.05em'}}>VS ANTERIOR</div>
                                          <div style={{fontSize:13,fontWeight:800,color:delta.dir>0?D.bull:delta.dir<0?D.bear:D.sub}}>{delta.dir>0?'+':''}{delta.pct.toFixed(2)}%</div>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:12}}>LECTURA OPERATIVA</div>
                                    <div style={{marginBottom:10}}>
                                      <div style={{fontSize:10,fontWeight:700,color:D.bull,marginBottom:4}}>↑ Si supera previsión:</div>
                                      <div style={{fontSize:11,color:D.sub,lineHeight:1.6}}>{sc.result_up}</div>
                                    </div>
                                    <div style={{borderTop:`1px solid ${D.border}`,paddingTop:10}}>
                                      <div style={{fontSize:10,fontWeight:700,color:D.bear,marginBottom:4}}>↓ Si decepciona:</div>
                                      <div style={{fontSize:11,color:D.sub,lineHeight:1.6}}>{sc.result_down}</div>
                                    </div>
                                    {(()=>{const h=getTemporalHorizon(evType,'Moderado');return h?(
                                      <div style={{borderTop:`1px solid ${D.border}`,paddingTop:8,marginTop:8}}>
                                        <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.06em',marginBottom:4}}>⏱ VENTANA ESPERADA</div>
                                        <div style={{fontSize:10,color:D.sub}}>{h.immediate} → {h.intraday} → {h.macro}</div>
                                        {h.note&&<div style={{fontSize:9,color:D.sub2,marginTop:3}}>⚡ {h.note}</div>}
                                      </div>
                                    ):null;})()}
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {/* ── DECISIÓN RÁPIDA ── */}
                          {hasAct&&macroScore&&sc&&assetDirs&&(
                            <div style={{marginTop:isMobile?8:12,
                              background:macroScore.score>20?'linear-gradient(135deg,rgba(34,197,94,0.09),rgba(34,197,94,0.04))':macroScore.score<-20?'linear-gradient(135deg,rgba(239,68,68,0.09),rgba(239,68,68,0.04))':'linear-gradient(135deg,rgba(245,158,11,0.09),rgba(245,158,11,0.04))',
                              border:`1px solid ${macroScore.color}45`,borderRadius:isMobile?10:14,padding:isMobile?'12px 12px':'14px 16px',
                              boxShadow:`0 0 24px ${macroScore.color}10`,boxSizing:'border-box',width:'100%'}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.12em',marginBottom:isMobile?8:10}}>⚡ DECISIÓN RÁPIDA</div>
                              {isMobile ? (
                                /* Mobile: score encima, activos + ventana debajo en row */
                                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                                    <div style={{textAlign:'center',background:macroScore.color+'15',borderRadius:8,
                                      padding:'6px 12px',border:`1px solid ${macroScore.color}30`,flexShrink:0}}>
                                      <div style={{fontSize:20,fontWeight:900,color:macroScore.color,lineHeight:1}}>
                                        {macroScore.score>0?'+':''}{macroScore.score}
                                      </div>
                                      <div style={{fontSize:9,fontWeight:700,color:macroScore.color,marginTop:1}}>{macroScore.label}</div>
                                    </div>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.06em',marginBottom:4}}>ACTIVOS</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {assetDirs.map(({asset,arrow,col})=>(
                                          <span key={asset} style={{fontSize:10,fontWeight:800,color:col,
                                            background:col==='#22c55e'?'rgba(34,197,94,0.12)':col==='#ef4444'?'rgba(239,68,68,0.12)':'rgba(139,144,160,0.10)',
                                            border:`1px solid ${col}25`,padding:'2px 7px',borderRadius:6,whiteSpace:'nowrap'}}>
                                            {arrow} {asset}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <div style={{textAlign:'right',flexShrink:0}}>
                                      <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.04em',marginBottom:3}}>VENTANA</div>
                                      <div style={{fontSize:11,fontWeight:800,color:D.txt}}>{horizon?.immediate||'5–15 min'}</div>
                                      {confBadge&&<div style={{fontSize:8,fontWeight:600,color:confBadge.color,marginTop:2}}>{confBadge.label}</div>}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Desktop: grid 3 columnas */
                                <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:12,alignItems:'center'}}>
                                  <div style={{textAlign:'center',background:macroScore.color+'15',borderRadius:10,
                                    padding:'8px 14px',border:`1px solid ${macroScore.color}30`}}>
                                    <div style={{fontSize:24,fontWeight:900,color:macroScore.color,lineHeight:1,letterSpacing:'-0.5px'}}>
                                      {macroScore.score>0?'+':''}{macroScore.score}
                                    </div>
                                    <div style={{fontSize:10,fontWeight:700,color:macroScore.color,marginTop:2}}>{macroScore.label}</div>
                                  </div>
                                  <div>
                                    <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.06em',marginBottom:5}}>ACTIVOS</div>
                                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                      {assetDirs.map(({asset,arrow,col})=>(
                                        <span key={asset} style={{fontSize:11,fontWeight:800,color:col,
                                          background:col==='#22c55e'?'rgba(34,197,94,0.12)':col==='#ef4444'?'rgba(239,68,68,0.12)':'rgba(139,144,160,0.10)',
                                          border:`1px solid ${col}25`,padding:'3px 8px',borderRadius:6,whiteSpace:'nowrap'}}>
                                          {arrow} {asset}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div style={{textAlign:'right',flexShrink:0}}>
                                    <div style={{fontSize:8,color:D.sub2,letterSpacing:'0.06em',marginBottom:4}}>VENTANA</div>
                                    <div style={{fontSize:12,fontWeight:800,color:D.txt}}>{horizon?.immediate||'5–15 min'}</div>
                                    {confBadge&&<div style={{fontSize:9,fontWeight:600,color:confBadge.color,marginTop:2}}>{confBadge.label}</div>}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Sin escenario */}
                          {!sc&&(
                            <div style={{background:D.card,borderRadius:14,padding:'14px 16px',
                              border:`1px solid ${D.border}`,boxShadow:'0 2px 10px rgba(0,0,0,0.12)'}}>
                              <div style={{fontSize:9,fontWeight:700,color:D.sub2,letterSpacing:'0.08em',marginBottom:8}}>LECTURA OPERATIVA</div>
                              {dynInterp ? (
                                <div style={{fontSize:11,color:D.sub,lineHeight:1.7}}
                                  dangerouslySetInnerHTML={{__html: dynInterp}}/>
                              ) : (
                                <div style={{fontSize:11,color:D.sub,lineHeight:1.6}}>
                                  {isPast&&!hasAct
                                    ? 'Dato pendiente de publicación en el feed. Se actualizará automáticamente.'
                                    : 'Evento sin escenario predefinido. Monitorizar reacción del mercado al dato.'}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Cierre acordeón avanzado */}
                          </div>
                        </div>
                        );
                      })()}
                    </div>
                  )].filter(Boolean);
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = {error:null}; }
  static getDerivedStateFromError(error) { return {error}; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:32,fontFamily:"monospace",background:"#0d0d0f",color:"#e8eaf0",minHeight:"100vh"}}>
          <h2 style={{color:"#EF9A9A",marginBottom:16}}>Error de renderizado</h2>
          <pre style={{fontSize:12,color:"#8b90a0",lineHeight:1.6}}>{this.state.error.toString()}</pre>
          <button onClick={()=>this.setState({error:null})} style={{marginTop:16,padding:"8px 16px",background:"#0055cc",color:"white",border:"none",borderRadius:4,cursor:"pointer"}}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  // ── Supabase Auth (replaces localStorage session) ──────────────────────────
  const { loading: authLoading, user: authUser, profile, accessStatus } = useAuth();

  // user shape for UI compatibility: { email, nombre, plan }
  const user = profile ? {
    email:  profile.email,
    nombre: profile.telegram_username || profile.email?.split('@')[0] || 'Usuario',
    plan:   profile.plan   || 'Trial',
    status: profile.status || 'trial',
  } : null;
  const [pairsData, setPairsData] = useState(null);
  const [source,    setSource]    = useState("");
  const [error,     setError]     = useState(null);
  const [tab,       setTab]       = useState("fx");
  const [sort,      setSort]      = useState({col:"signal",dir:-1});
  const [detail,    setDetail]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode,  setDarkMode]  = useState(()=>{ try{return JSON.parse(localStorage.getItem("cot_dark")||"false");}catch{return false;} });
  const [lang,      setLang]      = useState(()=>{ try{return localStorage.getItem("cot_lang")||"es";}catch{return "es";} });
  const [mainTab,   setMainTab]   = useState("calendario");
  const [tooltip,   setTooltip]   = useState(null);
  const [tooltipX,  setTooltipX]  = useState(0);
  const [tooltipY,  setTooltipY]  = useState(0);
  const [histRows,  setHistRows]  = useState(5);
  const [isMobile,  setIsMobile]  = useState(()=>window.innerWidth < 700);
  useEffect(()=>{
    const h=()=>setIsMobile(window.innerWidth<700);
    window.addEventListener('resize',h);
    return ()=>window.removeEventListener('resize',h);
  },[]);

  const toggleDark = () => { const v=!darkMode; setDarkMode(v); localStorage.setItem("cot_dark",JSON.stringify(v)); };
  const changeLang = (l) => { setLang(l); localStorage.setItem("cot_lang",l); };
  const handleLogout = async () => { await logout(); setPairsData(null); setShowSettings(false); };

  const handleFile = useCallback((text, name) => {
    setError(null);
    try {
      const allRows = parseTFFCsv(text);
      if (allRows.length===0) throw new Error("No se encontraron datos válidos.");
      const byPair = {};
      allRows.forEach(raw=>{
        const contract=matchContract(raw.market);
        if (!contract) return;
        if (!byPair[contract.pair]) byPair[contract.pair]={contract,raws:[]};
        byPair[contract.pair].raws.push(raw);
      });
      const pairs=Object.values(byPair).map(({contract,raws})=>{
        raws.sort((a,b)=>b.isoDate.localeCompare(a.isoDate));
        const weeks=raws.map(raw=>buildProcessedRow(contract,raw)).filter(Boolean);
        if (weeks.length===0) return null;
        const signal=generateSignal(weeks);
        return {pair:contract.pair,cat:contract.cat,weeks,signal,latest:weeks[0]};
      }).filter(Boolean);
      if (pairs.length===0) throw new Error("No se reconocieron contratos forex.");
      setPairsData(pairs); setSource(name);
    } catch(e) { setError(e.message); }
  },[]);

  // ── THEME VARS (must be before any early returns) ──────────────────────────
  const bg          = darkMode ? "#000"     : "#f2f2f7";
  const cardBg      = darkMode ? "#1c1c1e"  : "white";
  const textPrimary = darkMode ? "#ffffff"  : "#1c1c1e";
  const textSecondary = "#8e8e93";
  const borderColor = darkMode ? "#2c2c2e"  : "#e5e5ea";

  // ── AUTH GATE ──────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f2f2f7' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', border:'3px solid #0066cc', borderTopColor:'transparent', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ fontSize:13, color:'#8e8e93', margin:0 }}>Verificando acceso…</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen />;
  }

  if (accessStatus && !accessStatus.hasAccess) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f2f2f7', fontFamily:"-apple-system,'SF Pro Text',Helvetica,sans-serif" }}>
        <div style={{ textAlign:'center', maxWidth:400, padding:'32px 24px', background:'white', borderRadius:20, boxShadow:'0 2px 20px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize:40, marginBottom:16 }}>🔒</div>
          <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:700, color:'#1c1c1e' }}>Acceso no disponible</h2>
          <p style={{ margin:'0 0 20px', fontSize:14, color:'#8e8e93', lineHeight:1.6 }}>
            {accessStatus.reason === 'trial_expired'
              ? 'Tu período de prueba ha expirado. Elige un plan para continuar.'
              : accessStatus.reason === 'suspended'
              ? 'Tu cuenta está suspendida. Contacta soporte.'
              : 'No tienes un plan activo. Contacta soporte o elige un plan.'}
          </p>
          <button onClick={handleLogout} style={{ background:'none', border:'1px solid #e5e5ea', borderRadius:10, padding:'10px 20px', cursor:'pointer', fontSize:13, color:'#8e8e93' }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  // Terminal color palette
  const T = {
    bg:      darkMode?"#0d0d0f":"#f0f2f5",
    card:    darkMode?"#16181c":"#ffffff",
    border:  darkMode?"#2a2d33":"#dde1e7",
    txt:     darkMode?"#e8eaf0":"#1a1d23",
    sub:     darkMode?"#8b90a0":"#6b7280",
    accent:  "#0055cc",
    bull:    "#88C999",
    bear:    "#EF9A9A",
    bullTxt: "#2e7d4f",
    bearTxt: "#b71c1c",
    header:  darkMode?"#1a1d24":"#f8f9fc",
  };


  // ── DASHBOARD ──────────────────────────────────────────────────────────────
  const TABS = [
    {id:"calendario", label:"📅 Calendario"},
    {id:"sesgos",     label:"Dashboard COT"},
    {id:"historico",  label:"Tabla Histórica"},
    {id:"importar",   label:"📁 Importar CSV"},
    {id:"cuenta",     label:"Ajustes"},
  ];
  const SIGNAL_ORDER={buy:0,sell:1,wait:2,indecision:3};
  const fxPairs=(pairsData||[]).filter(p=>p.cat==="fx");
  const displayPairs=[...fxPairs].sort((a,b)=>{
    if (sort.col==="signal") return sort.dir*(SIGNAL_ORDER[a.signal.signal]-SIGNAL_ORDER[b.signal.signal]);
    if (sort.col==="net")    return sort.dir*(b.latest.smartNet-a.latest.smartNet);
    if (sort.col==="pair")   return sort.dir*a.pair.localeCompare(b.pair);
    return 0;
  });
  const buys=displayPairs.filter(p=>p.signal.signal==="buy").length;
  const sells=displayPairs.filter(p=>p.signal.signal==="sell").length;
  const handleSort=(col)=>setSort(s=>s.col===col?{col,dir:s.dir*-1}:{col,dir:-1});
  const sortArrow=(col)=>sort.col===col?(sort.dir===-1?" ↓":" ↑"):"";


  return (
    <div style={{fontFamily:"'Inter','SF Pro Text',Helvetica,sans-serif",background:T.bg,
      minHeight:"100vh",overflowX:"hidden",maxWidth:"100vw",boxSizing:"border-box"}}>
      {detail&&<DetailSheet pairData={detail} onClose={()=>setDetail(null)}/>}
      {showSettings&&<SettingsPanel user={user} darkMode={darkMode} lang={lang}
        onDarkMode={toggleDark} onLang={changeLang} onLogout={handleLogout}
        onClose={()=>setShowSettings(false)}
        onUpgrade={()=>{setShowSettings(false);}}/>}

      {/* ── HEADER ── */}
      <div style={{background:T.card,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:10}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 12px"}}>
          {/* Top bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:48}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <div style={{width:26,height:26,borderRadius:6,background:T.accent,flexShrink:0,
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M5 18L10 12L14 15L19 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span style={{fontSize:14,fontWeight:700,color:T.txt,whiteSpace:"nowrap"}}>COT Tracker</span>
              <span style={{fontSize:10,color:T.sub,padding:"1px 6px",border:`1px solid ${T.border}`,
                borderRadius:3,letterSpacing:"0.03em",display:"none",
                "@media(min-width:600px)":{display:"inline"}}}>
                CFTC · LM · TFF
              </span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {source&&<span style={{fontSize:10,color:T.sub,maxWidth:100,overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{source}</span>}
              <button onClick={()=>setShowSettings(true)} style={{width:28,height:28,borderRadius:"50%",
                background:T.accent,border:"none",cursor:"pointer",flexShrink:0,
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontSize:11,fontWeight:700,color:"white"}}>{user.nombre[0].toUpperCase()}</span>
              </button>
            </div>
          </div>
          {/* Tabs — scroll horizontal en móvil */}
          <div style={{display:"flex",gap:0,overflowX:"auto",WebkitOverflowScrolling:"touch",
            scrollbarWidth:"none",msOverflowStyle:"none"}}>
            <style>{`.tab-scroll::-webkit-scrollbar{display:none}`}</style>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setMainTab(t.id)} style={{
                background:"none",border:"none",cursor:"pointer",flexShrink:0,
                padding:"9px 14px",fontSize:12,fontWeight:mainTab===t.id?600:400,
                color:mainTab===t.id?T.accent:T.sub,
                borderBottom:mainTab===t.id?`2px solid ${T.accent}`:"2px solid transparent",
                whiteSpace:"nowrap",transition:"all 0.15s",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB 1: CALENDARIO ── */}
      {mainTab==="calendario"&&(
        <CalendarioTab darkMode={darkMode} T={T} lang={lang}/>
      )}

      {/* ── TAB 2: DASHBOARD COT ── */}
      {mainTab==="sesgos"&&!pairsData&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:16}}>📊</div>
          <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:700,color:T.txt}}>Importa un archivo CSV del CFTC</h2>
          <p style={{margin:"0 0 24px",fontSize:14,color:T.sub,lineHeight:1.6}}>
            El Dashboard de Activos se activa cuando cargas el informe semanal del CFTC.
          </p>
          <button onClick={()=>setMainTab("importar")} style={{padding:"12px 28px",borderRadius:10,border:"none",
            cursor:"pointer",background:T.accent,color:"white",fontSize:14,fontWeight:700}}>
            Ir a Importar CSV →
          </button>
        </div>
      )}
      {mainTab==="sesgos"&&pairsData&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"12px":"20px"}}>

          {/* ── INSTITUTIONAL BIAS ENGINE CARDS ─────────────────────────── */}
          {(()=>{
            // Safe pre-computation: each step guards against null/undefined
            const biasResults = (fxPairs || []).map(p => {
              if (!p) return null;
              const inputs = deriveInputsFromPair(p);
              if (!inputs) return null;
              const bias = calculateBiasScore(inputs);
              if (!bias) return null;
              return { pair: p.pair, bias };
            }).filter(Boolean);

            if (!biasResults.length) return null;

            const sorted = [...biasResults].sort((a,b)=>Math.abs(b.bias.score)-Math.abs(a.bias.score));
            const top = sorted.slice(0,3);

            return (
              <div style={{marginBottom:16}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:10,fontWeight:700,color:T.accent,letterSpacing:'0.1em'}}>
                    INSTITUTIONAL BIAS ENGINE
                  </span>
                  <span style={{flex:1,height:1,background:T.border}}/>
                  <span style={{fontSize:10,color:T.sub2}}>HTF · Sesgo macro semanal · No es señal de entrada</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':`repeat(${Math.min(top.length,3)},1fr)`,gap:10}}>
                  {top.map(({pair,bias})=>(
                    bias && (
                      <div key={pair}>
                        <div style={{fontSize:10,fontWeight:700,color:T.sub,letterSpacing:'0.08em',marginBottom:6,textAlign:'center'}}>{pair}</div>
                        <InstitutionalBiasCard biasResult={bias} darkMode={darkMode} T={T} isMobile={isMobile}/>
                      </div>
                    )
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── INTRADAY EXECUTION LAYER ──────────────────────────────────── */}
          {(()=>{
            // Build availablePairs: all fxPairs with their precomputed bias
            const availablePairs = (fxPairs||[]).map(p=>{
              if(!p) return null;
              const inp = deriveInputsFromPair(p);
              if(!inp) return null;
              const bias = calculateBiasScore(inp);
              return { pair: p.pair, signal: p.signal, bias };
            }).filter(Boolean);

            if(!availablePairs.length) return null;

            // Top bias pair drives the shared sentiment/risk approximation
            const topBias = availablePairs.reduce((best,p)=>
              Math.abs(p.bias.score) > Math.abs(best.bias.score) ? p : best
            , availablePairs[0]);

            const sentimentData = { fg: 55 - Math.abs(topBias.bias.score)*3, vix: 18 + Math.abs(topBias.bias.score)*1.5, highCount: 0, midCount: 1 };
            const riskData      = { score: Math.abs(topBias.bias.score) * 4 };

            return (
              <div style={{marginBottom:4}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:10,fontWeight:700,color:T.accent,letterSpacing:'0.1em'}}>
                    INTRADAY EXECUTION LAYER
                  </span>
                  <span style={{flex:1,height:1,background:T.border}}/>
                  <span style={{fontSize:10,color:T.sub}}>Permiso operativo · No genera señales</span>
                </div>
                <IntradayExecutionCard
                  biasResult={topBias.bias}
                  availablePairs={availablePairs}
                  sentimentData={sentimentData}
                  riskData={riskData}
                  darkMode={darkMode}
                  T={T}
                  isMobile={isMobile}
                />
              </div>
            );
          })()}

          {/* Summary bar */}
          <div style={{display:"flex",gap:6,marginBottom:12,padding:"10px 12px",flexWrap:"wrap",
            background:T.card,border:`1px solid ${T.border}`,borderRadius:6}}>
            <span style={{fontSize:11,color:T.sub,alignSelf:"center",fontWeight:600,
              letterSpacing:"0.05em",display:isMobile?"none":"inline"}}>SESGO DEL MERCADO:</span>
            {[
              {label:`${buys} Sesgo Alcista`,   color:T.bullTxt, bg:"rgba(136,201,153,0.12)"},
              {label:`${sells} Sesgo Bajista`,  color:T.bearTxt, bg:"rgba(239,154,154,0.12)"},
              {label:`${displayPairs.length-buys-sells} Neutro/Div.`, color:T.sub, bg:"rgba(180,180,180,0.08)"},
            ].map(p=>(
              <span key={p.label} style={{fontSize:12,fontWeight:600,color:p.color,background:p.bg,
                padding:"4px 10px",borderRadius:3}}>{p.label}</span>
            ))}
            {!isMobile&&<span style={{marginLeft:"auto",fontSize:10,color:T.sub,alignSelf:"center"}}>
              Datos Importados según CFTC · Posicionamiento Dinero Inteligente
            </span>}
          </div>

          {/* Column headers — solo desktop */}
          {!isMobile&&(
          <div style={{display:"grid",gridTemplateColumns:"160px 1fr 110px 110px 90px 32px",
            gap:0,padding:"6px 16px",marginBottom:4}}>
            {[["pair","Par Divisa"],["net","Contratos Netos LM"],["signal","Sesgo de Mercado"],[null,"Evolución WoW"],[null,""]].map(([c,l],i)=>(
              <div key={i} onClick={()=>c&&handleSort(c)}
                style={{fontSize:10,fontWeight:700,color:sort.col===c?T.accent:T.sub,
                  letterSpacing:"0.07em",textTransform:"uppercase",cursor:c?"pointer":"default",
                  userSelect:"none",textAlign:i===0?"left":"right",paddingRight:i===0?0:8}}>
                {l}{c&&sortArrow(c)}
              </div>
            ))}
          </div>
          )}

          {/* Pair rows */}
          <div style={{display:"flex",flexDirection:"column",gap:isMobile?8:2}}>
            {displayPairs.map((p,i)=>{
              const {latest,weeks,signal}=p;
              if (!latest||!weeks||!signal) return null;
              const cfg=SIGNAL_CFG[signal.signal]||SIGNAL_CFG.wait;
              const trend=weeks.length>1?latest.smartNet-weeks[1].smartNet:0;
              const isBull=signal.signal==="buy";
              const isBear=signal.signal==="sell";
              return (
                <div key={p.pair}
                  style={{
                    background:T.card,
                    border:`1px solid ${T.border}`,
                    borderLeft:`3px solid ${isBull?T.bull:isBear?T.bear:T.border}`,
                    borderRadius: isMobile ? 10 : 4,
                    padding: isMobile ? "12px 14px" : "10px 16px",
                    display: isMobile ? "flex" : "grid",
                    flexDirection: isMobile ? "column" : undefined,
                    gridTemplateColumns: isMobile ? undefined : "160px 1fr 110px 110px 90px 32px",
                    gap: isMobile ? 6 : 0,
                    alignItems: isMobile ? undefined : "center",
                    cursor:"pointer",
                    transition:"background 0.1s",
                    animation:`fadeUp 0.25s ease both`,
                    animationDelay:`${i*0.03}s`,
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background=darkMode?"#1e2028":"#f8f9fc"}
                  onMouseLeave={e=>e.currentTarget.style.background=T.card}
                  onClick={()=>setDetail(p)}
                >
                  {isMobile ? (
                    /* ── MÓVIL: layout compacto horizontal ── */
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      {/* Par + WHY */}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                          <span style={{fontSize:15,fontWeight:700,color:T.txt}}>{p.pair}</span>
                          <span style={{fontSize:9,color:T.accent,border:`1px solid ${T.accent}`,
                            borderRadius:2,padding:"1px 4px",fontWeight:600}}>WHY</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:13,fontWeight:700,color:isBull?T.bullTxt:isBear?T.bearTxt:T.sub}}>
                            {fK(latest.smartNet)}
                          </span>
                          <span style={{fontSize:11,color:trend>0?T.bullTxt:trend<0?T.bearTxt:T.sub}}>
                            {trend!==0?(trend>0?"▲ ":"▼ ")+fK(Math.abs(trend))+" sem.":""}
                          </span>
                        </div>
                      </div>
                      {/* Sesgo badge */}
                      <span style={{fontSize:11,fontWeight:700,flexShrink:0,
                        color:isBull?T.bullTxt:isBear?T.bearTxt:T.sub,
                        background:isBull?"rgba(136,201,153,0.12)":isBear?"rgba(239,154,154,0.12)":"rgba(180,180,180,0.08)",
                        border:`1px solid ${isBull?T.bull:isBear?T.bear:T.border}`,
                        padding:"5px 10px",borderRadius:6}}>
                        {cfg.icon} {cfg.label}
                      </span>
                      {/* Mini sparkline */}
                      <MiniSparkline values={[...weeks].reverse().map(w=>w.smartNet)} positive={latest.smartNet>=0}/>
                    </div>
                  ) : (
                    <>
                  {/* Pair name + tooltip trigger */}
                  <div style={{position:"relative"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:13,fontWeight:700,color:T.txt,letterSpacing:"0.02em",fontVariantNumeric:"tabular-nums"}}>{p.pair}</span>
                      <span
                        onMouseEnter={(e)=>{
                          e.stopPropagation();
                          const r=e.currentTarget.getBoundingClientRect();
                          setTooltipX(r.left);
                          setTooltipY(r.bottom+4);
                          setTooltip(p.pair);
                        }}
                        onMouseLeave={()=>setTooltip(null)}
                        style={{fontSize:9,color:T.accent,border:`1px solid ${T.accent}`,borderRadius:2,
                          padding:"1px 4px",cursor:"help",fontWeight:600,letterSpacing:"0.05em",flexShrink:0}}>
                        WHY
                      </span>
                    </div>
                    {tooltip===p.pair&&(
                      <div onClick={e=>e.stopPropagation()} style={{
                        position:"fixed",
                        top: tooltipY || 100,
                        left: Math.min((tooltipX || 200), window.innerWidth - 300),
                        zIndex:99999,marginTop:6,
                        background:"#1a1d23",color:"#e8eaf0",
                        borderRadius:6,padding:"12px 14px",width:280,
                        boxShadow:"0 8px 32px rgba(0,0,0,0.3)",
                        fontSize:12,lineHeight:1.6,
                        pointerEvents:"none",
                      }}>
                        <div style={{fontSize:10,fontWeight:700,color:isBull?"#88C999":isBear?"#EF9A9A":"#9E9E9E",letterSpacing:"0.07em",marginBottom:6}}>
                          {cfg.label.toUpperCase()} — {p.pair}
                        </div>
                        <div>{signal.reason}</div>
                        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:10,color:"#9E9E9E"}}>
                          Fuente: CFTC TFF · Leveraged Money · Posicionamiento Dinero Inteligente (CFTC)
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Net position bar */}
                  <div style={{paddingRight:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:T.border,borderRadius:99,overflow:"hidden",minWidth:60}}>
                        <div style={{
                          width:`${Math.min(100,Math.abs(latest.smartPctL-50)*2)}%`,
                          height:"100%",
                          background:isBull?T.bull:isBear?T.bear:"#BDBDBD",
                          marginLeft:latest.smartNet<0?0:`${Math.max(0,50-(latest.smartPctL-50))}%`,
                          borderRadius:99,
                        }}/>
                      </div>
                      <span style={{fontSize:12,fontWeight:700,color:isBull?T.bullTxt:isBear?T.bearTxt:T.sub,
                        fontVariantNumeric:"tabular-nums",minWidth:52,textAlign:"right"}}>
                        {fK(latest.smartNet)}
                      </span>
                    </div>
                    <div style={{fontSize:10,color:trend>0?T.bullTxt:trend<0?T.bearTxt:T.sub,marginTop:3,textAlign:"right"}}>
                      {trend!==0?(trend>0?"▲ ":"▼ ")+fK(Math.abs(trend))+" sem.":"sin cambio"}
                    </div>
                  </div>

                  {/* Sesgo badge */}
                  <div style={{textAlign:"right",paddingRight:8}}>
                    <span style={{display:"inline-block",fontSize:10,fontWeight:700,
                      color:isBull?T.bullTxt:isBear?T.bearTxt:T.sub,
                      background:isBull?"rgba(136,201,153,0.12)":isBear?"rgba(239,154,154,0.12)":"rgba(180,180,180,0.08)",
                      border:`1px solid ${isBull?T.bull:isBear?T.bear:T.border}`,
                      padding:"3px 8px",borderRadius:3,letterSpacing:"0.04em"}}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <div style={{fontSize:9,color:T.sub,marginTop:3,letterSpacing:"0.04em"}}>
                      Fuerza: {["·","·","·"].map((d,i)=>(
                        <span key={i} style={{color:i<signal.strength?T.accent:T.border}}>{d} </span>
                      ))}
                    </div>
                  </div>

                  {/* Sparkline */}
                  <div style={{display:"flex",justifyContent:"flex-end",paddingRight:8}}>
                    <MiniSparkline values={[...weeks].reverse().map(w=>w.smartNet)} positive={latest.smartNet>=0}/>
                  </div>

                  {/* Arrow */}
                  <div style={{textAlign:"right",color:T.sub,fontSize:12}}>›</div>
                  </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Methodology footer */}
          <div style={{marginTop:16,padding:"12px 16px",
            background:T.card,border:`1px solid ${T.border}`,borderRadius:4}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
              <div>
                <span style={{fontSize:10,fontWeight:700,color:T.sub,letterSpacing:"0.07em",textTransform:"uppercase"}}>Metodología</span>
                <p style={{margin:"4px 0 0",fontSize:11,color:T.sub,lineHeight:1.6}}>
                  Posicionamiento Dinero Inteligente (CFTC) basado en el grupo <strong style={{color:T.txt}}>Leveraged Money</strong> del informe TFF.
                  Sesgo de Mercado confirmado requiere ≥3 informes CFTC consecutivos en la misma dirección.
                </p>
              </div>
              <div style={{flexShrink:0}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {Object.entries(SIGNAL_CFG).map(([key,cfg])=>(
                    <div key={key} style={{display:"flex",alignItems:"center",gap:5}}>
                      <span style={{fontSize:10,fontWeight:700,color:cfg.fg,background:cfg.bg,
                        border:`1px solid ${cfg.border}`,padding:"2px 6px",borderRadius:2}}>{cfg.icon} {cfg.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: TABLA HISTÓRICA ── */}
      {mainTab==="historico"&&!pairsData&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:16}}>📈</div>
          <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:700,color:T.txt}}>Sin datos históricos</h2>
          <p style={{margin:"0 0 24px",fontSize:14,color:T.sub,lineHeight:1.6}}>Importa un CSV del CFTC para ver la evolución histórica semanal.</p>
          <button onClick={()=>setMainTab("importar")} style={{padding:"12px 28px",borderRadius:10,border:"none",
            cursor:"pointer",background:T.accent,color:"white",fontSize:14,fontWeight:700}}>
            Ir a Importar CSV →
          </button>
        </div>
      )}
      {mainTab==="historico"&&pairsData&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:"20px"}}>
          <div style={{marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <h2 style={{margin:0,fontSize:14,fontWeight:700,color:T.txt,letterSpacing:"0.01em"}}>Tabla Histórica de Datos</h2>
              <p style={{margin:"3px 0 0",fontSize:11,color:T.sub}}>
                Posicionamiento Dinero Inteligente (CFTC) · Leveraged Money · Un par por fila · Columnas por semana
              </p>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,color:T.sub,border:`1px solid ${T.border}`,borderRadius:3,padding:"3px 8px"}}>
                Últimas {histRows} semanas
              </span>
              {histRows<8&&(
                <button onClick={()=>setHistRows(h=>Math.min(h+2,8))} style={{
                  fontSize:10,color:T.accent,border:`1px solid ${T.border}`,borderRadius:3,
                  padding:"3px 8px",background:"none",cursor:"pointer"
                }}>+ Semanas</button>
              )}
              {histRows>2&&(
                <button onClick={()=>setHistRows(h=>Math.max(h-2,2))} style={{
                  fontSize:10,color:T.sub,border:`1px solid ${T.border}`,borderRadius:3,
                  padding:"3px 8px",background:"none",cursor:"pointer"
                }}>– Semanas</button>
              )}
            </div>
          </div>

          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:4,overflow:"auto"}}>
            {/* Dynamic header: Par | Sesgo | Net W0 | Net W-1 | Net W-2 ... | Tendencia */}
            <div style={{
              display:"grid",
              gridTemplateColumns:`140px 120px repeat(${histRows},110px) 90px`,
              background:T.header,borderBottom:`1px solid ${T.border}`,
              minWidth: 140+120+(histRows*110)+90,
            }}>
              {["Par","Sesgo de Mercado",
                ...Array.from({length:histRows},(_,i)=>i===0?"Contratos Netos (Actual)":`Contratos Netos (-${i})`),
                "Tendencia"
              ].map((col,i)=>(
                <div key={i} style={{
                  fontSize:9,fontWeight:700,color:T.sub,
                  letterSpacing:"0.07em",textTransform:"uppercase",
                  textAlign:i<=1?"left":"right",
                  padding:i===0?"8px 8px 8px 16px":"8px",
                  borderRight:i===0||i===1?`1px solid ${T.border}`:"none",
                  display:i<=1?"flex":"flex",
                  alignItems:"center",
                  justifyContent:i<=1?"flex-start":"flex-end",
                  gap:3,
                }}>
                  {col}
                  {i===2&&<InfoTooltip text={TOOLTIPS.levNet}/>}
                </div>
              ))}
            </div>

            {/* One row per pair */}
            {fxPairs.map((p,rowIdx)=>{
              const isBull=p.signal.signal==="buy";
              const isBear=p.signal.signal==="sell";
              const cfg=SIGNAL_CFG[p.signal.signal]||SIGNAL_CFG.wait;
              // Get net values for each week slot
              const netValues=Array.from({length:histRows},(_,i)=>
                p.weeks[i]?.smartNet ?? null
              );
              // Trend: sum of week-over-week changes across visible window
              const changes = netValues.slice(0,-1).map((v,i)=>
                v!=null&&netValues[i+1]!=null ? v-netValues[i+1] : 0
              );
              const trendSum = changes.reduce((a,b)=>a+b,0);

              return (
                <div key={p.pair}
                  onClick={()=>setDetail(p)}
                  style={{
                    display:"grid",
                    gridTemplateColumns:`140px 120px repeat(${histRows},110px) 90px`,
                    borderBottom:rowIdx<fxPairs.length-1?`1px solid ${T.border}`:"none",
                    background:rowIdx%2===0?T.card:T.header,
                    cursor:"pointer",
                    transition:"background 0.1s",
                    minWidth:140+120+(histRows*110)+90,
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background=darkMode?"#1e2028":"#eef1f6"}
                  onMouseLeave={e=>e.currentTarget.style.background=rowIdx%2===0?T.card:T.header}
                >
                  {/* Par name */}
                  <div style={{
                    padding:"10px 8px 10px 16px",
                    borderRight:`1px solid ${T.border}`,
                    display:"flex",alignItems:"center",
                    borderLeft:`3px solid ${isBull?"#88C999":isBear?"#EF9A9A":T.border}`,
                  }}>
                    <span style={{fontSize:13,fontWeight:700,color:T.txt,fontFamily:"monospace"}}>{p.pair}</span>
                  </div>

                  {/* Sesgo badge */}
                  <div style={{
                    padding:"0 8px",display:"flex",alignItems:"center",
                    borderRight:`1px solid ${T.border}`,
                  }}>
                    <span style={{
                      fontSize:10,fontWeight:700,
                      color:isBull?"#2e7d4f":isBear?"#b71c1c":T.sub,
                      background:isBull?"rgba(136,201,153,0.12)":isBear?"rgba(239,154,154,0.12)":"transparent",
                      padding:"2px 6px",borderRadius:2,
                    }}>{cfg.icon} {cfg.label}</span>
                  </div>

                  {/* Net values per week — with heatmap */}
                  {netValues.map((val,wIdx)=>{
                    const prev = netValues[wIdx+1];
                    const chg = val!=null&&prev!=null ? val-prev : null;
                    const heat = heatCell(val, "net");
                    return (
                      <div key={wIdx} style={{
                        padding:"8px",textAlign:"right",
                        background:heat.background,
                        borderLeft:wIdx===0?`1px solid ${T.border}`:"none",
                        borderRight:`1px solid rgba(0,0,0,0.03)`,
                        transition:"background 0.15s",
                      }}>
                        <div style={{
                          fontSize:12,fontWeight:700,fontFamily:"monospace",
                          fontVariantNumeric:"tabular-nums",
                          color:heat.color,
                        }}>
                          {val==null?"—":val.toLocaleString("en-US",{signDisplay:"exceptZero"})}
                        </div>
                        {chg!=null&&(
                          <div style={{
                            fontSize:9,fontFamily:"monospace",marginTop:1,
                            color:chg>0?"#2e7d4f":chg<0?"#b71c1c":"#9E9E9E",
                          }}>
                            {chg>0?"▲":"▼"} {Math.abs(chg).toLocaleString("en-US")}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Tendencia */}
                  <div style={{padding:"10px 8px",textAlign:"right",borderLeft:`1px solid ${T.border}`}}>
                    <div style={{
                      fontSize:11,fontWeight:700,fontFamily:"monospace",
                      color:trendSum>0?"#2e7d4f":trendSum<0?"#b71c1c":"#9E9E9E",
                    }}>
                      {trendSum>0?"▲":trendSum<0?"▼":"–"} {Math.abs(trendSum).toLocaleString("en-US")}
                    </div>
                    <div style={{fontSize:9,color:T.sub,marginTop:1}}>
                      {changes.length} sem.
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p style={{textAlign:"center",fontSize:10,color:T.sub,marginTop:10,letterSpacing:"0.03em"}}>
            Haz clic en cualquier par para ver el desglose semanal completo ·
            Fuente: CFTC.gov · Leveraged Money · Datos procesados localmente
          </p>
        </div>
      )}

      {/* ── TAB 4: IMPORTAR CSV ── */}
      {mainTab==="importar"&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:"24px 20px"}}>
          <div style={{marginBottom:20}}>
            <h2 style={{margin:"0 0 4px",fontSize:14,fontWeight:700,color:T.txt}}>Importar Datos CFTC</h2>
            <p style={{margin:0,fontSize:11,color:T.sub}}>
              Posicionamiento Dinero Inteligente (CFTC) · Informe TFF · Leveraged Money · Publicado cada viernes 21:30h CET
            </p>
          </div>
          {error&&(
            <div style={{background:"rgba(239,154,154,0.12)",border:"1px solid rgba(239,154,154,0.4)",borderRadius:4,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b71c1c",lineHeight:1.5,fontFamily:"monospace"}}>
              ERROR: {error}
            </div>
          )}
          {pairsData&&(
            <div style={{background:"rgba(136,201,153,0.1)",border:"1px solid rgba(136,201,153,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:18}}>✅</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:"#2e7d4f"}}>Datos cargados: {source}</div>
                <div style={{fontSize:11,color:T.sub}}>{pairsData.length} pares · Haz clic en "Dashboard COT" para verlos</div>
              </div>
              <button onClick={()=>setMainTab("sesgos")} style={{padding:"8px 16px",borderRadius:8,border:"none",
                cursor:"pointer",background:"#2e7d4f",color:"white",fontSize:12,fontWeight:700}}>
                Ver Dashboard →
              </button>
            </div>
          )}
          <style>{`.import-grid{display:grid;grid-template-columns:1fr 1.6fr 1fr;gap:12px}@media(max-width:700px){.import-grid{grid-template-columns:1fr}}.import-card{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}`}</style>
          <div className="import-grid" style={{"--c":T.card,"--b":T.border}}>
            <div className="import-card">
              <p style={{margin:"0 0 4px",fontSize:12,fontWeight:700,color:T.txt,textTransform:"uppercase",letterSpacing:"0.05em"}}>📥 Descargar Informe CFTC</p>
              <p style={{margin:0,fontSize:12,color:T.sub,lineHeight:1.6}}>
                Accede al informe oficial. Busca:<br/>
                <span style={{fontFamily:"monospace",fontSize:11,background:darkMode?"#2a2d33":"#f0f2f5",padding:"1px 4px",borderRadius:2}}>Traders in Financial Futures</span><br/>
                → Futures Only → 2026 (Text) → Descomprime el .zip
              </p>
              <a href="https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm"
                target="_blank" rel="noreferrer"
                style={{display:"block",textAlign:"center",padding:"10px",borderRadius:8,
                  border:`1px solid ${T.border}`,color:T.txt,fontSize:12,fontWeight:600,textDecoration:"none"}}>
                Ir a CFTC.gov →
              </a>
            </div>
            <DropZone onFile={(text,name)=>{handleFile(text,name);setMainTab("sesgos");}}/>
            <div className="import-card">
              <p style={{margin:"0 0 4px",fontSize:12,fontWeight:700,color:T.txt,textTransform:"uppercase",letterSpacing:"0.05em"}}>▶ Video Tutorial</p>
              <p style={{margin:0,fontSize:12,color:T.sub,lineHeight:1.6}}>
                Guía paso a paso para descargar el CSV del CFTC y cargarlo correctamente.
              </p>
              <a href="https://www.youtube.com/@MarketMoneyFX" target="_blank" rel="noreferrer"
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",
                  borderRadius:8,border:`1px solid ${T.border}`,color:T.txt,fontSize:12,fontWeight:600,textDecoration:"none"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{color:"#c0392b"}}><path d="M8 5v14l11-7z"/></svg>
                Ver tutorial →
              </a>
            </div>
          </div>
          <p style={{textAlign:"center",fontSize:10,color:T.sub,marginTop:14}}>
            Datos procesados localmente · No se envía información a ningún servidor · Fuente: CFTC.gov
          </p>
        </div>
      )}

      {/* ── TAB 5: AJUSTES ── */}
      {mainTab==="cuenta"&&(
        <div style={{maxWidth:960,margin:"0 auto",padding:"20px"}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:4,padding:"24px"}}>
            <h2 style={{margin:"0 0 6px",fontSize:14,fontWeight:700,color:T.txt}}>Ajustes de Cuenta</h2>
            <p style={{margin:"0 0 20px",fontSize:11,color:T.sub}}>Gestiona tu perfil, plan de suscripción y preferencias</p>
            <button onClick={()=>setShowSettings(true)} style={{
              padding:"10px 20px",borderRadius:4,border:"none",cursor:"pointer",
              background:T.accent,color:"white",fontSize:12,fontWeight:600,
            }}>Abrir panel de ajustes</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
export default function App() { return <ErrorBoundary><AppInner/></ErrorBoundary>; }
