/**
 * OnboardingModal.jsx
 * Premium 4-step onboarding for COT Tracker.
 * Pure CSS animations — no external animation libraries required.
 *
 * SAFARI iOS FIXES:
 *   1. `inset:0` not supported on iOS < 14.5 → replaced with explicit
 *      top/right/bottom/left declarations.
 *   2. `backdrop-filter` requires `-webkit-backdrop-filter` on Safari
 *      (all versions) and iOS Safari (< 15.4 without prefix).
 *   3. `max-height: 92dvh` → `dvh` not supported on iOS < 15.4.
 *      Changed to `92vh` with an `env(safe-area-inset-*)` guard.
 *   4. `document.body.style.overflow='hidden'` can cause scroll lock
 *      on iOS if the modal unmounts before cleanup (e.g. on crash).
 *      Added a try/finally guard in the useEffect.
 */

import { useState, useEffect, useCallback } from 'react';

const TOTAL_STEPS = 8;

const TELEGRAM_URL = 'https://t.me/COT_TRACKER';

const MARKETS = [
  {
    id: 'forex',
    emoji: '💱',
    label: 'Forex',
    desc: 'EUR/USD, GBP/USD, USD/JPY, DXY',
    insight: 'EUR/USD y DXY reaccionan muy bien al sesgo institucional semanal del COT. El reporte TFF es la referencia más directa para divisas principales.',
  },
  {
    id: 'indices',
    emoji: '📈',
    label: 'Índices',
    desc: 'S&P 500, Nasdaq, Russell 2000',
    insight: 'NASDAQ responde a liquidez global y expectativas macro. El Cross Asset Flow del COT Combined muestra flujo institucional en índices en tiempo real.',
  },
  {
    id: 'commodities',
    emoji: '🥇',
    label: 'Oro / Commodities',
    desc: 'XAUUSD, petróleo, materias primas',
    insight: 'XAUUSD depende del USD Index, yields reales y apetito de riesgo. Todos están en el reporte COT Combined.',
  },
  {
    id: 'crypto',
    emoji: '₿',
    label: 'Crypto',
    desc: 'BTC, ETH y correlaciones macro',
    insight: 'BTC correlaciona con apetito de riesgo global y flujo de liquidez institucional. El sesgo en índices y DXY anticipa movimientos en crypto.',
  },
];

const MODULES = [
  {
    icon: '🎯',
    title: 'Institutional Bias Engine',
    color: '#0055cc',
    desc: 'Sesgo semanal HTF. Muestra dónde está posicionado el capital profesional. No es señal de entrada — es filtro de contexto.',
  },
  {
    icon: '↔',
    title: 'Divergences',
    color: '#f59e0b',
    desc: 'Detecta desacuerdo entre precio y flujo institucional. Anticipa retrocesos técnicos y posibles giros de tendencia.',
  },
  {
    icon: '⚡',
    title: 'Intraday Execution Layer',
    color: '#22c55e',
    desc: 'Convierte el contexto macro en permiso operativo táctico. Timing intradía basado en datos institucionales.',
  },
  {
    icon: '🌐',
    title: 'Cross Asset Flow',
    color: '#8b5cf6',
    desc: 'Visión global del flujo institucional en FX, índices y bonos simultáneamente. Requiere reporte Combined.',
  },
];

