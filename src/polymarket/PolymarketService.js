// =============================================================================
// POLYMARKET × COT TRACKER — POLYMARKET SERVICE (ORCHESTRATOR)
// src/polymarket/PolymarketService.js
//
// Singleton. Manages the full lifecycle:
//   registry resolution → data fetching → quality filtering →
//   metric computation → signal emission → websocket
//
// Phase 1: runs silently in background. Zero UI changes. Zero regressions.
// =============================================================================

import { DataFetcher }       from './fetcher/DataFetcher.js';
import { CacheLayer }        from './cache/CacheLayer.js';
import { QualityFilter }     from './filters/QualityFilter.js';
import { MarketRegistry }    from './registry/MarketRegistry.js';
import { NarrativeGenerator } from './narrative/NarrativeGenerator.js';
import { signalBus }         from './signals/SignalBus.js';
import {
  calculateConsensusVelocity,
  calculateRecessionRiskComposite,
  calculateGeopoliticalTailRiskPulse,
  calculatePolicyUncertaintyIndex,
  calculateMacroStressComposite,
  calculateNarrativeTransitionScore,
  calculateFedDivergenceSignal,
  calculateBiasModifier,
} from './metrics/MetricEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  polling: {
    batchIntervalMs:          8 * 60 * 60 * 1000,  // 8h
    eventPollingIntervalMs:   15 * 60 * 1000,       // 15 min
    wsReconnectDelayMs:       5_000,
    maxWsReconnectAttempts:   10,
  },
  features: {
    enableWebSocket:             false, // Phase 1: disabled until token IDs are verified
    enableManipulationDetection: true,
    enableNarrativeGeneration:   true,
    enableBiasModification:      true,
    enableCryptoLayer:           false, // Phase 4
  },
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class PolymarketService {
  constructor(config = {}) {
    this._cfg      = { ...DEFAULT_CONFIG, ...config,
      polling:  { ...DEFAULT_CONFIG.polling,  ...(config.polling  ?? {}) },
      features: { ...DEFAULT_CONFIG.features, ...(config.features ?? {}) },
    };
    this._fetcher      = new DataFetcher();
    this._cache        = new CacheLayer();
    this._filter       = new QualityFilter();
    this._registry     = new MarketRegistry(this._fetcher);
    this._narrativeGen = new NarrativeGenerator(signalBus);

    this._ws                 = null;
    this._wsReconnectCount   = 0;
    this._batchTimer         = null;
    this._eventPollingTimers = new Map();
    this._initialized        = false;

    // EMA history accumulators (reset on service restart)
    this._rrcEmaHistory = [];
    this._mscEmaHistory = [];

    this._metrics = {
      pui:  null,
      rrc:  null,
      gtrp: null,
      msc:  null,
      crr:  null,
      velocities:  new Map(),
      nts:         new Map(),
      pisi:        new Map(),
      fds:         null,
      lastFullRecalculation: 0,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize() {
    if (this._initialized) return;
    console.info('[PolymarketService] Initializing...');

    try {
      await this._registry.resolveAll();
      console.info(`[PolymarketService] Registry resolved: ${this._registry.count()} markets`);

      await this._runBatch();

      this._batchTimer = setInterval(
        () => this._runBatch().catch(err => console.error('[PolymarketService] Batch error:', err)),
        this._cfg.polling.batchIntervalMs
      );

      if (this._cfg.features.enableWebSocket) {
        this._initWebSocket();
      }

      this._initialized = true;
      console.info('[PolymarketService] Ready.');

    } catch (err) {
      console.error('[PolymarketService] Initialization failed:', err);
      // Non-fatal: service is optional. Don't throw — engines degrade gracefully.
    }
  }

  shutdown() {
    if (this._batchTimer) clearInterval(this._batchTimer);
    this._eventPollingTimers.forEach(t => clearInterval(t));
    this._eventPollingTimers.clear();
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
    }
    this._initialized = false;
  }

  // ── Batch pipeline ────────────────────────────────────────────────────────

  async _runBatch() {
    const start = Date.now();
    console.debug('[PolymarketService] Running batch...');

    const markets = this._registry.getAll().filter(m => !m.resolved);
    const snapshots = [];

    for (let i = 0; i < markets.length; i += 10) {
      const batch   = markets.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(m => this._fetchAndCacheSnapshot(m))
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) snapshots.push(r.value);
      });
      if (i + 10 < markets.length) await sleep(200);
    }

    // Price histories for reliable markets only
    const reliableMarkets = markets.filter(m =>
      snapshots.find(s => s.conditionId === m.conditionId)?.isReliable
    );
    for (const market of reliableMarkets) {
      const age = this._cache.getPriceHistoryAge(market.conditionId);
      if (Date.now() - age > this._cfg.polling.batchIntervalMs / 2) {
        const history = await this._fetcher.fetchPriceHistory(market, '1w', 60);
        if (history) this._cache.setPriceHistory(market.conditionId, history);
      }
    }

    await this._recalculateAllMetrics(snapshots);
    console.debug(`[PolymarketService] Batch complete in ${Date.now() - start}ms. Snapshots: ${snapshots.length}`);
  }

  // ── Event polling ─────────────────────────────────────────────────────────

  activateEventPolling(calendarEventId, eventType) {
    if (this._eventPollingTimers.has(calendarEventId)) return;

    const timer = setInterval(async () => {
      await this._runEventPoll(calendarEventId, eventType);
    }, this._cfg.polling.eventPollingIntervalMs);

    this._eventPollingTimers.set(calendarEventId, timer);
    this._runEventPoll(calendarEventId, eventType).catch(console.error);
    console.info(`[PolymarketService] Event polling activated: ${calendarEventId}`);
  }

  deactivateEventPolling(calendarEventId) {
    const t = this._eventPollingTimers.get(calendarEventId);
    if (t) {
      clearInterval(t);
      this._eventPollingTimers.delete(calendarEventId);
    }
  }

  async _runEventPoll(calendarEventId, eventType) {
    const relatedMarkets = this._registry.findByCalendarEvent(eventType);
    if (relatedMarkets.length === 0) return;

    for (const market of relatedMarkets) {
      const snapshot = await this._fetchAndCacheSnapshot(market);
      if (!snapshot?.isReliable) continue;

      const history = this._cache.getPriceHistory(market.conditionId);
      if (!history) continue;

      const cv = calculateConsensusVelocity(snapshot, history);
      this._metrics.velocities.set(snapshot.conditionId, cv);

      signalBus.emit({
        type:      'PISI_UPDATE',
        category:  market.category,
        value:     snapshot.midpoint * 100,
        confidence: snapshot.qualityScore / 100,
        direction:  cv.direction.includes('UP')   ? 'BULLISH'
                  : cv.direction.includes('DOWN') ? 'BEARISH' : 'NEUTRAL',
        magnitude:  cv.magnitude,
        generatedAt: Date.now(),
        sources:    [market.conditionId],
        payload:    { calendarEventId, cv, snapshot },
        narrative:  this._narrativeGen.generateEventNarrative(snapshot, cv, calendarEventId),
      });
    }
  }

  // ── Metric recalculation ──────────────────────────────────────────────────

  async _recalculateAllMetrics(snapshots) {
    const bySlug        = new Map(snapshots.map(s => [s.slug, s]));
    const byConditionId = new Map(snapshots.map(s => [s.conditionId, this._cache.getPriceHistory(s.conditionId)]));

    // ── RRC ──────────────────────────────────────────────────────────────
    const rrc = calculateRecessionRiskComposite(
      {
        currentYear:           bySlug.get('us-recession-2025'),
        nextYear:              bySlug.get('us-recession-2026'),
        negativeGDPQuarter:    bySlug.get('us-gdp-negative-q2-2025'),
        unemploymentThreshold: bySlug.get('us-unemployment-above-5-percent-2025'),
      },
      this._rrcEmaHistory
    );
    this._rrcEmaHistory.push(rrc.value);
    if (this._rrcEmaHistory.length > 60) this._rrcEmaHistory.shift();
    this._metrics.rrc = rrc;

    // ── GTRP ─────────────────────────────────────────────────────────────
    const geoSnapshots = snapshots.filter(s =>
      s.category === 'GEOPOLITICAL' || s.category === 'TRADE_WAR'
    );
    if (geoSnapshots.length > 0) {
      this._metrics.gtrp = calculateGeopoliticalTailRiskPulse(geoSnapshots);
    }

    // ── PUI ──────────────────────────────────────────────────────────────
    const fedMarkets = snapshots.filter(s => s.category === 'FED_POLICY');
    if (fedMarkets.length > 0) {
      const outcomeProbs  = this._buildFedOutcomeDistribution(fedMarkets);
      const aggregateOI   = fedMarkets.reduce((sum, m) => sum + m.openInterest, 0);
      this._metrics.pui   = calculatePolicyUncertaintyIndex(outcomeProbs, aggregateOI);
    }

    // ── FDS ──────────────────────────────────────────────────────────────
    const nextFedMarket = bySlug.get('fed-rate-cut-june-2025') ?? bySlug.get('fed-rate-cut-july-2025');
    if (nextFedMarket) {
      const cmeProbability = await this._fetchCMEFedProbability();
      const meetingDate    = nextFedMarket.slug.includes('june') ? '2025-06-18' : '2025-07-30';
      this._metrics.fds    = calculateFedDivergenceSignal(nextFedMarket, meetingDate, cmeProbability);
    }

    // ── MSC ──────────────────────────────────────────────────────────────
    if (this._metrics.rrc && this._metrics.gtrp && this._metrics.pui) {
      const msc = calculateMacroStressComposite(
        this._metrics.rrc,
        this._metrics.gtrp,
        this._metrics.pui,
        this._metrics.fds,
        this._mscEmaHistory
      );
      this._mscEmaHistory.push(msc.value);
      if (this._mscEmaHistory.length > 60) this._mscEmaHistory.shift();
      this._metrics.msc = msc;
    }

    // ── CV + NTS per market ───────────────────────────────────────────────
    for (const snapshot of snapshots) {
      const history = byConditionId.get(snapshot.conditionId);
      if (!history) continue;

      const cv = calculateConsensusVelocity(snapshot, history);
      this._metrics.velocities.set(snapshot.conditionId, cv);

      const nts = calculateNarrativeTransitionScore(
        snapshot,
        history,
        snapshot.openInterest * 0.9,
        []
      );
      this._metrics.nts.set(snapshot.conditionId, nts);
    }

    this._metrics.lastFullRecalculation = Date.now();
    this._emitCompositeSignals();
  }

  // ── Signal emission ───────────────────────────────────────────────────────

  _emitCompositeSignals() {
    const { rrc, gtrp, pui, msc, fds } = this._metrics;
    const CONF_TO_NUM = { HIGH: 1, MEDIUM: 0.7, LOW: 0.4, INSUFFICIENT: 0 };

    if (rrc) {
      signalBus.emit({
        type:      'RRC_UPDATE',
        category:  'RECESSION',
        value:     rrc.value,
        confidence: CONF_TO_NUM[rrc.confidence] ?? 0,
        direction:  rrc.value > 40 ? 'BEARISH' : rrc.value < 20 ? 'BULLISH' : 'NEUTRAL',
        magnitude:  rrc.value >= 55 ? 'HIGH' : rrc.value >= 35 ? 'MEDIUM' : 'LOW',
        generatedAt: Date.now(),
        sources:   ['us-recession-2025'],
        payload:   { rrc },
        narrative: this._narrativeGen.generateRRCNarrative(rrc),
      });
    }

    if (gtrp) {
      signalBus.emit({
        type:      'GTRP_UPDATE',
        category:  'GEOPOLITICAL',
        value:     gtrp.value * 100,
        confidence: CONF_TO_NUM[gtrp.confidence] ?? 0,
        direction:  gtrp.value > 0.55 ? 'BEARISH' : 'NEUTRAL',
        magnitude:  gtrp.value >= 0.70 ? 'HIGH' : gtrp.value >= 0.50 ? 'MEDIUM' : 'LOW',
        generatedAt: Date.now(),
        sources:   [],
        payload:   { gtrp },
        narrative: this._narrativeGen.generateGTRPNarrative(gtrp),
      });
    }

    if (msc) {
      signalBus.emit({
        type:      'MSC_UPDATE',
        category:  'GLOBAL_MACRO',
        value:     msc.value,
        confidence: 0.8,
        direction:  msc.value > 55 ? 'BEARISH' : msc.value < 25 ? 'BULLISH' : 'NEUTRAL',
        magnitude:  msc.value >= 65 ? 'HIGH' : msc.value >= 45 ? 'MEDIUM' : 'LOW',
        generatedAt: Date.now(),
        sources:   [],
        payload:   { msc },
        narrative: this._narrativeGen.generateMSCNarrative(msc),
      });
    }

    if (fds?.isSignificant) {
      signalBus.emit({
        type:      'FDS_ALERT',
        category:  'FED_POLICY',
        value:     (fds.divergence ?? 0) * 100,
        confidence: CONF_TO_NUM[fds.confidence] ?? 0,
        direction:  (fds.divergence ?? 0) > 0 ? 'BULLISH' : 'BEARISH',
        magnitude:  Math.abs(fds.divergence ?? 0) > 0.20 ? 'HIGH' : 'MEDIUM',
        generatedAt: Date.now(),
        sources:   [],
        payload:   { fds },
        narrative: fds.implication,
      });
    }

    this._metrics.nts.forEach(nts => {
      if (nts.isSignificant) {
        signalBus.emit({
          type:      'NTS_ALERT',
          category:  'GLOBAL_MACRO',
          value:     nts.value * 100,
          confidence: 0.7,
          direction:  'UNCERTAIN',
          magnitude:  nts.value >= 0.80 ? 'HIGH' : 'MEDIUM',
          generatedAt: Date.now(),
          sources:   [nts.conditionId],
          payload:   { nts },
          narrative: `Transición de narrativa: mercado ${nts.conditionId}, score ${(nts.value * 100).toFixed(0)}`,
        });
      }
    });
  }

  // ── WebSocket (Phase 3) ───────────────────────────────────────────────────

  _initWebSocket() {
    const realtimeMarkets = this._registry.getAll().filter(
      m => m.refreshStrategy === 'REALTIME_WS' && m.yesTokenId
    );
    if (realtimeMarkets.length === 0) return;

    const tokenIds = realtimeMarkets.flatMap(m => [m.yesTokenId, m.noTokenId].filter(Boolean));

    try {
      this._ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

      this._ws.onopen = () => {
        this._wsReconnectCount = 0;
        this._ws.send(JSON.stringify({
          assets_ids: tokenIds,
          type: 'market',
          custom_feature_enabled: true,
        }));
        console.info('[PolymarketService] WebSocket connected');
      };

      this._ws.onmessage = (event) => {
        try {
          this._handleWSMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('[PolymarketService] WS parse error:', err);
        }
      };

      this._ws.onerror = () => {};

      this._ws.onclose = () => {
        if (this._wsReconnectCount < this._cfg.polling.maxWsReconnectAttempts) {
          this._wsReconnectCount++;
          const delay = this._cfg.polling.wsReconnectDelayMs * Math.pow(1.5, this._wsReconnectCount);
          setTimeout(() => this._initWebSocket(), delay);
        }
      };

    } catch (err) {
      console.error('[PolymarketService] WS init error:', err);
    }
  }

  _handleWSMessage(msg) {
    switch (msg.event_type) {
      case 'best_bid_ask': {
        const market = this._registry.findByTokenId(msg.asset_id ?? '');
        if (!market) return;
        const cached = this._cache.getSnapshot(market.conditionId);
        if (cached) {
          cached.bestBid  = parseFloat(msg.best_bid);
          cached.bestAsk  = parseFloat(msg.best_ask);
          cached.spread   = parseFloat(msg.spread);
          cached.midpoint = (cached.bestBid + cached.bestAsk) / 2;
          cached.isStale  = false;
          cached.fetchedAt = Date.now();
          this._cache.setSnapshot(market.conditionId, cached);
        }
        break;
      }

      case 'new_market': {
        const category = this._filter.classifyMarket(msg.question ?? '', msg.tags ?? []);
        if (category) {
          signalBus.emit({
            type:       'NEW_MARKET_DETECTED',
            category,
            value:      50,
            confidence: 0.5,
            direction:  'UNCERTAIN',
            magnitude:  'LOW',
            generatedAt: Date.now(),
            sources:    [],
            payload:    { question: msg.question, slug: msg.slug },
            narrative:  `Nuevo mercado de predicción: "${msg.question}". Narrativa emergente en ${category}.`,
          });
        }
        break;
      }

      case 'market_resolved': {
        const market = this._registry.findByConditionId(msg.market);
        if (market) {
          this._registry.markResolved(market.slug);
          signalBus.emit({
            type:       'MARKET_RESOLVED',
            category:   'GLOBAL_MACRO',
            value:      0,
            confidence: 1,
            direction:  'NEUTRAL',
            magnitude:  'NEGLIGIBLE',
            generatedAt: Date.now(),
            sources:    [msg.market],
            payload:    { market: msg.market, slug: market.slug },
            narrative:  `Mercado resuelto: ${market.slug}`,
          });
        }
        break;
      }
    }
  }

  // ── Public API (consumed by adapters) ─────────────────────────────────────

  getMetrics() {
    return { ...this._metrics };
  }

  getBiasModifier(instrument) {
    const { rrc, gtrp, pui, fds } = this._metrics;
    if (!rrc || !gtrp || !pui) {
      return { modifier: 0, confidence: 0, narrative: 'Polymarket data not yet available' };
    }
    return calculateBiasModifier(instrument, rrc, gtrp, pui, fds);
  }

  getEventContext(calendarEventId, eventType) {
    const pisi           = this._metrics.pisi.get(calendarEventId) ?? null;
    const relatedMarkets = this._registry.findByCalendarEvent(eventType);
    const firstMarket    = relatedMarkets[0];
    const cv             = firstMarket
      ? this._metrics.velocities.get(firstMarket.conditionId) ?? null
      : null;
    return { pisi, cv, fds: this._metrics.fds };
  }

  isReady() {
    return this._initialized;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _fetchAndCacheSnapshot(market) {
    const cached = this._cache.getSnapshot(market.conditionId);
    if (cached && !this._filter.isStale(cached)) return cached;

    const snapshot = await this._fetcher.fetchSnapshot(market);
    if (!snapshot) return null;

    if (this._cfg.features.enableManipulationDetection) {
      const history = this._cache.getPriceHistory(market.conditionId);
      if (history && this._filter.detectManipulation(snapshot, history)) {
        snapshot.manipulationFlag = true;
        signalBus.emit({
          type:       'MANIPULATION_WARNING',
          category:   market.category,
          value:      snapshot.midpoint,
          confidence: 0.7,
          direction:  'UNCERTAIN',
          magnitude:  'HIGH',
          generatedAt: Date.now(),
          sources:    [market.conditionId],
          payload:    { slug: market.slug },
          narrative:  `Posible manipulación en ${market.slug}. Excluido de composites.`,
        });
        return null;
      }
    }

    this._cache.setSnapshot(market.conditionId, snapshot);
    return snapshot;
  }

  _buildFedOutcomeDistribution(fedMarkets) {
    const dist = {};
    for (const m of fedMarkets) {
      const q = m.question.toLowerCase();
      if (/50bp|50 basis/.test(q))          dist['cut50']  = m.midpoint;
      else if (/25bp|cut|25 basis/.test(q)) dist['cut25']  = m.midpoint;
      else if (/hold|pause/.test(q))        dist['hold']   = m.midpoint;
      else if (/hike|raise/.test(q))        dist['hike']   = m.midpoint;
    }
    if (dist.cut25 && !dist.hold) dist['hold'] = 1 - dist.cut25;
    return dist;
  }

  // Phase 1: CME not integrated. Returns null → FDS shows PM side only.
  async _fetchCMEFedProbability() {
    return null;
  }
}

// Singleton export
export const polymarketService = new PolymarketService();
