/**
 * MarketPulsePanel.jsx — Market Pulse Live Feed v3
 *
 * Full-width carousel with overlay arrow nav.
 * Arrows float over the track, vertically centered.
 * Scrollbar hidden cross-browser.
 */

import { useState, useEffect, useRef } from 'react';

// ─── Asset badge ─────────────────────────────────────────────────────────────
function AssetTag({ asset, darkMode, T }) {
  const { name, dir } = asset;
  const color  = dir === 'up'   ? '#22c55e'
               : dir === 'down' ? '#ef4444'
               : (T.sub2 ?? T.sub);
  const arrow  = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '';
  const bg     = dir === 'up'   ? 'rgba(34,197,94,0.10)'
               : dir === 'down' ? 'rgba(239,68,68,0.10)'
               : (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
  const border = dir === 'up'   ? 'rgba(34,197,94,0.30)'
               : dir === 'down' ? 'rgba(239,68,68,0.25)'
               : T.border;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color,
      background: bg, border: `1px solid ${border}`,
      borderRadius: 4, padding: '2px 6px',
      whiteSpace: 'nowrap', letterSpacing: '0.03em',
      display: 'inline-flex', alignItems: 'center', gap: 2,
    }}>
      {name}{arrow && <span style={{ fontSize: 8, lineHeight: 1 }}>{arrow}</span>}
    </span>
  );
}

