/**
 * compositeScoreEngine.js — Motor de Inferencia Contextual Multicapa v2.2
 *
 * v2.2 — Integración de velas reales (priceCandles):
 *   - derivarDireccionPro(): analiza últimas 3 velas OHLC reales
 *   - derivarDireccionTecnica(): jerarquía de fuentes sin inventar dirección
 *   - buildCompositeScore(): acepta priceCandles como 5º argumento
 *   - Si priceCandles.length < 3: scoreT=0, estado=MIXTO (sin inventar)
 *
 * Jerarquía de fuentes para scoreT:
 *   1. Velas reales de Finnhub REST (price_pro)   ← más fiable
 *   2. dynamicDirection API si no es neutral (api)
 *   3. Sin datos → marketDir=0, scoreT=0          ← nunca inventar
 */

import { getStats, updateHistory } from './data/historicalStore.js';
import { getWeights }              from './config/indicatorWeights.js';
import { detectLiquidityZones, detectSweep } from './logic/liquidityEngine.js';

// ── Utilidades ────────────────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function sign(v)  { return v > 0 ? 1 : v < 0 ? -1 : 0; }

function labelFromScore(s) {
  if (s >  60) return 'Muy Alcista';
  if (s >  25) return 'Alcista';
  if (s > -25) return 'Neutro';
  if (s > -60) return 'Bajista';
  return 'Muy Bajista';
}

function colorFromScore(s) {
  if (s >  25) return '#22c55e';
  if (s < -25) return '#ef4444';
  return '#f59e0b';
}

// ── GUARD 0: FAT TAIL ─────────────────────────────────────────────────────────
function checkFatTail(evType, surprisePct, sigmaThreshold) {
  if (typeof surprisePct !== 'number' || !isFinite(surprisePct)) {
    return { fatTail: false, zScore: null };
  }
  const stats = getStats(evType);
  if (!stats) return { fatTail: false, zScore: null };
  const zScore  = (surprisePct - stats.mean) / stats.std;
  const fatTail = Math.abs(zScore) >= sigmaThreshold;
  return { fatTail, zScore: parseFloat(zScore.toFixed(2)) };
}

// ── MOTOR PRO DE VELAS ─────────────────────────────────────────────────────────
/**
 * derivarDireccionPro — analiza las últimas N velas OHLC y devuelve
 * dirección, intensidad y confianza basadas en datos reales.
 *
 * Requiere mínimo 2 velas (preferible 3).
 * Si hay menos de 2 → retorna marketDir=0 (sin datos).
 *
 * @param {Array<{open,high,low,close}>} priceCandles
 * @returns {{ marketDir: number, intensidad: number, confianza: number }}
 */
function derivarDireccionPro(priceCandles) {
  if (!Array.isArray(priceCandles) || priceCandles.length < 1) {
    return { marketDir: 0, intensidad: 0, confianza: 0 };
  }

  if (priceCandles.length === 1) {
    const c = priceCandles[0];
    const delta = c.close - c.open;
    return {
      marketDir:  delta > 0 ? 1 : delta < 0 ? -1 : 0,
      intensidad: Math.abs(delta) / Math.max(c.high - c.low, 0.0001),
      confianza:  0.5,
    };
  }

  const candles = priceCandles.slice(-3);

  let directionScore = 0;
  let totalRange     = 0;
  let totalBody      = 0;

  for (const c of candles) {
    const delta = c.close - c.open;
    const range = Math.max(c.high - c.low, 0.0001);
    totalRange += range;
    totalBody  += Math.abs(delta);
    if (delta > 0) directionScore += 1;
    if (delta < 0) directionScore -= 1;
  }

  const marketDir    = directionScore > 0 ? 1 : directionScore < 0 ? -1 : 0;
  const intensidad   = clamp(totalRange > 0 ? totalBody / totalRange : 0, 0, 1);
  const consistencia = Math.abs(directionScore) / candles.length;
  const confianza    = clamp((intensidad * 0.6) + (consistencia * 0.4), 0, 1);

  return { marketDir, intensidad, confianza };
}

