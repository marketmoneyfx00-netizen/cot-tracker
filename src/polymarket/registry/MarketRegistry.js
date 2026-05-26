// =============================================================================
// POLYMARKET × COT TRACKER — MARKET REGISTRY
// src/polymarket/registry/MarketRegistry.js
//
// Manages the lifecycle of tracked markets:
//   - Resolves slugs → conditionIds at startup
//   - Provides lookup methods for adapters
//   - Marks markets as resolved when WS fires market_resolved
// =============================================================================

import { INITIAL_REGISTRY, CALENDAR_TO_POLYMARKET_MAP } from './registry-data.js';

export class MarketRegistry {
  /**
   * @param {import('../fetcher/DataFetcher.js').DataFetcher} fetcher
   */
  constructor(fetcher) {
    this._fetcher = fetcher;
    /** @type {Map<string, object>} slug → TrackedMarket (with conditionId populated) */
    this._markets = new Map();
    /** @type {Map<string, string>} conditionId → slug (reverse lookup) */
    this._byConditionId = new Map();
    /** @type {Map<string, string>} yesTokenId → slug */
    this._byTokenId = new Map();
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Resolves all slugs in INITIAL_REGISTRY to conditionIds via Polymarket API.
   * Markets that fail to resolve are silently skipped (they may be expired or renamed).
   */
  async resolveAll() {
    const BATCH_SIZE = 5;
    for (let i = 0; i < INITIAL_REGISTRY.length; i += BATCH_SIZE) {
      const batch = INITIAL_REGISTRY.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(m => this._resolveOne(m)));
      // Small pause to be respectful to Polymarket API
      if (i + BATCH_SIZE < INITIAL_REGISTRY.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  async _resolveOne(marketDef) {
    try {
      const resolved = await this._fetcher.resolveMarketBySlug(marketDef.slug);
      if (!resolved) {
        console.warn(`[MarketRegistry] Could not resolve slug: ${marketDef.slug}`);
        return;
      }

      const market = {
        ...marketDef,
        conditionId: resolved.conditionId,
        yesTokenId:  resolved.yesTokenId,
        noTokenId:   resolved.noTokenId,
        resolved:    false,
      };

      this._markets.set(market.slug, market);
      this._byConditionId.set(market.conditionId, market.slug);
      this._byTokenId.set(market.yesTokenId, market.slug);
      if (market.noTokenId) this._byTokenId.set(market.noTokenId, market.slug);

    } catch (err) {
      console.warn(`[MarketRegistry] Resolution error for ${marketDef.slug}:`, err.message);
    }
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  getAll() {
    return Array.from(this._markets.values());
  }

  getBySlug(slug) {
    return this._markets.get(slug) ?? null;
  }

  findByConditionId(conditionId) {
    const slug = this._byConditionId.get(conditionId);
    return slug ? this._markets.get(slug) ?? null : null;
  }

  findByTokenId(tokenId) {
    const slug = this._byTokenId.get(tokenId);
    return slug ? this._markets.get(slug) ?? null : null;
  }

  /**
   * Returns all markets linked to a calendar event type.
   * e.g. findByCalendarEvent('FOMC') → Fed policy markets
   */
  findByCalendarEvent(eventType) {
    const slugs = CALENDAR_TO_POLYMARKET_MAP[eventType.toUpperCase()] ?? [];
    return slugs
      .map(slug => this._markets.get(slug))
      .filter(Boolean);
  }

  findByCategory(category) {
    return this.getAll().filter(m => m.category === category && !m.resolved);
  }

  count() {
    return this._markets.size;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  markResolved(slug) {
    const m = this._markets.get(slug);
    if (m) {
      m.resolved = true;
      m.lastResolvedAt = Date.now();
      console.info(`[MarketRegistry] Market resolved: ${slug}`);
    }
  }

  // Temporarily add a market discovered via WebSocket new_market event
  addTemporary(market) {
    this._markets.set(market.slug, { ...market, resolved: false });
    if (market.conditionId) this._byConditionId.set(market.conditionId, market.slug);
    if (market.yesTokenId)  this._byTokenId.set(market.yesTokenId, market.slug);
  }
}
