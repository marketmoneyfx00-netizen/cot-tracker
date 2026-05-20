/**
 * exportEngine.js — COT Tracker Institutional Export Engine v2.0
 *
 * Pure utility module — no React dependencies, safe to import anywhere.
 *
 * Three export modes:
 *   pair     — single pair, flat row + layers, CSV or JSON
 *   snapshot — all pairs in one document, CSV or JSON
 *   raw      — full institutional JSON with all layers, history, deltas
 */

import { calculateBiasScore, deriveInputsFromPair } from '../cotBiasEngine.js';
import { calculateExecutionScore }                  from '../intradayExecutionEngine.js';

export const EXPORT_VERSION = '2.0';

// ── INTERNAL UTILS ────────────────────────────────────────────────────────────

function isoNow()  { return new Date().toISOString(); }
function isoDate() { return isoNow().slice(0, 10); }

function round(v, d = 2) {
  if (v == null || (typeof v === 'number' && isNaN(v))) return null;
  return typeof v === 'number' ? parseFloat(v.toFixed(d)) : v;
}

// Bias score -5..+5 → normalized 0..100 (50 = neutral)
function normBias(score) {
  if (score == null || isNaN(score)) return null;
  return Math.round(((score + 5) / 10) * 100);
}

function strengthLabel(score) {
  if (score == null) return 'Unknown';
  const s = Math.abs(score);
  if (s >= 80) return 'Extreme';
  if (s >= 65) return 'High';
  if (s >= 40) return 'Medium';
  return 'Low';
}

function dirLabel(direction) {
  if (direction === 'bullish') return 'Long';
  if (direction === 'bearish') return 'Short';
  return 'Neutral';
}