// ── DERIVAR DIRECCIÓN TÉCNICA (jerarquía de fuentes) ─────────────────────────
/**
 * Jerarquía:
 *   1. Velas reales (priceCandles.length >= 2) → derivarDireccionPro
 *   2. dynamicDirection del API si NO es neutral
 *   3. Sin datos → marketDir=0 (NUNCA inventar dirección)
 *
 * ❌ PROHIBIDO usar fundamentalScore como proxy de dirección.
 */
function derivarDireccionTecnica(event, priceCandles) {
  // Fuente 1: velas reales
  if (Array.isArray(priceCandles) && priceCandles.length >= 1) {
    const pro = derivarDireccionPro(priceCandles);
    if (pro.marketDir !== 0) {
      return {
        marketDir:   pro.marketDir,
        intensidad:  clamp(pro.intensidad * pro.confianza, 0, 1),
        sourceLabel: 'price_pro',
      };
    }
  }

  // Fuente 2: dynamicDirection explícito del API (no neutral)
  const dynScore     = typeof event?.dynamicScore === 'number' ? event.dynamicScore : 0;
  const dynDirection = event?.dynamicDirection ?? 'neutral';
  const intensidad   = clamp(dynScore / 10, 0, 1);

  if (dynDirection === 'bullish') return { marketDir: 1,  intensidad, sourceLabel: 'api' };
  if (dynDirection === 'bearish') return { marketDir: -1, intensidad, sourceLabel: 'api' };

  // Fuente 3: sin datos → scoreT = 0
  return { marketDir: 0, intensidad: 0, sourceLabel: 'no_market_data' };
}

// ── CAPA 2: PRICED-IN DETECTOR ────────────────────────────────────────────────
function calcularDescuento(scoreFundamental, event, surprisePct, pricedInThreshold, maxReduction) {
  const dynScore     = typeof event?.dynamicScore === 'number' ? event.dynamicScore : 0;
  const dynDirection = event?.dynamicDirection ?? 'neutral';

  // Caso A: dirección explícita contradice fundamental
  if (dynDirection !== 'neutral') {
    const dynDir     = dynDirection === 'bullish' ? 1 : -1;
    const contradice = sign(dynDir) !== sign(scoreFundamental);
    if (contradice && dynScore >= pricedInThreshold) {
      const reduccion = clamp(
        ((dynScore - pricedInThreshold) / (10 - pricedInThreshold)) * maxReduction,
        0, maxReduction
      );
      return {
        scoreC:        clamp(Math.round(scoreFundamental * (1 - reduccion)), -100, 100),
        coefDescuento: parseFloat(reduccion.toFixed(3)),
        pricedIn:      true,
      };
    }
  }

  // Caso B: dynScore extremo con sorpresa pequeña → dato esperado
  if (dynScore >= 8 && Math.abs(surprisePct ?? 0) < 1.0) {
    const reduccion = clamp(((dynScore - 8) / 2) * 0.35, 0, 0.35);
    return {
      scoreC:        clamp(Math.round(scoreFundamental * (1 - reduccion)), -100, 100),
      coefDescuento: parseFloat(reduccion.toFixed(3)),
      pricedIn:      true,
    };
  }

  return { scoreC: scoreFundamental, coefDescuento: 0, pricedIn: false };
}

// ── CAPA 3: SCORE TÉCNICO ─────────────────────────────────────────────────────
function calcularScoreTecnico(event, priceCandles) {
  const { marketDir, intensidad, sourceLabel } = derivarDireccionTecnica(event, priceCandles);
  if (marketDir === 0) return { scoreT: 0, techDirection: 0, sourceLabel };
  return {
    scoreT:        clamp(Math.round(marketDir * intensidad * 100), -100, 100),
    techDirection: marketDir,
    sourceLabel,
  };
}

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────────────────────────
/**
 * buildCompositeScore — Motor de Inferencia Contextual Multicapa
 *
 * @param {number}      fundamentalScore  — biasScore de marketLogic [-100, +100]
 * @param {object}      event             — objeto del evento (con dynamic*)
 * @param {string}      evType            — tipo de indicador ("OIL", "CPI"...)
 * @param {number|null} surprisePct       — sorpresa porcentual
 * @param {Array}       priceCandles      — velas OHLC reales de Finnhub (puede ser [])
 */
