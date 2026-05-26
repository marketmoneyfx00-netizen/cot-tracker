// =============================================================================
// POLYMARKET × COT TRACKER — IN-MEMORY CACHE LAYER
// src/polymarket/cache/CacheLayer.js
//
// TTL-based in-memory cache. No persistence in Phase 1.
// =============================================================================

/** @typedef {{ data: any, cachedAt: number, ttlMs: number }} CacheEntry */

class CacheEntry {
  constructor(data, ttlMs) {
    this.data = data;
    this.cachedAt = Date.now();
    this.ttlMs = ttlMs;
  }
  isValid() {
    return Date.now() - this.cachedAt < this.ttlMs;
  }
}

const DEFAULT_TTL = {
  snapshots:    5 * 60 * 1000,        // 5 min
  priceHistory: 60 * 60 * 1000,       // 1 hour
  metrics:      15 * 60 * 1000,       // 15 min
  pisi:         15 * 60 * 1000,       // 15 min
  registry:     7 * 24 * 60 * 60 * 1000, // 7 days
};

export class CacheLayer {
  /** @param {Partial<typeof DEFAULT_TTL>} config */
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_TTL, ...config };

    /** @type {Map<string, CacheEntry>} */
    this._snapshots = new Map();
    /** @type {Map<string, CacheEntry>} */
    this._histories = new Map();
    /** @type {Map<string, CacheEntry>} */
    this._metrics   = new Map();

    // Evict expired entries every 10 minutes
    setInterval(() => this._evict(), 10 * 60 * 1000);
  }

  // ── Snapshots ────────────────────────────────────────────────────────────

  getSnapshot(conditionId) {
    const entry = this._snapshots.get(conditionId);
    return entry?.isValid() ? entry.data : null;
  }

  setSnapshot(conditionId, snapshot) {
    this._snapshots.set(conditionId, new CacheEntry(snapshot, this.cfg.snapshots));
  }

  // ── Price Histories ───────────────────────────────────────────────────────

  getPriceHistory(conditionId) {
    const entry = this._histories.get(conditionId);
    return entry?.isValid() ? entry.data : null;
  }

  setPriceHistory(conditionId, history) {
    this._histories.set(conditionId, new CacheEntry(history, this.cfg.priceHistory));
  }

  // Returns when history was last fetched (ms epoch), or 0 if missing
  getPriceHistoryAge(conditionId) {
    return this._histories.get(conditionId)?.cachedAt ?? 0;
  }

  // ── Generic metrics slot ──────────────────────────────────────────────────

  getMetric(key) {
    const entry = this._metrics.get(key);
    return entry?.isValid() ? entry.data : null;
  }

  setMetric(key, value, ttlMs) {
    this._metrics.set(key, new CacheEntry(value, ttlMs ?? this.cfg.metrics));
  }

  // ── Housekeeping ──────────────────────────────────────────────────────────

  _evict() {
    const now = Date.now();
    for (const [k, v] of this._snapshots)    if (!v.isValid()) this._snapshots.delete(k);
    for (const [k, v] of this._histories)    if (!v.isValid()) this._histories.delete(k);
    for (const [k, v] of this._metrics)      if (!v.isValid()) this._metrics.delete(k);
  }

  clear() {
    this._snapshots.clear();
    this._histories.clear();
    this._metrics.clear();
  }
}
