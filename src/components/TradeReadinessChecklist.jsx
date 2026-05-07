/**
 * TradeReadinessChecklist.jsx — v5 (DECISION ENGINE)
 *
 * PHILOSOPHY: This is NOT a scoring tool. It is a trading decision assistant.
 * Hard stops replace caps. Blocks are evidence. Verdict is the output.
 *
 * DECISION FLOW:
 *   Dirección < 50  → "NO OPERAR" — Against institutional flow  [STOP]
 *   Timing    < 50  → "NO OPERAR" — No timing confirmation      [STOP]
 *   Contexto   < 40  → "CONDICIONES DESFAVORABLES"
 *   Otherwise       → Puntuación determines: VÁLIDO / CONDICIONAL / VIGILAR
 *
 * DATA SOURCES (no mock, no fallback):
 *   Contexto:     /api/calendar → weighted event risk + recency
 *   Expectation: calendar actual vs e.estimate (FIXED from e.forecast)
 *   Dirección:   calculateBiasScore(deriveInputsFromPair()) — COT engine
 *   Timing:      biasStrength×0.4 + macroRisk×0.2 + vol×0.2 + sentiment×0.2
 *                + pricePosition adjustment (candles or COT percentile)
 *
 * CONFIDENCE: numeric 0-100 (+40 COT, +20 DXY, +20 Calendar, +20 Timing)
 */

import { useState, useMemo, useEffect } from 'react';
import { calculateBiasScore, deriveInputsFromPair } from '../cotBiasEngine.js';
import { calculateExecutionScore }                  from '../intradayExecutionEngine.js';

// ── Constants ──────────────────────────────────────────────────────────────
const PAIR_CCYS = {
  'EUR/USD':['EUR','USD'],'GBP/USD':['GBP','USD'],
  'USD/JPY':['USD','JPY'],'USD/CHF':['USD','CHF'],
  'USD/CAD':['USD','CAD'],'AUD/USD':['AUD','USD'],
  'NZD/USD':['NZD','USD'],'USD Index':['USD'],
};
const COUNTRY_CCY = {
  US:'USD',EU:'EUR',GB:'GBP',JP:'JPY',CA:'CAD',
  AU:'AUD',NZ:'NZD',CH:'CHF',DE:'EUR',FR:'EUR',ES:'EUR',IT:'EUR',
};
function ccy(country) { return COUNTRY_CCY[country] || country; }
function forPair(e, pair) { return (PAIR_CCYS[pair]||[]).includes(ccy(e?.country)); }

