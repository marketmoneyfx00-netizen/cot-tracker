/**
 * intradayExecutionEngine.js — Intraday Execution Layer
 *
 * Fuses HTF institutional bias with intraday macro context to produce
 * an Execution Permission score (0–100).
 *
 * ⚠️ This module does NOT generate buy/sell signals.
 *    It is a contextual filter and directional permission layer only.
 *
 * Weights:
 *   HTF Bias            40%
 *   Macro Event Risk    20%   ← improved: time-aware + bias-aligned bonus
 *   Fear / Greed        15%
 *   Volatility          15%
 *   Calendar Sentiment  10%
 */

// ─── UTILS ────────────────────────────────────────────────────────────────────

/**
 * Returns minutes elapsed since an event date string.
 * Positive = event is in the past. Negative = event is in the future.
 */
function minutesSinceEvent(eventDateStr) {
  if (!eventDateStr) return null;
  const eventMs = new Date(eventDateStr).getTime();
  if (isNaN(eventMs)) return null;
  return (Date.now() - eventMs) / 60000;
}

/**
 * Checks if a past event's surprise direction is aligned with the HTF bias.
 *
 * biasDirection: "bullish" | "bearish" | "neutral"
 * surpriseDir:   +1 (beat), -1 (miss), 0 (in-line)
 *
 * Alignment logic (conservative — works for USD-correlated instruments):
 *   bullish bias + USD miss  (-1) → aligned (weak USD = bullish for risk/XAUUSD/NAS100)
 *   bullish bias + USD beat  (+1) → aligned (strong macro = bullish)
 *   bearish bias + USD beat  (+1) → aligned (strong USD = bearish for EUR/GBP shorts)
 *   bearish bias + USD miss  (-1) → aligned (weak macro = bearish continuation)
 */
function isBiasAlignedSurprise(biasDirection, surpriseDir) {
  if (!biasDirection || surpriseDir === 0 || surpriseDir == null) return false;
  if (biasDirection === 'bullish' && surpriseDir === -1) return true;
  if (biasDirection === 'bullish' && surpriseDir === +1) return true;
  if (biasDirection === 'bearish' && surpriseDir === +1) return true;
  if (biasDirection === 'bearish' && surpriseDir === -1) return true;
  return false;
}

// ─── FACTOR 1 — HTF BIAS (40 pts max) ────────────────────────────────────────
// Strong bias in either direction = high confidence. Neutral = low confidence.
function scoreHTFBias(biasScore) {
  if (typeof biasScore !== 'number' || isNaN(biasScore)) return 0;
  return Math.round((Math.abs(biasScore) / 5) * 40);
}

// ─── FACTOR 2 — MACRO EVENT RISK (20 pts max) ─────────────────────────────────
// Time-aware and bias-alignment-aware macro risk scoring.
//
// Priority rules:
//   a) High-impact event within next 90 min    → strong penalty (floor at 5)
//   b) High-impact event in last 0–120 min     → residual vol penalty (floor at 10)
//      └─ if past event is aligned with bias   → +4 bonus (awarded once)
//   c) High-impact event 120–240 min ago       → mild lingering effect (floor at 15)
//   d) No events array                         → fallback to legacy riskScore count
function scoreMacroRisk(events, biasDirection, riskScore) {
  // Fallback: no events array provided
  if (!Array.isArray(events) || events.length === 0) {
    if (typeof riskScore !== 'number' || isNaN(riskScore)) return 20;
    if (riskScore === 0)  return 20;
    if (riskScore < 10)   return 16;
    if (riskScore < 30)   return 10;
    if (riskScore < 50)   return 5;
    return 2;
  }

  let base        = 20;
  let bonusEarned = false;

  for (const ev of events) {
    if (ev?.impact !== 'High') continue;

    const minsAgo = minutesSinceEvent(ev.date);
    if (minsAgo === null) continue;

    // a) Upcoming within 90 min → near-freeze
    if (minsAgo <= 0 && minsAgo >= -90) {
      base = Math.min(base, 5);
      continue;
    }

    // b) Occurred within last 120 min → residual volatility
    if (minsAgo > 0 && minsAgo <= 120) {
      base = Math.min(base, 10);

      // Check for bias-aligned bonus (awarded once per call)
      if (!bonusEarned) {
        const actual   = ev.actual   ?? ev.result ?? ev.value ?? null;
        const forecast = ev.estimate ?? ev.forecast ?? null;
        if (actual !== null && forecast !== null) {
          const a = parseFloat(String(actual).replace(/[%KMB,]/g, ''));
          const f = parseFloat(String(forecast).replace(/[%KMB,]/g, ''));
          if (!isNaN(a) && !isNaN(f)) {
            const surpriseDir = a > f ? 1 : a < f ? -1 : 0;
            if (isBiasAlignedSurprise(biasDirection, surpriseDir)) {
              base        = Math.min(20, base + 4);
              bonusEarned = true;
            }
          }
        }
      }
      continue;
    }

    // c) 120–240 min ago → mild lingering effect
    if (minsAgo > 120 && minsAgo <= 240) {
      base = Math.min(base, 15);
    }
    // Events > 4h old: market has absorbed them, no penalty
  }

  return Math.max(0, Math.min(20, base));
}