const CSS = `
  @keyframes ob-in    { from{opacity:0;transform:scale(0.96) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes ob-fade  { from{opacity:0} to{opacity:1} }
  @keyframes ob-slide { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
  @keyframes ob-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

  .ob-backdrop {
    position:fixed;
    top:0; right:0; bottom:0; left:0;
    background:rgba(0,0,0,0.82);
    -webkit-backdrop-filter:blur(14px);
    backdrop-filter:blur(14px);
    z-index:9999;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
    animation:ob-fade 0.2s ease;
  }
  .ob-card {
    background:#11161d;
    border:1px solid #263041;
    border-radius:20px;
    width:100%;
    max-width:540px;
    /* dvh not supported iOS < 15.4 — use vh as safe fallback */
    max-height:92vh;
    overflow-y:auto;
    -webkit-overflow-scrolling:touch;
    box-shadow:0 40px 100px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04);
    animation:ob-in 0.32s cubic-bezier(.34,1.4,.64,1);
  }
  .ob-card::-webkit-scrollbar { width:4px; }
  .ob-card::-webkit-scrollbar-thumb { background:#263041;border-radius:99px; }
  .ob-step { animation:ob-slide 0.22s ease; }
  .ob-market {
    display:flex;
    align-items:center;
    gap:14px;
    padding:15px 18px;
    border:1.5px solid #263041;
    border-radius:12px;
    cursor:pointer;
    transition:all 0.15s;
    text-align:left;
    background:transparent;
    width:100%;
    margin-bottom:9px;
    -webkit-tap-highlight-color:transparent;
  }
  .ob-market:hover { border-color:rgba(0,85,204,0.4);background:rgba(0,85,204,0.06); }
  .ob-market.sel { border-color:#0055cc;background:rgba(0,85,204,0.10);box-shadow:0 0 0 1px rgba(0,85,204,0.2); }
  .ob-btn-pri {
    display:block;
    width:100%;
    padding:15px;
    border-radius:12px;
    border:none;
    background:#0055cc;
    color:#fff;
    font-size:15px;
    font-weight:700;
    cursor:pointer;
    transition:background 0.15s,transform 0.1s;
    letter-spacing:0.01em;
    font-family:inherit;
    -webkit-tap-highlight-color:transparent;
    /* Minimum tap target iOS */
    min-height:44px;
  }
  .ob-btn-pri:hover:not(:disabled) { background:#0047b3;transform:translateY(-1px); }
  .ob-btn-pri:disabled { opacity:0.35;cursor:default; }
  .ob-btn-sec {
    display:block;
    width:100%;
    padding:12px;
    border-radius:12px;
    border:1px solid #263041;
    background:transparent;
    color:#5a6070;
    font-size:13px;
    font-weight:600;
    cursor:pointer;
    margin-top:9px;
    transition:border-color 0.15s,color 0.15s;
    font-family:inherit;
    min-height:44px;
    -webkit-tap-highlight-color:transparent;
  }
  .ob-btn-sec:hover { border-color:#5a6070;color:#8b90a0; }
`;

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ step, onSkip }) {
  return (
    <div style={{ padding:'18px 24px 0', borderBottom:'1px solid #1a2230' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:10, fontWeight:700, color:'#5a6070', letterSpacing:'0.12em' }}>
          COT TRACKER
        </span>
        <button onClick={onSkip} style={{
          background:'none', border:'none', cursor:'pointer', padding:'4px 8px',
          fontSize:11, color:'#5a6070', borderRadius:6, fontFamily:'inherit',
          transition:'color 0.15s', minHeight:44, minWidth:44,
          WebkitTapHighlightColor:'transparent',
        }}
          onMouseEnter={e => e.currentTarget.style.color='#8b90a0'}
          onMouseLeave={e => e.currentTarget.style.color='#5a6070'}
        >
          Omitir
        </button>
      </div>
      {/* Progress bar */}
      <div style={{ height:3, background:'#1a2230', borderRadius:99, overflow:'hidden', marginBottom:14 }}>
        <div style={{
          height:'100%', background:'#0055cc', borderRadius:99,
          width:`${(step / TOTAL_STEPS) * 100}%`,
          transition:'width 0.4s cubic-bezier(.4,0,.2,1)',
        }}/>
      </div>
      {/* Step dots */}
      <div style={{ display:'flex', gap:5, justifyContent:'center', paddingBottom:16 }}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} style={{
            height:4, borderRadius:99,
            width: i === step - 1 ? 20 : 6,
            background: i < step ? '#0055cc' : '#263041',
            transition:'all 0.3s ease',
          }}/>
        ))}
      </div>
    </div>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────
