/**
 * htmlReportGenerator.js — COT Tracker Institutional HTML Report v1.0
 *
 * Generates a fully self-contained HTML string (inline CSS + SVG charts).
 * No external assets or fonts. Designed for browser open + window.print() PDF.
 */

import { generateExecutiveSummary, generatePairNarrative, generateMarketRegimeLabel } from './narrativeEngine.js';
import { buildLayersArray } from './exportEngine.js';
import { calculateExecutionScore } from '../intradayExecutionEngine.js';

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

function biasBarWidth(score, maxScore = 5) {
  if (score == null) return 50;
  const normalized = ((score + maxScore) / (maxScore * 2)) * 100;
  return Math.max(2, Math.min(100, normalized));
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
    const barPct = biasBarWidth(raw);
    const fillW  = (barPct / 100) * chartW;
    const fillX  = labelW + (raw < 0 ? midX - labelW - (chartW / 2 - Math.abs(raw) / 5 * chartW / 2) : chartW / 2);

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
      <text x="${midX}" y="4" text-anchor="middle" fill="${PALETTE.sub2}" font-size="8" font-family="sans-serif">Bias Score (−5 to +5)</text>
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
  const dominant = bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NEUTRAL';
  const domColor = bull > bear ? PALETTE.bull : bear > bull ? PALETTE.bear : PALETTE.neutral;

  return `
    <svg width="220" height="120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE.card2}" stroke-width="${sw}"/>
      ${bullPath}${bearPath}${neutPath}
      <text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="${domColor}" font-size="11" font-weight="bold" font-family="sans-serif">${dominant}</text>
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">${pctBull}% Long Bias</text>
      <!-- Legend -->
      <circle cx="135" cy="24" r="5" fill="${PALETTE.bull}"/>
      <text x="143" y="28" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">Bull: ${bull}</text>
      <circle cx="135" cy="44" r="5" fill="${PALETTE.bear}"/>
      <text x="143" y="48" fill="${PALETTE.sub}" font-size="9" font-family="sans-serif">Bear: ${bear}</text>
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
      html, body { background: #fff !important; color: #111 !important; }
      .cover, .card, .pair-section, .chart-box, .stat-cell, .layer-cell { background: #f8f9fa !important; border-color: #dee2e6 !important; color: #111 !important; }
      .cover::before { display: none; }
      .print-btn { display: none !important; }
      .page { padding: 12px 16px; max-width: 100%; }
      .cover-title, .pair-name, .stat-value, .layer-value { color: #111 !important; }
      .cover-subtitle, .stat-desc, .stat-label, .card-title, .layer-name, .narrative-text, .layer-signal, .macro-label, .footer-text { color: #555 !important; }
      table { font-size: 10px; }
      thead th, .cover-brand, .cover-meta-label { color: #666 !important; background: #eee !important; }
      summary-text { border-left-color: #2563eb !important; background: #f0f4ff !important; color: #333 !important; }
      @page { margin: 15mm 12mm; }
    }
  `;
}

// ── SECTION: MARKET TABLE ─────────────────────────────────────────────────────

