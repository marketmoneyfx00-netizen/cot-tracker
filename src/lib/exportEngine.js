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
import { generateXLSX }                            from './xlsxExporter.js';
import { generateHTMLReport }                      from './htmlReportGenerator.js';
import { buildCbCycleProfiles, derivePolicyCycleRegime, enrichCarryPairWithCycle } from './cbCycleEngine.js';
import { buildConvictionProfile, buildPrioritizationMatrix } from './convictionEngine.js';
import { buildTemporalHorizon } from './temporalHorizonEngine.js';
import { buildFlowPersistence } from './flowPersistenceEngine.js';
import { buildRegimeTransition, buildAssetRegimeTrend } from './regimeTransitionEngine.js';
import { buildIntermarketStability } from './intermarketStabilityEngine.js';

export const EXPORT_VERSION = '2.3';

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
  if (score == null) return 'Desconocido';
  const s = Math.abs(score);
  if (s >= 80) return 'Extremo';
  if (s >= 65) return 'Alto';
  if (s >= 40) return 'Medio';
  return 'Bajo';
}

function dirLabel(direction) {
  if (direction === 'bullish') return 'Largo';
  if (direction === 'bearish') return 'Corto';
  return 'Neutral';
}

function colorState(score) {
  if (score == null) return 'neutral';
  if (score >= 65) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

function signalLabel(score) {
  if (score >= 75) return 'Alcista Fuerte';
  if (score >= 62) return 'Alcista';
  if (score >= 52) return 'Ligeramente Alcista';
  if (score >= 48) return 'Neutral';
  if (score >= 38) return 'Ligeramente Bajista';
  if (score >= 25) return 'Bajista';
  return 'Bajista Fuerte';
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
      name:           'Sesgo Institucional',
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
      name:           'Ejecución Intradía',
      value:          execVal,
      signal:         exec?.permission?.label ?? 'N/D',
      strength:       strengthLabel(execVal),
      direction:      exec?.permission?.label === 'FAVORABLE' ? 'Activo'
                    : exec?.permission?.label === 'IMPROVING' ? 'Esperar' : 'Evitar',
      previous_value: null,
      delta_value:    null,
      delta_percent:  null,
      confidence:     execConf,
      color_state:    execVal != null ? (execVal >= 70 ? 'green' : execVal >= 50 ? 'amber' : 'red') : 'neutral',
      notes:          execNotes,
    },

    // ── 3. COT Divergence ─────────────────────────────────────────────────
    {
      name:           'Divergencia COT',
      value:          divVal,
      signal:         div.state ?? 'NEUTRAL',
      strength:       div.state === 'EXHAUSTION'       ? 'Alto'
                    : div.state?.includes('DIVERGENCE') ? 'Medio' : 'Bajo',
      direction:      div.state?.includes('BULLISH')   ? 'Largo'
                    : div.state?.includes('BEARISH')   ? 'Corto' : 'Esperar',
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
      name:           'Posicionamiento CFTC',
      value:          cotNet,
      signal:         cotNet != null ? (cotNet > 0 ? 'Neto Largo' : cotNet < 0 ? 'Neto Corto' : 'Neutral') : 'N/D',
      strength:       cotNet != null ? strengthLabel(Math.min(100, Math.abs(cotNet) / 1500)) : 'Desconocido',
      direction:      cotNet != null ? (cotNet > 0 ? 'Largo' : cotNet < 0 ? 'Corto' : 'Neutral') : 'Neutral',
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
      name:           'Confluencia de Señales',
      value:          conf.confluenceScore ?? conf.score ?? null,
      signal:         conf.label ?? 'N/D',
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
      name:           'Flujo Institucional Semanal',
      value:          weeklyChg,
      signal:         weeklyChg != null ? (weeklyChg > 0 ? 'Acumulación' : weeklyChg < 0 ? 'Distribución' : 'Neutral') : 'N/D',
      strength:       weeklyChg != null ? strengthLabel(Math.min(100, Math.abs(weeklyChg) / 500)) : 'Desconocido',
      direction:      weeklyChg != null ? (weeklyChg > 0 ? 'Largo' : weeklyChg < 0 ? 'Corto' : 'Neutral') : 'Neutral',
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
    if (biasEntry.state === 'distribution') return 'Riesgo de Reversión';
    if (biasEntry.state === 'expansion')    return 'Expansión de Tendencia';
    if (biasEntry.state === 'building')     return 'Momentum en Construcción';
    if (div.state === 'EXHAUSTION')         return 'Riesgo de Agotamiento';
    if (div.state?.includes('DIVERGENCE')) return 'Potencial de Retroceso';
    return 'Compresión';
  })();

  // Trend state from signal + bias
  const trendState = (() => {
    const s = signal.signal;
    const lvl = signal.strength ?? 0;
    if (s === 'buy'  && lvl >= 3) return 'Swing Alcista Fuerte';
    if (s === 'buy'  && lvl >= 2) return 'Swing Alcista';
    if (s === 'buy')               return 'Ligeramente Alcista';
    if (s === 'sell' && lvl >= 3) return 'Swing Bajista Fuerte';
    if (s === 'sell' && lvl >= 2) return 'Swing Bajista';
    if (s === 'sell')              return 'Ligeramente Bajista';
    if (s === 'indecision')        return 'Transicional';
    return 'Neutral / Esperar';
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
    flow_label:                 (latest.levChgNet ?? 0) > 0 ? 'Acumulación' : (latest.levChgNet ?? 0) < 0 ? 'Distribución' : 'Neutral',

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
    ? (avgBias > 0.5 ? 'Inclinación Alcista' : avgBias < -0.5 ? 'Inclinación Bajista' : 'Neutral')
    : 'N/D';

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
  const { macroSignal, livePrices = {}, sentimentData, riskData, ratesData, riskRegime } = opts;
  const pairMap   = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
  const ratesList = ratesData?.pairs ?? [];

  // Conviction context (lightweight — no cross-asset ctx needed for snapshot)
  const cycleProfiles = ratesData ? buildCbCycleProfiles(ratesData) : {};

  const assets = (biasArr ?? [])
    .filter(Boolean)
    .map(b => {
      const pairRow = pairMap[b.pair];
      if (!pairRow) return null;
      const exec = computeExecution(b, sentimentData, riskData);
      const row  = buildSummaryRow(pairRow, b, exec, { macroSignal, livePrice: livePrices[b.pair] });
      if (!row) return null;

      // Carry conviction for FX
      const pairKey  = b.pair?.replace('/', '').toUpperCase();
      const ratesRaw = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);
      const enriched = ratesRaw && Object.keys(cycleProfiles).length
        ? enrichCarryPairWithCycle(ratesRaw, cycleProfiles) : ratesRaw ?? null;
      const carryConviction = enriched?.carry_conviction ?? 'NEUTRAL';

      // Conviction (lightweight — no crossAssetCtx)
      const conviction = buildConvictionProfile(b, pairRow, {
        riskRegime, cycleProfiles, exec, carryConviction,
      });

      // Swing view from temporal horizon (no full opts needed for snapshot)
      const horizon = buildTemporalHorizon(b, pairRow, {
        exec, riskRegime, cycleProfiles, convictionProfile: conviction,
      });

      // Flow persistence (lightweight per-asset)
      const flowPersistence = buildFlowPersistence(pairRow, b);
      const regimeTrend     = buildAssetRegimeTrend(b, flowPersistence, riskRegime, pairRow.cat ?? 'fx');

      return {
        ...row,
        conviction_score:         conviction.conviction_score,
        conviction_label:         conviction.conviction_label,
        confidence_tier:          conviction.confidence_tier,
        swing_view:               horizon.swing?.view    ?? null,
        macro_view:               horizon.macro?.view    ?? null,
        tactical_view:            horizon.tactical?.view ?? null,
        dominant_horizon:         horizon.dominant_view  ?? null,
        // Phase 3 additions
        flow_state:               flowPersistence.flow_state,
        flow_state_label:         flowPersistence.flow_state_label,
        persistence_score:        flowPersistence.persistence_score,
        positioning_velocity:     flowPersistence.positioning_velocity,
        exhaustion_probability:   flowPersistence.exhaustion_probability,
        transition_risk:          flowPersistence.transition_risk,
        structural_strength:      flowPersistence.structural_strength,
        conviction_trend:         flowPersistence.conviction_trend,
        regime_trend:             regimeTrend,
      };
    })
    .filter(Boolean);

  return { overview: buildMarketOverview(biasArr ?? []), assets };
}

