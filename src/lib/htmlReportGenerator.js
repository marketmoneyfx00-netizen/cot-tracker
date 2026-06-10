/**
 * htmlReportGenerator.js — COT Tracker Institutional HTML Report v1.0
 *
 * Generates a fully self-contained HTML string (inline CSS + SVG charts).
 * No external assets or fonts. Designed for browser open + window.print() PDF.
 */

import { generateExecutiveSummary, generatePairNarrative, generateMarketRegimeLabel, generateMacroRegimeNarrative, generateEnrichedAssetReport } from './narrativeEngine.js';
import { buildCrossAssetContext } from './crossAssetInterpretationEngine.js';
import { buildLayersArray } from './exportEngine.js';
import { calculateExecutionScore } from '../intradayExecutionEngine.js';
import { buildCbCycleProfiles, enrichCarryPairWithCycle } from './cbCycleEngine.js';
import { buildConvictionProfile, buildPrioritizationMatrix, convictionColor, TIER_COLORS } from './convictionEngine.js';
import { buildTemporalHorizon, horizonViewColor, horizonShortLabel } from './temporalHorizonEngine.js';
import { buildFlowPersistence, FLOW_STATE_COLORS } from './flowPersistenceEngine.js';
import { buildRegimeTransition, buildAssetRegimeTrend, TRANSITION_COLORS } from './regimeTransitionEngine.js';
import { buildIntermarketStability } from './intermarketStabilityEngine.js';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const PALETTE = {
  bg:       '#070b14',
  card:     '#111d32',
  card2:    '#0d1526',
  border:   '#1e2d47',
  accent:   '#2563eb',
  txt:      '#eef0f8',
  sub:      '#8491a8',
  sub2:     '#4d5f7a',
  bull:     '#22c55e',
  bear:     '#ef4444',
  neutral:  '#8491a8',
  amber:    '#f59e0b',
  purple:   '#a78bfa',
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round(v, d = 2) {
  if (v == null || isNaN(v)) return null;
  return parseFloat(v.toFixed(d));
}

function fmtK(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n > 0 ? `+${n}` : String(n);
}

function biasColor(direction) {
  if (direction === 'bullish') return PALETTE.bull;
  if (direction === 'bearish') return PALETTE.bear;
  return PALETTE.neutral;
}


function execColor(score) {
  if (score == null) return PALETTE.neutral;
  if (score >= 70) return PALETTE.bull;
  if (score >= 50) return PALETTE.amber;
  return PALETTE.bear;
}

function computeExec(biasEntry, sentimentData, riskData) {
  if (!biasEntry) return null;
  const b = biasEntry.bias ?? biasEntry;
  const score = b.score ?? biasEntry.score;
  try {
    return calculateExecutionScore({
      biasScore:     score,
      biasDirection: b.direction ?? (score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral'),
      riskScore:     riskData?.score    ?? 0,
      fg:            sentimentData?.fg       ?? 50,
      vix:           sentimentData?.vix      ?? 18,
      highCount:     sentimentData?.highCount ?? 0,
      midCount:      sentimentData?.midCount  ?? 0,
      carryScore:    biasEntry.carryScore ?? null,
    });
  } catch { return null; }
}

// ── SVG CHARTS ────────────────────────────────────────────────────────────────

function buildBiasBarChart(biasArr) {
  const barH    = 18;
  const gap     = 6;
  const labelW  = 70;
  const chartW  = 260;
  const totalH  = biasArr.length * (barH + gap) + 10;
  const midX    = labelW + chartW / 2;

  const rows = biasArr.map((b, i) => {
    const raw    = b.bias?.score ?? b.score ?? 0;
    const dir    = b.bias?.direction ?? b.direction ?? 'neutral';
    const color  = biasColor(dir);
    const y      = 5 + i * (barH + gap);
    // Simple left-anchored bar from center
    const bw  = (Math.abs(raw) / 5) * (chartW / 2);
    const bx  = raw >= 0 ? midX : midX - bw;

    return `
      <text x="${labelW - 6}" y="${y + barH - 5}" text-anchor="end" fill="${PALETTE.sub}" font-size="9" font-family="monospace">${esc(b.pair)}</text>
      <rect x="${labelW}" y="${y}" width="${chartW}" height="${barH}" fill="${PALETTE.card2}" rx="3"/>
      <line x1="${midX}" y1="${y}" x2="${midX}" y2="${y + barH}" stroke="${PALETTE.border}" stroke-width="1"/>
      <rect x="${bx}" y="${y + 2}" width="${Math.max(2, bw)}" height="${barH - 4}" fill="${color}" rx="2" opacity="0.85"/>
      <text x="${labelW + chartW + 6}" y="${y + barH - 5}" fill="${color}" font-size="9" font-family="monospace">${raw > 0 ? '+' : ''}${round(raw, 1) ?? '—'}</text>
    `;
  });

  return `
    <svg width="${labelW + chartW + 50}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      <text x="${midX}" y="4" text-anchor="middle" fill="${PALETTE.sub2}" font-size="8" font-family="sans-serif">Puntuación de Sesgo (−5 a +5)</text>
      ${rows.join('')}
    </svg>
  `;
}

function buildDonutChart(bull, bear, neutral) {
  const total = bull + bear + neutral || 1;
  const cx = 60, cy = 60, r = 44, sw = 16;
  const gap = 0.04; // radians gap between segments

  function arcPath(start, end, radius) {
    const s = { x: cx + radius * Math.cos(start), y: cy + radius * Math.sin(start) };
    const e = { x: cx + radius * Math.cos(end),   y: cy + radius * Math.sin(end)   };
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  const start0 = -Math.PI / 2;
  const bullA  = (bull    / total) * 2 * Math.PI;
  const bearA  = (bear    / total) * 2 * Math.PI;
  const neutA  = (neutral / total) * 2 * Math.PI;

  const s1 = start0,            e1 = s1 + bullA - gap;
  const s2 = s1 + bullA + gap,  e2 = s2 + bearA - gap;
  const s3 = s2 + bearA + gap,  e3 = s3 + neutA - gap;

  const bullPath  = bullA  > gap * 2 ? `<path d="${arcPath(s1, e1, r)}" stroke="${PALETTE.bull}"    stroke-width="${sw}" fill="none" stroke-linecap="round"/>` : '';
  const bearPath  = bearA  > gap * 2 ? `<path d="${arcPath(s2, e2, r)}" stroke="${PALETTE.bear}"    stroke-width="${sw}" fill="none" stroke-linecap="round"/>` : '';
  const neutPath  = neutA  > gap * 2 ? `<path d="${arcPath(s3, e3, r)}" stroke="${PALETTE.neutral}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>` : '';

  const pctBull = Math.round((bull / total) * 100);
  const dominant = bull > bear ? 'ALCISTA' : bear > bull ? 'BAJISTA' : 'NEUTRAL';
  const domColor = bull > bear ? PALETTE.bull : bear > bull ? PALETTE.bear : PALETTE.neutral;

  return `
    <svg width="220" height="120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE.card2}" stroke-width="${sw}"/>
      ${bullPath}${bearPath}${neutPath}
      <text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="${domColor}" font-size="11" font-weight="bold" font-family="sans-serif">${dominant}</text>
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">${pctBull}% Sesgo Largo</text>
      <!-- Legend -->
      <circle cx="135" cy="24" r="5" fill="${PALETTE.bull}"/>
      <text x="143" y="28" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">Alcista: ${bull}</text>
      <circle cx="135" cy="44" r="5" fill="${PALETTE.bear}"/>
      <text x="143" y="48" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">Bajista: ${bear}</text>
      <circle cx="135" cy="64" r="5" fill="${PALETTE.neutral}"/>
      <text x="143" y="68" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">Neutral: ${neutral}</text>
    </svg>
  `;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

function buildCSS() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: ${PALETTE.bg}; color: ${PALETTE.txt}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; }
    .page { max-width: 900px; margin: 0 auto; padding: 32px 24px; }

    /* Cover */
    .cover { background: linear-gradient(135deg, ${PALETTE.card} 0%, ${PALETTE.card2} 100%); border: 1px solid ${PALETTE.border}; border-radius: 16px; padding: 40px 40px 32px; margin-bottom: 28px; position: relative; overflow: hidden; }
    .cover::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at top right, ${PALETTE.accent}0a, transparent 60%); pointer-events: none; }
    .cover-brand { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: ${PALETTE.accent}; text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }
    .cover-brand::before { content: '⬡'; font-size: 14px; }
    .cover-title { font-size: 26px; font-weight: 800; letter-spacing: -0.6px; color: ${PALETTE.txt}; line-height: 1.15; margin-bottom: 6px; }
    .cover-subtitle { font-size: 13px; color: ${PALETTE.sub}; margin-bottom: 24px; }
    .cover-meta { display: flex; gap: 24px; flex-wrap: wrap; }
    .cover-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .cover-meta-label { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: ${PALETTE.sub2}; text-transform: uppercase; }
    .cover-meta-value { font-size: 12px; font-weight: 700; color: ${PALETTE.txt}; }

    /* Cards */
    .card { background: ${PALETTE.card}; border: 1px solid ${PALETTE.border}; border-radius: 12px; padding: 20px 22px; margin-bottom: 20px; }
    .card-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: ${PALETTE.sub}; text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .card-title::before { content: ''; display: inline-block; width: 3px; height: 12px; background: ${PALETTE.accent}; border-radius: 2px; }

    /* Overview grid */
    .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-cell { background: ${PALETTE.card2}; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 14px 16px; }
    .stat-label { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; color: ${PALETTE.sub}; text-transform: uppercase; margin-bottom: 5px; }
    .stat-value { font-size: 22px; font-weight: 800; line-height: 1; }
    .stat-desc  { font-size: 10px; color: ${PALETTE.sub}; margin-top: 3px; }
    .bull { color: ${PALETTE.bull}; }
    .bear { color: ${PALETTE.bear}; }
    .neut { color: ${PALETTE.neutral}; }
    .amb  { color: ${PALETTE.amber}; }
    .acc  { color: ${PALETTE.accent}; }

    /* Market table */
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th { background: ${PALETTE.card2}; color: ${PALETTE.sub}; font-size: 9px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; padding: 8px 10px; text-align: left; border-bottom: 1px solid ${PALETTE.border}; }
    tbody tr { border-bottom: 1px solid ${PALETTE.border}20; }
    tbody tr:hover { background: ${PALETTE.card2}40; }
    tbody td { padding: 9px 10px; vertical-align: middle; }
    .pair-label { font-weight: 700; font-size: 12px; color: ${PALETTE.txt}; letter-spacing: 0.02em; }
    .score-bar-wrap { position: relative; height: 6px; background: ${PALETTE.card2}; border-radius: 3px; width: 80px; overflow: hidden; }
    .score-bar { position: absolute; top: 0; height: 6px; border-radius: 3px; transition: width 0.3s; }
    .score-bar.bull-bar { left: 50%; }
    .score-bar.bear-bar { right: 50%; }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; }
    .badge-bull { background: ${PALETTE.bull}18; color: ${PALETTE.bull}; border: 1px solid ${PALETTE.bull}30; }
    .badge-bear { background: ${PALETTE.bear}18; color: ${PALETTE.bear}; border: 1px solid ${PALETTE.bear}30; }
    .badge-neut { background: ${PALETTE.neutral}18; color: ${PALETTE.neutral}; border: 1px solid ${PALETTE.neutral}30; }
    .badge-amb  { background: ${PALETTE.amber}18; color: ${PALETTE.amber}; border: 1px solid ${PALETTE.amber}30; }
    .badge-acc  { background: ${PALETTE.accent}18; color: ${PALETTE.accent}; border: 1px solid ${PALETTE.accent}30; }
    .exec-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
    .mono { font-family: 'Menlo', 'Consolas', monospace; }

    /* Pair sections */
    .pair-section { background: ${PALETTE.card}; border: 1px solid ${PALETTE.border}; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px; }
    .pair-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .pair-name { font-size: 16px; font-weight: 800; color: ${PALETTE.txt}; letter-spacing: -0.3px; }
    .pair-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .narrative-text { font-size: 11.5px; color: ${PALETTE.sub}; line-height: 1.65; margin-bottom: 14px; }
    .layers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
    .layer-cell { background: ${PALETTE.card2}; border: 1px solid ${PALETTE.border}; border-radius: 8px; padding: 10px 12px; }
    .layer-name { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; color: ${PALETTE.sub}; text-transform: uppercase; margin-bottom: 5px; }
    .layer-value { font-size: 14px; font-weight: 800; margin-bottom: 2px; font-family: monospace; }
    .layer-signal { font-size: 10px; color: ${PALETTE.sub}; }
    .layer-delta { font-size: 9px; margin-top: 4px; }
    .delta-pos { color: ${PALETTE.bull}; }
    .delta-neg { color: ${PALETTE.bear}; }

    /* Charts row */
    .charts-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 20px; }
    .chart-box { background: ${PALETTE.card2}; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 14px 16px; flex: 1; min-width: 200px; }
    .chart-title { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; color: ${PALETTE.sub}; text-transform: uppercase; margin-bottom: 12px; }

    /* Executive summary */
    .summary-text { font-size: 12.5px; color: #c4cede; line-height: 1.75; padding: 16px 18px; background: ${PALETTE.card2}; border-left: 3px solid ${PALETTE.accent}; border-radius: 0 8px 8px 0; }

    /* Macro bar */
    .macro-bar { display: flex; gap: 12px; flex-wrap: wrap; background: ${PALETTE.card2}; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; }
    .macro-item { display: flex; flex-direction: column; gap: 2px; }
    .macro-label { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; color: ${PALETTE.sub2}; text-transform: uppercase; }
    .macro-value { font-size: 11px; font-weight: 700; color: ${PALETTE.txt}; }

    /* Footer */
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid ${PALETTE.border}; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .footer-text { font-size: 9px; color: ${PALETTE.sub2}; line-height: 1.6; max-width: 400px; }
    .footer-brand { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: ${PALETTE.sub2}; text-align: right; }

    /* Print button */
    .print-btn { position: fixed; bottom: 20px; right: 20px; background: ${PALETTE.accent}; color: #fff; border: none; border-radius: 10px; padding: 10px 20px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 20px ${PALETTE.accent}55; display: flex; align-items: center; gap: 8px; z-index: 1000; }
    .print-btn:hover { background: #1d4ed8; }

    @media print {
      @page { margin: 0; size: A4; }
      html, body {
        background: #fff !important;
        color: #111 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body { padding: 10mm 10mm; }
      .page { padding: 0; max-width: 100%; }
      .print-btn { display: none !important; }

      /* Light backgrounds */
      .cover, .card, .pair-section, .chart-box, .stat-cell, .layer-cell, .macro-bar { background: #f4f6f9 !important; border-color: #d0d7e3 !important; }
      .summary-text { background: #eef2ff !important; border-left-color: #2563eb !important; color: #1e293b !important; }
      thead th { background: #e8edf4 !important; color: #555 !important; border-color: #d0d7e3 !important; }
      .cover::before { display: none; }

      /* Text readability */
      .cover-title, .pair-name, .stat-value, .layer-value, .pair-label { color: #111 !important; }
      .cover-subtitle, .stat-desc, .stat-label, .card-title, .layer-name,
      .narrative-text, .layer-signal, .macro-label, .macro-value,
      .footer-text, .cover-meta-label, .chart-title { color: #444 !important; }
      .cover-brand, .cover-meta-value { color: #2563eb !important; }

      /* Table sizing */
      table { font-size: 10px; }
      tbody td { padding: 6px 8px; }

      /* ── PAGE BREAK RULES ──
         Only avoid breaks on small atomic blocks.
         Large cards intentionally flow across pages to avoid whitespace gaps. */
      .stat-cell      { page-break-inside: avoid; break-inside: avoid; }
      .layer-cell     { page-break-inside: avoid; break-inside: avoid; }
      .macro-bar      { page-break-inside: avoid; break-inside: avoid; }
      .macro-item     { page-break-inside: avoid; break-inside: avoid; }
      .summary-text   { page-break-inside: avoid; break-inside: avoid; }
      .pair-section-header { page-break-after: avoid; break-after: avoid; }
      .card-title     { page-break-after: avoid; break-after: avoid; }
      tbody tr        { page-break-inside: avoid; break-inside: avoid; }
    }
  `;
}

// ── SECTION: MARKET TABLE ─────────────────────────────────────────────────────

function buildMarketTable(biasArr, execMap) {
  const rows = biasArr.map(b => {
    const dir   = b.bias?.direction ?? b.direction ?? 'neutral';
    const score = round(b.bias?.score ?? b.score, 1) ?? 0;
    const label = b.bias?.label ?? (dir === 'bullish' ? 'Alcista' : dir === 'bearish' ? 'Bajista' : 'Neutral');
    const exec  = execMap?.[b.pair];
    const execS = exec?.score;
    const execL = exec?.permission?.label ?? '—';
    const zsc   = b.zscore?.zscore;
    const div   = b.divergence?.state ?? 'NEUTRAL';
    const conf  = b.confluence?.confluenceScore ?? b.confluence?.score;
    const confStr = conf != null ? Math.round(conf) : '—';

    const badgeClass = dir === 'bullish' ? 'badge-bull' : dir === 'bearish' ? 'badge-bear' : 'badge-neut';
    const _execClass = execS != null ? (execS >= 70 ? 'bull' : execS >= 50 ? 'amb' : 'bear') : 'neut'; // reserved for future table styling
    const divClass   = div === 'EXHAUSTION' ? 'amb' : div.includes('DIVERGENCE') ? 'acc' : 'neut';

    const barW = Math.round((Math.abs(score) / 5) * 38);
    const barSide = score >= 0 ? 'bull-bar' : 'bear-bar';
    const barColor = score > 0 ? PALETTE.bull : score < 0 ? PALETTE.bear : PALETTE.neutral;

    return `
      <tr>
        <td><span class="pair-label">${esc(b.pair)}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="score-bar-wrap">
              <div class="score-bar ${barSide}" style="width:${barW}px;background:${barColor};"></div>
            </div>
            <span class="mono" style="font-size:11px;color:${barColor};font-weight:700;">${score > 0 ? '+' : ''}${score}</span>
          </div>
        </td>
        <td><span class="badge ${badgeClass}">${esc(label)}</span></td>
        <td>
          <span class="exec-dot" style="background:${execColor(execS)};box-shadow:0 0 6px ${execColor(execS)}66;"></span>
          <span style="font-size:10px;color:${execColor(execS)};font-weight:600;">${esc(execL)}</span>
        </td>
        <td class="${divClass}" style="font-size:10px;font-weight:600;">${esc(div.replace(/_/g, ' '))}</td>
        <td class="mono" style="font-size:10px;color:${Math.abs(zsc ?? 0) > 2 ? PALETTE.amber : PALETTE.sub};">${zsc != null ? (zsc > 0 ? '+' : '') + round(zsc, 2) : '—'}</td>
        <td style="font-size:10px;color:${conf >= 70 ? PALETTE.bull : conf >= 45 ? PALETTE.amber : PALETTE.sub};">${confStr}</td>
      </tr>
    `;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Par</th>
          <th style="min-width:130px;">Puntuación de Sesgo</th>
          <th>Señal</th>
          <th>Ejecución</th>
          <th>Divergencia</th>
          <th>Z-Score</th>
          <th>Confluencia</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── ASSET CLASS LABEL ─────────────────────────────────────────────────────────

const CAT_META = {
  fx:          { label: 'FX — Pares de Divisas',           icon: '💱', color: '#2563eb', readingType: 'Carry / Régimen USD' },
  index:       { label: 'Índices de Renta Variable',        icon: '📈', color: '#22c55e', readingType: 'Apetito de Riesgo' },
  bonds:       { label: 'Renta Fija — Futuros de Bonos',   icon: '🏛️', color: '#60a5fa', readingType: 'Expectativas de Tipos' },
  commodities: { label: 'Materias Primas',                  icon: '🛢️', color: '#f59e0b', readingType: 'Inflación / Demanda' },
};

// Asset-class-specific reading banner (displayed above pair section)
function buildAssetReadingBanner(cat, biasEntry) {
  const meta = CAT_META[cat] ?? CAT_META.fx;
  const dir  = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';

  const READINGS = {
    fx: {
      bullish: 'Largo divisa base — Leveraged Money neto largo, carry alineado',
      bearish: 'Corto divisa base — Leveraged Money neto corto, presión de carry',
      neutral: 'Sin sesgo direccional FX dominante desde Leveraged Money',
    },
    index: {
      bullish: 'Risk-On — apetito institucional por renta variable en expansión',
      bearish: 'Risk-Off — derisking institucional en futuros de renta variable',
      neutral: 'Posicionamiento en renta variable neutral — sin señal direccional dominante',
    },
    bonds: {
      bullish: 'Expectativa de bajada de tipos — acumulación de renta fija (duration bid)',
      bearish: 'Expectativa de subida de tipos — venta de bonos, prima de inflación en yields',
      neutral: 'Sin señal dominante de expectativa de tipos desde Leveraged Money',
    },
    commodities: {
      bullish: 'Demanda de materias primas — confianza de demanda o cobertura de inflación',
      bearish: 'Venta de materias primas — debilidad de demanda o posicionamiento desinflacionario',
      neutral: 'Sin señal direccional dominante en materias primas',
    },
  };

  const reading = READINGS[cat]?.[dir] ?? 'Sin señal disponible';
  const dirColor = dir === 'bullish' ? PALETTE.bull : dir === 'bearish' ? PALETTE.bear : PALETTE.neutral;

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:${meta.color}14;border:1px solid ${meta.color}30;border-radius:8px;margin-bottom:10px;">
      <span style="font-size:14px;">${meta.icon}</span>
      <div>
        <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:${meta.color};text-transform:uppercase;">${meta.readingType}</div>
        <div style="font-size:11px;color:${dirColor};font-weight:600;">${esc(reading)}</div>
      </div>
    </div>
  `;
}

// Section header for each asset class group
function buildAssetGroupHeader(cat) {
  const meta = CAT_META[cat] ?? { label: cat.toUpperCase(), icon: '📊', color: PALETTE.accent };
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:28px 0 12px;padding-bottom:10px;border-bottom:2px solid ${meta.color}40;">
      <span style="font-size:18px;">${meta.icon}</span>
      <div>
        <div style="font-size:14px;font-weight:800;color:${PALETTE.txt};letter-spacing:-0.3px;">${esc(meta.label)}</div>
        <div style="font-size:10px;color:${PALETTE.sub};margin-top:1px;">Posicionamiento CFTC Leveraged Money</div>
      </div>
    </div>
  `;
}

// ── SECTION: PAIR DETAILS ─────────────────────────────────────────────────────

// ── RATES SECTION ─────────────────────────────────────────────────────────────

function buildRatesSection(ratesData) {
  if (!ratesData?.pairs?.length && !ratesData?.banks) return '';

  const pairs = ratesData.pairs ?? [];
  const banks = ratesData.banks ?? {};

  const topCarry = [...pairs]
    .filter(p => p.rate_diff_bps != null)
    .sort((a, b) => Math.abs(b.rate_diff_bps) - Math.abs(a.rate_diff_bps))
    .slice(0, 6);

  const carryRows = topCarry.map(p => {
    const dirColor = p.carry_direction === 'long_base'  ? PALETTE.bull
                   : p.carry_direction === 'long_quote' ? PALETTE.bear : PALETTE.neutral;
    const diffStr  = p.rate_diff_bps != null ? (p.rate_diff_bps > 0 ? '+' : '') + p.rate_diff_bps + ' bps' : '—';
    return `
      <tr>
        <td><span style="font-weight:700;font-size:11px;">${esc(p.pair)}</span></td>
        <td style="font-size:10px;">${esc(p.base_bank)} ${p.base_rate != null ? p.base_rate.toFixed(2) + '%' : ''}</td>
        <td style="font-size:10px;">${esc(p.quote_bank)} ${p.quote_rate != null ? p.quote_rate.toFixed(2) + '%' : ''}</td>
        <td class="mono" style="font-size:10px;font-weight:700;color:${p.rate_diff_bps > 0 ? PALETTE.bull : p.rate_diff_bps < 0 ? PALETTE.bear : PALETTE.neutral};">${esc(diffStr)}</td>
        <td style="font-size:10px;color:${dirColor};font-weight:600;">${esc(p.carry_direction?.replace(/_/g, ' ') ?? '—')}</td>
      </tr>
    `;
  }).join('');

  const bankStances = Object.entries(banks).map(([bankId, bk]) => {
    const sColor = (bk.stanceScore ?? 0) > 0 ? PALETTE.bull
                 : (bk.stanceScore ?? 0) < 0 ? PALETTE.bear : PALETTE.neutral;
    return `
      <div style="background:${PALETTE.card2};border:1px solid ${PALETTE.border};border-radius:8px;padding:10px 14px;min-width:100px;flex:1;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:${PALETTE.sub};text-transform:uppercase;">${esc(bankId)}</div>
        <div style="font-size:16px;font-weight:800;color:${PALETTE.txt};margin:4px 0 2px;">${bk.current != null ? bk.current.toFixed(2) + '%' : '—'}</div>
        <div style="font-size:10px;font-weight:600;color:${sColor};">${esc(bk.stanceLabel ?? '—')}</div>
        <div style="font-size:9px;color:${PALETTE.sub2};margin-top:2px;">${esc(bk.lastDate ?? '')}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">Tipos de Bancos Centrales &amp; Diferenciales de Carry</div>
      ${bankStances ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;">${bankStances}</div>
      ` : ''}
      ${carryRows ? `
        <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">TOP DIFERENCIALES DE CARRY</div>
        <table>
          <thead><tr>
            <th>Par</th><th>BC Base / Tipo</th><th>BC Cotizada / Tipo</th><th>Diferencial</th><th>Dirección Carry</th>
          </tr></thead>
          <tbody>${carryRows}</tbody>
        </table>
      ` : ''}
    </div>
  `;
}

// ── CONVICTION BADGE ──────────────────────────────────────────────────────────

function buildConvictionBadge(conviction) {
  if (!conviction || conviction.conviction_label === 'INSUFFICIENT') return '';
  const score  = conviction.conviction_score;
  const label  = conviction.conviction_label;
  const tier   = conviction.confidence_tier;
  const color  = convictionColor(label);
  const tColor = TIER_COLORS[tier] ?? '#6b7280';

  // Mini gauge: filled bar 0-100
  const barW = Math.max(2, score);
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 4px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:${PALETTE.sub};text-transform:uppercase;">CONVICCIÓN</div>
      <div style="background:${PALETTE.card2};border-radius:4px;height:8px;width:80px;overflow:hidden;">
        <div style="height:100%;width:${barW}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
      </div>
      <span style="font-size:10px;font-weight:700;color:${color};">${score}/100</span>
      <span style="font-size:9px;font-weight:700;color:${color};letter-spacing:0.06em;">${label}</span>
      <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${tColor}22;color:${tColor};border:1px solid ${tColor}44;">${tier}</span>
    </div>`;
}

// ── HORIZON TAGS ──────────────────────────────────────────────────────────────

function buildHorizonTags(horizon) {
  if (!horizon) return '';
  const tag = (label, view) => {
    if (!view) return '';
    const color = horizonViewColor(view);
    const short = horizonShortLabel(view);
    return `<span style="font-size:9px;padding:2px 7px;border-radius:3px;background:${color}22;color:${color};border:1px solid ${color}44;font-weight:600;">${label}: ${esc(short)}</span>`;
  };
  return `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;">
      ${tag('Táctico', horizon.tactical?.view)}
      ${tag('Swing',   horizon.swing?.view)}
      ${tag('Macro',   horizon.macro?.view)}
    </div>`;
}

// ── PRIORITY MATRIX SECTION ───────────────────────────────────────────────────

function buildPriorityMatrixSection(matrix) {
  if (!matrix?.top_opportunities?.length && !matrix?.contrarian_extremes?.length) return '';

  const dirColor = (dir) => dir === 'bullish' ? PALETTE.bull : dir === 'bearish' ? PALETTE.bear : PALETTE.neutral;
  const dirArr   = (dir) => dir === 'bullish' ? '↑' : dir === 'bearish' ? '↓' : '→';

  const opportunityRow = (a) => `
    <tr>
      <td style="font-weight:700;color:${PALETTE.txt};font-size:11px;">${esc(a.pair)}</td>
      <td style="color:${dirColor(a.direction)};font-weight:700;font-size:10px;">${dirArr(a.direction)} ${esc(a.direction?.toUpperCase())}</td>
      <td style="color:${convictionColor(a.conviction_label)};font-weight:700;font-size:10px;">${a.conviction_score} — ${esc(a.conviction_label)}</td>
      <td style="color:${horizonViewColor(a.swing_view)};font-size:10px;">${esc(horizonShortLabel(a.swing_view) ?? '—')}</td>
      <td style="color:${horizonViewColor(a.macro_view)};font-size:10px;">${esc(horizonShortLabel(a.macro_view) ?? '—')}</td>
      <td style="color:${PALETTE.sub};font-size:9px;">${esc((a.key_factors ?? []).join(' · '))}</td>
    </tr>`;

  const topRows = (matrix.top_opportunities ?? []).map(opportunityRow).join('');
  const crowdedRows = (matrix.crowded_trades ?? []).map(a => `
    <tr>
      <td style="font-weight:700;color:${PALETTE.txt};font-size:11px;">${esc(a.pair)}</td>
      <td style="color:${dirColor(a.direction)};font-weight:700;font-size:10px;">${dirArr(a.direction)} ${esc(a.direction?.toUpperCase())}</td>
      <td style="color:${PALETTE.amber};font-size:10px;">Z: ${a.zscore > 0 ? '+' : ''}${a.zscore?.toFixed(2) ?? '—'}</td>
      <td colspan="3" style="color:${PALETTE.bear};font-size:9px;">${esc(a.warning ?? '')}</td>
    </tr>`).join('');

  return `
  <div style="background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:8px;padding:20px 24px;margin-bottom:20px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:${PALETTE.accent};text-transform:uppercase;margin-bottom:14px;">
      MATRIZ DE PRIORIDAD DE DECISIÓN
    </div>

    ${topRows ? `
    <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">MEJORES OPORTUNIDADES</div>
    <table style="font-size:10px;width:100%;margin-bottom:16px;">
      <thead><tr>
        <th style="text-align:left;">ACTIVO</th>
        <th style="text-align:left;">DIR</th>
        <th style="text-align:left;">CONVICCIÓN</th>
        <th style="text-align:left;">SWING</th>
        <th style="text-align:left;">MACRO</th>
        <th style="text-align:left;">FACTORES CONFIRMADORES</th>
      </tr></thead>
      <tbody>${topRows}</tbody>
    </table>` : ''}

    ${crowdedRows ? `
    <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.amber};text-transform:uppercase;margin-bottom:8px;">OPERACIONES SATURADAS / RIESGO FADE</div>
    <table style="font-size:10px;width:100%;">
      <thead><tr>
        <th style="text-align:left;">ACTIVO</th>
        <th style="text-align:left;">DIR</th>
        <th style="text-align:left;">Z-SCORE</th>
        <th colspan="3" style="text-align:left;">ADVERTENCIA</th>
      </tr></thead>
      <tbody>${crowdedRows}</tbody>
    </table>` : ''}
  </div>`;
}

// ── SCENARIO / INVALIDATION BLOCK ────────────────────────────────────────────

function buildScenarioBlock(enriched) {
  if (!enriched) return '';
  const { scenario_main, scenario_alt, invalidation, conclusion, rates_reading } = enriched;
  if (!scenario_main && !scenario_alt && !invalidation && !conclusion) return '';

  const row = (label, color, text) => text ? `
    <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${color};text-transform:uppercase;white-space:nowrap;min-width:80px;padding-top:2px;">${esc(label)}</div>
      <div style="font-size:10.5px;color:${PALETTE.txt};line-height:1.55;">${esc(text)}</div>
    </div>` : '';

  return `
    <div style="margin-top:18px;border-top:1px solid ${PALETTE.border};padding-top:16px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:12px;">ESCENARIOS Y CONCLUSIÓN</div>
      ${row('Principal', PALETTE.bull, scenario_main)}
      ${row('Alternativo', PALETTE.amber, scenario_alt)}
      ${row('Invalidación', PALETTE.bear, invalidation)}
      ${rates_reading ? row('Tipos / Carry', PALETTE.purple, rates_reading) : ''}
      ${conclusion ? `
        <div style="margin-top:12px;background:${PALETTE.card2};border-left:3px solid ${PALETTE.accent};padding:10px 14px;border-radius:4px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.accent};text-transform:uppercase;margin-bottom:5px;">CONCLUSIÓN OPERACIONAL</div>
          <div style="font-size:10.5px;color:${PALETTE.txt};line-height:1.55;">${esc(conclusion)}</div>
        </div>` : ''}
    </div>`;
}

// ── FLOW STATE TAG ─────────────────────────────────────────────────────────────

function buildFlowStateTag(fp) {
  if (!fp || fp.data_quality === 'insufficient') return '';
  const color = FLOW_STATE_COLORS[fp.flow_state] ?? PALETTE.neutral;
  const vel   = fp.positioning_velocity != null
    ? ` · Vel: ${fp.positioning_velocity > 0 ? '+' : ''}${Math.round(fp.positioning_velocity / 1000)}K`
    : '';
  const exh   = fp.exhaustion_probability != null && fp.exhaustion_probability >= 40
    ? ` · Agotamiento: ${fp.exhaustion_probability}%`
    : '';
  return `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <span style="background:${color}20;border:1px solid ${color};color:${color};border-radius:4px;padding:2px 8px;font-size:9.5px;font-weight:700;letter-spacing:0.05em;">${esc(fp.flow_state_label ?? fp.flow_state)}</span>
    ${fp.conviction_trend && fp.conviction_trend !== 'UNKNOWN' ? `<span style="color:${PALETTE.sub};font-size:9px;">Tendencia Conv.: <b style="color:${fp.conviction_trend === 'BUILDING' ? PALETTE.bull : fp.conviction_trend === 'FADING' || fp.conviction_trend === 'REVERSING' ? PALETTE.bear : PALETTE.neutral};">${fp.conviction_trend === 'BUILDING' ? 'EN ALZA' : fp.conviction_trend === 'FADING' ? 'DEBILITANDO' : fp.conviction_trend === 'REVERSING' ? 'REVIRTIENDO' : fp.conviction_trend}</b></span>` : ''}
    ${fp.structural_strength != null ? `<span style="color:${PALETTE.sub};font-size:9px;">Fuerza Estructural: <b style="color:${fp.structural_strength >= 70 ? PALETTE.bull : fp.structural_strength >= 40 ? PALETTE.amber : PALETTE.bear};">${fp.structural_strength}</b></span>` : ''}
    <span style="color:${PALETTE.sub2};font-size:9px;font-family:monospace;">${vel}${exh}</span>
  </div>`;
}

// ── REGIME TRANSITION SECTION ─────────────────────────────────────────────────

function buildRegimeTransitionSection(regimeTransition) {
  if (!regimeTransition || regimeTransition.transition_type === 'STABLE') return '';

  const tType  = regimeTransition.transition_type;
  const tColor = TRANSITION_COLORS[tType] ?? PALETTE.neutral;
  const vel    = regimeTransition.velocity;
  const stab   = regimeTransition.stability;
  const cTrend = regimeTransition.confidence_trend;

  const confirmHtml = (regimeTransition.confirmation_signals ?? []).length
    ? `<div style="margin-top:12px;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:6px;">SEÑALES DE CONFIRMACIÓN</div>
        <ul style="margin:0;padding:0 0 0 14px;list-style:disc;">
          ${regimeTransition.confirmation_signals.map(s => `<li style="font-size:10.5px;color:${PALETTE.sub};line-height:1.55;margin-bottom:3px;">${esc(s)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const deterHtml = (regimeTransition.deterioration_signals ?? []).length
    ? `<div style="margin-top:10px;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.amber};text-transform:uppercase;margin-bottom:6px;">SEÑALES DE ALERTA</div>
        <ul style="margin:0;padding:0 0 0 14px;list-style:disc;">
          ${regimeTransition.deterioration_signals.map(s => `<li style="font-size:10.5px;color:${PALETTE.amber};line-height:1.55;margin-bottom:3px;">${esc(s)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const timeline = regimeTransition.regime_timeline;
  const emerging = timeline?.emerging;

  return `
  <div class="card" style="border-left:3px solid ${tColor};">
    <div class="card-title" style="color:${tColor};">
      Transición de Régimen · ${esc(regimeTransition.transition_label)}
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="font-size:9px;color:${PALETTE.sub};">Velocidad: <b style="color:${vel === 'RAPID' ? PALETTE.bear : vel === 'MODERATE' ? PALETTE.amber : PALETTE.sub};">${vel === 'RAPID' ? 'RÁPIDA' : vel === 'MODERATE' ? 'MODERADA' : vel === 'SLOW' ? 'LENTA' : esc(vel)}</b></span>
      <span style="font-size:9px;color:${PALETTE.sub};">Estabilidad: <b style="color:${stab >= 65 ? PALETTE.bull : stab >= 40 ? PALETTE.amber : PALETTE.bear};">${stab}</b>/100</span>
      <span style="font-size:9px;color:${PALETTE.sub};">Tendencia de Confianza: <b style="color:${cTrend === 'IMPROVING' ? PALETTE.bull : cTrend === 'DETERIORATING' ? PALETTE.bear : PALETTE.neutral};">${cTrend === 'IMPROVING' ? 'MEJORANDO' : cTrend === 'DETERIORATING' ? 'DETERIORANDO' : esc(cTrend)}</b></span>
      ${emerging ? `<span style="font-size:9px;color:${PALETTE.sub};">Régimen Emergente: <b style="color:${PALETTE.amber};">${esc(emerging)}</b></span>` : ''}
      <span style="font-size:9px;color:${PALETTE.sub};">Cobertura: <b>${esc(regimeTransition.signal_coverage)}</b> (${regimeTransition.available_key_assets} activos clave)</span>
    </div>
    ${confirmHtml}
    ${deterHtml}
    ${timeline?.key_watch ? `
    <div style="margin-top:12px;background:${PALETTE.card2};border-radius:6px;padding:10px 12px;border-left:2px solid ${PALETTE.accent};">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.06em;color:${PALETTE.accent};text-transform:uppercase;margin-bottom:4px;">PUNTO CLAVE A VIGILAR</div>
      <div style="font-size:10.5px;color:${PALETTE.sub};line-height:1.5;">${esc(timeline.key_watch)}</div>
    </div>` : ''}
  </div>`;
}

// ── INTERMARKET STABILITY SECTION ─────────────────────────────────────────────

function buildIntermarketStabilitySection(stability) {
  if (!stability || stability.available_roles < 2) return '';

  const score    = stability.stability_score;
  const coh      = stability.regime_coherence;
  const bkdns    = stability.breakdowns ?? [];
  const strInt   = stability.structural_integrity;
  const scoreColor = score >= 70 ? PALETTE.bull : score >= 45 ? PALETTE.amber : PALETTE.bear;
  const cohColor   = coh === 'HIGH' ? PALETTE.bull : coh === 'MODERATE' ? PALETTE.neutral : coh === 'LOW' ? PALETTE.amber : PALETTE.bear;

  const breakdownHtml = bkdns.length
    ? bkdns.map(b => {
        const sevColor = b.severity === 'CRITICAL' ? PALETTE.bear : b.severity === 'SEVERE' ? '#f97316'
          : b.severity === 'MODERATE' ? PALETTE.amber : PALETTE.sub;
        return `<div style="margin-bottom:10px;padding:8px 12px;background:${PALETTE.card2};border-radius:6px;border-left:2px solid ${sevColor};">
          <div style="font-size:9.5px;font-weight:700;color:${sevColor};margin-bottom:3px;">${b.severity === 'CRITICAL' ? 'CRÍTICO' : b.severity === 'SEVERE' ? 'SEVERO' : b.severity === 'MODERATE' ? 'MODERADO' : esc(b.severity)} · ${esc(b.type?.replace(/_/g, ' '))}</div>
          <div style="font-size:10px;color:${PALETTE.sub};line-height:1.5;">${esc(b.interpretation)}</div>
        </div>`;
      }).join('')
    : `<div style="font-size:10.5px;color:${PALETTE.sub};">No se detectaron anomalías de correlación cross-asset significativas.</div>`;

  const obsHtml = (stability.observations ?? []).length
    ? `<div style="margin-top:10px;"><ul style="margin:0;padding:0 0 0 14px;list-style:disc;">${stability.observations.map(o => `<li style="font-size:10.5px;color:${PALETTE.sub};line-height:1.55;margin-bottom:3px;">${esc(o)}</li>`).join('')}</ul></div>`
    : '';

  return `
  <div class="card" style="border-left:3px solid ${scoreColor};">
    <div class="card-title" style="color:${PALETTE.txt};">Estabilidad Intermercado</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;">
      <div><div style="font-size:9px;color:${PALETTE.sub};text-transform:uppercase;letter-spacing:0.06em;">Puntuación de Estabilidad</div>
        <div style="font-size:20px;font-weight:800;color:${scoreColor};">${score}<span style="font-size:11px;color:${PALETTE.sub};">/100</span></div></div>
      <div><div style="font-size:9px;color:${PALETTE.sub};text-transform:uppercase;letter-spacing:0.06em;">Coherencia de Régimen</div>
        <div style="font-size:14px;font-weight:700;color:${cohColor};">${coh === 'HIGH' ? 'ALTA' : coh === 'MODERATE' ? 'MODERADA' : coh === 'LOW' ? 'BAJA' : esc(coh)}</div></div>
      <div><div style="font-size:9px;color:${PALETTE.sub};text-transform:uppercase;letter-spacing:0.06em;">Integridad Estructural</div>
        <div style="font-size:14px;font-weight:700;color:${strInt >= 70 ? PALETTE.bull : strInt >= 40 ? PALETTE.amber : PALETTE.bear};">${strInt}/100</div></div>
      <div><div style="font-size:9px;color:${PALETTE.sub};text-transform:uppercase;letter-spacing:0.06em;">Cobertura</div>
        <div style="font-size:14px;font-weight:700;color:${PALETTE.sub};">${esc(stability.signal_coverage)}</div></div>
    </div>
    ${bkdns.length ? `<div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">ANOMALÍAS DETECTADAS (${bkdns.length})</div>` : ''}
    ${breakdownHtml}
    ${obsHtml}
  </div>`;
}

function buildPairSection(b, pairRow, exec, T, cat, enriched, conviction, horizon, flowPersistence) {
  const dir     = b.bias?.direction ?? b.direction ?? 'neutral';
  const score   = round(b.bias?.score ?? b.score, 1) ?? 0;
  const label   = b.bias?.label ?? (dir === 'bullish' ? 'Alcista' : dir === 'bearish' ? 'Bajista' : 'Neutral');
  const badgeClass = dir === 'bullish' ? 'badge-bull' : dir === 'bearish' ? 'badge-bear' : 'badge-neut';
  const assetCat = cat ?? pairRow?.cat ?? 'fx';

  // Use enriched headline as narrative when available, otherwise fall back to generatePairNarrative
  const narrative = enriched?.institutional ?? generatePairNarrative(pairRow, b, exec) ?? 'No hay narrativa disponible para este par.';

  const layers = buildLayersArray(b, pairRow, exec);

  const layerCells = layers.map(l => {
    const vColor = l.color_state === 'green' ? PALETTE.bull : l.color_state === 'red' ? PALETTE.bear : l.color_state === 'amber' ? PALETTE.amber : PALETTE.neutral;
    const valStr = l.value != null ? (typeof l.value === 'number' ? (l.value > 0 ? '+' : '') + round(l.value, 1) : esc(l.value)) : '—';
    const deltaStr = l.delta_value != null
      ? `<span class="${l.delta_value > 0 ? 'delta-pos' : 'delta-neg'}" style="font-size:9px;">${l.delta_value > 0 ? '▲' : '▼'} ${Math.abs(round(l.delta_value, 1))}</span>`
      : '';
    return `
      <div class="layer-cell">
        <div class="layer-name">${esc(l.name)}</div>
        <div class="layer-value" style="color:${vColor};">${valStr}</div>
        <div class="layer-signal">${esc(l.signal)}</div>
        ${deltaStr ? `<div class="layer-delta">${deltaStr}</div>` : ''}
      </div>
    `;
  }).join('');

  // Last 4 weeks COT history mini-table
  const weekRows = (pairRow?.weeks ?? []).slice(0, 4).map(w => `
    <tr>
      <td style="color:${PALETTE.sub};font-size:10px;">${esc(w.isoDate ?? '—')}</td>
      <td class="mono" style="font-size:10px;color:${(w.smartNet ?? 0) > 0 ? PALETTE.bull : PALETTE.bear};">${fmtK(w.smartNet)}</td>
      <td class="mono" style="font-size:10px;color:${(w.levChgNet ?? 0) > 0 ? PALETTE.bull : PALETTE.bear};">${fmtK(w.levChgNet)}</td>
      <td style="font-size:10px;color:${PALETTE.sub};">${w.smartPctL != null ? round(w.smartPctL, 1) + '%' : '—'}</td>
    </tr>
  `).join('');

  return `
    <div class="pair-section">
      <div class="pair-section-header">
        <span class="pair-name">${esc(b.pair)}</span>
        <div class="pair-tags">
          <span class="badge ${badgeClass}">${esc(label)}</span>
          <span class="badge badge-acc" style="font-size:9px;">Score: ${score > 0 ? '+' : ''}${score}</span>
          ${exec?.permission?.label ? `<span class="badge ${exec.score >= 70 ? 'badge-bull' : exec.score >= 50 ? 'badge-amb' : 'badge-bear'}">${esc(exec.permission.label)}</span>` : ''}
        </div>
      </div>

      ${buildAssetReadingBanner(assetCat, b)}
      ${buildConvictionBadge(conviction)}
      ${buildHorizonTags(horizon)}
      ${buildFlowStateTag(flowPersistence)}

      <p class="narrative-text">${esc(narrative)}</p>

      <div class="layers-grid">${layerCells}</div>

      ${weekRows ? `
        <div style="margin-top:14px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">HISTORIAL SEMANAL COT (ÚLTIMOS 4 INFORMES)</div>
          <table style="font-size:10px;">
            <thead><tr>
              <th>Fecha</th><th>Neto Lev.</th><th>Cambio Sem.</th><th>% Largo</th>
            </tr></thead>
            <tbody>${weekRows}</tbody>
          </table>
        </div>
      ` : ''}

      ${buildScenarioBlock(enriched)}
    </div>
  `;
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export function generateHTMLReport(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal,
    sentimentData,
    riskData,
    snapshotDate,
    cotDate,
    livePrices: _livePrices = {},  // accepted for future price overlays
    riskRegime  = null,
    combinedData = null,
    ratesData   = null,
  } = opts;

  if (!biasArr?.length) return '<html><body><p>No hay datos disponibles.</p></body></html>';

  // fxPairs here may be allPairsArr when cross-asset is active
  const pairMap  = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
  const execMap  = {};
  biasArr.forEach(b => {
    execMap[b.pair] = computeExec(b, sentimentData, riskData);
  });

  const bull    = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish').length;
  const bear    = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish').length;
  const neut    = biasArr.length - bull - bear;

  const dates   = (fxPairs ?? []).map(p => p.latest?.isoDate ?? p.weeks?.[0]?.isoDate).filter(Boolean).sort().reverse();
  const cftcD   = cotDate ?? dates[0] ?? '—';
  const today   = snapshotDate ?? new Date().toISOString().slice(0, 10);

  // Cross-asset context and regime narrative (v2 — graceful if no regime data)
  const crossAssetCtx  = riskRegime
    ? buildCrossAssetContext({ regime: riskRegime, allBiasArr: biasArr, combinedData, macroSignal })
    : null;
  const regimeNarrative = generateMacroRegimeNarrative(riskRegime, crossAssetCtx);

  const regime      = generateMarketRegimeLabel(biasArr, macroSignal, riskRegime);
  const execSummary = generateExecutiveSummary({ biasArr, macroSignal, cotDate: cftcD, snapshotDate: today, regime: riskRegime, crossAssetCtx });

  const avgBias = biasArr.reduce((s, b) => s + (b.bias?.score ?? b.score ?? 0), 0) / biasArr.length;
  const globalBias = avgBias > 0.3 ? 'Sesgo Alcista' : avgBias < -0.3 ? 'Sesgo Bajista' : 'Neutral';

  const biasBarChartSVG = buildBiasBarChart(biasArr);
  const donutSVG        = buildDonutChart(bull, bear, neut);

  const marketTableHTML = buildMarketTable(biasArr, execMap);

  // Group assets by category for structured rendering
  const getcat = (b) => pairMap[b.pair]?.cat ?? b.cat ?? 'fx';
  const CATEGORY_ORDER = ['fx', 'index', 'bonds', 'commodities'];
  const byCategory = {};
  CATEGORY_ORDER.forEach(c => { byCategory[c] = []; });
  biasArr.forEach(b => {
    const cat = getcat(b);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(b);
  });

  // Pre-compute CB cycle profiles (used by enriched asset reports and conviction engine)
  const cycleProfiles = ratesData ? buildCbCycleProfiles(ratesData) : {};
  const ratesList     = ratesData?.pairs ?? [];

  // Pre-compute enriched narrative reports, conviction profiles, temporal horizons, and flow persistence
  const enrichedMap       = {};
  const convictionMap     = {};
  const horizonMap        = {};
  const flowPersistenceMap = {};
  const regimeTrendMap     = {};
  const decisionAssets    = [];

  biasArr.forEach(b => {
    const pairRow = pairMap[b.pair];
    if (!pairRow) return;
    const exec = execMap[b.pair];

    // Carry conviction for FX pairs
    const pairKey  = b.pair?.replace('/', '').toUpperCase();
    const ratesRaw = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);
    const enrichedRates = ratesRaw && Object.keys(cycleProfiles).length
      ? enrichCarryPairWithCycle(ratesRaw, cycleProfiles) : ratesRaw ?? null;
    const carryConviction = enrichedRates?.carry_conviction ?? 'NEUTRAL';

    // Narrative report
    enrichedMap[b.pair] = generateEnrichedAssetReport(pairRow, b, {
      exec, riskRegime, macroSignal, ratesData, cycleProfiles, crossAssetCtx,
    });

    // Conviction + horizon
    const conviction = buildConvictionProfile(b, pairRow, {
      riskRegime, cycleProfiles, exec, crossAssetCtx, carryConviction,
    });
    const horizon = buildTemporalHorizon(b, pairRow, {
      exec, riskRegime, cycleProfiles, convictionProfile: conviction,
    });

    // Flow persistence + regime trend (Phase 3)
    const flowPersistence = buildFlowPersistence(pairRow, b);
    const cat = pairRow.cat ?? 'fx';
    const regimeTrend = buildAssetRegimeTrend(b, flowPersistence, riskRegime, cat);

    convictionMap[b.pair]      = conviction;
    horizonMap[b.pair]         = horizon;
    flowPersistenceMap[b.pair] = flowPersistence;
    regimeTrendMap[b.pair]     = regimeTrend;
    decisionAssets.push({
      pair:           b.pair,
      cat,
      direction:      b.bias?.direction ?? b.direction ?? 'neutral',
      conviction,
      horizon,
      exec,
      biasEntry:      b,
      flowPersistence,
    });
  });

  // Cross-asset priority matrix
  const priorityMatrix = buildPrioritizationMatrix(decisionAssets);

  // Regime transition and intermarket stability (Phase 3)
  const regimeTransition     = buildRegimeTransition(riskRegime, decisionAssets);
  const intermarketStability = buildIntermarketStability(riskRegime, biasArr);

  // Build grouped pair sections
  const groupedPairSections = CATEGORY_ORDER
    .filter(cat => byCategory[cat].length > 0)
    .map(cat => {
      const items = byCategory[cat].map(b => {
        const pairRow = pairMap[b.pair];
        if (!pairRow) return '';
        return buildPairSection(
          b, pairRow, execMap[b.pair], PALETTE, cat,
          enrichedMap[b.pair], convictionMap[b.pair], horizonMap[b.pair],
          flowPersistenceMap[b.pair],
        );
      }).join('');
      return buildAssetGroupHeader(cat) + items;
    }).join('');

  // Carry / CB rates section (if available)
  const ratesSection = buildRatesSection(ratesData, riskRegime);

  const macroBarItems = [
    { label: 'Señal Macro',    value: macroSignal?.bias?.replace(/_/g, ' ') ?? '—' },
    { label: 'Confianza',      value: macroSignal?.confidence != null ? `${macroSignal.confidence}/10` : '—' },
    sentimentData?.fg  != null ? { label: 'Miedo/Codicia', value: String(sentimentData.fg) } : null,
    sentimentData?.vix != null ? { label: 'VIX',           value: String(sentimentData.vix) } : null,
  ].filter(Boolean).map(item => `
    <div class="macro-item">
      <div class="macro-label">${esc(item.label)}</div>
      <div class="macro-value">${esc(item.value)}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>COT Tracker — Informe Institucional · ${today}</title>
  <style>${buildCSS()}</style>
</head>
<body>
<div class="page">

  <!-- COVER -->
  <div class="cover">
    <div class="cover-brand">COT Tracker · Inteligencia Institucional</div>
    <div class="cover-title">Informe de Posicionamiento Institucional</div>
    <div class="cover-subtitle">CFTC Commitment of Traders · Análisis de Leveraged Money · Posicionamiento Institucional Multi-Activo</div>
    <div class="cover-meta">
      <div class="cover-meta-item">
        <div class="cover-meta-label">Fecha del Informe</div>
        <div class="cover-meta-value">${esc(today)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Informe CFTC</div>
        <div class="cover-meta-value">${esc(cftcD)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Pares Analizados</div>
        <div class="cover-meta-value">${biasArr.length}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Régimen de Mercado</div>
        <div class="cover-meta-value" style="color:${PALETTE.accent};">${esc(regime)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Sesgo Global</div>
        <div class="cover-meta-value" style="color:${avgBias > 0.3 ? PALETTE.bull : avgBias < -0.3 ? PALETTE.bear : PALETTE.neutral};">${esc(globalBias)}</div>
      </div>
    </div>
  </div>

  <!-- MARKET OVERVIEW STATS -->
  <div class="overview-grid">
    <div class="stat-cell">
      <div class="stat-label">Pares Analizados</div>
      <div class="stat-value acc">${biasArr.length}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Sesgo Alcista</div>
      <div class="stat-value bull">${bull}</div>
      <div class="stat-desc">${Math.round((bull / biasArr.length) * 100)}% de pares</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Sesgo Bajista</div>
      <div class="stat-value bear">${bear}</div>
      <div class="stat-desc">${Math.round((bear / biasArr.length) * 100)}% de pares</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Neutral</div>
      <div class="stat-value neut">${neut}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Régimen de Mercado</div>
      <div class="stat-value" style="font-size:13px;color:${PALETTE.accent};line-height:1.3;margin-top:2px;">${esc(regime)}</div>
    </div>
  </div>

  <!-- MACRO BAR -->
  ${macroBarItems ? `<div class="macro-bar">${macroBarItems}</div>` : ''}

  <!-- MACRO REGIME CONTEXT (v2 — present when regime data available) -->
  ${riskRegime?.regime ? `
  <div class="card" style="border-left:3px solid ${esc(riskRegime.color ?? '#8491a8')};">
    <div class="card-title" style="color:${esc(riskRegime.color ?? PALETTE.accent)};">
      Régimen Macro · ${esc(regimeNarrative.headline)}
    </div>
    <div class="summary-text">${esc(regimeNarrative.body)}</div>
    ${regimeNarrative.keyDrivers?.length ? `
    <div style="margin-top:14px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">FACTORES CROSS-ASSET</div>
      <ul style="margin:0;padding:0 0 0 16px;list-style:disc;">
        ${regimeNarrative.keyDrivers.map(d => `<li style="font-size:11px;color:${PALETTE.sub};line-height:1.6;margin-bottom:4px;">${esc(d)}</li>`).join('')}
      </ul>
    </div>` : ''}
  </div>` : ''}

  <!-- EXECUTIVE SUMMARY -->
  <div class="card">
    <div class="card-title">Resumen Ejecutivo</div>
    <div class="summary-text">${esc(execSummary)}</div>
  </div>

  <!-- CHARTS -->
  <div class="charts-row">
    <div class="chart-box" style="flex:2;min-width:320px;">
      <div class="chart-title">Distribución de Sesgo Institucional</div>
      ${biasBarChartSVG}
    </div>
    <div class="chart-box" style="flex:1;min-width:200px;">
      <div class="chart-title">Desglose de Sentimiento de Mercado</div>
      ${donutSVG}
    </div>
  </div>

  <!-- MARKET TABLE -->
  <div class="card">
    <div class="card-title">Visión Global del Mercado</div>
    ${marketTableHTML}
  </div>

  <!-- DECISION PRIORITY MATRIX -->
  ${buildPriorityMatrixSection(priorityMatrix)}

  <!-- REGIME TRANSITION ANALYSIS -->
  ${buildRegimeTransitionSection(regimeTransition)}

  <!-- INTERMARKET STABILITY -->
  ${buildIntermarketStabilitySection(intermarketStability)}

  <!-- CARRY / RATES SECTION -->
  ${ratesSection}

  <!-- PER-ASSET DETAILS — GROUPED BY ASSET CLASS -->
  <div class="card" style="padding:20px 22px;">
    <div class="card-title">Análisis Institucional por Activo</div>
    <p style="font-size:10.5px;color:${PALETTE.sub};margin:0;">Posicionamiento Leveraged Money, puntuaciones de sesgo, señales de divergencia y flujo semanal — agrupados por clase de activo.</p>
  </div>
  ${groupedPairSections}

  <!-- FOOTER -->
  <div class="footer">
    <p class="footer-text">
      Fuente de datos: CFTC · Traders in Financial Futures (TFF). Este informe fue generado automáticamente por el motor de análisis institucional de COT Tracker. Todos los datos reflejan el posicionamiento a la fecha del último informe CFTC. El posicionamiento pasado no garantiza la dirección futura del precio. No es asesoramiento financiero.
    </p>
    <div class="footer-brand">
      COT TRACKER<br/>
      Sistema de Exportación Institucional v2.0<br/>
      <span style="font-weight:400;">Generado ${new Date().toUTCString()}</span>
    </div>
  </div>

</div>

<!-- PRINT / PDF BUTTON -->
<button class="print-btn" id="printBtn">
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4V1.5h8V4M3 10.5H1.5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H11M3 7.5h8v5H3v-5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Imprimir / Guardar como PDF
</button>

<script>
(function() {
  var btn = document.getElementById('printBtn');
  if (btn) {
    btn.addEventListener('click', function() { window.print(); });
  }
})();
</script>

</body>
</html>`;
}
