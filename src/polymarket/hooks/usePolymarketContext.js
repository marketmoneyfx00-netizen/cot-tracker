// =============================================================================
// POLYMARKET × COT TRACKER — REACT HOOKS
// src/polymarket/hooks/usePolymarketContext.js
//
// Three hooks for consuming Polymarket data in React components.
// All reads are from cache — never block render or trigger new fetches.
//
// Usage (Phase 2+ — when UI integration starts):
//   const { msc, rrc, gtrp, isLoaded } = usePolymarketContext();
//   const { modifier, wasApplied } = useBiasModifier('EUR/USD');
//   const { contextualScoreModifier, contextualNarrative } = useEventContext(id, 'FOMC');
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { polymarketService }           from '../PolymarketService.js';
import { signalBus }                   from '../signals/SignalBus.js';
import { BiasEngineAdapter }           from '../integrations/EngineAdapters.js';
import { EventLayerAdapter }           from '../integrations/EngineAdapters.js';

// ─────────────────────────────────────────────────────────────────────────────
// usePolymarketContext — composite metrics (RRC, GTRP, PUI, MSC)
// ─────────────────────────────────────────────────────────────────────────────

export function usePolymarketContext() {
  const [metrics, setMetrics] = useState({
    pui:    null,
    rrc:    null,
    gtrp:   null,
    msc:    null,
    fds:    null,
    isLoaded: false,
  });

  useEffect(() => {
    // Load initial state from service (may already have data)
    const update = () => {
      const m = polymarketService.getMetrics();
      setMetrics({
        pui:      m.pui,
        rrc:      m.rrc,
        gtrp:     m.gtrp,
        msc:      m.msc,
        fds:      m.fds,
        isLoaded: m.lastFullRecalculation > 0,
      });
    };

    update();

    // Subscribe to composite signal updates
    const unsub = signalBus.subscribe(
      'usePolymarketContext',
      { types: ['RRC_UPDATE', 'GTRP_UPDATE', 'MSC_UPDATE', 'PUI_UPDATE', 'FDS_ALERT'] },
      () => update(),
      { replayRecent: false }
    );

    return () => unsub();
  }, []);

  return metrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// useBiasModifier — Polymarket modifier for a specific instrument
// ─────────────────────────────────────────────────────────────────────────────

export function useBiasModifier(instrument) {
  const adapterRef = useRef(null);
  const [result, setResult] = useState({
    modifier:      0,
    confidence:    0,
    wasApplied:    false,
    narrative:     '',
    isAvailable:   false,
  });

  useEffect(() => {
    adapterRef.current = new BiasEngineAdapter();
    adapterRef.current.start();

    const update = () => {
      if (!polymarketService.isReady()) return;
      const payload = adapterRef.current.getModifier(instrument);
      setResult({
        modifier:    payload.modifier,
        confidence:  payload.confidence,
        wasApplied:  payload.modifier !== 0 && payload.confidence >= 0.5,
        narrative:   payload.narrative,
        isAvailable: true,
      });
    };

    update();

    const unsub = signalBus.subscribe(
      `useBiasModifier:${instrument}`,
      { types: ['RRC_UPDATE', 'GTRP_UPDATE', 'MSC_UPDATE'] },
      () => update()
    );

    return () => {
      adapterRef.current?.stop();
      unsub();
    };
  }, [instrument]);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// useEventContext — pre-event Polymarket context
// ─────────────────────────────────────────────────────────────────────────────

export function useEventContext(calendarEventId, eventType) {
  const adapterRef = useRef(new EventLayerAdapter());
  const [ctx, setCtx] = useState({
    pisi:                   null,
    cv:                     null,
    fds:                    null,
    contextualScoreModifier: 0,
    contextualNarrative:    '',
    confidence:             'INSUFFICIENT',
    hasPolymarketData:      false,
  });

  useEffect(() => {
    if (!calendarEventId || !eventType) return;

    const update = () => {
      const payload = adapterRef.current.getEventContext(calendarEventId, eventType);
      setCtx({
        pisi:                    payload.pisi,
        cv:                      payload.cv,
        fds:                     payload.fds,
        contextualScoreModifier: payload.contextualScoreModifier,
        contextualNarrative:     payload.contextualNarrative,
        confidence:              payload.confidence,
        hasPolymarketData:       payload.hasPolymarketData,
      });
    };

    update();

    const unsub = signalBus.subscribe(
      `useEventContext:${calendarEventId}`,
      { types: ['PISI_UPDATE', 'FDS_ALERT'] },
      () => update()
    );

    return () => unsub();
  }, [calendarEventId, eventType]);

  return ctx;
}