// ── LEVEL 3: RAW INSTITUTIONAL EXPORT ────────────────────────────────────────

export function buildRawExport(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal, ratesData, candleMap = {},
    livePrices = {}, sentimentData, riskData,
    riskRegime = null,
  } = opts;

  const pairMap   = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
  const ratesList = ratesData?.pairs ?? [];

  // ── CB Cycle enrichment ──────────────────────────────────────────────────────
  const cycleProfiles     = ratesData ? buildCbCycleProfiles(ratesData) : {};
  const policyCycleRegime = Object.keys(cycleProfiles).length
    ? derivePolicyCycleRegime(cycleProfiles)
    : null;

  // ── Conviction + Horizon pre-pass ────────────────────────────────────────────
  // Build raw asset list with per-asset conviction and horizon profiles.
  // Two passes: first compute per-asset conviction, then cross-asset prioritization.

  const assetContexts = (biasArr ?? []).filter(Boolean).map(biasEntry => {
    const pairRow  = pairMap[biasEntry.pair];
    if (!pairRow) return null;
    const exec     = computeExecution(biasEntry, sentimentData, riskData);
    const pairKey  = biasEntry.pair.replace('/', '').toUpperCase();
    const ratesRaw = ratesList.find(r => r.pair?.replace('/', '').toUpperCase() === pairKey);
    const rates    = ratesRaw && Object.keys(cycleProfiles).length
      ? enrichCarryPairWithCycle(ratesRaw, cycleProfiles) : ratesRaw ?? null;
    const carryConviction = rates?.carry_conviction ?? 'NEUTRAL';
    const conviction = buildConvictionProfile(biasEntry, pairRow, {
      riskRegime, cycleProfiles, exec, carryConviction,
    });
    const horizon = buildTemporalHorizon(biasEntry, pairRow, {
      exec, riskRegime, cycleProfiles, convictionProfile: conviction,
    });
    const flowPersistence = buildFlowPersistence(pairRow, biasEntry);
    const cat = pairRow.cat ?? 'fx';
    const direction = biasEntry.bias?.direction ?? biasEntry.direction ?? 'neutral';
    const regimeTrend = buildAssetRegimeTrend(biasEntry, flowPersistence, riskRegime, cat);
    return {
      biasEntry, pairRow, exec, rates, conviction, horizon, flowPersistence, regimeTrend,
      pair: biasEntry.pair, cat, direction,
    };
  }).filter(Boolean);

  // Cross-asset prioritization matrix
  const prioritization = buildPrioritizationMatrix(assetContexts);

  // ── Regime Transition & Intermarket Stability (cross-asset) ─────────────────
  const regimeTransition = buildRegimeTransition(riskRegime, assetContexts);
  const intermarketStability = buildIntermarketStability(riskRegime, biasArr);

  // Final per-asset objects
  const assets = assetContexts.map(({ biasEntry, pairRow, exec, rates, conviction, horizon, flowPersistence, regimeTrend }) => {
      const latest  = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
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

        // Rates / carry details (enriched with CB cycle when available)
        rates_carry: rates ?? null,

        // Price context
        live_price:           livePrices[biasEntry.pair]    ?? null,
        price_candles_count:  (candleMap[biasEntry.pair] ?? []).length,

        // ── Decision Intelligence Layer ───────────────────────────────────────
        conviction,
        horizon,
        flow_persistence: flowPersistence,
        decision_context: {
          regime_alignment:         conviction.factors?.macro_regime?.status  ?? 'NEUTRAL',
          carry_policy_alignment:   conviction.factors?.carry_policy?.status  ?? 'NEUTRAL',
          cross_asset_confirmation: conviction.factors?.cross_asset?.status   ?? 'NEUTRAL',
          execution_permission:     exec?.permission?.label ?? 'UNKNOWN',
          alignment_count:          conviction.alignment_count,
          conflict_count:           conviction.conflict_count,
          risk_factors:             conviction.risk_factors,
          signal_conflicts:         conviction.signal_conflicts,
          // ── Phase 3 additions ───────────────────────────────────────────────
          regime_trend:             regimeTrend,
          conviction_trend:         flowPersistence.conviction_trend,
          flow_persistence_score:   flowPersistence.persistence_score,
          positioning_velocity:     flowPersistence.positioning_velocity,
          positioning_acceleration: flowPersistence.positioning_acceleration,
          flow_momentum:            flowPersistence.flow_momentum,
          transition_risk:          flowPersistence.transition_risk,
          structural_strength:      flowPersistence.structural_strength,
          exhaustion_probability:   flowPersistence.exhaustion_probability,
          flow_state:               flowPersistence.flow_state,
        },
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
      ? {
          pairs_tracked:    ratesList.length,
          cb_banks_tracked: Object.keys(cycleProfiles).length,
        }
      : null,

    // CB rate cycle intelligence
    cb_cycle_profiles:   Object.keys(cycleProfiles).length ? cycleProfiles   : null,
    policy_cycle_regime: policyCycleRegime,

    // Decision Intelligence — conviction-ranked opportunity matrix
    prioritization,

    // ── Phase 3: Dynamic regime & market structure intelligence ───────────────
    regime_transition:     regimeTransition,
    intermarket_stability: intermarketStability,

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
  const { layers: _layers, ...flat } = pairExport;
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
  if (scope === 'pair')         return `${prefix}_${(symbol ?? 'Pair').replace('/', '')}_${d}.${format}`;
  if (scope === 'multi')        return `${prefix}_MultiAsset_${d}.${format}`;
  if (scope === 'snapshot')     return `${prefix}_FullMarketSnapshot_${d}.${format}`;
  if (scope === 'raw')          return `${prefix}_RawInstitutionalData_${d}.json`;
  if (scope === 'visual')       return `${prefix}_InstitutionalReport_${d}.${format}`;
  if (scope === 'intelligence') return `${prefix}_IntelligenceBriefing_${d}.${format === 'telegram' ? 'txt' : format}`;
  return `${prefix}_Export_${d}.${format}`;
}

// ── VISUAL EXPORTS (XLSX / HTML / PDF) ───────────────────────────────────────

/**
 * Generates an XLSX Uint8Array for download.
 * Returns { data: Uint8Array, filename: string, mime: string }
 */
export function buildXLSXExport(biasArr, fxPairs, opts = {}) {
  const {
    macroSignal, sentimentData, riskData, ratesData,
    snapshotDate, cotDate, livePrices: _lp = {}, candleMap: _cm = {},
    riskRegime = null, combinedData = null,
  } = opts;

  const execMap = {};
  (biasArr ?? []).forEach(b => {
    const bs = b.bias?.score ?? b.score;
    try {
      execMap[b.pair] = calculateExecutionScore({
        biasScore:     bs,
        biasDirection: b.bias?.direction ?? (bs > 0 ? 'bullish' : bs < 0 ? 'bearish' : 'neutral'),
        riskScore:     riskData?.score    ?? 0,
        fg:            sentimentData?.fg       ?? 50,
        vix:           sentimentData?.vix      ?? 18,
        highCount:     sentimentData?.highCount ?? 0,
        midCount:      sentimentData?.midCount  ?? 0,
        carryScore:    b.carryScore ?? null,
      });
    } catch { execMap[b.pair] = null; }
  });

  const data = generateXLSX(biasArr, fxPairs, {
    macroSignal, sentimentData, riskData, ratesData,
    snapshotDate: snapshotDate ?? isoDate(),
    cotDate,
    execMap,
    riskRegime,
    combinedData,
  });

  return {
    data,
    filename: buildFilename('visual', null, 'xlsx'),
    mime:     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/**
 * Generates a self-contained HTML string for download or printing.
 * Returns { data: string, filename: string, mime: string }
 */
export function buildHTMLExport(biasArr, fxPairs, opts = {}) {
  const html = generateHTMLReport(biasArr, fxPairs, opts);
  return {
    data:     html,
    filename: buildFilename('visual', null, 'html'),
    mime:     'text/html;charset=utf-8',
  };
}

/**
 * Opens the HTML report in a new window and triggers window.print().
 * Uses Blob URL to avoid document.write() cross-browser issues.
 */
export function openPDFPrint(biasArr, fxPairs, opts = {}) {
  try {
    const html = generateHTMLReport(biasArr, fxPairs, opts);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
      // Fallback: pop-up blocked — download instead
      const a = document.createElement('a');
      a.href = url; a.download = buildFilename('visual', null, 'html');
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 300);
      return true;
    }
    // Auto-trigger print dialog once the report finishes loading
    win.addEventListener('load', () => {
      setTimeout(() => { win.print(); }, 300);
    });
    // Revoke after reasonable delay
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
}

// ── MULTI-PAIR EXPORT ─────────────────────────────────────────────────────────
// Used by ExportPanel when scope=pair and more than one asset is selected.
// Both functions reuse existing builders — no new analysis logic introduced.

/**
 * Flat CSV with one row per selected asset.
 * Same columns as the single-pair CSV export — just N rows instead of 1.
 * Layers are stripped (CSV doesn't support nested data).
 */
export function buildMultiPairCSV(selectedPairs, biasArr, fxPairs, opts = {}) {
  const { livePrices = {}, macroSignal, sentimentData, riskData } = opts;
  const pairMap = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));

  const rows = (selectedPairs ?? [])
    .map(pair => {
      const biasEntry = (biasArr ?? []).find(b => b.pair === pair);
      const pairRow   = pairMap[pair];
      if (!biasEntry || !pairRow) return null;

      const exec    = computeExecution(biasEntry, sentimentData, riskData);
      const summary = buildSummaryRow(pairRow, biasEntry, exec, {
        macroSignal,
        livePrice: livePrices[pair] ?? null,
      });
      return summary;
    })
    .filter(Boolean);

  if (!rows.length) return '';
  const cotDate = rows[0]?.cftc_report_date ?? null;
  return csvBrandingHeader('Multi-Asset Analysis', null, cotDate) + toCSV(rows);
}

