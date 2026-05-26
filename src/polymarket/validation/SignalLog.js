// =============================================================================
// POLYMARKET × COT TRACKER — SIGNAL AUDIT LOG
// src/polymarket/validation/SignalLog.js
//
// Lightweight signal validation framework using localStorage.
// Purpose: structured observation of composite values over time to enable
// retrospective analysis of signal predictive value.
//
// What this logs (at each full metric recalculation, ~8h intervals):
//   • MSC value and regime
//   • RRC value, regime, 7d delta
//   • GTRP value and confidence
//   • PUI value
//   • FDS divergence and isSignificant flag
//   • CRR, CESI, SSI (crypto layer)
//
// What this enables:
//   • "Was MSC ≥ 65 predictive of subsequent USD weakness?"
//   • "Did RRC elevation precede risk-off regimes in the next 48h?"
//   • "How often did FDS divergence resolve in the Polymarket direction?"
//
// Limitations:
//   • Observation only — no live backtesting engine
//   • Outcome tagging (did the prediction prove correct?) requires manual review
//   • localStorage cap: ~5MB max; this log is bounded to MAX_ENTRIES
//
// For external analysis: call signalLog.exportJSON() → paste into Python/Excel.
// =============================================================================

const STORAGE_KEY = 'cot_pm_signal_log_v2';
const MAX_ENTRIES = 360; // ~3 months at 8h cadence = 270 entries, buffer to 360

export class SignalLog {
  constructor() {
    // In-session write buffer — flushed to localStorage on each append()
    this._buffer = [];
    this._sessionStart = Date.now();
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Append a composite metrics snapshot to the log.
   * Call after each full _recalculateAllMetrics() run.
   * @param {object} metrics - service._metrics object
   */
  append(metrics) {
    const entry = this._buildEntry(metrics);
    if (!entry) return;
    this._buffer.push(entry);
    this._flushToStorage();
  }

  _buildEntry(metrics) {
    try {
      return {
        ts:      Date.now(),
        // MSC
        msc:     metrics.msc?.value   ?? null,
        mscR:    metrics.msc?.regime  ?? null,
        mscRCE:  metrics.msc?.riskCompressionExpansion ?? null,
        // RRC
        rrc:     metrics.rrc?.value   ?? null,
        rrcR:    metrics.rrc?.regime  ?? null,
        rrcD7:   metrics.rrc?.delta7d ?? null,
        // GTRP
        gtrp:    metrics.gtrp?.value  ?? null,
        gtrpC:   metrics.gtrp?.confidence ?? null,
        gtrpDom: metrics.gtrp?.dominantRisk ?? null,
        // PUI
        pui:     metrics.pui?.value   ?? null,
        puiN:    metrics.pui?.nOutcomesActive ?? null,
        // FDS
        fdsDiv:  metrics.fds?.divergence !== undefined
          ? Math.round((metrics.fds.divergence ?? 0) * 1000) / 1000
          : null,
        fdsSig:  metrics.fds?.isSignificant ?? false,
        fdsPM:   metrics.fds ? Math.round((metrics.fds.polymarketPCut ?? 0) * 100) : null,
        fdsCME:  metrics.fds?.cmePCut !== undefined && metrics.fds.cmePCut !== null
          ? Math.round(metrics.fds.cmePCut * 100)
          : null,
        // Crypto layer
        crr:     metrics.crr?.value  ?? null,
        crrR:    metrics.crr?.regime ?? null,
        cesi:    metrics.cesi?.value ?? null,
        ssi:     metrics.ssi !== undefined ? Math.round((metrics.ssi.value ?? 0) * 1000) / 1000 : null,
        ssiR:    metrics.ssi?.risk ?? null,
        // Context
        marketCount: metrics.lastMarketCount ?? null,
      };
    } catch {
      return null;
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Returns all log entries within an optional time range.
   * @param {{ fromMs?: number, toMs?: number }} [range]
   * @returns {object[]}
   */
  query({ fromMs, toMs } = {}) {
    const all = this._readFromStorage();
    if (!fromMs && !toMs) return all;
    return all.filter(e =>
      (!fromMs || e.ts >= fromMs) &&
      (!toMs   || e.ts <= toMs)
    );
  }

  /** Returns the most recent N entries. */
  recent(n = 30) {
    const all = this._readFromStorage();
    return all.slice(-Math.max(1, n));
  }

  /**
   * Returns a statistical summary of the logged signals.
   * Useful for calibration review: mean/p25/p75 per composite.
   */
  summarize() {
    const entries = this._readFromStorage();
    if (entries.length === 0) return { count: 0, message: 'No data yet.' };

    const extract = key => entries.map(e => e[key]).filter(v => v !== null);
    const mean    = arr => arr.length
      ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 10) / 10
      : null;
    const pct     = (arr, p) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length * p)];
    };