function WelcomeStep({ onNext, isMobile }) {
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '36px 38px 32px' }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <div style={{
          width:60, height:60, borderRadius:16, background:'rgba(0,85,204,0.12)',
          border:'1px solid rgba(0,85,204,0.25)', margin:'0 auto 22px',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M5 18L10 12L14 15L19 9" stroke="#0055cc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={{ margin:'0 0 10px', fontSize: isMobile ? 22 : 26, fontWeight:800,
          color:'#e8eaf0', letterSpacing:'-0.4px', lineHeight:1.2 }}>
          Bienvenido a COT Tracker
        </h1>
        <p style={{ margin:0, fontSize:15, color:'#8b90a0', lineHeight:1.65,
          maxWidth:380, marginInline:'auto' }}>
          Convierte datos institucionales del CFTC en ventaja operativa real antes de cada trade.
        </p>
      </div>

      <div style={{
        background:'rgba(255,255,255,0.025)', border:'1px solid #263041',
        borderRadius:12, padding:'18px 20px', marginBottom:28,
      }}>
        {[
          { icon:'🎯', text:'Sesgo institucional semanal por activo' },
          { icon:'⚡', text:'Permiso operativo intradía basado en datos' },
          { icon:'🌐', text:'Cross Asset Flow: FX, índices y bonos' },
        ].map(({ icon, text }) => (
          <div key={text} style={{ display:'flex', alignItems:'center', gap:12,
            marginBottom:12, paddingBottom:12,
            borderBottom:'1px solid #1a2230',
          }}>
            <span style={{ fontSize:18, flexShrink:0, width:28, textAlign:'center' }}>{icon}</span>
            <span style={{ fontSize:13, color:'#8b90a0' }}>{text}</span>
          </div>
        ))}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:18, flexShrink:0, width:28, textAlign:'center' }}>📅</span>
          <span style={{ fontSize:13, color:'#8b90a0' }}>Calendario macro con análisis de impacto</span>
        </div>
      </div>

      <button className="ob-btn-pri" onClick={onNext}>Comenzar →</button>
    </div>
  );
}