/**
 * JSON array envelope: one full pairExport object per selected asset.
 * Includes layers, engine outputs, COT history — same depth as single-pair raw.
 */
export function buildMultiPairJSON(selectedPairs, biasArr, fxPairs, opts = {}) {
  const { livePrices = {} } = opts;

  const assets = (selectedPairs ?? [])
    .map(pair => {
      const biasEntry = (biasArr ?? []).find(b => b.pair === pair);
      const pairMap   = Object.fromEntries((fxPairs ?? []).map(p => [p.pair, p]));
      const pairRow   = pairMap[pair];
      if (!biasEntry || !pairRow) return null;
      return buildPairExport(pairRow, biasEntry, {
        ...opts,
        livePrice: livePrices[pair] ?? null,
      });
    })
    .filter(Boolean);

  return {
    export_type:    'multi_pair',
    export_version: EXPORT_VERSION,
    generated_at:   isoNow(),
    snapshot_date:  isoDate(),
    assets_count:   assets.length,
    assets,
  };
}

// ── INTELLIGENCE EXPORTS (AGENT CONSENSUS + REGIME + INTERMARKET) ─────────────

/**
 * buildIntelligenceExport — structured JSON for the intelligence briefing scope.
 * Pulls from agentConsensus, adaptiveRegime, intermarket, signalPriority in opts.
 */
