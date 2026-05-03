function buildMacroSignal({ spreads, direction, momentum }, yields) {
  const { US_DE, US_UK, US_JP } = direction;

  // Only count pairs where spread data actually exists
  const validDirections = [
    spreads.US_DE != null ? US_DE : null,
    spreads.US_UK != null ? US_UK : null,
    spreads.US_JP != null ? US_JP : null,
  ].filter(Boolean);

  const risingCount  = validDirections.filter(d => d === 'up').length;
  const fallingCount = validDirections.filter(d => d === 'down').length;
  const totalValid   = validDirections.length;

  let bias;
  if (totalValid === 0) {
    bias = 'NEUTRAL';
  } else if (risingCount === totalValid) {
    bias = totalValid === 3 ? 'USD_STRONG' : 'USD_LEANING_STRONG';
  } else if (fallingCount === totalValid) {
    bias = totalValid === 3 ? 'USD_WEAK' : 'USD_LEANING_WEAK';
  } else if (risingCount >= 2) {
    bias = 'USD_LEANING_STRONG';
  } else if (fallingCount >= 2) {
    bias = 'USD_LEANING_WEAK';
  } else {
    bias = 'NEUTRAL';
  }

  // Confidence — only score pairs with confirmed data
  let confidence = 0;

  if (spreads.US_DE != null && US_DE === 'up') confidence += 2;
  if (spreads.US_JP != null && US_JP === 'up') confidence += 2;

  const momValues = [momentum.US_DE, momentum.US_JP, momentum.US_UK]
    .filter(m => m !== null && m !== undefined);
  const momSum = momValues.reduce((a, b) => a + b, 0);
  if (momValues.length > 0 && momSum > 0) confidence += 2;

  const absDE = spreads.US_DE != null ? Math.abs(spreads.US_DE) : 0;
  const absJP = spreads.US_JP != null ? Math.abs(spreads.US_JP) : 0;
  if (absDE > 1.5 || absJP > 2.5) confidence += 1;

  const us10yCur = yields.US10Y?.current ?? null;
  const us2yCur  = yields.US2Y?.current  ?? null;
  if (us10yCur !== null && us2yCur !== null && (us10yCur - us2yCur) > 0.5) confidence += 1;

  if (spreads.US_UK != null && US_UK === 'down') confidence -= 1;
  if (spreads.US_DE != null && US_DE === 'down') confidence -= 1;

  confidence = Math.max(0, Math.min(10, Math.round(confidence)));

  // Drivers — only for pairs with real spread values
  const drivers = [];

  if (spreads.US_DE != null) {
    const arrow  = US_DE === 'up' ? '↑' : US_DE === 'down' ? '↓' : '→';
    const mom    = momentum.US_DE;
    const momStr = mom !== null ? ` (Δ ${mom >= 0 ? '+' : ''}${mom.toFixed(2)}%)` : '';
    drivers.push(`US-DE spread ${arrow} ${spreads.US_DE.toFixed(2)}%${momStr}`);
  }
  if (spreads.US_JP != null) {
    const arrow  = US_JP === 'up' ? '↑' : US_JP === 'down' ? '↓' : '→';
    const mom    = momentum.US_JP;
    const momStr = mom !== null ? ` (Δ ${mom >= 0 ? '+' : ''}${mom.toFixed(2)}%)` : '';
    drivers.push(`US-JP spread ${arrow} ${spreads.US_JP.toFixed(2)}%${momStr}`);
  }
  if (spreads.US_UK != null) {
    const arrow  = US_UK === 'up' ? '↑' : US_UK === 'down' ? '↓' : '→';
    const mom    = momentum.US_UK;
    const momStr = mom !== null ? ` (Δ ${mom >= 0 ? '+' : ''}${mom.toFixed(2)}%)` : '';
    drivers.push(`US-UK spread ${arrow} ${spreads.US_UK.toFixed(2)}%${momStr}`);
  }

  const implication  = _buildImplication(bias, spreads, yields);
  const chinaContext = _buildChinaContext(yields.CN10Y?.current ?? null, us10yCur);

  return { bias, confidence, drivers, implication, chinaContext };
}

function _buildImplication(bias, spreads, yields) {
  switch (bias) {
    case 'USD_STRONG':
      return [
        'Rising US yield advantage over EUR, GBP and JPY is attracting capital into USD-denominated assets.',
        spreads.US_JP != null && spreads.US_JP > 2
          ? `US-Japan spread at ${spreads.US_JP.toFixed(2)}% supports USDJPY upside via carry trade flows.` : null,
        spreads.US_DE != null && spreads.US_DE > 1
          ? `US-German spread at ${spreads.US_DE.toFixed(2)}% creates downside pressure on EURUSD.` : null,
      ].filter(Boolean).join(' ');
    case 'USD_LEANING_STRONG':
      return 'Majority of yield spreads are widening in favor of the USD. Watch for confirmation across all three pairs before committing to directional USD longs.';
    case 'USD_WEAK':
      return 'US yield advantage is eroding across all major pairs. Expect capital rotation away from USD. EURUSD and GBPUSD may see upside; USDJPY carry unwind is a risk.';
    case 'USD_LEANING_WEAK':
      return 'Most spreads narrowing against USD. Neutral-to-cautious on USD strength; await clearer divergence.';
    default:
      return 'Mixed yield signals across G4 pairs. No clear macro directional edge at this time. Await broader spread convergence before establishing carry positions.';
  }
}

function _buildChinaContext(cn10yCur, us10yCur) {
  if (cn10yCur == null) {
    return 'China 10Y yield data unavailable from FRED. No Asian macro pressure signal generated.';
  }
  if (us10yCur == null) {
    return `China 10Y yield stands at ${cn10yCur.toFixed(2)}%. Context only — not weighted in spread signals.`;
  }
  const diff = parseFloat((us10yCur - cn10yCur).toFixed(2));
  if (diff > 1) {
    return `China 10Y at ${cn10yCur.toFixed(2)}% vs US at ${us10yCur.toFixed(2)}% (spread: +${diff}%). US offers a significant yield premium over CNY. This reduces PBoC pressure to defend the yuan aggressively and limits external macro stress from Asia.`;
  }
  if (diff < -0.5) {
    return `China 10Y at ${cn10yCur.toFixed(2)}% — above US equivalents. This unusual dynamic may reflect capital controls and domestic demand for sovereign debt rather than macro strength. Monitor for CNH appreciation pressure.`;
  }
  return `China yields remain stable at ${cn10yCur.toFixed(2)}%, suggesting limited external macro pressure from Asia. PBoC posture appears accommodative, supporting global risk appetite at the margin.`;
}

module.exports = { buildMacroSignal };
