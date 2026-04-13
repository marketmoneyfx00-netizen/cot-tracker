/**
 * TooltipInfo.jsx — Lightweight (i) tooltip component
 *
 * Desktop: shows on hover.
 * Mobile: shows/hides on tap. Closes on outside tap.
 *
 * ZERO layout impact: inline-flex, does not affect parent flex rows or widths.
 * No external libraries.
 */

import { useState, useRef, useEffect } from 'react';

/**
 * @param {string}  text        - Tooltip body text
 * @param {'left'|'right'|'center'} [align='center'] - Preferred horizontal alignment
 */
export default function TooltipInfo({ text, align = 'center' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside tap (mobile)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const alignStyle = {
    left:   { left: 0, transform: 'none' },
    right:  { right: 0, transform: 'none' },
    center: { left: '50%', transform: 'translateX(-50%)' },
  }[align] || { left: '50%', transform: 'translateX(-50%)' };

  return (
    <span
      ref={ref}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
        verticalAlign: 'middle',
        marginLeft: 4,
        flexShrink: 0,
      }}
      // Desktop hover
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Mobile tap toggle
      onTouchStart={(e) => { e.preventDefault(); setOpen(o => !o); }}
    >
      {/* (i) icon */}
      <span
        aria-label="Info"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1.5px solid #2563eb',
            fontSize: 11,
            fontWeight: 900,
            color: '#2563eb',
            opacity: 1,
            background: '#ffffff',
            cursor: 'help',
            lineHeight: 1,
            userSelect: 'none',
            flexShrink: 0,
            marginLeft: 6,
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            transition: 'opacity 0.15s'
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.45')}
      >
        i
      </span>

      {/* Tooltip bubble */}
      {open && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            ...alignStyle,
            zIndex: 999,
            width: 220,
            background: 'rgba(20,22,28,0.97)',
            color: '#e2e8f0',
            fontSize: 11,
            fontWeight: 400,
            lineHeight: 1.55,
            padding: '8px 10px',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            whiteSpace: 'normal',
            letterSpacing: 0,
            fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
            // Prevent tooltip from clipping at viewport edges in most cases
            maxWidth: '80vw',
          }}
        >
          {text}
          {/* Caret */}
          <span style={{
            position: 'absolute',
            bottom: -5,
            left: align === 'left' ? 10 : align === 'right' ? 'auto' : '50%',
            right: align === 'right' ? 10 : 'auto',
            transform: align === 'center' ? 'translateX(-50%)' : 'none',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid rgba(20,22,28,0.97)',
          }}/>
        </span>
      )}
    </span>
  );
}