export function buildIntelligenceExport(opts = {}) {
  const {
    agentConsensus = null,
    adaptiveRegime = null,
    intermarket    = null,
    signalPriority = null,
    macroSignal    = null,
    riskRegime     = null,
    cotDate        = null,
  } = opts;

  const ag = agentConsensus;
  const ar = adaptiveRegime;
  const im = intermarket;
  const sp = signalPriority;

  return {
    export_type:    'intelligence_briefing',
    export_version: EXPORT_VERSION,
    generated_at:   isoNow(),
    cot_week:       cotDate ?? null,

    regime: ar ? {
      adaptive:      ar.regime,
      label:         ar.meta?.label,
      base:          ar.base?.regime ?? riskRegime?.regime ?? null,
      conviction:    ar.conviction,
      momentum:      ar.momentum,
      action_bias:   ar.meta?.actionBias,
      bias:          ar.meta?.bias,
      exhaustion:    ar.exhaustion ? {
        detected:      ar.exhaustion.isExhausted,
        extreme_pairs: ar.exhaustion.extremePairs ?? [],
      } : null,
      transition: ar.transition ? {
        risk:     ar.transition.transitionRisk,
        pending:  ar.transition.isPending,
        signals:  ar.transition.signals ?? [],
      } : null,
      key_drivers: ar.adaptiveDrivers ?? [],
    } : null,

    agent_consensus: ag ? {
      score:       ag.consensus?.score,
      label:       ag.consensus?.label,
      direction:   ag.consensus?.direction,
      confidence:  ag.consensus?.confidence,
      environment: ag.environment,
      veto:        ag.risk?.veto ?? false,
      veto_reason: ag.risk?.vetoReason ?? null,
      risk_level:  ag.risk?.level,
      probability: ag.probability,
      summary:     ag.summary,
      agents: {
        cot: {
          score:      ag.agents?.cot?.score,
          confidence: ag.agents?.cot?.confidence,
          direction:  ag.agents?.cot?.direction,
          signals:    ag.agents?.cot?.signals ?? [],
          warnings:   ag.agents?.cot?.warnings ?? [],
        },
        macro: {
          score:      ag.agents?.macro?.score,
          confidence: ag.agents?.macro?.confidence,
          usd_bias:   ag.agents?.macro?.usdBias,
          vix:        ag.agents?.macro?.vix,
          signals:    ag.agents?.macro?.signals ?? [],
        },
        liquidity: {
          score:     ag.agents?.liquidity?.score,
          condition: ag.agents?.liquidity?.condition,
          regime:    ag.agents?.liquidity?.regime,
          signals:   ag.agents?.liquidity?.signals ?? [],
          warnings:  ag.agents?.liquidity?.warnings ?? [],
        },
        intraday: {
          score:   ag.agents?.intraday?.score,
          quality: ag.agents?.intraday?.quality,
          signals: ag.agents?.intraday?.signals ?? [],
        },
      },
      conditions: {
        best:  ag.conditions?.best ?? [],
        avoid: ag.conditions?.avoid ?? [],
      },
    } : null,

    intermarket: im ? {
      health_score:    im.health?.score,
      health_label:    im.health?.label,
      aligned_count:   im.health?.aligned ?? 0,
      diverging_count: im.health?.diverging ?? 0,
      breakdown_count: im.health?.breakdowns ?? 0,
      key_divergences: im.keyDivergences ?? [],
      signals: (im.signals ?? []).map(s => ({
        id:          s.id,
        description: s.description,
        status:      s.status,
        assetA:      s.assetA,
        assetB:      s.assetB,
        insight:     s.insight,
      })),
    } : null,

    priority_signals: sp ? {
      critical_count: sp.criticalCount ?? 0,
      total_signals:  sp.signals?.length ?? 0,
      briefing:       sp.briefing ?? [],
      signals: (sp.signals ?? []).slice(0, 10).map(s => ({
        priority: s.priority,
        category: s.category,
        title:    s.title,
        detail:   s.detail,
        action:   s.action ?? null,
      })),
    } : null,

    macro_context: macroSignal ? {
      bias:       macroSignal.bias,
      confidence: macroSignal.confidence,
      drivers:    macroSignal.drivers ?? [],
    } : null,
  };
}

