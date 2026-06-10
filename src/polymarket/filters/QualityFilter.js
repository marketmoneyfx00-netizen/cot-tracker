// =============================================================================
// POLYMARKET × COT TRACKER — QUALITY FILTER
// src/polymarket/filters/QualityFilter.js
//
// Validates market data quality before it enters composites.
// Conservative thresholds — false negatives are safer than false positives.
// =============================================================================

const DEFAULT_QUALITY_CONFIG = {
  globalMinOI:                       50_000,
  globalMaxSpread:                   0.18,
  globalMinDaysToExpiry:             3,
  staleThresholdMs:                  2 * 60 * 60 * 1000,    // 2h
  manipulationThresholdPriceDelta:   0.15,                   // 15% move in 1h
  manipulationThresholdMinVolume:    1_000,                  // USD — below this, ignore
};

export class QualityFilter {
  /** @param {Partial<typeof DEFAULT_QUALITY_CONFIG>} config */
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_QUALITY_CONFIG, ...config };
  }

  /**
   * Returns true if snapshot passes all quality gates.
   * @param {object} snapshot
   */
  passes(snapshot) {
    if (!snapshot) return false;
    if (snapshot.manipulationFlag) return false;
    if (snapshot.openInterest < this.cfg.globalMinOI) return false;
    if (snapshot.spread > this.cfg.globalMaxSpread) return false;
    if (snapshot.daysToExpiry < this.cfg.globalMinDaysToExpiry) return false;
    if (snapshot.midpoint <= 0 || snapshot.midpoint >= 1) return false;
    return true;
  }

  /**
   * Returns true if snapshot data is stale (last fetched > threshold).
   * Weekend-aware: doesn't flag weekends as stale for BATCH_DAILY markets.
   * @param {object} snapshot
   */
  isStale(snapshot) {
    if (!snapshot) return true;
    const age = Date.now() - snapshot.fetchedAt;
    if (age < this.cfg.staleThresholdMs) return false;

    // Weekend: don't flag as stale (markets don't move on weekends)
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend && age < 48 * 60 * 60 * 1000) return false;

    return true;
  }

  /**
   * Detect potential price manipulation.
   * Conservative: only flags extreme moves with very low volume.
   * When in doubt, show with flag rather than silently exclude.
   * @param {object} snapshot
   * @param {object} history
   */
  detectManipulation(snapshot, history) {
    if (!history?.prices?.length || history.prices.length < 2) return false;
    if (snapshot.volume24h > this.cfg.manipulationThresholdMinVolume * 100) return false;

    const sorted = [...history.prices].sort((a, b) => b.timestamp - a.timestamp);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const priceOneHourAgo = sorted.find(p => p.timestamp <= oneHourAgo)?.price;
    if (priceOneHourAgo == null) return false;

    const priceDelta = Math.abs(snapshot.midpoint - priceOneHourAgo);
    const isLowVolume = snapshot.volume24h < this.cfg.manipulationThresholdMinVolume;

    return priceDelta >= this.cfg.manipulationThresholdPriceDelta && isLowVolume;
  }

  /**
   * Classify new market from WS (for auto-discovery).
   * Returns MacroCategory string or null if irrelevant.
   * @param {string} question
   * @param {string[]} tags
   */
  classifyMarket(question, tags = []) {
    const q = question.toLowerCase();
    const t = tags.join(' ').toLowerCase();
    const text = `${q} ${t}`;

    if (/fed|fomc|rate cut|rate hike|federal reserve/.test(text)) return 'FED_POLICY';
    if (/recession|gdp negative|economic contraction/.test(text)) return 'RECESSION';
    if (/inflation|cpi|pce|consumer price/.test(text)) return 'INFLATION';
    if (/tariff|trade war|trade deal|customs|import duty/.test(text)) return 'TRADE_WAR';
    if (/war|conflict|ceasefire|military|invasion/.test(text)) return 'GEOPOLITICAL';
    if (/nato|article 5|nuclear/.test(text)) return 'GEOPOLITICAL';
    if (/shutdown|debt ceiling|treasury default/.test(text)) return 'FISCAL_DEBT';
    if (/unemployment|nonfarm|nfp|jobs report/.test(text)) return 'EMPLOYMENT';

    return null; // not macro-relevant
  }
}
