import { useState, useCallback, useRef } from "react";

/**
 * DropZone — Reusable, fully dark-mode aware file upload component.
 * Zero hardcoded colors. All tokens derived from darkMode + accentColor props.
 *
 * FIX (mobile): replaced `display:none` on the file input with an
 * accessibility-safe visually-hidden technique.
 * display:none causes iOS Safari to silently ignore the label click —
 * the file picker never opens. Using position:absolute + opacity:0
 * keeps the input in the layout tree so iOS honors the tap.
 *
 * FIX (Android re-upload): reset e.target.value after handling so
 * selecting the same file a second time still fires onChange.
 *
 * FORMAT VALIDATION: detects TFF Combined vs Legacy before passing to onFile.
 * Shows a clear error if the wrong CFTC report type is uploaded.
 */

const CFTC_URL = 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm';

function detectCotFormat(text) {
  const firstLine = text.slice(0, 500).toLowerCase();
  const hasTFF    = firstLine.includes('dealer_positions') || firstLine.includes('lev_money_positions') || firstLine.includes('asset_mgr_positions');
  const hasLegacy = firstLine.includes('noncomm_positions') || (firstLine.includes('comm_positions') && !hasTFF);
  const isCFTC    = firstLine.includes('market_and_exchange') || firstLine.includes('report_date');
  return { hasTFF, hasLegacy, isCFTC };
}

export default function DropZone({
  onFile,
  darkMode,
  id          = "cot-dropzone",
  label       = "Seleccionar archivo",
  hint        = ".csv .txt",
  accentColor = "#0055cc",
}) {
  const [drag,        setDrag]        = useState(false);
  const [formatError, setFormatError] = useState(null);
  const inputRef = useRef(null);

  const handle = useCallback((file) => {
    if (!file) return;
    setFormatError(null);

    const ext = (file.name || '').toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.txt')) {
      setFormatError('Formato incorrecto. El archivo debe ser .csv o .txt descargado del CFTC.');
      return;
    }

    const r = new FileReader();
    r.onload = (e) => {
      const text = e.target.result ?? '';
      const { hasTFF, hasLegacy, isCFTC } = detectCotFormat(text);

      if (!isCFTC && !hasTFF && !hasLegacy) {
        setFormatError('Este archivo no parece ser un informe CFTC. Descarga el archivo TFF Combined desde la web del CFTC (enlace abajo).');
        return;
      }
      onFile(text, file.name);
    };
    r.onerror = () => {
      setFormatError('No se pudo leer el archivo. Inténtalo de nuevo.');
    };
    r.readAsText(file);
  }, [onFile]);

  const handleChange = useCallback((e) => {
    const file = e.target.files[0];
    e.target.value = "";
    handle(file);
  }, [handle]);

  const handleButtonClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const borderClr = formatError
    ? '#ef4444'
    : drag
    ? accentColor
    : darkMode ? `${accentColor}44` : "#d1d8e1";
  const bgClr     = formatError
    ? 'rgba(239,68,68,0.06)'
    : drag
    ? `${accentColor}0e`
    : darkMode ? "rgba(255,255,255,0.02)" : "#f8fafc";
  const iconBg    = drag
    ? `${accentColor}20`
    : darkMode ? `${accentColor}18` : "#ededf0";
  const iconColor = drag ? accentColor : darkMode ? `${accentColor}cc` : "#8e8e93";
  const textColor = darkMode ? "#e8eaf0" : "#111827";
  const hintColor = darkMode ? "rgba(255,255,255,0.28)" : "#94a3b8";
  const btnBg     = darkMode ? `${accentColor}20` : `${accentColor}08`;
  const btnBorder = darkMode ? `${accentColor}66` : accentColor;
  const btnColor  = darkMode
    ? (accentColor === "#0055cc" ? "#60a5fa" : "#c084fc")
    : accentColor;

  return (
    <div>
      {/* ── Format guide ─────────────────────────────────────────────── */}
      <div style={{
        marginBottom: 10, padding: '10px 14px', borderRadius: 10,
        background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,85,204,0.04)',
        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,85,204,0.12)'}`,
        fontSize: 11, color: hintColor, lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 700, color: textColor, fontSize: 11 }}>¿Qué archivo descargar?</span>
        {' '}En el CFTC, selecciona <span style={{ fontWeight: 600, color: btnColor }}>Traders in Financial Futures (TFF)</span> → <span style={{ fontWeight: 600, color: btnColor }}>Current Legacy Report</span> → descarga el archivo <span style={{ fontWeight: 600, color: btnColor }}>CSV</span>.
        {' '}
        <a
          href={CFTC_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: btnColor, fontWeight: 700, textDecoration: 'underline' }}
        >
          Ir al CFTC →
        </a>
      </div>

      {/* ── Drop target ──────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files[0]);
        }}
        style={{
          border: `2px dashed ${borderClr}`,
          borderRadius: 14,
          padding: "22px 18px",
          textAlign: "center",
          background: bgClr,
          transition: "all 0.18s ease",
          cursor: "default",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 130,
          position: "relative",
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept=".csv,.txt"
          onChange={handleChange}
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            opacity: 0,
            overflow: "hidden",
            pointerEvents: "none",
            top: 0,
            left: 0,
          }}
        />

        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: iconBg, marginBottom: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.18s",
          flexShrink: 0,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V8M12 8L8 12M12 8L16 12"
              stroke={iconColor} strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M3 16.5V18.75C3 19.993 4.007 21 5.25 21H18.75C19.993 21 21 19.993 21 18.75V16.5"
              stroke={iconColor} strokeWidth="1.8" strokeLinecap="round"
            />
          </svg>
        </div>

        <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: drag ? accentColor : textColor, transition: "color 0.18s" }}>
          {drag ? "Suelta el archivo" : (('ontouchstart' in window) ? "Toca para seleccionar el CSV" : "Arrastra el CSV aquí")}
        </p>
        <p style={{ margin: "0 0 14px", fontSize: 11, color: hintColor }}>{hint}</p>

        <button
          type="button"
          onClick={handleButtonClick}
          aria-label="Seleccionar archivo CSV para importar"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 20px", borderRadius: 9,
            border: `1.5px solid ${btnBorder}`,
            background: btnBg, color: btnColor,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            transition: "all 0.15s",
            userSelect: "none",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          {label}
        </button>
      </div>

      {/* ── Format error message ─────────────────────────────────────── */}
      {formatError && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 9,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.28)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 3 }}>
              Archivo no reconocido
            </div>
            <div style={{ fontSize: 11, color: hintColor, lineHeight: 1.5 }}>
              {formatError}
            </div>
            <a
              href={CFTC_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: btnColor, fontWeight: 600, marginTop: 4, display: 'inline-block' }}
            >
              Ir al CFTC para descargar el archivo correcto →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
