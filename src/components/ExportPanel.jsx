import { useState, useMemo } from 'react';
import {
  buildPairExportRow,
  buildSnapshotExport,
  buildRawExport,
  toCSV,
  downloadFile,
  buildFilename,
} from '../lib/exportEngine.js';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const LEVEL_META = {
  pair: {
    rank:  1,
    badge: 'BÁSICO',
    title: 'Por par',
    desc:  'Score, sesgo, divergencia y posicionamiento para un par específico.',
    formats: ['csv', 'json'],
  },
  snapshot: {
    rank:  2,
    badge: 'AVANZADO',
    title: 'Snapshot completo',
    desc:  'Todos los pares del mercado en una fecha concreta. Ideal para análisis semanal.',
    formats: ['csv', 'json'],
  },
  raw: {
    rank:  3,
    badge: 'POWER USER',
    title: 'Raw JSON completo',
    desc:  'Todas las layers, historial semanal COT, métricas internas y outputs de engines.',
    formats: ['json'],
  },
};

const BADGE_COLORS = {
  1: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.25)' },
  2: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.25)' },
  3: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.25)' },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function formatLabel(fmt) { return fmt.toUpperCase(); }

function resolveSnapshotDate(fxPairs) {
  const dates = (fxPairs ?? [])
    .map(p => p.latest?.isoDate ?? p.weeks?.[0]?.isoDate)
    .filter(Boolean)
    .sort()
    .reverse();
  return dates[0] ?? null;
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function FormatToggle({ formats, value, onChange, T }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {formats.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          style={{
            padding:      '4px 12px',
            borderRadius: 6,
            border:       `1px solid ${value === f ? T.accent : T.border}`,
            background:   value === f ? `${T.accent}18` : 'transparent',
            color:        value === f ? T.accent : T.sub,
            fontSize:     11,
            fontWeight:   value === f ? 700 : 500,
            cursor:       'pointer',
            letterSpacing: '0.05em',
            transition:   'all 0.15s',
          }}
        >
          {formatLabel(f)}
        </button>
      ))}
    </div>
  );
}

function DownloadButton({ onClick, loading, disabled, label, T }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        padding:      '8px 16px',
        borderRadius: 8,
        border:       `1px solid ${disabled ? T.border : T.accent}`,
        background:   disabled ? 'transparent' : `${T.accent}18`,
        color:        disabled ? T.sub : T.accent,
        fontSize:     12,
        fontWeight:   700,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        opacity:      disabled ? 0.5 : 1,
        transition:   'all 0.15s',
        whiteSpace:   'nowrap',
      }}
    >
      {loading ? (
        <span style={{ fontSize: 12 }}>...</span>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {label}
    </button>
  );
}

// ── LEVEL CARD ────────────────────────────────────────────────────────────────

