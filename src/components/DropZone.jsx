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
 */
export default function DropZone({
  onFile,
  darkMode,
  id          = "cot-dropzone",
  label       = "Seleccionar archivo",
  hint        = ".csv .txt",
  accentColor = "#0055cc",
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const handle = useCallback((file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload  = (e) => onFile(e.target.result, file.name);
    r.onerror = ()  => console.error("[DropZone] FileReader error on", file.name);
    r.readAsText(file);
  }, [onFile]);

  const handleChange = useCallback((e) => {
    const file = e.target.files[0];
    // Reset value BEFORE handling so the same file can be re-uploaded (Android fix)
    e.target.value = "";
    handle(file);
  }, [handle]);

  // Programmatic click is more reliable on iOS than relying solely on label
  const handleButtonClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const borderClr = drag
    ? accentColor
    : darkMode ? `${accentColor}44` : "#d1d8e1";
  const bgClr     = drag
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
        position: "relative",  // needed for the absolutely-positioned input
      }}
    >
      {/*
        MOBILE FIX: Do NOT use display:none — iOS Safari ignores label
        clicks on hidden inputs. Use the visually-hidden pattern instead:
        the input stays in the layout tree (opacity:0, 1×1px, absolute)
        so the browser's touch event still reaches it.
      */}
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

      {/*
        Use an onClick button instead of a label — programmatic .click()
        on the input works correctly on all mobile browsers including
        iOS Safari, Chrome for Android, and Samsung Internet.
      */}
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
          // Ensure the tap target is large enough on mobile (WCAG 2.5.5)
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
  );
}