    const mscV  = extract('msc');
    const rrcV  = extract('rrc');
    const gtrpV = extract('gtrp');
    const puiV  = extract('pui');
    const fdsV  = extract('fdsDiv');

    const spanDays = entries.length > 1
      ? Math.round((entries[entries.length - 1].ts - entries[0].ts) / 86_400_000)
      : 0;

    return {
      count:   entries.length,
      spanDays,
      msc:  { mean: mean(mscV),  p25: pct(mscV, 0.25),  p75: pct(mscV, 0.75),  max: Math.max(...mscV)  },
      rrc:  { mean: mean(rrcV),  p25: pct(rrcV, 0.25),  p75: pct(rrcV, 0.75),  max: Math.max(...rrcV)  },
      gtrp: { mean: mean(gtrpV), p25: pct(gtrpV, 0.25), p75: pct(gtrpV, 0.75)                          },
      pui:  { mean: mean(puiV),  p25: pct(puiV, 0.25),  p75: pct(puiV, 0.75)                           },
      fds:  { mean: mean(fdsV),  p25: pct(fdsV, 0.25),  p75: pct(fdsV, 0.75)                           },
      // Signal frequency stats
      highStressEvents:  entries.filter(e => e.mscR === 'HIGH' || e.mscR === 'EXTREME').length,
      rrcElevatedEvents: entries.filter(e => ['ELEVATED', 'HIGH_RISK', 'SEVERE'].includes(e.rrcR)).length,
      fdsDivEvents:      entries.filter(e => e.fdsSig === true).length,
      crrUncertainEvents: entries.filter(e => ['UNCERTAIN', 'HIGH_RISK'].includes(e.crrR)).length,
    };
  }

  /** Export all entries as JSON string for external analysis. */
  exportJSON() {
    return JSON.stringify(this._readFromStorage(), null, 2);
  }

  /** Clear the entire log. Useful for resetting after major schema changes. */
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this._buffer = [];
    } catch { /* localStorage unavailable — non-fatal */ }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _flushToStorage() {
    try {
      const stored = this._readFromStorage();
      // Merge stored + buffer, deduplicate by ts, sort, cap at MAX_ENTRIES
      const all  = [...stored, ...this._buffer];
      const seen = new Set();
      const deduped = all
        .filter(e => { const dup = seen.has(e.ts); seen.add(e.ts); return !dup; })
        .sort((a, b) => a.ts - b.ts)
        .slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
      this._buffer = [];
    } catch {
      // Storage unavailable or quota exceeded — discard silently
      if (this._buffer.length > 50) this._buffer = this._buffer.slice(-50);
    }
  }

  _readFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : [];
      const base = Array.isArray(stored) ? stored : [];
      // Merge with in-session buffer (dedup by ts)
      const all  = [...base, ...this._buffer];
      const seen = new Set();
      return all.filter(e => { const dup = seen.has(e.ts); seen.add(e.ts); return !dup; });
    } catch {
      return [...this._buffer];
    }
  }
}
