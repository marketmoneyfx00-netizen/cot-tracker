/**
 * xlsxExporter.js — Institutional XLSX Generator v1.0
 *
 * Builds a styled Excel workbook from scratch using raw OOXML + fflate.
 * No external Excel dependency — uses the already-installed fflate package.
 *
 * Sheets:
 *   1. Executive Summary  — branding header + market overview + auto-commentary
 *   2. Market Snapshot    — full pair table with conditional cell colors
 *   3. Pair Details       — one section per pair with all layers
 */

import { zipSync, strToU8 } from 'fflate';
import { generateExecutiveSummary, generateMarketRegimeLabel, generatePairNarrative } from './narrativeEngine.js';

// ── PALETTE (ARGB hex) ────────────────────────────────────────────────────────
const C = {
  navy:        'FF0d1526',
  navyLight:   'FF111d32',
  navyMid:     'FF162038',
  accent:      'FF2563eb',
  accentLight: 'FF3b82f6',
  green:       'FF22c55e',
  greenLight:  'FFdcfce7',
  greenDark:   'FF16a34a',
  red:         'FFef4444',
  redLight:    'FFfee2e2',
  redDark:     'FFdc2626',
  amber:       'FFf59e0b',
  amberLight:  'FFfef3c7',
  white:       'FFFFFFFF',
  textDark:    'FF111827',
  textSub:     'FF64748b',
  border:      'FFd1d5db',
  borderMid:   'FF94a3b8',
  altRow:      'FFf8fafc',
  gray100:     'FFf1f5f9',
};

// ── XML ESCAPING ──────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safe(v) {
  if (v == null || v === '') return '—';
  return String(v);
}

// ── COLUMN ADDRESSING ─────────────────────────────────────────────────────────
function colLetter(n) {
  // n is 0-indexed
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}
function cellRef(col, row) { return `${colLetter(col)}${row}`; }

// ── STYLE INDICES (must match styles.xml exactly) ─────────────────────────────
const S = {
  DEFAULT:      0,   // normal cell
  NAV_HEADER:   1,   // navy bg, white bold 14pt — branding banner
  ACCENT_HDR:   2,   // accent bg, white bold 11pt — column headers
  SECTION:      3,   // navyMid bg, white bold 12pt — section labels
  BULLISH:      4,   // green light bg, dark text bold
  BEARISH:      5,   // red light bg, dark text bold
  NEUTRAL:      6,   // amber light bg, dark text
  DATA:         7,   // white bg, thin border
  DATA_BOLD:    8,   // white bg, bold, thin border
  LABEL:        9,   // gray bg, sub text
  NUMBER:       10,  // white bg, right-align, thin border
  ALT_ROW:      11,  // alt row bg, normal
  SCORE_BULL:   12,  // dark green bg, white bold — score badge
  SCORE_BEAR:   13,  // dark red bg, white bold — score badge
  META:         14,  // navy bg, light sub text small — footer/meta
  SUBSECTION:   15,  // gray100 bg, bold — sub-section headers
};

