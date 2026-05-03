/**
 * TooltipInfo.jsx — Portal-based tooltip
 *
 * Renders via createPortal → document.body, completely outside the DOM tree.
 * Uses position:fixed + getBoundingClientRect() — immune to overflow:hidden,
 * stacking contexts, transforms, or any ancestor layout constraint.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function TooltipInfo({ text, align = 'center' }) {
  const [open, setOpen]   = useState(false);
  const [pos,  setPos]    = useState({ top: 0, left: 0 });
  const iconRef = useRef(null);

  // Recalculate position every time the tooltip opens
  const updatePos = () => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  };

  // Close on outside click/tap
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (iconRef.current && !iconRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePos();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const handleMouseEnter = () => { updatePos(); setOpen(true); };
  const handleMouseLeave = () => setOpen(false);
  const handleTouch      = (e) => { e.preventDefault(); updatePos(); setOpen(o => !o); };
  const handleClick      = () => { updatePos(); setOpen(o => !o); };

  // Clamp left so tooltip never overflows viewport right edge
  const TOOLTIP_W = 260;
  const clampedLeft = Math.min(
    pos.left,
    (typeof window !== 'undefined' ? window.innerWidth : 800) - TOOLTIP_W - 12
  );

  const tooltip = open ? createPortal(
    <div
      style={{
        position:    'fixed',
        top:         pos.top,
        left:        clampedLeft,
        zIndex:      99999,
        width:       TOOLTIP_W,
        maxWidth:    'calc(100vw - 24px)',
        background:  '#ffffff',
        color:       '#111827',
        fontSize:    12,
        lineHeight:  1.5,
        padding:     '8px 10px',
        borderRadius: 6,
        border:      '1px solid rgba(0,0,0,0.08)',
        boxShadow:   '0 8px 20px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08)',
        pointerEvents: 'none',
        whiteSpace:  'normal',
        wordBreak:   'break-word',
        letterSpacing: '0.01em',
        fontFamily:  "-apple-system,'SF Pro Text',Helvetica,sans-serif",
      }}
    >
      {text}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <span
        ref={iconRef}
        aria-label="Info"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouch}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          13,
          height:         13,
          borderRadius:   '50%',
          border:         '1px solid #2563eb',
          fontSize:       8,
          fontWeight:     800,
          color:          '#2563eb',
          background:     '#ffffff',
          cursor:         'pointer',
          lineHeight:     1,
          userSelect:     'none',
          flexShrink:     0,
          marginLeft:     6,
          verticalAlign:  'middle',
          boxShadow:      '0 1px 3px rgba(37,99,235,0.15)',
          transition:     'background 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => {
          handleMouseEnter();
          e.currentTarget.style.background  = '#eff6ff';
          e.currentTarget.style.boxShadow   = '0 1px 4px rgba(37,99,235,0.25)';
        }}
        onMouseLeave={e => {
          handleMouseLeave();
          e.currentTarget.style.background  = '#ffffff';
          e.currentTarget.style.boxShadow   = '0 1px 3px rgba(37,99,235,0.15)';
        }}
      >
        i
      </span>
      {tooltip}
    </>
  );
}
