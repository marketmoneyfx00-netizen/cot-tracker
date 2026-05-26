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
import { HealthMonitor }     from './health/HealthMonitor.js';
import { SignalLog }         from './validation/SignalLog.js';
import { CRYPTO_REGISTRY }   from './crypto/CryptoRegistryData.js';
import {
  calculateCryptoRegulatoryRegime,
  calculateCryptoETFSignal,
  calculateStablecoinStress,
} from './crypto/CryptoMetrics.js';
import {
  calculateConsensusVelocity,
  calculateRecessionRiskComposite,
  calculateGeopoliticalTailRiskPulse,
  calculatePolicyUncertaintyIndex,
  calculateMacroStressComposite,
  calculateNarrativeTransitionScore,
  calculateFedDivergenceSignal,
  calculateBiasModifier,
  generateSystemExplanation,
} from './metrics/MetricEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  polling: {
    batchIntervalMs:          8 * 60 * 60 * 1000,  // 8h
    eventPollingIntervalMs:   15 * 60 * 1000,       // 15 min
    wsReconnectDelayMs:       5_000,
    maxWsReconnectAttempts:   8,
    criticalMarketPollMs:     10 * 60 * 1000,       // 10 min fallback when WS fails
    batchDebounceMs:          30_000,               // min gap between WS-triggered batch runs
  },
  features: {
    enableWebSocket:             true,  // Phase 3: active for REALTIME_WS markets
    enableManipulationDetection: true,
    enableNarrativeGeneration:   true,
    enableBiasModification:      true,
    enableCryptoLayer:           true,  // Phase 4: institutional crypto intelligence
    enableSignalLog:             true,  // Phase 4: localStorage audit trail
  },
  fds: {
    cacheTtlMs: 60 * 60 * 1000, // 1h cache for CME probability
    cutSizeBp:  0.25,
    minDivergenceToSignal: 0.10,
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

    this._ws                    = null;
    this._wsReconnectCount      = 0;
    this._wsFallbackTimer       = null;
    this._batchTimer            = null;
    this._eventPollingTimers    = new Map();
    this._initialized           = false;
    this._fdsCache              = { value: null, fetchedAt: 0 };
    this._lastBatchAt           = 0;  // for WS-triggered batch dedup

    // Phase 4: health monitor + signal audit log
    this._health    = new HealthMonitor();
    this._signalLog = new SignalLog();

    // EMA history accumulators (reset on service restart)
    this._rrcEmaHistory = [];
    this._mscEmaHistory = [];

    this._metrics = {
      pui:  null,
      rrc:  null,
      gtrp: null,
      msc:  null,
      // Crypto layer (Phase 4)
      crr:  null,
      cesi: null,
      ssi:  null,
      velocities:  new Map(),
      nts:         new Map(),
      pisi:        new Map(),
      fds:         null,
      lastFullRecalculation: 0,
      lastMarketCount:       0,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize() {
    if (this._initialized) return;
    console.info('[PolymarketService] Initializing...');

    try {
      await this._registry.resolveAll();
      console.info(`[PolymarketService] Registry resolved: ${this._registry.count()} markets`);

      // Phase 4: load crypto intelligence markets if enabled
      if (this._cfg.features.enableCryptoLayer) {
        await this._registry.resolveAdditional(CRYPTO_REGISTRY);
        console.info(`[PolymarketService] Crypto layer active: ${this._registry.count()} total markets`);
      }

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
    this._initialized = false; // set first so WS onclose doesn't reconnect
    if (this._batchTimer)     clearInterval(this._batchTimer);
    if (this._wsFallbackTimer) clearInterval(this._wsFallbackTimer);
    this._eventPollingTimers.forEach(t => clearInterval(t));
    this._eventPollingTimers.clear();
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
    }
  }

  // ── Batch pipeline ────────────────────────────────────────────────────────

  async _runBatch() {
    const start = Date.now();
    this._lastBatchAt = start;
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

    // ── Crypto intelligence layer (Phase 4) ──────────────────────────────
    if (this._cfg.features.enableCryptoLayer) {
      const cryptoRegMarkets = snapshots.filter(s => s.category === 'CRYPTO_REGULATION');
      const cryptoEtfMarkets = snapshots.filter(s => s.category === 'CRYPTO_ETF');
      const stablecoinMarkets = snapshots.filter(s => s.category === 'CRYPTO_STABLECOIN');

      // Enrich snapshots with compositeWeight from registry
      const withWeight = (markets) => markets.map(s => {
        const reg = this._registry.getBySlug(s.slug);
        return reg ? { ...s, compositeWeight: reg.compositeWeight, riskReducing: reg.riskReducing } : s;
      });

      if (cryptoRegMarkets.length > 0) {
        this._metrics.crr = calculateCryptoRegulatoryRegime(withWeight(cryptoRegMarkets));
        this._health.recordCompositeUpdate('crr');
      }
      if (cryptoEtfMarkets.length > 0) {
        this._metrics.cesi = calculateCryptoETFSignal(cryptoEtfMarkets);
        this._health.recordCompositeUpdate('cesi');
      }
      if (stablecoinMarkets.length > 0) {
        this._metrics.ssi = calculateStablecoinStress(stablecoinMarkets);
        this._health.recordCompositeUpdate('ssi');
      }
    }

    this._metrics.lastFullRecalculation = Date.now();
    this._metrics.lastMarketCount       = snapshots.length;

    // ── Health freshness tracking ─────────────────────────────────────────
    if (this._metrics.rrc)  this._health.recordCompositeUpdate('rrc');
    if (this._metrics.gtrp) this._health.recordCompositeUpdate('gtrp');
    if (this._metrics.pui)  this._health.recordCompositeUpdate('pui');
    if (this._metrics.msc)  this._health.recordCompositeUpdate('msc');
    if (this._metrics.fds)  this._health.recordCompositeUpdate('fds');

    // ── Signal audit log (Phase 4) ────────────────────────────────────────
    if (this._cfg.features.enableSignalLog) {
      this._signalLog.append(this._metrics);
    }

    this._emitCompositeSignals();
  }

  // ── Signal emission ───────────────────────────────────────────────────────

  _emitCompositeSignals() {
    const { rrc, gtrp, msc, fds } = this._metrics;
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

    // ── Crypto layer signals (Phase 4) ────────────────────────────────────
    const { crr, ssi } = this._metrics;

    if (crr && crr.confidence !== 'INSUFFICIENT') {
      signalBus.emit({
        type:      'CRR_UPDATE',
        category:  'CRYPTO_REGULATION',
        value:     crr.value,
        confidence: CONF_TO_NUM[crr.confidence] ?? 0,
        direction:  crr.regime === 'HIGH_RISK' || crr.regime === 'UNCERTAIN' ? 'BEARISH' : 'NEUTRAL',
        magnitude:  crr.regime === 'HIGH_RISK' ? 'HIGH' : crr.regime === 'UNCERTAIN' ? 'MEDIUM' : 'LOW',
        generatedAt: Date.now(),
        sources:   [],
        payload:   { crr },
        narrative: crr.explanation,
      });
    }

    if (ssi && ssi.confidence !== 'INSUFFICIENT' && ssi.value >= 0.05) {
      signalBus.emit({
        type:      'MSC_UPDATE', // SSI contributes to macro stress — reuse MSC channel
        category:  'CRYPTO_STABLECOIN',
        value:     Math.round(ssi.value * 100),
        confidence: CONF_TO_NUM[ssi.confidence] ?? 0,
        direction:  ssi.risk !== 'MINIMAL' ? 'BEARISH' : 'NEUTRAL',
        magnitude:  ssi.risk === 'SEVERE' ? 'HIGH' : ssi.risk === 'ELEVATED' ? 'MEDIUM' : 'LOW',
        generatedAt: Date.now(),
        sources:   [],
        payload:   { ssi },
        narrative: ssi.explanation,
      });
    }
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
        this._health.recordSuccess('polymarket_ws');
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

      this._ws.onerror = (err) => {
        this._health.recordFailure('polymarket_ws', err instanceof Error ? err : new Error('WS error'));
      };

      this._ws.onclose = () => {
        if (!this._initialized) return; // Explicit shutdown — no reconnect
        if (this._wsReconnectCount < this._cfg.polling.maxWsReconnectAttempts) {
          this._wsReconnectCount++;
          const delay = Math.min(
            this._cfg.polling.wsReconnectDelayMs * Math.pow(1.5, this._wsReconnectCount),
            5 * 60 * 1000 // cap at 5 min
          );
          console.info(`[PolymarketService] WS reconnect #${this._wsReconnectCount} in ${(delay/1000).toFixed(0)}s`);
          setTimeout(() => this._initWebSocket(), delay);
        } else {
          console.warn('[PolymarketService] WS max reconnects reached — activating critical market polling fallback');
          this._startCriticalMarketPolling();
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
          const prevMidpoint = cached.midpoint ?? 0;
          cached.bestBid   = parseFloat(msg.best_bid);
          cached.bestAsk   = parseFloat(msg.best_ask);
          cached.spread    = parseFloat(msg.spread ?? 0);
          cached.midpoint  = (cached.bestBid + cached.bestAsk) / 2;
          cached.isStale   = false;
          cached.fetchedAt = Date.now();
          this._cache.setSnapshot(market.conditionId, cached);

          // Emit CV_ALERT on significant real-time price moves (>= 5pp absolute).
          // This lets regime/narrative engines react before the next batch.
          const delta = Math.abs(cached.midpoint - prevMidpoint);
          if (prevMidpoint > 0 && delta >= 0.05) {
            const dir = cached.midpoint > prevMidpoint ? 'BULLISH' : 'BEARISH';
            signalBus.emit({
              type:       'CV_ALERT',
              category:   market.category,
              value:      Math.round(cached.midpoint * 100),
              confidence: 0.75,
              direction:  dir,
              magnitude:  delta >= 0.10 ? 'HIGH' : 'MEDIUM',
              generatedAt: Date.now(),
              sources:    [market.conditionId],
              payload:    { slug: market.slug, prevMidpoint, newMidpoint: cached.midpoint, delta },
              narrative:  `Repricing en ${market.slug}: ${(delta * 100).toFixed(0)}pp ${dir === 'BULLISH' ? '↑' : '↓'} (tiempo real)`,
            });
            // If the move is very large (>= 10pp) on a FED_POLICY or RECESSION market,
            // trigger a partial metric recalculation immediately.
            // Debounce: skip if a batch ran within the last 30s to avoid bursts.
            if (delta >= 0.10 && (market.category === 'FED_POLICY' || market.category === 'RECESSION')) {
              const now = Date.now();
              if (now - this._lastBatchAt >= this._cfg.polling.batchDebounceMs) {
                this._runBatch().catch(() => {});
              }
            }
          }
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

  // ── Critical market polling fallback (when WS max reconnects exceeded) ───────
  // Polls only REALTIME_WS markets at an elevated frequency as a WS substitute.
  _startCriticalMarketPolling() {
    if (this._wsFallbackTimer) return; // already running
    const criticalMarkets = this._registry.getAll().filter(
      m => m.refreshStrategy === 'REALTIME_WS' && !m.resolved
    );
    if (criticalMarkets.length === 0) return;

    this._wsFallbackTimer = setInterval(async () => {
      for (const market of criticalMarkets) {
        const snapshot = await this._fetchAndCacheSnapshot(market);
        if (snapshot) {
          const history = this._cache.getPriceHistory(market.conditionId);
          if (history) {
            const cv = calculateConsensusVelocity(snapshot, history);
            this._metrics.velocities.set(snapshot.conditionId, cv);
          }
        }
      }
    }, this._cfg.polling.criticalMarketPollMs);

    console.info(`[PolymarketService] Critical market polling fallback active — ${criticalMarkets.map(m=>m.slug).join(', ')}`);
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

  // ── Phase 4 — Public APIs ─────────────────────────────────────────────────

  /**
   * Returns a health report: circuit breaker states, composite freshness, warnings.
   * @returns {object} { isHealthy, breakers, compositeAges, recentWarnings, reportedAt }
   */
  getHealth() {
    return this._health.getHealthReport();
  }

  /**
   * Returns the signal audit log instance for query/export.
   * @returns {import('./validation/SignalLog.js').SignalLog}
   */
  getSignalLog() {
    return this._signalLog;
  }

  /**
   * Returns a structured explanation of the current system state.
   * Includes: MSC drivers, modifier chain for a given instrument, data quality grade.
   * @param {string} [instrument] - optional FX pair for modifier attribution
   * @returns {object}
   */
  getExplainability(instrument) {
    return generateSystemExplanation(this._metrics, instrument);
  }

  /**
   * Returns crypto layer composites (CRR, CESI, SSI).
   * Returns null for each composite when crypto layer is disabled or data is unavailable.
   * @returns {{ crr: object|null, cesi: object|null, ssi: object|null }}
   */
  getCryptoMetrics() {
    return {
      crr:  this._metrics.crr  ?? null,
      cesi: this._metrics.cesi ?? null,
      ssi:  this._metrics.ssi  ?? null,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _fetchAndCacheSnapshot(market) {
    const cached = this._cache.getSnapshot(market.conditionId);
    if (cached && !this._filter.isStale(cached)) return cached;

    // Circuit breaker: skip API call if Polymarket is currently failing
    if (!this._health.isAvailable('polymarket_api')) {
      console.debug(`[PolymarketService] Circuit OPEN for polymarket_api — skipping ${market.slug}`);
      return cached ?? null;
    }

    let snapshot;
    try {
      snapshot = await this._fetcher.fetchSnapshot(market);
      this._health.recordSuccess('polymarket_api');
    } catch (err) {
      this._health.recordFailure('polymarket_api', err);
      return cached ?? null;
    }

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

  // Phase 3: Fetch CME-implied cut probability from /api/fed-probability.
  // That endpoint derives the probability from 30-day Fed Funds futures (Yahoo Finance).
  // 1-hour in-service cache to avoid redundant API calls during the same batch cycle.
  async _fetchCMEFedProbability() {
    const now = Date.now();
    if (this._fdsCache.value !== null && now - this._fdsCache.fetchedAt < this._cfg.fds.cacheTtlMs) {
      return this._fdsCache.value;
    }

    // Circuit breaker: skip if Yahoo Finance is currently failing
    if (!this._health.isAvailable('yahoo_finance')) {
      console.debug('[PolymarketService] Circuit OPEN for yahoo_finance — FDS using cached value');
      return this._fdsCache.value;
    }

    try {
      const nextFedSlug = 'fed-rate-cut-june-2025';
      const month       = nextFedSlug.includes('june') ? 'june' : 'july';
      const res = await fetch(`/api/fed-probability?month=${month}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.probability === 'number' && data.probability >= 0) {
        this._health.recordSuccess('yahoo_finance');
        this._fdsCache = { value: data.probability, fetchedAt: now };
        console.debug(`[PolymarketService] FDS CME probability: ${(data.probability * 100).toFixed(1)}% (${data.source})`);
        return data.probability;
      }
    } catch (err) {
      this._health.recordFailure('yahoo_finance', err);
      console.debug('[PolymarketService] FDS fetch failed (non-critical):', err.message);
    }

    return null; // Graceful degradation: FDS shows Polymarket side only
  }
}

// Singleton export
export const polymarketService = new PolymarketService();
