import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  buildPairExport,
  buildSnapshotExport,
  buildRawExport,
  buildXLSXExport,
  buildHTMLExport,
  openPDFPrint,
  pairToCSV,
  snapshotToCSV,
  downloadFile,
  buildFilename,
  buildMultiPairCSV,
  buildMultiPairJSON,
  buildIntelligenceExport,
  buildTelegramBriefing,
} from '../lib/exportEngine.js';

// ── SCOPE DEFINITIONS ─────────────────────────────────────────────────────────

const SCOPES = [
  {
    id:          'pair',
    level:       'BÁSICO',
    levelColor:  '#60a5fa',
    title:       'Activos Seleccionados',
    subtitle:    'Análisis institucional por activo',
    desc:        'Exporta uno o varios activos. Cada activo seleccionado se convierte en una fila CSV o un objeto JSON.',
    features:    ['Selección multi-activo', 'Score de sesgo + etiqueta', 'Permiso de ejecución', 'Divergencia COT', 'Flujo semanal'],
    formats:     ['csv', 'json'],
    premium:     false,
    icon:        <PairIcon />,
  },
  {
    id:          'snapshot',
    level:       'AVANZADO',
    levelColor:  '#a78bfa',
    title:       'Snapshot de Mercado Completo',
    subtitle:    'Visión institucional completa',
    desc:        'Visión institucional completa del mercado para análisis comparativo.',
    features:    ['Todos los pares en un archivo', 'Resumen global de mercado', 'Estado de régimen + tendencia', 'Contexto macro'],
    formats:     ['csv', 'json'],
    premium:     false,
    icon:        <SnapshotIcon />,
  },
  {
    id:          'raw',
    level:       'POWER USER',
    levelColor:  '#f59e0b',
    title:       'Datos Institucionales Raw',
    subtitle:    'Capas completas + historial + salidas de motor',
    desc:        'Exportación JSON avanzada para automatización y análisis cuantitativo.',
    features:    ['Todas las capas del motor + deltas', 'Historial COT semanal', 'Internos del motor V2', 'Carry + confluencia + macro'],
    formats:     ['json'],
    premium:     true,
    icon:        <RawIcon />,
  },
  {
    id:          'visual',
    level:       'INFORME',
    levelColor:  '#10b981',
    title:       'Informe Visual',
    subtitle:    'Exportaciones XLSX, HTML y PDF con estilo',
    desc:        'Informes profesionales con tablas formateadas, narrativas y datos institucionales.',
    features:    ['XLSX con 3 hojas con estilo', 'Informe HTML institucional', 'PDF vía impresión del navegador', 'Narrativas generadas automáticamente'],
    formats:     ['xlsx', 'html', 'pdf'],
    premium:     true,
    icon:        <VisualIcon />,
  },
  {
    id:          'intelligence',
    level:       'INTELIGENCIA',
    levelColor:  '#a78bfa',
    title:       'Briefing de Inteligencia',
    subtitle:    'Consenso de agentes + régimen + intermercado',
    desc:        'Paquete de inteligencia institucional: régimen adaptativo, consenso multi-agente, salud de intermercado y señales prioritarias.',
    features:    ['Texto para Telegram listo', 'JSON de consenso de agentes', 'Exportación de régimen adaptativo', 'Salud de señal intermercado', 'Ranking de señales prioritarias'],
    formats:     ['telegram', 'json'],
    premium:     false,
    icon:        <IntelligenceIcon />,
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

function IntelligenceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="9" cy="9" r="3"   fill="currentColor" opacity=".5"/>
      <path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ display: 'block' }}>
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 8l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

// ── PRIMITIVES ────────────────────────────────────────────────────────────────

const FORMAT_DESC = {
  csv:      'Listo para hoja de cálculo',
  json:     'Para automatización',
  xlsx:     'Ideal para Excel',
  html:     'Ideal para informes',
  pdf:      'Ideal para compartir',
  telegram: 'Copiar y pegar en Telegram',
};

