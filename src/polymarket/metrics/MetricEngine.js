// =============================================================================
// POLYMARKET × COT TRACKER — METRIC ENGINE
// src/polymarket/metrics/MetricEngine.js
//
// Pure calculation functions. Stateless, testable, no side effects.
// All functions receive data, return computed metric objects.
// =============================================================================

import { GEOPOLITICAL_WEIGHTS, SLUG_GEOCATEGORY_MAP } from '../registry/registry-data.js';

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function confidenceFromOI(oi) {
  if (oi >= 500_000) return 'HIGH';
  if (oi >= 150_000) return 'MEDIUM';
  if (oi >= 50_000)  return 'LOW';
  return 'INSUFFICIENT';
}

function magnitudeFromAbsValue(value, [low, medium, high, extreme]) {
  const abs = Math.abs(value);
  if (abs >= extreme) return 'EXTREME';
  if (abs >= high)    return 'HIGH';
  if (abs >= medium)  return 'MEDIUM';
  if (abs >= low)     return 'LOW';
  return 'NEGLIGIBLE';
}

/** Weighted average respecting confidence levels */
function weightedAverage(items) {
  const CONFIDENCE_SCALE = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4, INSUFFICIENT: 0 };
  let weightedSum = 0;
  let totalWeight = 0;
  for (const { value, weight, confidence } of items) {
    if (confidence === 'INSUFFICIENT') continue;
    const w = weight * (CONFIDENCE_SCALE[confidence] ?? 0);
    weightedSum += value * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return { result: 0.5, effectiveWeight: 0 };
  return { result: weightedSum / totalWeight, effectiveWeight: totalWeight };
}

/** Simple EMA */
function ema(values, period) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let val = values[0];
  for (let i = 1; i < values.length; i++) {
    val = values[i] * k + val * (1 - k);
  }
  return val;
}

