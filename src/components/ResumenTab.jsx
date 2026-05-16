/**
 * ResumenTab — Sunday Macro Review
 * Vista principal de análisis semanal: régimen → sentimiento → yields →
 * catalizadores → sesgo por divisa → shortlist de pares.
 * Solo presentación — toda la lógica vive en App.jsx / engines.
 */
import { useMemo, useState } from 'react';
import TooltipInfo from './TooltipInfo.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function classifyPair(score) {
  const abs = Math.abs(score);
  if (abs >= 3) return { label: 'A+', color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
  if (abs >= 2) return { label: 'Vigilar', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  if (abs >= 1) return { label: 'Condicional', color: '#6366f1', bg: 'rgba(99,102,241,0.12)' };
  return { label: 'Descartar', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' };
}

function getRegime(fg, vix, riskScore, globalMarketState) {
  if (vix >= 25 || riskScore >= 70) {
    return { label: 'RIESGO ELEVADO', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴', desc: 'Volatilidad alta. Reducir tamaño y evitar pares débiles.' };
  }
  if (vix >= 18 || riskScore >= 40) {
    return { label: 'PRECAUCIÓN', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🟡', desc: 'Contexto mixto. Operar solo setups A+ con confirmación.' };
  }
  if (globalMarketState === 'expansion' && fg >= 50) {
    return { label: 'TENDENCIAL', color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: '🟢', desc: 'Condiciones favorables. Priorizar continuaciones de tendencia.' };
  }
  return { label: 'NEUTRAL', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', icon: '🔵', desc: 'Sin sesgo claro. Esperar confluencia antes de entrar.' };
}

function fgLabel(fg) {
  if (fg >= 75) return { text: 'Codicia Extrema', color: '#ef4444' };
  if (fg >= 55) return { text: 'Codicia', color: '#f59e0b' };
  if (fg >= 45) return { text: 'Neutral', color: '#6366f1' };
  if (fg >= 25) return { text: 'Miedo', color: '#f59e0b' };
  return { text: 'Miedo Extremo', color: '#ef4444' };
}

function buildCurrencyScores(biasArr) {
  const scores = {};
  const counts = {};
  for (const { pair, score } of biasArr) {
    const parts = pair.split('/');
    if (parts.length !== 2) continue;
    const [base, quote] = parts;
    scores[base] = (scores[base] || 0) + score;
    counts[base] = (counts[base] || 0) + 1;
    scores[quote] = (scores[quote] || 0) - score;
    counts[quote] = (counts[quote] || 0) + 1;
  }
  return Object.keys(scores)
    .map(ccy => ({ ccy, score: +(scores[ccy] / (counts[ccy] || 1)).toFixed(2) }))
    .sort((a, b) => b.score - a.score);
}

function impactColor(impact) {
  if (impact === 'High')   return '#ef4444';
  if (impact === 'Medium') return '#f59e0b';
  return '#6b7280';
}

function SectionHeader({ icon, title, sub, tooltip, T }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</span>
      {tooltip && <TooltipInfo text={tooltip} />}
      {sub && <><span style={{ flex: 1, height: 1, background: T.border }} /><span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.05em', fontWeight: 500 }}>{sub}</span></>}
      {!sub && <span style={{ flex: 1, height: 1, background: T.border }} />}
    </div>
  );
}

function Card({ children, T, style = {} }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: '16px 18px', ...style,
    }}>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResumenTab({
  T,
  darkMode,
  biasArr = [],
  sharedEvents = [],
  allSentimentData = null,
  allRiskData = null,
  globalMarketState = 'neutral',
  sharedLiveVix = null,
  pairsData = null,
  onNavigate,
}) {
  const [showAllCatalysts, setShowAllCatalysts] = useState(false);

  // ── Derived data ─────────────────────────────────────────────────────────
  const sentiment = allSentimentData ?? { fg: 50, vix: sharedLiveVix ?? 15, highCount: 0, midCount: 0, vixIsReal: false };
  const risk = allRiskData ?? { score: 0 };
  const vix = sharedLiveVix ?? parseFloat(sentiment.vix ?? 15);
  const fg = sentiment.fg ?? 50;
  const vixIsReal = !!sharedLiveVix;

  const regime = useMemo(
    () => getRegime(fg, vix, risk.score, globalMarketState),
    [fg, vix, risk.score, globalMarketState]
  );

  const fgInfo = useMemo(() => fgLabel(fg), [fg]);

  const currencyScores = useMemo(() => buildCurrencyScores(biasArr), [biasArr]);

  // Weekly high-impact catalysts — sorted by date, top 6
  const catalysts = useMemo(() => {
    return sharedEvents
      .filter(e => e.impact === 'High' || e.impact === 'Medium')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, showAllCatalysts ? 20 : 5);
  }, [sharedEvents, showAllCatalysts]);

  const allCatalysts = useMemo(() => sharedEvents.filter(e => e.impact === 'High' || e.impact === 'Medium'), [sharedEvents]);

  // Pair shortlist sorted by |score|
  const shortlist = useMemo(() => {
    return [...biasArr]
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 8)
      .map(r => ({ ...r, tier: classifyPair(r.score) }));
  }, [biasArr]);

  const hasCOTData = pairsData && pairsData.length > 0;
  const hasCalendarData = sharedEvents.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 60px' }}>

      {/* ── PHASE 1: RÉGIMEN DE MERCADO ──────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader icon="🌐" title="Régimen de Mercado" sub="CONTEXTO GLOBAL" tooltip="Estado general del mercado basado en VIX y riesgo operativo. Determina qué tamaño de posición usar y qué setups priorizar esta semana." T={T} />
        <div style={{
          background: regime.bg, border: `1px solid ${regime.color}40`,
          borderRadius: 12, padding: '18px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{regime.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: regime.color, letterSpacing: '0.05em' }}>
                {regime.label}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 600, color: regime.color,
                background: `${regime.color}20`, borderRadius: 4, padding: '2px 8px',
                letterSpacing: '0.08em',
              }}>
                {globalMarketState?.toUpperCase?.() ?? 'NEUTRAL'}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: T.sub, lineHeight: 1.5 }}>{regime.desc}</p>
          </div>
        </div>
      </div>

      {/* ── PHASE 2: SENTIMIENTO & VIX ───────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader icon="📊" title="Sentimiento & Flujo" sub="FEAR/GREED · VIX" tooltip="Combina VIX y la carga de eventos macro para medir el riesgo operativo del mercado. Úsalo para decidir si aumentar o reducir el tamaño de posición." T={T} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>

          {/* Fear & Greed */}
          <Card T={T}>
            <div style={{ fontSize: 10, color: T.sub2, fontWeight: 600, marginBottom: 8, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4 }}>
              FEAR / GREED
              <TooltipInfo text="Índice 0-100 del sentimiento del mercado. >55 = codicia (mayor riesgo). <45 = miedo (posibles oportunidades). Ajusta tu exposición en consecuencia." />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: fgInfo.color, lineHeight: 1 }}>{fg}</span>
              <span style={{ fontSize: 11, color: fgInfo.color, fontWeight: 600 }}>/100</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, color: fgInfo.color,
                background: `${fgInfo.color}18`, borderRadius: 4, padding: '2px 8px',
              }}>{fgInfo.text}</span>
            </div>
            {/* Bar */}
            <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fg}%`, background: fgInfo.color, borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
          </Card>

          {/* VIX */}
          <Card T={T}>
            <div style={{ fontSize: 10, color: T.sub2, fontWeight: 600, marginBottom: 8, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4 }}>
              {vixIsReal ? 'VIX · TIEMPO REAL' : 'VIX ESTIMADO'}
              <TooltipInfo text="Volatilidad implícita del S&P 500. VIX < 18 = calma. VIX 18-25 = precaución, reduce tamaño. VIX > 25 = riesgo elevado, evita operar." />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: 32, fontWeight: 800, lineHeight: 1,
                color: vix >= 25 ? '#ef4444' : vix >= 18 ? '#f59e0b' : '#10b981',
              }}>{typeof vix === 'number' ? vix.toFixed(1) : '--'}</span>
              <span style={{ fontSize: 11, color: T.sub, fontWeight: 500 }}>pts</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11, color: vix >= 25 ? '#ef4444' : vix >= 18 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                {vix >= 25 ? 'Volatilidad Alta' : vix >= 18 ? 'Volatilidad Media' : 'Calma relativa'}
              </span>
            </div>
            {!vixIsReal && <div style={{ marginTop: 6, fontSize: 9, color: T.sub2 }}>dato de mercado no disponible</div>}
          </Card>

          {/* Eventos semana */}
          <Card T={T}>
            <div style={{ fontSize: 10, color: T.sub2, fontWeight: 600, marginBottom: 8, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4 }}>
              EVENTOS SEMANA
              <TooltipInfo text="Publicaciones macroeconómicas relevantes esta semana. Más eventos de alto impacto = mayor volatilidad potencial. Reduce el tamaño de posición cuando ≥ 3 eventos de alto impacto." />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: 32, fontWeight: 800, lineHeight: 1,
                color: (sentiment.highCount ?? 0) >= 3 ? '#ef4444' : (sentiment.highCount ?? 0) >= 1 ? '#f59e0b' : '#10b981',
              }}>{sentiment.highCount ?? 0}</span>
              <span style={{ fontSize: 11, color: T.sub, fontWeight: 500 }}>alto impacto</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: T.sub }}>
              +{sentiment.midCount ?? 0} medio impacto
            </div>
          </Card>

          {/* Riesgo operativo */}
          <Card T={T}>
            <div style={{ fontSize: 10, color: T.sub2, fontWeight: 600, marginBottom: 8, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4 }}>
              RIESGO OPERATIVO
              <TooltipInfo text="Score 0-100 que combina VIX y eventos macro. < 40 = condiciones favorables. 40-70 = precaución, reduce tamaño. > 70 = evita operar." />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: 32, fontWeight: 800, lineHeight: 1,
                color: risk.score >= 70 ? '#ef4444' : risk.score >= 40 ? '#f59e0b' : '#10b981',
              }}>{risk.score ?? 0}</span>
              <span style={{ fontSize: 11, color: T.sub, fontWeight: 500 }}>/100</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: risk.score >= 70 ? '#ef4444' : risk.score >= 40 ? '#f59e0b' : '#10b981' }}>
              {risk.score >= 70 ? 'Alto' : risk.score >= 40 ? 'Moderado' : 'Bajo'}
            </div>
          </Card>
        </div>
      </div>

      {/* ── PHASE 3: CATALIZADORES DE LA SEMANA ──────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader icon="📅" title="Catalizadores de la Semana" sub="ALTO · MEDIO IMPACTO" T={T} />
        {!hasCalendarData ? (
          <Card T={T}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
              <div style={{ fontSize: 13, color: T.sub }}>Cargando calendario económico…</div>
            </div>
          </Card>
        ) : catalysts.length === 0 ? (
          <Card T={T}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 13, color: T.sub }}>Sin eventos de alto/medio impacto esta semana.</div>
            </div>
          </Card>
        ) : (
          <Card T={T} style={{ padding: '12px 16px' }}>
            {catalysts.map((ev, i) => {
              const dateStr = ev.date ? new Date(ev.date).toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
              const timeStr = ev.date && ev.date.length > 10 ? new Date(ev.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderBottom: i < catalysts.length - 1 ? `1px solid ${T.border}` : 'none',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: impactColor(ev.impact),
                  }} />
                  <div style={{ minWidth: 70, flexShrink: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.txt }}>{dateStr}</div>
                    {timeStr && <div style={{ fontSize: 9, color: T.sub2 }}>{timeStr}</div>}
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: impactColor(ev.impact),
                    background: `${impactColor(ev.impact)}15`, borderRadius: 3,
                    padding: '1px 5px', flexShrink: 0, letterSpacing: '0.05em',
                  }}>{(ev.country || '').toUpperCase()}</span>
                  <div style={{ flex: 1, fontSize: 12, color: T.txt, lineHeight: 1.3 }}>
                    {ev.event || ev.title || '—'}
                  </div>
                  {ev.actual != null && ev.actual !== '' && (
                    <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, flexShrink: 0 }}>
                      {ev.actual}
                    </div>
                  )}
                </div>
              );
            })}
            {allCatalysts.length > 5 && (
              <button
                onClick={() => setShowAllCatalysts(v => !v)}
                style={{
                  marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: T.accent, fontWeight: 600, padding: '4px 0',
                }}
              >
                {showAllCatalysts ? '▲ Mostrar menos' : `▼ Ver todos (${allCatalysts.length})`}
              </button>
            )}
          </Card>
        )}
      </div>

      {/* ── PHASE 4: SESGO POR DIVISA ─────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader icon="💱" title="Sesgo por Divisa" sub="COT · CFTC" tooltip="Fortaleza relativa de cada divisa según el posicionamiento institucional del informe COT (CFTC). Positivo = divisa fuerte vs sus pares. Negativo = divisa débil. Basado en datos semanales." T={T} />
        {!hasCOTData ? (
          <Card T={T}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: T.sub }}>
                Importa datos COT para ver el sesgo institucional por divisa.
              </p>
              <button
                onClick={() => onNavigate?.('importar')}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  cursor: 'pointer', background: T.accent, color: 'white',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                Ir a Importar CSV →
              </button>
            </div>
          </Card>
        ) : (
          <Card T={T} style={{ padding: '12px 16px' }}>
            {currencyScores.map(({ ccy, score }) => {
              const pct = Math.min(100, Math.abs(score) / 5 * 100);
              const positive = score > 0;
              const color = score > 0.5 ? '#10b981' : score < -0.5 ? '#ef4444' : '#6b7280';
              return (
                <div key={ccy} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 30, fontSize: 11, fontWeight: 700, color: T.txt, flexShrink: 0 }}>{ccy}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Bar */}
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.border, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        position: 'absolute',
                        height: '100%',
                        width: `${pct}%`,
                        background: color,
                        borderRadius: 3,
                        left: positive ? '50%' : `calc(50% - ${pct/2}%)`,
                        transition: 'width 0.4s',
                      }} />
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: T.border }} />
                    </div>
                  </div>
                  <span style={{
                    width: 44, fontSize: 11, fontWeight: 700, color,
                    textAlign: 'right', flexShrink: 0,
                  }}>
                    {score > 0 ? '+' : ''}{score.toFixed(1)}
                  </span>
                  <span style={{
                    width: 60, fontSize: 9, fontWeight: 600,
                    color, textAlign: 'right', flexShrink: 0,
                    letterSpacing: '0.05em',
                  }}>
                    {score > 0.5 ? 'ALCISTA' : score < -0.5 ? 'BAJISTA' : 'NEUTRAL'}
                  </span>
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {/* ── PHASE 5: SHORTLIST DE PARES ───────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader icon="🎯" title="Shortlist de Pares" sub="PRIORIDAD OPERATIVA" tooltip="Pares ordenados por intensidad de sesgo institucional COT. A+ (|score| ≥ 3) = sesgo fuerte, operable. Vigilar (≥ 2) = sesgo moderado. Condicional (≥ 1) = sesgo incipiente, esperar confirmación. Descartar = sin sesgo claro." T={T} />
        {!hasCOTData ? (
          <Card T={T}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 13, color: T.sub }}>Requiere datos COT importados.</div>
            </div>
          </Card>
        ) : shortlist.length === 0 ? (
          <Card T={T}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 13, color: T.sub }}>Sin pares con sesgo suficiente esta semana.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {shortlist.map(({ pair, score, state, tier }) => {
              const direction = score > 0 ? 'LARGO' : score < 0 ? 'CORTO' : 'NEUTRAL';
              const dirColor  = score > 0 ? '#10b981' : score < 0 ? '#ef4444' : '#6b7280';
              return (
                <div key={pair} style={{
                  background: tier.bg,
                  border: `1px solid ${tier.color}30`,
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: T.txt }}>{pair}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: tier.color,
                      background: tier.bg, border: `1px solid ${tier.color}40`,
                      borderRadius: 4, padding: '2px 6px', letterSpacing: '0.06em',
                    }}>{tier.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: dirColor,
                      background: `${dirColor}15`, borderRadius: 4, padding: '2px 7px',
                    }}>{direction}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: dirColor }}>
                      {score > 0 ? '+' : ''}{score.toFixed(1)}
                    </span>
                  </div>
                  {state && (
                    <div style={{ marginTop: 6, fontSize: 9, color: T.sub2, letterSpacing: '0.05em' }}>
                      {state.toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