function ExportCard({ level, meta, children, T, darkMode }) {
  const bColors = BADGE_COLORS[meta.rank];
  return (
    <div style={{
      background:   T.card,
      border:       `1px solid ${T.border}`,
      borderRadius: 14,
      padding:      '20px 22px',
      display:      'flex',
      flexDirection: 'column',
      gap:          16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: bColors.bg,
          border: `1px solid ${bColors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: bColors.color }}>
            {meta.rank}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.txt }}>{meta.title}</span>
            <span style={{
              fontSize:  9,
              fontWeight: 700,
              color:     bColors.color,
              background: bColors.bg,
              border:    `1px solid ${bColors.border}`,
              padding:   '2px 7px',
              borderRadius: 99,
              letterSpacing: '0.07em',
            }}>{meta.badge}</span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
            {meta.desc}
          </p>
        </div>
      </div>

      {/* Content slot */}
      {children}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function ExportPanel({
  biasArr,
  fxPairs,
  macroSignal,
  ratesData,
  candleMap,
  livePrices,
  sentimentData,
  riskData,
  darkMode,
  T,
}) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [pairFormat,     setPairFormat]     = useState('csv');
  const [snapshotFormat, setSnapshotFormat] = useState('csv');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [loading,        setLoading]        = useState({});
  const [lastExport,     setLastExport]     = useState({});

  // ── Derived ───────────────────────────────────────────────────────────────
  const availablePairs = useMemo(
    () => (fxPairs ?? []).filter(p => !p.pair.includes('Index')).map(p => p.pair),
    [fxPairs],
  );

  const activePair = selectedSymbol ?? availablePairs[0] ?? null;

  const snapshotDate = useMemo(() => resolveSnapshotDate(fxPairs), [fxPairs]);

  const hasData = biasArr?.length > 0 && fxPairs?.length > 0;

  const pairMap  = useMemo(
    () => Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p])),
    [fxPairs],
  );

  const exportOpts = {
    macroSignal,
    livePrices:  livePrices ?? {},
    sentimentData,
    riskData,
    ratesData,
    candleMap:   candleMap ?? {},
  };

  // ── Download Handlers ─────────────────────────────────────────────────────

  function setLoad(key, val) {
    setLoading(prev => ({ ...prev, [key]: val }));
  }
  function markDone(key) {
    setLastExport(prev => ({ ...prev, [key]: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }));
    setLoad(key, false);
  }

  function handlePairDownload() {
    if (!hasData || !activePair) return;
    setLoad('pair', true);
    setTimeout(() => {
      try {
        const biasEntry = biasArr.find(b => b.pair === activePair);
        const pairRow   = pairMap[activePair];
        const row = buildPairExportRow(pairRow, biasEntry, { ...exportOpts, livePrice: livePrices?.[activePair] });
        if (!row) return;
        const filename = buildFilename('pair', activePair, pairFormat);
        if (pairFormat === 'json') {
          downloadFile(JSON.stringify(row, null, 2), filename, 'application/json');
        } else {
          downloadFile(toCSV([row]), filename, 'text/csv;charset=utf-8');
        }
        markDone('pair');
      } catch (e) {
        console.error('[ExportPanel] pair export error:', e);
        setLoad('pair', false);
      }
    }, 0);
  }

  function handleSnapshotDownload() {
    if (!hasData) return;
    setLoad('snapshot', true);
    setTimeout(() => {
      try {
        const rows = buildSnapshotExport(biasArr, fxPairs, exportOpts);
        const filename = buildFilename('snapshot', null, snapshotFormat);
        if (snapshotFormat === 'json') {
          downloadFile(JSON.stringify(rows, null, 2), filename, 'application/json');
        } else {
          downloadFile(toCSV(rows), filename, 'text/csv;charset=utf-8');
        }
        markDone('snapshot');
      } catch (e) {
        console.error('[ExportPanel] snapshot export error:', e);
        setLoad('snapshot', false);
      }
    }, 0);
  }

  function handleRawDownload() {
    if (!hasData) return;
    setLoad('raw', true);
    setTimeout(() => {
      try {
        const data     = buildRawExport(biasArr, fxPairs, exportOpts);
        const filename = buildFilename('raw', null, 'json');
        downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
        markDone('raw');
      } catch (e) {
        console.error('[ExportPanel] raw export error:', e);
        setLoad('raw', false);
      }
    }, 0);
  }

  // ── Empty State ───────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{
          background: T.card,
          border:     `1px solid ${T.border}`,
          borderRadius: 14,
          padding:    '36px 24px',
          textAlign:  'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.txt, marginBottom: 8 }}>
            Sin datos disponibles
          </div>
          <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6 }}>
            La exportación requiere que los datos COT estén cargados.
            Espera el sync automático del viernes o sube un archivo CFTC manualmente desde Sync.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const Divider = () => <div style={{ height: 1, background: T.border, margin: '4px 0' }} />;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px' }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.txt, letterSpacing: '-0.3px' }}>
            Exportación de datos COT
          </h2>
          <span style={{
            fontSize: 9, fontWeight: 700, color: T.sub,
            background: T.card2, border: `1px solid ${T.border}`,
            padding: '2px 8px', borderRadius: 99, letterSpacing: '0.07em',
          }}>BETA</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6 }}>
          Descarga los análisis del snapshot actual en CSV o JSON.
          Los datos reflejan el estado de engines e inferencias en el momento de la exportación.
        </p>
      </div>

      {/* Snapshot status bar */}
      <div style={{
        display:     'flex',
        alignItems:  'center',
        gap:         20,
        padding:     '12px 16px',
        background:  darkMode ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.04)',
        border:      '1px solid rgba(34,197,94,0.2)',
        borderRadius: 10,
        marginBottom: 24,
        flexWrap:    'wrap',
      }}>
        <StatusChip label="Pares" value={`${biasArr.length}`} T={T} color="#22c55e" />
        <StatusChip label="Informe CFTC" value={snapshotDate ?? '—'} T={T} color="#22c55e" />
        {macroSignal?.bias && (
          <StatusChip label="Sesgo macro" value={macroSignal.bias.replace('_', ' ')} T={T} color="#60a5fa" />
        )}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: T.sub }}>
          Snapshot activo
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e', marginLeft: 6, verticalAlign: 'middle' }}/>
        </div>
      </div>

      {/* Export cards grid */}
      <div style={{
        display:  'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap:      16,
        marginBottom: 16,
      }}>

        {/* ── Level 1: Per Pair ── */}
        <ExportCard level="pair" meta={LEVEL_META.pair} T={T} darkMode={darkMode}>
          {/* Pair selector */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.06em', marginBottom: 6 }}>
              PAR
            </div>
            <select
              value={activePair ?? ''}
              onChange={e => setSelectedSymbol(e.target.value)}
              style={{
                width:        '100%',
                padding:      '7px 10px',
                borderRadius: 8,
                border:       `1px solid ${T.border}`,
                background:   darkMode ? 'rgba(255,255,255,0.05)' : '#f9f9fb',
                color:        T.txt,
                fontSize:     13,
                fontWeight:   600,
                cursor:       'pointer',
                fontFamily:   'inherit',
                outline:      'none',
              }}
            >
              {availablePairs.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <Divider />

          {/* Format + Download */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <FormatToggle
              formats={LEVEL_META.pair.formats}
              value={pairFormat}
              onChange={setPairFormat}
              T={T}
            />
            <DownloadButton
              onClick={handlePairDownload}
              loading={loading.pair}
              disabled={!activePair}
              label={`Descargar ${pairFormat.toUpperCase()}`}
              T={T}
            />
          </div>
          {lastExport.pair && (
            <div style={{ fontSize: 10, color: T.sub }}>Última exportación: {lastExport.pair}</div>
          )}
        </ExportCard>

        {/* ── Level 2: Full Snapshot ── */}
        <ExportCard level="snapshot" meta={LEVEL_META.snapshot} T={T} darkMode={darkMode}>
          <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
            <strong style={{ color: T.txt }}>{biasArr.length} pares</strong> incluidos en el snapshot
            {snapshotDate && (
              <> · Informe <strong style={{ color: T.txt }}>{snapshotDate}</strong></>
            )}
          </div>

          <Divider />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <FormatToggle
              formats={LEVEL_META.snapshot.formats}
              value={snapshotFormat}
              onChange={setSnapshotFormat}
              T={T}
            />
            <DownloadButton
              onClick={handleSnapshotDownload}
              loading={loading.snapshot}
              disabled={false}
              label={`Descargar ${snapshotFormat.toUpperCase()}`}
              T={T}
            />
          </div>
          {lastExport.snapshot && (
            <div style={{ fontSize: 10, color: T.sub }}>Última exportación: {lastExport.snapshot}</div>
          )}
        </ExportCard>

      </div>

      {/* ── Level 3: Raw JSON — full width ── */}
      <ExportCard level="raw" meta={LEVEL_META.raw} T={T} darkMode={darkMode}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}>
          {[
            ['Historial COT semanal', 'Todas las semanas disponibles por par'],
            ['Engine outputs',        'Bias, Z-Score, divergencia, confluencia, ejecución'],
            ['Contexto macro/carry',  'macroConfidence, carryScore, stanceDivergence'],
            ['Formato JSON',          'Listo para automatización, backtesting e IA'],
          ].map(([title, sub]) => (
            <div key={title} style={{
              background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.txt, marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.4 }}>{sub}</div>
            </div>
          ))}
        </div>

        <Divider />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, color: T.sub }}>
            Solo disponible en JSON · Tamaño estimado: ~{Math.round(biasArr.length * 12)}KB
          </div>
          <DownloadButton
            onClick={handleRawDownload}
            loading={loading.raw}
            disabled={false}
            label="Descargar raw.json"
            T={T}
          />
        </div>
        {lastExport.raw && (
          <div style={{ fontSize: 10, color: T.sub }}>Última exportación: {lastExport.raw}</div>
        )}
      </ExportCard>

      {/* Footer note */}
      <p style={{ margin: '20px 0 0', fontSize: 10, color: T.sub, lineHeight: 1.6 }}>
        Los datos exportados reflejan el análisis del motor COT en tiempo real y no constituyen asesoramiento financiero.
        Fuente: CFTC · Traders in Financial Futures.
      </p>
    </div>
  );
}

// ── STATUS CHIP ───────────────────────────────────────────────────────────────

function StatusChip({ label, value, T, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
        {label.toUpperCase()}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color ?? T.txt }}>
        {value}
      </span>
    </div>
  );
}