// ─── News card ────────────────────────────────────────────────────────────────
function PulseCard({ item, darkMode, T }) {
  const sub2 = T.sub2 ?? T.sub;
  return (
    <div
      style={{
        width: 242,
        flexShrink: 0,
        padding: '11px 13px',
        borderRadius: 12,
        background: darkMode ? 'rgba(255,255,255,0.03)' : '#ffffff',
        border: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', gap: 7,
        cursor: item.link ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        boxSizing: 'border-box',
      }}
      onClick={() => item.link && window.open(item.link, '_blank', 'noopener')}
      onMouseEnter={e => { if (item.link) e.currentTarget.style.borderColor = item.color + '60'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
    >
      {/* Badge + timestamp */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: item.color,
          background: `${item.color}18`, border: `1px solid ${item.color}35`,
          padding: '2px 7px', borderRadius: 99, letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}>
          {item.label} {item.score}/10
        </span>
        <span style={{ fontSize: 9, color: sub2, flexShrink: 0, marginLeft: 6 }}>{item.tsRelative}</span>
      </div>

      {/* Headline */}
      <p style={{
        margin: 0, fontSize: 11, fontWeight: 600, color: T.txt,
        lineHeight: 1.5, letterSpacing: '-0.1px',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.headline}
      </p>

      {/* Assets + source */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {(item.assets || []).map((a, i) => (
          <AssetTag key={i} asset={a} darkMode={darkMode} T={T}/>
        ))}
        {item.source && (
          <span style={{ marginLeft: 'auto', fontSize: 8, color: sub2, opacity: 0.6 }}>
            {item.source}{item.link ? ' ↗' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function SkeletonCard({ darkMode, T }) {
  const bg = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={{
      width: 242, flexShrink: 0,
      padding: '11px 13px', borderRadius: 12,
      background: darkMode ? 'rgba(255,255,255,0.02)' : '#fafafa',
      border: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', gap: 9, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ width: 58, height: 16, borderRadius: 99, background: bg }}/>
        <div style={{ width: 34, height: 16, borderRadius: 99, background: bg, marginLeft: 'auto' }}/>
      </div>
      <div style={{ width: '90%', height: 9, borderRadius: 3, background: bg }}/>
      <div style={{ width: '75%', height: 9, borderRadius: 3, background: bg }}/>
      <div style={{ width: '55%', height: 9, borderRadius: 3, background: bg }}/>
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ width: 38, height: 14, borderRadius: 4, background: bg }}/>
        <div style={{ width: 46, height: 14, borderRadius: 4, background: bg }}/>
      </div>
    </div>
  );
}

// ─── Overlay arrow button ─────────────────────────────────────────────────────
function OverlayArrow({ dir, onClick, visible, darkMode }) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute',
        top: '50%',
        [dir === 'left' ? 'left' : 'right']: 0,
        transform: 'translateY(-50%)',
        zIndex: 10,
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: darkMode ? 'rgba(30,32,40,0.92)' : 'rgba(255,255,255,0.95)',
        color: darkMode ? '#e8eaf0' : '#1a1d23',
        boxShadow: darkMode
          ? '0 2px 12px rgba(0,0,0,0.55)'
          : '0 2px 10px rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1,
        transition: 'opacity 0.15s, transform 0.15s',
        opacity: 0.9,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; }}
    >
      {dir === 'left' ? '‹' : '›'}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MarketPulsePanel({ darkMode, T, isMobile }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [lastTs,  setLastTs]  = useState(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight,setCanRight]= useState(true);
  const scrollRef = useRef(null);
  const sub2 = T.sub2 ?? T.sub;

  const fetchPulse = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/pulse');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      setLastTs(Date.now());
    } catch (e) {
      console.warn('[pulse]', e.message);
      setError('No se pudo cargar el feed. Reintentando en 5 min.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPulse(false); }, []);
  useEffect(() => {
    const id = setInterval(() => fetchPulse(true), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 6);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 6);
  };

  useEffect(() => {
    // Re-check after content loads
    setTimeout(updateArrows, 100);
  }, [items, loading]);

  const scroll = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -264 : 264, behavior: 'smooth' });
    setTimeout(updateArrows, 380);
  };

  const showArrows = !isMobile && !loading && !error && items.length > 0;

  return (
    <div style={{ marginBottom: 18 }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#22c55e', boxShadow: '0 0 6px #22c55e',
            animation: 'nowPulse 2s ease infinite', flexShrink: 0,
          }}/>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.txt, letterSpacing: '0.08em' }}>
            NOTICIAS RELEVANTES
          </span>
          <span style={{ width: 1, height: 12, background: T.border, display: 'inline-block', flexShrink: 0 }}/>
          <span style={{ fontSize: 9, color: sub2, letterSpacing: '0.05em', fontWeight: 500 }}>
            MACRO · FX · ÍNDICES · ORO
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {lastTs && (
            <span style={{ fontSize: 9, color: sub2 }}>
              {new Date(lastTs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => fetchPulse(false)}
            disabled={loading}
            style={{
              background: 'none', border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '3px 8px', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 9, color: sub2, fontWeight: 600, letterSpacing: '0.04em',
              opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s',
            }}
          >
            {loading ? '···' : '↺'}
          </button>
        </div>
      </div>

      {/* ── Carousel track with overlay arrows ── */}
      <div style={{ position: 'relative' }}>
        {/* Left gradient fade + arrow */}
        {showArrows && canLeft && (
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 40,
            background: darkMode
              ? 'linear-gradient(to right, rgba(22,24,28,0.9), transparent)'
              : 'linear-gradient(to right, rgba(240,242,245,0.9), transparent)',
            zIndex: 9, pointerEvents: 'none', borderRadius: '12px 0 0 12px',
          }}/>
        )}
        <OverlayArrow dir="left"  onClick={() => scroll('left')}  visible={showArrows && canLeft}  darkMode={darkMode}/>

        {/* Right gradient fade + arrow */}
        {showArrows && canRight && (
          <div style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
            background: darkMode
              ? 'linear-gradient(to left, rgba(22,24,28,0.9), transparent)'
              : 'linear-gradient(to left, rgba(240,242,245,0.9), transparent)',
            zIndex: 9, pointerEvents: 'none', borderRadius: '0 12px 12px 0',
          }}/>
        )}
        <OverlayArrow dir="right" onClick={() => scroll('right')} visible={showArrows && canRight} darkMode={darkMode}/>

        {/* Scrollable track */}
        {error ? (
          <div style={{
            padding: '10px 14px', borderRadius: 10, fontSize: 11, color: '#ef4444',
            background: darkMode ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.18)',
          }}>
            {error}
          </div>
        ) : (
          <>
            {/* Webkit scrollbar hide — requires className on the element */}
            <style>{`
              .pulse-track::-webkit-scrollbar { display: none; }
              .pulse-track { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
            <div
              ref={scrollRef}
              className="pulse-track"
              onScroll={updateArrows}
              style={{
                display: 'flex',
                gap: 10,
                overflowX: 'auto',
                overflowY: 'hidden',
                paddingBottom: 2,
                WebkitOverflowScrolling: 'touch',
                // Indent slightly so overlay arrows don't cover first/last card
                paddingLeft: showArrows && canLeft ? 8 : 0,
                paddingRight: showArrows && canRight ? 8 : 0,
              }}
            >
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonCard key={i} darkMode={darkMode} T={T}/>
                  ))
                : items.length === 0
                ? (
                  <span style={{ fontSize: 11, color: sub2, padding: '8px 4px' }}>
                    Sin noticias macro disponibles. El feed se actualiza cada 5 min.
                  </span>
                )
                : items.map(item => (
                    <PulseCard key={item.id} item={item} darkMode={darkMode} T={T}/>
                  ))
              }
            </div>
          </>
        )}
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 6, fontSize: 9, color: sub2, opacity: 0.5, letterSpacing: '0.02em' }}>
        📡 Solo contexto institucional. No constituye señal de entrada.
        {!loading && items.length > 0 && ` · ${items.length} artículos`}
      </div>
    </div>
  );
}