/** Rolling standard deviation */
function rollingStdDev(values) {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Get price N hours ago from history prices array */
function getPriceNHoursAgo(prices, hoursAgo) {
  const target = Date.now() - hoursAgo * 60 * 60 * 1000;
  const sorted = [...prices].sort((a, b) => b.timestamp - a.timestamp);
  return sorted.find(p => p.timestamp <= target)?.price ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONSENSUS VELOCITY (CV)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateConsensusVelocity(snapshot, history) {
  const now = snapshot.midpoint;
  const prices = history?.prices ?? [];

  const p1h  = getPriceNHoursAgo(prices, 1);
  const p24h = getPriceNHoursAgo(prices, 24);
  const p7d  = getPriceNHoursAgo(prices, 7 * 24);

  const cv1h  = p1h  !== null ? now - p1h  : 0;
  const cv24h = p24h !== null ? now - p24h : 0;
  const cv7d  = p7d  !== null ? now - p7d  : 0;

  const prices30d = prices.filter(p => p.timestamp > Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deltas30d = [];
  for (let i = 1; i < prices30d.length; i++) {
    deltas30d.push(prices30d[i].price - prices30d[i - 1].price);
  }
  const std30d = rollingStdDev(deltas30d);
  const cvNormalized24h = std30d > 0 ? cv24h / std30d : 0;

  const magnitude = magnitudeFromAbsValue(cv24h, [0.03, 0.06, 0.10, 0.15]);

  let direction = 'STABLE';
  if (Math.abs(cv24h) >= 0.03) {
    if (cv24h > 0 && cv1h >= 0)       direction = 'ACCELERATING_UP';
    else if (cv24h < 0 && cv1h <= 0)  direction = 'ACCELERATING_DOWN';
    else                               direction = 'REVERSING';
  }

  return {
    conditionId: snapshot.conditionId,
    cv1h,
    cv24h,
    cv7d,
    cvNormalized24h,
    magnitude,
    direction,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. POLICY UNCERTAINTY INDEX (PUI) — Shannon entropy
// ─────────────────────────────────────────────────────────────────────────────

export function calculatePolicyUncertaintyIndex(outcomeProbs, aggregateOI) {
  const total = Object.values(outcomeProbs).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { value: 50, rawEntropy: 0, outcomeDistribution: outcomeProbs,
             confidence: 'INSUFFICIENT', nOutcomesActive: 0, calculatedAt: Date.now() };
  }

  const normalized = Object.fromEntries(
    Object.entries(outcomeProbs).map(([k, v]) => [k, v / total])
  );
  const active = Object.values(normalized).filter(p => p > 0.01);
  const N = active.length;

  if (N <= 1) {
    return { value: 5, rawEntropy: 0, outcomeDistribution: normalized,
             confidence: confidenceFromOI(aggregateOI), nOutcomesActive: N, calculatedAt: Date.now() };
  }

  const entropy    = active.reduce((H, p) => H - p * Math.log2(p), 0);
  const maxEntropy = Math.log2(N);
  const pui        = maxEntropy > 0 ? (entropy / maxEntropy) * 100 : 0;

  return {
    value: Math.round(pui),
    rawEntropy: entropy,
    outcomeDistribution: normalized,
    confidence: confidenceFromOI(aggregateOI),
    nOutcomesActive: N,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RECESSION RISK COMPOSITE (RRC)
// ─────────────────────────────────────────────────────────────────────────────

const RECESSION_WEIGHTS = {
  currentYear:           0.45,
  nextYear:              0.28,
  negativeGDPQuarter:    0.20,
  unemploymentThreshold: 0.07,
};

export function calculateRecessionRiskComposite(markets, previousEmaValues) {
  const components = {
    currentYear:           markets.currentYear?.midpoint ?? null,
    nextYear:              markets.nextYear?.midpoint ?? null,
    negativeGDPQuarter:    markets.negativeGDPQuarter?.midpoint ?? null,
    unemploymentThreshold: markets.unemploymentThreshold?.midpoint ?? null,
  };

  const inputs = Object.entries(components)
    .filter(([, v]) => v !== null)
    .map(([key, value]) => ({
      value,
      weight:     RECESSION_WEIGHTS[key],
      confidence: confidenceFromOI(markets[key]?.openInterest ?? 0),
    }));

  if (inputs.length === 0) {
    return {
      value: 25, components, weightedRaw: 0.25, emaSmoothed: 0.25,
      confidence: 'INSUFFICIENT', delta7d: 0, regime: 'WATCH', calculatedAt: Date.now(),
    };
  }

  const { result: weightedRaw } = weightedAverage(inputs);
  const scaledRaw  = weightedRaw * 100;
  const allValues  = [...previousEmaValues, scaledRaw];
  const emaSmoothed = ema(allValues.slice(-14), 7);
  const delta7d = previousEmaValues.length >= 7
    ? emaSmoothed - previousEmaValues[previousEmaValues.length - 7]
    : 0;

  const regime =
    emaSmoothed >= 70 ? 'SEVERE'    :
    emaSmoothed >= 55 ? 'HIGH_RISK' :
    emaSmoothed >= 35 ? 'ELEVATED'  :
    emaSmoothed >= 20 ? 'WATCH'     : 'EXPANSION';

  const CONFIDENCE_ORDER = ['INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH'];
  const minConfidence = inputs.reduce((min, inp) =>
    CONFIDENCE_ORDER.indexOf(inp.confidence) < CONFIDENCE_ORDER.indexOf(min)
      ? inp.confidence : min,
    'HIGH'
  );

  return {
    value:       Math.round(emaSmoothed),
    components,
    weightedRaw,
    emaSmoothed: emaSmoothed / 100,
    confidence:  minConfidence,
    delta7d:     Math.round(delta7d * 10) / 10,
    regime,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GEOPOLITICAL TAIL RISK PULSE (GTRP)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateGeopoliticalTailRiskPulse(geoMarkets) {
  const bySubcategory = {};

  for (const market of geoMarkets) {
    const subCat = SLUG_GEOCATEGORY_MAP[market.slug];
    if (!subCat) continue;
    if (!bySubcategory[subCat]) bySubcategory[subCat] = [];

    const isInverse =
      /ceasefire|deal|agreement/i.test(market.question);
    const pEscalation = isInverse ? 1 - market.midpoint : market.midpoint;
    bySubcategory[subCat].push({ p: pEscalation, oi: market.openInterest });
  }

  const components = {
    activeConflict:      0,
    tradeWarEscalation:  0,
    nuclearSystemicRisk: 0,
    diplomaticBreakdown: 0,
  };

  const subCatToComponent = {
    active_conflict_escalation: 'activeConflict',
    trade_war_escalation:       'tradeWarEscalation',
    nuclear_systemic_risk:      'nuclearSystemicRisk',
    diplomatic_breakdown:       'diplomaticBreakdown',
  };

  for (const [subCat, mkts] of Object.entries(bySubcategory)) {
    const totalOI = mkts.reduce((s, m) => s + m.oi, 0);
    if (totalOI === 0) continue;
    const oiWeighted = mkts.reduce((s, m) => s + m.p * (m.oi / totalOI), 0);
    const comp = subCatToComponent[subCat];
    if (comp) components[comp] = oiWeighted;
  }

  const gtrp =
    components.activeConflict      * GEOPOLITICAL_WEIGHTS.active_conflict_escalation +
    components.tradeWarEscalation  * GEOPOLITICAL_WEIGHTS.trade_war_escalation +
    components.nuclearSystemicRisk * GEOPOLITICAL_WEIGHTS.nuclear_systemic_risk +
    components.diplomaticBreakdown * GEOPOLITICAL_WEIGHTS.diplomatic_breakdown;

  const componentWeighted = {
    GEOPOLITICAL: components.activeConflict      * GEOPOLITICAL_WEIGHTS.active_conflict_escalation,
    TRADE_WAR:    components.tradeWarEscalation  * GEOPOLITICAL_WEIGHTS.trade_war_escalation,
    GLOBAL_MACRO: components.nuclearSystemicRisk * GEOPOLITICAL_WEIGHTS.nuclear_systemic_risk,
    FISCAL_DEBT:  components.diplomaticBreakdown * GEOPOLITICAL_WEIGHTS.diplomatic_breakdown,
  };
  const dominantRisk = Object.entries(componentWeighted)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'GEOPOLITICAL';

  const totalOI = geoMarkets.reduce((s, m) => s + m.openInterest, 0);

  return {
    value: Math.round(gtrp * 100) / 100,
    components,
    confidence:   confidenceFromOI(totalOI / Math.max(1, geoMarkets.length)),
    dominantRisk,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. MACRO STRESS COMPOSITE (MSC)
// ─────────────────────────────────────────────────────────────────────────────

const MSC_WEIGHTS = { rrc: 0.35, gtrp: 0.30, pui: 0.20, fds: 0.15 };

export function calculateMacroStressComposite(rrc, gtrp, pui, fds, previousMSCValues) {
  const rrcScore  = rrc.value;
  const gtrpScore = gtrp.value * 100;
  const puiScore  = pui.value;
  const fdsScore  = fds ? Math.abs(fds.divergence ?? 0) * 500 : 0;

  const mscRaw =
    rrcScore  * MSC_WEIGHTS.rrc  +
    gtrpScore * MSC_WEIGHTS.gtrp +
    puiScore  * MSC_WEIGHTS.pui  +
    Math.min(fdsScore, 100) * MSC_WEIGHTS.fds;

  const allValues = [...previousMSCValues, mscRaw];
  const ema30d = ema(allValues.slice(-30), 30);
  const rce    = mscRaw - ema30d;

  const regime =
    mscRaw >= 80 ? 'EXTREME'  :
    mscRaw >= 60 ? 'HIGH'     :
    mscRaw >= 40 ? 'ELEVATED' :
    mscRaw >= 20 ? 'MODERATE' : 'LOW';

  return {
    value: Math.round(mscRaw),
    components: {
      rrc:  rrcScore,
      gtrp: gtrpScore,
      pui:  puiScore,
      fds:  Math.min(fdsScore, 100),
    },
    riskCompressionExpansion: Math.round(rce * 10) / 10,
    ema30d: Math.round(ema30d),
    regime,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NARRATIVE TRANSITION SCORE (NTS)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateNarrativeTransitionScore(snapshot, history, baselineOI, historicalNTSValues) {
  const prices = history?.prices ?? [];
  const p72hAgo = getPriceNHoursAgo(prices, 72);
  const cv72h   = p72hAgo !== null ? Math.abs(snapshot.midpoint - p72hAgo) : 0;

  const deltaOI       = Math.max(0, snapshot.openInterest - baselineOI);
  const oiGrowthFactor = Math.log(1 + deltaOI / Math.max(baselineOI, 1));
  const liquidityFactor = snapshot.spread > 0 ? 1 / snapshot.spread : 0;

  const rawScore = cv72h * oiGrowthFactor * liquidityFactor;
  const maxHistorical = historicalNTSValues.length > 0
    ? Math.max(...historicalNTSValues)
    : rawScore * 2;
  const normalized = maxHistorical > 0 ? Math.min(rawScore / maxHistorical, 1) : 0;

  return {
    conditionId: snapshot.conditionId,
    value:       Math.round(normalized * 100) / 100,
    rawScore:    Math.round(rawScore * 10000) / 10000,
    components: {
      cvMagnitude:    Math.round(cv72h * 1000) / 1000,
      oiGrowthFactor: Math.round(oiGrowthFactor * 1000) / 1000,
      liquidityFactor: Math.round(liquidityFactor * 100) / 100,
    },
    isSignificant: normalized >= 0.50,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. POLYMARKET IMPLIED SURPRISE INDEX (PISI)
// ─────────────────────────────────────────────────────────────────────────────

export function calculatePISI(beatMarket, cv, calendarEventId, economistBeatProbability) {
  const rawPISI = beatMarket.midpoint * 100;
  const confidence = confidenceFromOI(beatMarket.openInterest);

  const CONF_SCALE = { HIGH: 1.0, MEDIUM: 0.75, LOW: 0.5, INSUFFICIENT: 0 };
  const adjustedPISI = 50 + (rawPISI - 50) * (CONF_SCALE[confidence] ?? 0);
  const economistDelta = economistBeatProbability !== null
    ? rawPISI - economistBeatProbability * 100
    : null;

  const interpretation =
    adjustedPISI >= 58 ? 'EXPECTS_BEAT' :
    adjustedPISI <= 42 ? 'EXPECTS_MISS' : 'NEUTRAL';

  return {
    calendarEventId,
    conditionId:  beatMarket.conditionId,
    value:        Math.round(rawPISI),
    adjustedValue: Math.round(adjustedPISI),
    confidence,
    oiUSD:        beatMarket.openInterest,
    momentum:     cv,
    economistDelta: economistDelta !== null ? Math.round(economistDelta) : null,
    interpretation,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. FED DIVERGENCE SIGNAL (FDS)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateFedDivergenceSignal(polymarketCutMarket, meetingDate, cmeCutProbability) {
  const pmPCut    = polymarketCutMarket.midpoint;
  const divergence = cmeCutProbability !== null ? cmeCutProbability - pmPCut : null;
  const confidence = confidenceFromOI(polymarketCutMarket.openInterest);

  const isSignificant = divergence !== null &&
    Math.abs(divergence) > 0.10 &&
    (confidence === 'HIGH' || confidence === 'MEDIUM');

  let implication = '';
  if (divergence !== null) {
    if (divergence > 0.12) {
      implication = `CME pricing ${Math.round(divergence * 100)}pp más dovish que Polymarket. Futuros pueden estar sobredescontando recortes. USD podría tener soporte no reflejado en precio.`;
    } else if (divergence < -0.12) {
      implication = `Polymarket ${Math.round(Math.abs(divergence) * 100)}pp más dovish que CME. El crowd descuenta recortes antes que el mercado de futuros. Posible señal adelantada.`;
    } else {
      implication = 'Divergencia no significativa. Consenso alineado entre mercados.';
    }
  } else {
    implication = `P(cut) Polymarket: ${Math.round(pmPCut * 100)}%. CME FedWatch no disponible para comparación.`;
  }

  return {
    meetingDate,
    polymarketPCut:  pmPCut,
    cmePCut:         cmeCutProbability,
    divergence,
    isSignificant,
    confidence,
    polymarketOI:    polymarketCutMarket.openInterest,
    implication,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BIAS MODIFIER (for COT Bias Engine integration — Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateBiasModifier(instrument, rrc, gtrp, pui, fds) {
  let modifier = 0;
  const reasons = [];

  const rrcValue  = rrc.value;
  const gtrpValue = gtrp.value;
  const puiValue  = pui.value;

  const instr = instrument.toUpperCase();

  // ── USD ─────────────────────────────────────────────────────────────────
  if (instr.includes('USD') || instr === 'DXY') {
    if (rrcValue > 50) {
      const adj = -0.15 * ((rrcValue - 50) / 50);
      modifier += adj;
      if (Math.abs(adj) > 0.03) reasons.push(`RRC ${rrcValue}% → presión bajista USD`);
    }
    if (gtrpValue > 0.60) {
      const adj = 0.10 * ((gtrpValue - 0.60) / 0.40);
      modifier += adj;
      if (Math.abs(adj) > 0.02) reasons.push(`GTRP ${(gtrpValue * 100).toFixed(0)}% → soporte USD safe haven`);
    }
    if (puiValue > 70) {
      modifier *= 1 - (puiValue - 70) / 100 * 0.3;
      reasons.push(`PUI ${puiValue} → alta incertidumbre, reducción de convicción`);
    }
    if (fds?.isSignificant) {
      const div = fds.divergence ?? 0;
      if (div > 0.12)  { modifier += 0.07;  reasons.push(`FDS +${(div * 100).toFixed(0)}pp → CME más dovish, soporte USD`); }
      else if (div < -0.12) { modifier -= 0.07; reasons.push(`FDS ${(div * 100).toFixed(0)}pp → Polymarket más dovish, presión USD`); }
    }
  }

  // ── Equities ─────────────────────────────────────────────────────────────
  if (['SPX', 'NAS100', 'DOW', 'SP500'].includes(instr)) {
    if (rrcValue > 45) {
      modifier -= 0.20 * ((rrcValue - 45) / 55);
      reasons.push(`RRC ${rrcValue}% → cautela en renta variable`);
    }
    if (gtrpValue > 0.55) {
      modifier -= 0.10;
      reasons.push(`GTRP ${(gtrpValue * 100).toFixed(0)}% → riesgo de cola geopolítico`);
    }
  }

  // ── Gold ──────────────────────────────────────────────────────────────────
  if (instr === 'XAUUSD' || instr === 'GOLD') {
    if (gtrpValue > 0.55) {
      modifier += 0.12 * ((gtrpValue - 0.55) / 0.45);
      reasons.push(`GTRP ${(gtrpValue * 100).toFixed(0)}% → demanda de oro como safe haven`);
    }
    if (rrcValue > 40) {
      modifier += 0.10 * ((rrcValue - 40) / 60);
      reasons.push(`RRC ${rrcValue}% → flight to quality confirma bid en oro`);
    }
  }

  // ── Treasuries ────────────────────────────────────────────────────────────
  if (instr === 'US10Y' || instr === 'BONDS') {
    if (fds !== null && (fds.divergence ?? 0) < -0.10) {
      modifier += 0.12;
      reasons.push('Polymarket más dovish que CME → refuerza rally en treasuries');
    }
    if (rrcValue > 40) {
      modifier += 0.10 * ((rrcValue - 40) / 60);
      reasons.push(`RRC ${rrcValue}% → flight to quality, bid en bonos`);
    }
  }

  // Hard cap: Polymarket cannot invert a COT signal. Max ±25%
  modifier = Math.max(-0.25, Math.min(0.25, modifier));

  const CONF_SCALE = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4, INSUFFICIENT: 0 };
  const avgConfidence = (
    (CONF_SCALE[rrc.confidence] ?? 0) +
    (CONF_SCALE[gtrp.confidence] ?? 0)
  ) / 2;

  return {
    modifier:  Math.round(modifier * 1000) / 1000,
    confidence: avgConfidence,
    narrative: reasons.length > 0 ? reasons.join(' · ') : 'Sin señal Polymarket significativa',
  };
}
