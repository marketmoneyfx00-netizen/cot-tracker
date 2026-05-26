// =============================================================================
// POLYMARKET × COT TRACKER — ENGINE ADAPTERS
// src/polymarket/integrations/EngineAdapters.js
//
// Thin translation layers between PolymarketService and existing engines.
// Rule: adapters import from Polymarket. Engines import from adapters.
// Coupling is strictly unidirectional: Polymarket → Adapter → Engine.
// =============================================================================

import { signalBus }         from '../signals/SignalBus.js';
import { polymarketService } from '../PolymarketService.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. INSTITUTIONAL BIAS ENGINE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage in bias calculation (Phase 2):
//   const adapter = new BiasEngineAdapter();
//   adapter.start();
//   const { adjustedScore } = adapter.applyModifier(baseScore, 'EUR/USD');

export class BiasEngineAdapter {
  constructor() {
    this._unsubscribe = null;
    /** @type {Map<string, object>} instrument → BiasModifierPayload */
    this._modifiers = new Map();
  }

  start() {
    this._unsubscribe = signalBus.subscribe(
      'BiasEngineAdapter',
      {
        types: ['RRC_UPDATE', 'GTRP_UPDATE', 'MSC_UPDATE', 'FDS_ALERT', 'PUI_UPDATE'],
        minConfidence: 0.40,
      },
      () => this._modifiers.clear(), // invalidate cached modifiers on any update
      { replayRecent: true }
    );
  }

  stop() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /**
   * Get modifier payload for an instrument.
   * @param {string} instrument - e.g. 'EUR/USD', 'USD', 'XAUUSD'
   */
  getModifier(instrument) {
    const cached = this._modifiers.get(instrument);
    if (cached && Date.now() < cached.expiresAt) return cached;

    const result  = polymarketService.getBiasModifier(instrument);
    const payload = {
      instrument,
      modifier:   result.modifier,
      confidence: result.confidence,
      sources:    this._getActiveSources(),
      narrative:  result.narrative,
      expiresAt:  Date.now() + 15 * 60 * 1000,
    };
    this._modifiers.set(instrument, payload);
    return payload;
  }

  /**
   * Apply Polymarket modifier to existing COT bias score.
   * Hard rules:
   *   - Never inverts the sign of baseScore
   *   - Max absolute impact: maxModifierAbsolute points
   *   - Requires minConfidence to apply
   *
   * @param {number} baseScore - COT bias (-100 to +100, or -5 to +5 for display scale)
   * @param {string} instrument
   * @param {{ maxModifierAbsolute?: number, requireMinConfidence?: number }} opts
   */
  applyModifier(baseScore, instrument, opts = {}) {
    const { maxModifierAbsolute = 25, requireMinConfidence = 0.50 } = opts;
    const payload = this.getModifier(instrument);

    if (payload.confidence < requireMinConfidence || payload.modifier === 0) {
      return { adjustedScore: baseScore, modifier: 0, wasApplied: false, narrative: '' };
    }

    // modifier is in -0.25 to +0.25 range → scale to same units as baseScore
    // biasScore in cotBiasEngine.js is -5 to +5; modifier is -0.25→+0.25 of that range
    // Scale: modifier * 5 / 0.25 = modifier * 20 → but capped at maxModifierAbsolute
    const rawModifier    = payload.modifier * 100; // treat as % of scale → adjust empirically
    const clampedModifier = Math.max(-maxModifierAbsolute, Math.min(maxModifierAbsolute, rawModifier));

    // Prevent sign inversion
    const finalModifier =
      (baseScore > 0 && clampedModifier < -baseScore) ? (-baseScore + 0.1) :
      (baseScore < 0 && clampedModifier > -baseScore)  ? (-baseScore - 0.1) :
      clampedModifier;

    return {
      adjustedScore: Math.round((baseScore + finalModifier) * 10) / 10,
      modifier:      Math.round(finalModifier * 10) / 10,
      wasApplied:    true,
      narrative:     payload.narrative,
    };
  }

