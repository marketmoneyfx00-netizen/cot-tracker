/**
 * liquidityEngine.js — Detección de zonas de liquidez institucional (SMC)
 *
 * detectLiquidityZones: detecta Equal Highs (EQH) y Equal Lows (EQL)
 * detectSweep:          detecta barrida de liquidez (rompe nivel, cierra dentro)
 *
 * Sin dependencias. Sin estado. Funciones puras.
 */

export function detectLiquidityZones(candles) {
  const zones = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c    = candles[i];
    const prev = candles[i - 1];
    const next = candles[i + 1];

    // Tolerancia dinámica: 0.01% del precio — adaptable a Forex, índices, oro, crypto
    const tolerance = c.close * 0.0001;

    if (
      Math.abs(c.high - prev.high) < tolerance &&
      Math.abs(c.high - next.high) < tolerance
    ) {
      zones.push({ type: 'EQH', price: c.high, index: i });
    }

    if (
      Math.abs(c.low - prev.low) < tolerance &&
      Math.abs(c.low - next.low) < tolerance
    ) {
      zones.push({ type: 'EQL', price: c.low, index: i });
    }
  }

  return zones;
}

export function detectSweep(candles, zones) {
  const last = candles[candles.length - 1];

  for (const z of zones) {
    if (z.type === 'EQH' && last.high > z.price && last.close < z.price) {
      return { type: 'sweep_high', zone: z };
    }

    if (z.type === 'EQL' && last.low < z.price && last.close > z.price) {
      return { type: 'sweep_low', zone: z };
    }
  }

  return null;
}