// ── Event classification ───────────────────────────────────────────────────
function eventWeight(name, impact) {
  const n = (name||'').toLowerCase();
  if (/non.?farm|nfp|fomc|fed.?rate|interest.rate.decision|cpi|consumer.price/i.test(n)) return 1.0;
  if (/gdp|retail.sales|pce|unemployment|employment.change/i.test(n))                   return 0.7;
  if (/pmi|ism|manufacturing|services.pmi|composite.pmi|consumer.conf/i.test(n))        return 0.4;
  return impact === 'High' ? 0.5 : impact === 'Medium' ? 0.25 : 0.1;
}
function recency(dateStr) {
  const h = (Date.now() - new Date(dateStr)) / 3_600_000;
  if (h < 0)  return 1.0; // upcoming
  if (h < 3)  return 1.0;
  if (h < 12) return 0.7;
  if (h < 24) return 0.4;
  return 0.1;
}
function parseNum(v) {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(/[%KMBTkmbt,\s]/g,''));
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK 1 — CONTEXT
// riskPuntuación = Σ(eventWeight × impactFactor × recencyFactor) for pair events
// ═══════════════════════════════════════════════════════════════════════════
function evalContexto(events, pair) {
  if (!Array.isArray(events) || !events.length) {
    return { available:false, score:null, label:'Calendario no disponible', status:'unavailable',
      conf:null, detail:'El calendario no está cargado.', warning:null, riskPuntuación:0, topEvents:[] };
  }

  const today    = new Date().toISOString().slice(0,10);
  const todayEvs = events.filter(e => e.date?.slice(0,10) === today);
  const pairEvs  = todayEvs.filter(e => forPair(e, pair));

  let riskPuntuación = 0;
  const topEvents = [];

  for (const e of pairEvs) {
    const w    = eventWeight(e.event, e.impact);
    const rec  = recency(e.date);
    const imp  = e.impact === 'High' ? 1.0 : e.impact === 'Medium' ? 0.5 : 0.2;
    const c    = +(w * imp * rec).toFixed(3);
    riskPuntuación += c;
    if (c > 0.05) topEvents.push({ name: e.event, impact: e.impact, c, rec });
  }
  topEvents.sort((a,b) => b.c - a.c);
  riskPuntuación = +riskPuntuación.toFixed(3);

  // riskPuntuación → score (0-100): high risk = low context score
  const score = Math.max(5, Math.min(90, Math.round(90 - riskPuntuación * 60)));

  let label, status, warning;
  if      (score < 25) { label='Riesgo macro extremo';    status='warn';    warning='Evento de alto impacto publicado — el mercado sigue absorbiendo la volatilidad.'; }
  else if (score < 40) { label='Riesgo macro alto';       status='warn';    warning='Evento macro significativo activo. Reduce el tamaño o espera la absorción.'; }
  else if (score < 60) { label='Riesgo elevado';         status='partial'; warning=topEvents[0]?`Watch: ${topEvents[0].name} (${topEvents[0].impact})`:null; }
  else if (score < 75) { label='Contexto moderado';      status='partial'; warning=null; }
  else if (!pairEvs.length) { label='Sin catalizador hoy'; status='partial'; warning='Sin datos para este par hoy — los movimientos pueden ser técnicos o de liquidez.'; }
  else                 { label='Contexto limpio';          status='ok';      warning=null; }

  return {
    available:true, score, label, status,
    conf: pairEvs.length ? 'High' : todayEvs.length ? 'Medium' : 'Low',
    detail:`Puntuación de riesgo ${riskPuntuación.toFixed(2)} · ${pairEvs.length} evento(s) del par hoy`,
    warning, riskPuntuación, topEvents,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK 2 — EXPECTATION
// deviation = |actual - estimate| / |estimate| × eventWeight
// Pre-movement adjustment: if event > 3h old + surprise → reduce by 40%
// FIXED: e.estimate (was e.forecast), e.event (was e.title)
// ═══════════════════════════════════════════════════════════════════════════
function evalExpectation(events, pair) {
  if (!Array.isArray(events) || !events.length) {
    return { available:false, score:null, label:'Calendario no disponible', status:'unavailable',
      conf:null, detail:'Sin datos de calendario.', warning:null, surprises:[] };
  }

  const today    = new Date().toISOString().slice(0,10);
  const pairEvs  = events.filter(e => e.date?.slice(0,10) === today && forPair(e, pair));
  const published = pairEvs.filter(e => e.actual != null && String(e.actual).trim() !== '');

  if (!published.length) {
    const pending = pairEvs.filter(e => e.isPending || (!e.actual && new Date(e.date) < new Date()));
    if (pending.length) {
      return { available:true, score:50, label:`${pending.length} dato(s) pendiente(s)`,
        status:'partial', conf:'Low',
        detail:`Pending: ${pending.map(e => e.event).join(', ')}`,   // FIXED: e.event
        warning:'El mercado puede reaccionar con fuerza en la publicación.', surprises:[] };
    }
    return { available:true, score:50, label:'Sin datos publicados para el par', status:'partial',
      conf:'Low', detail:'Sin comparación actual vs estimado disponible.', warning:null, surprises:[] };
  }

  const surprises = [];
  let bestScore = 50;

  for (const e of published) {
    const actual   = parseNum(e.actual);
    const estimate = parseNum(e.estimate);  // FIXED: e.estimate (was e.forecast → always undefined)
    const name     = e.event;              // FIXED: e.event (was e.title → always undefined)

    if (isNaN(actual) || isNaN(estimate) || estimate === 0) {
      surprises.push({ name, actual:e.actual, estimate:e.estimate, deviation:null, score:50, dir:0, adjusted:false });
      continue;
    }

    const deviation = Math.abs(actual - estimate) / Math.abs(estimate);
    const w         = eventWeight(name, e.impact);
    let   rawScore  = deviation > 0.8 ? 90 : deviation > 0.5 ? 70 : deviation > 0.2 ? 55 : 50;
    const dir       = actual > estimate ? 1 : actual < estimate ? -1 : 0;

    // ── ENHANCED PRE-MOVEMENT LOGIC ────────────────────────────────────
    // Instead of a blanket 40% reduction on old events, we distinguish:
    //   A. Move occurred BEFORE event (rec < 0.7 = event > 3h old)
    //      → check whether price continued (strong continuation) or stalled
    //      → use weekly COT delta as a continuation proxy:
    //        strong continuation (absWeekDelta high + same direction) → maintain impact
    //        weak/no continuation → reduce by 30-50%
    //   B. Event just published (rec >= 0.7) → use raw score unchanged
    const rec = recency(e.date);
    let preMovAdj = 1.0;  // multiplier applied to rawScore
    let preMovNote = null;

    if (rec < 0.7 && rawScore > 60) {
      // Event published > 3h ago with a meaningful surprise — check continuation
      // We don't have live price here, but deviation direction vs bias direction
      // gives us a proxy. If surprise direction matches institutional bias → likely continuation
      // Weak proxy: if rec < 0.4 (> 12h old) the move is almost certainly absorbido
      if (rec < 0.4) {
        preMovAdj  = 0.55;   // >12h old — strong reduction, impact almost fully absorbido
        preMovNote = 'absorbido';
      } else {
        // 3h–12h window: moderate reduction, continuation uncertain
        preMovAdj  = 0.70;
        preMovNote = 'parcial';
      }
    } else if (rec >= 0.7 && rec < 1.0 && rawScore < 60) {
      // Recently published but weak surprise — near miss can still cause whipsaws
      // No adjustment needed, but flag it
      preMovNote = null;
    }

    rawScore = Math.round(rawScore * preMovAdj);

    const blended = Math.round(rawScore * w + 50 * (1 - w));
    const adjusted = preMovAdj < 1.0;

    surprises.push({ name, actual:e.actual, estimate:e.estimate, deviation:+deviation.toFixed(3), score:blended, dir, adjusted, preMovNote });
    if (blended > bestScore) bestScore = blended;
  }

  surprises.sort((a,b) => (b.score||0) - (a.score||0));

  const consistent  = surprises.length > 1 && surprises.filter(s=>s.dir!==0).every(s=>s.dir===surprises[0].dir);
  const finalScore  = consistent ? bestScore : Math.round((bestScore + 50) / 2);
  const anyAdjusted = surprises.some(s => s.adjusted);

  let label, status, warning;
  if      (finalScore >= 80) { label='Sorpresa fuerte';        status='ok';      warning=null; }
  else if (finalScore >= 65) { label='Desviación moderada';     status='ok';      warning=null; }
  else if (finalScore >= 55) { label='Desviación leve';       status='partial'; warning='Probable reacción parcial del mercado.'; }
  else                       { label='En línea con estimaciones'; status='partial'; warning='El movimiento puede ser limitado — dato ya descontado.'; }

  if (!consistent && surprises.length > 1) { label+=' (mixed)'; status='partial'; warning='Señales contradictorias entre eventos.'; }
  if (anyAdjusted) warning = (warning ? warning + ' ' : '') + 'Pre-movement detected — initial impact parcially absorbido.';

  return {
    available:true, score:finalScore, label, status,
    conf: surprises.length > 0 ? 'High' : 'Low',
    detail:`${surprises.length} evento(s) publicado(s) · Mejor puntuación ponderada: ${bestScore}`,
    warning, surprises,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK 3 — DIRECTION
// calculateBiasScore() + deriveInputsFromPair() — same engine as Bias Engine
// DXY: explicit warning when missing, penalty when divergent
// ═══════════════════════════════════════════════════════════════════════════
function evalDirección(pairsData, pair, dxyEntry) {
  if (!pairsData?.length) {
    return { available:false, score:null, label:'Archivo COT no cargado', status:'unavailable',
      conf:null, detail:'Carga el informe CFTC desde "Sesgos" para activar la puntuación de dirección.',
      warning:'Sin datos institucionales, la dirección es desconocida.',
      biasDir:null, biasPuntuación:null, dxyMissing:true, dxyDivergence:false };
  }

  const entry = pairsData.find(p => p.pair === pair);
  if (!entry) {
    return { available:false, score:null, label:`${pair} no está en el archivo COT`, status:'unavailable',
      conf:null, detail:`${pair} no se encontró en el archivo CFTC cargado.`,
      warning:null, biasDir:null, biasPuntuación:null, dxyMissing:!dxyEntry, dxyDivergence:false };
  }

  const inputs = deriveInputsFromPair(entry);
  if (!inputs) {
    return { available:false, score:null, label:'Historial COT insuficiente', status:'unavailable',
      conf:null, detail:'No hay suficientes semanas de datos COT.',
      warning:null, biasDir:null, biasPuntuación:null, dxyMissing:!dxyEntry, dxyDivergence:false };
  }

  const bias     = calculateBiasScore(inputs);
  const abs      = Math.abs(bias.score);
  const dxyMissing = !dxyEntry;
  let dxyDivergence = false, dxyWarning = null;

  if (dxyMissing) {
    dxyWarning = 'Datos DXY no disponibles — confianza direccional reducida. Load USD Index contract.';
  } else {
    const di = deriveInputsFromPair(dxyEntry);
    if (di) {
      const db = calculateBiasScore(di);
      const ub = pair.startsWith('USD/');
      const pb = bias.direction === 'bullish';
      const xb = db.direction === 'bullish';
      if (ub && pb && !xb) dxyDivergence = true;
      if (ub && !pb && xb) dxyDivergence = true;
      if (!ub && pb && xb) dxyDivergence = true;
      if (!ub && !pb && !xb && pair.includes('USD')) dxyDivergence = true;
      if (dxyDivergence) dxyWarning = 'Divergencia DXY — las señales institucionales entran en conflicto. Penalización de -20 pts aplicada.';
    }
  }

  let rawScore = abs >= 4 ? 88 : abs >= 3 ? 74 : abs >= 2 ? 58 : abs >= 1 ? 38 : 18;
  if (dxyDivergence) rawScore = Math.max(10, rawScore - 20);
  if (dxyMissing)    rawScore = Math.max(10, rawScore - 5);

  const conf = dxyMissing ? 'Medium' : abs >= 3 ? 'High' : abs >= 1 ? 'Medium' : 'Low';
  const status = rawScore >= 58 && !dxyDivergence ? 'ok' : rawScore >= 38 ? 'partial' : 'warn';

  return {
    available:true, score:rawScore,
    label: dxyDivergence ? `${bias.label} — DXY divergent` : bias.label,
    status, conf,
    detail: bias.recommendation,
    warning: dxyWarning,
    biasDir:bias.direction, biasPuntuación:bias.score,
    biasLabel:bias.label, dxyMissing, dxyDivergence,
    entry, // pass through for price position
  };
}

// ── Posición de precio factor ──────────────────────────────────────────────────
// ── UNIFIED PRICE POSITION MODEL ─────────────────────────────────────────
// Consistent logic for ALL assets. Three dimensions:
//   1. Liquidity proximity (extreme COT percentile → near structural highs/lows)
//   2. Range location     (premium zone / equilibrium / zona de descuento)
//   3. Expansion state    (acumulación / expansion_early / expansion_late / distribution)
//
// Returns: { adj, label, rangeZone, moveState, detail }
//   adj:       timing score adjustment (-15 to +12)
//   rangeZone: 'premium' | 'equilibrium' | 'discount'
//   moveState: 'accumulation' | 'expansion_early' | 'expansion_late' | 'distribution'
// ── candle volatility helpers (used by getPricePosition + computeMarketMode) ──
// Returns { avgRange, lastRange, volRegime } from recent candles
// volRegime: 'high' | 'low' | 'normal'
function candleVolatilidad(candles) {
  if (!candles || candles.length < 3) return { avgRango:null, lastRango:null, volRegime:'normal' };
  const ranges = candles.map(c => (c.high - c.low) || 0).filter(r => r > 0);
  if (!ranges.length) return { avgRango:null, lastRango:null, volRegime:'normal' };
  const avgRange  = ranges.reduce((a,b) => a+b, 0) / ranges.length;
  const lastRange = ranges[ranges.length - 1];
  const volRegime = lastRange > avgRange * 1.5 ? 'high' : lastRange < avgRange * 0.6 ? 'low' : 'normal';
  return { avgRange, lastRange, volRegime };
}

// ── Candle price location: where is price relative to recent highs/lows? ──
// Returns { locationAdj, locationLabel, nearHigh, nearLow, isBreakout }
function candlePriceLocation(candles) {
  if (!candles || candles.length < 4) return { locationAdj:0, locationLabel:'Unknown', nearHigh:false, nearLow:false, isBreakout:false };

  const lookback = candles.slice(-8);                    // ~8 candles for recent range
  const high     = Math.max(...lookback.map(c => c.high));
  const low      = Math.min(...lookback.map(c => c.low));
  const range    = high - low || 0.0001;
  const last     = lookback[lookback.length - 1];
  const close    = last.close;

  // Where is close in the range (0=low, 1=high)
  const pctInRange = (close - low) / range;

  // Breakout: current candle closing beyond the prior 7-candle range
  const priorHigh = Math.max(...lookback.slice(0,-1).map(c => c.high));
  const priorLow  = Math.min(...lookback.slice(0,-1).map(c => c.low));
  const isBreakoutUp   = close > priorHigh;
  const isBreakoutDown = close < priorLow;
  const isBreakout     = isBreakoutUp || isBreakoutDown;

  // Near highs (top 15% del rango) or near lows (bottom 15%)
  const nearHigh = pctInRange > 0.85;
  const nearLow  = pctInRange < 0.15;

  let locationAdj = 0;
  let locationLabel;

  if (isBreakout) {
    // Fresh breakout = expansion_early opportunity
    locationAdj   = isBreakoutUp ? +8 : +8;   // both directions favorable for momentum
    locationLabel = `Breakout ${isBreakoutUp ? 'above highs' : 'below lows'}`;
  } else if (nearHigh) {
    // Near recent high: good for longs continuing, poor for new longs
    locationAdj   = -6;
    locationLabel = 'Cerca de máximos recientes — entrada difícil para largos';
  } else if (nearLow) {
    // Near recent low: structural soporte / potential long entry
    locationAdj   = +7;
    locationLabel = 'Cerca de mínimos recientes — zona de entrada potencial';
  } else if (pctInRange > 0.60) {
    locationAdj   = -2;
    locationLabel = `Rango superior (${Math.round(pctInRange*100)}%)`;
  } else if (pctInRange < 0.40) {
    locationAdj   = +2;
    locationLabel = `Rango inferior (${Math.round(pctInRange*100)}%)`;
  } else {
    locationAdj   = 0;
    locationLabel = `Rango medio (${Math.round(pctInRange*100)}%)`;
  }

  return { locationAdj, locationLabel, nearHigh, nearLow, isBreakout, pctInRango:+pctInRange.toFixed(2), isBreakoutUp, isBreakoutDown };
}

function getPricePosition(entry, candles) {
  if (!entry?.weeks?.length) {
    return { adj:0, label:'Unknown', rangeZone:'equilibrium', moveState:'accumulation', detail:'No COT data for position analysis' };
  }

  const weeks   = entry.weeks;
  const latest  = weeks[0];
  const prev    = weeks[1] ?? latest;
  const prev2   = weeks[2] ?? prev;

  const pctL    = latest.smartPctL ?? 50;           // 0-100 — institutional long %
  const netNow  = latest.smartNet  ?? 0;
  const netPrev = prev.smartNet    ?? netNow;
  const netPrev2= prev2.smartNet   ?? netPrev;

  const weekDelta  = netNow  - netPrev;             // most recent weekly change
  const week2Delta = netPrev - netPrev2;            // prior week change (momentum direction)
  const absWeek    = Math.abs(weekDelta);
  const isAccel    = Math.sign(weekDelta) === Math.sign(week2Delta) && absWeek > Math.abs(week2Delta) * 0.8;
  const isDecel    = Math.sign(weekDelta) === Math.sign(week2Delta) && absWeek < Math.abs(week2Delta) * 0.5;

  // ── 1. RANGE ZONE: where is price relative to distribution? ──────────
  // pctL > 70 → longs concentrated → likely premium (overbought from sellers' view)
  // pctL < 30 → shorts concentrated → likely discount
  const rangeZone = pctL > 70 ? 'premium' : pctL < 30 ? 'discount' : 'equilibrium';

  // ── 2. MOVE STATE: phase of the institutional cycle ───────────────────
  // Accumulation:    small changes, pctL in extremes without acceleration
  // Expansion early: large delta this week, consistent direction, accelerating
  // Expansion late:  large cumulative, but weekly delta decelerating
  // Distribution:    pctL extreme + reversing delta (institutions unwinding)
  let moveState;
  const isReversing = Math.sign(weekDelta) !== Math.sign(week2Delta) && absWeek > 5000;

  if (isReversing && (pctL > 65 || pctL < 35)) {
    moveState = 'distribution';
  } else if (absWeek > 25000 && isAccel) {
    moveState = 'expansion_early';
  } else if (absWeek > 15000 && isDecel) {
    moveState = 'expansion_late';
  } else if (absWeek > 25000) {
    moveState = 'expansion_early';
  } else {
    moveState = 'accumulation';
  }

  // ── 3. VOLATILITY VÁLIDOATION of move state ───────────────────────────
  // Spec: IF expansion detected → validate with candle volatility
  //   increasing volatility → confirm expansion_early
  //   decreasing volatility → demote to expansion_late
  const { avgRange, lastRange, volRegime } = candleVolatilidad(candles);
  let validatedMoveState = moveState;

  if (moveState === 'expansion_early' && volRegime === 'low') {
    // COT shows expansion but candles show compression → early move not confirmed by price
    validatedMoveState = 'expansion_late';   // demote
  } else if (moveState === 'expansion_late' && volRegime === 'high') {
    // COT shows expansion_late but candles show vol spike → possibly still early
    validatedMoveState = 'expansion_early';  // promote
  }
  // acumulación + high vol = possible breakout incoming → stays acumulación but flagged
  const volBreakoutWarning = moveState === 'accumulation' && volRegime === 'high';

  // ── 4. CANDLE PRICE LOCATION ──────────────────────────────────────────
  const candleLoc = candlePriceLocation(candles);

  // ── 5. ADJ SCORE: COT proximity + validated move state + candle location ──
  const STATE_LABELS = {
    accumulation:    'Fase de acumulación',
    expansion_early: 'Expansión — etapa temprana',
    expansion_late:  'Expansión — etapa tardía',
    distribution:    'Fase de distribution',
  };
  const ZONE_LABELS = { premium:'Zona premium', equilibrium:'Equilibrio', discount:'Zona de descuento' };

  let adj = 0;
  // Liquidity proximity (COT)
  if (pctL > 82 || pctL < 18) adj += 10;
  else if (pctL > 70 || pctL < 30) adj += 4;

  // Estado del movimiento (volatility-validated)
  if (validatedMoveState === 'expansion_early') adj += 6;
  if (validatedMoveState === 'expansion_late')  adj -= 8;
  if (validatedMoveState === 'distribution')    adj -= 15;

  // Candle price location (from price API when available)
  adj += candleLoc.locationAdj;

  adj = Math.max(-15, Math.min(15, adj));

  const volStr = volRegime !== 'normal' ? ` · Vol: ${volRegime}` : '';
  const breakoutStr = candleLoc.isBreakout ? ` · ${candleLoc.locationLabel}` : '';

  return {
    adj, rangeZone, moveState: validatedMoveState,
    originalMoveState: moveState,           // before volatility validation
    volRegime, volBreakoutWarning,
    candleLoc,
    label: `${STATE_LABELS[validatedMoveState]} · ${ZONE_LABELS[rangeZone]}${breakoutStr}`,
    detail: `pctL ${pctL}% · Δ${weekDelta > 0 ? '+' : ''}${(weekDelta/1000).toFixed(0)}k contracts${volStr}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK 4 — TIMING
// biasStrength×0.4 + macroRisk×0.2 + volatility×0.2 + sentiment×0.2
// + price position adjustment
// ═══════════════════════════════════════════════════════════════════════════
function evalTiming(events, dirResult, candles) {
  if (!dirResult.available || dirResult.biasPuntuación === null) {
    return { available:false, score:null, label:'Se requieren datos COT', status:'unavailable',
      conf:null, detail:'El timing requiere sesgo institucional (archivo COT).', warning:null, breakdown:null, pricePos:null };
  }

  const { biasPuntuación, biasDir, entry } = dirResult;
  const biasStrength = (Math.abs(biasPuntuación) / 5) * 100;
  const biasDirección = biasDir === 'bullish' ? 'bullish' : biasDir === 'bearish' ? 'bearish' : 'neutral';

  const today     = new Date().toISOString().slice(0,10);
  const todayEvs  = Array.isArray(events) ? events.filter(e => e.date?.slice(0,10) === today) : [];
  const highCount = todayEvs.filter(e => e.impact === 'High').length;
  const midCount  = todayEvs.filter(e => e.impact === 'Medium').length;

  const { breakdown } = calculateExecutionScore({
    biasPuntuación, biasDirección,
    riskPuntuación: highCount * 15 + midCount * 5,
    fg:  Math.max(20, Math.min(80, 55 - highCount * 5)),
    vix: Math.min(40, 18 + highCount * 2.5 + midCount * 0.8),
    highCount, midCount,
  });

  const macN = (breakdown.macroRisk.points  / breakdown.macroRisk.max)  * 100;
  const volN = (breakdown.volatility.points / breakdown.volatility.max) * 100;
  const senN = (breakdown.fearGreed.points  / breakdown.fearGreed.max)  * 100;

  const basePuntuación = Math.round(biasStrength * 0.40 + macN * 0.20 + volN * 0.20 + senN * 0.20);

  // Unified price position — candles enhance volatility validation + location
  const pricePos = getPricePosition(entry, candles);
  const score    = Math.max(0, Math.min(100, basePuntuación + pricePos.adj));

  const conf   = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  const status = score >= 70 ? 'ok' : score >= 45 ? 'partial' : 'warn';

  let label, warning;
  if (score >= 75)      { label = 'Señal de timing fuerte';   warning = null; }
  else if (score >= 55) { label = 'Timing moderado';        warning = 'Aceptable pero no óptimo. Ajusta los criterios de entrada.'; }
  else if (score >= 40) { label = 'Señal de timing débil';     warning = 'Fuerza de sesgo baja o macro adverso. Espera un mejor setup.'; }
  else                  { label = 'Condiciones de timing deficientes'; warning = 'No fuerces la entrada — permiso de ejecución insuficiente.'; }

  // Absorb breakout warning into timing warning
  const bkWarn = pricePos.volBreakoutWarning ? 'Pico de volatilidad en acumulación — posible ruptura. Vigila la continuación direccional.' : null;
  if (bkWarn && !warning) warning = bkWarn;
  else if (bkWarn) warning = `${warning} ${bkWarn}`;

  return {
    available:true, score, label, status, conf,
    detail:`Bias ${biasStrength.toFixed(0)}% · Macro ${macN.toFixed(0)}% · Vol ${volN.toFixed(0)}% · Sentimiento ${senN.toFixed(0)}% · Pos ${pricePos.adj>=0?'+':''}${pricePos.adj}`,
    warning, pricePos,
    moveState:  pricePos.moveState,
    rangeZone:  pricePos.rangeZone,
    volRegime:  pricePos.volRegime,
    candleLoc:  pricePos.candleLoc,
    breakdown:{ biasStrength:+biasStrength.toFixed(1), macroRisk:+macN.toFixed(1), volatility:+volN.toFixed(1), sentiment:+senN.toFixed(1), priceAdj:pricePos.adj },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DECISION ENGINE
// Hard stops evaluated in order — replaced gating caps
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// MARKET CLARITY FILTER (Part 4)
// Detects conflicting signals across blocks. High conflict → score penalty.
// Returns: { conflictPuntuación, conflicts[], clarityLabel, penalty }
// ═══════════════════════════════════════════════════════════════════════════
function computeMarketClaridad(ctx, exp, dir, tim) {
  const conflicts = [];

  // 1. Dirección vs DXY divergence
  if (dir.dxyDivergence) {
    conflicts.push({ type:'DXY_DIVERGENCE', severity:'high',
      detail:'COT direction conflicts with USD Index positioning' });
  }

  // 2. Timing vs volatility mismatch
  // High bias but vol regime low (compression) = timing and bias don't match
  const volReg = tim.volRegime ?? 'normal';
  const biasAbs = Math.abs(dir.biasPuntuación ?? 0);
  if (biasAbs >= 2 && volReg === 'low' && tim.moveState === 'accumulation') {
    conflicts.push({ type:'TIMING_VOL_MISMATCH', severity:'medium',
      detail:'Strong COT bias but precio comprimiendo — sin confirmación de expansión' });
  }

  // 3. Macro vs expectation conflict
  // Riesgo macro alto (ctx low) + strong expectation surprise = conflicting signals
  if ((ctx.score ?? 100) < 40 && (exp.score ?? 50) >= 70) {
    conflicts.push({ type:'MACRO_EXP_CONFLICT', severity:'medium',
      detail:'Strong data surprise but macro environment too volatile for clean execution' });
  }

  // 4. Estado del movimiento vs context
  // Fase de distribution during clean context = institutions leaving while macro calm
  if (tim.moveState === 'distribution' && (ctx.score ?? 0) >= 60) {
    conflicts.push({ type:'DISTRIBUTION_SIGNAL', severity:'high',
      detail:'Institutions appear to be unwinding during calm macro — potential reversal' });
  }

  // Puntuación: 0 = no conflicts, 100 = maximum conflict
  const severitySum = conflicts.reduce((sum, c) => sum + (c.severity === 'high' ? 2 : 1), 0);
  const conflictPuntuación = Math.min(100, severitySum * 25);

  // Penalty: calibrated to not kill valid transition/reversal setups
  // -20 was too aggressive in transition phases (best trades happen there)
  const penalty = conflictPuntuación >= 50 ? 15 : conflictPuntuación >= 25 ? 8 : 0;

  const clarityLabel = conflictPuntuación >= 50 ? 'Baja claridad de mercado'
    : conflictPuntuación >= 25 ? 'Señales mixtas'
    : 'Condiciones claras';

  return { conflictPuntuación, conflicts, clarityLabel, penalty };
}

// ═══════════════════════════════════════════════════════════════════════════
// OBJETIVO DE LIQUIDEZ (Part 12 — MANDATORY)
// Computes nearest highs/lows and previous weekly extremes from COT + candles
// ═══════════════════════════════════════════════════════════════════════════
function computeLiquidityTarget(entry, candles, dir) {
  if (!dir.available) {
    return { target:'No disponible', detail:'Carga el archivo COT para el análisis de liquidez', aboveTarget:null, belowTarget:null };
  }

  const biasD = dir.biasDir; // 'bullish' | 'bearish' | 'neutral'

  // Candle-based: recent highs/lows from last 8 candles
  let nearestHigh = null, nearestLow = null;
  let breakoutNote = null;

  if (candles && candles.length >= 4) {
    const lookback = candles.slice(-8);
    nearestHigh = Math.max(...lookback.map(c => c.high));
    nearestLow  = Math.min(...lookback.map(c => c.low));
    const last  = lookback[lookback.length - 1];
    const range = nearestHigh - nearestLow || 0.0001;

    // Proximity: is price within 15% del rango from extreme?
    const toHigh = (nearestHigh - last.close) / range;
    const toLow  = (last.close - nearestLow) / range;

    if (toHigh < 0.15) breakoutNote = `Precio a ${(toHigh * 100).toFixed(0)}% del máximo reciente — posible liquidez sobre ${nearestHigh.toFixed(5)}`;
    else if (toLow < 0.15) breakoutNote = `Precio a ${(toLow * 100).toFixed(0)}% del mínimo reciente — posible liquidez bajo ${nearestLow.toFixed(5)}`;
  }

  // COT-based: percentile extremes indicate likely institutional price levels
  const pctL = entry?.weeks?.[0]?.smartPctL ?? 50;
  let cotLiqNote = null;

  if (pctL > 80) cotLiqNote = 'COT en largo extremo — institucionales posiblemente en máximos recientes';
  else if (pctL < 20) cotLiqNote = 'COT en corto extremo — institucionales posiblemente en mínimos recientes';
  else if (pctL > 65) cotLiqNote = 'COT posicionado alcista — acumulación de liquidez compradora por encima del precio';
  else if (pctL < 35) cotLiqNote = 'COT posicionado bajista — acumulación de liquidez vendedora por debajo del precio';

  // Direcciónal target: where is the engine pointing price next?
  let target, aboveTarget, belowTarget;

  if (biasD === 'bullish') {
    aboveTarget = nearestHigh != null ? `Máximo reciente ${nearestHigh.toFixed(5)}` : 'Máximo recientes (load price data)';
    belowTarget = nearestLow  != null ? `Soporte en ${nearestLow.toFixed(5)}` : 'Mínimo recientes';
    target = `Objetivo de liquidez: ${aboveTarget}`;
  } else if (biasD === 'bearish') {
    belowTarget = nearestLow  != null ? `Mínimo reciente ${nearestLow.toFixed(5)}` : 'Mínimo recientes (load price data)';
    aboveTarget = nearestHigh != null ? `Resistencia en ${nearestHigh.toFixed(5)}` : 'Máximo recientes';
    target = `Objetivo de liquidez: ${belowTarget}`;
  } else {
    target = nearestHigh && nearestLow
      ? `Rango: ${nearestLow.toFixed(5)} – ${nearestHigh.toFixed(5)}`
      : 'Sin objetivo de liquidez direccional — sesgo neutral';
  }

  // Priority: 1 = nearest in direction of bias, 2 = weekly extreme, 3 = range boundary
  let priority = 'range';
  let priorityLabel = '';

  // Priority 1: nearest liquidity IN direction of bias
  if (biasD === 'bullish' && nearestHigh != null) {
    priority = 'directional'; priorityLabel = 'Liquidez más cercana arriba (sesgo alcista)';
  } else if (biasD === 'bearish' && nearestLow != null) {
    priority = 'directional'; priorityLabel = 'Liquidez más cercana abajo (sesgo bajista)';
  }

  // Priority 2: previous weekly extreme (COT-derived — extreme pctL)
  const pctL_ = entry?.weeks?.[0]?.smartPctL ?? 50;
  if (priority === 'range' && (pctL_ > 75 || pctL_ < 25)) {
    priority = 'weekly_extreme';
    priorityLabel = pctL_ > 75
      ? 'Máximo semanal previo (institucionales en largo extremo)'
      : 'Mínimo semanal previo (institucionales en corto extremo)';
    target = priorityLabel;
  }

  return {
    target, priority, priorityLabel,
    aboveTarget: aboveTarget ?? (nearestHigh ? `${nearestHigh.toFixed(5)}` : null),
    belowTarget: belowTarget ?? (nearestLow  ? `${nearestLow.toFixed(5)}`  : null),
    breakoutNote, cotLiqNote, nearestHigh, nearestLow,
    detail: [priorityLabel || target, breakoutNote, cotLiqNote].filter(Boolean).join(' · '),
  };
}

function computeDecision(ctx, exp, dir, tim) {
  // ── HARD STOP 1: Dirección (most critical) ─────────────────────────────
  if (!dir.available) {
    return { verdict:'INSUFFICIENT DATA', color:'#5a6070',
      reason:'Sin datos de posicionamiento institucional. Carga el archivo CFTC.',
      stopped:'direction', score:null, rawScore:null, clarity:null,
      trace:[{ step:'Dirección', status:'BLOQUEADO', detail:'Archivo COT no cargado' }],
      evaluated:['context','expectation'] };
  }
  if ((dir.score ?? 0) < 50) {
    return { verdict:'NO TRADE', color:'#ef4444',
      reason:'Contra el flujo institucional — sesgo COT débil o divergente',
      stopped:'direction', score:null, rawScore:null, clarity:null,
      trace:[{ step:'Dirección', status:'FALLO', detail:`Puntuación ${dir.score ?? 0}/100 < 50 umbral` }],
      evaluated:['context','expectation','direction'] };
  }

  // ── HARD STOP 2: Timing ────────────────────────────────────────────────
  if (!tim.available) {
    return { verdict:'NO TRADE', color:'#ef4444',
      reason:'Timing no disponible — no se puede confirmar el permiso de ejecución',
      stopped:'timing', score:null, rawScore:null, clarity:null,
      trace:[
        { step:'Dirección', status:'OK', detail:`Puntuación ${dir.score ?? 0}/100` },
        { step:'Timing',    status:'BLOQUEADO', detail:'Se necesita el archivo COT para calcular el timing' },
      ],
      evaluated:['context','expectation','direction'] };
  }
  if ((tim.score ?? 0) < 50) {
    return { verdict:'NO TRADE', color:'#ef4444',
      reason:'Sin confirmación de timing — el sesgo existe pero las condiciones de ejecución no se cumplen',
      stopped:'timing', score:null, rawScore:null, clarity:null,
      trace:[
        { step:'Dirección', status:'OK',   detail:`Puntuación ${dir.score ?? 0}/100` },
        { step:'Timing',    status:'FALLO',   detail:`Puntuación ${tim.score ?? 0}/100 < 50 umbral` },
      ],
      evaluated:['context','expectation','direction','timing'] };
  }

  // ── CONTEXT CHECK (not a hard stop — affects verdict label) ───────────
  if ((ctx.score ?? 100) < 40) {
    const rawScore = Math.round((ctx.score??0)*0.20 + (exp.score??0)*0.20 + (dir.score??0)*0.30 + (tim.score??0)*0.30);
    return { verdict:'UNFAVORABLE CONDITIONS', color:'#f59e0b',
      reason:'Riesgo macro demasiado alto — esperar absorción del evento',
      stopped:'context', score:Math.min(rawScore, 45), rawScore,
      evaluated:['context','expectation','direction','timing'] };
  }

  // ── All gates passed → score-based verdict ─────────────────────────────
  const rawScore = Math.round(
    (ctx.score??0)*0.20 + (exp.score??0)*0.20 + (dir.score??0)*0.30 + (tim.score??0)*0.30
  );

  // Market clarity penalty (conflicts reduce final score)
  const clarity  = computeMarketClaridad(ctx, exp, dir, tim);
  const adjScore = Math.max(0, rawScore - clarity.penalty);
  const hasConflict = clarity.penalty > 0;
  const conflictNote = hasConflict ? ` · ${clarity.clarityLabel}` : '';

  // Decision trace: step-by-step audit for transparency and debugging
  const trace = [
    { step:'Dirección', status:'OK',    detail:`Puntuación ${dir.score ?? 0}/100 · ${dir.label}` },
    { step:'Timing',    status:'OK',    detail:`Puntuación ${tim.score ?? 0}/100 · ${tim.label}` },
    { step:'Contexto',   status:(ctx.score ?? 100) >= 60 ? 'OK' : (ctx.score ?? 100) >= 40 ? 'ADVERTENCIA' : 'WARN', detail:`Puntuación ${ctx.score ?? '—'}/100 · ${ctx.label}` },
    { step:'Claridad',   status:clarity.penalty === 0 ? 'LIMPIO' : clarity.penalty <= 8 ? 'MEDIO' : 'LOW', detail:clarity.clarityLabel + (clarity.penalty > 0 ? ` · −${clarity.penalty} pts` : '') },
    { step:'Puntuación',     status:adjScore >= 75 ? 'VÁLIDO' : adjScore >= 60 ? 'CONDICIONAL' : 'VIGILAR', detail:`${adjScore}/100${adjScore !== rawScore ? ` (raw ${rawScore})` : ''}` },
  ];

  if (adjScore >= 75) return { verdict:'VALID TRADE',  color:'#22c55e', reason:`Todos los factores alineados${conflictNote}`, stopped:null, score:adjScore, rawScore, clarity, trace, evaluated:['context','expectation','direction','timing'] };
  if (adjScore >= 60) return { verdict:'CONDITIONAL',  color:'#f59e0b', reason:`Alineación parcial${conflictNote}`, stopped:null, score:adjScore, rawScore, clarity, trace, evaluated:['context','expectation','direction','timing'] };
  return              { verdict:'WATCH',               color:'#8b90a0', reason:`Condiciones mejorando pero no listas${conflictNote}`, stopped:null, score:adjScore, rawScore, clarity, trace, evaluated:['context','expectation','direction','timing'] };
}

// ── Numeric confianza score ───────────────────────────────────────────────
function computeConfidence(hasCOT, hasDXY, hasCalendar, timAvail) {
  const score = (hasCOT ? 40 : 0) + (hasDXY ? 20 : 0) + (hasCalendar ? 20 : 0) + (timAvail ? 20 : 0);
  return { score, label: score >= 80 ? 'HIGH' : score >= 50 ? 'MEDIO' : 'LOW' };
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET MODE
// Derives TREND / RANGE / TRANSITION from COT bias + move state + context risk
// ═══════════════════════════════════════════════════════════════════════════
function computeMarketMode(dir, tim, ctx) {
  if (!dir.available) {
    return { mode:'UNKNOWN', color:'#5a6070', volRegime:'normal', detail:'Carga el archivo COT para el análisis del modo de mercado' };
  }

  const biasAbs   = Math.abs(dir.biasPuntuación ?? 0);
  const moveState = tim.moveState  ?? 'accumulation';
  const rangeZone = tim.rangeZone  ?? 'equilibrium';
  const ctxScore  = ctx.score      ?? 75;
  const volRegime = tim.volRegime  ?? 'normal';  // from candleVolatilidad()

  // ── VOLATILITY REGIME influence ───────────────────────────────────────
  // High vol → bias toward TREND or TRANSITION (momentum market)
  // Low vol  → bias toward RANGE (compression, await breakout)
  const volFavoresTrend = volRegime === 'high';
  const volFavoresRange = volRegime === 'low';

  // ── TRANSITION: distribution or DXY conflict ──────────────────────────
  if (moveState === 'distribution' || dir.dxyDivergence) {
    return { mode:'TRANSITION', color:'#f59e0b', volRegime,
      detail: dir.dxyDivergence ? 'DXY divergence — instituciones reposicionándose' : `Fase de distribution en ${rangeZone}${volFavoresTrend ? ' · alta volatilidad' : ''}` };
  }

  // ── RANGE: compression detected ───────────────────────────────────────
  // Low volatility overrides even moderate bias → still RANGE until breakout
  if (volFavoresRange && biasAbs < 3) {
    return { mode:'RANGE', color:'#8b90a0', volRegime,
      detail:`Compresión detectada — baja volatilidad en ${rangeZone}. Espera una ruptura direccional.` };
  }

  // ── TREND: strong bias + expansion + confirmed by volatility ──────────
  if (biasAbs >= 2.5 && (moveState === 'expansion_early' || moveState === 'expansion_late')) {
    const volNote = volFavoresTrend ? ' · vol. en expansión' : volFavoresRange ? ' · vol. descendente' : '';
    const qualifier = moveState === 'expansion_early' ? 'etapa temprana' : 'etapa tardía — precaución';
    return { mode:'TREND', color:'#22c55e', volRegime,
      detail:`${dir.biasDir === 'bullish' ? 'Bullish' : 'Bearish'} trend (${qualifier})${volNote} · ${rangeZone}` };
  }

  // ── TRANSITION: bias building but no expansion ────────────────────────
  if (biasAbs >= 1.5 && moveState === 'accumulation') {
    const volNote = volFavoresTrend ? ' · volatilidad en expansión — vigila la ruptura' : '';
    return { mode:'TRANSITION', color:'#f59e0b', volRegime,
      detail:`Sesgo en construcción (${biasAbs.toFixed(1)}/5) — precio aún sin expandirse${volNote}` };
  }

  // ── RANGE (default) ───────────────────────────────────────────────────
  const rangeDetail = volFavoresTrend
    ? `Sesgo neutral con volatilidad elevada — condiciones erráticas en ${rangeZone}`
    : `Acumulación en ${rangeZone} — sin presión direccional clara`;
  return { mode:'RANGE', color:'#8b90a0', volRegime, detail:rangeDetail };
}

// ═══════════════════════════════════════════════════════════════════════════
// NARRATIVE ENGINE — state-aware, verdict-specific
// ═══════════════════════════════════════════════════════════════════════════
function buildNarrative(ctx, exp, dir, tim, decision, mktMode, pair) {
  const biasStr = Math.abs(dir.biasPuntuación ?? 0);
  const biasD   = dir.biasDir === 'bullish' ? 'bullish' : dir.biasDir === 'bearish' ? 'bearish' : 'neutral';
  const biasUp  = biasD.charAt(0).toUpperCase() + biasD.slice(1);
  const move    = tim.moveState ?? 'accumulation';
  const zone    = tim.rangeZone ?? 'equilibrium';

  // Helper: every return is { summary, action }
  const N = (summary, action, invalidation=null) => ({ summary, action, invalidation });

  // ── HARD STOP narratives: short and decisive ──────────────────────────
  if (decision.verdict === 'INSUFFICIENT DATA') {
    return N(
      `No institutional data for ${pair}`,
      'Carga el archivo CFTC desde la pestaña "Sesgos" para activar el análisis completo'
    );
  }

  if (decision.verdict === 'NO TRADE' && decision.stopped === 'direction') {
    if (!dir.available) return N(`COT data unavailable for ${pair}`, 'Carga el archivo CFTC para determinar el flujo institucional');
    if (dir.dxyDivergence) return N(
      `${biasUp} COT signal on ${pair} — DXY diverges`,
      'Flujo institucional contradictorio detectado. No abras posiciones hasta que la divergencia se resuelva'
    );
    return N(
      `Institutional edge absent on ${pair} (bias ${biasStr.toFixed(1)}/5)`,
      'Espera next CFTC report to show stronger directional commitment before trading'
    );
  }

  if (decision.verdict === 'NO TRADE' && decision.stopped === 'timing') {
    const timPuntuación = tim.score ?? 0;
    if (move === 'distribution') return N(
      `${biasUp} COT bias on ${pair} but institutions are unwinding`,
      `Timing score ${timPuntuación}/100 — espera a que el reposicionamiento se complete antes de considerar la entrada`
    );
    return N(
      `${biasUp} bias present (${biasStr.toFixed(1)}/5) but execution conditions not met`,
      `Timing score ${timPuntuación}/100 — el entorno macro o de volatilidad impide la entrada en ${pair}`
    );
  }

  // ── CONDICIONES DESFAVORABLES ────────────────────────────────────────────
  if (decision.verdict === 'UNFAVORABLE CONDITIONS') {
    const topEv = ctx.topEvents?.[0];
    return N(
      `${biasUp} setup on ${pair} valid — macro risk too high to execute`,
      `Espera ${topEv ? `${topEv.name} (${topEv.impact}) ` : 'macro event '}absorción antes de considerar la entrada`
    );
  }

  // ── OPERAR ───────────────────────────────────────────────────────
  if (decision.verdict === 'VALID TRADE') {
    const candleLoc = tim.candleLoc;
    const expNote   = exp.score >= 70 ? 'confirmado por sorpresa de datos' : exp.score <= 50 ? 'setup técnico — sin catalizador macro' : 'moderate data soporte';
    const modeNote  = move === 'expansion_early' ? 'expansion_early' : move === 'expansion_late' ? 'expansion_late' : 'accumulation';
    const conflictNote = decision.clarity?.penalty > 0 ? ` · ${decision.clarity.clarityLabel}` : '';
    const summary = `${biasUp} institutional flow on ${pair} (${biasStr.toFixed(1)}/5) · ${modeNote} · ${expNote}${conflictNote}`;

    let action;
    if (candleLoc?.isBreakout) {
      action = candleLoc.isBreakoutUp
        ? `Ruptura sobre máximos recientes — sigue la entrada larga sobre la vela de ruptura, stop bajo el nivel de ruptura`
        : `Ruptura bajo mínimos recientes — sigue la entrada corta bajo la vela de ruptura, stop sobre el nivel de ruptura`;
    } else if (candleLoc?.nearLow && biasD === 'bullish') {
      action = `Precio cerca de mínimos recientes en ${zone} zone — busca confirmación de vela alcista antes de entrar largo`;
    } else if (candleLoc?.nearHigh && biasD === 'bearish') {
      action = `Precio cerca de máximos recientes — espera una vela de rechazo bajista antes de entrar corto`;
    } else if (move === 'expansion_early') {
      action = `Entra en el primer retroceso hacia ${zone === 'discount' ? 'zona de descuento' : zone === 'premium' ? 'área de valor' : 'nivel estructural más cercano'} — mantén el stop más allá del ${biasD === 'bullish' ? 'low' : 'high'}`;
    } else if (move === 'expansion_late') {
      action = `No persigas el precio — espera compresión y una entrada de menor riesgo antes del siguiente tramo`;
    } else {
      action = `Espera price to reach structural ${biasD === 'bullish' ? 'soporte' : 'resistencia'} antes de considerar la entrada`;
    }
    // Invalidation: where does the thesis break?
    let invalidation = null;
    if (biasD === 'bullish') {
      invalidation = tim.candleLoc?.nearestLow
        ? `Tesis invalidada si el precio cierra por debajo de ${tim.candleLoc.nearestLow?.toFixed?.(5) ?? 'recent low'}`
        : `Tesis invalidada si la posición neta COT se vuelve bajista en el próximo informe`;
    } else if (biasD === 'bearish') {
      invalidation = tim.candleLoc?.nearestHigh
        ? `Tesis invalidada si el precio cierra por encima de ${tim.candleLoc.nearestHigh?.toFixed?.(5) ?? 'recent high'}`
        : `Tesis invalidada si la posición neta COT se vuelve alcista en el próximo informe`;
    }

    return N(summary, action, invalidation);
  }

  // ── CONDICIONAL ───────────────────────────────────────────────────────
  if (decision.verdict === 'CONDITIONAL') {
    const weakDir   = (dir.score ?? 0) < 65;
    const weakTim   = (tim.score ?? 0) < 65;
    const candleLoc = tim.candleLoc;

    if (weakDir) return N(
      `${biasUp} lean on ${pair} — institutional conviction insufficient (${biasStr.toFixed(1)}/5)`,
      'Espera next CFTC report showing stronger directional commitment before committing capital'
    );
    if (weakTim) {
      const timNote = move === 'accumulation' ? 'precio comprimiendo — sin confirmación de expansión' : 'las condiciones macro reducen la calidad de ejecución';
      return N(
        `${biasUp} institutional setup on ${pair} — ${timNote}`,
        `Vigila ${candleLoc?.isBreakout ? 'continuación de la ruptura' : 'cierre decisivo de vela más allá de estructura clave'} antes de entrar`
      );
    }
    const topEv = ctx.topEvents?.[0];
    if ((ctx.score ?? 100) < 60) return N(
      `${biasUp} setup on ${pair} technically valid — macro event creates timing risk`,
      `Espera ${topEv ? `${topEv.name} absorption` : 'event volatility'} para resolverse y luego reevalúa la entrada`
    );
    return N(
      `Partial ${biasD} setup on ${pair} — one confirming factor pending`,
      'Reduce el tamaño. Coloca órdenes solo en niveles estructurales clave con stop-loss definido'
    );
  }

  // ── VIGILAR ─────────────────────────────────────────────────────────────
  if (decision.verdict === 'WATCH') {
    const volReg = tim.volRegime ?? 'normal';
    return N(
      `${biasUp} sesgo en construcción en ${pair} (${biasStr.toFixed(1)}/5) — no entry confirmation`,
      volReg === 'high'
        ? `Vigila ${biasD} cierre de vela más allá de la estructura reciente para activar la entrada`
        : `Mercado comprimiendo — activa alerta para la primera vela fuerte con cuerpo/rango > 70%`
    );
  }

  return N(`Sin setup claro en ${pair}`, 'Espera institutional positioning to clarify');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE QUALITY TAG
// A+: full alignment + expansion_early move
// A:  full alignment
// B:  parcial (conditional)
// C:  no trade
// ═══════════════════════════════════════════════════════════════════════════
function computeQuality(decision, tim, dir, exp) {
  if (decision.verdict === 'INSUFFICIENT DATA') return { tag:'—',   color:'#5a6070', detail:'No data' };
  if (decision.verdict === 'NO TRADE')           return { tag:'C',   color:'#ef4444', detail:'Sin ventaja institucional ni de timing' };
  if (decision.verdict === 'UNFAVORABLE CONDITIONS') return { tag:'C', color:'#ef4444', detail:'El entorno macro impide una ejecución segura' };
  if (decision.verdict === 'WATCH')               return { tag:'B-', color:'#8b90a0', detail:'Setup en construcción — no está listo' };

  const score       = decision.score ?? 0;
  const moveState   = tim.moveState  ?? 'accumulation';
  const biasStr     = Math.abs(dir.biasPuntuación ?? 0);
  const isBreakout  = tim.candleLoc?.isBreakout ?? false;
  const expPuntuación    = exp.score ?? 50;
  const volReg      = tim.volRegime ?? 'normal';

  // A+: full alignment + optimal entry conditions
  const isOptimalEntry = (
    score >= 75 &&
    biasStr >= 2.5 &&
    (moveState === 'expansion_early' || isBreakout) &&
    expPuntuación >= 65 &&
    volReg !== 'low'
  );
  if (isOptimalEntry) return { tag:'A+', color:'#22c55e', detail:'Alineación total · Expansión temprana · Ventana de entrada ideal' };

  // A: full alignment
  if (score >= 75) return { tag:'A', color:'#22c55e', detail:'Todos los factores alineados — execute with discipline' };

  // B: conditional / parcial
  const bPlus = score >= 65 && biasStr >= 2;
  if (bPlus) return { tag:'B+', color:'#f59e0b', detail:'Buen setup, un factor por debajo del óptimo' };
  return { tag:'B', color:'#f59e0b', detail:'Setup parcial — reduce el tamaño y espera confirmación' };
}

// ── Alert system (state-change only) ──────────────────────────────────────
const _alertBucket = new Map(); // pair → last bucket
function maybeAlert(pair, score, verdict, quality, moveState, ctxScore) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Alert ONLY when: score ≥ 80 + quality ≥ A + not in expansion_late (risk of chasing)
  const qualityRank = (t) => t === 'A+' ? 4 : t === 'A' ? 3 : t === 'B+' ? 2 : t === 'B' ? 1 : 0;
  // Block alerts on extreme macro risk days (context < 40)
  // Prevents notifications during FOMC / NFP / CPI impact windows
  const macroExtreme = ctxScore != null && ctxScore < 40;

  const isHighQuality = !macroExtreme &&
    score != null && score >= 80 &&
    qualityRank(quality?.tag) >= 3 &&
    moveState !== 'expansion_late' &&
    moveState !== 'distribution';

  const isLow = verdict === 'NO TRADE' || (score != null && score < 50);

  const bucket = isHighQuality ? 'high' : isLow ? 'low' : 'mid';
  if (_alertBucket.get(pair) === bucket) return;   // no state change — no spam
  _alertBucket.set(pair, bucket);

  if (bucket === 'high') {
    new Notification('COT Tracker — Setup de Alta Calidad', {
      body: `${pair}: Puntuación ${score}/100 · Quality ${quality?.tag} · ${moveState?.replace('_',' ')}`,
      icon: '/favicon.ico',
    });
  } else if (bucket === 'low') {
    new Notification('COT Tracker — Condiciones Desfavorables', {
      body: `Condiciones de mercado desfavorables en ${pair}`,
      icon: '/favicon.ico',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const SI = { ok:'✅', partial:'⚠️', warn:'🔴', unavailable:'⬜' };
const SC = { ok:'#22c55e', partial:'#f59e0b', warn:'#ef4444', unavailable:'#5a6070' };
const CC = { High:'#22c55e', Medium:'#f59e0b', Low:'#8b90a0' };

const BLOCKS = [
  { key:'context',     label:'1 · Contexto',     icon:'📅', tip:'Paso 1: ¿Qué está pasando fuera del gráfico? Bancos centrales, eventos macro, recencia.' },
  { key:'expectation', label:'2 · Expectation', icon:'🎯', tip:'Paso 2: El mercado se mueve por sorpresas. Deviation = |actual - estimate| / |estimate|.' },
  { key:'direction',   label:'3 · Dirección',   icon:'🧭', tip:'Paso 3: Sesgo institucional COT. Mismo motor que Institutional Bias Engine.' },
  { key:'timing',      label:'4 · Timing',      icon:'⏱',  tip:'Paso 4: Permiso de ejecución. Fuerza del sesgo + macro + volatility + price position.' },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function TradeReadinessChecklist({ events=[], pairsData=null, candles=[], darkMode, T, onScore, selectedPair: controlledPair, onPairChange }) {
  const [open,      setOpen]     = useState(false);
  // Use controlled pair when provided, fall back to internal state
  const [internalPair, setInternalPair] = useState('EUR/USD');
  const pair    = controlledPair ?? internalPair;
  const setPair = (p) => { setInternalPair(p); onPairChange?.(p); };
  const [expanded,  setExpanded] = useState(null);
  const [traceOpen, setTraceOpen] = useState(false);

  const availablePairs = useMemo(() => {
    if (!pairsData?.length) return ['EUR/USD'];
    return pairsData.map(p => p.pair).sort();
  }, [pairsData]);

  useEffect(() => {
    if (!availablePairs.includes(pair)) setPair(availablePairs[0] || 'EUR/USD');
  }, [availablePairs, pair]);

  const engine = useMemo(() => {
    const hasCOT      = !!(pairsData?.length);
    const hasCalendar = Array.isArray(events) && events.length > 0;
    const dxyEntry    = hasCOT ? pairsData.find(p => p.pair === 'USD Index') : null;
    const hasDXY      = !!dxyEntry;

    const ctx      = evalContexto(events, pair);
    const exp      = evalExpectation(events, pair);
    const dir      = evalDirección(pairsData, pair, dxyEntry);
    const tim      = evalTiming(events, dir, candles);
    const decision = computeDecision(ctx, exp, dir, tim);  // includes clarity penalty
    const conf     = computeConfidence(hasCOT, hasDXY, hasCalendar, tim.available);
    const mktMode  = computeMarketMode(dir, tim, ctx);
    const narrative= buildNarrative(ctx, exp, dir, tim, decision, mktMode, pair); // returns {summary, action}
    const quality  = computeQuality(decision, tim, dir, exp);

    // Liquidity target (requires COT entry + candles)
    const entry    = dir.available ? pairsData?.find(p => p.pair === pair) : null;
    const liqTarget = computeLiquidityTarget(entry, candles, dir);

    return { ctx, exp, dir, tim, decision, conf, mktMode, quality, narrative, liqTarget, hasCOT, hasDXY };
  }, [events, pairsData, candles, pair]);

  useEffect(() => {
    if (open) maybeAlert(pair, engine.decision.score, engine.decision.verdict, engine.quality, engine.tim?.moveState, engine.ctx?.score);
  }, [pair, engine.decision.score, engine.decision.verdict, open]);

  useEffect(() => {
    if (onScore && engine.decision.score != null) onScore(engine.decision.score);
  }, [engine.decision.score, onScore]);

  const dec       = engine.decision;
  const verdictBg = dec.color + '12';
  const glass     = {
    background:     darkMode ? 'rgba(17,22,29,0.97)' : 'rgba(255,255,255,0.97)',
    backdropFilter: 'blur(20px)',
    border:         `1px solid ${T.border}`,
  };
  const results = { context:engine.ctx, expectation:engine.exp, direction:engine.dir, timing:engine.tim };

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Trade Readiness — Decision Engine"
        style={{
          position:'fixed', bottom:24, right:24, zIndex:1000,
          width:52, height:52, borderRadius:16,
          border:`1px solid ${T.border}`, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:22, transition:'all 0.2s ease', ...glass,
          boxShadow: open ? `0 0 0 2px ${dec.color}50,0 8px 32px ${dec.color}20` : '0 4px 20px rgba(0,0,0,0.3)',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform='scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; }}
      >
        {open ? '✕' : '🧠'}
        <span style={{
          position:'absolute', top:-7, right:-7,
          background: dec.score != null ? dec.color : '#5a6070',
          color:'#fff', fontSize:9, fontWeight:800, lineHeight:1,
          padding:'3px 5px', borderRadius:8, minWidth:22, textAlign:'center',
          boxShadow:`0 2px 8px ${dec.color}60`,
        }}>
          {dec.score ?? '—'}
        </span>
      </button>

      {/* PANEL */}
      <div style={{
        position:'fixed', bottom:88, right:24, zIndex:999,
        width:400, maxWidth:'calc(100vw - 32px)',
        maxHeight:'calc(100vh - 120px)',
        borderRadius:20, overflowY:'auto', overflowX:'hidden',
        display:'flex', flexDirection:'column', ...glass,
        transition:'opacity 0.25s ease, transform 0.25s ease',
        opacity:open?1:0, transform:open?'translateY(0) scale(1)':'translateY(16px) scale(0.97)',
        pointerEvents:open?'auto':'none',
      }}>

        {/* HEADER */}
        <div style={{ padding:'12px 14px 10px', borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:T.txt, letterSpacing:'-0.2px' }}>Trade Readiness</div>
              <div style={{ fontSize:10, color:T.sub2 }}>Motor de decisión · No es una señal</div>
            </div>
            {/* Confidence badge + score */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ textAlign:'right' }}>
                <span style={{
                  fontSize:9, fontWeight:700, letterSpacing:'.05em',
                  color:CC[engine.conf.label], background:CC[engine.conf.label]+'15',
                  padding:'2px 6px', borderRadius:4, display:'block', marginBottom:2,
                }}>
                  {engine.conf.label} {engine.conf.score}/100
                </span>
                <span style={{ fontSize:9, color:T.sub2 }}>confianza</span>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:900, color:dec.color, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
                  {dec.score ?? '—'}
                </div>
                <div style={{ fontSize:9, color:T.sub2 }}>/100</div>
              </div>
            </div>
          </div>

          {/* Pair selector */}
          <div style={{ position:'relative' }}>
            <select
              value={pair}
              onChange={e => { setPair(e.target.value); setExpanded(null); }}
              style={{
                width:'100%',
                padding:'8px 32px 8px 12px',
                borderRadius:10,
                border:`1px solid ${T.border}`,
                background: T.inputBg || T.card2,
                color: T.txt,
                fontSize:13,
                fontWeight:600,
                cursor:'pointer',
                outline:'none',
                appearance:'none',
                WebkitAppearance:'none',
                MozAppearance:'none',
                backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b90a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                backgroundRepeat:'no-repeat',
                backgroundPosition:'right 10px center',
                transition:'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => {
                e.target.style.borderColor = T.accent || '#0055cc';
                e.target.style.boxShadow = `0 0 0 3px ${(T.accent || '#0055cc')}20`;
              }}
              onBlur={e => {
                e.target.style.borderColor = T.border;
                e.target.style.boxShadow = 'none';
              }}
            >
              {availablePairs.map(p => (
                <option key={p} value={p} style={{ background: T.card2, color: T.txt }}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Data warnings */}
          {!engine.hasCOT && (
            <div style={{ marginTop:5, padding:'4px 8px', borderRadius:7, background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.18)', fontSize:10, color:'#f59e0b', lineHeight:1.4 }}>
              📂 Archivo COT no cargado — Dirección y Timing no disponibles
            </div>
          )}
          {engine.hasCOT && !engine.hasDXY && (
            <div style={{ marginTop:4, padding:'4px 8px', borderRadius:7, background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.12)', fontSize:10, color:'#f59e0b', lineHeight:1.4 }}>
              ⚠ Datos DXY no disponibles — confianza direccional reducida
            </div>
          )}

          {/* ── CLARITY CONFLICTS ── */}
          {engine.decision.clarity?.conflicts?.length > 0 && (
            <div style={{ marginTop:4, padding:'4px 8px', borderRadius:7,
              background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)',
              fontSize:10, color:'#ef4444', lineHeight:1.5 }}>
              ⚡ {engine.decision.clarity.clarityLabel}
              {engine.decision.clarity.penalty > 0 && (
                <span style={{ color:'rgba(239,68,68,0.7)', marginLeft:4 }}>
                  (−{engine.decision.clarity.penalty} pts)
                </span>
              )}
              {engine.decision.clarity.conflicts.slice(0,2).map((c,i) => (
                <div key={i} style={{ marginTop:1, color:'rgba(239,68,68,0.8)' }}>· {c.detail}</div>
              ))}
            </div>
          )}

          {/* ── MARKET MODE ── */}
          {engine.mktMode && engine.mktMode.mode !== 'UNKNOWN' && (
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, color:T.sub2 }}>Modo de mercado</span>
              <div style={{ display:'flex', alignItems:'center', gap:5,
                background: engine.mktMode.color + '12',
                border: `1px solid ${engine.mktMode.color}30`,
                borderRadius:6, padding:'3px 8px',
              }}>
                <span style={{
                  width:6, height:6, borderRadius:'50%',
                  background: engine.mktMode.color,
                  display:'inline-block', flexShrink:0,
                  boxShadow: `0 0 6px ${engine.mktMode.color}80`,
                }}/>
                <span style={{ fontSize:11, fontWeight:700, color:engine.mktMode.color, letterSpacing:'.04em' }}>
                  {engine.mktMode.mode}
                </span>
              </div>
              <span style={{ fontSize:10, color:T.sub2, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {engine.mktMode.detail}
              </span>
            </div>
          )}
        </div>

        {/* ── VERDICT (decision-first UI) ─────────────────────────────── */}
        <div style={{ padding:'10px 12px 0', flexShrink:0 }}>
          <div style={{ padding:'12px 14px', borderRadius:14, background:verdictBg, border:`1px solid ${dec.color}30` }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:16, fontWeight:900, color:dec.color, letterSpacing:'.02em', lineHeight:1 }}>
                    {dec.verdict}
                  </span>
                  {/* Quality tag */}
                  {engine.quality && engine.quality.tag !== '—' && (
                    <span style={{
                      fontSize:11, fontWeight:900, letterSpacing:'.04em',
                      color: engine.quality.color,
                      background: engine.quality.color + '18',
                      border: `1px solid ${engine.quality.color}40`,
                      padding:'2px 8px', borderRadius:5, lineHeight:1.4,
                    }}>
                      {engine.quality.tag}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:11, color:T.sub, lineHeight:1.4 }}>{dec.reason}</div>
                {engine.quality?.detail && (
                  <div style={{ fontSize:10, color:T.sub2, marginTop:2 }}>{engine.quality.detail}</div>
                )}
              </div>
              {dec.stopped && (
                <span style={{ fontSize:9, fontWeight:700, color:dec.color, background:dec.color+'18',
                  padding:'3px 7px', borderRadius:4, flexShrink:0, alignSelf:'flex-start' }}>
                  {dec.stopped.toUpperCase()} FILTRO
                </span>
              )}
            </div>
          </div>

          {/* Narrative — summary + action */}
          {engine.narrative && (
            <div style={{ margin:'8px 0', borderRadius:10,
              background:T.card3, border:`1px solid ${T.border2}`, overflow:'hidden' }}>
              <div style={{ padding:'7px 12px 5px', borderBottom:`1px solid ${T.border2}` }}>
                <span style={{ fontSize:9, fontWeight:700, color:T.sub2, letterSpacing:'.06em' }}>RESUMEN</span>
                <div style={{ fontSize:11.5, color:T.sub, lineHeight:1.55, marginTop:2 }}>
                  {engine.narrative.summary}
                </div>
              </div>
              <div style={{ padding:'5px 12px 7px', borderBottom: engine.narrative.invalidation ? `1px solid ${T.border2}` : 'none' }}>
                <span style={{ fontSize:9, fontWeight:700, color:T.accent, letterSpacing:'.06em' }}>ACCIÓN</span>
                <div style={{ fontSize:11.5, color:T.txt, lineHeight:1.55, marginTop:2, fontWeight:500 }}>
                  {engine.narrative.action}
                </div>
              </div>
              {engine.narrative.invalidation && (
                <div style={{ padding:'5px 12px 7px', background:'rgba(239,68,68,0.04)' }}>
                  <span style={{ fontSize:9, fontWeight:700, color:'#ef4444', letterSpacing:'.06em' }}>INVALIDACIÓN</span>
                  <div style={{ fontSize:11, color:'rgba(239,68,68,0.85)', lineHeight:1.55, marginTop:2 }}>
                    {engine.narrative.invalidation}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Decision Trace */}
          {engine.decision.trace?.length > 0 && (
            <div style={{ marginBottom:6 }}>
              <button
                onClick={() => setTraceOpen(o => !o)}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'5px 10px', borderRadius:8, border:`1px solid ${T.border2}`,
                  background:'transparent', cursor:'pointer', fontSize:10, color:T.sub2 }}>
                <span style={{ fontWeight:700, letterSpacing:'.05em' }}>🔍 TRAZABILIDAD DE DECISIÓN</span>
                <span style={{ transition:'transform 0.2s', transform:traceOpen?'rotate(180deg)':'none' }}>▾</span>
              </button>
              {traceOpen && (
                <div style={{ marginTop:3, padding:'8px 10px', borderRadius:'0 0 8px 8px',
                  background:T.card3, border:`1px solid ${T.border2}`, borderTop:'none' }}>
                  {engine.decision.trace.map((t, i) => {
                    const color = t.status==='OK'||t.status==='VÁLIDO'||t.status==='LIMPIO' ? '#22c55e'
                      : t.status==='FALLO'||t.status==='BLOQUEADO'||t.status==='LOW' ? '#ef4444'
                      : t.status==='ADVERTENCIA'||t.status==='MEDIO'||t.status==='CONDICIONAL' ? '#f59e0b'
                      : '#8b90a0';
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'3px 0',
                        borderTop:i>0?`1px solid ${T.border2}`:'none' }}>
                        <span style={{ fontSize:9, fontWeight:700, color, background:color+'15',
                          padding:'1px 5px', borderRadius:3, flexShrink:0, marginTop:1, minWidth:60, textAlign:'center' }}>
                          {t.status}
                        </span>
                        <div style={{ flex:1 }}>
                          <span style={{ fontSize:10, fontWeight:600, color:T.sub, marginRight:4 }}>{t.step}:</span>
                          <span style={{ fontSize:10, color:T.sub2 }}>{t.detail}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Liquidity target */}
          {engine.liqTarget && engine.liqTarget.target !== 'No disponible' && (
            <div style={{ marginBottom:8, padding:'6px 12px', borderRadius:9,
              background:'rgba(0,85,204,0.06)', border:'1px solid rgba(0,85,204,0.18)',
              display:'flex', alignItems:'flex-start', gap:8 }}>
              <span style={{ fontSize:14, flexShrink:0 }}>🎯</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.accent, letterSpacing:'.05em', marginBottom:2 }}>
                  OBJETIVO DE LIQUIDEZ
                </div>
                <div style={{ fontSize:11.5, color:T.txt, fontWeight:600, lineHeight:1.4 }}>
                  {engine.liqTarget.target}
                </div>
                {engine.liqTarget.detail && engine.liqTarget.detail !== engine.liqTarget.target && (
                  <div style={{ fontSize:10, color:T.sub2, marginTop:2, lineHeight:1.4 }}>
                    {engine.liqTarget.detail}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── EVIDENCE BLOCKS ─────────────────────────────────────────── */}
        <div style={{ padding:'4px 12px 10px', flex:1 }}>
          {BLOCKS.map(block => {
            const result   = results[block.key];
            const isExp    = expanded === block.key;
            const evaluated = dec.evaluated?.includes(block.key);
            const isGateTrigger = dec.stopped === block.key;
            const sColor   = !evaluated ? '#5a6070' : result.status === 'unavailable' ? '#5a6070' : (SC[result.status]||'#5a6070');
            const dimmed   = !evaluated && !isGateTrigger;

            return (
              <div key={block.key} style={{ marginBottom:4 }}>
                <button
                  onClick={() => evaluated || isGateTrigger ? setExpanded(isExp ? null : block.key) : null}
                  style={{
                    width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:10,
                    border:`1px solid ${isGateTrigger ? dec.color+'50' : isExp ? sColor+'40' : T.border2}`,
                    background: isGateTrigger ? dec.color+'08' : isExp ? sColor+'06' : T.card2,
                    cursor: evaluated || isGateTrigger ? 'pointer' : 'default',
                    display:'flex', alignItems:'center', gap:8,
                    transition:'all 0.15s', opacity: dimmed ? 0.4 : 1,
                  }}
                >
                  <span style={{ fontSize:14, flexShrink:0 }}>{block.icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ fontSize:10, fontWeight:700, color: dimmed ? T.sub2 : T.sub2, letterSpacing:'.05em' }}>
                        {block.label}
                        {isGateTrigger && <span style={{ color:dec.color, marginLeft:5 }}>← FILTRO</span>}
                      </span>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        {result.conf && evaluated && (
                          <span style={{ fontSize:9, fontWeight:600, color:CC[result.conf], background:CC[result.conf]+'12', padding:'1px 4px', borderRadius:3 }}>
                            {result.conf}
                          </span>
                        )}
                        <span style={{ fontSize:11 }}>{evaluated ? SI[result.status]||'⬜' : '⬜'}</span>
                      </div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:600, color: dimmed ? T.sub2 : T.txt, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {evaluated || isGateTrigger ? result.label : 'No evaluado'}
                    </div>
                  </div>
                  {/* Puntuación bar */}
                  {result.score != null && (evaluated || isGateTrigger) && (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2, flexShrink:0 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:sColor }}>{result.score}</span>
                      <div style={{ width:32, height:3, borderRadius:99, background:T.border, overflow:'hidden' }}>
                        <div style={{ height:'100%', borderRadius:99, width:`${result.score}%`, background:sColor }}/>
                      </div>
                    </div>
                  )}
                  {evaluated && <span style={{ fontSize:9, color:T.sub2, flexShrink:0, transition:'transform 0.2s', transform:isExp?'rotate(180deg)':'none' }}>▾</span>}
                </button>

                {/* Expanded detail */}
                {isExp && (evaluated || isGateTrigger) && (
                  <div style={{ margin:'2px 0 0', padding:'10px 12px', borderRadius:'0 0 10px 10px',
                    background:T.card3, border:`1px solid ${T.border2}`, borderTop:'none' }}>
                    <p style={{ margin:'0 0 5px', fontSize:11.5, color:T.sub, lineHeight:1.6 }}>{result.detail}</p>
                    {result.warning && (
                      <div style={{ background:'#f59e0b0f', border:'1px solid #f59e0b25', borderRadius:8, padding:'5px 9px', fontSize:11, color:'#f59e0b', lineHeight:1.5, marginBottom:5 }}>
                        ⚠ {result.warning}
                      </div>
                    )}

                    {/* Contexto: top events */}
                    {block.key==='context' && result.topEvents?.length > 0 && (
                      <div style={{ marginTop:5 }}>
                        {result.topEvents.slice(0,4).map((ev,i) => (
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:T.sub, padding:'2px 0', borderTop:i>0?`1px solid ${T.border2}`:'none' }}>
                            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{ev.name}</span>
                            <span style={{ flexShrink:0, marginLeft:8, color:ev.impact==='High'?'#ef4444':ev.impact==='Medium'?'#f59e0b':T.sub2 }}>
                              {ev.impact} · ×{ev.c}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Expectation: surprises */}
                    {block.key==='expectation' && result.surprises?.length > 0 && (
                      <div style={{ marginTop:5 }}>
                        {result.surprises.slice(0,4).map((s,i) => (
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:T.sub, padding:'2px 0', borderTop:i>0?`1px solid ${T.border2}`:'none' }}>
                            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
                              {s.name}
                              {s.adjusted && <span style={{ color:'#8b90a0', marginLeft:4 }}>(adj)</span>}
                            </span>
                            <span style={{ flexShrink:0, marginLeft:8, fontFamily:'monospace', fontSize:10 }}>
                              {s.actual} vs {s.estimate??'—'}
                              {s.deviation != null && (
                                <span style={{ color:s.dir>0?'#22c55e':s.dir<0?'#ef4444':T.sub2, marginLeft:4 }}>
                                  Δ{(s.deviation*100).toFixed(0)}%
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Dirección: bias */}
                    {block.key==='direction' && result.available && (
                      <div style={{ marginTop:5, display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:10, color:T.sub2 }}>Sesgo COT:</span>
                        <span style={{ fontSize:14, fontWeight:800, color:(result.biasPuntuación??0)>0?'#22c55e':(result.biasPuntuación??0)<0?'#ef4444':T.sub }}>
                          {result.biasPuntuación!=null ? ((result.biasPuntuación>0?'+':'')+result.biasPuntuación.toFixed(1)+' / 5') : '—'}
                        </span>
                        <span style={{ fontSize:10, color:T.sub2 }}>{result.biasLabel}</span>
                      </div>
                    )}

                    {/* Timing: breakdown + move state + price position */}
                    {block.key==='timing' && result.breakdown && (
                      <div style={{ marginTop:5 }}>
                        {/* Estado del movimiento badge */}
                        {result.moveState && (
                          <div style={{ marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ fontSize:10, color:T.sub2 }}>Estado del movimiento:</span>
                            <span style={{
                              fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                              background: result.moveState==='expansion_early' ? 'rgba(34,197,94,0.12)' :
                                          result.moveState==='expansion_late'  ? 'rgba(245,158,11,0.12)' :
                                          result.moveState==='distribution'    ? 'rgba(239,68,68,0.12)' : T.card3,
                              color: result.moveState==='expansion_early' ? '#22c55e' :
                                     result.moveState==='expansion_late'  ? '#f59e0b' :
                                     result.moveState==='distribution'    ? '#ef4444' : T.sub,
                            }}>
                              {result.moveState.replace('_',' ').toUpperCase()}
                            </span>
                            <span style={{ fontSize:10, color:T.sub2 }}>
                              {result.rangeZone === 'premium' ? '📈 Prima' : result.rangeZone === 'discount' ? '📉 Descuento' : '⚖ Equilibrio'}
                            </span>
                          </div>
                        )}
                        {[
                          ['Fuerza del sesgo (40%)',  result.breakdown.biasStrength],
                          ['Riesgo macro (20%)',     result.breakdown.macroRisk],
                          ['Volatilidad (20%)',     result.breakdown.volatility],
                          ['Sentimiento (20%)',      result.breakdown.sentiment],
                        ].map(([lbl,val]) => (
                          <div key={lbl} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                            <span style={{ fontSize:10, color:T.sub2, width:120, flexShrink:0 }}>{lbl}</span>
                            <div style={{ flex:1, height:3, borderRadius:99, background:T.border, overflow:'hidden' }}>
                              <div style={{ height:'100%', borderRadius:99, width:`${val}%`, background:T.accent }}/>
                            </div>
                            <span style={{ fontSize:10, color:T.sub, width:26, textAlign:'right' }}>{Math.round(val)}</span>
                          </div>
                        ))}
                        {result.pricePos && (
                          <div style={{ marginTop:5 }}>
                            <div style={{ padding:'4px 8px', borderRadius:7, background:T.card2, fontSize:10, color:T.sub, display:'flex', justifyContent:'space-between' }}>
                              <span>{result.pricePos.label}</span>
                              <span style={{ color:result.pricePos.adj>0?'#22c55e':result.pricePos.adj<0?'#ef4444':T.sub2, fontWeight:600 }}>
                                {result.pricePos.adj>=0?'+':''}{result.pricePos.adj} pts
                              </span>
                            </div>
                            {result.candleLoc && result.candleLoc.locationLabel !== 'Unknown' && (
                              <div style={{ marginTop:3, padding:'4px 8px', borderRadius:7,
                                background: result.candleLoc.isBreakout ? 'rgba(34,197,94,0.08)' : T.card3,
                                border: result.candleLoc.isBreakout ? '1px solid rgba(34,197,94,0.2)' : 'none',
                                fontSize:10, color: result.candleLoc.isBreakout ? '#22c55e' : T.sub2,
                                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                <span>{result.candleLoc.locationLabel}</span>
                                <span style={{ color:T.sub2 }}>
                                  {result.candleLoc.pctInRange != null ? `${Math.round(result.candleLoc.pctInRange*100)}% del rango` : ''}
                                </span>
                              </div>
                            )}
                            {result.volRegime && result.volRegime !== 'normal' && (
                              <div style={{ marginTop:3, padding:'3px 7px', borderRadius:6,
                                background: result.volRegime==='high' ? 'rgba(239,68,68,0.06)' : 'rgba(90,96,112,0.08)',
                                fontSize:10, color: result.volRegime==='high' ? '#ef4444' : T.sub2 }}>
                                Régimen de vol: {result.volRegime.toUpperCase()}
                                {result.pricePos.volBreakoutWarning && ' · Vigilar ruptura'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop:7, fontSize:10, color:T.sub2, fontStyle:'italic', lineHeight:1.4 }}>💡 {block.tip}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* FOOTER */}
        <div style={{ padding:'8px 14px 12px', borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ fontSize:10, color:T.sub2, textAlign:'center', lineHeight:1.5 }}>
            "Las mejores operaciones ocurren cuando todos los factores se alinean" — Daniel Curto / DCM FX
          </div>
        </div>
      </div>
    </>
  );
}
