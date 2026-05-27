/**
 * InstitutionalMicro.jsx — Shared micro-components for institutional panels.
 *
 * Single source of truth for repeated primitives used across:
 *   InstitutionalIntelligencePanel, AdaptiveRegimePanel,
 *   CryptoIntelligencePanel, MarketBriefingPanel.
 *
 * Keep this file FLAT — no state, no hooks, no side effects.
 * Every component here is a pure render function.
 */

// ─── LABEL ────────────────────────────────────────────────────────────────────
/** Uppercase section label — small, subdued, all-caps. */
export function Label({ children, T, style = {} }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: T.sub, ...style,
    }}>
      {children}
    </span>
  );
}

// ─── CHIP ─────────────────────────────────────────────────────────────────────
/** Rounded pill badge with color-coded border + tinted background. */
export function Chip({ label, color, size = 'sm', style = {} }) {
  const big = size === 'lg';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: big ? 11 : 9, fontWeight: 700,
      letterSpacing: '0.07em',
      color,
      background: color + '18',
      border: `1px solid ${color}44`,
      padding: big ? '4px 12px' : '2px 8px',
      borderRadius: 99,
      ...style,
    }}>
      {label}
    </span>
  );
}

// ─── SCORE BAR ────────────────────────────────────────────────────────────────
/** Thin colored progress bar (0–100). */
export function ScoreBar({ score, color, T }) {
  return (
    <div style={{ height: 3, borderRadius: 2, background: T.border, overflow: 'hidden', marginTop: 4 }}>
      <div style={{
        height: '100%', width: `${Math.min(100, Math.max(0, score ?? 0))}%`,
        background: color, borderRadius: 2,
        transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </div>
  );
}

// ─── SIGNAL ROW ───────────────────────────────────────────────────────────────
/** Single signal line with tinted background and icon prefix. */
export function SignalRow({ icon, text, color, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 10px',
      background: color + '08',
      border: `1px solid ${color}22`,
      borderRadius: 6,
    }}>
      <span style={{ color, fontSize: 10, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ fontSize: 11, color: T.txt, lineHeight: 1.55 }}>{text}</span>
    </div>
  );
}

// ─── SIGNAL LIST ─────────────────────────────────────────────────────────────
/** Bullet list of signal strings. */
export function SignalList({ items, color, T }) {
  if (!items?.length) return null;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {items.map((s, i) => (
        <li key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          fontSize: 11, color: T.sub, lineHeight: 1.5, paddingBottom: 3,
        }}>
          <span style={{ color, flexShrink: 0, marginTop: 2, fontSize: 8 }}>◆</span>
          {s}
        </li>
      ))}
    </ul>
  );
}

// ─── DOT ──────────────────────────────────────────────────────────────────────
/** Small colored dot indicator. */
export function Dot({ color, pulse = false }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: pulse ? `0 0 6px ${color}` : 'none',
    }} />
  );
}

// ─── VERDICT CARD ─────────────────────────────────────────────────────────────
/** Institutional assessment card — answers a binary yes/no/mixed question. */
export function VerdictCard({ question, answer, detail, color, T }) {
  return (
    <div style={{
      background: color + '08',
      border: `1px solid ${color}30`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 7, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.sub, letterSpacing: '0.09em', marginBottom: 4 }}>
        {question}
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.03em', marginBottom: 3 }}>
        {answer}
      </div>
      {detail && (
        <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.5 }}>{detail}</div>
      )}
    </div>
  );
}