// ── STYLES XML ────────────────────────────────────────────────────────────────
function buildStylesXml() {
  // numFmts
  const numFmts = `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>`;

  // fonts (0-indexed)
  const fonts = `<fonts count="8">
    <font><sz val="11"/><color rgb="${C.textDark}"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="${C.textDark}"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="${C.white}"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="${C.white}"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="${C.white}"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="${C.textSub}"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="${C.greenDark}"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="${C.redDark}"/><name val="Calibri"/></font>
  </fonts>`;

  // fills — first two MUST be none + gray (OOXML spec)
  const fills = `<fills count="14">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.navy}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.accent}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.navyMid}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.greenLight}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.redLight}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.amberLight}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.altRow}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.gray100}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.greenDark}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.redDark}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.navyLight}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.accentLight}"/></patternFill></fill>
  </fills>`;

  // Fill index map (2-indexed because 0/1 reserved):
  // 2=navy, 3=accent, 4=navyMid, 5=greenLight, 6=redLight, 7=amberLight
  // 8=altRow, 9=gray100, 10=greenDark, 11=redDark, 12=navyLight, 13=accentLight

  const thin = `<border><left style="thin"><color rgb="${C.border}"/></left><right style="thin"><color rgb="${C.border}"/></right><top style="thin"><color rgb="${C.border}"/></top><bottom style="thin"><color rgb="${C.border}"/></bottom></border>`;
  const thickBot = `<border><left/><right/><top/><bottom style="medium"><color rgb="${C.accent}"/></bottom></border>`;

  const borders = `<borders count="3">
    <border><left/><right/><top/><bottom/></border>
    ${thin}
    ${thickBot}
  </borders>`;

  // cellStyleXfs (base formats)
  const cellStyleXfs = `<cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>`;

  // cellXfs — indexed by S.* above
  // 0=DEFAULT,1=NAV_HEADER,2=ACCENT_HDR,3=SECTION,4=BULLISH,5=BEARISH,
  // 6=NEUTRAL,7=DATA,8=DATA_BOLD,9=LABEL,10=NUMBER,11=ALT_ROW,12=SCORE_BULL,13=SCORE_BEAR,14=META,15=SUBSECTION
  const xf = (fontId, fillId, borderId, extraAttrs = '', applyAlignment = '') => {
    const base = `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" applyFont="1" applyFill="1" applyBorder="1"`;
    if (applyAlignment) return `${base} applyAlignment="1">${applyAlignment}</xf>`;
    return `${base}/>`;
  };

  const center  = `<alignment horizontal="center" vertical="center"/>`;
  const left    = `<alignment horizontal="left" vertical="center"/>`;
  const right   = `<alignment horizontal="right" vertical="center"/>`;
  const wrapL   = `<alignment horizontal="left" vertical="top" wrapText="1"/>`;
  const centerW = `<alignment horizontal="center" vertical="center" wrapText="1"/>`;

  const cellXfs = `<cellXfs count="16">
    ${xf(0, 0, 0)}
    ${xf(2, 2, 0, '', center)}
    ${xf(3, 3, 0, '', center)}
    ${xf(4, 4, 0, '', center)}
    ${xf(1, 5, 1, '', left)}
    ${xf(1, 6, 1, '', left)}
    ${xf(1, 7, 1, '', left)}
    ${xf(0, 0, 1, '', left)}
    ${xf(1, 0, 1, '', left)}
    ${xf(5, 9, 0, '', left)}
    ${xf(0, 0, 1, '', right)}
    ${xf(0, 8, 1, '', left)}
    ${xf(3, 10, 0, '', center)}
    ${xf(3, 11, 0, '', center)}
    ${xf(5, 2, 0, '', left)}
    ${xf(1, 9, 1, '', left)}
  </cellXfs>`;

  const cellStyles = `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${numFmts}${fonts}${fills}${borders}${cellStyleXfs}${cellXfs}${cellStyles}
</styleSheet>`;
}

// ── CELL HELPERS ──────────────────────────────────────────────────────────────