// ─── FACTOR 3 — FEAR / GREED (15 pts max) ────────────────────────────────────
function scoreFearGreed(fg) {
  if (typeof fg !== 'number' || isNaN(fg)) return 8;
  const dist = Math.abs(fg - 50);
  if (dist <= 10) return 15;
  if (dist <= 20) return 12;
  if (dist <= 30) return 8;
  if (dist <= 40) return 4;
  return 2;
}

// ─── FACTOR 4 — VOLATILITY (15 pts max) ──────────────────────────────────────
function scoreVolatility(vix) {
  const v = parseFloat(vix);
  if (isNaN(v)) return 8;
  if (v >= 15 && v < 25) return 15;
  if (v >= 25 && v < 30) return 10;
  if (v < 15)            return 7;
  if (v >= 30 && v < 35) return 5;
  return 2;
}

// ─── FACTOR 5 — CALENDAR SENTIMENT (10 pts max) ──────────────────────────────
function scoreCalendarSentiment(highCount, midCount) {
  const h = typeof highCount === 'number' ? highCount : 0;
  const m = typeof midCount  === 'number' ? midCount  : 0;
  if (h === 0 && m === 0) return 10;
  if (h === 0 && m <= 2)  return 8;
  if (h === 1 && m <= 2)  return 6;
  if (h === 2)             return 4;
  return 2;
}

// ─── LABELS (unchanged) ───────────────────────────────────────────────────────
export function getPermissionLevel(score) {
  if (score >= 70) return { label: 'HIGH',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.3)' };
  if (score >= 45) return { label: 'MEDIUM', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',   border: 'rgba(245,158,11,0.3)' };
  return                  { label: 'LOW',    color: '#ef4444', bg: 'rgba(239,68,68,0.10)',    border: 'rgba(239,68,68,0.25)' };
}

export function getMacroRiskLabel(riskScore) {
  if (typeof riskScore !== 'number') return { label: 'Unknown', color: '#94a3b8' };
  if (riskScore < 10)  return { label: 'Low',      color: '#22c55e' };
  if (riskScore < 30)  return { label: 'Moderate', color: '#f59e0b' };
  return                      { label: 'High',     color: '#ef4444' };
}

export function getVolatilityState(vix) {
  const v = parseFloat(vix);
  if (isNaN(v))  return { label: 'Unknown',     color: '#94a3b8' };
  if (v < 15)    return { label: 'Compression', color: '#94a3b8' };
  if (v < 25)    return { label: 'Normal',      color: '#22c55e' };
  if (v < 30)    return { label: 'Elevated',    color: '#f59e0b' };
  return                { label: 'Expansion',   color: '#ef4444' };
}

export function getBiasAlignment(biasDirection) {
  if (biasDirection === 'bullish') return { label: 'Bullish', color: '#22c55e' };
  if (biasDirection === 'bearish') return { label: 'Bearish', color: '#ef4444' };
  return                                  { label: 'Neutral', color: '#94a3b8' };
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
/**
 * calculateExecutionScore
 *
 * @param {Object}        params
 * @param {number}        params.biasScore       - from cotBiasEngine: -5 to +5
 * @param {string}        params.biasDirection   - "bullish" | "bearish" | "neutral"
 * @param {number}        params.riskScore       - legacy fallback from calcRisk
 * @param {Array|null}    params.events          - calendar events array (enables time-aware logic)
 * @param {number}        params.fg              - fear/greed 0–100
 * @param {number|string} params.vix             - volatility estimate
 * @param {number}        params.highCount       - high-impact events count today
 * @param {number}        params.midCount        - medium-impact events count today
 *
 * @returns {Object} — same shape as before: { score, permission, biasAlignment,
 *                     macroRisk, volatilityState, breakdown }
 */
export function calculateExecutionScore(params = {}) {
  if (!params) params = {};

  const {
    biasScore     = 0,
    biasDirection = 'neutral',
    riskScore     = 0,
    events        = null,
    fg            = 50,
    vix           = 18,
    highCount     = 0,
    midCount      = 0,
  } = params;

  const htfBiasPoints    = scoreHTFBias(biasScore);
  const macroRiskPoints  = scoreMacroRisk(events, biasDirection, riskScore);
  const fearGreedPoints  = scoreFearGreed(fg);
  const volatilityPoints = scoreVolatility(vix);
  const calSentPoints    = scoreCalendarSentiment(highCount, midCount);

  const rawTotal = htfBiasPoints + macroRiskPoints + fearGreedPoints + volatilityPoints + calSentPoints;
  const score    = Math.max(0, Math.min(100, rawTotal));

  return {
    score,
    permission:      getPermissionLevel(score),
    biasAlignment:   getBiasAlignment(biasDirection),
    macroRisk:       getMacroRiskLabel(riskScore),
    volatilityState: getVolatilityState(vix),
    breakdown: {
      htfBias:       { points: htfBiasPoints,     weight: '40%', max: 40 },
      macroRisk:     { points: macroRiskPoints,    weight: '20%', max: 20 },
      fearGreed:     { points: fearGreedPoints,    weight: '15%', max: 15 },
      volatility:    { points: volatilityPoints,   weight: '15%', max: 15 },
      calSentiment:  { points: calSentPoints,      weight: '10%', max: 10 },
    },
  };
}
