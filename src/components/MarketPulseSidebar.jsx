/**
 * MarketPulseSidebar.jsx — Market Pulse AI lateral panel
 *
 * Phase 3: static mock data. No API calls. Design-only.
 * Future: replace PULSE_ITEMS with live feed from /api/pulse or similar.
 *
 * Props:
 *   darkMode  {boolean}
 *   T         {object}  — theme tokens from parent
 *   isMobile  {boolean} — hides on mobile (parent wraps in conditional)
 */

const PULSE_ITEMS = [
  {
    id: 1,
    headline: "Fed mantiene tipos sin cambios, Powell señala recortes tardíos",
    score: 8,
    scoreLabel: "ALTA",
    scoreColor: "#ef4444",
    direction: "hawkish",
    ts: "Hace 2h",
    assets: [
      { name: "DXY",     dir: "up"   },
      { name: "EUR/USD", dir: "down" },
      { name: "GOLD",    dir: "down" },
    ],
  },
  {
    id: 2,
    headline: "Nóminas ADP superan consenso: 246K vs 190K esperado",
    score: 7,
    scoreLabel: "ALTA",
    scoreColor: "#f97316",
    direction: "bullish-usd",
    ts: "Hace 3h",
    assets: [
      { name: "DXY",     dir: "up"   },
      { name: "GBP/USD", dir: "down" },
      { name: "NAS100",  dir: "up"   },
    ],
  },
  {
    id: 3,
    headline: "BCE modera tono hawkish ante debilidad del PMI europeo",
    score: 6,
    scoreLabel: "MEDIA",
    scoreColor: "#f59e0b",
    direction: "bearish-eur",
    ts: "Hace 5h",
    assets: [
      { name: "EUR/USD", dir: "down" },
      { name: "EUR/GBP", dir: "down" },
    ],
  },
  {
    id: 4,
    headline: "China publica IPC por debajo del consenso: riesgo desinflación",
    score: 5,
    scoreLabel: "MEDIA",
    scoreColor: "#f59e0b",
    direction: "risk-off",
    ts: "Hace 7h",
    assets: [
      { name: "AUD/USD", dir: "down" },
      { name: "GOLD",    dir: "up"   },
      { name: "NZD/USD", dir: "down" },
    ],
  },
  {
    id: 5,
    headline: "BoJ mantiene YCC sin cambios, yen bajo presión vendedora",
    score: 4,
    scoreLabel: "BAJA",
    scoreColor: "#22c55e",
    direction: "bearish-jpy",
    ts: "Hace 9h",
    assets: [
      { name: "USD/JPY", dir: "up"   },
    ],
  },
];

function DirArrow({ dir }) {
  const up   = dir === "up";
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      color: up ? "#22c55e" : "#ef4444",
      lineHeight: 1,
    }}>
      {up ? "↑" : "↓"}
    </span>
  );
}

function PulseCard({ item, darkMode, T }) {
  const sub2 = T.sub2 ?? T.sub;
  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: 10,
      background: darkMode ? "rgba(255,255,255,0.03)" : "#f9fafb",
      border: `1px solid ${T.border}`,
      marginBottom: 8,
    }}>
      {/* Score badge + timestamp */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: item.scoreColor,
          background: `${item.scoreColor}18`,
          border: `1px solid ${item.scoreColor}35`,
          padding: "2px 7px",
          borderRadius: 99,
          letterSpacing: "0.05em",
        }}>
          {item.scoreLabel} · {item.score}/10
        </span>
        <span style={{ fontSize: 9, color: sub2 }}>{item.ts}</span>
      </div>

      {/* Headline */}
      <p style={{
        margin: "0 0 8px",
        fontSize: 11,
        fontWeight: 600,
        color: T.txt,
        lineHeight: 1.5,
        letterSpacing: "-0.1px",
      }}>
        {item.headline}
      </p>

      {/* Affected assets */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {item.assets.map((a) => (
          <span key={a.name} style={{
            fontSize: 9,
            fontWeight: 700,
            color: T.sub,
            background: darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            padding: "2px 6px",
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            letterSpacing: "0.03em",
          }}>
            {a.name} <DirArrow dir={a.dir} />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MarketPulseSidebar({ darkMode, T }) {
  const sub2 = T.sub2 ?? T.sub;

  return (
    <div style={{
      width: "100%",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
        paddingBottom: 10,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 6px #22c55e",
            animation: "nowPulse 2s ease infinite",
            flexShrink: 0,
          }}/>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: T.txt,
            letterSpacing: "0.08em",
          }}>MARKET PULSE</span>
        </div>
        <span style={{
          fontSize: 9,
          color: sub2,
          background: darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
          border: `1px solid ${T.border}`,
          padding: "2px 7px",
          borderRadius: 99,
          letterSpacing: "0.05em",
        }}>LIVE</span>
      </div>

      {/* Section label */}
      <div style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: sub2, fontWeight: 600, letterSpacing: "0.08em" }}>
          FLUJO MACRO · IMPACTO EN ACTIVOS
        </span>
      </div>

      {/* Feed */}
      <div>
        {PULSE_ITEMS.map((item) => (
          <PulseCard key={item.id} item={item} darkMode={darkMode} T={T} />
        ))}
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: 4,
        padding: "8px 10px",
        borderRadius: 8,
        background: darkMode ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.018)",
        border: `1px solid ${T.border}`,
      }}>
        <p style={{ margin: 0, fontSize: 9, color: sub2, lineHeight: 1.55 }}>
          📡 Feed contextual. No genera señales de entrada. Solo referencia de flujo macro institucional.
        </p>
      </div>
    </div>
  );
}
