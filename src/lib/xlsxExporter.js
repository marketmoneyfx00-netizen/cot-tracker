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
import { generateExecutiveSummary, generateMarketRegimeLabel, generateMacroRegimeNarrative } from './narrativeEngine.js';
import { buildCrossAssetContext } from './crossAssetInterpretationEngine.js';
import { buildCbCycleProfiles, enrichCarryPairWithCycle } from './cbCycleEngine.js';
import { buildConvictionProfile, buildPrioritizationMatrix } from './convictionEngine.js';
import { buildTemporalHorizon } from './temporalHorizonEngine.js';
import { buildFlowPersistence } from './flowPersistenceEngine.js';
import { buildRegimeTransition, buildAssetRegimeTrend } from './regimeTransitionEngine.js';
import { buildIntermarketStability } from './intermarketStabilityEngine.js';

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
  const xf = (fontId, fillId, borderId, applyAlignment = '') => {
    const base = `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" applyFont="1" applyFill="1" applyBorder="1"`;
    if (applyAlignment) return `${base} applyAlignment="1">${applyAlignment}</xf>`;
    return `${base}/>`;
  };

  const center  = `<alignment horizontal="center" vertical="center"/>`;
  const left    = `<alignment horizontal="left" vertical="center"/>`;
  const right   = `<alignment horizontal="right" vertical="center"/>`;

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

  toXml() {
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

function buildSummarySheet(biasArr, macroSignal, cotDate, snapshotDate, execMap, riskRegime = null, combinedData = null) {
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
  const regime = generateMarketRegimeLabel(biasArr, macroSignal, riskRegime);

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

  const crossAssetCtx = riskRegime
    ? buildCrossAssetContext({ regime: riskRegime, allBiasArr: biasArr, combinedData, macroSignal })
    : null;
  const narrative = generateExecutiveSummary({ biasArr, macroSignal, cotDate, snapshotDate, regime: riskRegime, crossAssetCtx });
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

  // ── Macro Regime Context (v2) ──
  if (riskRegime?.regime) {
    sb.addEmptyRow(8);
    const regimeNarrative = generateMacroRegimeNarrative(riskRegime, crossAssetCtx);
    r = sb.addRow([strCell('A' + (sb.rows.length + 1), 'MACRO REGIME CONTEXT', S.SECTION)], 24);
    sb.merge(0, r, COLS - 1, r);

    r = sb.addRow([strCell('A' + (r + 1), `Regime: ${regimeNarrative.headline}`, S.DATA_BOLD)], 20);
    sb.merge(0, r, COLS - 1, r);

    // Regime description wrapped to rows
    const rWords = regimeNarrative.body.split(' ');
    let rLine = ''; const rLines = [];
    for (const w of rWords) {
      if ((rLine + ' ' + w).length > 120) { rLines.push(rLine.trim()); rLine = w; }
      else rLine += ' ' + w;
    }
    if (rLine.trim()) rLines.push(rLine.trim());
    rLines.forEach(ln => {
      r = sb.addRow([strCell('A' + (r + 1), ln, S.DATA)], 16);
      sb.merge(0, r, COLS - 1, r);
    });

    // Key drivers
    if (regimeNarrative.keyDrivers?.length) {
      sb.addEmptyRow(6);
      r = sb.addRow([strCell('A' + (sb.rows.length + 1), 'KEY CROSS-ASSET DRIVERS', S.LABEL)], 18);
      sb.merge(0, r, COLS - 1, r);
      regimeNarrative.keyDrivers.forEach(d => {
        r = sb.addRow([strCell('A' + (r + 1), `· ${d}`, S.DATA)], 16);
        sb.merge(0, r, COLS - 1, r);
      });
    }
  }

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

// ── ASSET-CLASS GROUPED SHEET ────────────────────────────────────────────────
// Generic sheet builder for any asset class (FX, index, bonds, commodities).
// Adapts column headers and reading framing to the asset class.

function buildAssetClassSheet(biasArr, pairsArr, cat, execMap, opts = {}) {
  const { convictionMap = {}, horizonMap = {}, flowPersistenceMap = {}, regimeTrendMap = {} } = opts;
  const sb      = new SheetBuilder();
  const pairMap = Object.fromEntries((pairsArr ?? []).map(p => [p.pair, p]));

  // Filter to the requested asset class
  const filtered = (biasArr ?? []).filter(b => {
    const pr = pairMap[b.pair];
    return (pr?.cat ?? b.cat ?? 'fx') === cat;
  });

  // Column widths (17 cols total — 3 Phase 2: Conviction/Swing/Macro + 3 Phase 3: FlowState/Exhaust%/RegimeTrend)
  sb.setColWidth(0, 14);  // Symbol
  sb.setColWidth(1, 24);  // Label
  sb.setColWidth(2, 12);  // Bias Score
  sb.setColWidth(3, 20);  // Bias Label
  sb.setColWidth(4, 14);  // Lev Net
  sb.setColWidth(5, 12);  // Wk Change
  sb.setColWidth(6, 10);  // % Long
  sb.setColWidth(7, 12);  // Z-Score
  sb.setColWidth(8, 14);  // Percentile
  sb.setColWidth(9, 18);  // Divergence
  sb.setColWidth(10, 22); // Reading / Context
  sb.setColWidth(11, 14); // Conviction Score
  sb.setColWidth(12, 16); // Swing View
  sb.setColWidth(13, 16); // Macro View
  sb.setColWidth(14, 22); // Flow State
  sb.setColWidth(15, 14); // Exhaustion %
  sb.setColWidth(16, 16); // Regime Trend

  const CAT_TITLES = {
    fx:          'FX — Currency Pairs',
    index:       'EQUITY INDICES',
    bonds:       'FIXED INCOME — Bond Futures',
    commodities: 'COMMODITIES',
  };
  const CAT_READING_HEADER = {
    fx:          'Carry / Regime Context',
    index:       'Risk Appetite Signal',
    bonds:       'Rate Expectation Signal',
    commodities: 'Commodity Thesis',
  };

  const title = CAT_TITLES[cat] ?? cat.toUpperCase();
  const readingHeader = CAT_READING_HEADER[cat] ?? 'Context';

  const COLS = 17;
  let r = sb.addRow([strCell('A1', title, S.NAV_HEADER)], 30);
  sb.merge(0, r, COLS - 1, r);

  if (!filtered.length) {
    r = sb.addRow([strCell('A2', `No ${cat} data available in this upload.`, S.DATA)], 20);
    sb.merge(0, r, COLS - 1, r);
    return sb;
  }

  const hdrs = [
    'Symbol', 'Description', 'Bias Score', 'Bias Label',
    'Lev Net', 'Wk Change', '% Long', 'Z-Score', 'Percentile',
    'Divergence', readingHeader,
    'Conviction', 'Swing View', 'Macro View',
    'Flow State', 'Exhaustion %', 'Regime Trend',
  ];
  r = sb.addRow(hdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 22);

  filtered.forEach((b, idx) => {
    const pr             = pairMap[b.pair];
    const bias           = b.bias ?? b;
    const zsc            = b.zscore ?? {};
    const div            = b.divergence ?? {};
    const latest         = pr?.latest ?? pr?.weeks?.[0] ?? {};
    const conviction     = convictionMap[b.pair];
    const horizon        = horizonMap[b.pair];
    const fp             = flowPersistenceMap[b.pair];
    const regimeTrend    = regimeTrendMap[b.pair] ?? '—';

    const normScore      = bias.score != null ? Math.round(((bias.score + 5) / 10) * 100) : null;
    const altStyle       = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
    const convScore      = conviction?.conviction_score ?? null;
    const convLabel      = conviction?.conviction_label ?? '—';
    const swingView      = horizon?.swing?.view ?? '—';
    const macroView      = horizon?.macro?.view ?? '—';
    const convCellVal    = convScore != null ? `${convScore} — ${convLabel}` : '—';
    const convStyle      = convScore != null && convScore >= 65 ? S.BULLISH : convScore != null && convScore >= 45 ? S.NEUTRAL : S.BEARISH;

    // Phase 3 fields
    const flowState      = fp?.flow_state_label ?? fp?.flow_state ?? '—';
    const exhaustionPct  = fp?.exhaustion_probability ?? null;
    const exhaustStyle   = exhaustionPct != null && exhaustionPct >= 60 ? S.BEARISH : exhaustionPct != null && exhaustionPct >= 35 ? S.NEUTRAL : S.BULLISH;
    const regTrendStyle  = regimeTrend === 'LEADING' || regimeTrend === 'ALIGNED' ? S.BULLISH
      : regimeTrend === 'DIVERGING' || regimeTrend === 'REVERSING' ? S.BEARISH : altStyle;

    // Asset-class-specific reading column
    const reading = buildAssetClassReading(cat, bias.direction, b);

    r = sb.addRow([
      strCell(cellRef(0,  r + 1), b.pair,                                                         S.DATA_BOLD),
      strCell(cellRef(1,  r + 1), pr?.label ?? b.pair,                                            altStyle),
      numCell(cellRef(2,  r + 1), normScore,                                                       scoreStyle(normScore)),
      strCell(cellRef(3,  r + 1), bias.label ?? '—',                                              dirStyle(bias.direction)),
      strCell(cellRef(4,  r + 1), fmtK(latest.smartNet),                                          S.DATA_BOLD),
      strCell(cellRef(5,  r + 1), fmtK(latest.levChgNet),                                         dirStyle((latest.levChgNet ?? 0) > 0 ? 'bullish' : (latest.levChgNet ?? 0) < 0 ? 'bearish' : 'neutral')),
      numCell(cellRef(6,  r + 1), latest.smartPctL != null ? parseFloat(latest.smartPctL.toFixed(1)) : null, S.DATA),
      numCell(cellRef(7,  r + 1), zsc.zscore != null ? parseFloat(zsc.zscore.toFixed(2)) : null,  S.DATA),
      numCell(cellRef(8,  r + 1), zsc.percentile ?? null,                                         S.DATA),
      strCell(cellRef(9,  r + 1), div.state ?? 'NEUTRAL',                                         S.DATA),
      strCell(cellRef(10, r + 1), reading,                                                         altStyle),
      strCell(cellRef(11, r + 1), convCellVal,                                                     convStyle ?? altStyle),
      strCell(cellRef(12, r + 1), swingView,                                                       dirStyle(swingView.includes('BULL') ? 'bullish' : swingView.includes('BEAR') ? 'bearish' : 'neutral')),
      strCell(cellRef(13, r + 1), macroView,                                                       dirStyle(macroView.includes('BULL') ? 'bullish' : macroView.includes('BEAR') ? 'bearish' : 'neutral')),
      strCell(cellRef(14, r + 1), flowState,                                                       altStyle),
      numCell(cellRef(15, r + 1), exhaustionPct,                                                   exhaustStyle),
      strCell(cellRef(16, r + 1), regimeTrend,                                                     regTrendStyle),
    ], 20);
  });

  return sb;
}

function buildAssetClassReading(cat, direction, biasEntry) {
  const dir = direction ?? 'neutral';
  switch (cat) {
    case 'index':
      if (dir === 'bullish') return 'Risk-On — equity risk appetite expanding';
      if (dir === 'bearish') return 'Risk-Off — institutional de-risking in equity futures';
      return 'Neutral — no dominant equity directional signal';

    case 'bonds':
      if (dir === 'bullish') return 'Rate-decline expectation — duration accumulation';
      if (dir === 'bearish') return 'Rate-rise expectation — bond selling / inflation premium';
      return 'Neutral — no dominant rate expectation signal';

    case 'commodities': {
      const asset = biasEntry.pair ?? '';
      if (asset === 'GOLD' || asset === 'SILVER') {
        if (dir === 'bullish') return 'Haven / Inflation hedge — precious metals bid';
        if (dir === 'bearish') return 'Risk appetite / Disinflation — metals selling pressure';
        return 'Neutral — no dominant precious metals signal';
      }
      if (asset === 'WTI') {
        if (dir === 'bullish') return 'Energy demand / Supply pressure — growth or supply-shock bid';
        if (dir === 'bearish') return 'Demand destruction / Disinflation — oil selling';
        return 'Neutral — no dominant energy signal';
      }
      return dir === 'bullish' ? 'Bullish institutional commodity positioning'
           : dir === 'bearish' ? 'Bearish institutional commodity positioning'
           : 'Neutral';
    }

    case 'fx':
    default:
      if (dir === 'bullish') return 'Long base currency — COT institutional bias bullish';
      if (dir === 'bearish') return 'Short base currency — COT institutional bias bearish';
      return 'Neutral — no dominant FX directional bias';
  }
}

// ── MACRO / RATES SHEET ───────────────────────────────────────────────────────

function buildMacroRatesSheet(macroSignal, riskRegime, ratesData, cotDate) {
  const sb   = new SheetBuilder();
  const COLS = 8;

  sb.setColWidth(0, 22);
  sb.setColWidth(1, 18);
  sb.setColWidth(2, 18);
  sb.setColWidth(3, 18);
  sb.setColWidth(4, 14);
  sb.setColWidth(5, 14);
  sb.setColWidth(6, 14);
  sb.setColWidth(7, 28);

  let r = sb.addRow([strCell('A1', 'MACRO / RATES — Central Bank & Yield Signal Layer', S.NAV_HEADER)], 30);
  sb.merge(0, r, COLS - 1, r);

  // ── Macro Signal block ──
  if (macroSignal) {
    sb.addEmptyRow(8);
    r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'USD MACRO SIGNAL', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'USD Bias',    S.LABEL),
      strCell(cellRef(1, r + 1), 'Confidence',  S.LABEL),
      strCell(cellRef(2, r + 1), 'CFTC Date',   S.LABEL),
    ], 16);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), macroSignal.bias?.replace(/_/g, ' ') ?? '—', S.DATA_BOLD),
      numCell(cellRef(1, r + 1), macroSignal.confidence ?? null, S.DATA),
      strCell(cellRef(2, r + 1), cotDate ?? '—', S.DATA),
    ], 20);

    // Drivers
    if (macroSignal.drivers?.length) {
      sb.addEmptyRow(4);
      r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'YIELD SPREAD DRIVERS', S.LABEL)], 16);
      sb.merge(0, r, COLS - 1, r);
      macroSignal.drivers.forEach(d => {
        r = sb.addRow([strCell(`A${r + 1}`, `  · ${d}`, S.DATA)], 16);
        sb.merge(0, r, COLS - 1, r);
      });
    }

    // Implication
    if (macroSignal.implication) {
      sb.addEmptyRow(4);
      r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'MACRO IMPLICATION', S.LABEL)], 16);
      sb.merge(0, r, COLS - 1, r);
      r = sb.addRow([strCell(`A${r + 1}`, macroSignal.implication, S.DATA)], 16);
      sb.merge(0, r, COLS - 1, r);
    }
  }

  // ── Risk Regime block ──
  if (riskRegime?.regime) {
    sb.addEmptyRow(10);
    r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'MACRO RISK REGIME', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'Regime',      S.LABEL),
      strCell(cellRef(1, r + 1), 'Confidence',  S.LABEL),
      strCell(cellRef(2, r + 1), 'Signals',     S.LABEL),
    ], 16);

    const sigs = riskRegime.signals ?? {};
    const sigStr = [
      sigs.equities ? `Equities: ${sigs.equities}` : null,
      sigs.bonds    ? `Bonds: ${sigs.bonds}`        : null,
      sigs.gold     ? `Gold: ${sigs.gold}`           : null,
      sigs.oil      ? `Oil: ${sigs.oil}`             : null,
      sigs.usd      ? `USD: ${sigs.usd}`             : null,
    ].filter(Boolean).join(' · ');

    r = sb.addRow([
      strCell(cellRef(0, r + 1), riskRegime.label ?? riskRegime.regime, S.DATA_BOLD),
      numCell(cellRef(1, r + 1), riskRegime.confidence ?? null,         S.DATA),
      strCell(cellRef(2, r + 1), sigStr || '—',                          S.DATA),
    ], 20);

    if (riskRegime.keyDrivers?.length) {
      sb.addEmptyRow(4);
      r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'KEY CROSS-ASSET DRIVERS', S.LABEL)], 16);
      sb.merge(0, r, COLS - 1, r);
      riskRegime.keyDrivers.forEach(d => {
        r = sb.addRow([strCell(`A${r + 1}`, `  · ${d}`, S.DATA)], 16);
        sb.merge(0, r, COLS - 1, r);
      });
    }
  }

  // ── FX Carry Differentials ──
  const pairs = ratesData?.pairs;
  if (pairs?.length) {
    sb.addEmptyRow(10);
    r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'FX CARRY DIFFERENTIALS — Central Bank Rates', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    const hdrs = ['Pair', 'Base CB', 'Base Rate', 'Quote CB', 'Quote Rate', 'Diff (bps)', 'Carry Dir', 'Carry Score'];
    r = sb.addRow(hdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);

    pairs.forEach((p, idx) => {
      const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
      const carryStyle = p.carry_direction === 'long_base'  ? S.BULLISH
                       : p.carry_direction === 'long_quote' ? S.BEARISH : S.NEUTRAL;
      r = sb.addRow([
        strCell(cellRef(0, r + 1), p.pair         ?? '—',                                   S.DATA_BOLD),
        strCell(cellRef(1, r + 1), p.base_bank    ?? '—',                                   altStyle),
        numCell(cellRef(2, r + 1), p.base_rate    != null ? parseFloat(p.base_rate.toFixed(2)) : null, S.DATA),
        strCell(cellRef(3, r + 1), p.quote_bank   ?? '—',                                   altStyle),
        numCell(cellRef(4, r + 1), p.quote_rate   != null ? parseFloat(p.quote_rate.toFixed(2)) : null, S.DATA),
        numCell(cellRef(5, r + 1), p.rate_diff_bps ?? null,                                 p.rate_diff_bps > 0 ? S.SCORE_BULL : p.rate_diff_bps < 0 ? S.SCORE_BEAR : S.DATA),
        strCell(cellRef(6, r + 1), p.carry_direction?.replace(/_/g, ' ') ?? '—',           carryStyle),
        numCell(cellRef(7, r + 1), p.carry_score != null ? parseFloat(p.carry_score.toFixed(2)) : null, S.DATA),
      ], 18);
    });
  }

  // ── Central Bank Stances ──
  const banks = ratesData?.banks;
  if (banks && Object.keys(banks).length) {
    sb.addEmptyRow(10);
    r = sb.addRow([strCell(`A${sb.rows.length + 1}`, 'CENTRAL BANK STANCE SUMMARY', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    const hdrs2 = ['Bank', 'Current Rate', 'Prev Rate', 'Change (bps)', 'Stance Score', 'Stance Label', 'Signal', 'Last Decision'];
    r = sb.addRow(hdrs2.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);

    Object.entries(banks).forEach(([bankId, bk], idx) => {
      const altStyle    = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
      const stanceStyle = (bk.stanceScore ?? 0) > 0 ? S.BULLISH
                        : (bk.stanceScore ?? 0) < 0 ? S.BEARISH : S.NEUTRAL;
      r = sb.addRow([
        strCell(cellRef(0, r + 1), bankId,                                                     S.DATA_BOLD),
        numCell(cellRef(1, r + 1), bk.current != null ? parseFloat(bk.current.toFixed(2)) : null, S.DATA),
        numCell(cellRef(2, r + 1), bk.previous != null ? parseFloat(bk.previous.toFixed(2)) : null, altStyle),
        numCell(cellRef(3, r + 1), bk.changeBps ?? null,                                       bk.changeBps > 0 ? S.SCORE_BULL : bk.changeBps < 0 ? S.SCORE_BEAR : S.DATA),
        numCell(cellRef(4, r + 1), bk.stanceScore ?? null,                                     stanceStyle),
        strCell(cellRef(5, r + 1), bk.stanceLabel ?? '—',                                     altStyle),
        strCell(cellRef(6, r + 1), bk.signalLabel ?? '—',                                     S.DATA),
        strCell(cellRef(7, r + 1), bk.lastDate    ?? '—',                                     altStyle),
      ], 18);
    });
  }

  return sb;
}

// ── RAW DATA SHEET ────────────────────────────────────────────────────────────
// Full positioning numbers for all assets. For quant/automation use.

function buildRawDataSheet(biasArr, pairsArr) {
  const sb      = new SheetBuilder();
  const pairMap = Object.fromEntries((pairsArr ?? []).map(p => [p.pair, p]));
  const COLS    = 12;

  sb.setColWidth(0,  12); sb.setColWidth(1,  10); sb.setColWidth(2,  24);
  sb.setColWidth(3,  10); sb.setColWidth(4,  12); sb.setColWidth(5,  12);
  sb.setColWidth(6,  12); sb.setColWidth(7,  10); sb.setColWidth(8,  12);
  sb.setColWidth(9,  12); sb.setColWidth(10, 12); sb.setColWidth(11, 16);

  let r = sb.addRow([strCell('A1', 'RAW CFTC POSITIONING DATA — All Asset Classes', S.NAV_HEADER)], 30);
  sb.merge(0, r, COLS - 1, r);

  const hdrs = [
    'Symbol', 'Cat', 'Report Date', 'Lev Long', 'Lev Short', 'Lev Net',
    'Wk Chg Net', '% Long', 'Asset Mgr Net', 'Dealer Net', 'Open Interest', 'Source',
  ];
  r = sb.addRow(hdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 22);

  (biasArr ?? []).forEach((b, idx) => {
    const pr      = pairMap[b.pair];
    const latest  = pr?.latest ?? pr?.weeks?.[0] ?? {};
    const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;

    r = sb.addRow([
      strCell(cellRef(0,  r + 1), b.pair,                                                          S.DATA_BOLD),
      strCell(cellRef(1,  r + 1), (pr?.cat ?? '—').toUpperCase(),                                  altStyle),
      strCell(cellRef(2,  r + 1), latest.isoDate ?? '—',                                           S.DATA),
      strCell(cellRef(3,  r + 1), fmtK(latest.levLong),                                            S.DATA),
      strCell(cellRef(4,  r + 1), fmtK(latest.levShort),                                           S.DATA),
      strCell(cellRef(5,  r + 1), fmtK(latest.smartNet),                                           dirStyle((latest.smartNet ?? 0) > 0 ? 'bullish' : (latest.smartNet ?? 0) < 0 ? 'bearish' : 'neutral')),
      strCell(cellRef(6,  r + 1), fmtK(latest.levChgNet),                                          dirStyle((latest.levChgNet ?? 0) > 0 ? 'bullish' : (latest.levChgNet ?? 0) < 0 ? 'bearish' : 'neutral')),
      numCell(cellRef(7,  r + 1), latest.smartPctL != null ? parseFloat(latest.smartPctL.toFixed(1)) : null, S.DATA),
      strCell(cellRef(8,  r + 1), fmtK(latest.assetNet),                                           altStyle),
      strCell(cellRef(9,  r + 1), fmtK(latest.dealerNet),                                          altStyle),
      strCell(cellRef(10, r + 1), fmtK(latest.openInterest),                                       S.DATA),
      strCell(cellRef(11, r + 1), latest.source ?? pr?.source ?? '—',                              altStyle),
    ], 18);
  });

  return sb;
}

// ── TOP SETUPS SHEET ──────────────────────────────────────────────────────────

function buildTopSetupsSheet(prioritization, snap) {
  const sb   = new SheetBuilder();
  const COLS = 8;

  sb.setColWidth(0, 14); sb.setColWidth(1, 12); sb.setColWidth(2, 10);
  sb.setColWidth(3, 14); sb.setColWidth(4, 16); sb.setColWidth(5, 16);
  sb.setColWidth(6, 12); sb.setColWidth(7, 36);

  let r = sb.addRow([strCell('A1', `DECISION PRIORITY MATRIX — ${snap ?? ''}`, S.NAV_HEADER)], 30);
  sb.merge(0, r, COLS - 1, r);

  const sectionHdr = (label) => {
    r = sb.addRow([strCell(cellRef(0, r + 1), label, S.SUBSECTION)], 22);
    sb.merge(0, r, COLS - 1, r);
  };

  const colHdrs = ['ASSET', 'DIRECTION', 'SCORE', 'CONVICTION', 'SWING VIEW', 'MACRO VIEW', 'TIER', 'KEY CONFIRMING FACTORS'];
  const addColHdrs = () => {
    r = sb.addRow(colHdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);
  };

  const addRow = (a, idx) => {
    const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
    const dir      = a.direction ?? 'neutral';
    const dirSt    = dir === 'bullish' ? S.BULLISH : dir === 'bearish' ? S.BEARISH : S.NEUTRAL;
    const convSt   = (a.conviction_score ?? 0) >= 65 ? S.BULLISH : (a.conviction_score ?? 0) >= 45 ? S.NEUTRAL : S.BEARISH;
    r = sb.addRow([
      strCell(cellRef(0, r + 1), a.pair ?? '—',                                        S.DATA_BOLD),
      strCell(cellRef(1, r + 1), (dir).toUpperCase(),                                  dirSt),
      numCell(cellRef(2, r + 1), a.conviction_score ?? null,                           convSt),
      strCell(cellRef(3, r + 1), a.conviction_label ?? '—',                            convSt),
      strCell(cellRef(4, r + 1), a.swing_view ?? '—',                                  (a.swing_view ?? '').includes('BULL') ? S.BULLISH : (a.swing_view ?? '').includes('BEAR') ? S.BEARISH : altStyle),
      strCell(cellRef(5, r + 1), a.macro_view ?? '—',                                  (a.macro_view ?? '').includes('BULL') ? S.BULLISH : (a.macro_view ?? '').includes('BEAR') ? S.BEARISH : altStyle),
      strCell(cellRef(6, r + 1), a.confidence_tier ?? '—',                             altStyle),
      strCell(cellRef(7, r + 1), (a.key_factors ?? []).join(' · '),                    altStyle),
    ], 18);
  };

  // Top Opportunities
  if (prioritization?.top_opportunities?.length) {
    sectionHdr('TOP OPPORTUNITIES — High Conviction + Favorable Execution');
    addColHdrs();
    prioritization.top_opportunities.forEach((a, i) => addRow(a, i));
  }

  // Most Aligned
  if (prioritization?.most_aligned?.length) {
    sectionHdr('MOST ALIGNED — Maximum Confirming Signals (5+ factors)');
    addColHdrs();
    prioritization.most_aligned.forEach((a, i) => addRow(a, i));
  }

  // Regime Leaders
  if (prioritization?.regime_leaders?.length) {
    sectionHdr('REGIME LEADERS — Macro Regime Confirmed');
    addColHdrs();
    prioritization.regime_leaders.forEach((a, i) => addRow(a, i));
  }

  // Crowded Trades
  if (prioritization?.crowded_trades?.length) {
    sectionHdr('CROWDED / FADE RISK — Extreme Positioning + Weak Conviction');
    r = sb.addRow(['ASSET','DIRECTION','Z-SCORE','CONVICTION','','','','WARNING'].map((h, i) =>
      strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);
    prioritization.crowded_trades.forEach((a, idx) => {
      const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
      const dir = a.direction ?? 'neutral';
      r = sb.addRow([
        strCell(cellRef(0, r + 1), a.pair ?? '—',                    S.DATA_BOLD),
        strCell(cellRef(1, r + 1), dir.toUpperCase(),                  dir === 'bullish' ? S.BULLISH : S.BEARISH),
        numCell(cellRef(2, r + 1), a.zscore != null ? parseFloat(a.zscore.toFixed(2)) : null, S.DATA),
        strCell(cellRef(3, r + 1), a.conviction_label ?? '—',         S.BEARISH),
        strCell(cellRef(4, r + 1), '',                                 altStyle),
        strCell(cellRef(5, r + 1), '',                                 altStyle),
        strCell(cellRef(6, r + 1), '',                                 altStyle),
        strCell(cellRef(7, r + 1), a.warning ?? '',                    altStyle),
      ], 18);
    });
  }

  // Contrarian Extremes
  if (prioritization?.contrarian_extremes?.length) {
    sectionHdr('CONTRARIAN EXTREMES — Extreme Positioning Opposite to Bias');
    r = sb.addRow(['ASSET','DIRECTION','Z-SCORE','PERCENTILE','','','','SIGNAL'].map((h, i) =>
      strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);
    prioritization.contrarian_extremes.forEach((a, idx) => {
      const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
      r = sb.addRow([
        strCell(cellRef(0, r + 1), a.pair ?? '—',                    S.DATA_BOLD),
        strCell(cellRef(1, r + 1), (a.direction ?? '').toUpperCase(), dirStyle(a.direction)),
        numCell(cellRef(2, r + 1), a.zscore != null ? parseFloat(a.zscore.toFixed(2)) : null, S.DATA),
        numCell(cellRef(3, r + 1), a.percentile ?? null,              S.DATA),
        strCell(cellRef(4, r + 1), '', altStyle), strCell(cellRef(5, r + 1), '', altStyle),
        strCell(cellRef(6, r + 1), '', altStyle),
        strCell(cellRef(7, r + 1), a.contrarian_signal ?? '',         altStyle),
      ], 18);
    });
  }

  return sb;
}

// ── FLOW & REGIME SHEET ───────────────────────────────────────────────────────

function buildFlowRegimeSheet(biasArr, pairsArr, regimeTransition, intermarketStability, snap) {
  const sb      = new SheetBuilder();
  const pairMap = Object.fromEntries((pairsArr ?? []).map(p => [p.pair, p]));
  const COLS    = 9;

  sb.setColWidth(0, 14); sb.setColWidth(1, 12); sb.setColWidth(2, 24);
  sb.setColWidth(3, 14); sb.setColWidth(4, 16); sb.setColWidth(5, 16);
  sb.setColWidth(6, 14); sb.setColWidth(7, 18); sb.setColWidth(8, 16);

  let r = sb.addRow([strCell('A1', 'FLOW PERSISTENCE & REGIME DYNAMICS', S.NAV_HEADER)], 30);
  sb.merge(0, r, COLS - 1, r);

  // ── Regime Transition Summary ──────────────────────────────────────────────
  if (regimeTransition) {
    r = sb.addRow([strCell(cellRef(0, r + 1), 'REGIME TRANSITION ANALYSIS', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'Transition Type',   S.DATA_BOLD),
      strCell(cellRef(1, r + 1), regimeTransition.transition_label ?? '—', S.DATA),
      strCell(cellRef(2, r + 1), 'Velocity',          S.DATA_BOLD),
      strCell(cellRef(3, r + 1), regimeTransition.velocity ?? '—', S.DATA),
      strCell(cellRef(4, r + 1), 'Stability',         S.DATA_BOLD),
      numCell(cellRef(5, r + 1), regimeTransition.stability ?? null,
        (regimeTransition.stability ?? 0) >= 65 ? S.BULLISH : (regimeTransition.stability ?? 0) >= 40 ? S.NEUTRAL : S.BEARISH),
      strCell(cellRef(6, r + 1), 'Confidence Trend',  S.DATA_BOLD),
      strCell(cellRef(7, r + 1), regimeTransition.confidence_trend ?? '—',
        regimeTransition.confidence_trend === 'IMPROVING' ? S.BULLISH
        : regimeTransition.confidence_trend === 'DETERIORATING' ? S.BEARISH : S.DATA),
      strCell(cellRef(8, r + 1), snap ?? '', S.DATA),
    ], 22);

    if (regimeTransition.emerging_regime) {
      r = sb.addRow([
        strCell(cellRef(0, r + 1), 'Emerging Regime', S.DATA_BOLD),
        strCell(cellRef(1, r + 1), regimeTransition.emerging_regime, S.NEUTRAL),
        strCell(cellRef(2, r + 1), 'Key Watch',       S.DATA_BOLD),
        strCell(cellRef(3, r + 1), regimeTransition.regime_timeline?.key_watch ?? '—', S.DATA),
      ], 20);
      sb.merge(3, r, COLS - 1, r);
    }

    if (regimeTransition.confirmation_signals?.length) {
      r = sb.addRow([strCell(cellRef(0, r + 1), 'Confirmation Signals', S.ACCENT_HDR)], 18);
      sb.merge(0, r, COLS - 1, r);
      regimeTransition.confirmation_signals.forEach(s => {
        r = sb.addRow([strCell(cellRef(0, r + 1), `▶  ${s}`, S.DATA)], 18);
        sb.merge(0, r, COLS - 1, r);
      });
    }
  }

  // ── Intermarket Stability Summary ──────────────────────────────────────────
  if (intermarketStability) {
    r = sb.addRow([strCell(cellRef(0, r + 1), '', S.DEFAULT)], 10);
    r = sb.addRow([strCell(cellRef(0, r + 1), 'INTERMARKET STABILITY', S.SECTION)], 22);
    sb.merge(0, r, COLS - 1, r);

    r = sb.addRow([
      strCell(cellRef(0, r + 1), 'Stability Score',  S.DATA_BOLD),
      numCell(cellRef(1, r + 1), intermarketStability.stability_score ?? null,
        (intermarketStability.stability_score ?? 0) >= 65 ? S.BULLISH : (intermarketStability.stability_score ?? 0) >= 40 ? S.NEUTRAL : S.BEARISH),
      strCell(cellRef(2, r + 1), 'Regime Coherence',    S.DATA_BOLD),
      strCell(cellRef(3, r + 1), intermarketStability.regime_coherence ?? '—', S.DATA),
      strCell(cellRef(4, r + 1), 'Structural Integrity', S.DATA_BOLD),
      numCell(cellRef(5, r + 1), intermarketStability.structural_integrity ?? null, S.DATA),
      strCell(cellRef(6, r + 1), 'Anomalies',           S.DATA_BOLD),
      numCell(cellRef(7, r + 1), intermarketStability.breakdowns?.length ?? 0,
        (intermarketStability.breakdowns?.length ?? 0) > 0 ? S.BEARISH : S.BULLISH),
    ], 22);

    if (intermarketStability.breakdowns?.length) {
      r = sb.addRow([strCell(cellRef(0, r + 1), 'ANOMALY DETECTIONS', S.ACCENT_HDR)], 18);
      sb.merge(0, r, COLS - 1, r);
      const bkHdrs = ['Severity', 'Type', 'Assets', 'Interpretation'];
      r = sb.addRow(bkHdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.SECTION)), 20);
      sb.merge(3, r, COLS - 1, r);
      intermarketStability.breakdowns.forEach(b => {
        r = sb.addRow([
          strCell(cellRef(0, r + 1), b.severity,             b.severity === 'CRITICAL' || b.severity === 'SEVERE' ? S.BEARISH : S.NEUTRAL),
          strCell(cellRef(1, r + 1), b.type?.replace(/_/g, ' ') ?? '—', S.DATA),
          strCell(cellRef(2, r + 1), (b.assets ?? []).join(', '), S.DATA),
          strCell(cellRef(3, r + 1), b.interpretation ?? '—', S.DATA),
        ], 20);
        sb.merge(3, r, COLS - 1, r);
      });
    }
  }

  // ── Per-Asset Flow Persistence Table ──────────────────────────────────────
  r = sb.addRow([strCell(cellRef(0, r + 1), '', S.DEFAULT)], 10);
  r = sb.addRow([strCell(cellRef(0, r + 1), 'PER-ASSET FLOW PERSISTENCE & POSITIONING MOMENTUM', S.SECTION)], 22);
  sb.merge(0, r, COLS - 1, r);

  const fpHdrs = ['Symbol', 'Cat', 'Flow State', 'Velocity', 'Acceleration', 'Exhaust%', 'Conv. Trend', 'Str. Strength', 'Regime Trend'];
  r = sb.addRow(fpHdrs.map((h, i) => strCell(cellRef(i, r + 1), h, S.ACCENT_HDR)), 20);

  (biasArr ?? []).forEach((b, idx) => {
    const pr = pairMap[b.pair];
    if (!pr) return;
    const fp = buildFlowPersistence(pr, b);
    const regimeTrend = buildAssetRegimeTrend(b, fp, null, pr.cat ?? 'fx');
    const altStyle = idx % 2 === 1 ? S.ALT_ROW : S.DATA;
    const exhStyle = (fp.exhaustion_probability ?? 0) >= 60 ? S.BEARISH : (fp.exhaustion_probability ?? 0) >= 35 ? S.NEUTRAL : S.BULLISH;

    r = sb.addRow([
      strCell(cellRef(0, r + 1), b.pair,                                   S.DATA_BOLD),
      strCell(cellRef(1, r + 1), (pr.cat ?? 'fx').toUpperCase(),           altStyle),
      strCell(cellRef(2, r + 1), fp.flow_state_label ?? fp.flow_state,     altStyle),
      strCell(cellRef(3, r + 1), fp.positioning_velocity != null ? `${fp.positioning_velocity > 0 ? '+' : ''}${Math.round(fp.positioning_velocity / 1000)}K` : '—', altStyle),
      strCell(cellRef(4, r + 1), fp.positioning_acceleration != null ? `${fp.positioning_acceleration > 0 ? '+' : ''}${Math.round(fp.positioning_acceleration / 1000)}K` : '—', altStyle),
      numCell(cellRef(5, r + 1), fp.exhaustion_probability ?? null,        exhStyle),
      strCell(cellRef(6, r + 1), fp.conviction_trend ?? '—',               fp.conviction_trend === 'BUILDING' ? S.BULLISH : fp.conviction_trend === 'FADING' || fp.conviction_trend === 'REVERSING' ? S.BEARISH : altStyle),
      numCell(cellRef(7, r + 1), fp.structural_strength ?? null,           S.DATA),
      strCell(cellRef(8, r + 1), regimeTrend,                              regimeTrend === 'LEADING' || regimeTrend === 'ALIGNED' ? S.BULLISH : regimeTrend === 'DIVERGING' || regimeTrend === 'REVERSING' ? S.BEARISH : altStyle),
    ], 18);
  });

  return sb;
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

export function generateXLSX(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal, snapshotDate, cotDate,
    execMap = {}, riskRegime = null, combinedData = null, ratesData = null,
  } = opts;

  const snap = snapshotDate ?? new Date().toISOString().slice(0, 10);
  const cot  = cotDate ?? (fxPairs ?? [])[0]?.latest?.isoDate ?? snap;

  // allPairsArr: ExportPanel passes allPairsArr (cross-asset) as fxPairs
  const allPairsArr = fxPairs;
  const pairMap     = Object.fromEntries((allPairsArr ?? []).map(p => [p.pair, p]));
  const getcat      = (b) => pairMap[b.pair]?.cat ?? b.cat ?? 'fx';
  const ratesList   = ratesData?.pairs ?? [];

  // ── Conviction + Horizon + Flow Persistence maps ─────────────────────────────
  const cycleProfiles     = ratesData ? buildCbCycleProfiles(ratesData) : {};
  const convictionMap     = {};
  const horizonMap        = {};
  const flowPersistenceMap = {};
  const regimeTrendMap    = {};
  const decisionAssets    = [];

  biasArr.forEach(b => {
    const pairRow = pairMap[b.pair];
    if (!pairRow) return;
    const exec     = execMap[b.pair];
    const pairKey  = b.pair?.replace('/', '').toUpperCase();
    const ratesRaw = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);
    const enriched = ratesRaw && Object.keys(cycleProfiles).length
      ? enrichCarryPairWithCycle(ratesRaw, cycleProfiles) : ratesRaw ?? null;
    const carryConviction = enriched?.carry_conviction ?? 'NEUTRAL';
    const conviction = buildConvictionProfile(b, pairRow, {
      riskRegime, cycleProfiles, exec, carryConviction,
    });
    const horizon = buildTemporalHorizon(b, pairRow, {
      exec, riskRegime, cycleProfiles, convictionProfile: conviction,
    });
    const fp          = buildFlowPersistence(pairRow, b);
    const cat         = pairRow.cat ?? 'fx';
    const regimeTrend = buildAssetRegimeTrend(b, fp, riskRegime, cat);
    convictionMap[b.pair]      = conviction;
    horizonMap[b.pair]         = horizon;
    flowPersistenceMap[b.pair] = fp;
    regimeTrendMap[b.pair]     = regimeTrend;
    decisionAssets.push({
      pair: b.pair, cat,
      direction: b.bias?.direction ?? b.direction ?? 'neutral',
      conviction, horizon, exec, biasEntry: b, flowPersistence: fp,
    });
  });

  const prioritization       = buildPrioritizationMatrix(decisionAssets);
  const regimeTransition     = buildRegimeTransition(riskRegime, decisionAssets);
  const intermarketStability = buildIntermarketStability(riskRegime, biasArr);
  const assetOpts            = { convictionMap, horizonMap, flowPersistenceMap, regimeTrendMap };

  // Split biasArr by asset class
  const fxBias   = biasArr.filter(b => getcat(b) === 'fx');
  const idxBias  = biasArr.filter(b => getcat(b) === 'index');
  const bndBias  = biasArr.filter(b => getcat(b) === 'bonds');
  const cmdBias  = biasArr.filter(b => getcat(b) === 'commodities');

  const sheet1 = buildSummarySheet(biasArr, macroSignal, cot, snap, execMap, riskRegime, combinedData);
  const sheet2 = buildAssetClassSheet(fxBias,  allPairsArr, 'fx',          execMap, assetOpts);
  const sheet3 = buildAssetClassSheet(idxBias, allPairsArr, 'index',       execMap, assetOpts);
  const sheet4 = buildAssetClassSheet(bndBias, allPairsArr, 'bonds',       execMap, assetOpts);
  const sheet5 = buildAssetClassSheet(cmdBias, allPairsArr, 'commodities', execMap, assetOpts);
  const sheet6 = buildMacroRatesSheet(macroSignal, riskRegime, ratesData, cot);
  const sheet7 = buildRawDataSheet(biasArr, allPairsArr);
  const sheet8 = buildTopSetupsSheet(prioritization, snap);
  const sheet9 = buildFlowRegimeSheet(biasArr, allPairsArr, regimeTransition, intermarketStability, snap);

  const sheets     = ['Executive Summary', 'FX', 'Indices', 'Bonds', 'Commodities', 'Macro-Rates', 'Raw Data', 'Top Setups', 'Flow & Regime'];
  const sheetCount = sheets.length;

  const files = {
    '[Content_Types].xml':       strToU8(contentTypesXml(sheetCount)),
    '_rels/.rels':                strToU8(relsXml()),
    'xl/workbook.xml':            strToU8(workbookXml(sheets)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml(sheetCount)),
    'xl/styles.xml':              strToU8(buildStylesXml()),
    'xl/worksheets/sheet1.xml':   strToU8(sheet1.toXml('Executive Summary')),
    'xl/worksheets/sheet2.xml':   strToU8(sheet2.toXml('FX')),
    'xl/worksheets/sheet3.xml':   strToU8(sheet3.toXml('Indices')),
    'xl/worksheets/sheet4.xml':   strToU8(sheet4.toXml('Bonds')),
    'xl/worksheets/sheet5.xml':   strToU8(sheet5.toXml('Commodities')),
    'xl/worksheets/sheet6.xml':   strToU8(sheet6.toXml('Macro-Rates')),
    'xl/worksheets/sheet7.xml':   strToU8(sheet7.toXml('Raw Data')),
    'xl/worksheets/sheet8.xml':   strToU8(sheet8.toXml('Top Setups')),
    'xl/worksheets/sheet9.xml':   strToU8(sheet9.toXml('Flow & Regime')),
  };

  return zipSync(files, { level: 6 });
}
