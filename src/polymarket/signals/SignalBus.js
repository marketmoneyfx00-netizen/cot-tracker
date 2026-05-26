// =============================================================================
// POLYMARKET × COT TRACKER — SIGNAL BUS
// src/polymarket/signals/SignalBus.js
//
// Event-driven bus decoupling PolymarketService (producer)
// from engine adapters (consumers).
// =============================================================================

const SIGNAL_PRIORITY = {
  MANIPULATION_WARNING:      0,
  STALE_DATA_WARNING:        0,
  REGIME_TRANSITION_SIGNAL:  1,
  FDS_ALERT:                 1,
  NTS_ALERT:                 1,
  CV_ALERT:                  2,
  MSC_UPDATE:                2,
  GTRP_UPDATE:               2,
  RRC_UPDATE:                2,
  PUI_UPDATE:                3,
  PISI_UPDATE:               3,
  CRR_UPDATE:                3,
  NEW_MARKET_DETECTED:       3,
  MARKET_RESOLVED:           4,
};

// Default TTL per signal type (ms)
const DEFAULT_TTL = {
  MANIPULATION_WARNING:      30 * 60 * 1000,
  STALE_DATA_WARNING:        15 * 60 * 1000,
  REGIME_TRANSITION_SIGNAL:  48 * 60 * 60 * 1000,
  FDS_ALERT:                 4  * 60 * 60 * 1000,
  NTS_ALERT:                 12 * 60 * 60 * 1000,
  CV_ALERT:                  6  * 60 * 60 * 1000,
  MSC_UPDATE:                60 * 60 * 1000,
  GTRP_UPDATE:               60 * 60 * 1000,
  RRC_UPDATE:                60 * 60 * 1000,
  PUI_UPDATE:                60 * 60 * 1000,
  PISI_UPDATE:               15 * 60 * 1000,
  CRR_UPDATE:                6  * 60 * 60 * 1000,
  NEW_MARKET_DETECTED:       72 * 60 * 60 * 1000,
  MARKET_RESOLVED:           5  * 60 * 1000,
};

// Per-type throttle to avoid flooding engines
const THROTTLE_MS = {
  MSC_UPDATE:  5 * 60 * 1000,
  RRC_UPDATE:  5 * 60 * 1000,
  GTRP_UPDATE: 5 * 60 * 1000,
  PUI_UPDATE:  5 * 60 * 1000,
  PISI_UPDATE: 60 * 1000,
};

const MAGNITUDE_ORDER = ['NEGLIGIBLE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'];

class SignalBus {
  constructor() {
    /** @type {Map<string, object>} id → subscriber */
    this._subscribers = new Map();
    /** @type {object[]} rolling window of recent signals */
    this._history = [];
    this._maxHistorySize = 500;
    /** @type {Map<string, number>} fingerprint → generatedAt */
    this._recentFingerprints = new Map();
    this._dedupeWindow = 60_000;
    /** @type {Map<string, number>} signalType → lastEmittedAt */
    this._lastEmitted = new Map();

    // Clean up expired signals and fingerprints every 5 min
    setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  // ── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * @param {string} name - subscriber name (for logging)
   * @param {object} filter - { types?, minConfidence?, categories?, since?, minMagnitude? }
   * @param {(signal: object) => void} handler
   * @param {{ async?: boolean, replayRecent?: boolean }} opts
   * @returns {() => void} unsubscribe function
   */
  subscribe(name, filter, handler, opts = {}) {
    const id = crypto.randomUUID();
    this._subscribers.set(id, { id, name, filter, handler, async: opts.async ?? false });

    if (opts.replayRecent) {
      const matching = this._history.filter(s => this._matchesFilter(s, filter));
      for (const sig of matching) {
        try { handler(sig); } catch (err) {
          console.error(`[SignalBus] Replay error for "${name}":`, err);
        }
      }
    }

    return () => this._subscribers.delete(id);
  }

  // ── Emit ──────────────────────────────────────────────────────────────────

  /**
   * @param {object} partial - signal without id/expiresAt/processed
   */
  emit(partial) {
    if (this._isThrottled(partial.type)) return;

    const fingerprint = this._fingerprint(partial);
    if (this._isDuplicate(fingerprint)) return;

    const signal = {
      ...partial,
      id:        crypto.randomUUID(),
      expiresAt: partial.generatedAt + (DEFAULT_TTL[partial.type] ?? 60 * 60 * 1000),
      processed: false,
    };

    this._recentFingerprints.set(fingerprint, signal.generatedAt);
    this._history.push(signal);
    if (this._history.length > this._maxHistorySize) this._history.shift();
    this._lastEmitted.set(signal.type, signal.generatedAt);

    const priority = SIGNAL_PRIORITY[signal.type] ?? 5;
    const matching = Array.from(this._subscribers.values())
      .filter(sub => this._matchesFilter(signal, sub.filter))
      .sort((a, b) => priority - priority); // same signal type → same priority, keep insertion order

    for (const sub of matching) {
      if (sub.async) {
        Promise.resolve(sub.handler(signal)).catch(err => {
          console.error(`[SignalBus] Async handler error for "${sub.name}":`, err);
        });
      } else {
        try {
          sub.handler(signal);
          signal.processed = true;
        } catch (err) {
          console.error(`[SignalBus] Handler error for "${sub.name}":`, err);
        }
      }
    }
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  getLatest(filter) {
    const now = Date.now();
    return this._history
      .filter(s => s.expiresAt > now && this._matchesFilter(s, filter))
      .sort((a, b) => b.generatedAt - a.generatedAt);
  }

  getLatestByType(type) {
    return this.getLatest({ types: [type] })[0] ?? null;
  }

  hasActiveSignal(type, minConfidence = 0) {
    const sig = this.getLatestByType(type);
    return sig !== null && sig.confidence >= minConfidence;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _matchesFilter(signal, filter) {
    if (!filter) return true;
    if (filter.types && !filter.types.includes(signal.type)) return false;
    if (filter.minConfidence != null && signal.confidence < filter.minConfidence) return false;
    if (filter.categories && !filter.categories.includes(signal.category)) return false;
    if (filter.since && signal.generatedAt < filter.since) return false;
    if (filter.minMagnitude) {
      const minIdx = MAGNITUDE_ORDER.indexOf(filter.minMagnitude);
      const sigIdx = MAGNITUDE_ORDER.indexOf(signal.magnitude);
      if (sigIdx < minIdx) return false;
    }
    return true;
  }

  _isThrottled(type) {
    const throttle = THROTTLE_MS[type];
    if (!throttle) return false;
    const last = this._lastEmitted.get(type) ?? 0;
    return Date.now() - last < throttle;
  }

  _fingerprint(signal) {
    const rounded = Math.round(signal.value * 10) / 10;
    const sources = (signal.sources ?? []).slice().sort().join(',');
    return `${signal.type}:${rounded}:${sources}`;
  }

  _isDuplicate(fingerprint) {
    const last = this._recentFingerprints.get(fingerprint);
    return last != null && Date.now() - last < this._dedupeWindow;
  }

  _cleanup() {
    const now = Date.now();
    this._history = this._history.filter(s => s.expiresAt > now);
    for (const [fp, ts] of this._recentFingerprints) {
      if (now - ts > this._dedupeWindow * 2) this._recentFingerprints.delete(fp);
    }
  }
}

// Singleton
export const signalBus = new SignalBus();
