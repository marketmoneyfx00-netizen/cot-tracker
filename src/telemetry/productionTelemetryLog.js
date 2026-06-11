// =============================================================================
// PRODUCTION TELEMETRY LOG — FASE 9 (Auditoría de Producción → Medición real)
// src/telemetry/productionTelemetryLog.js
//
// PURPOSE: Pure observation. Records, on each recompute (rate-limited),
// a classified snapshot of the 7 audited engines:
//   1. Bias Score        (cotBiasEngine)
//   2. Execution Score   (intradayExecutionEngine, via buildPairContext)
//   3. Confluence Score  (confluenceEngine, via buildBiasArray)
//   4. IIS Score         (agentOrchestrator) — NOTE: not wired into the UI,
//                          see _iisStatus below.
//   5. Risk Regime       (riskRegimeEngine)
//   6. Flow State        (flowPersistenceEngine, via buildPairContext)
//   7. Decay State       (confidenceDecayEngine, via buildPairContext)
//
// This module does NOT alter any score, weight, threshold or engine output.
// It only reads already-computed results and stores a classified copy.
//
// Storage: localStorage, capped window (default 30 days), bounded entry count.
// Cadence: caller decides; recordSnapshot() is itself rate-limited via
// MIN_INTERVAL_MS to avoid flooding storage on every render/poll tick.
//
// Read API:
//   productionTelemetryLog.summarize() → full report (see bottom of file)
//   productionTelemetryLog.exportJSON() → raw entries for external analysis
// =============================================================================

const STORAGE_KEY     = 'cot_production_telemetry_v1';
const MIN_INTERVAL_MS = 5 * 60 * 1000;   // rate-limit: at most 1 entry / 5 min
const RETENTION_MS    = 30 * 24 * 60 * 60 * 1000; // 30-day rolling window
const MAX_ENTRIES     = 30 * 24 * 12;    // 30 days @ 5min cadence (upper bound)

// ── CLASSIFICATION HELPERS ────────────────────────────────────────────────────
// Each classify* function maps a raw engine output to one of:
//   'neutral' | 'extreme' | 'valid' | 'unavailable' | 'fallback'
// using the SAME thresholds the engines themselves already define
// (no new thresholds are introduced here).

function classifyBias(biasScore) {
  if (biasScore == null || isNaN(biasScore)) return 'unavailable';
  const abs = Math.abs(biasScore);
  if (abs >= 4)   return 'extreme';   // matches getSemanticState strong_bull/strong_bear
  if (abs < 1.5)  return 'neutral';   // matches getDirection 'neutral'
  return 'valid';                     // bull/bear (1.5 <= |score| < 4)
}

function classifyExecution(intradayResult) {
  if (!intradayResult || typeof intradayResult.score !== 'number') return 'unavailable';
  const s = intradayResult.score;
  if (s < 45)  return 'extreme';   // RESTRINGIDO
  if (s >= 70) return 'extreme';   // FAVORABLE (high end is also an "extreme" actionable state)
  if (s >= 45 && s < 70) return 'neutral'; // EN MEJORA band
  return 'valid';
}

function classifyConfluence(confluence) {
  if (!confluence || typeof confluence.confluenceScore !== 'number') return 'unavailable';
  const s = confluence.confluenceScore;
  if (s === 0) return 'fallback';   // 'Sin Confluencia Direccional' — gate not met / no inputs
  if (s >= 70) return 'extreme';    // 'Confluencia Alta'
  if (s < 45)  return 'neutral';    // 'Confluencia Baja' / 'Sin Confluencia'
  return 'valid';                   // 'Confluencia Moderada'
}

function classifyIIS(consensus) {
  if (!consensus || typeof consensus.score !== 'number') return 'unavailable';
  const s = consensus.score;
  if (consensus.label === 'PELIGRO' || consensus.label === 'FAVORABLE') return 'extreme';
  if (s >= 45 && s <= 60) return 'neutral';
  return 'valid';
}

function classifyRiskRegime(riskRegime) {
  if (!riskRegime || !riskRegime.regime) return 'unavailable';
  if (riskRegime.regime === 'TRANSITIONAL') return 'neutral';
  if (riskRegime.confidence >= 70) return 'extreme';
  return 'valid';
}

function classifyFlowState(flowState) {
  if (flowState == null) return 'unavailable';
  if (flowState === 'EXHAUSTING') return 'extreme';
  if (/NEUTRAL|NONE|FLAT/i.test(String(flowState))) return 'neutral';
  return 'valid';
}

