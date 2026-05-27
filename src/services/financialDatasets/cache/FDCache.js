// =============================================================================
// Financial Datasets — Cache Layer
//
// Multi-TTL in-memory cache with:
//   - Per-key TTL configuration
//   - LRU eviction (max 200 entries)
//   - Manual invalidation
//   - Stale-while-revalidate flag
//   - localStorage persistence for offline resilience
// =============================================================================

const MAX_ENTRIES = 200;
const LS_PREFIX   = 'fd_cache_v1_';

const TTL = {
  snapshot:    60_000,        // 1 min — real-time prices
  prices:      3_600_000,     // 1 h — daily bars
  earnings:    3_600_000,     // 1 h — quarterly data
  financials:  6 * 3_600_000, // 6 h — annual statements
  equity:      6 * 3_600_000, // 6 h — full equity bundle
  company:     24 * 3_600_000,// 24 h — company facts
  macroBasket: 2 * 60_000,    // 2 min — macro snapshot basket
  cryptoEtf:   2 * 60_000,    // 2 min — crypto ETF basket
};

class FDCache {
  constructor() {
    this._store = new Map();
    this._hydrate();
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this._store.delete(key);
      this._lsDelete(key);
      return null;
    }

    entry.lastAccessed = now;
    return { data: entry.data, stale: false, age: now - entry.createdAt };
  }

  getStale(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    const now = Date.now();
    return { data: entry.data, stale: now > entry.expiresAt, age: now - entry.createdAt };
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  set(key, data, ttlMs) {
    this._evict();
    const now = Date.now();
    const entry = { data, createdAt: now, lastAccessed: now, expiresAt: now + ttlMs };
    this._store.set(key, entry);
    this._lsSet(key, entry);
    return this;
  }

  // ── Typed setters (enforce canonical TTLs) ────────────────────────────────

  setSnapshot(ticker, data)    { return this.set(`snapshot:${ticker}`,    data, TTL.snapshot);    }
  setPrices(ticker, data)      { return this.set(`prices:${ticker}`,      data, TTL.prices);      }
  setEarnings(ticker, data)    { return this.set(`earnings:${ticker}`,    data, TTL.earnings);    }
  setFinancials(key, data)     { return this.set(`financials:${key}`,     data, TTL.financials);  }
  setEquity(ticker, data)      { return this.set(`equity:${ticker}`,      data, TTL.equity);      }
  setCompany(ticker, data)     { return this.set(`company:${ticker}`,     data, TTL.company);     }
  setMacroBasket(data)         { return this.set('macro-basket',          data, TTL.macroBasket); }
  setCryptoEtf(data)           { return this.set('crypto-etf',            data, TTL.cryptoEtf);   }

  getSnapshot(ticker)          { return this.get(`snapshot:${ticker}`);    }
  getPrices(ticker)            { return this.get(`prices:${ticker}`);      }
  getEarnings(ticker)          { return this.get(`earnings:${ticker}`);    }
  getFinancials(key)           { return this.get(`financials:${key}`);     }
  getEquity(ticker)            { return this.get(`equity:${ticker}`);      }
  getCompany(ticker)           { return this.get(`company:${ticker}`);     }
  getMacroBasket()             { return this.get('macro-basket');          }
  getCryptoEtf()               { return this.get('crypto-etf');            }

  // ── Invalidation ──────────────────────────────────────────────────────────

  invalidate(key) {
    this._store.delete(key);
    this._lsDelete(key);
  }

  invalidateTicker(ticker) {
    for (const k of this._store.keys()) {
      if (k.includes(ticker)) { this._store.delete(k); this._lsDelete(k); }
    }
  }

  clear() {
    this._store.clear();
    Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore quota/security errors */ }
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _evict() {
    if (this._store.size < MAX_ENTRIES) return;
    const sorted = [...this._store.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toRemove = sorted.slice(0, Math.ceil(MAX_ENTRIES * 0.2));
    toRemove.forEach(([k]) => { this._store.delete(k); this._lsDelete(k); });
  }

  _lsSet(key, entry) {
    try {
      if (entry.expiresAt - Date.now() < 60_000) return; // don't persist sub-minute cache
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
    } catch { /* ignore quota errors */ }
  }

  _lsDelete(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch { /* ignore */ }
  }

  _hydrate() {
    try {
      const now = Date.now();
      Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .forEach(k => {
          const raw = localStorage.getItem(k);
          if (!raw) return;
          const entry = JSON.parse(raw);
          if (entry.expiresAt > now) {
            this._store.set(k.slice(LS_PREFIX.length), entry);
          } else {
            localStorage.removeItem(k);
          }
        });
    } catch { /* ignore parse errors in localStorage */ }
  }

  get size() { return this._store.size; }

  stats() {
    const now = Date.now();
    let live = 0, stale = 0;
    for (const entry of this._store.values()) {
      if (entry.expiresAt > now) live++; else stale++;
    }
    return { total: this._store.size, live, stale };
  }
}

export const fdCache = new FDCache();
