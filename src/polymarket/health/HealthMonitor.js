// =============================================================================
// POLYMARKET × COT TRACKER — HEALTH MONITOR
// src/polymarket/health/HealthMonitor.js
//
// Circuit breakers + health tracking per data source.
// Prevents cascade failures when Polymarket API or Yahoo Finance are degraded.
//
// Circuit breaker states:
//   CLOSED    — normal operation
//   OPEN      — failing; calls skipped, cached/null returned
//   HALF_OPEN — cooldown elapsed; next call probes availability
//
// Sources tracked: 'polymarket_api', 'yahoo_finance', 'polymarket_ws'
// =============================================================================

const CIRCUIT_DEFAULTS = {
  failureThreshold:  5,            // consecutive failures to trip OPEN
  cooldownMs:        2 * 60_000,   // 2 min before probing
  halfOpenMaxProbes: 3,            // successes needed to re-CLOSE
  rateLimitBackoffMs: 30_000,      // initial 429 backoff
  maxBackoffMs:      10 * 60_000,  // cap at 10 min
};

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker
// ─────────────────────────────────────────────────────────────────────────────

class CircuitBreaker {
  constructor(source, config = {}) {
    this.source          = source;
    this.cfg             = { ...CIRCUIT_DEFAULTS, ...config };
    this._state          = 'CLOSED';
    this._failures       = 0;        // consecutive failures
    this._probes         = 0;        // consecutive successes in HALF_OPEN
    this._openedAt       = 0;
    this._lastSuccessAt  = 0;
    this._rateLimitUntil = 0;
    this._currentBackoff = this.cfg.rateLimitBackoffMs;
    this._totalCalls     = 0;
    this._totalErrors    = 0;
  }

  /** Returns false when calls should be skipped entirely. */
  isAvailable() {
    if (Date.now() < this._rateLimitUntil) return false;

    if (this._state === 'CLOSED' || this._state === 'HALF_OPEN') return true;

    // OPEN: promote to HALF_OPEN after cooldown
    if (Date.now() - this._openedAt >= this.cfg.cooldownMs) {
      this._state  = 'HALF_OPEN';
      this._probes = 0;
      return true;
    }
    return false;
  }

  recordSuccess() {
    this._totalCalls++;
    this._lastSuccessAt  = Date.now();
    this._failures       = 0;
    this._currentBackoff = this.cfg.rateLimitBackoffMs;

    if (this._state === 'HALF_OPEN') {
      this._probes++;
      if (this._probes >= this.cfg.halfOpenMaxProbes) {
        this._state = 'CLOSED';
      }
    }
  }

  /** @param {Error|undefined} err */
  recordFailure(err) {
    this._totalCalls++;
    this._totalErrors++;
    this._failures++;

    // Rate limit: 429 or explicit message
    const msg = err?.message ?? '';
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.includes('Too Many')) {
      this._rateLimitUntil = Date.now() + this._currentBackoff;
      this._currentBackoff = Math.min(this._currentBackoff * 2, this.cfg.maxBackoffMs);
    }

    // Trip breaker
    if (this._state === 'HALF_OPEN' || this._failures >= this.cfg.failureThreshold) {
      this._state    = 'OPEN';
      this._openedAt = Date.now();
    }
  }

  getStatus() {
    return {
      source:         this.source,
      state:          this._state,
      consecutiveFails: this._failures,
      lastSuccessAt:  this._lastSuccessAt,
      rateLimited:    Date.now() < this._rateLimitUntil,
      rateLimitUntil: this._rateLimitUntil,
      errorRate:      this._totalCalls > 0
        ? Math.round((this._totalErrors / this._totalCalls) * 100) / 100
        : 0,
      totalCalls:     this._totalCalls,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Monitor (facade over multiple circuit breakers)
// ─────────────────────────────────────────────────────────────────────────────

export class HealthMonitor {
  constructor() {
    this._breakers = new Map([
      ['polymarket_api', new CircuitBreaker('polymarket_api')],
      ['yahoo_finance',  new CircuitBreaker('yahoo_finance', { failureThreshold: 3 })],
      ['polymarket_ws',  new CircuitBreaker('polymarket_ws', { cooldownMs: 5 * 60_000 })],
    ]);

    // composite → last update timestamp (ms)
    this._compositeUpdatedAt = {};
    // rolling warning log
    this._warnings = [];
  }

  // ── Circuit breaker API ───────────────────────────────────────────────────

  /** Returns false when calls to `source` should be skipped. */
  isAvailable(source) {
    return this._breakers.get(source)?.isAvailable() ?? true;
  }

  recordSuccess(source) {
    this._breakers.get(source)?.recordSuccess();
  }

  /** @param {string} source @param {Error|undefined} err */
  recordFailure(source, err) {
    const breaker = this._breakers.get(source);
    if (!breaker) return;
    breaker.recordFailure(err);
    const { state, consecutiveFails } = breaker.getStatus();
    if (state === 'OPEN') {
      this._warn(`Circuit OPEN for '${source}' (${consecutiveFails} consecutive failures)`);
    }
  }

  // ── Composite freshness ───────────────────────────────────────────────────

  recordCompositeUpdate(name) {
    this._compositeUpdatedAt[name] = Date.now();
  }

  /** Returns age in milliseconds, or Infinity if never updated. */
  getCompositeAge(name) {
    const t = this._compositeUpdatedAt[name];
    return t ? Date.now() - t : Infinity;
  }

  isCompositeStale(name, maxAgeMs = 24 * 60 * 60_000) {
    return this.getCompositeAge(name) > maxAgeMs;
  }

  // ── Health report ─────────────────────────────────────────────────────────

  /**
   * Returns a structured health snapshot.
   * { isHealthy, breakers, compositeAges, recentWarnings, reportedAt }
   */
  getHealthReport() {
    const breakers = {};
    for (const [key, b] of this._breakers) {
      breakers[key] = b.getStatus();
    }

    const compositeAges = {};
    for (const [name, ts] of Object.entries(this._compositeUpdatedAt)) {
      compositeAges[name] = Math.round((Date.now() - ts) / 60_000); // minutes
    }

    const isHealthy = Object.values(breakers).every(b => b.state !== 'OPEN');

    return {
      isHealthy,
      breakers,
      compositeAges,
      recentWarnings: this._warnings.slice(-10),
      reportedAt: Date.now(),
    };
  }

  _warn(msg) {
    this._warnings.push({ msg, ts: Date.now() });
    if (this._warnings.length > 50) this._warnings.shift();
    console.warn('[HealthMonitor]', msg);
  }
}