function classifyDecayState(decayResult) {
  if (!decayResult || !decayResult.level) return 'unavailable';
  if (decayResult.level === 'structural_conflict') return 'extreme';
  if (decayResult.level === 'high_alignment')       return 'extreme';
  if (decayResult._fallback || decayResult.tacPressure === 'insufficient') return 'fallback';
  return 'neutral'; // moderate_alignment / weak_alignment
}

// ── SEGMENT: FX-only vs TFF Combined ──────────────────────────────────────────
// A user is "FX-only" if combinedData has no usable cross-asset entries
// (GOLD/WTI/DXY/SP500/NAS100/US10Y/US2Y) — i.e. riskRegime.availableSignals <= 1.
function classifyDataSegment(riskRegime) {
  const available = riskRegime?.availableSignals ?? 0;
  return available <= 1 ? 'fx_only' : 'tff_combined';
}

// ── LOG CLASS ─────────────────────────────────────────────────────────────────

export class ProductionTelemetryLog {
  constructor() {
    this._buffer = [];
    this._lastRecordTs = 0;
  }

  /**
   * Record a single snapshot. Rate-limited to MIN_INTERVAL_MS.
   *
   * @param {Object} params
   * @param {number|null}  params.biasScore        — currentContext.biasScore
   * @param {Object|null}  params.intradayResult   — currentContext.intradayResult
   * @param {Object|null}  params.confluence       — biasArr entry .confluence for selected pair
   * @param {Object|null}  params.consensus        — runAgentConsensus().consensus (if ever wired)
   * @param {Object|null}  params.riskRegime       — computeRiskRegime() output
   * @param {string|null}  params.flowState        — currentContext.flowState (or intradayResult breakdown)
   * @param {Object|null}  params.decayResult      — confidenceDecayEngine result
   * @param {string}       [params.pair]
   * @param {boolean}      [params.force]          — bypass rate limit (for tests)
   */
  recordSnapshot({
    biasScore     = null,
    intradayResult = null,
    confluence    = null,
    consensus     = null,
    riskRegime    = null,
    flowState     = null,
    decayResult   = null,
    pair          = null,
    force         = false,
  } = {}) {
    const now = Date.now();
    if (!force && (now - this._lastRecordTs) < MIN_INTERVAL_MS) return;
    this._lastRecordTs = now;

    const entry = {
      ts:   now,
      pair,
      bias:        classifyBias(biasScore),
      biasScore:   typeof biasScore === 'number' ? biasScore : null,
      execution:   classifyExecution(intradayResult),
      execScore:   intradayResult?.score ?? null,
      execLevel:   intradayResult?.permissionLevel ?? intradayResult?.label ?? null,
      confluence:  classifyConfluence(confluence),
      confScore:   confluence?.confluenceScore ?? null,
      iis:         classifyIIS(consensus),
      iisScore:    consensus?.score ?? null,
      iisInvoked:  consensus != null, // tracks whether agentOrchestrator was even called
      regime:      riskRegime?.regime ?? null,
      regimeClass: classifyRiskRegime(riskRegime),
      regimeConf:  riskRegime?.confidence ?? null,
      segment:     classifyDataSegment(riskRegime),
      flowState:   flowState ?? null,
      flowClass:   classifyFlowState(flowState),
      decayLevel:  decayResult?.level ?? null,
      decayClass:  classifyDecayState(decayResult),
    };

    this._buffer.push(entry);
    this._flush();
  }

  // ── Storage I/O ──────────────────────────────────────────────────────────

  _flush() {
    try {
      const all = [...this._read(), ...this._buffer];
      const cutoff = Date.now() - RETENTION_MS;
      const pruned = all
        .filter(e => e.ts >= cutoff)
        .sort((a, b) => a.ts - b.ts)
        .slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
      this._buffer = [];
    } catch {
      if (this._buffer.length > 100) this._buffer = this._buffer.slice(-100);
    }
  }

  _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : [];
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  /** Returns all entries (stored + unflushed buffer). */
  all() {
    return [...this._read(), ...this._buffer];
  }

  exportJSON() {
    return JSON.stringify(this.all(), null, 2);
  }

  clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    this._buffer = [];
  }

  // ── SUMMARY REPORT ─────────────────────────────────────────────────────────
  /**
   * Produces the report requested in FASE 9:
   *   - per-engine: frequency of each state, % neutral, % extreme,
   *     % unavailable, % fallback
   *   - Risk Regime: % per regime, segmented by fx_only / tff_combined
   *   - Ranking: most-used vs least-used engines
   *     ("used" = % of snapshots where the engine produced a non-neutral,
   *      non-unavailable, non-fallback ['valid'|'extreme'] reading)
   */
  summarize() {
    const entries = this.all();
    const n = entries.length;
    if (n === 0) return { count: 0, message: 'No telemetry recorded yet.' };

    const spanDays = n > 1 ? +((entries[n - 1].ts - entries[0].ts) / 86_400_000).toFixed(1) : 0;

    const pct = (count) => +((count / n) * 100).toFixed(1);

    const dist = (key, classKey) => {
      const counts = {};
      const classCounts = { neutral: 0, extreme: 0, valid: 0, unavailable: 0, fallback: 0 };
      for (const e of entries) {
        const v = e[key];
        const label = v == null ? '(null)' : String(v);
        counts[label] = (counts[label] || 0) + 1;
        const c = e[classKey];
        if (c in classCounts) classCounts[c]++;
      }
      return {
        frequency: Object.fromEntries(
          Object.entries(counts).map(([k, c]) => [k, { count: c, pct: pct(c) }])
        ),
        pctNeutral:     pct(classCounts.neutral),
        pctExtreme:     pct(classCounts.extreme),
        pctUnavailable: pct(classCounts.unavailable),
        pctFallback:    pct(classCounts.fallback),
        pctValid:       pct(classCounts.valid),
      };
    };

    // Risk Regime — global + segmented
    const regimeCounts = (subset) => {
      const c = { TRANSITIONAL: 0, RISK_ON: 0, RISK_OFF: 0, STAGFLATION: 0, DISINFLATION: 0, LIQUIDITY_STRESS: 0, '(null)': 0 };
      for (const e of subset) {
        const r = e.regime ?? '(null)';
        c[r] = (c[r] ?? 0) + 1;
      }
      const total = subset.length || 1;
      return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +((v / total) * 100).toFixed(1)]));
    };
    const fxOnly   = entries.filter(e => e.segment === 'fx_only');
    const combined = entries.filter(e => e.segment === 'tff_combined');

    // IIS invocation rate — directly answers "is this engine even running?"
    const iisInvokedCount = entries.filter(e => e.iisInvoked).length;

    // Ranking: "used" = engine produced a 'valid' or 'extreme' reading
    // (i.e. not neutral, not unavailable, not fallback — a reading that
    // could plausibly move a decision).
    const usageRate = (classKey) => {
      const used = entries.filter(e => e[classKey] === 'valid' || e[classKey] === 'extreme').length;
      return pct(used);
    };
    const ranking = [
      { engine: 'Bias',       usagePct: usageRate('bias') },
      { engine: 'Execution',  usagePct: usageRate('execution') },
      { engine: 'Confluence', usagePct: usageRate('confluence') },
      { engine: 'IIS',        usagePct: iisInvokedCount > 0 ? usageRate('iis') : 0 },
      { engine: 'RiskRegime', usagePct: usageRate('regimeClass') },
      { engine: 'FlowState',  usagePct: usageRate('flowClass') },
      { engine: 'DecayState', usagePct: usageRate('decayClass') },
    ].sort((a, b) => b.usagePct - a.usagePct);

    return {
      count: n,
      spanDays,
      bias:        dist('biasScore', 'bias'),
      execution:   dist('execLevel', 'execution'),
      confluence:  dist('confScore', 'confluence'),
      iis: {
        invokedPct: pct(iisInvokedCount),
        ...(iisInvokedCount > 0 ? dist('iisScore', 'iis') : { note: 'agentOrchestrator.runAgentConsensus() never invoked in this session — IIS is not wired into the UI.' }),
      },
      riskRegime: {
        overall:     regimeCounts(entries),
        fx_only:     { n: fxOnly.length,   distribution: regimeCounts(fxOnly) },
        tff_combined:{ n: combined.length, distribution: regimeCounts(combined) },
      },
      flowState:  dist('flowState', 'flowClass'),
      decayState: dist('decayLevel', 'decayClass'),
      ranking: {
        mostUsed:  ranking[0],
        leastUsed: ranking[ranking.length - 1],
        full: ranking,
      },
    };
  }
}

export const productionTelemetryLog = new ProductionTelemetryLog();