function buildMarketTable(biasArr, execMap) {
  const rows = biasArr.map(b => {
    const dir   = b.bias?.direction ?? b.direction ?? 'neutral';
    const score = round(b.bias?.score ?? b.score, 1) ?? 0;
    const label = b.bias?.label ?? (dir === 'bullish' ? 'Bullish' : dir === 'bearish' ? 'Bearish' : 'Neutral');
    const exec  = execMap?.[b.pair];
    const execS = exec?.score;
    const execL = exec?.permission?.label ?? '—';
    const zsc   = b.zscore?.zscore;
    const div   = b.divergence?.state ?? 'NEUTRAL';
    const conf  = b.confluence?.confluenceScore ?? b.confluence?.score;
    const confStr = conf != null ? Math.round(conf) : '—';

    const badgeClass = dir === 'bullish' ? 'badge-bull' : dir === 'bearish' ? 'badge-bear' : 'badge-neut';
    const execClass  = execS != null ? (execS >= 70 ? 'bull' : execS >= 50 ? 'amb' : 'bear') : 'neut';
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
          <th>Pair</th>
          <th style="min-width:130px;">Bias Score</th>
          <th>Signal</th>
          <th>Execution</th>
          <th>Divergence</th>
          <th>Z-Score</th>
          <th>Confluence</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── SECTION: PAIR DETAILS ─────────────────────────────────────────────────────

function buildPairSection(b, pairRow, exec, T) {
  const dir     = b.bias?.direction ?? b.direction ?? 'neutral';
  const score   = round(b.bias?.score ?? b.score, 1) ?? 0;
  const label   = b.bias?.label ?? (dir === 'bullish' ? 'Bullish' : dir === 'bearish' ? 'Bearish' : 'Neutral');
  const badgeClass = dir === 'bullish' ? 'badge-bull' : dir === 'bearish' ? 'badge-bear' : 'badge-neut';
  const scoreColor = score > 0 ? PALETTE.bull : score < 0 ? PALETTE.bear : PALETTE.neutral;

  const narrative = generatePairNarrative(pairRow, b, exec) || 'No narrative available for this pair.';

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

      <p class="narrative-text">${esc(narrative)}</p>

      <div class="layers-grid">${layerCells}</div>

      ${weekRows ? `
        <div style="margin-top:14px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.07em;color:${PALETTE.sub};text-transform:uppercase;margin-bottom:8px;">COT WEEKLY HISTORY (LAST 4 REPORTS)</div>
          <table style="font-size:10px;">
            <thead><tr>
              <th>Date</th><th>Lev. Net</th><th>Wk Change</th><th>% Long</th>
            </tr></thead>
            <tbody>${weekRows}</tbody>
          </table>
        </div>
      ` : ''}
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
    livePrices = {},
  } = opts;

  if (!biasArr?.length) return '<html><body><p>No data available.</p></body></html>';

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

  const regime    = generateMarketRegimeLabel(biasArr, macroSignal);
  const execSummary = generateExecutiveSummary({ biasArr, macroSignal, cotDate: cftcD, snapshotDate: today });

  const avgBias = biasArr.reduce((s, b) => s + (b.bias?.score ?? b.score ?? 0), 0) / biasArr.length;
  const globalBias = avgBias > 0.3 ? 'Bullish Tilt' : avgBias < -0.3 ? 'Bearish Tilt' : 'Neutral';

  const biasBarChartSVG = buildBiasBarChart(biasArr);
  const donutSVG        = buildDonutChart(bull, bear, neut);

  const marketTableHTML = buildMarketTable(biasArr, execMap);

  const pairSections = biasArr
    .map(b => {
      const pairRow = pairMap[b.pair];
      if (!pairRow) return '';
      return buildPairSection(b, pairRow, execMap[b.pair], PALETTE);
    })
    .join('');

  const macroBarItems = [
    { label: 'Macro Signal',   value: macroSignal?.bias?.replace(/_/g, ' ') ?? '—' },
    { label: 'Confidence',     value: macroSignal?.confidence != null ? `${macroSignal.confidence}/10` : '—' },
    sentimentData?.fg  != null ? { label: 'Fear/Greed', value: String(sentimentData.fg) } : null,
    sentimentData?.vix != null ? { label: 'VIX',        value: String(sentimentData.vix) } : null,
  ].filter(Boolean).map(item => `
    <div class="macro-item">
      <div class="macro-label">${esc(item.label)}</div>
      <div class="macro-value">${esc(item.value)}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>COT Tracker — Institutional Report · ${today}</title>
  <style>${buildCSS()}</style>
</head>
<body>
<div class="page">

  <!-- COVER -->
  <div class="cover">
    <div class="cover-brand">COT Tracker · Institutional Intelligence</div>
    <div class="cover-title">Institutional Positioning Report</div>
    <div class="cover-subtitle">CFTC Commitment of Traders · Leveraged Money Analysis · FX Markets</div>
    <div class="cover-meta">
      <div class="cover-meta-item">
        <div class="cover-meta-label">Snapshot Date</div>
        <div class="cover-meta-value">${esc(today)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">CFTC Report</div>
        <div class="cover-meta-value">${esc(cftcD)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Pairs Tracked</div>
        <div class="cover-meta-value">${biasArr.length}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Market Regime</div>
        <div class="cover-meta-value" style="color:${PALETTE.accent};">${esc(regime)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-label">Global Bias</div>
        <div class="cover-meta-value" style="color:${avgBias > 0.3 ? PALETTE.bull : avgBias < -0.3 ? PALETTE.bear : PALETTE.neutral};">${esc(globalBias)}</div>
      </div>
    </div>
  </div>

  <!-- MARKET OVERVIEW STATS -->
  <div class="overview-grid">
    <div class="stat-cell">
      <div class="stat-label">Pairs Analyzed</div>
      <div class="stat-value acc">${biasArr.length}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Bullish Bias</div>
      <div class="stat-value bull">${bull}</div>
      <div class="stat-desc">${Math.round((bull / biasArr.length) * 100)}% of pairs</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Bearish Bias</div>
      <div class="stat-value bear">${bear}</div>
      <div class="stat-desc">${Math.round((bear / biasArr.length) * 100)}% of pairs</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Neutral</div>
      <div class="stat-value neut">${neut}</div>
    </div>
    <div class="stat-cell">
      <div class="stat-label">Market Regime</div>
      <div class="stat-value" style="font-size:13px;color:${PALETTE.accent};line-height:1.3;margin-top:2px;">${esc(regime)}</div>
    </div>
  </div>

  <!-- MACRO BAR -->
  ${macroBarItems ? `<div class="macro-bar">${macroBarItems}</div>` : ''}

  <!-- EXECUTIVE SUMMARY -->
  <div class="card">
    <div class="card-title">Executive Summary</div>
    <div class="summary-text">${esc(execSummary)}</div>
  </div>

  <!-- CHARTS -->
  <div class="charts-row">
    <div class="chart-box" style="flex:2;min-width:320px;">
      <div class="chart-title">Institutional Bias Distribution</div>
      ${biasBarChartSVG}
    </div>
    <div class="chart-box" style="flex:1;min-width:200px;">
      <div class="chart-title">Market Sentiment Breakdown</div>
      ${donutSVG}
    </div>
  </div>

  <!-- MARKET TABLE -->
  <div class="card">
    <div class="card-title">Full Market Overview</div>
    ${marketTableHTML}
  </div>

  <!-- PER-PAIR DETAILS -->
  <div class="card" style="padding:20px 22px;">
    <div class="card-title">Pair-by-Pair Institutional Analysis</div>
  </div>
  ${pairSections}

  <!-- FOOTER -->
  <div class="footer">
    <p class="footer-text">
      Data source: CFTC · Traders in Financial Futures (TFF). This report was generated automatically by COT Tracker's institutional analysis engine. All data reflects positioning as of the latest CFTC release. Past positioning does not guarantee future price direction. Not financial advice.
    </p>
    <div class="footer-brand">
      COT TRACKER<br/>
      Institutional Export System v2.0<br/>
      <span style="font-weight:400;">Generated ${new Date().toUTCString()}</span>
    </div>
  </div>

</div>

<!-- PRINT / PDF BUTTON -->
<button class="print-btn" onclick="window.print()">
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4V1.5h8V4M3 10.5H1.5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H11M3 7.5h8v5H3v-5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Print / Save as PDF
</button>

</body>
</html>`;
}