  _getActiveSources() {
    const sources = [];
    if (signalBus.hasActiveSignal('RRC_UPDATE',  0.4)) sources.push('RRC_UPDATE');
    if (signalBus.hasActiveSignal('GTRP_UPDATE', 0.4)) sources.push('GTRP_UPDATE');
    if (signalBus.hasActiveSignal('FDS_ALERT',   0.5)) sources.push('FDS_ALERT');
    if (signalBus.hasActiveSignal('PUI_UPDATE',  0.4)) sources.push('PUI_UPDATE');
    return sources;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DIVERGENCE ENGINE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class DivergenceEngineAdapter {
  constructor() {
    this._unsubscribe = null;
    /** @type {Map<string, object>} id → DivergenceAlert */
    this._activeDivergences = new Map();
  }

  /**
   * @param {(alert: object) => void} onNewDivergence
   * @param {(id: string) => void} onDivergenceExpired
   */
  start(onNewDivergence, onDivergenceExpired) {
    this._unsubscribe = signalBus.subscribe(
      'DivergenceEngineAdapter',
      {
        types: ['MSC_UPDATE', 'GTRP_UPDATE', 'FDS_ALERT', 'RRC_UPDATE'],
        minConfidence: 0.45,
        minMagnitude:  'MEDIUM',
      },
      (signal) => {
        const alerts = this._generateAlerts(signal);
        alerts.forEach(alert => {
          this._activeDivergences.set(alert.id, alert);
          onNewDivergence(alert);
        });
      }
    );

    setInterval(() => {
      const now = Date.now();
      this._activeDivergences.forEach((alert, id) => {
        if (alert.expiresAt < now) {
          this._activeDivergences.delete(id);
          onDivergenceExpired(id);
        }
      });
    }, 5 * 60 * 1000);
  }

  stop() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  getActiveDivergences() {
    const MAGNITUDE_ORDER = ['NEGLIGIBLE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
    return Array.from(this._activeDivergences.values())
      .sort((a, b) => MAGNITUDE_ORDER.indexOf(b.magnitude) - MAGNITUDE_ORDER.indexOf(a.magnitude));
  }

  _generateAlerts(signal) {
    const alerts  = [];
    const metrics = polymarketService.getMetrics();

    // GTRP complacency (geopolitical risk high, but often diverges from VIX)
    if (signal.type === 'GTRP_UPDATE' && signal.value > 60) {
      if (!this._hasActiveAlert('GTRP_VIX_COMPLACENCY')) {
        alerts.push({
          id:               'GTRP_VIX_COMPLACENCY',
          name:             'Complacencia Geopolítica',
          description:      `Mercado de predicción valora riesgo geopolítico en ${signal.value.toFixed(0)}%. Verificar divergencia con VIX.`,
          magnitude:        signal.value > 70 ? 'HIGH' : 'MEDIUM',
          instruments:      ['SPX', 'NAS100', 'XAUUSD'],
          actionableInsight: 'Si VIX < 18: posible subestimación de riesgo por equities. Considerar reducción de exposición.',
          confidence:       signal.confidence,
          detectedAt:       Date.now(),
          expiresAt:        Date.now() + 48 * 60 * 60 * 1000,
          polymarketSources: signal.sources,
        });
      }
    }

    // FDS alert (Fed futures vs Polymarket divergence)
    if (signal.type === 'FDS_ALERT') {
      const fds = metrics.fds;
      if (fds?.isSignificant) {
        const div = fds.divergence ?? 0;
        alerts.push({
          id:               `FDS_ALERT_${fds.meetingDate}`,
          name:             'Divergencia Fed: Futuros vs Crowd',
          description:      `CME y Polymarket divergen ${(Math.abs(div) * 100).toFixed(0)}pp en P(cut) para ${fds.meetingDate}`,
          magnitude:        Math.abs(div) > 0.20 ? 'HIGH' : 'MEDIUM',
          instruments:      ['USD', 'US10Y', 'EUR'],
          actionableInsight: fds.implication,
          confidence:       { HIGH: 1, MEDIUM: 0.7, LOW: 0.4, INSUFFICIENT: 0 }[fds.confidence] ?? 0,
          detectedAt:       Date.now(),
          expiresAt:        Date.now() + 12 * 60 * 60 * 1000,
          polymarketSources: [],
        });
      }
    }

    // Recession risk vs equities complacency
    if (signal.type === 'RRC_UPDATE' && signal.value > 45 && signal.magnitude === 'HIGH') {
      if (!this._hasActiveAlert('RECESSION_EQUITY_LAG')) {
        alerts.push({
          id:               'RECESSION_EQUITY_LAG',
          name:             'Riesgo Recesión vs Equities',
          description:      `Probabilidad de recesión en ${signal.value.toFixed(0)}%. Verificar si equities ya lo descuentan.`,
          magnitude:        'MEDIUM',
          instruments:      ['SPX', 'NAS100'],
          actionableInsight: 'Si equities no han corregido: posible gap de valoración. Verificar earnings multiples actuales.',
          confidence:       signal.confidence,
          detectedAt:       Date.now(),
          expiresAt:        Date.now() + 72 * 60 * 60 * 1000,
          polymarketSources: signal.sources,
        });
      }
    }

    return alerts;
  }

  _hasActiveAlert(id) {
    const alert = this._activeDivergences.get(id);
    return alert != null && Date.now() < alert.expiresAt;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REGIME ENGINE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeEngineAdapter {
  constructor() {
    this._unsubscribe = null;
  }

  /** @param {(signal: object) => void} onTransitionSignal */
  start(onTransitionSignal) {
    this._unsubscribe = signalBus.subscribe(
      'RegimeEngineAdapter',
      {
        types:         ['MSC_UPDATE', 'RRC_UPDATE', 'GTRP_UPDATE'],
        minConfidence: 0.50,
        minMagnitude:  'MEDIUM',
      },
      () => {
        const transition = this._evaluateRegimeTransition();
        if (transition) onTransitionSignal(transition);
      }
    );
  }

  stop() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /**
   * Returns forward-looking regime context for Regime Detection Engine.
   * Called by marketRegimeEngine.js when computing regime.
   */
  getForwardLookingContext() {
    const { msc, rrc } = polymarketService.getMetrics();
    if (!msc || !rrc) {
      return { riskDirection: 'STABLE', mscLevel: 'UNKNOWN', rrcRegime: 'UNKNOWN',
               transitionProbability: 0, narrative: 'Polymarket data not yet available' };
    }

    const riskDirection =
      msc.riskCompressionExpansion > 10  ? 'EXPANDING'   :
      msc.riskCompressionExpansion < -10 ? 'COMPRESSING' : 'STABLE';

    const transitionProbability = Math.min(1,
      (msc.value / 100) * 0.6 +
      (Math.abs(msc.riskCompressionExpansion) / 30) * 0.4
    );

    const dirLabel = riskDirection === 'EXPANDING'   ? 'expandiéndose' :
                     riskDirection === 'COMPRESSING' ? 'comprimiéndose' : 'estable';

    return {
      riskDirection,
      mscLevel:              msc.regime,
      rrcRegime:             rrc.regime,
      transitionProbability: Math.round(transitionProbability * 100) / 100,
      narrative: `MSC ${msc.value} (${msc.regime}). RRC ${rrc.value}% (${rrc.regime}). Riesgo ${dirLabel}.`,
    };
  }

  _evaluateRegimeTransition() {
    const { rrc, msc, gtrp } = polymarketService.getMetrics();
    if (!rrc || !msc || !gtrp) return null;

    const CONF_TO_NUM = { HIGH: 1, MEDIUM: 0.7, LOW: 0.4, INSUFFICIENT: 0 };

    if (rrc.value > 40 && msc.riskCompressionExpansion > 15 && msc.value > 55) {
      return {
        direction:  'TOWARDS_RISK_OFF',
        confidence: Math.min(0.9,
          (CONF_TO_NUM[rrc.confidence] ?? 0) * (CONF_TO_NUM[gtrp.confidence] ?? 0)
        ),
        urgency:    msc.riskCompressionExpansion > 25 ? 'HIGH' : 'MEDIUM',
        description: `RRC ${rrc.value}%, MSC ${msc.value} expandiéndose. Señales adelantadas de deterioro macro.`,
        supporting: { rrc, msc, gtrp },
        generatedAt: Date.now(),
      };
    }

    if (rrc.value < 25 && msc.riskCompressionExpansion < -15 && msc.value < 30) {
      return {
        direction:  'TOWARDS_RISK_ON',
        confidence: 0.7,
        urgency:    'LOW',
        description: `Compresión de riesgo: RRC ${rrc.value}%, MSC ${msc.value} cayendo.`,
        supporting: { rrc, msc },
        generatedAt: Date.now(),
      };
    }

    if (gtrp.value > 0.65 && msc.value > 50) {
      return {
        direction:  'COMPLACENCY_WARNING',
        confidence: 0.75,
        urgency:    'HIGH',
        description: `GTRP ${(gtrp.value * 100).toFixed(0)}%. Riesgo de cola geopolítico no reflejado en precio.`,
        supporting: { gtrp, msc },
        generatedAt: Date.now(),
      };
    }

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVENT LAYER ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class EventLayerAdapter {
  constructor() {
    /** @type {Map<string, object & { _cachedAt: number }>} */
    this._contextCache = new Map();
    this._cacheTTL     = 15 * 60 * 1000;
  }

  /**
   * Get Polymarket context for a calendar event.
   * Returns contextualScoreModifier and narrative for event detail views.
   * @param {string} calendarEventId
   * @param {string} eventType - 'FOMC' | 'CPI' | 'NFP' | 'GDP' | 'PCE'
   */
  getEventContext(calendarEventId, eventType) {
    const cached = this._contextCache.get(calendarEventId);
    if (cached && Date.now() - cached._cachedAt < this._cacheTTL) return cached;

    const { pisi, cv, fds } = polymarketService.getEventContext(calendarEventId, eventType);

    let contextualScoreModifier = 0;
    let confidence              = 'INSUFFICIENT';
    let contextualNarrative     = '';
    let hasPolymarketData       = false;

    if (pisi) {
      hasPolymarketData = true;
      confidence        = pisi.confidence;

      const CONF_SCALE = { HIGH: 1.0, MEDIUM: 0.65, LOW: 0.35, INSUFFICIENT: 0 };
      const pisiMod  = (pisi.adjustedValue - 50) / 50 * 12;
      const cvBoost  = cv?.direction === 'ACCELERATING_UP'   ?  3 :
                       cv?.direction === 'ACCELERATING_DOWN' ? -3 : 0;
      contextualScoreModifier = Math.max(
        -15,
        Math.min(15, Math.round((pisiMod + cvBoost) * (CONF_SCALE[confidence] ?? 0)))
      );

      if (Math.abs(contextualScoreModifier) >= 5) {
        const dir = pisi.interpretation === 'EXPECTS_BEAT' ? 'positiva' : 'negativa';
        const mom = cv?.direction?.includes('ACCELERATING')
          ? ` (momentum ${cv.direction.includes('UP') ? '↑' : '↓'})`
          : '';
        contextualNarrative = `Crowd market: ${pisi.adjustedValue.toFixed(0)}% anticipa sorpresa ${dir}${mom} · OI $${(pisi.oiUSD / 1000).toFixed(0)}k`;
      }
    }

    const payload = {
      calendarEventId,
      pisi: pisi ?? null,
      cv:   cv   ?? null,
      fds:  fds  ?? null,
      contextualScoreModifier,
      contextualNarrative,
      confidence,
      hasPolymarketData,
      _cachedAt: Date.now(),
    };

    this._contextCache.set(calendarEventId, payload);
    return payload;
  }

  /**
   * Schedule pre-event monitoring (activates 48h before event).
   * @param {string} calendarEventId
   * @param {string} eventType
   * @param {number} eventTimestamp - Unix ms
   */
  activatePreEventMonitoring(calendarEventId, eventType, eventTimestamp) {
    const delay = Math.max(0, eventTimestamp - Date.now() - 48 * 60 * 60 * 1000);
    setTimeout(() => {
      polymarketService.activateEventPolling(calendarEventId, eventType);
    }, delay);
  }

  deactivatePostEvent(calendarEventId) {
    polymarketService.deactivateEventPolling(calendarEventId);
    this._contextCache.delete(calendarEventId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. NARRATIVE ENGINE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class NarrativeEngineAdapter {
  constructor() {
    this._unsubscribe = null;
    /** @type {Map<string, object>} id → NarrativeEntry */
    this._activeEntries = new Map();
  }

  /** @param {(entry: object) => void} onNewEntry */
  start(onNewEntry) {
    this._unsubscribe = signalBus.subscribe(
      'NarrativeEngineAdapter',
      {
        types: [
          'RRC_UPDATE', 'GTRP_UPDATE', 'FDS_ALERT', 'NTS_ALERT',
          'CV_ALERT', 'NEW_MARKET_DETECTED', 'REGIME_TRANSITION_SIGNAL',
        ],
        minConfidence: 0.45,
        minMagnitude:  'MEDIUM',
      },
      (signal) => {
        const entry = this._signalToNarrative(signal);
        if (entry) {
          this._activeEntries.set(entry.id, entry);
          onNewEntry(entry);
        }
      }
    );
  }

  stop() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /** @param {number} maxAge - ms, default 72h */
  getActiveEntries(maxAge = 72 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    return Array.from(this._activeEntries.values())
      .filter(e => e.generatedAt > cutoff && e.expiresAt > Date.now())
      .sort((a, b) => a.priority - b.priority || b.generatedAt - a.generatedAt)
      .slice(0, 5);
  }

  _signalToNarrative(signal) {
    if (signal.type === 'RRC_UPDATE') {
      const { rrc } = polymarketService.getMetrics();
      if (!rrc || Math.abs(rrc.delta7d ?? 0) < 5) return null;

      return {
        id:          crypto.randomUUID(),
        text:        rrc.delta7d > 0
          ? `Riesgo de recesión subió ${rrc.delta7d.toFixed(0)}pp en 7 días, alcanzando ${rrc.value}%. Deterioro de narrativa macro.`
          : `Riesgo de recesión bajó ${Math.abs(rrc.delta7d).toFixed(0)}pp en 7 días (${rrc.value}%). Compresión de riesgo en curso.`,
        priority:    rrc.value > 50 ? 1 : 2,
        category:    'RECESSION',
        signalType:  'RRC_UPDATE',
        generatedAt: Date.now(),
        expiresAt:   Date.now() + 24 * 60 * 60 * 1000,
        instruments: ['SPX', 'US10Y', 'USD'],
      };
    }

    if (signal.type === 'FDS_ALERT') {
      const { fds } = polymarketService.getMetrics();
      if (!fds?.isSignificant) return null;
      return {
        id:          crypto.randomUUID(),
        text:        fds.implication,
        priority:    1,
        category:    'FED_POLICY',
        signalType:  'FDS_ALERT',
        generatedAt: Date.now(),
        expiresAt:   Date.now() + 12 * 60 * 60 * 1000,
        instruments: ['USD', 'US10Y'],
      };
    }

    if (signal.type === 'NEW_MARKET_DETECTED') {
      return {
        id:          crypto.randomUUID(),
        text:        signal.narrative,
        priority:    2,
        category:    signal.category,
        signalType:  'NEW_MARKET_DETECTED',
        generatedAt: Date.now(),
        expiresAt:   Date.now() + 72 * 60 * 60 * 1000,
        instruments: [],
      };
    }

    if (signal.type === 'NTS_ALERT') {
      return {
        id:          crypto.randomUUID(),
        text:        signal.narrative,
        priority:    2,
        category:    signal.category,
        signalType:  'NTS_ALERT',
        generatedAt: Date.now(),
        expiresAt:   Date.now() + 12 * 60 * 60 * 1000,
        instruments: [],
      };
    }

    return null;
  }
}
