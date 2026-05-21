import { useState, useMemo, useCallback } from 'react';
import {
  buildPairExport,
  buildSnapshotExport,
  buildRawExport,
  buildXLSXExport,
  buildHTMLExport,
  openPDFPrint,
  pairToCSV,
  snapshotToCSV,
  toCSV,
  downloadFile,
  buildFilename,
} from '../lib/exportEngine.js';

// ── SCOPE DEFINITIONS ─────────────────────────────────────────────────────────

const SCOPES = [
  {
    id:          'pair',
    level:       'BÁSICO',
    levelColor:  '#60a5fa',
    title:       'Current Pair',
    subtitle:    'Per-pair institutional analysis',
    desc:        'Quick export for Excel and trading review.',
    features:    ['Bias score + label', 'Execution permission', 'COT divergence', 'Weekly flow', 'Trend state'],
    formats:     ['csv', 'json'],
    premium:     false,
    icon:        <PairIcon />,
  },
  {
    id:          'snapshot',
    level:       'AVANZADO',
    levelColor:  '#a78bfa',
    title:       'Full Market Snapshot',
    subtitle:    'Complete institutional overview',
    desc:        'Complete institutional market overview for comparative analysis.',
    features:    ['All pairs in one file', 'Market overview counts', 'Regime + trend state', 'Macro context'],
    formats:     ['csv', 'json'],
    premium:     false,
    icon:        <SnapshotIcon />,
  },
  {
    id:          'raw',
    level:       'POWER USER',
    levelColor:  '#f59e0b',
    title:       'Raw Institutional Data',
    subtitle:    'Full layers + history + engine outputs',
    desc:        'Advanced JSON export for automation and quantitative analysis.',
    features:    ['All engine layers + deltas', 'Weekly COT history', 'V2 engine internals', 'Carry + confluence + macro'],
    formats:     ['json'],
    premium:     true,
    icon:        <RawIcon />,
  },
  {
    id:          'visual',
    level:       'REPORT',
    levelColor:  '#10b981',
    title:       'Visual Report',
    subtitle:    'Styled XLSX, HTML & PDF exports',
    desc:        'Professional branded reports with charts, narratives and formatted tables.',
    features:    ['XLSX with 3 styled sheets', 'HTML institutional report', 'PDF via browser print', 'Auto-generated narratives'],
    formats:     ['xlsx', 'html', 'pdf'],
    premium:     true,
    icon:        <VisualIcon />,
  },
];

// ── ICONS ─────────────────────────────────────────────────────────────────────

function PairIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="2" rx="1" fill="currentColor" opacity=".9"/>
      <rect x="2" y="8" width="10" height="2" rx="1" fill="currentColor" opacity=".6"/>
      <rect x="2" y="13" width="7"  height="2" rx="1" fill="currentColor" opacity=".4"/>
    </svg>
  );
}

function SnapshotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9"/>
      <rect x="10" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity=".7"/>
      <rect x="2" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/>
      <rect x="10" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/>
    </svg>
  );
}

function RawIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M5 4L2 9l3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13 4l3 5-3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10.5 3l-3 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function VisualIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 8l2.5-3L10 8l2-2 2 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 15h5M8 15h2M11 15h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".5"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v8M4 6l3 3 3-3M1 11h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── PRIMITIVES ────────────────────────────────────────────────────────────────

const FORMAT_DESC = {
  csv:  'Spreadsheet-ready',
  json: 'For automation',
  xlsx: 'Best for Excel',
  html: 'Best for reports',
  pdf:  'Best for sharing',
};