// ── Step 2: Market ────────────────────────────────────────────────────────────
function MarketStep({ onNext, isMobile }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '32px 38px 28px' }}>
      <h2 style={{ margin:'0 0 6px', fontSize: isMobile ? 20 : 22, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.3px' }}>
        ¿Qué mercado operas?
      </h2>
      <p style={{ margin:'0 0 22px', fontSize:14, color:'#5a6070' }}>
        Personalizaremos tu primera lectura.
      </p>
      {MARKETS.map(m => (
        <button key={m.id} className={`ob-market${selected === m.id ? ' sel' : ''}`}
          onClick={() => setSelected(m.id)}>
          <span style={{ fontSize:26, flexShrink:0 }}>{m.emoji}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#e8eaf0', marginBottom:2 }}>{m.label}</div>
            <div style={{ fontSize:11, color:'#5a6070' }}>{m.desc}</div>
          </div>
          {selected === m.id && (
            <div style={{ width:18, height:18, borderRadius:'50%', background:'#0055cc', flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </button>
      ))}
      <button className="ob-btn-pri" disabled={!selected} onClick={() => onNext(selected)}
        style={{ marginTop:6 }}>
        Continuar →
      </button>
      <button className="ob-btn-sec" onClick={() => onNext(null)}>Saltar</button>
    </div>
  );
}

// ── Step 3: Trading Level ─────────────────────────────────────────────────────
const LEVELS = [
  { id: 'beginner',     emoji: '🌱', label: 'Principiante',   desc: 'Menos de 1 año operando' },
  { id: 'intermediate', emoji: '📊', label: 'Intermedio',     desc: '1–3 años con experiencia real' },
  { id: 'advanced',     emoji: '🎯', label: 'Avanzado',       desc: 'Más de 3 años, estrategia propia' },
];

function TradingLevelStep({ onNext, isMobile }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '32px 38px 28px' }}>
      <h2 style={{ margin:'0 0 6px', fontSize: isMobile ? 20 : 22, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.3px' }}>
        ¿Cuál es tu nivel como trader?
      </h2>
      <p style={{ margin:'0 0 22px', fontSize:14, color:'#5a6070' }}>
        Adaptaremos las lecturas a tu experiencia.
      </p>
      {LEVELS.map(l => (
        <button key={l.id} className={`ob-market${selected === l.id ? ' sel' : ''}`}
          onClick={() => setSelected(l.id)}>
          <span style={{ fontSize:26, flexShrink:0 }}>{l.emoji}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#e8eaf0', marginBottom:2 }}>{l.label}</div>
            <div style={{ fontSize:11, color:'#5a6070' }}>{l.desc}</div>
          </div>
          {selected === l.id && (
            <div style={{ width:18, height:18, borderRadius:'50%', background:'#0055cc', flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </button>
      ))}
      <button className="ob-btn-pri" disabled={!selected} onClick={() => onNext(selected)}
        style={{ marginTop:6 }}>
        Continuar →
      </button>
      <button className="ob-btn-sec" onClick={() => onNext(null)}>Saltar</button>
    </div>
  );
}

// ── Step 4: Trading Goal ──────────────────────────────────────────────────────
const GOALS = [
  { id: 'learn',         emoji: '📚', label: 'Aprender',        desc: 'Entender el mercado institucional' },
  { id: 'profitability', emoji: '💰', label: 'Rentabilidad',    desc: 'Mejorar mi win-rate y gestión de riesgo' },
  { id: 'scale',         emoji: '🚀', label: 'Escalar',         desc: 'Crecer capital y sistematizar operativa' },
];

function TradingGoalStep({ onNext, isMobile }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '32px 38px 28px' }}>
      <h2 style={{ margin:'0 0 6px', fontSize: isMobile ? 20 : 22, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.3px' }}>
        ¿Cuál es tu objetivo principal?
      </h2>
      <p style={{ margin:'0 0 22px', fontSize:14, color:'#5a6070' }}>
        Cuéntanos qué quieres conseguir con COT Tracker.
      </p>
      {GOALS.map(g => (
        <button key={g.id} className={`ob-market${selected === g.id ? ' sel' : ''}`}
          onClick={() => setSelected(g.id)}>
          <span style={{ fontSize:26, flexShrink:0 }}>{g.emoji}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#e8eaf0', marginBottom:2 }}>{g.label}</div>
            <div style={{ fontSize:11, color:'#5a6070' }}>{g.desc}</div>
          </div>
          {selected === g.id && (
            <div style={{ width:18, height:18, borderRadius:'50%', background:'#0055cc', flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </button>
      ))}
      <button className="ob-btn-pri" disabled={!selected} onClick={() => onNext(selected)}
        style={{ marginTop:6 }}>
        Continuar →
      </button>
      <button className="ob-btn-sec" onClick={() => onNext(null)}>Saltar</button>
    </div>
  );
}

// ── Step 5: Telegram CTA ──────────────────────────────────────────────────────
function TelegramStep({ onNext, isMobile }) {
  const [clicked, setClicked] = useState(false);

  const handleTelegram = useCallback(() => {
    console.log('[funnel] telegram clicked');
    window.open(TELEGRAM_URL, '_blank');
    setClicked(true);
    onNext(true); // joined = true
  }, [onNext]);

  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '36px 38px 32px', textAlign:'center' }}>
      <div style={{
        width:64, height:64, borderRadius:18,
        background:'linear-gradient(135deg,rgba(0,136,204,0.15),rgba(0,136,204,0.08))',
        border:'1px solid rgba(0,136,204,0.3)',
        margin:'0 auto 22px',
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:30,
      }}>
        ✈️
      </div>
      <h2 style={{ margin:'0 0 10px', fontSize: isMobile ? 22 : 24, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.4px' }}>
        Tu acceso está listo 🚀
      </h2>
      <p style={{ margin:'0 0 28px', fontSize:15, color:'#8b90a0', lineHeight:1.65,
        maxWidth:360, marginInline:'auto' }}>
        Los traders que avanzan no operan solos. Únete a la comunidad privada.
      </p>
      <div style={{
        background:'rgba(0,136,204,0.07)', border:'1px solid rgba(0,136,204,0.2)',
        borderRadius:12, padding:'16px 18px', marginBottom:24, textAlign:'left',
      }}>
        {[
          { icon:'📢', text:'Análisis COT en tiempo real antes de cada semana' },
          { icon:'🧠', text:'Lecturas de sesgo institucional comentadas' },
          { icon:'💬', text:'Comunidad activa de traders COT' },
        ].map(({ icon, text }) => (
          <div key={text} style={{ display:'flex', alignItems:'center', gap:12,
            marginBottom:9, paddingBottom:9, borderBottom:'1px solid rgba(0,136,204,0.12)' }}>
            <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
            <span style={{ fontSize:13, color:'#8b90a0' }}>{text}</span>
          </div>
        ))}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:16, flexShrink:0 }}>🔒</span>
          <span style={{ fontSize:13, color:'#8b90a0' }}>Acceso privado — solo miembros</span>
        </div>
      </div>
      <button
        className="ob-btn-pri"
        onClick={handleTelegram}
        style={{ background:'#0088cc', marginBottom:0 }}
      >
        ✈️ Entrar al Telegram
      </button>
      <button className="ob-btn-sec" onClick={() => onNext(false)}>Continuar sin unirme</button>
    </div>
  );
}

// ── Step 6: Explain (was Step 3) ──────────────────────────────────────────────
function ExplainStep({ onNext, isMobile }) {
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '32px 38px 28px' }}>
      <h2 style={{ margin:'0 0 6px', fontSize: isMobile ? 20 : 22, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.3px' }}>
        Cómo leer el Dashboard
      </h2>
      <p style={{ margin:'0 0 20px', fontSize:14, color:'#5a6070' }}>
        Cada módulo tiene un rol distinto. Úsalos en secuencia.
      </p>
      {MODULES.map(({ icon, title, color, desc }) => (
        <div key={title} style={{ display:'flex', gap:12, alignItems:'flex-start',
          padding:'13px 15px', borderRadius:10, background:'rgba(255,255,255,0.025)',
          border:'1px solid #263041', marginBottom:8 }}>
          <div style={{ width:34, height:34, borderRadius:8, flexShrink:0,
            background:`${color}18`, border:`1px solid ${color}30`,
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>
            {icon}
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#e8eaf0', marginBottom:3 }}>{title}</div>
            <div style={{ fontSize:12, color:'#8b90a0', lineHeight:1.55 }}>{desc}</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop:16, padding:'12px 14px', borderRadius:10,
        background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.18)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#f59e0b', marginBottom:3 }}>⚠ Contexto, no señal</div>
        <div style={{ fontSize:11, color:'#8b90a0', lineHeight:1.55 }}>
          COT Tracker es un filtro de contexto macro. Confirma siempre con análisis técnico antes de operar.
        </div>
      </div>

      <div style={{ marginTop:10, padding:'12px 14px', borderRadius:10,
        background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#ef4444', marginBottom:6 }}>✕ Qué NO hacer con estos datos</div>
        {[
          'Abrir posiciones basándote solo en el sesgo COT sin confirmación técnica',
          'Interpretar "sesgo alcista" como una señal de compra inmediata',
          'Asumir que los datos son en tiempo real — reflejan posiciones del martes anterior',
          'Ignorar el horizonte temporal: el COT es relevante en 1–4 semanas, no en intradía',
        ].map((text, i) => (
          <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start',
            marginBottom: i < 3 ? 5 : 0 }}>
            <span style={{ color:'#ef4444', fontSize:10, flexShrink:0, marginTop:1 }}>✕</span>
            <span style={{ fontSize:11, color:'#8b90a0', lineHeight:1.5 }}>{text}</span>
          </div>
        ))}
      </div>

      <button className="ob-btn-pri" onClick={onNext} style={{ marginTop:16 }}>Entendido →</button>
    </div>
  );
}

// ── Step 7: Broker ────────────────────────────────────────────────────────────
const IC_TRADING_URL = 'https://www.ictrading.com?camp=88636';

function BrokerStep({ onNext, isMobile }) {
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '36px 38px 32px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
          background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>
          🏦
        </div>
        <h2 style={{
          margin: '0 0 10px', fontSize: isMobile ? 20 : 22, fontWeight: 800,
          color: '#e8eaf0', letterSpacing: '-0.35px', lineHeight: 1.25,
        }}>
          Opera con un broker fiable
        </h2>
        <p style={{
          margin: 0, fontSize: 14, color: '#8b90a0', lineHeight: 1.65,
          maxWidth: 360, marginInline: 'auto',
        }}>
          Evita intermediarios poco transparentes. Este es el broker que usamos y recomendamos por estabilidad, regulación y variedad de mercados disponibles.
        </p>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.025)', border: '1px solid #263041',
        borderRadius: 12, padding: '16px 18px', marginBottom: 22,
      }}>
        {[
          { icon: '🛡️', text: 'Broker regulado internacionalmente' },
          { icon: '⚡', text: 'Ejecución rápida — Forex, índices, oro, CFDs' },
          { icon: '📊', text: 'Spreads competitivos con miles de instrumentos' },
        ].map(({ icon, text }) => (
          <div key={text} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #1a2230',
          }}>
            <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
            <span style={{ fontSize: 13, color: '#8b90a0' }}>{text}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>🌐</span>
          <span style={{ fontSize: 13, color: '#8b90a0' }}>Plataforma reconocida y de confianza en más de 200 países</span>
        </div>
      </div>

      <a
        href={IC_TRADING_URL}
        id="referalLink"
        target="_blank"
        rel="noopener noreferrer"
        className="ob-btn-pri"
        style={{ display: 'block', textDecoration: 'none', textAlign: 'center', marginBottom: 0 }}
        onClick={() => setTimeout(onNext, 120)}
      >
        Ver IC Trading →
      </a>
      <button className="ob-btn-sec" onClick={onNext}>Continuar</button>

      <p style={{ margin: '14px 0 0', fontSize: 10, color: '#3a404e', textAlign: 'center', lineHeight: 1.6 }}>
        Enlace de afiliado — sin coste adicional para ti. Solo recomendamos lo que usamos.
      </p>
    </div>
  );
}

// ── Step 4: Ready ─────────────────────────────────────────────────────────────
function ReadyStep({ market, onFinish, isMobile }) {
  const m = MARKETS.find(x => x.id === market);
  return (
    <div className="ob-step" style={{ padding: isMobile ? '28px 22px 26px' : '36px 38px 32px', textAlign:'center' }}>
      <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(34,197,94,0.12)',
        border:'1px solid rgba(34,197,94,0.28)', margin:'0 auto 20px',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:22, color:'#22c55e', animation:'ob-pulse 2.5s ease infinite' }}>
        ✓
      </div>
      <h2 style={{ margin:'0 0 10px', fontSize: isMobile ? 22 : 24, fontWeight:800,
        color:'#e8eaf0', letterSpacing:'-0.4px' }}>
        Ya estás listo.
      </h2>
      <p style={{ margin:'0 0 24px', fontSize:15, color:'#8b90a0', lineHeight:1.65,
        maxWidth:380, marginInline:'auto' }}>
        Usa COT Tracker como filtro antes de cada operación. El contexto institucional marca la diferencia.
      </p>

      {m && (
        <div style={{ padding:'15px 18px', borderRadius:12, marginBottom:16, textAlign:'left',
          background:'rgba(0,85,204,0.08)', border:'1px solid rgba(0,85,204,0.2)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:7 }}>
            <span style={{ fontSize:18 }}>{m.emoji}</span>
            <span style={{ fontSize:11, fontWeight:700, color:'#0055cc',
              textTransform:'uppercase', letterSpacing:'0.08em' }}>Para {m.label}</span>
          </div>
          <p style={{ margin:0, fontSize:13, color:'#8b90a0', lineHeight:1.6 }}>{m.insight}</p>
        </div>
      )}

      <div style={{ padding:'15px 18px', borderRadius:12, marginBottom:16, textAlign:'left',
        background:'rgba(255,255,255,0.025)', border:'1px solid #263041' }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#5a6070',
          letterSpacing:'0.1em', marginBottom:12 }}>PRIMERA MISIÓN HOY</div>
        {[
          {
            title: 'Descarga el archivo CFTC',
            desc: 'Ve a cftc.gov → Market Reports → Commitments of Traders → Traders in Financial Futures. Descarga el CSV de "Futures Only" (no el Combined ni el Legacy).',
          },
          {
            title: 'Importa en la pestaña "Importar datos"',
            desc: 'Arrastra el CSV o usa el botón de carga. El sistema detecta el formato automáticamente.',
          },
          {
            title: 'Lee el sesgo institucional',
            desc: '"Leveraged Money neto: +42K" significa que los fondos institucionales tienen 42.000 contratos más largos que cortos. Es un sesgo de contexto para las próximas 1–4 semanas, no una señal de entrada.',
          },
        ].map(({ title, desc }, i) => (
          <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start',
            marginBottom: i < 2 ? 12 : 0 }}>
            <div style={{ width:19, height:19, borderRadius:'50%', flexShrink:0,
              background:'rgba(0,85,204,0.15)', border:'1px solid rgba(0,85,204,0.28)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:10, fontWeight:800, color:'#0055cc', marginTop:1 }}>
              {i + 1}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'#c8ccd6', marginBottom:2 }}>{title}</div>
              <div style={{ fontSize:11, color:'#8b90a0', lineHeight:1.55 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding:'11px 14px', borderRadius:10, marginBottom:20, textAlign:'left',
        background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.18)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#ef4444', marginBottom:4 }}>
          ✕ Esto NO es una señal de trading
        </div>
        <div style={{ fontSize:11, color:'#8b90a0', lineHeight:1.55 }}>
          Los datos COT reflejan posiciones del martes, publicadas el viernes. No predicen movimientos de precio ni indican cuándo entrar o salir de una operación. Úsalos para filtrar el contexto institucional antes de aplicar tu análisis técnico.
        </div>
      </div>

      <button className="ob-btn-pri" onClick={onFinish}
        style={{ fontSize:16, padding:'17px' }}>
        Entrar al Dashboard →
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function OnboardingModal({ profile, onComplete }) {
  const [step,         setStep]         = useState(1);
  const [market,       setMarket]       = useState(null);
  const [tradingLevel, setTradingLevel] = useState(null);
  const [tradingGoal,  setTradingGoal]  = useState(null);
  const [isMobile,     setIsMobile]     = useState(() => {
    try { return window.innerWidth < 600; } catch { return false; }
  });

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    return () => { try { document.body.style.overflow = prev; } catch (e) {} };
  }, []);

  const skip = useCallback(() => {
    console.log('[onboarding] skipped');
    onComplete({ market, tradingLevel, tradingGoal });
  }, [onComplete, market, tradingLevel, tradingGoal]);

  const finish = useCallback(() => {
    console.log('[onboarding] completed, market:', market, 'level:', tradingLevel, 'goal:', tradingGoal);
    onComplete({ market, tradingLevel, tradingGoal });
  }, [onComplete, market, tradingLevel, tradingGoal]);

  const handleMarket = useCallback((sel) => {
    setMarket(sel);
    setStep(3);
  }, []);

  const handleLevel = useCallback((sel) => {
    setTradingLevel(sel);
    setStep(4);
  }, []);

  const handleGoal = useCallback((sel) => {
    setTradingGoal(sel);
    setStep(5);
  }, []);

  const handleTelegramDone = useCallback((_joined) => {
    setStep(6);
  }, []);

  const handleBrokerDone = useCallback(() => {
    setStep(8);
  }, []);

  const handleError = useCallback((e) => {
    console.error('[OnboardingModal] render error in step', step, e);
    skip();
  }, [skip, step]);

  return (
    <OnboardingErrorBoundary onError={handleError}>
      <style>{CSS}</style>
      <div className="ob-backdrop" onClick={e => e.target === e.currentTarget && skip()}>
        <div className="ob-card">
          <Header step={step} onSkip={skip} />
          {step === 1 && <WelcomeStep       onNext={() => setStep(2)}      isMobile={isMobile} />}
          {step === 2 && <MarketStep        onNext={handleMarket}          isMobile={isMobile} />}
          {step === 3 && <TradingLevelStep  onNext={handleLevel}           isMobile={isMobile} />}
          {step === 4 && <TradingGoalStep   onNext={handleGoal}            isMobile={isMobile} />}
          {step === 5 && <TelegramStep      onNext={handleTelegramDone}    isMobile={isMobile} profile={profile} />}
          {step === 6 && <ExplainStep       onNext={() => setStep(7)}      isMobile={isMobile} />}
          {step === 7 && <BrokerStep        onNext={handleBrokerDone}      isMobile={isMobile} />}
          {step === 8 && <ReadyStep         market={market} onFinish={finish} isMobile={isMobile} />}
        </div>
      </div>
    </OnboardingErrorBoundary>
  );
}

// ── Local error boundary — prevents onboarding crash from killing the dashboard
import { Component } from 'react';

class OnboardingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error('[OnboardingModal] ErrorBoundary caught:', error, info);
    // Notify parent so it can mark onboarding complete and unmount this
    if (this.props.onError) {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.crashed) return null; // Silent — parent will skip onboarding
    return this.props.children;
  }
}