function colorState(score) {
  if (score == null) return 'neutral';
  if (score >= 65) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

function signalLabel(score) {
  if (score >= 75) return 'Strong Bullish';
  if (score >= 62) return 'Bullish';
  if (score >= 52) return 'Slight Bullish';
  if (score >= 48) return 'Neutral';
  if (score >= 38) return 'Slight Bearish';
  if (score >= 25) return 'Bearish';
  return 'Strong Bearish';
}

function fmtK(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (a >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── EXECUTION HELPER ──────────────────────────────────────────────────────────

function computeExecution(biasEntry, sentimentData, riskData) {
  if (!biasEntry) return null;
  const b = biasEntry.bias ?? biasEntry;
  const score = b.score ?? biasEntry.score;
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
}

// ── PREVIOUS BIAS SCORE (shifted week) ───────────────────────────────────────

function computePrevBiasScore(pairRow) {
  if (!pairRow?.weeks || pairRow.weeks.length < 3) return null;
  const shiftedPair = { ...pairRow, latest: pairRow.weeks[1], weeks: pairRow.weeks.slice(1) };
  const inp = deriveInputsFromPair(shiftedPair);
  if (!inp) return null;
  const bias = calculateBiasScore(inp);
  return bias ? normBias(bias.score) : null;
}

// ── LAYERS BUILDER ────────────────────────────────────────────────────────────
// Produces the structured layers array used in both raw and pair exports.

export function buildLayersArray(biasEntry, pairRow, exec) {
  if (!biasEntry || !pairRow) return [];

  const latest = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
  const prev   = pairRow.weeks?.[1] ?? {};
  const bias   = biasEntry.bias ?? biasEntry;
  const zsc    = biasEntry.zscore ?? {};
  const div    = biasEntry.divergence ?? {};
  const conf   = biasEntry.confluence ?? {};
  const signal = pairRow.signal ?? {};

  // Normalized current & previous bias scores (0-100)
  const biasVal  = normBias(bias.score ?? biasEntry.score);
  const prevBias = computePrevBiasScore(pairRow);
  const biasDelta = (biasVal != null && prevBias != null) ? round(biasVal - prevBias, 1) : null;
  const biasDeltaPct = (biasDelta != null && prevBias != null && prevBias !== 0)
    ? round((biasDelta / Math.abs(prevBias)) * 100, 2) : null;

  // COT positioning deltas
  const cotNet     = latest.smartNet  ?? null;
  const prevCotNet = prev?.smartNet   ?? null;
  const cotDelta   = (cotNet != null && prevCotNet != null) ? cotNet - prevCotNet : (latest.levChgNet ?? null);
  const cotDeltaPct = (cotDelta != null && prevCotNet != null && prevCotNet !== 0)
    ? round((cotDelta / Math.abs(prevCotNet)) * 100, 2) : null;

  // Divergence value
  const divVal = round((div.strength ?? 0) * 100, 1);

  // Execution
  const execVal    = exec?.score ?? null;
  const execConf   = execVal != null ? round(execVal / 100, 2) : null;
  const execNotes  = exec ? [
    `HTF Bias: ${exec.breakdown?.htfBias ?? 0}pts`,
    `Macro Risk: ${exec.breakdown?.macroRisk ?? 0}pts`,
    `Fear/Greed: ${exec.breakdown?.fearGreed ?? 0}pts`,
    `Volatility: ${exec.breakdown?.volatility ?? 0}pts`,
  ].join(' · ') : '';

  // Weekly flow delta
  const weeklyChg     = latest.levChgNet ?? cotDelta;
  const prevWeeklyChg = prevCotNet != null && pairRow.weeks?.[2]?.smartNet != null
    ? prevCotNet - pairRow.weeks[2].smartNet : null;

  return [
    // ── 1. Institutional Bias ─────────────────────────────────────────────
    {
      name:           'Institutional Bias',
      value:          biasVal,
      signal:         bias.label ?? signalLabel(biasVal),
      strength:       strengthLabel(biasVal),
      direction:      dirLabel(bias.direction),
      previous_value: prevBias,
      delta_value:    biasDelta,
      delta_percent:  biasDeltaPct,
      confidence:     round(biasEntry.macroConfidence ?? 1.0, 2),
      color_state:    colorState(biasVal),
      notes:          bias.recommendation ?? '',
    },

    // ── 2. Intraday Execution ─────────────────────────────────────────────
    {
      name:           'Intraday Execution',
      value:          execVal,
      signal:         exec?.permission?.label ?? 'N/A',
      strength:       strengthLabel(execVal),
      direction:      exec?.permission?.label === 'FAVORABLE' ? 'Active'
                    : exec?.permission?.label === 'IMPROVING' ? 'Wait' : 'Avoid',
      previous_value: null,
      delta_value:    null,
      delta_percent:  null,
      confidence:     execConf,
      color_state:    execVal != null ? (execVal >= 70 ? 'green' : execVal >= 50 ? 'amber' : 'red') : 'neutral',
      notes:          execNotes,
    },

    // ── 3. COT Divergence ─────────────────────────────────────────────────
    {
      name:           'COT Divergence',
      value:          divVal,
      signal:         div.state ?? 'NEUTRAL',
      strength:       div.state === 'EXHAUSTION'       ? 'High'
                    : div.state?.includes('DIVERGENCE') ? 'Medium' : 'Low',
      direction:      div.state?.includes('BULLISH')   ? 'Long'
                    : div.state?.includes('BEARISH')   ? 'Short' : 'Wait',
      previous_value: null,
      delta_value:    null,
      delta_percent:  null,
      confidence:     round(div.strength ?? 0, 2),
      color_state:    div.state === 'EXHAUSTION' ? 'red'
                    : div.state?.includes('DIVERGENCE') ? 'amber' : 'green',
      notes:          div.reading ?? '',
    },

    // ── 4. CFTC Positioning ───────────────────────────────────────────────
    {
      name:           'CFTC Positioning',
      value:          cotNet,
      signal:         cotNet != null ? (cotNet > 0 ? 'Net Long' : cotNet < 0 ? 'Net Short' : 'Neutral') : 'N/A',
      strength:       cotNet != null ? strengthLabel(Math.min(100, Math.abs(cotNet) / 1500)) : 'Unknown',
      direction:      cotNet != null ? (cotNet > 0 ? 'Long' : cotNet < 0 ? 'Short' : 'Neutral') : 'Neutral',
      previous_value: prevCotNet,
      delta_value:    cotDelta,
      delta_percent:  cotDeltaPct,
      confidence:     zsc.zscore != null ? round(Math.min(1, Math.abs(zsc.zscore) / 3), 2) : null,
      color_state:    cotNet != null ? (cotNet > 0 ? 'green' : cotNet < 0 ? 'red' : 'neutral') : 'neutral',
      notes: [
        `${round(latest.smartPctL, 1) ?? '—'}% long`,
        `Z-Score: ${zsc.zscore ?? '—'}`,
        `Percentile: ${zsc.percentile ?? '—'}%`,
        `OI: ${fmtK(latest.openInterest)}`,
      ].join(' · '),
    },

    // ── 5. Signal Confluence ──────────────────────────────────────────────
    {
      name:           'Signal Confluence',
      value:          conf.confluenceScore ?? conf.score ?? null,
      signal:         conf.label ?? 'N/A',
      strength:       strengthLabel(conf.confluenceScore ?? conf.score),
      direction:      dirLabel(bias.direction),
      previous_value: null,
      delta_value:    null,
      delta_percent:  null,
      confidence:     (conf.confluenceScore ?? conf.score) != null
                        ? round((conf.confluenceScore ?? conf.score) / 100, 2) : null,
      color_state:    colorState(conf.confluenceScore ?? conf.score),
      notes: [
        `Carry: ${biasEntry.carryScore != null ? round(biasEntry.carryScore, 1) : '—'}`,
        `Macro conf: ${biasEntry.macroConfidence ?? '—'}`,
        `Carry align: ${conf.carryAlignment ?? '—'}`,
        `Policy align: ${conf.policyAlignment ?? '—'}`,
      ].join(' · '),
    },

    // ── 6. Weekly Flow ────────────────────────────────────────────────────
    {
      name:           'Weekly Institutional Flow',
      value:          weeklyChg,
      signal:         weeklyChg != null ? (weeklyChg > 0 ? 'Accumulation' : weeklyChg < 0 ? 'Distribution' : 'Neutral') : 'N/A',
      strength:       weeklyChg != null ? strengthLabel(Math.min(100, Math.abs(weeklyChg) / 500)) : 'Unknown',
      direction:      weeklyChg != null ? (weeklyChg > 0 ? 'Long' : weeklyChg < 0 ? 'Short' : 'Neutral') : 'Neutral',
      previous_value: prevWeeklyChg,
      delta_value:    (weeklyChg != null && prevWeeklyChg != null) ? weeklyChg - prevWeeklyChg : null,
      delta_percent:  null,
      confidence:     null,
      color_state:    weeklyChg != null ? (weeklyChg > 0 ? 'green' : weeklyChg < 0 ? 'red' : 'neutral') : 'neutral',
      notes:          signal.reason ?? '',
    },
  ];
}

// ── CSV BUILDER ───────────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(rows) {
  if (!rows?.length) return '';
  const keys = Object.keys(rows[0]);
  return [
    keys.map(escapeCSV).join(','),
    ...rows.map(row => keys.map(k => escapeCSV(row[k])).join(',')),
  ].join('\n');
}

function csvBrandingHeader(type, symbol, cftcDate) {
  return [
    '# COT Tracker — Institutional Export System v2.0',
    `# Export Type: ${type}`,
    symbol      ? `# Symbol: ${symbol}`           : null,
    cftcDate    ? `# CFTC Report: ${cftcDate}`     : null,
    `# Snapshot: ${isoDate()}`,
    `# Generated: ${isoNow()}`,
    '# Source: CFTC · Traders in Financial Futures',
    '# Not financial advice. For analytical use only.',
    '#',
  ].filter(Boolean).join('\n') + '\n';
}

// ── SUMMARY ROW (used by both pair and snapshot exports) ─────────────────────

function buildSummaryRow(pairRow, biasEntry, exec, opts = {}) {
  const { macroSignal, livePrice } = opts;
  if (!pairRow || !biasEntry) return null;

  const latest = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
  const signal = pairRow.signal ?? {};
  const bias   = biasEntry.bias ?? biasEntry;
  const zsc    = biasEntry.zscore ?? {};
  const div    = biasEntry.divergence ?? {};

  const biasNorm = normBias(bias.score ?? biasEntry.score);
  const execVal  = exec?.score ?? null;

  // Market regime derived from market_state + divergence
  const regime = (() => {
    if (biasEntry.state === 'distribution') return 'Reversal Risk';
    if (biasEntry.state === 'expansion')    return 'Trend Expansion';
    if (biasEntry.state === 'building')     return 'Building Momentum';
    if (div.state === 'EXHAUSTION')         return 'Exhaustion Risk';
    if (div.state?.includes('DIVERGENCE')) return 'Pullback Potential';
    return 'Compression';
  })();

  // Trend state from signal + bias
  const trendState = (() => {
    const s = signal.signal;
    const lvl = signal.strength ?? 0;
    if (s === 'buy'  && lvl >= 3) return 'Strong Swing Bullish';
    if (s === 'buy'  && lvl >= 2) return 'Swing Bullish';
    if (s === 'buy')               return 'Mild Bullish';
    if (s === 'sell' && lvl >= 3) return 'Strong Swing Bearish';
    if (s === 'sell' && lvl >= 2) return 'Swing Bearish';
    if (s === 'sell')              return 'Mild Bearish';
    if (s === 'indecision')        return 'Transitional';
    return 'Neutral / Wait';
  })();

  const summary = [
    bias.recommendation ? bias.recommendation.slice(0, 80) : '',
    div.reading         ? div.reading.slice(0, 60)         : '',
  ].filter(Boolean).join(' ');

  return {
    snapshot_date:              isoDate(),
    symbol:                     pairRow.pair ?? '',
    asset_class:                (pairRow.cat ?? 'fx').toUpperCase(),
    cftc_report_date:           latest.isoDate ?? '',
    last_updated_at:            isoNow(),

    institutional_bias_score:   biasNorm,
    institutional_bias_label:   bias.label ?? signalLabel(biasNorm),
    intraday_execution_score:   execVal,
    intraday_execution_label:   exec?.permission?.label ?? '',

    divergence_score:           round((div.strength ?? 0) * 100, 1),
    divergence_label:           div.state ?? 'NEUTRAL',
    flow_score:                 latest.levChgNet ?? null,
    flow_label:                 (latest.levChgNet ?? 0) > 0 ? 'Accumulation' : (latest.levChgNet ?? 0) < 0 ? 'Distribution' : 'Neutral',

    market_regime:              regime,
    trend_state:                trendState,
    macro_context:              macroSignal?.bias ?? '',
    macro_confidence:           round(biasEntry.macroConfidence, 2),
    carry_score:                round(biasEntry.carryScore, 2),

    z_score:                    round(zsc.zscore, 2),
    position_percentile:        round(zsc.percentile, 1),
    leveraged_net:              latest.smartNet ?? null,
    weekly_change_net:          latest.levChgNet ?? null,
    pct_long:                   round(latest.smartPctL, 1),
    asset_managers_net:         latest.assetNet  ?? null,
    dealers_net:                latest.dealerNet ?? null,
    open_interest:              latest.openInterest ?? null,
    confluence_score:           biasEntry.confluence?.confluenceScore ?? biasEntry.confluence?.score ?? null,

    cot_signal:                 signal.signal   ?? '',
    cot_signal_strength:        signal.strength ?? null,
    live_price:                 livePrice != null ? round(livePrice, 5) : null,
    summary:                    summary,
  };
}

// ── MARKET OVERVIEW ───────────────────────────────────────────────────────────

function buildMarketOverview(biasArr) {
  const bullish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish').length;
  const bearish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish').length;
  const neutral = biasArr.length - bullish - bearish;

  const expansions    = biasArr.filter(b => b.state === 'expansion').length;
  const distributions = biasArr.filter(b => b.state === 'distribution').length;
  const building      = biasArr.filter(b => b.state === 'building').length;
  const compression   = biasArr.filter(b => b.state === 'compression').length;

  const avgBias = biasArr.length
    ? round(biasArr.reduce((s, b) => s + (b.score ?? 0), 0) / biasArr.length, 2)
    : null;

  const globalBias = avgBias != null
    ? (avgBias > 0.5 ? 'Bullish Tilt' : avgBias < -0.5 ? 'Bearish Tilt' : 'Neutral')
    : 'N/A';

  return {
    total_pairs:     biasArr.length,
    bullish_pairs:   bullish,
    bearish_pairs:   bearish,
    neutral_pairs:   neutral,
    global_bias:     globalBias,
    avg_bias_score:  avgBias,
    market_states: {
      expansion:    expansions,
      building:     building,
      compression:  compression,
      distribution: distributions,
    },
  };
}

// ── LEVEL 1: PER-PAIR EXPORT ──────────────────────────────────────────────────

export function buildPairExport(pairRow, biasEntry, opts = {}) {
  const { macroSignal, livePrice, sentimentData, riskData } = opts;
  if (!pairRow || !biasEntry) return null;

  const exec    = computeExecution(biasEntry, sentimentData, riskData);
  const summary = buildSummaryRow(pairRow, biasEntry, exec, { macroSignal, livePrice });
  const layers  = buildLayersArray(biasEntry, pairRow, exec);

  if (!summary) return null;

  return {
    ...summary,
    layers,
  };
}

// ── LEVEL 2: SNAPSHOT EXPORT ──────────────────────────────────────────────────

export function buildSnapshotExport(biasArr, fxPairs, opts = {}) {
  const { macroSignal, livePrices = {}, sentimentData, riskData } = opts;
  const pairMap = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));

  const assets = (biasArr ?? [])
    .filter(Boolean)
    .map(b => {
      const pairRow = pairMap[b.pair];
      if (!pairRow) return null;
      const exec = computeExecution(b, sentimentData, riskData);
      return buildSummaryRow(pairRow, b, exec, { macroSignal, livePrice: livePrices[b.pair] });
    })
    .filter(Boolean);

  return { overview: buildMarketOverview(biasArr ?? []), assets };
}