/**
 * buildTelegramBriefing — Telegram-optimized text briefing (UTF-8, emoji-annotated).
 * Compact enough for a Telegram message. Returns a plain text string.
 */
export function buildTelegramBriefing(opts = {}) {
  const {
    agentConsensus = null,
    adaptiveRegime = null,
    intermarket    = null,
    signalPriority = null,
    macroSignal    = null,
    cotDate        = null,
  } = opts;

  const lines = [];
  const date  = isoDate();

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push('📊 *COT TRACKER — INSTITUTIONAL BRIEFING*');
  lines.push(`📅 ${date}${cotDate ? ` | COT Week: ${cotDate}` : ''}`);
  lines.push('');

  // ── VERDICT (most important — surfaces first) ─────────────────────────────
  if (agentConsensus) {
    const ag       = agentConsensus;
    const env      = ag.environment ?? 'UNKNOWN';
    const dir      = ag.consensus?.direction ?? 'NEUTRAL';
    const score    = ag.consensus?.score ?? 0;
    const cont     = ag.probability?.continuation ?? '—';
    const trap     = ag.probability?.trap ?? '—';
    const envEmoji = { FAVORABLE: '✅', CAUTION: '⚠️', DEFENSIVE: '🛡️', DANGER: '🚨' }[env] ?? '❓';
    const dirEmoji = dir === 'BULLISH' ? '📈' : dir === 'BEARISH' ? '📉' : '➡️';

    lines.push('*━━━ OVERALL VERDICT ━━━*');
    if (ag.risk?.veto) {
      lines.push(`🚫 *VETO ACTIVE — STAND ASIDE*`);
      lines.push(`Reason: ${ag.risk.vetoReason ?? 'Risk conditions not met'}`);
    } else {
      lines.push(`${dirEmoji} *${dir}* ${envEmoji} ${env}`);
      lines.push(`Score: ${score}/100 | Continuation: ${cont}% | Trap Risk: ${trap}%`);
    }
    lines.push('');
  }

  // ── Priority signals (P1 + P2 — critical first) ───────────────────────────
  if (signalPriority?.signals?.length) {
    const critical = signalPriority.signals.filter(s => s.priority === 'P1');
    const high     = signalPriority.signals.filter(s => s.priority === 'P2');
    const toShow   = [...critical, ...high].slice(0, 5);

    if (toShow.length) {
      lines.push('*━━━ PRIORITY SIGNALS ━━━*');
      toShow.forEach(s => {
        const tag = s.priority === 'P1' ? '🔴' : '🟡';
        lines.push(`${tag} *[${s.priority}]* ${s.title}`);
        if (s.action) lines.push(`   ↳ ${s.action}`);
      });
      lines.push('');
    }
  }

  // ── Institutional summary (briefing text) ────────────────────────────────
  if (signalPriority?.briefing?.length) {
    lines.push('*━━━ MARKET CONTEXT ━━━*');
    signalPriority.briefing.slice(0, 3).forEach(line => lines.push(`• ${line}`));
    lines.push('');
  }

  // ── Adaptive Regime ──────────────────────────────────────────────────────
  if (adaptiveRegime) {
    const ar       = adaptiveRegime;
    const conv     = ar.conviction?.level?.toUpperCase() ?? '—';
    const mom      = ar.momentum?.direction?.toUpperCase() ?? 'STABLE';
    const bias     = ar.meta?.actionBias?.replace(/_/g, ' ') ?? '—';
    const regEmoji = {
      RISK_ON_ACCELERATION: '🚀', RISK_ON: '📈', RISK_ON_EXHAUSTION: '⚠️',
      RISK_OFF: '📉', RISK_OFF_EXTREME: '🚨', STAGFLATION: '🔥',
      DISINFLATION: '❄️', LIQUIDITY_STRESS: '💧', TRANSITIONAL: '🔄',
    }[ar.regime] ?? '⬡';

    lines.push(`${regEmoji} *REGIME: ${ar.meta?.label?.toUpperCase() ?? ar.regime}*`);
    lines.push(`Conviction: ${conv} (${ar.conviction?.score ?? 0}/10) | Momentum: ${mom}`);
    lines.push(`Action Bias: ${bias}`);
    if (ar.transition?.isPending) {
      lines.push(`🔄 Transition Risk: ${ar.transition.transitionRisk?.toUpperCase() ?? 'PENDING'}`);
    }
    if (ar.exhaustion?.isExhausted) {
      lines.push(`⚠️ Exhaustion: ${ar.exhaustion.extremePairs?.length ?? 0} pairs at positioning extremes`);
    }
    lines.push('');
  }

  // ── Agent breakdown (compact) ────────────────────────────────────────────
  if (agentConsensus?.agents) {
    const a = agentConsensus.agents;
    lines.push('*Agent Scores:*');
    if (a.cot)        lines.push(`• COT ${a.cot.score}/100 (${a.cot.confidence?.toUpperCase() ?? '?'}) — ${a.cot.direction?.toUpperCase() ?? '—'}`);
    if (a.macro)      lines.push(`• Macro ${a.macro.score}/100 — ${a.macro.usdBias?.replace(/_/g, ' ') ?? '—'}`);
    if (a.liquidity)  lines.push(`• Liquidity ${a.liquidity.score}/100 — ${a.liquidity.condition ?? '—'}`);
    if (a.intraday)   lines.push(`• Intraday ${a.intraday.score}/100 — ${a.intraday.quality ?? '—'}`);
    lines.push('');
  }

  // ── Intermarket health ───────────────────────────────────────────────────
  if (intermarket?.health) {
    const im = intermarket;
    const hEmoji = (im.health.breakdowns ?? 0) > 0 ? '🔴' : (im.health.diverging ?? 0) > 0 ? '⚠️' : '✅';
    lines.push(`${hEmoji} *INTERMARKET: ${im.health.label?.toUpperCase() ?? '—'} (${im.health.score ?? 0}/100)*`);
    lines.push(`Aligned: ${im.health.aligned ?? 0} | Diverging: ${im.health.diverging ?? 0} | Breakdown: ${im.health.breakdowns ?? 0}`);
    if (im.keyDivergences?.length) {
      im.keyDivergences.slice(0, 2).forEach(d => lines.push(`• ${d}`));
    }
    lines.push('');
  }

  // ── Macro context ────────────────────────────────────────────────────────
  if (macroSignal?.bias) {
    lines.push(`🌍 *MACRO:* ${macroSignal.bias.replace(/_/g, ' ')} | Conf: ${macroSignal.confidence ?? 0}/10`);
    if (macroSignal.drivers?.[0]) lines.push(`• ${macroSignal.drivers[0]}`);
    lines.push('');
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push('─────────────────────');
  lines.push('_COT Tracker — Institutional Intelligence_');
  lines.push('_Not financial advice. Institutional context only._');

  return lines.join('\n');
}
