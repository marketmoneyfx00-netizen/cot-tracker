// =============================================================================
// POLYMARKET × COT TRACKER — CRYPTO METRIC ENGINE
// src/polymarket/crypto/CryptoMetrics.js
//
// Computes three institutional crypto intelligence composites:
//
//   CRR  — Crypto Regulatory Regime (0–100)
//          Higher = more regulatory risk/uncertainty.
//          Informs: macroConfidence for crypto-adjacent FX (AUD, risk pairs),
//          contributes to MSC when regime is HIGH_RISK or UNCERTAIN.
//
//   CESI — Crypto Establishment Sentiment Index (0–100)
//          Higher = more institutional embrace (ETF flows, SEC approvals).
//          Informs: risk appetite signal, not a directional FX indicator.
//
//   SSI  — Stablecoin Stress Index (0–1)
//          Higher = systemic stablecoin risk (depeg, regulatory shutdown).
//          Informs: tail-risk overlay. Elevated SSI → treat as GTRP equivalent
//          for safe-haven positioning (DXY, JPY, CHF, Gold).
//
// CRITICAL: None of these replace COT signals. They only modulate confidence
// and provide macro context. They do NOT predict BTC/ETH prices.
// =============================================================================

const CONF_FROM_OI_THRESHOLDS = [
  [100_000, 'HIGH'],
  [ 30_000, 'MEDIUM'],
  [ 10_000, 'LOW'],
];

function confFromOI(oi) {
  for (const [threshold, grade] of CONF_FROM_OI_THRESHOLDS) {
    if (oi >= threshold) return grade;
  }
  return 'INSUFFICIENT';
}

const CONF_MULT = { HIGH: 1.0, MEDIUM: 0.75, LOW: 0.45, INSUFFICIENT: 0 };