function FormatToggle({ options, value, onChange, T, disabled }) {
  return (
    <div style={{
      display:      'flex',
      background:   T.card2,
      border:       `1px solid ${T.border}`,
      borderRadius: 8,
      padding:      2,
      gap:          2,
    }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => !disabled && onChange(opt)}
          disabled={disabled}
          title={FORMAT_DESC[opt] ?? opt}
          style={{
            padding:      '5px 14px',
            borderRadius: 6,
            border:       'none',
            background:   value === opt ? T.accent : 'transparent',
            color:        value === opt ? '#fff' : T.sub,
            fontSize:     11,
            fontWeight:   value === opt ? 700 : 500,
            cursor:       disabled ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em',
            transition:   'all 0.15s',
            opacity:      disabled ? 0.4 : 1,
          }}
        >
          {opt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display:       'inline-block',
      width:         6,
      height:        6,
      borderRadius:  '50%',
      background:    active ? '#22c55e' : '#6b7280',
      boxShadow:     active ? '0 0 6px #22c55e88' : 'none',
      verticalAlign: 'middle',
    }}/>
  );
}

// ── SCOPE CARD ────────────────────────────────────────────────────────────────

function ScopeCard({ scope, selected, onClick, isPremium, T, darkMode }) {
  const locked  = scope.premium && !isPremium;
  const active  = selected && !locked;

  return (
    <button
      onClick={() => !locked && onClick(scope.id)}
      style={{
        flex:         1,
        minWidth:     180,
        position:     'relative',
        padding:      '16px 18px',
        borderRadius: 12,
        border:       `1.5px solid ${active ? scope.levelColor : locked ? T.border : T.border}`,
        background:   active
          ? `linear-gradient(135deg, ${scope.levelColor}12 0%, ${scope.levelColor}06 100%)`
          : darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        cursor:       locked ? 'not-allowed' : 'pointer',
        textAlign:    'left',
        transition:   'all 0.18s',
        boxShadow:    active ? `0 0 0 1px ${scope.levelColor}30, 0 4px 20px ${scope.levelColor}14` : 'none',
        opacity:      locked ? 0.6 : 1,
      }}
    >
      {/* Selected indicator */}
      {active && (
        <div style={{
          position:     'absolute',
          inset:        0,
          borderRadius: 11,
          background:   `radial-gradient(ellipse at top left, ${scope.levelColor}08, transparent 70%)`,
          pointerEvents: 'none',
        }}/>
      )}

      {/* Level badge + lock */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize:      9,
          fontWeight:    700,
          color:         scope.levelColor,
          background:    `${scope.levelColor}16`,
          border:        `1px solid ${scope.levelColor}30`,
          padding:       '2px 8px',
          borderRadius:  99,
          letterSpacing: '0.08em',
        }}>
          {scope.level}
        </span>
        {locked && (
          <span style={{ color: T.sub, opacity: 0.7 }}>
            <LockIcon />
          </span>
        )}
        {active && (
          <div style={{
            width:      18, height: 18,
            borderRadius: '50%',
            background:   scope.levelColor,
            display:     'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckIcon />
          </div>
        )}
      </div>

      {/* Icon + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: active ? scope.levelColor : T.txt }}>
        {scope.icon}
        <span style={{ fontSize: 13, fontWeight: 700 }}>{scope.title}</span>
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
        {scope.desc}
      </p>

      {/* Feature list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {scope.features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width:  4, height: 4, borderRadius: '50%', flexShrink: 0,
              background: active ? scope.levelColor : T.sub2,
            }}/>
            <span style={{ fontSize: 10, color: active ? T.txt : T.sub }}>{f}</span>
          </div>
        ))}
      </div>

      {locked && (
        <div style={{
          marginTop:  10,
          fontSize:   10,
          fontWeight: 600,
          color:      '#f59e0b',
          display:    'flex', alignItems: 'center', gap: 4,
        }}>
          <LockIcon /> Premium feature — upgrade to unlock
        </div>
      )}
    </button>
  );
}

// ── DOWNLOAD BUTTON ───────────────────────────────────────────────────────────

function ExportButton({ onClick, loading, done, disabled, scope, format, T }) {
  const actionLabel = format === 'pdf'  ? 'Open PDF Preview'
                    : format === 'xlsx' ? 'Export Excel Report'
                    : format === 'html' ? 'Export HTML Report'
                    : 'Export Institutional Data';
  const label = loading ? 'Generating...' : done ? 'Downloaded' : actionLabel;
  const color = done ? '#22c55e' : scope?.levelColor ?? T.accent;

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display:       'flex',
        alignItems:    'center',
        justifyContent: 'center',
        gap:           8,
        padding:       '12px 28px',
        borderRadius:  10,
        border:        `1px solid ${disabled ? T.border : `${color}60`}`,
        background:    disabled
          ? T.card2
          : done
          ? 'rgba(34,197,94,0.12)'
          : `linear-gradient(135deg, ${color}18, ${color}0c)`,
        color:         disabled ? T.sub : color,
        fontSize:      13,
        fontWeight:    700,
        cursor:        disabled ? 'not-allowed' : 'pointer',
        opacity:       disabled ? 0.5 : 1,
        transition:    'all 0.2s',
        letterSpacing: '0.02em',
        minWidth:      200,
        boxShadow:     !disabled && !done ? `0 0 0 1px ${color}22, 0 4px 16px ${color}18` : 'none',
      }}
    >
      {loading ? (
        <LoadingSpinner color={color} />
      ) : done ? (
        <CheckIcon />
      ) : (
        <DownloadIcon />
      )}
      {label}
    </button>
  );
}

function LoadingSpinner({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'cot-spin 0.8s linear infinite' }}>
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.25"/>
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <style>{`@keyframes cot-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ── SNAPSHOT STATUS BAR ───────────────────────────────────────────────────────

function SnapshotStatus({ biasArr, fxPairs, macroSignal, T, darkMode }) {
  const dates = (fxPairs ?? [])
    .map(p => p.latest?.isoDate ?? p.weeks?.[0]?.isoDate)
    .filter(Boolean).sort().reverse();
  const cftcDate = dates[0] ?? null;

  const items = [
    { label: 'Pairs',       value: `${biasArr?.length ?? 0}` },
    { label: 'CFTC Report', value: cftcDate ?? '—' },
    macroSignal?.bias
      ? { label: 'Macro', value: macroSignal.bias.replace(/_/g, ' ') }
      : null,
    { label: 'Status', value: 'Active', dot: true },
  ].filter(Boolean);

  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      gap:           20,
      padding:       '10px 16px',
      background:    darkMode ? 'rgba(34,197,94,0.05)' : 'rgba(34,197,94,0.04)',
      border:        '1px solid rgba(34,197,94,0.18)',
      borderRadius:  10,
      flexWrap:      'wrap',
    }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
            {item.label.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 5 }}>
            {item.value}
            {item.dot && <StatusDot active />}
          </span>
        </div>
      ))}
      <div style={{ marginLeft: 'auto', fontSize: 10, color: T.sub }}>
        COT Tracker · Institutional Data Export
      </div>
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
  isPremium,
  onUpgrade,
}) {
  const [scope,    setScope]    = useState('pair');
  const [format,   setFormat]   = useState('csv');
  const [symbol,   setSymbol]   = useState(null);
  const [status,   setStatus]   = useState('idle'); // idle | loading | done | error
  const [lastTime, setLastTime] = useState(null);

  const hasData = (biasArr?.length ?? 0) > 0 && (fxPairs?.length ?? 0) > 0;

  const pairs = useMemo(
    () => (fxPairs ?? []).filter(p => !p.pair.includes('Index')).map(p => p.pair),
    [fxPairs],
  );
  const activePair = symbol ?? pairs[0] ?? null;

  const pairMap = useMemo(
    () => Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p])),
    [fxPairs],
  );

  const activeScopeMeta = SCOPES.find(s => s.id === scope);
  const availableFormats = activeScopeMeta?.formats ?? ['json'];
  const activeFormat = availableFormats.includes(format) ? format : availableFormats[0];

  const exportOpts = { macroSignal, livePrices: livePrices ?? {}, sentimentData, riskData, ratesData, candleMap: candleMap ?? {} };

  const handleExport = useCallback(() => {
    if (!hasData || status === 'loading') return;

    // Gate premium scopes
    if ((scope === 'raw' || scope === 'visual') && !isPremium) {
      onUpgrade?.();
      return;
    }

    setStatus('loading');

    setTimeout(() => {
      try {
        let content, filename, mime;

        if (scope === 'pair') {
          const biasEntry = biasArr.find(b => b.pair === activePair);
          const pairRow   = pairMap[activePair];
          const data = buildPairExport(pairRow, biasEntry, { ...exportOpts, livePrice: livePrices?.[activePair] });
          if (!data) throw new Error('No data for pair');

          filename = buildFilename('pair', activePair, activeFormat);
          if (activeFormat === 'json') {
            content = JSON.stringify(data, null, 2);
            mime    = 'application/json';
          } else {
            content = pairToCSV(data);
            mime    = 'text/csv;charset=utf-8';
          }

        } else if (scope === 'snapshot') {
          const snap = buildSnapshotExport(biasArr, fxPairs, exportOpts);
          filename = buildFilename('snapshot', null, activeFormat);
          if (activeFormat === 'json') {
            content = JSON.stringify({ snapshot_date: new Date().toISOString().slice(0, 10), export_version: '2.0', ...snap }, null, 2);
            mime    = 'application/json';
          } else {
            content = snapshotToCSV(snap);
            mime    = 'text/csv;charset=utf-8';
          }

        } else if (scope === 'raw') {
          const raw = buildRawExport(biasArr, fxPairs, exportOpts);
          filename = buildFilename('raw', null, 'json');
          content  = JSON.stringify(raw, null, 2);
          mime     = 'application/json';

        } else if (scope === 'visual') {
          if (activeFormat === 'xlsx') {
            const result = buildXLSXExport(biasArr, fxPairs, exportOpts);
            // Uint8Array → Blob download
            const blob = new Blob([result.data], { type: result.mime });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = result.filename; a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
            setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
            return;

          } else if (activeFormat === 'pdf') {
            const success = openPDFPrint(biasArr, fxPairs, exportOpts);
            if (!success) throw new Error('Could not open print window. Check pop-up blocker.');
            setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
            return;

          } else {
            // html
            const result = buildHTMLExport(biasArr, fxPairs, exportOpts);
            content  = result.data;
            filename = result.filename;
            mime     = result.mime;
          }
        }

        downloadFile(content, filename, mime);
        setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
        setStatus('done');
        setTimeout(() => setStatus('idle'), 3000);
      } catch (e) {
        console.error('[ExportPanel]', e);
        setStatus('error');
        setTimeout(() => setStatus('idle'), 2500);
      }
    }, 0);
  }, [scope, activeFormat, activePair, hasData, biasArr, fxPairs, exportOpts, isPremium]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{
          background:   T.card,
          border:       `1px solid ${T.border}`,
          borderRadius: 14,
          padding:      '48px 32px',
          textAlign:    'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>⬡</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.txt, marginBottom: 8 }}>
            No snapshot available
          </div>
          <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6, maxWidth: 380, marginInline: 'auto' }}>
            The export system requires COT data to be loaded.
            Await the automatic Friday sync or upload a CFTC file manually from the Sync tab.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  const isLocked  = activeScopeMeta?.premium && !isPremium;
  const btnDisabled = !hasData || isLocked;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.txt, letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            Institutional Data Export
          </h2>
          <span style={{
            fontSize: 9, fontWeight: 700, color: T.sub,
            background: T.card2, border: `1px solid ${T.border}`,
            padding: '2px 8px', borderRadius: 99, letterSpacing: '0.08em',
          }}>v2.0</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6, maxWidth: 560 }}>
          Professional-grade export system for advanced traders. Access and exploit institutional positioning data in CSV or JSON.
        </p>
      </div>

      {/* ── Scope selector ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.08em', marginBottom: 10 }}>
          EXPORT SCOPE
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {SCOPES.map(s => (
            <ScopeCard
              key={s.id}
              scope={s}
              selected={scope === s.id}
              onClick={setScope}
              isPremium={isPremium}
              T={T}
              darkMode={darkMode}
            />
          ))}
        </div>
      </div>

      {/* ── Options row ── */}
      <div style={{
        display:       'flex',
        alignItems:    'flex-end',
        gap:           16,
        flexWrap:      'wrap',
        padding:       '16px 20px',
        background:    T.card,
        border:        `1px solid ${T.border}`,
        borderRadius:  12,
        marginBottom:  16,
      }}>

        {/* Pair selector — only when scope = pair */}
        {scope === 'pair' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
              SELECT PAIR
            </label>
            <select
              value={activePair ?? ''}
              onChange={e => setSymbol(e.target.value)}
              style={{
                padding:      '7px 32px 7px 10px',
                borderRadius: 8,
                border:       `1px solid ${T.border}`,
                background:   T.card2,
                color:        T.txt,
                fontSize:     13,
                fontWeight:   600,
                cursor:       'pointer',
                fontFamily:   'inherit',
                outline:      'none',
                appearance:   'none',
                WebkitAppearance: 'none',
                minWidth:     130,
              }}
            >
              {pairs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}

        {/* Format toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
            FORMAT
          </label>
          <FormatToggle
            options={availableFormats}
            value={activeFormat}
            onChange={setFormat}
            T={T}
            disabled={availableFormats.length === 1}
          />
          {FORMAT_DESC[activeFormat] && (
            <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.04em' }}>
              {FORMAT_DESC[activeFormat]}
            </span>
          )}
        </div>

        {/* Scope info */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em', marginBottom: 5 }}>
            DESCRIPTION
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
            {activeScopeMeta?.desc}
            {scope === 'raw' && !isPremium && (
              <span style={{ color: '#f59e0b', fontWeight: 600 }}> — Premium only.</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Snapshot status ── */}
      <SnapshotStatus biasArr={biasArr} fxPairs={fxPairs} macroSignal={macroSignal} T={T} darkMode={darkMode} />

      {/* ── Export CTA ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          {lastTime && status !== 'loading' && (
            <div style={{ fontSize: 11, color: T.sub }}>
              Last export: <span style={{ color: '#22c55e', fontWeight: 600 }}>{lastTime}</span>
              {' · '}{buildFilename(scope, activePair, activeFormat)}
            </div>
          )}
          {status === 'error' && (
            <div style={{ fontSize: 11, color: '#ef4444' }}>Export failed — check console for details.</div>
          )}
          {!lastTime && (
            <div style={{ fontSize: 11, color: T.sub2 }}>
              Download raw positioning and layer metrics.
            </div>
          )}
        </div>

        <ExportButton
          onClick={handleExport}
          loading={status === 'loading'}
          done={status === 'done'}
          disabled={btnDisabled}
          scope={activeScopeMeta}
          format={activeFormat}
          T={T}
        />
      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop:  28,
        paddingTop: 16,
        borderTop:  `1px solid ${T.border}`,
        display:    'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap:   'wrap',
        gap:        12,
      }}>
        <p style={{ margin: 0, fontSize: 10, color: T.sub2, lineHeight: 1.6, maxWidth: 440 }}>
          All exported data reflects the current snapshot state of the COT Tracker engine suite.
          Export is for analytical use only and does not constitute financial advice.
          Source: CFTC · Traders in Financial Futures.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em' }}>COT TRACKER</span>
          <span style={{ fontSize: 9, color: T.sub2 }}>Institutional Export System v2.0</span>
        </div>
      </div>
    </div>
  );
}