export function buildCompositeScore(fundamentalScore, event, evType, surprisePct, priceCandles = []) {
  if (typeof surprisePct === 'number' && isFinite(surprisePct) && evType) {
    updateHistory(evType, surprisePct);
  }

  const cfg = getWeights(evType);

  // Guard 0: Fat Tail
  const { fatTail, zScore } = checkFatTail(evType, surprisePct, cfg.fatTailSigma);
  if (fatTail) {
    return {
      sesgoCompuesto: 0, label: 'Extrema Volatilidad', color: '#ef4444',
      estado: 'FAT_TAIL', semaforo: 'ROJO', bloqueoSenal: true,
      scoreF: fundamentalScore, scoreC: 0, scoreT: 0,
      fatTailDetected: true, zScore, coefDescuento: 0, pricedIn: false,
      desglose: {
        F: { score: fundamentalScore, weight: cfg.W1 },
        C: { score: 0, weight: cfg.W2, pricedIn: false, coef: 0 },
        T: { score: 0, weight: cfg.W3, sourceLabel: 'fat_tail_suspended' },
        formula: `FAT TAIL (z=${zScore}) — Análisis suspendido`,
      },
    };
  }

  // Capa 1
  const scoreF = clamp(fundamentalScore, -100, 100);

  // Capa 2: priced-in (usa event, no priceCandles)
  const { scoreC, coefDescuento, pricedIn } = calcularDescuento(
    scoreF, event, surprisePct, cfg.pricedInThreshold, cfg.pricedInMaxReduction
  );

  // Capa 3: técnico desde velas reales
  const { scoreT: scoreTBase, techDirection, sourceLabel } = calcularScoreTecnico(event, priceCandles);

  // Ajuste institucional: barrida de liquidez (SMC)
  // scoreLiquidity separado de scoreTBase para facilitar escalabilidad futura
  let scoreLiquidity = 0;

  if (Array.isArray(priceCandles) && priceCandles.length >= 5) {
    const zones = detectLiquidityZones(priceCandles);
    const sweep = detectSweep(priceCandles, zones);

    if (sweep?.type === 'sweep_low')  scoreLiquidity =  20;
    if (sweep?.type === 'sweep_high') scoreLiquidity = -20;
  }

  let scoreT = clamp(scoreTBase + scoreLiquidity, -100, 100);

  // Sesgo compuesto
  const raw = (scoreF * cfg.W1) + (scoreC * cfg.W2) + (scoreT * cfg.W3);
  const sesgoCompuesto = clamp(Math.round(raw), -100, 100);

  // Guard: Divergencia
  const esDivergencia = (
    sign(scoreF) !== sign(scoreT) &&
    scoreT !== 0 &&
    Math.abs(scoreT) > 30 &&
    Math.abs(scoreF) > 40
  );

  let estado, semaforo, bloqueoSenal;
  if (esDivergencia) {
    estado = 'DIVERGENCIA'; semaforo = 'ROJO'; bloqueoSenal = true;
  } else if (scoreT === 0) {
    // Sin datos de precio real — el sistema lo admite explícitamente
    estado = 'MIXTO'; semaforo = 'AMARILLO'; bloqueoSenal = false;
  } else if (sign(scoreF) === sign(scoreT)) {
    estado = 'COHERENTE'; semaforo = 'VERDE'; bloqueoSenal = false;
  } else {
    estado = 'MIXTO'; semaforo = 'AMARILLO'; bloqueoSenal = false;
  }

  return {
    sesgoCompuesto,
    label:           labelFromScore(sesgoCompuesto),
    color:           colorFromScore(sesgoCompuesto),
    estado,
    semaforo,
    bloqueoSenal,
    scoreF,
    scoreC,
    scoreT,
    fatTailDetected: false,
    zScore,
    coefDescuento,
    pricedIn,
    techDirection,
    desglose: {
      F: { score: scoreF,  weight: cfg.W1 },
      C: { score: scoreC,  weight: cfg.W2, pricedIn, coef: coefDescuento },
      T: { score: scoreT,  weight: cfg.W3, sourceLabel },
      formula: `(${scoreF}×${cfg.W1}) + (${scoreC}×${cfg.W2}) + (${scoreT}×${cfg.W3}) = ${sesgoCompuesto}`,
    },
  };
}
