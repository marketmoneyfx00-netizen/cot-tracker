import DropZone from "./DropZone.jsx";

/**
 * SourceCard — Premium import card for a single CFTC data source.
 * Symmetric, dark-mode perfect, no hardcoded colors.
 */
export default function SourceCard({
  title, subtitle, badge, accentColor = "#0055cc",
  loaded, loadedLabel, loadedSub, error,
  onViewDashboard,
  downloadUrl, downloadLabel = "Ir a CFTC.gov →", downloadNote,
  dropId, dropHint, dropLoaded, onFile,
  whatTitle = "¿Qué aporta?", whatDesc,
  badges = [], modules = [],
  darkMode, T, isMobile,
}) {
  const panelBg  = darkMode ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.018)";
  const codeBg   = darkMode ? "rgba(255,255,255,0.07)"  : "#f0f4f8";

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${loaded ? `${accentColor}55` : T.border}`,
      borderRadius: 14,
      padding: isMobile ? 14 : "20px 22px",
      marginBottom: 16,
      boxShadow: loaded ? `0 0 0 1px ${accentColor}18` : "none",
      transition: "border-color 0.3s, box-shadow 0.3s",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
        gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:accentColor,
              boxShadow:`0 0 7px ${accentColor}`, flexShrink:0 }}/>
            <span style={{ fontSize:12, fontWeight:700, color:T.txt, letterSpacing:"0.02em" }}>
              {title}
            </span>
            {badge && (
              <span style={{ fontSize:9, fontWeight:700, color:accentColor,
                background:`${accentColor}18`, border:`1px solid ${accentColor}40`,
                padding:"2px 7px", borderRadius:99, letterSpacing:"0.04em" }}>
                {badge}
              </span>
            )}
          </div>
          <p style={{ margin:0, fontSize:11, color:T.sub, lineHeight:1.5 }}>{subtitle}</p>
        </div>
        {loaded && (
          <span style={{ fontSize:10, fontWeight:700, color:accentColor,
            background:`${accentColor}15`, border:`1px solid ${accentColor}35`,
            padding:"3px 10px", borderRadius:99, flexShrink:0, whiteSpace:"nowrap" }}>
            ✓ {loadedLabel}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)",
          borderRadius:8, padding:"10px 14px", marginBottom:12,
          fontSize:11, color:"#ef4444", fontFamily:"monospace", lineHeight:1.5 }}>
          ⚠ {error}
        </div>
      )}

      {/* Success banner */}
      {loaded && (
        <div style={{ background:`${accentColor}0f`, border:`1px solid ${accentColor}30`,
          borderRadius:10, padding:"10px 14px", marginBottom:14,
          display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:16 }}>✅</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, fontWeight:700, color:accentColor }}>{loadedLabel}</div>
            {loadedSub && <div style={{ fontSize:11, color:T.sub }}>{loadedSub}</div>}
          </div>
          {onViewDashboard && (
            <button onClick={onViewDashboard} style={{
              padding:"7px 14px", borderRadius:8, border:"none", cursor:"pointer",
              background:accentColor, color:"#ffffff", fontSize:11, fontWeight:700, flexShrink:0,
            }}>
              Ver Dashboard →
            </button>
          )}
        </div>
      )}

      {/* Three columns */}
      <div style={{
        display:"grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1.5fr 1fr",
        gap:12,
      }}>
        {/* Download */}
        <div style={{ background:panelBg, border:`1px solid ${T.border}`, borderRadius:10,
          padding:14, display:"flex", flexDirection:"column", gap:8 }}>
          <p style={{ margin:0, fontSize:10, fontWeight:700, color:T.sub2,
            textTransform:"uppercase", letterSpacing:"0.07em" }}>📥 Descargar</p>
          <p style={{ margin:0, fontSize:11, color:T.sub, lineHeight:1.6, flex:1 }}>
            CFTC.gov → Traders in Financial Futures
            {downloadNote && (
              <><br/>
                <span style={{ fontFamily:"monospace", fontSize:10,
                  background:codeBg, padding:"2px 5px", borderRadius:3,
                  display:"inline-block", marginTop:3, color:T.sub }}>
                  {downloadNote}
                </span>
              </>
            )}
          </p>
          <a href={downloadUrl} target="_blank" rel="noreferrer"
            style={{ display:"block", textAlign:"center", padding:"9px", borderRadius:8,
              marginTop:"auto", background:`${accentColor}12`,
              border:`1.5px solid ${accentColor}50`,
              color:accentColor, fontSize:11, fontWeight:700, textDecoration:"none" }}>
            {downloadLabel}
          </a>
        </div>

        {/* Drop zone */}
        <DropZone
          onFile={onFile}
          darkMode={darkMode}
          id={dropId}
          label={dropLoaded ? "Reemplazar archivo" : "Seleccionar archivo CSV"}
          hint={dropHint}
          accentColor={accentColor}
        />

        {/* What it provides */}
        <div style={{ background:panelBg, border:`1px solid ${T.border}`, borderRadius:10,
          padding:14, display:"flex", flexDirection:"column", gap:6 }}>
          <p style={{ margin:0, fontSize:10, fontWeight:700, color:T.sub2,
            textTransform:"uppercase", letterSpacing:"0.07em" }}>ℹ️ {whatTitle}</p>
          {whatDesc && (
            <p style={{ margin:0, fontSize:11, color:T.sub, lineHeight:1.5 }}>{whatDesc}</p>
          )}
          {badges.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {badges.map(b => (
                <span key={b} style={{ fontSize:9, fontWeight:700, color:accentColor,
                  background:`${accentColor}15`, border:`1px solid ${accentColor}30`,
                  padding:"2px 6px", borderRadius:4 }}>{b}</span>
              ))}
            </div>
          )}
          {modules.length > 0 && (
            <div style={{ paddingTop:6, borderTop:`1px solid ${T.border}` }}>
              <p style={{ margin:"0 0 4px", fontSize:9, fontWeight:700, color:T.sub2,
                textTransform:"uppercase", letterSpacing:"0.05em" }}>Habilita</p>
              {modules.map(m => (
                <div key={m} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                  <span style={{ fontSize:7, color:"#22c55e" }}>●</span>
                  <span style={{ fontSize:10, color:T.sub }}>{m}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
