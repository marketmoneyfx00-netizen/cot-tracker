/**
 * TooltipInfo.jsx — Lightweight (i) tooltip component
 *
 * Desktop: shows on hover.
 * Mobile: shows/hides on tap. Closes on outside tap.
 *
 * ZERO layout impact: inline-flex, does not affect parent flex rows or widths.
 * No external libraries.
 *
 * CHANGES:
 * - Icon reduced ~40%: 18px → 11px
 * - Premium style: white bg, blue border, blue text, hover light-blue bg
 * - Popover changed: white bg, soft gray border, comfortable padding, max-width 280px
 * - Click to open/close (in addition to hover)
 */

import { useState, useRef, useEffect } from 'react';

/**
 * @param {string}  text        - Tooltip body text
 * @param {'left'|'right'|'center'} [align='center'] - Preferred horizontal alignment
 */
export default function TooltipInfo({ text, align = 'center' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click/tap
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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onTouchStart={(e) => { e.preventDefault(); setOpen(o => !o); }}
    >
      {/* (i) icon — 40% smaller than previous 18px */}
      <span
        aria-label="Info"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 11,
          height: 11,
          borderRadius: '50%',
          border: '1px solid #2563eb',
          fontSize: 7,
          fontWeight: 800,
          color: '#2563eb',
          background: '#ffffff',
          cursor: 'pointer',
          lineHeight: 1,
          userSelect: 'none',
          flexShrink: 0,
          marginLeft: 4,
          boxShadow: '0 1px 3px rgba(37,99,235,0.15)',
          transition: 'background 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#eff6ff';
          e.currentTarget.style.boxShadow = '0 1px 4px rgba(37,99,235,0.25)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#ffffff';
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(37,99,235,0.15)';
        }}
      >
        i
      </span>

      {/* Premium popover — white bg, soft border, comfortable padding */}
      {open && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            ...alignStyle,
            zIndex: 999,
            width: 280,
            maxWidth: '80vw',
            background: '#ffffff',
            color: '#374151',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.6,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
            pointerEvents: 'none',
            whiteSpace: 'normal',
            letterSpacing: '0.01em',
            fontFamily: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
          }}
        >
          {text}
          {/* Caret */}
          <span style={{
            position: 'absolute',
            bottom: -6,
            left: align === 'left' ? 10 : align === 'right' ? 'auto' : '50%',
            right: align === 'right' ? 10 : 'auto',
            transform: align === 'center' ? 'translateX(-50%)' : 'none',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #e5e7eb',
          }}/>
          {/* Inner caret (white fill) */}
          <span style={{
            position: 'absolute',
            bottom: -5,
            left: align === 'left' ? 10 : align === 'right' ? 'auto' : '50%',
            right: align === 'right' ? 10 : 'auto',
            transform: align === 'center' ? 'translateX(-50%)' : 'none',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #ffffff',
          }}/>
        </span>
      )}
    </span>
  );
}
