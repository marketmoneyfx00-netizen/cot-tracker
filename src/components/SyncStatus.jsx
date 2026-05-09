export default function SyncStatus({ lastSync, pairsData, combinedData, darkMode, T }) {
  const { at, status, reportDate, errorMessage } = lastSync || {};

  const relativeTime = (isoStr) => {
    if (!isoStr) return null;
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60)    return 'hace menos de 1 min';
    if (diff < 3600)  return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    return `hace ${Math.floor(diff / 86400)} dia${Math.floor(diff / 86400) > 1 ? 's' : ''}`;
  };

  const nextFriday = () => {
    const now = new Date();
    const day = now.getUTCDay();
    const daysUntilFriday = day <= 5 ? 5 - day : 7 - day + 5;
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday));
    next.setUTCHours(22, 0, 0, 0);
    return next.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + ' a las 22:00 UTC';
  };

  const statusConfig = {
    completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)',   icon: '✓', label: 'Completado' },
    running:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)',  icon: '⟳', label: 'En curso...' },
    failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)',   icon: '✕', label: 'Error' },
    skipped:   { color: '#8e8e93', bg: 'rgba(142,142,147,0.1)', border: 'rgba(142,142,147,0.2)', icon: '–', label: 'Sin cambios' },
    never:     { color: '#8e8e93', bg: 'rgba(142,142,147,0.1)', border: 'rgba(142,142,147,0.2)', icon: '–', label: 'Pendiente' },
  };
  const cfg = statusConfig[status] || statusConfig.never;
  const textColor = T?.txt    || '#1c1c1e';
  const subColor  = T?.sub    || '#8e8e93';
  const cardBg    = T?.card   || 'white';
  const borderCol = T?.border || '#e5e5ea';

  const Chip = ({ label, value, sub }) => (
    <div style={{
      background: darkMode ? 'rgba(255,255,255,0.05)' : '#f9f9fb',
      border: `1px solid ${borderCol}`,
      borderRadius: 12,
      padding: '14px 18px',
      flex: 1,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: subColor, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: textColor, marginBottom: sub ? 2 : 0 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: textColor, letterSpacing: '-0.2px' }}>
          Sincronizacion Automatica COT
        </h2>
        <p style={{ margin: 0, fontSize: 11, color: subColor }}>
          Los reportes CFTC se descargan automaticamente cada viernes. Sin accion requerida.
        </p>
      </div>

      <div style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: cfg.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: 'white', fontWeight: 700, flexShrink: 0,
        }}>
          {cfg.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color, marginBottom: 2 }}>
            {status === 'completed' && 'Sincronizacion automatica activa'}
            {status === 'running'   && 'Sincronizacion en curso...'}
            {status === 'failed'    && 'Error en ultima sincronizacion'}
            {(status === 'skipped' || status === 'never' || !status) && 'Sincronizacion automatica configurada'}
          </div>
          <div style={{ fontSize: 12, color: subColor }}>
            {at ? `Ultimo sync ${relativeTime(at)}` : 'Pendiente del primer sync automatico (cada viernes 22:00 UTC)'}
            {status === 'failed' && errorMessage && ` - ${errorMessage}`}
          </div>
        </div>
        <div style={{
          padding: '4px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700,
          background: cfg.color, color: 'white',
        }}>
          {cfg.label}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Chip
          label="Reporte activo"
          value={reportDate || '—'}
          sub={reportDate ? 'Fecha del ultimo informe CFTC' : 'Sin datos aun'}
        />
        <Chip
          label="Futuros Only"
          value={pairsData ? `${pairsData.length} pares` : '—'}
          sub={pairsData ? 'Bias Engine - Tabla FX - Intraday' : 'Sin datos aun'}
        />
        <Chip
          label="Combined (FX+Indices+Bonos)"
          value={combinedData ? `${combinedData.assetCount} activos` : '—'}
          sub={combinedData ? 'Cross Asset Flow activo' : 'Sin datos aun'}
        />
        <Chip
          label="Proxima comprobacion"
          value="Cada viernes"
          sub={`22:00 UTC - ${nextFriday()}`}
        />
      </div>

      <div style={{
        background: cardBg,
        border: `1px solid ${borderCol}`,
        borderRadius: 14,
        padding: '20px 24px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: textColor, marginBottom: 12 }}>
          Como funciona?
        </div>
        {[
          ['🕙', 'Descarga automatica', 'Cada viernes a las 22:00 UTC el sistema descarga los dos reportes TFF del CFTC automaticamente.'],
          ['🔍', 'Validacion idempotente', 'Si el reporte ya existe en la base de datos, se ignora. No hay duplicados.'],
          ['📊', 'Disponible al instante', 'Los datos aparecen en el dashboard en cuanto abres la app. Sin descargas manuales.'],
          ['🔒', 'Fuente oficial', 'Los archivos vienen directamente de cftc.gov - la misma fuente que antes, ahora automatizada.'],
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: textColor, marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 11, color: subColor, lineHeight: 1.5 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