function oiWeightedAverage(markets) {
  const totalOI = markets.reduce((s, m) => s + (m.openInterest ?? 0), 0);
  if (totalOI === 0) return null;
  return markets.reduce((s, m) => s + m.midpoint * ((m.openInterest ?? 0) / totalOI), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRR — Crypto Regulatory Regime (0–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} regulationMarkets - snapshots with category CRYPTO_REGULATION
 * @returns {{ value: number, regime: string, confidence: string, drivers: object[], explanation: string }}
 */
export function calculateCryptoRegulatoryRegime(regulationMarkets) {
  const fallback = {
    value: 50, regime: 'NEUTRAL', confidence: 'INSUFFICIENT',
    drivers: [], explanation: 'Sin datos de mercados de regulación crypto.',
    calculatedAt: Date.now(),
  };

  if (!regulationMarkets?.length) return fallback;

  const drivers = [];
  let weightedRisk  = 0;
  let totalWeight   = 0;

  for (const m of regulationMarkets) {
    if ((m.openInterest ?? 0) < 5_000) continue;
    if (m.midpoint <= 0 || m.midpoint >= 1) continue;

    const conf = confFromOI(m.openInterest);
    if (conf === 'INSUFFICIENT') continue;

    const rawWeight = (m.compositeWeight ?? 0.33) * (CONF_MULT[conf] ?? 0);

    // Markets where YES = regulatory clarity → higher probability = LOWER regime risk.
    // Markets where YES = uncertain political event → probability irrelevant to direction.
    const riskReducing = m.riskReducing ?? false;
    const riskScore    = riskReducing ? (1 - m.midpoint) : m.midpoint;

    weightedRisk += riskScore * rawWeight;
    totalWeight  += rawWeight;

    drivers.push({
      slug:         m.slug,
      probability:  Math.round(m.midpoint * 100),
      riskScore:    Math.round(riskScore * 100),
      riskReducing,
      weight:       Math.round(rawWeight * 100) / 100,
    });
  }

  if (totalWeight === 0) return fallback;

  const crr = Math.round((weightedRisk / totalWeight) * 100);

  const regime =
    crr >= 75 ? 'HIGH_RISK'  :
    crr >= 55 ? 'UNCERTAIN'  :
    crr >= 35 ? 'NEUTRAL'    :
    crr >= 15 ? 'CLEARING'   : 'FAVORABLE';

  const avgOI = regulationMarkets.reduce((s, m) => s + (m.openInterest ?? 0), 0)
    / regulationMarkets.length;

  const explanation = _buildCRRExplanation(crr, regime, drivers);

  return {
    value: crr,
    regime,
    confidence: confFromOI(avgOI),
    drivers,
    explanation,
    calculatedAt: Date.now(),
  };
}

function _buildCRRExplanation(crr, regime, drivers) {
  const regimePhrases = {
    HIGH_RISK:  'Régimen regulatorio crypto de alto riesgo',
    UNCERTAIN:  'Marco regulatorio crypto incierto',
    NEUTRAL:    'Régimen crypto neutral',
    CLEARING:   'Claridad regulatoria emergiendo',
    FAVORABLE:  'Entorno regulatorio crypto favorable',
  };
  const base = regimePhrases[regime] ?? 'Régimen crypto desconocido';
  const topDriver = drivers.sort((a, b) => Math.abs(b.riskScore - 50) - Math.abs(a.riskScore - 50))[0];
  if (!topDriver) return `${base} (CRR=${crr}).`;
  return `${base} (CRR=${crr}). Driver principal: ${topDriver.slug} (riesgo=${topDriver.riskScore}pp).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CESI — Crypto Establishment Sentiment Index (0–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} etfMarkets - snapshots with category CRYPTO_ETF
 * @returns {{ value: number, trend: string, confidence: string, explanation: string }}
 */
export function calculateCryptoETFSignal(etfMarkets) {
  const fallback = {
    value: 50, trend: 'NEUTRAL', confidence: 'INSUFFICIENT',
    explanation: 'Sin datos de mercados ETF crypto.',
    calculatedAt: Date.now(),
  };

  if (!etfMarkets?.length) return fallback;

  const valid = etfMarkets.filter(m =>
    (m.openInterest ?? 0) >= 5_000 && m.midpoint > 0 && m.midpoint < 1
  );
  if (valid.length === 0) return fallback;

  const avg = oiWeightedAverage(valid);
  if (avg === null) return fallback;

  const cesi = Math.round(avg * 100);
  const trend =
    cesi >= 70 ? 'STRONG_INSTITUTIONAL_EMBRACE' :
    cesi >= 55 ? 'MILD_ADOPTION'                :
    cesi >= 40 ? 'CAUTIOUS'                     : 'INSTITUTIONAL_SKEPTICISM';

  const totalOI = valid.reduce((s, m) => s + (m.openInterest ?? 0), 0);

  const trendPhrases = {
    STRONG_INSTITUTIONAL_EMBRACE: 'Fuerte abrazo institucional a crypto',
    MILD_ADOPTION:                'Adopción institucional moderada',
    CAUTIOUS:                     'Postura institucional cautelosa',
    INSTITUTIONAL_SKEPTICISM:     'Escepticismo institucional crypto',
  };
  const explanation = `${trendPhrases[trend]} (CESI=${cesi}). ${valid.length} mercados ETF activos.`;

  return {
    value: cesi,
    trend,
    confidence: confFromOI(totalOI / valid.length),
    etfMarketCount: valid.length,
    explanation,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SSI — Stablecoin Stress Index (0–1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} stablecoinMarkets - snapshots with category CRYPTO_STABLECOIN
 * @returns {{ value: number, risk: string, confidence: string, explanation: string }}
 */
export function calculateStablecoinStress(stablecoinMarkets) {
  const fallback = {
    value: 0, risk: 'MINIMAL', confidence: 'INSUFFICIENT',
    explanation: 'Sin datos de mercados de stablecoin.',
    calculatedAt: Date.now(),
  };

  if (!stablecoinMarkets?.length) return fallback;

  const valid = stablecoinMarkets.filter(m =>
    (m.openInterest ?? 0) >= 5_000 && m.midpoint > 0 && m.midpoint < 1
  );
  if (valid.length === 0) return fallback;

  // Higher midpoint = market prices higher depeg probability = higher stress
  const ssiRaw = oiWeightedAverage(valid);
  if (ssiRaw === null) return fallback;

  const ssi = Math.round(ssiRaw * 1000) / 1000;

  const risk =
    ssi >= 0.20 ? 'SEVERE'   :
    ssi >= 0.10 ? 'ELEVATED' :
    ssi >= 0.05 ? 'WATCH'    : 'MINIMAL';

  const totalOI = valid.reduce((s, m) => s + (m.openInterest ?? 0), 0);

  const riskPhrases = {
    SEVERE:   'Estrés severo en stablecoins sistémico',
    ELEVATED: 'Riesgo de depeg elevado en stablecoins',
    WATCH:    'Vigilancia sobre stablecoins activa',
    MINIMAL:  'Stablecoins estables',
  };
  const explanation =
    `${riskPhrases[risk]} (SSI=${(ssi * 100).toFixed(1)}%). ` +
    `${valid.length} stablecoin${valid.length > 1 ? 's' : ''} monitoreada${valid.length > 1 ? 's' : ''}.`;

  return {
    value: ssi,
    risk,
    confidence: confFromOI(totalOI),
    stablecoinCount: valid.length,
    explanation,
    calculatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto Macro Overlay — how CRR/CESI/SSI affect macro regime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a modifier (-1 to +1) to apply to macroConfidence for crypto-sensitive instruments.
 * Does NOT directly affect pair direction — only confidence/conviction.
 *
 * Crypto-sensitive pairs: AUD, NZD (risk-on), JPY, CHF (safe haven from crypto stress),
 * XAU (gold bid on SSI spike), DXY (safe haven from SSI/CRR shock).
 *
 * @param {string} instrument
 * @param {{ crr: object, cesi: object, ssi: object }} cryptoMetrics
 * @returns {{ confidenceAdj: number, narrative: string }}
 */
export function cryptoMacroOverlay(instrument, cryptoMetrics) {
  const { crr, cesi, ssi } = cryptoMetrics;
  if (!crr && !ssi) return { confidenceAdj: 0, narrative: null };

  const instr     = instrument.toUpperCase();
  let   confAdj   = 0;
  const reasons   = [];

  const crrValue  = crr?.value  ?? 50;
  const ssiValue  = ssi?.value  ?? 0;
  const cesiValue = cesi?.value ?? 50;

  // Risk-on FX: AUD, NZD benefit from crypto clarity, hurt by regulation risk
  if (/AUD|NZD/.test(instr)) {
    if (crrValue >= 65) {
      const adj = -0.08 * ((crrValue - 65) / 35);
      confAdj += adj;
      reasons.push(`CRR=${crrValue} → régimen regulatorio crypto incide en AUD/NZD`);
    }
    if (ssiValue >= 0.10) {
      confAdj -= 0.06;
      reasons.push(`SSI=${(ssiValue * 100).toFixed(0)}% → estrés stablecoin amplifica riesgo AUD/NZD`);
    }
  }

  // Safe haven: JPY, CHF, Gold benefit from crypto systemic stress
  if (/JPY|CHF|XAU|GOLD/.test(instr)) {
    if (ssiValue >= 0.10) {
      confAdj += 0.05 * (ssiValue / 0.20);
      reasons.push(`SSI elevado → bid en activos safe haven`);
    }
    if (crrValue >= 70) {
      confAdj += 0.04;
      reasons.push(`CRR=${crrValue} → incertidumbre regulatoria apoya safe haven`);
    }
  }

  // DXY: institutional crypto embrace can be mild DXY headwind (capital out of USD)
  if (instr === 'DXY' || instr.includes('USD')) {
    if (cesiValue >= 70) {
      confAdj -= 0.04;
      reasons.push(`CESI=${cesiValue} → capital institucional rotando hacia crypto (leve DXY headwind)`);
    }
    if (ssiValue >= 0.15) {
      confAdj += 0.06;
      reasons.push(`SSI=${(ssiValue * 100).toFixed(0)}% → flight to USD en crisis stablecoin`);
    }
  }

  // Hard cap: crypto overlay cannot move confidence by more than ±10pp
  confAdj = Math.max(-0.10, Math.min(0.10, confAdj));

  return {
    confidenceAdj: Math.round(confAdj * 1000) / 1000,
    narrative: reasons.length > 0 ? reasons.join(' · ') : null,
  };
}