// ── LEVEL 3: RAW INSTITUTIONAL EXPORT ────────────────────────────────────────

export function buildRawExport(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal, ratesData, candleMap = {},
    livePrices = {}, sentimentData, riskData,
  } = opts;

  const pairMap   = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
  const ratesList = ratesData?.pairs ?? [];

  const assets = (biasArr ?? [])
    .filter(Boolean)
    .map(biasEntry => {
      const pairRow = pairMap[biasEntry.pair];
      if (!pairRow) return null;

      const latest  = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
      const exec    = computeExecution(biasEntry, sentimentData, riskData);
      const pairKey = biasEntry.pair.replace('/', '').toUpperCase();
      const rates   = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);
      const summary = buildSummaryRow(pairRow, biasEntry, exec, { macroSignal, livePrice: livePrices[biasEntry.pair] });
      const layers  = buildLayersArray(biasEntry, pairRow, exec);

      return {
        // Identity
        symbol:           biasEntry.pair,
        asset_class:      (pairRow.cat ?? 'fx').toUpperCase(),
        label:            pairRow.label ?? '',
        cftc_report_date: latest.isoDate ?? null,

        // Summary (flat, same as Level 1/2)
        summary,

        // Structured layers (the institutional intelligence core)
        layers,

        // Full engine outputs (no flattening)
        engine_outputs: {
          institutional_bias: {
            score:          round(biasEntry.bias?.score, 2),
            normalized:     normBias(biasEntry.bias?.score),
            label:          biasEntry.bias?.label ?? '',
            state:          biasEntry.bias?.state ?? '',
            direction:      biasEntry.bias?.direction ?? '',
            color:          biasEntry.bias?.color ?? '',
            recommendation: biasEntry.bias?.recommendation ?? '',
            breakdown:      biasEntry.bias?.breakdown ?? null,
            _v2_internal:   biasEntry.bias?._v2 ?? null,
          },
          intraday_execution: exec
            ? { score: exec.score, permission: exec.permission, breakdown: exec.breakdown }
            : null,
          positioning_extremes:   biasEntry.zscore        ?? null,
          divergence:             biasEntry.divergence    ?? null,
          confluence:             biasEntry.confluence    ?? null,
          macro_confidence_mult:  biasEntry.macroConfidence ?? null,
          carry_score:            biasEntry.carryScore    ?? null,
          real_price_change_pct:  biasEntry.realPriceChangePct ?? null,
          market_state:           biasEntry.state         ?? null,
        },

        // COT signal
        cot_signal: pairRow.signal ?? null,

        // Full weekly COT history
        cot_history: (pairRow.weeks ?? []).map(w => ({
          report_date:        w.isoDate,
          leveraged_net:      w.smartNet,
          leveraged_long:     w.levLong,
          leveraged_short:    w.levShort,
          pct_long:           w.smartPctL,
          weekly_change_net:  w.levChgNet ?? null,
          asset_mgr_net:      w.assetNet,
          dealers_net:        w.dealerNet,
          open_interest:      w.openInterest ?? null,
        })),

        // Rates / carry details
        rates_carry: rates ?? null,

        // Price context
        live_price:           livePrices[biasEntry.pair]    ?? null,
        price_candles_count:  (candleMap[biasEntry.pair] ?? []).length,
      };
    })
    .filter(Boolean);

  return {
    export_type:    'raw_institutional',
    export_version: EXPORT_VERSION,
    generated_at:   isoNow(),
    snapshot_date:  isoDate(),
    data_source:    'CFTC · Traders in Financial Futures via COT Tracker',

    market_overview: buildMarketOverview(biasArr ?? []),
    macro_signal:    macroSignal ?? null,
    sentiment_context: sentimentData
      ? { fear_greed: sentimentData.fg, vix: sentimentData.vix, high_impact_events: sentimentData.highCount }
      : null,
    rates_meta: ratesData
      ? { pairs_tracked: ratesList.length }
      : null,

    assets_count: assets.length,
    assets,
  };
}

// ── CSV FOR SNAPSHOT (flattened without layers) ───────────────────────────────

export function snapshotToCSV(snapshotData) {
  if (!snapshotData?.assets?.length) return '';
  return csvBrandingHeader('Full Market Snapshot', null, snapshotData.assets[0]?.cftc_report_date)
    + toCSV(snapshotData.assets);
}

export function pairToCSV(pairExport) {
  if (!pairExport) return '';
  const { layers, ...flat } = pairExport;
  return csvBrandingHeader('Per-Pair Analysis', flat.symbol, flat.cftc_report_date)
    + toCSV([flat]);
}

// ── FILE DOWNLOAD ─────────────────────────────────────────────────────────────

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
}

export function buildFilename(scope, symbol, format) {
  const d = isoDate();
  const prefix = 'COTTracker';
  if (scope === 'pair')     return `${prefix}_${(symbol ?? 'Pair').replace('/', '')}_${d}.${format}`;
  if (scope === 'snapshot') return `${prefix}_FullMarketSnapshot_${d}.${format}`;
  if (scope === 'raw')      return `${prefix}_RawInstitutionalData_${d}.json`;
  return `${prefix}_Export_${d}.${format}`;
}
