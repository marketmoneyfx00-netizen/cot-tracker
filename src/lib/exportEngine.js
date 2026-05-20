/**
 * exportEngine.js — COT Tracker Data Export Engine v1.0
 *
 * Pure utility module. No React dependencies.
 *
 * Three export levels:
 *   Level 1 (pair)     — single pair, flat row, CSV or JSON
 *   Level 2 (snapshot) — all pairs in one file, CSV or JSON
 *   Level 3 (raw)      — full JSON with all layers, history, and engine outputs
 */

import { calculateExecutionScore } from '../intradayExecutionEngine.js';

const EXPORT_VERSION = '1.0';

// ── UTILS ─────────────────────────────────────────────────────────────────────

function isoNow() { return new Date().toISOString(); }
function isoDate() { return isoNow().slice(0, 10); }

function fmt(v, d = 2) {
  if (v == null || (typeof v === 'number' && isNaN(v))) return null;
  return typeof v === 'number' ? parseFloat(v.toFixed(d)) : v;
}

function escapeCSV(val) {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

// ── CSV BUILDER ───────────────────────────────────────────────────────────────

export function toCSV(rows) {
  if (!rows?.length) return '';
  const keys = Object.keys(rows[0]);
  return [
    keys.map(escapeCSV).join(','),
    ...rows.map(row => keys.map(k => escapeCSV(row[k])).join(',')),
  ].join('\n');
}

// ── EXECUTION SCORE HELPER ────────────────────────────────────────────────────

function computeExecution(biasEntry, sentimentData, riskData) {
  if (!biasEntry) return null;
  const b = biasEntry.bias ?? biasEntry;
  return calculateExecutionScore({
    biasScore:     b.score ?? biasEntry.score,
    biasDirection: b.direction ?? (b.score > 0 ? 'bullish' : b.score < 0 ? 'bearish' : 'neutral'),
    riskScore:     riskData?.score ?? 0,
    fg:            sentimentData?.fg       ?? 50,
    vix:           sentimentData?.vix      ?? 18,
    highCount:     sentimentData?.highCount ?? 0,
    midCount:      sentimentData?.midCount  ?? 0,
    carryScore:    biasEntry.carryScore ?? null,
  });
}

// ── LEVEL 1 — PER-PAIR FLAT ROW ───────────────────────────────────────────────

/**
 * Builds a single flat object suitable for CSV or JSON export.
 * Designed for the basic user: one pair, readable field names, no nesting.
 */
export function buildPairExportRow(pairRow, biasEntry, opts = {}) {
  const { macroSignal, livePrice, sentimentData, riskData } = opts;
  if (!pairRow || !biasEntry) return null;

  const latest  = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
  const signal  = pairRow.signal ?? {};
  const bias    = biasEntry.bias ?? biasEntry;
  const zsc     = biasEntry.zscore ?? {};
  const div     = biasEntry.divergence ?? {};
  const exec    = computeExecution(biasEntry, sentimentData, riskData);

  return {
    // Identity & metadata
    snapshot_date:             isoDate(),
    symbol:                    pairRow.pair ?? '',
    asset_class:               pairRow.cat ?? 'fx',
    cftc_report_date:          latest.isoDate ?? '',
    generated_at:              isoNow(),
    export_version:            EXPORT_VERSION,

    // Institutional Bias Engine
    institutional_bias_score:  fmt(bias.score, 2),
    institutional_bias_label:  bias.label ?? '',
    institutional_bias_state:  bias.state ?? '',
    position_direction:        bias.direction ?? '',
    recommendation:            bias.recommendation ?? '',

    // COT Position Data
    leveraged_net_contracts:   latest.smartNet ?? null,
    leveraged_long:            latest.levLong  ?? null,
    leveraged_short:           latest.levShort ?? null,
    weekly_change_net:         latest.levChgNet ?? null,
    position_pct_long:         fmt(latest.smartPctL, 1),
    asset_managers_net:        latest.assetNet  ?? null,
    dealers_net:               latest.dealerNet ?? null,
    open_interest:             latest.openInterest ?? null,

    // Statistical Context
    z_score:                   fmt(zsc.zscore, 2),
    position_percentile:       fmt(zsc.percentile, 1),
    positioning_extreme_state: zsc.state ?? '',

    // Divergence & Confluence
    divergence_status:         div.state ?? '',
    divergence_label:          div.label ?? '',
    confluence_score:          biasEntry.confluence?.score ?? null,

    // Macro & Carry Context
    macro_confidence_pair:     fmt(biasEntry.macroConfidence, 2),
    carry_score:               fmt(biasEntry.carryScore, 2),
    macro_bias_global:         macroSignal?.bias ?? '',
    macro_confidence_global:   fmt(macroSignal?.confidence, 1),

    // Intraday Execution Engine
    intraday_execution_score:  exec?.score ?? null,
    intraday_execution_label:  exec?.permission?.label ?? '',

    // COT Signal
    cot_signal:                signal.signal   ?? '',
    cot_signal_strength:       signal.strength ?? null,
    cot_signal_reason:         signal.reason   ?? '',

    // Market Structure
    market_state:              biasEntry.state ?? '',

    // Live Price (if available)
    live_price:                livePrice != null ? fmt(livePrice, 5) : null,
  };
}

// ── LEVEL 2 — FULL MARKET SNAPSHOT ───────────────────────────────────────────

/**
 * Builds an array of flat rows — one per pair.
 * Designed for the advanced user: weekly market review, pair comparison.
 */
export function buildSnapshotExport(biasArr, fxPairs, opts = {}) {
  const { macroSignal, livePrices = {}, sentimentData, riskData } = opts;
  const pairMap = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));

  return (biasArr ?? [])
    .filter(Boolean)
    .map(b => buildPairExportRow(
      pairMap[b.pair],
      b,
      { macroSignal, livePrice: livePrices[b.pair], sentimentData, riskData },
    ))
    .filter(Boolean);
}

