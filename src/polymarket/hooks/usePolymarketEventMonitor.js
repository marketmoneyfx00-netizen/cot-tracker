// =============================================================================
// POLYMARKET × COT TRACKER — PRE-EVENT MONITOR HOOK
// src/polymarket/hooks/usePolymarketEventMonitor.js
//
// Watches the calendar events array and auto-activates Polymarket event polling
// for upcoming high-impact US events that map to Polymarket markets.
//
// Usage: usePolymarketEventMonitor(events)  — one call in App.jsx, no props needed.
// =============================================================================

import { useEffect, useRef } from 'react';
import { polymarketService }     from '../PolymarketService.js';
import { CALENDAR_TO_POLYMARKET_MAP } from '../registry/registry-data.js';

// Events within this window get pre-event monitoring activated.
const LOOKAHEAD_MS  = 48 * 60 * 60 * 1000; // 48 hours ahead
const LOOKBACK_MS   =  1 * 60 * 60 * 1000; // 1 hour back (event may have just fired)

// Maps event title patterns → CALENDAR_TO_POLYMARKET_MAP keys.
const TYPE_MATCHERS = [
  { re: /fomc|federal reserve|rate decision|fed meeting/i, type: 'FOMC' },
  { re: /\bcpi\b|consumer price index|inflation rate/i,    type: 'CPI'  },
  { re: /non.?farm|nfp|payroll/i,                         type: 'NFP'  },
  { re: /\bgdp\b|gross domestic product/i,                type: 'GDP'  },
  { re: /\bpce\b|personal consumption expenditure/i,      type: 'PCE'  },
];

function detectEventType(title) {
  for (const { re, type } of TYPE_MATCHERS) {
    if (re.test(title || '')) return type;
  }
  return null;
}

// Returns a stable, unique ID for an event (used to track active pollings).
function eventKey(ev, type) {
  return `${ev.date}_${type}`;
}

export function usePolymarketEventMonitor(events) {
  // Track which (eventKey → eventType) pairs are currently being polled.
  const activeRef = useRef(new Map()); // key → eventType

  useEffect(() => {
    if (!events?.length) return;
    // Don't activate until service has at least resolved the registry.
    // isReady() requires a full batch — so we check initialization state
    // by attempting to poll; activateEventPolling is a no-op if service isn't ready.

    const now    = Date.now();
    const cutoff = now - LOOKBACK_MS;
    const ceiling = now + LOOKAHEAD_MS;

    const toKeep = new Map();

    for (const ev of events) {
      if (ev.impact !== 'High')   continue; // Only high-impact events
      if (ev.country !== 'US')    continue; // Polymarket markets are USD-centric

      const evMs = new Date(ev.date).getTime();
      if (isNaN(evMs) || evMs < cutoff || evMs > ceiling) continue;

      const type = detectEventType(ev.event);
      if (!type) continue;

      const relatedSlugs = CALENDAR_TO_POLYMARKET_MAP[type];
      if (!relatedSlugs?.length) continue;

      const key = eventKey(ev, type);
      toKeep.set(key, type);

      if (!activeRef.current.has(key)) {
        polymarketService.activateEventPolling(key, type);
        activeRef.current.set(key, type);
      }
    }

    // Deactivate events no longer in the window.
    for (const [key] of activeRef.current) {
      if (!toKeep.has(key)) {
        polymarketService.deactivateEventPolling(key);
        activeRef.current.delete(key);
      }
    }
  }, [events]);

  // Clean up all active pollings on component unmount.
  useEffect(() => {
    const tracked = activeRef.current; // capture ref value for cleanup
    return () => {
      for (const [key] of tracked) {
        polymarketService.deactivateEventPolling(key);
      }
      tracked.clear();
    };
  }, []);
}