function strCell(ref, value, styleIdx) {
  return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t>${esc(safe(value))}</t></is></c>`;
}
function numCell(ref, value, styleIdx) {
  if (value == null || value === '' || value === '—') return strCell(ref, '—', styleIdx);
  return `<c r="${ref}" s="${styleIdx}"><v>${Number(value)}</v></c>`;
}
function emptyCell(ref, styleIdx) {
  return `<c r="${ref}" s="${styleIdx}"/>`;
}

// ── MERGED RANGE TRACKER ──────────────────────────────────────────────────────

class SheetBuilder {
  constructor() {
    this.rows     = [];
    this.merges   = [];
    this.colWidths = [];
    this.rowHeights = {};
  }

  addRow(cells, height) {
    const rowNum = this.rows.length + 1;
    const rowXml = cells.join('');
    this.rows.push(`<row r="${rowNum}"${height ? ` ht="${height}" customHeight="1"` : ''}>${rowXml}</row>`);
    return rowNum;
  }

  addEmptyRow(height) {
    const rowNum = this.rows.length + 1;
    this.rows.push(`<row r="${rowNum}"${height ? ` ht="${height}" customHeight="1"` : ''}></row>`);
    return rowNum;
  }

  merge(startCol, startRow, endCol, endRow) {
    this.merges.push(`<mergeCell ref="${cellRef(startCol, startRow)}:${cellRef(endCol, endRow)}"/>`);
  }

  setColWidth(colIdx, width) {
    this.colWidths[colIdx] = width;
  }

  toXml(sheetName) {
    const colDefs = this.colWidths
      .map((w, i) => w != null ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')
      .filter(Boolean).join('');

    const cols    = colDefs ? `<cols>${colDefs}</cols>` : '';
    const mergeEl = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${this.merges.join('')}</mergeCells>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="A1"/></sheetView></sheetViews>
  ${cols}
  <sheetData>${this.rows.join('')}</sheetData>
  ${mergeEl}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
  }
}

// ── DIRECTION → STYLE ─────────────────────────────────────────────────────────

function dirStyle(direction) {
  if (direction === 'bullish' || direction === 'Long') return S.BULLISH;
  if (direction === 'bearish' || direction === 'Short') return S.BEARISH;
  return S.NEUTRAL;
}

function scoreStyle(score) {
  if (score == null) return S.DATA;
  if (score >= 60) return S.SCORE_BULL;
  if (score <= 40) return S.SCORE_BEAR;
  return S.NEUTRAL;
}

function execStyle(score) {
  if (score == null) return S.DATA;
  if (score >= 70) return S.BULLISH;
  if (score >= 50) return S.NEUTRAL;
  return S.BEARISH;
}

function fmtK(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (a >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return (n > 0 ? '+' : '') + n;
}

// ── SHEET 1: EXECUTIVE SUMMARY ────────────────────────────────────────────────

function buildSummarySheet(biasArr, macroSignal, cotDate, snapshotDate, execMap) {
  const sb = new SheetBuilder();
  const COLS = 8;

  sb.setColWidth(0, 22);
  sb.setColWidth(1, 16);
  sb.setColWidth(2, 16);
  sb.setColWidth(3, 16);
  sb.setColWidth(4, 16);
  sb.setColWidth(5, 16);
  sb.setColWidth(6, 16);
  sb.setColWidth(7, 30);

  // ── Branding banner ──
  let r = sb.addRow([strCell('A1', 'COT TRACKER — INSTITUTIONAL MARKET SNAPSHOT', S.NAV_HEADER)], 36);
  sb.merge(0, r, COLS - 1, r);

  r = sb.addRow([strCell('A2', `Snapshot Date: ${snapshotDate ?? '—'}  ·  CFTC Report: ${cotDate ?? '—'}  ·  Export v2.0`, S.META)], 20);
  sb.merge(0, r, COLS - 1, r);

  sb.addEmptyRow(8);

  // ── Market Overview ──
  const bull = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish').length;
  const bear = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish').length;
  const neut = biasArr.length - bull - bear;
  const regime = generateMarketRegimeLabel(biasArr, macroSignal);

  r = sb.addRow([strCell('A4', 'MARKET OVERVIEW', S.SECTION)], 24);
  sb.merge(0, r, COLS - 1, r);

  r = sb.addRow([
    strCell(cellRef(0, r + 1), 'Total Pairs',    S.LABEL),
    strCell(cellRef(1, r + 1), 'Bullish',         S.LABEL),
    strCell(cellRef(2, r + 1), 'Bearish',         S.LABEL),
    strCell(cellRef(3, r + 1), 'Neutral',         S.LABEL),
    strCell(cellRef(4, r + 1), 'Market Regime',   S.LABEL),
    strCell(cellRef(5, r + 1), 'Macro Bias',      S.LABEL),
    strCell(cellRef(6, r + 1), 'CFTC Report',     S.LABEL),
    strCell(cellRef(7, r + 1), 'Snapshot Date',   S.LABEL),
  ], 16);

  r = sb.addRow([
    numCell(cellRef(0, r + 1), biasArr.length,    S.DATA_BOLD),
    numCell(cellRef(1, r + 1), bull,               S.SCORE_BULL),
    numCell(cellRef(2, r + 1), bear,               S.SCORE_BEAR),
    numCell(cellRef(3, r + 1), neut,               S.NEUTRAL),
    strCell(cellRef(4, r + 1), regime,             S.DATA_BOLD),
    strCell(cellRef(5, r + 1), macroSignal?.bias?.replace(/_/g, ' ') ?? 'NEUTRAL', S.DATA),
    strCell(cellRef(6, r + 1), cotDate ?? '—',     S.DATA),
    strCell(cellRef(7, r + 1), snapshotDate ?? '—',S.DATA),
  ], 22);

  sb.addEmptyRow(10);

  // ── Executive commentary ──
  r = sb.addRow([strCell('A8', 'EXECUTIVE COMMENTARY', S.SECTION)], 24);
  sb.merge(0, r, COLS - 1, r);

  const narrative = generateExecutiveSummary({ biasArr, macroSignal, cotDate, snapshotDate });
  // Split narrative into ~120-char chunks for readable rows
  const words     = narrative.split(' ');
  let   line      = '';
  const lines     = [];
  for (const w of words) {
    if ((line + ' ' + w).length > 120) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());

  lines.forEach(ln => {
    r = sb.addRow([strCell('A' + (r + 1), ln, S.DATA)], 18);
    sb.merge(0, r, COLS - 1, r);
  });

  sb.addEmptyRow(10);

  // ── Quick signal table ──
  const nextR = sb.rows.length + 1;
  r = sb.addRow([strCell('A' + nextR, 'PAIR SIGNAL SUMMARY', S.SECTION)], 24);
  sb.merge(0, r, COLS - 1, r);

  const hdrs = ['Pair', 'Bias Score', 'Bias Label', 'Execution', 'Divergence', 'Z-Score', 'Confluence', 'Trend State'];
  r = sb.addRow(hdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);

  biasArr.forEach(b => {
    const exec  = execMap?.[b.pair];
    const bias  = b.bias ?? b;
    const zsc   = b.zscore ?? {};
    const div   = b.divergence ?? {};
    const conf  = b.confluence ?? {};

    const normScore = bias.score != null ? Math.round(((bias.score + 5) / 10) * 100) : null;
    const confScore = conf.confluenceScore ?? conf.score ?? null;

    const trendState = b.signal?.signal === 'buy'  ? (b.signal?.strength >= 3 ? 'Strong Bullish' : 'Bullish')
                     : b.signal?.signal === 'sell' ? (b.signal?.strength >= 3 ? 'Strong Bearish' : 'Bearish')
                     : b.signal?.signal === 'indecision' ? 'Transitional' : 'Neutral';

    r = sb.addRow([
      strCell(cellRef(0, r + 1), b.pair,                              S.DATA_BOLD),
      numCell(cellRef(1, r + 1), normScore,                           scoreStyle(normScore)),
      strCell(cellRef(2, r + 1), bias.label ?? '—',                  dirStyle(bias.direction)),
      numCell(cellRef(3, r + 1), exec?.score ?? null,                 execStyle(exec?.score)),
      strCell(cellRef(4, r + 1), div.state ?? 'NEUTRAL',             S.DATA),
      numCell(cellRef(5, r + 1), zsc.zscore != null ? parseFloat(zsc.zscore.toFixed(2)) : null, S.DATA),
      numCell(cellRef(6, r + 1), confScore != null ? Math.round(confScore) : null, S.DATA),
      strCell(cellRef(7, r + 1), trendState,                          S.DATA),
    ], 20);
  });

  // Footer
  sb.addEmptyRow(10);
  const footerR = sb.rows.length + 1;
  r = sb.addRow([strCell('A' + footerR, 'COT Tracker · Institutional Data Export · Not financial advice. Source: CFTC Traders in Financial Futures.', S.META)], 16);
  sb.merge(0, r, COLS - 1, r);

  return sb;
}

// ── SHEET 2: MARKET SNAPSHOT ──────────────────────────────────────────────────

function buildSnapshotSheet(biasArr, fxPairs, macroSignal, execMap) {
  const sb   = new SheetBuilder();
  const pairMap = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));

  sb.setColWidth(0, 12);  // Pair
  sb.setColWidth(1, 12);  // Bias Score
  sb.setColWidth(2, 18);  // Bias Label
  sb.setColWidth(3, 12);  // Execution
  sb.setColWidth(4, 16);  // Exec Label
  sb.setColWidth(5, 18);  // Divergence
  sb.setColWidth(6, 12);  // Z-Score
  sb.setColWidth(7, 14);  // Percentile
  sb.setColWidth(8, 14);  // Confluence
  sb.setColWidth(9, 12);  // Lev Net
  sb.setColWidth(10, 12); // Wk Change
  sb.setColWidth(11, 10); // % Long
  sb.setColWidth(12, 16); // Asset Mgr Net
  sb.setColWidth(13, 12); // Market State
  sb.setColWidth(14, 16); // Trend State

  // Header
  let r = sb.addRow([strCell('A1', 'FULL MARKET SNAPSHOT', S.NAV_HEADER)], 30);
  sb.merge(0, r, 14, r);

  const hdrs = [
    'Pair','Bias Score','Bias Label','Exec Score','Exec Label',
    'Divergence','Z-Score','Percentile','Confluence',
    'Lev Net','Wk Change','% Long','Asset Mgr',
    'Market State','Trend State'
  ];
  r = sb.addRow(hdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 22);

  biasArr.forEach((b, idx) => {
    const bias  = b.bias ?? b;
    const zsc   = b.zscore ?? {};
    const div   = b.divergence ?? {};
    const conf  = b.confluence ?? {};
    const exec  = execMap?.[b.pair];
    const pr    = pairMap[b.pair];
    const latest = pr?.latest ?? pr?.weeks?.[0] ?? {};

    const normScore = bias.score != null ? Math.round(((bias.score + 5) / 10) * 100) : null;
    const confScore = conf.confluenceScore ?? conf.score ?? null;
    const altStyle  = idx % 2 === 1 ? S.ALT_ROW : S.DATA;

    const trendState = b.signal?.signal === 'buy'  ? (b.signal?.strength >= 3 ? 'Strong Bullish' : 'Bullish')
                     : b.signal?.signal === 'sell' ? (b.signal?.strength >= 3 ? 'Strong Bearish' : 'Bearish')
                     : b.signal?.signal === 'indecision' ? 'Transitional' : 'Neutral';

    r = sb.addRow([
      strCell(cellRef(0,  r + 1), b.pair,                               S.DATA_BOLD),
      numCell(cellRef(1,  r + 1), normScore,                            scoreStyle(normScore)),
      strCell(cellRef(2,  r + 1), bias.label ?? '—',                   dirStyle(bias.direction)),
      numCell(cellRef(3,  r + 1), exec?.score ?? null,                  execStyle(exec?.score)),
      strCell(cellRef(4,  r + 1), exec?.permission?.label ?? '—',      S.DATA),
      strCell(cellRef(5,  r + 1), div.state ?? 'NEUTRAL',              S.DATA),
      numCell(cellRef(6,  r + 1), zsc.zscore != null ? parseFloat(zsc.zscore.toFixed(2)) : null, S.DATA),
      numCell(cellRef(7,  r + 1), zsc.percentile ?? null,              S.DATA),
      numCell(cellRef(8,  r + 1), confScore != null ? Math.round(confScore) : null, S.DATA),
      strCell(cellRef(9,  r + 1), fmtK(latest.smartNet),               altStyle),
      strCell(cellRef(10, r + 1), fmtK(latest.levChgNet),              dirStyle((latest.levChgNet ?? 0) > 0 ? 'bullish' : (latest.levChgNet ?? 0) < 0 ? 'bearish' : 'neutral')),
      numCell(cellRef(11, r + 1), latest.smartPctL != null ? parseFloat(latest.smartPctL.toFixed(1)) : null, S.DATA),
      strCell(cellRef(12, r + 1), fmtK(latest.assetNet),               altStyle),
      strCell(cellRef(13, r + 1), b.state ?? '—',                      S.DATA),
      strCell(cellRef(14, r + 1), trendState,                          dirStyle(bias.direction)),
    ], 20);
  });

  return sb;
}

// ── SHEET 3: PAIR DETAILS ─────────────────────────────────────────────────────

function buildPairDetailSheet(biasArr, fxPairs, execMap, sentimentData, riskData) {
  const sb     = new SheetBuilder();
  const pairMap = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));

  sb.setColWidth(0, 26);
  sb.setColWidth(1, 16);
  sb.setColWidth(2, 16);
  sb.setColWidth(3, 14);
  sb.setColWidth(4, 16);
  sb.setColWidth(5, 14);
  sb.setColWidth(6, 14);
  sb.setColWidth(7, 14);

  let r = sb.addRow([strCell('A1', 'PAIR DETAIL REPORT', S.NAV_HEADER)], 30);
  sb.merge(0, r, 7, r);
  sb.addEmptyRow(8);

  biasArr.forEach((b, idx) => {
    const pr     = pairMap[b.pair];
    const bias   = b.bias ?? b;
    const zsc    = b.zscore ?? {};
    const div    = b.divergence ?? {};
    const conf   = b.confluence ?? {};
    const exec   = execMap?.[b.pair];
    const latest = pr?.latest ?? pr?.weeks?.[0] ?? {};
    const sig    = pr?.signal ?? {};

    // Section header
    r = sb.addRow([strCell(`A${r + 1}`, `${b.pair}  ·  ${bias.label ?? '—'}`, S.SECTION)], 28);
    sb.merge(0, r, 7, r);

    // Key metrics row
    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'Bias Score',    S.LABEL),
      strCell(cellRef(1, r + 1), 'Execution',     S.LABEL),
      strCell(cellRef(2, r + 1), 'Divergence',    S.LABEL),
      strCell(cellRef(3, r + 1), 'Z-Score',       S.LABEL),
      strCell(cellRef(4, r + 1), 'Confluence',    S.LABEL),
      strCell(cellRef(5, r + 1), 'Lev Net',       S.LABEL),
      strCell(cellRef(6, r + 1), 'Wk Change',     S.LABEL),
      strCell(cellRef(7, r + 1), '% Long',        S.LABEL),
    ], 16);

    const normScore = bias.score != null ? Math.round(((bias.score + 5) / 10) * 100) : null;
    const confScore = conf.confluenceScore ?? conf.score ?? null;

    r = sb.addRow([
      numCell(cellRef(0, r + 1), normScore,                          scoreStyle(normScore)),
      numCell(cellRef(1, r + 1), exec?.score ?? null,                execStyle(exec?.score)),
      strCell(cellRef(2, r + 1), div.state ?? 'NEUTRAL',            S.DATA),
      numCell(cellRef(3, r + 1), zsc.zscore != null ? parseFloat(zsc.zscore.toFixed(2)) : null, S.DATA),
      numCell(cellRef(4, r + 1), confScore != null ? Math.round(confScore) : null, S.DATA),
      strCell(cellRef(5, r + 1), fmtK(latest.smartNet),             S.DATA_BOLD),
      strCell(cellRef(6, r + 1), fmtK(latest.levChgNet),            dirStyle((latest.levChgNet ?? 0) > 0 ? 'bullish' : 'bearish')),
      numCell(cellRef(7, r + 1), latest.smartPctL != null ? parseFloat(latest.smartPctL.toFixed(1)) : null, S.DATA),
    ], 22);

    // Narrative
    const narrative = generatePairNarrative(pr, b, exec);
    const words = narrative.split(' ');
    let line = '';
    const lines = [];
    for (const w of words) {
      if ((line + ' ' + w).length > 100) { lines.push(line.trim()); line = w; }
      else line += ' ' + w;
    }
    if (line.trim()) lines.push(line.trim());

    lines.forEach(ln => {
      r = sb.addRow([strCell(`A${r + 1}`, ln, S.DATA)], 16);
      sb.merge(0, r, 7, r);
    });

    // COT history (last 4 weeks)
    sb.addEmptyRow(6);
    const histR = sb.rows.length + 1;
    r = sb.addRow([strCell(`A${histR}`, 'COT HISTORY (LAST 4 REPORTS)', S.SUBSECTION)], 18);
    sb.merge(0, r, 7, r);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'Report Date', S.LABEL),
      strCell(cellRef(1, r + 1), 'Lev Net',     S.LABEL),
      strCell(cellRef(2, r + 1), 'Lev Long',    S.LABEL),
      strCell(cellRef(3, r + 1), 'Lev Short',   S.LABEL),
      strCell(cellRef(4, r + 1), 'Wk Change',   S.LABEL),
      strCell(cellRef(5, r + 1), '% Long',      S.LABEL),
      strCell(cellRef(6, r + 1), 'Asset Mgr',   S.LABEL),
      strCell(cellRef(7, r + 1), 'Dealers',     S.LABEL),
    ], 16);

    (pr?.weeks ?? []).slice(0, 4).forEach(w => {
      r = sb.addRow([
        strCell(cellRef(0, r + 1), w.isoDate ?? '—',                                              S.DATA),
        strCell(cellRef(1, r + 1), fmtK(w.smartNet),                                              S.DATA_BOLD),
        strCell(cellRef(2, r + 1), fmtK(w.levLong),                                               S.DATA),
        strCell(cellRef(3, r + 1), fmtK(w.levShort),                                              S.DATA),
        strCell(cellRef(4, r + 1), fmtK(w.levChgNet),                                             dirStyle((w.levChgNet ?? 0) > 0 ? 'bullish' : 'bearish')),
        numCell(cellRef(5, r + 1), w.smartPctL != null ? parseFloat(w.smartPctL.toFixed(1)) : null, S.DATA),
        strCell(cellRef(6, r + 1), fmtK(w.assetNet),                                              S.DATA),
        strCell(cellRef(7, r + 1), fmtK(w.dealerNet),                                             S.DATA),
      ], 18);
    });

    // Spacer between pairs
    sb.addEmptyRow(12);
  });

  return sb;
}

// ── STATIC XLSX SCAFFOLDING ───────────────────────────────────────────────────

function contentTypesXml(sheetCount) {
  const sheets = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"  ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const sheetEls = sheets.map((s, i) =>
    `<sheet name="${esc(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>${sheetEls}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

export function generateXLSX(biasArr, fxPairs, opts = {}) {
  const { macroSignal, sentimentData, riskData, snapshotDate, cotDate, execMap = {} } = opts;

  const snap = snapshotDate ?? new Date().toISOString().slice(0, 10);
  const cot  = cotDate ?? (fxPairs ?? [])[0]?.latest?.isoDate ?? snap;

  const sheet1 = buildSummarySheet(biasArr, macroSignal, cot, snap, execMap);
  const sheet2 = buildSnapshotSheet(biasArr, fxPairs, macroSignal, execMap);
  const sheet3 = buildPairDetailSheet(biasArr, fxPairs, execMap, sentimentData, riskData);

  const sheets      = ['Executive Summary', 'Market Snapshot', 'Pair Details'];
  const sheetCount  = sheets.length;

  const files = {
    '[Content_Types].xml':          strToU8(contentTypesXml(sheetCount)),
    '_rels/.rels':                   strToU8(relsXml()),
    'xl/workbook.xml':               strToU8(workbookXml(sheets)),
    'xl/_rels/workbook.xml.rels':    strToU8(workbookRelsXml(sheetCount)),
    'xl/styles.xml':                 strToU8(buildStylesXml()),
    'xl/worksheets/sheet1.xml':      strToU8(sheet1.toXml('Executive Summary')),
    'xl/worksheets/sheet2.xml':      strToU8(sheet2.toXml('Market Snapshot')),
    'xl/worksheets/sheet3.xml':      strToU8(sheet3.toXml('Pair Details')),
  };

  return zipSync(files, { level: 6 });
}