// ── LEVEL 3 — RAW FULL JSON ───────────────────────────────────────────────────

/**
 * Builds the complete raw export document for power users.
 * Includes all engine outputs, weekly COT history, and internal metrics.
 * Structured for analysis, automation, backtesting, and AI ingestion.
 */
export function buildRawExport(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal, ratesData, candleMap = {},
    livePrices = {}, sentimentData, riskData,
  } = opts;

  const pairMap  = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
  const ratesList = ratesData?.pairs ?? [];

  const pairs = (biasArr ?? [])
    .filter(Boolean)
    .map(biasEntry => {
      const pairRow = pairMap[biasEntry.pair];
      if (!pairRow) return null;

      const latest  = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
      const exec    = computeExecution(biasEntry, sentimentData, riskData);
      const pairKey = biasEntry.pair.replace('/', '').toUpperCase();
      const rates   = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);

      return {
        // Identity
        pair:             biasEntry.pair,
        asset_class:      pairRow.cat   ?? 'fx',
        label:            pairRow.label ?? '',
        cftc_report_date: latest.isoDate ?? null,

        // Full Institutional Bias Engine output
        institutional_bias: {
          score:          biasEntry.bias?.score         ?? biasEntry.score,
          label:          biasEntry.bias?.label         ?? '',
          state:          biasEntry.bias?.state         ?? biasEntry.state,
          direction:      biasEntry.bias?.direction     ?? '',
          color:          biasEntry.bias?.color         ?? '',
          recommendation: biasEntry.bias?.recommendation ?? '',
          breakdown:      biasEntry.bias?.breakdown     ?? null,
          _v2_internal:   biasEntry.bias?._v2           ?? null,
        },

        // Statistical & Positioning Layers
        positioning_extremes: biasEntry.zscore     ?? null,
        divergence:           biasEntry.divergence ?? null,
        confluence:           biasEntry.confluence ?? null,
        market_state:         biasEntry.state      ?? null,

        // Macro & Carry Context
        macro_confidence_multiplier: biasEntry.macroConfidence ?? null,
        carry_score:                 biasEntry.carryScore      ?? null,
        real_price_change_pct:       biasEntry.realPriceChangePct ?? null,

        // Full Intraday Execution Engine output
        intraday_execution: exec
          ? { score: exec.score, permission: exec.permission, breakdown: exec.breakdown }
          : null,

        // COT Signal
        cot_signal: pairRow.signal ?? null,

        // Full Weekly COT History
        cot_history: (pairRow.weeks ?? []).map(w => ({
          report_date:       w.isoDate         ?? null,
          leveraged_net:     w.smartNet         ?? null,
          leveraged_long:    w.levLong          ?? null,
          leveraged_short:   w.levShort         ?? null,
          pct_long:          w.smartPctL        ?? null,
          weekly_change_net: w.levChgNet        ?? null,
          asset_mgr_net:     w.assetNet         ?? null,
          dealers_net:       w.dealerNet        ?? null,
          open_interest:     w.openInterest     ?? null,
        })),

        // Rates / Carry Details
        rates_carry: rates ?? null,

        // Price Context
        live_price:          livePrices[biasEntry.pair] ?? null,
        price_candles_count: (candleMap[biasEntry.pair] ?? []).length,
      };
    })
    .filter(Boolean);

  return {
    export_type:    'raw_full',
    export_version: EXPORT_VERSION,
    generated_at:   isoNow(),
    snapshot_date:  isoDate(),
    data_source:    'CFTC via COT Tracker',
    pairs_count:    pairs.length,

    // Global Context
    macro_signal:      macroSignal ?? null,
    sentiment_context: sentimentData
      ? { fg: sentimentData.fg, vix: sentimentData.vix, high_impact_events: sentimentData.highCount }
      : null,
    rates_meta: ratesData
      ? { pairs_count: ratesList.length }
      : null,

    pairs,
  };
}

// ── FILE DOWNLOAD ─────────────────────────────────────────────────────────────

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href        = url;
  a.download    = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
}

export function buildFilename(level, symbol, format) {
  const d = isoDate();
  if (level === 'pair')     return `cot_${(symbol ?? 'pair').replace('/', '')}_${d}.${format}`;
  if (level === 'snapshot') return `cot_snapshot_${d}.${format}`;
  if (level === 'raw')      return `cot_raw_${d}.json`;
  return `cot_export_${d}.${format}`;
}
