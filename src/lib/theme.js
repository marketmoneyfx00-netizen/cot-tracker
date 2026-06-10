/**
 * theme.js — Centralized design token system for COT Tracker
 *
 * ONE source of truth for all visual tokens.
 * All components import from here. No more DS, D, T inline objects.
 *
 * Usage:
 *   import { buildTheme, SEMANTIC } from '../lib/theme.js';
 *   const T = buildTheme(darkMode);
 */

// ─── Core palette ────────────────────────────────────────────────────────────
export const PALETTE = {
  dark: {
    bg:       "#070b14",
    panel:    "#0d1526",
    card:     "#111d32",
    card2:    "#162038",
    card3:    "#1b263f",
    border:   "#1e2d47",
    border2:  "#162038",
    text:     "#eef0f8",
    sub:      "#8491a8",
    sub2:     "#4a5568",
    // overlays
    overlay:  "rgba(0,0,0,0.7)",
    sheet:    "#0d1526",
    hover:    "rgba(255,255,255,0.04)",
    latestBg: "rgba(37,99,235,0.10)",
  },
  light: {
    bg:       "#f0f4f8",
    panel:    "#ffffff",
    card:     "#ffffff",
    card2:    "#f4f7fb",
    card3:    "#eef1f6",
    border:   "#dbe4ed",
    border2:  "#eef1f6",
    text:     "#111827",
    sub:      "#64748b",
    sub2:     "#94a3b8",
    // overlays
    overlay:  "rgba(0,0,0,0.50)",
    sheet:    "#ffffff",
    hover:    "rgba(0,0,0,0.03)",
    latestBg: "rgba(0,85,204,0.03)",
  },
};

// ─── Semantic tokens (same in both modes) ────────────────────────────────────
export const SEMANTIC = {
  accent:   "#2563eb",
  accentHi: "#3b82f6",
  purple:   "#7c3aed",
  purpleHi: "#a78bfa",
  green:    "#22c55e",
  greenSft: "#88c999",
  greenTxt: "#2e7d4f",
  red:      "#ef4444",
  redSft:   "#ef9a9a",
  redTxt:   "#b71c1c",
  amber:    "#f59e0b",
  cyan:     "#06b6d4",
  orange:   "#f97316",
};

// ─── buildTheme — returns the full T object used by every component ──────────
export function buildTheme(darkMode) {
  const p = darkMode ? PALETTE.dark : PALETTE.light;
  return {
    // Surfaces
    bg:      p.bg,
    card:    p.card,
    card2:   p.card2,
    card3:   p.card3,
    header:  darkMode ? p.card2 : p.card3,
    sheet:   p.sheet,
    // Borders
    border:  p.border,
    border2: p.border2,
    // Text
    txt:     p.text,
    sub:     p.sub,
    sub2:    p.sub2,
    // Overlays
    overlay: p.overlay,
    hover:   p.hover,
    latestBg:p.latestBg,
    rowHover:p.hover,
    // Semantic
    ...SEMANTIC,
    // Legacy aliases (for components that use T.bull, T.bear etc)
    bull:    SEMANTIC.greenSft,
    bear:    SEMANTIC.redSft,
    bullTxt: SEMANTIC.greenTxt,
    bearTxt: SEMANTIC.redTxt,
    // Input / form
    inputBg: darkMode ? p.card2 : "#f8fafc",
    inputBd: darkMode ? p.border : "#dbe4ed",
    inputTxt:p.text,
    // Settings sheets use same card bg
    modalBg: p.sheet,
    // Misc
    closeBg: darkMode ? p.card3 : p.card2,
    rBorder: p.border,
    reason:  darkMode ? p.hover : p.card2,
  };
}

// ─── CSS variable injection (optional, for gradients etc) ────────────────────
export function injectCSSVars(darkMode) {
  const p = darkMode ? PALETTE.dark : PALETTE.light;
  const root = document.documentElement;
  root.style.setProperty("--cot-bg",      p.bg);
  root.style.setProperty("--cot-card",    p.card);
  root.style.setProperty("--cot-card2",   p.card2);
  root.style.setProperty("--cot-border",  p.border);
  root.style.setProperty("--cot-text",    p.text);
  root.style.setProperty("--cot-sub",     p.sub);
  root.style.setProperty("--cot-sub2",    p.sub2);
  root.style.setProperty("--cot-accent",  SEMANTIC.accent);
  root.style.setProperty("--cot-purple",  SEMANTIC.purple);
  root.style.setProperty("--cot-green",   SEMANTIC.green);
  root.style.setProperty("--cot-red",     SEMANTIC.red);
  // For components using raw CSS vars (HeatmapGrid, ScoreGauge)
  root.style.setProperty("--text",        p.text);
  root.style.setProperty("--text-muted",  p.sub);
  root.style.setProperty("--bg-card",     p.card);
  root.style.setProperty("--bg-card2",    p.card2);
  root.style.setProperty("--border-clr",  p.border);
}