function estimateExportSize(count, format) {
  if (!count) return '';
  // Conservative estimates: CSV ~650B fixed + ~550B/asset; JSON ~400B fixed + ~2600B/asset
  const fixed      = { csv: 650,  json: 400  };
  const perAsset   = { csv: 550,  json: 2600 };
  const bytes = (fixed[format] ?? 0) + count * (perAsset[format] ?? 1000);
  if (bytes < 1024)        return `~${bytes} B`;
  if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(1)} KB`;
  return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

// ── ASSET CHIP ────────────────────────────────────────────────────────────────
// Removable chip showing a single selected asset. Used in MultiAssetSelector.

function AssetChip({ pair, onRemove, T }) {
  const [hov, setHov] = useState(false);
  return (
    <span style={{
      display:        'inline-flex',
      alignItems:     'center',
      gap:            3,
      padding:        '2px 5px 2px 8px',
      borderRadius:   99,
      background:     T.card2,
      border:         `1px solid ${T.border}`,
      fontSize:       11,
      fontWeight:     700,
      color:          T.txt,
      fontFamily:     'monospace',
      letterSpacing:  '0.03em',
      userSelect:     'none',
    }}>
      {pair}
      <button
        onClick={() => onRemove(pair)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          15,
          height:         15,
          borderRadius:   '50%',
          border:         'none',
          background:     hov ? 'rgba(239,68,68,0.18)' : 'transparent',
          color:          hov ? '#ef4444' : T.sub,
          cursor:         'pointer',
          padding:        0,
          fontSize:       13,
          lineHeight:     1,
          transition:     'background 0.12s, color 0.12s',
          flexShrink:     0,
        }}
        aria-label={`Remove ${pair}`}
      >
        ×
      </button>
    </span>
  );
}

// ── MULTI-ASSET SELECTOR ──────────────────────────────────────────────────────
// Replaces the single <select> for scope=pair.
// Renders assets grouped by category (FX | INDEX | COMMODITIES | BONDS).
// Shows inline bias score/label per asset when available.

function MultiAssetSelector({ assets, selected, onChange, T, darkMode }) {
  const [query, setQuery] = useState('');

  // Group filtered assets by cat. FX stays first.
  const grouped = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = q
      ? assets.filter(a =>
          a.pair.toLowerCase().includes(q) ||
          (a.label ?? '').toLowerCase().includes(q)
        )
      : assets;

    const order = ['FX', 'INDEX', 'COMMODITIES', 'BONDS'];
    const map = {};
    for (const a of filtered) {
      const g = a.cat ?? 'FX';
      if (!map[g]) map[g] = [];
      map[g].push(a);
    }
    // Sort groups by canonical order, unknown groups go last
    return Object.fromEntries(
      Object.entries(map).sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
    );
  }, [assets, query]);

  const allPairs    = assets.map(a => a.pair);
  const allSelected = allPairs.length > 0 && allPairs.every(p => selected.includes(p));
  const noneVisible = Object.keys(grouped).length === 0;

  const toggle = useCallback((pair) => {
    onChange(prev =>
      prev.includes(pair) ? prev.filter(p => p !== pair) : [...prev, pair]
    );
  }, [onChange]);

  const selectAll = () => onChange([...allPairs]);
  const clearAll  = () => onChange([]);

  // Show at most 5 chips; the rest become a "+N more" badge
  const MAX_CHIPS   = 5;
  const visibleChips = selected.slice(0, MAX_CHIPS);
  const hiddenCount  = selected.length - visibleChips.length;

  return (
    <div>
      {/* ── Controls row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{
            position:      'absolute',
            left:          9,
            color:         T.sub,
            opacity:       0.5,
            pointerEvents: 'none',
            display:       'flex',
          }}>
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar activos..."
            style={{
              width:        '100%',
              padding:      '6px 10px 6px 28px',
              borderRadius: 7,
              border:       `1px solid ${T.border}`,
              background:   T.card2,
              color:        T.txt,
              fontSize:     12,
              outline:      'none',
              fontFamily:   'inherit',
              boxSizing:    'border-box',
            }}
          />
        </div>

        {/* Select All / Clear All */}
        <button
          onClick={allSelected ? clearAll : selectAll}
          style={{
            padding:      '6px 12px',
            borderRadius: 7,
            border:       `1px solid ${T.border}`,
            background:   T.card2,
            color:        T.sub,
            fontSize:     11,
            fontWeight:   600,
            cursor:       'pointer',
            whiteSpace:   'nowrap',
            fontFamily:   'inherit',
            transition:   'color 0.15s, border-color 0.15s',
          }}
        >
          {allSelected ? 'Limpiar Todo' : 'Seleccionar Todo'}
        </button>

        {/* Count badge */}
        <span style={{
          fontSize:   11,
          fontWeight: 700,
          color:      selected.length > 0 ? T.accent : T.sub,
          whiteSpace: 'nowrap',
          minWidth:   72,
          textAlign:  'right',
        }}>
          {selected.length} seleccionado{selected.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Checkbox list ── */}
      <div style={{
        maxHeight:    224,
        overflowY:    'auto',
        border:       `1px solid ${T.border}`,
        borderRadius: 8,
        background:   T.card2,
      }}>
        {noneVisible ? (
          <div style={{
            padding:   '18px 14px',
            textAlign: 'center',
            fontSize:  12,
            color:     T.sub,
          }}>
            No assets match &ldquo;{query}&rdquo;
          </div>
        ) : (
          Object.entries(grouped).map(([group, items], gi) => (
            <div key={group}>
              {/* Group label */}
              <div style={{
                padding:      '5px 12px 4px',
                fontSize:     9,
                fontWeight:   700,
                color:        T.sub,
                letterSpacing:'0.09em',
                background:   darkMode ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)',
                borderBottom: `1px solid ${T.border}`,
                ...(gi > 0 ? { borderTop: `1px solid ${T.border}` } : {}),
              }}>
                {group}
              </div>

              {/* Asset rows */}
              {items.map((asset, ai) => {
                const isChecked  = selected.includes(asset.pair);
                const isLast     = ai === items.length - 1;
                const scoreColor = asset.biasDirection === 'bullish' ? '#22c55e'
                  : asset.biasDirection === 'bearish' ? '#ef4444' : '#6b7280';

                return (
                  <label
                    key={asset.pair}
                    style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          9,
                      padding:      '7px 12px',
                      cursor:       'pointer',
                      borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
                      background:   isChecked
                        ? (darkMode ? 'rgba(37,99,235,0.09)' : 'rgba(37,99,235,0.05)')
                        : 'transparent',
                      transition:   'background 0.12s',
                      userSelect:   'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(asset.pair)}
                      style={{
                        cursor:      'pointer',
                        accentColor: T.accent,
                        width:       13,
                        height:      13,
                        flexShrink:  0,
                      }}
                    />
                    {asset.emoji && (
                      <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
                        {asset.emoji}
                      </span>
                    )}
                    <span style={{
                      flex:          1,
                      fontSize:      12,
                      fontWeight:    700,
                      color:         isChecked ? T.txt : T.sub,
                      fontFamily:    'monospace',
                      letterSpacing: '0.03em',
                      transition:    'color 0.12s',
                    }}>
                      {asset.pair}
                    </span>
                    {asset.biasScore != null && (
                      <span style={{
                        fontSize:      10,
                        fontWeight:    600,
                        color:         scoreColor,
                        background:    `${scoreColor}18`,
                        border:        `1px solid ${scoreColor}28`,
                        padding:       '1px 7px',
                        borderRadius:  99,
                        letterSpacing: '0.02em',
                        whiteSpace:    'nowrap',
                        flexShrink:    0,
                      }}>
                        {asset.biasScore} · {asset.biasLabel ?? '—'}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* ── Selected chips ── */}
      {selected.length > 0 && (
        <div style={{
          display:    'flex',
          flexWrap:   'wrap',
          gap:        5,
          marginTop:  10,
          alignItems: 'center',
        }}>
          {visibleChips.map(pair => (
            <AssetChip key={pair} pair={pair} onRemove={toggle} T={T} />
          ))}
          {hiddenCount > 0 && (
            <span style={{
              fontSize:     11,
              fontWeight:   600,
              color:        T.sub,
              padding:      '2px 9px',
              borderRadius: 99,
              background:   T.card2,
              border:       `1px solid ${T.border}`,
            }}>
              +{hiddenCount} más
            </span>
          )}
        </div>
      )}
    </div>
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
      {active && (
        <div style={{
          position:      'absolute',
          inset:         0,
          borderRadius:  11,
          background:    `radial-gradient(ellipse at top left, ${scope.levelColor}08, transparent 70%)`,
          pointerEvents: 'none',
        }}/>
      )}

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
          <span style={{ color: T.sub, opacity: 0.7 }}><LockIcon /></span>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: active ? scope.levelColor : T.txt }}>
        {scope.icon}
        <span style={{ fontSize: 13, fontWeight: 700 }}>{scope.title}</span>
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
        {scope.desc}
      </p>

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
          <LockIcon /> Función Premium — actualiza para desbloquear
        </div>
      )}
    </button>
  );
}

// ── DOWNLOAD BUTTON ───────────────────────────────────────────────────────────

function ExportButton({ onClick, loading, done, disabled, scope, format, selectedCount, T }) {
  const isPairScope  = scope?.id === 'pair';
  const multiAsset   = isPairScope && selectedCount > 1;

  const actionLabel  = format === 'pdf'  ? 'Abrir Vista Previa PDF'
                     : format === 'xlsx' ? 'Exportar Informe Excel'
                     : format === 'html' ? 'Exportar Informe HTML'
                     : multiAsset        ? `Exportar ${selectedCount} activos`
                     : 'Exportar Datos Institucionales';

  const label = loading ? 'Generando...' : done ? 'Descargado' : actionLabel;
  const color = done ? '#22c55e' : scope?.levelColor ?? T.accent;

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            8,
        padding:        '12px 28px',
        borderRadius:   10,
        border:         `1px solid ${disabled ? T.border : `${color}60`}`,
        background:     disabled
          ? T.card2
          : done
          ? 'rgba(34,197,94,0.12)'
          : `linear-gradient(135deg, ${color}18, ${color}0c)`,
        color:          disabled ? T.sub : color,
        fontSize:       13,
        fontWeight:     700,
        cursor:         disabled ? 'not-allowed' : 'pointer',
        opacity:        disabled ? 0.5 : 1,
        transition:     'all 0.2s',
        letterSpacing:  '0.02em',
        minWidth:       200,
        boxShadow:      !disabled && !done ? `0 0 0 1px ${color}22, 0 4px 16px ${color}18` : 'none',
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

function SnapshotStatus({ biasArr, fxPairs, macroSignal, selectedCount, T, darkMode }) {
  const dates = (fxPairs ?? [])
    .map(p => p.latest?.isoDate ?? p.weeks?.[0]?.isoDate)
    .filter(Boolean).sort().reverse();
  const cftcDate = dates[0] ?? null;

  const items = [
    { label: 'Pares',          value: `${biasArr?.length ?? 0}` },
    selectedCount != null
      ? { label: 'Seleccionados', value: `${selectedCount}`, accent: true }
      : null,
    { label: 'Informe CFTC', value: cftcDate ?? '—' },
    macroSignal?.bias
      ? { label: 'Macro', value: macroSignal.bias.replace(/_/g, ' ') }
      : null,
    { label: 'Estado', value: 'Activo', dot: true },
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
          <span style={{
            fontSize:   12,
            fontWeight: 700,
            color:      item.accent ? T.accent : '#22c55e',
            display:    'flex',
            alignItems: 'center',
            gap:        5,
          }}>
            {item.value}
            {item.dot && <StatusDot active />}
          </span>
        </div>
      ))}
      <div style={{ marginLeft: 'auto', fontSize: 10, color: T.sub }}>
        COT Tracker · Exportación Institucional
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function ExportPanel({
  biasArr,
  fxPairs,
  allBiasArr,
  allPairsArr,
  riskRegime,
  combinedData,
  macroSignal,
  ratesData,
  candleMap,
  livePrices,
  sentimentData,
  riskData,
  agentConsensus,
  adaptiveRegime,
  intermarket,
  signalPriority,
  darkMode,
  T,
  isPremium,
  onUpgrade,
}) {
  const [scope,           setScope]           = useState('pair');
  const [format,          setFormat]          = useState('csv');
  const [selectedSymbols, setSelectedSymbols] = useState([]);  // replaces single `symbol`
  const [status,          setStatus]          = useState('idle'); // idle | loading | done | error
  const [lastTime,        setLastTime]        = useState(null);
  const [lastFilename,    setLastFilename]    = useState(null);
  const [copied,          setCopied]          = useState(false);

  // Prefer the cross-asset arrays when available; fall back to FX-only for backward compat.
  const effectivePairs = useMemo(
    () => allPairsArr?.length ? allPairsArr : (fxPairs ?? []),
    [allPairsArr, fxPairs],
  );
  const effectiveBiasArr = useMemo(
    () => allBiasArr?.length ? allBiasArr : (biasArr ?? []),
    [allBiasArr, biasArr],
  );

  const hasData = effectiveBiasArr.length > 0 && effectivePairs.length > 0;

  // Pairs available for selection (same filter as before, excludes any "Index"-named pair)
  const pairs = useMemo(
    () => effectivePairs.filter(p => !p.pair.includes('Index')).map(p => p.pair),
    [effectivePairs],
  );

  // Initialize selection with the first available pair once data arrives.
  // A ref prevents re-initializing when the user has already made a selection.
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && pairs.length > 0) {
      setSelectedSymbols([pairs[0]]);
      initRef.current = true;
    }
  }, [pairs]);

  // Asset metadata for the multi-selector (pair name + bias score/label inline)
  const assetsList = useMemo(() => {
    const biasMap = Object.fromEntries(effectiveBiasArr.map(b => [b.pair, b]));
    return effectivePairs
      .filter(p => !p.pair.includes('Index'))
      .map(p => {
        const b    = biasMap[p.pair];
        const bias = b?.bias ?? b;
        const normScore = bias?.score != null
          ? Math.round(((bias.score + 5) / 10) * 100)
          : null;
        return {
          pair:          p.pair,
          label:         p.label ?? p.pair,
          cat:           (p.cat ?? 'fx').toUpperCase(),
          emoji:         p.emoji ?? '',
          biasScore:     normScore,
          biasLabel:     bias?.label ?? null,
          biasDirection: bias?.direction ?? 'neutral',
        };
      });
  }, [effectivePairs, effectiveBiasArr]);

  const pairMap = useMemo(
    () => Object.fromEntries(effectivePairs.map(p => [p.pair, p])),
    [effectivePairs],
  );

  // Backward-compat single-pair reference (used by single-asset export path)
  const activePair = selectedSymbols[0] ?? pairs[0] ?? null;

  const activeScopeMeta   = SCOPES.find(s => s.id === scope);
  const availableFormats  = activeScopeMeta?.formats ?? ['json'];
  const activeFormat      = availableFormats.includes(format) ? format : availableFormats[0];

  // Derive CFTC report date from the most recent week in the effective pairs
  const cotDate = useMemo(() => {
    const dates = effectivePairs
      .map(p => p.latest?.isoDate ?? p.weeks?.[0]?.isoDate)
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] ?? null;
  }, [effectivePairs]);

  const exportOpts = useMemo(() => ({
    macroSignal,
    livePrices:     livePrices ?? {},
    sentimentData,
    riskData,
    ratesData,
    candleMap:      candleMap     ?? {},
    riskRegime:     riskRegime    ?? null,
    combinedData:   combinedData  ?? null,
    cotDate:        cotDate       ?? null,
    snapshotDate:   new Date().toISOString().slice(0, 10),
    agentConsensus: agentConsensus ?? null,
    adaptiveRegime: adaptiveRegime ?? null,
    intermarket:    intermarket    ?? null,
    signalPriority: signalPriority ?? null,
  }), [macroSignal, livePrices, sentimentData, riskData, ratesData, candleMap, riskRegime, combinedData, cotDate,
       agentConsensus, adaptiveRegime, intermarket, signalPriority]);

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

        // ── scope: pair — single or multi ──────────────────────────────────
        if (scope === 'pair') {
          const isSingle = selectedSymbols.length <= 1;

          if (isSingle) {
            // Original single-pair behavior — preserved for backward compat
            const pair      = selectedSymbols[0] ?? activePair;
            const biasEntry = effectiveBiasArr.find(b => b.pair === pair);
            const pairRow   = pairMap[pair];
            const data      = buildPairExport(pairRow, biasEntry, {
              ...exportOpts,
              livePrice: livePrices?.[pair],
            });
            if (!data) throw new Error('No data for pair');

            filename = buildFilename('pair', pair, activeFormat);
            if (activeFormat === 'json') {
              content = JSON.stringify(data, null, 2);
              mime    = 'application/json';
            } else {
              content = pairToCSV(data);
              mime    = 'text/csv;charset=utf-8';
            }

          } else {
            // Multi-pair: one row/object per selected asset
            filename = buildFilename('multi', null, activeFormat);
            if (activeFormat === 'json') {
              const data = buildMultiPairJSON(selectedSymbols, effectiveBiasArr, effectivePairs, exportOpts);
              content = JSON.stringify(data, null, 2);
              mime    = 'application/json';
            } else {
              content = buildMultiPairCSV(selectedSymbols, effectiveBiasArr, effectivePairs, exportOpts);
              mime    = 'text/csv;charset=utf-8';
            }
          }

        // ── scope: snapshot ─────────────────────────────────────────────────
        } else if (scope === 'snapshot') {
          const snap = buildSnapshotExport(effectiveBiasArr, effectivePairs, exportOpts);
          filename = buildFilename('snapshot', null, activeFormat);
          if (activeFormat === 'json') {
            content = JSON.stringify({
              snapshot_date:   new Date().toISOString().slice(0, 10),
              export_version:  '2.0',
              ...snap,
            }, null, 2);
            mime = 'application/json';
          } else {
            content = snapshotToCSV(snap);
            mime    = 'text/csv;charset=utf-8';
          }

        // ── scope: raw ──────────────────────────────────────────────────────
        } else if (scope === 'raw') {
          const raw = buildRawExport(effectiveBiasArr, effectivePairs, exportOpts);
          filename  = buildFilename('raw', null, 'json');
          content   = JSON.stringify(raw, null, 2);
          mime      = 'application/json';

        // ── scope: visual ───────────────────────────────────────────────────
        } else if (scope === 'visual') {
          if (activeFormat === 'xlsx') {
            const result = buildXLSXExport(effectiveBiasArr, effectivePairs, exportOpts);
            const blob   = new Blob([result.data], { type: result.mime });
            const url    = URL.createObjectURL(blob);
            const a      = document.createElement('a');
            a.href = url; a.download = result.filename; a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
            setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
            setLastFilename(result.filename);
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
            return;

          } else if (activeFormat === 'pdf') {
            const success = openPDFPrint(effectiveBiasArr, effectivePairs, exportOpts);
            if (!success) throw new Error('Could not open print window. Check pop-up blocker.');
            setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
            setLastFilename('PDF via browser print');
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
            return;

          } else {
            const result = buildHTMLExport(effectiveBiasArr, effectivePairs, exportOpts);
            content  = result.data;
            filename = result.filename;
            mime     = result.mime;
          }

        // ── scope: intelligence ─────────────────────────────────────────────
        } else if (scope === 'intelligence') {
          if (activeFormat === 'telegram') {
            content  = buildTelegramBriefing(exportOpts);
            filename = buildFilename('intelligence', null, 'telegram');
            mime     = 'text/plain;charset=utf-8';
          } else {
            const intel = buildIntelligenceExport(exportOpts);
            content  = JSON.stringify(intel, null, 2);
            filename = buildFilename('intelligence', null, 'json');
            mime     = 'application/json';
          }
        }

        downloadFile(content, filename, mime);
        setLastTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
        setLastFilename(filename);
        setStatus('done');
        setTimeout(() => setStatus('idle'), 3000);

      } catch (e) {
        console.error('[ExportPanel] Export failed:', e?.message ?? e);
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3500);
      }
    }, 0);
  }, [
    scope, activeFormat, selectedSymbols, activePair,
    hasData, effectiveBiasArr, effectivePairs, exportOpts, isPremium,
    livePrices, onUpgrade, pairMap, status,
  ]);

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
            Sin datos disponibles para exportar
          </div>
          <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6, maxWidth: 380, marginInline: 'auto' }}>
            El sistema de exportación requiere datos COT cargados.
            Espera la sincronización automática del viernes o sube un archivo CFTC manualmente desde la pestaña Datos.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  const isLocked    = activeScopeMeta?.premium && !isPremium;
  const noneSelected = scope === 'pair' && selectedSymbols.length === 0;
  const btnDisabled  = !hasData || isLocked || noneSelected;

  // Count shown on button and status bar only for pair scope
  const exportCount = scope === 'pair' ? selectedSymbols.length : null;

  // Estimated file size shown only for pair scope (csv/json)
  const sizeEstimate = scope === 'pair' && ['csv', 'json'].includes(activeFormat)
    ? estimateExportSize(selectedSymbols.length, activeFormat)
    : null;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.txt, letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            Exportación de Datos Institucionales
          </h2>
          <span style={{
            fontSize: 9, fontWeight: 700, color: T.sub,
            background: T.card2, border: `1px solid ${T.border}`,
            padding: '2px 8px', borderRadius: 99, letterSpacing: '0.08em',
          }}>v2.0</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.6, maxWidth: 560 }}>
          Sistema de exportación profesional para traders avanzados. Accede y explota datos de posicionamiento institucional en CSV o JSON.
        </p>
      </div>

      {/* ── Scope selector ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.08em', marginBottom: 10 }}>
          TIPO DE EXPORTACIÓN
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

      {/* ── Multi-asset selector (only for pair scope) ── */}
      {scope === 'pair' && (
        <div style={{
          marginBottom: 16,
          padding:      '16px 20px',
          background:   T.card,
          border:       `1px solid ${T.border}`,
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.08em', marginBottom: 10 }}>
            SELECCIONAR ACTIVOS
          </div>
          <MultiAssetSelector
            assets={assetsList}
            selected={selectedSymbols}
            onChange={setSelectedSymbols}
            T={T}
            darkMode={darkMode}
          />
          {noneSelected && (
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#f59e0b' }}>
              Selecciona al menos un activo para exportar.
            </p>
          )}
        </div>
      )}

      {/* ── Options row (format + description + size estimate) ── */}
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
        {/* Format toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
            FORMATO
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

        {/* Scope description */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em', marginBottom: 5 }}>
            DESCRIPCIÓN
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
            {activeScopeMeta?.desc}
            {scope === 'raw' && !isPremium && (
              <span style={{ color: '#f59e0b', fontWeight: 600 }}> — Solo Premium.</span>
            )}
          </p>
        </div>

        {/* File size estimate (pair scope only) */}
        {sizeEstimate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.07em' }}>
              TAM. EST.
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.txt }}>
              {sizeEstimate}
            </span>
          </div>
        )}
      </div>

      {/* ── Intelligence scope: Telegram preview note ── */}
      {scope === 'intelligence' && (
        <div style={{
          padding: '14px 18px',
          background: 'rgba(167,139,250,0.06)',
          border: '1px solid rgba(167,139,250,0.25)',
          borderRadius: 10,
          marginBottom: 14,
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>📡</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 4 }}>
              Briefing de Inteligencia — Consenso de Agentes + Régimen + Intermercado
            </div>
            <p style={{ margin: 0, fontSize: 11, color: T.sub, lineHeight: 1.55 }}>
              {activeFormat === 'telegram'
                ? 'Descarga un archivo .txt optimizado para Telegram. Los marcadores en negrita usan sintaxis MarkdownV2 de Telegram. Copia el contenido y pégalo directamente en cualquier chat o canal de Telegram.'
                : 'Descarga un sobre JSON estructurado con todos los scores de agentes, estado de régimen adaptativo, salud del intermercado y señales prioritarias.'}
            </p>
            {!agentConsensus && (
              <p style={{ margin: '6px 0 0', fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
                ⚠ Consenso de agentes no disponible — sube datos COT y espera la señal macro para activar.
              </p>
            )}
          </div>
          {activeFormat === 'telegram' && agentConsensus && (
            <button
              onClick={() => {
                try {
                  const text = buildTelegramBriefing(exportOpts);
                  navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  });
                } catch (e) {
                  console.error('[Clipboard]', e);
                }
              }}
              style={{
                flexShrink: 0, padding: '6px 14px',
                background: copied ? '#22c55e22' : 'rgba(167,139,250,0.12)',
                border: `1px solid ${copied ? '#22c55e55' : 'rgba(167,139,250,0.4)'}`,
                borderRadius: 7, cursor: 'pointer',
                fontSize: 10, fontWeight: 700,
                color: copied ? '#22c55e' : '#a78bfa',
                letterSpacing: '0.05em', whiteSpace: 'nowrap',
              }}
            >
              {copied ? '✓ ¡Copiado!' : '⎘ Copiar al Portapapeles'}
            </button>
          )}
        </div>
      )}

      {/* ── Snapshot status ── */}
      <SnapshotStatus
        biasArr={effectiveBiasArr}
        fxPairs={effectivePairs}
        macroSignal={macroSignal}
        selectedCount={exportCount}
        T={T}
        darkMode={darkMode}
      />

      {/* ── Export CTA ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          {lastTime && status !== 'loading' && lastFilename && (
            <div style={{ fontSize: 11, color: T.sub }}>
              Última exportación: <span style={{ color: '#22c55e', fontWeight: 600 }}>{lastTime}</span>
              {' · '}{lastFilename}
            </div>
          )}
          {status === 'error' && (
            <div style={{ fontSize: 11, color: '#ef4444' }}>Error al exportar — intenta de nuevo o revisa los datos cargados.</div>
          )}
          {!lastTime && (
            <div style={{ fontSize: 11, color: T.sub2 }}>
              {scope === 'pair'
                ? `${selectedSymbols.length} activo${selectedSymbols.length !== 1 ? 's' : ''} seleccionado${selectedSymbols.length !== 1 ? 's' : ''} · ${activeFormat.toUpperCase()}`
                : 'Descarga métricas de posicionamiento y capas del motor.'}
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
          selectedCount={selectedSymbols.length}
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
          Todos los datos exportados reflejan el estado actual del sistema de motores de COT Tracker.
          La exportación es solo para uso analítico y no constituye asesoramiento financiero.
          Fuente: CFTC · Traders en Futuros Financieros.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em' }}>COT TRACKER</span>
          <span style={{ fontSize: 9, color: T.sub2 }}>Sistema de Exportación Institucional v2.0</span>
        </div>
      </div>
    </div>
  );
}
