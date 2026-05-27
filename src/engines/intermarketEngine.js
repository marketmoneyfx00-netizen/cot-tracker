/**
 * intermarketEngine.js — Institutional Intermarket Analysis Engine v1.0
 *
 * Derives cross-asset correlation signals from available COT positioning data.
 * Detects hidden divergences, correlation breakdowns, and institutional transitions.
 *
 * Cross-asset pairs analyzed:
 *   DXY ↔ Gold          (classically inverse — breakdown = macro dislocation)
 *   DXY ↔ Oil           (inverse — USD strength = commodity pressure)
 *   Gold ↔ Bonds        (both safe havens — should move together in RISK_OFF)
 *   Equities ↔ Bonds    (inverse — flight to quality detector)
 *   Gold ↔ Real Yields  (inverse — key inflation/deflation signal)
 *   BTC ↔ DXY           (crypto inversely correlated to USD)
 *   Equities ↔ Oil      (demand-driven growth signal)
 *   Gold ↔ Equities     (divergence = macro uncertainty or regime transition)
 *
 * Signal types:
 *   ALIGNED    — assets moving as expected per historical relationship
 *   DIVERGING  — assets breaking historical correlation — institutional signal
 *   BREAKDOWN  — severe correlation breakdown — regime change risk
 *   NEUTRAL    — insufficient data or no clear signal
 *
 * All computation pure — no API calls, no side effects.
 */

// ─── RELATIONSHIP DEFINITIONS ─────────────────────────────────────────────────

const RELATIONSHIPS = [
  {
    id:          'dxy_gold',
    assetA:      { key: 'DXY',   label: 'DXY',   aliases: ['USD Index', 'DXY'] },
    assetB:      { key: 'GOLD',  label: 'Gold',  aliases: ['GOLD', 'XAUUSD']   },
    correlation: 'inverse',   // DXY strong → Gold weak (normally)
    description: 'DXY / Gold',
    insight:     {
      aligned:   'USD and Gold moving in expected inverse relationship — no macro dislocation.',
      diverging: 'DXY and Gold both bid — unusual. Signals institutional USD demand alongside inflation fear or geopolitical hedging.',
      breakdown: 'DXY / Gold correlation broken — potential regime transition or systemic event. Monitor closely.',
    },
  },
  {
    id:          'dxy_oil',
    assetA:      { key: 'DXY',  label: 'DXY',   aliases: ['USD Index', 'DXY'] },
    assetB:      { key: 'OIL',  label: 'Oil',   aliases: ['WTI', 'CRUDE_OIL']  },
    correlation: 'inverse',   // Strong USD → commodity headwind
    description: 'DXY / Oil',
    insight:     {
      aligned:   'DXY and Oil inversely aligned — commodity repricing consistent with dollar move.',
      diverging: 'DXY and Oil both strengthening — supply shock or geopolitical premium overriding USD effect.',
      breakdown: 'DXY / Oil relationship broken — supply/demand factor decoupled from currency dynamics.',
    },
  },
  {
    id:          'equities_bonds',
    assetA:      { key: 'EQUITIES', label: 'Equities', aliases: ['SP500', 'NAS100', 'STOXX50'] },
    assetB:      { key: 'BONDS',    label: 'Bonds',    aliases: ['US10Y', 'US2Y', 'DE10Y']      },
    correlation: 'inverse',   // Equities up → bonds sold (risk-on). Bonds up → equities sold (risk-off)
    description: 'Equities / Bonds',
    insight:     {
      aligned:   'Classic risk-on/risk-off relationship intact — institutional behavior consistent.',
      diverging: 'Equities and bonds both bid — unusual. Signals goldilocks expectations or short-covering across both.',
      breakdown: 'Equities/Bonds correlation breakdown — macro regime highly uncertain. Both assets repricing simultaneously.',
    },
  },
  {
    id:          'gold_bonds',
    assetA:      { key: 'GOLD',  label: 'Gold',  aliases: ['GOLD', 'XAUUSD'] },
    assetB:      { key: 'BONDS', label: 'Bonds', aliases: ['US10Y', 'US2Y']  },
    correlation: 'positive',  // Both safe havens — should move together in RISK_OFF
    description: 'Gold / Bonds',
    insight:     {
      aligned:   'Gold and bonds moving together — consistent safe-haven demand in both asset classes.',
      diverging: 'Gold bid but bonds sold — inflation premium outweighing safety demand. Stagflationary signal.',
      breakdown: 'Gold and bonds completely decoupled — conflicting institutional views on inflation vs. deflation.',
    },
  },
  {
    id:          'equities_oil',
    assetA:      { key: 'EQUITIES', label: 'Equities', aliases: ['SP500', 'NAS100']   },
    assetB:      { key: 'OIL',      label: 'Oil',      aliases: ['WTI', 'CRUDE_OIL']  },
    correlation: 'positive',  // Both bid in demand-driven growth (risk-on)
    description: 'Equities / Oil',
    insight:     {
      aligned:   'Equities and oil aligned — demand-driven growth signal intact.',
      diverging: 'Equities sold but oil bid — supply shock or geopolitical factor lifting oil despite growth concern.',
      breakdown: 'Equities/Oil relationship broken — demand/supply dynamics completely decoupled.',
    },
  },
  {
    id:          'btc_dxy',
    assetA:      { key: 'BTC',  label: 'BTC',  aliases: ['BITCOIN', 'BTC'] },
    assetB:      { key: 'DXY',  label: 'DXY',  aliases: ['USD Index', 'DXY'] },
    correlation: 'inverse',   // BTC historically inversely correlated to DXY
    description: 'BTC / DXY',
    insight:     {
      aligned:   'BTC and DXY moving inversely — crypto macro relationship intact.',
      diverging: 'BTC rising with DXY — unusual. Risk appetite for crypto decoupled from dollar. Idiosyncratic demand.',
      breakdown: 'BTC/DXY correlation broken — crypto behaving independently of macro dollar dynamics.',
    },
  },
  {
    id:          'gold_equities',
    assetA:      { key: 'GOLD',     label: 'Gold',     aliases: ['GOLD', 'XAUUSD'] },
    assetB:      { key: 'EQUITIES', label: 'Equities', aliases: ['SP500', 'NAS100'] },
    correlation: 'inverse',   // Gold bid = defensive; equities bid = risk-on
    description: 'Gold / Equities',
    insight:     {
      aligned:   'Gold and equities moving in expected divergence — clear institutional regime signal.',
      diverging: 'Both gold and equities bid simultaneously — dual demand (inflation hedge + growth). Mixed signal.',
      breakdown: 'Gold / Equities correlation collapsed — no dominant macro narrative driving institutional flows.',
    },
  },
];

// ─── ASSET SIGNAL EXTRACTION ─────────────────────────────────────────────────

function extractDirection(key, aliases, allBiasArr = [], combinedData = null, macroSignal = null) {
  // Composite asset types
  if (key === 'EQUITIES') {
    const sp500  = findDirection(['SP500'],  allBiasArr, combinedData);
    const nas100 = findDirection(['NAS100'], allBiasArr, combinedData);
    const dirs   = [sp500, nas100].filter(Boolean);
    if (!dirs.length) return null;
    const bull = dirs.filter(d => d === 'bullish').length;
    const bear = dirs.filter(d => d === 'bearish').length;
    return bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
  }

  if (key === 'BONDS') {
    const us10y = findDirection(['US10Y'], allBiasArr, combinedData);
    const us2y  = findDirection(['US2Y'],  allBiasArr, combinedData);
    const dirs  = [us10y, us2y].filter(Boolean);
    if (!dirs.length) return null;
    const bull = dirs.filter(d => d === 'bullish').length;
    const bear = dirs.filter(d => d === 'bearish').length;
    return bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
  }

  if (key === 'DXY') {
    // Prefer macro signal bias
    if (macroSignal?.bias) {
      const bias = macroSignal.bias;
      if (bias === 'USD_STRONG' || bias === 'USD_LEANING_STRONG') return 'bullish';
      if (bias === 'USD_WEAK'   || bias === 'USD_LEANING_WEAK')   return 'bearish';
    }
    return findDirection(['USD Index', 'DXY'], allBiasArr, combinedData);
  }

  return findDirection(aliases, allBiasArr, combinedData);
}

function findDirection(aliases, allBiasArr, combinedData) {
  // Try biasArr first (fully scored)
  for (const alias of aliases) {
    const b = allBiasArr?.find(e => e?.pair?.toLowerCase() === alias.toLowerCase());
    if (b?.bias?.direction) return b.bias.direction;
    if (typeof b?.score === 'number') {
      return b.score > 0.5 ? 'bullish' : b.score < -0.5 ? 'bearish' : 'neutral';
    }
  }
  // Fall back to combinedData raw net positioning
  for (const alias of aliases) {
    const c = combinedData?.byAsset?.[alias.toUpperCase()];
    if (c?.latest) {
      const net = c.latest.smartNet ?? c.latest.ncNet ?? null;
      if (net == null) continue;
      return net > 5000 ? 'bullish' : net < -5000 ? 'bearish' : 'neutral';
    }
  }
  return null;
}

// ─── SIGNAL CLASSIFICATION ───────────────────────────────────────────────────

function classifyRelationship(correlation, dirA, dirB) {
  if (!dirA || !dirB || dirA === 'neutral' || dirB === 'neutral') return 'NEUTRAL';

  const sameDirection = dirA === dirB;

  if (correlation === 'inverse') {
    // Expect opposite directions
    if (!sameDirection) return 'ALIGNED';
    // Both moving same direction = divergence
    return 'DIVERGING';
  }

  if (correlation === 'positive') {
    // Expect same directions
    if (sameDirection) return 'ALIGNED';
    return 'DIVERGING';
  }

  return 'NEUTRAL';
}

// Upgrade DIVERGING to BREAKDOWN if the divergence is particularly extreme
function maybUpgradeToBreakdown(status, assetAData, assetBData) {
  if (status !== 'DIVERGING') return status;
  // Breakdown = both assets have strong (non-neutral) opposite signals
  const aStrong = assetAData && assetAData !== 'neutral';
  const bStrong = assetBData && assetBData !== 'neutral';
  return aStrong && bStrong ? 'BREAKDOWN' : 'DIVERGING';
}

// ─── SIGNAL CONFIG ───────────────────────────────────────────────────────────

const STATUS_META = {
  ALIGNED:   { color: '#22c55e', icon: '↔', label: 'ALIGNED',   priority: 1 },
  DIVERGING: { color: '#f59e0b', icon: '⚡', label: 'DIVERGING', priority: 3 },
  BREAKDOWN: { color: '#ef4444', icon: '⚠',  label: 'BREAKDOWN', priority: 4 },
  NEUTRAL:   { color: '#8491a8', icon: '—',  label: 'NO DATA',   priority: 2 },
};

// ─── OVERALL INTERMARKET HEALTH ───────────────────────────────────────────────

function computeOverallHealth(signals) {
  const active = signals.filter(s => s.status !== 'NEUTRAL');
  if (!active.length) return { score: 50, label: 'INSUFFICIENT DATA', color: '#8491a8' };

  const breakdowns = active.filter(s => s.status === 'BREAKDOWN').length;
  const diverging  = active.filter(s => s.status === 'DIVERGING').length;
  const aligned    = active.filter(s => s.status === 'ALIGNED').length;

  const score = Math.round(
    (aligned * 100 + diverging * 45 + breakdowns * 10) / active.length
  );

  const label = score >= 75 ? 'COHERENT' : score >= 50 ? 'MIXED' : score >= 30 ? 'STRESSED' : 'FRAGMENTED';
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444';

  return { score, label, color, breakdowns, diverging, aligned, totalActive: active.length };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * computeIntermarketSignals — main entry point.
 *
 * @param {{
 *   allBiasArr:   Array    — from buildBiasArray() with all assets
 *   combinedData: Object|null — from parseTiffCombined()
 *   macroSignal:  Object|null — from useMacroSignal()
 *   riskRegime:   Object|null — from computeRiskRegime()
 * }}
 *
 * @returns {{
 *   signals:       Array    — per-relationship signal objects
 *   health:        Object   — overall intermarket health
 *   keyDivergences:string[] — actionable divergence/breakdown summaries
 *   hasData:       boolean
 * }}
 */
export function computeIntermarketSignals({
  allBiasArr   = [],
  combinedData  = null,
  macroSignal   = null,
} = {}) {
  const signals = RELATIONSHIPS.map(rel => {
    const dirA = extractDirection(rel.assetA.key, rel.assetA.aliases, allBiasArr, combinedData, macroSignal);
    const dirB = extractDirection(rel.assetB.key, rel.assetB.aliases, allBiasArr, combinedData, macroSignal);

    let status = classifyRelationship(rel.correlation, dirA, dirB);
    status = maybUpgradeToBreakdown(status, dirA, dirB);

    const meta    = STATUS_META[status];
    const insight = rel.insight[status.toLowerCase()] || rel.insight.aligned;

    return {
      id:           rel.id,
      description:  rel.description,
      assetA:       { label: rel.assetA.label, direction: dirA },
      assetB:       { label: rel.assetB.label, direction: dirB },
      correlation:  rel.correlation,
      status,
      color:        meta.color,
      icon:         meta.icon,
      statusLabel:  meta.label,
      priority:     meta.priority,
      insight,
      hasData:      dirA !== null && dirB !== null,
    };
  });

  // Sort by priority (breakdowns first, then diverging, then no-data, then aligned)
  signals.sort((a, b) => b.priority - a.priority);

  const health = computeOverallHealth(signals);

  const keyDivergences = signals
    .filter(s => s.status === 'BREAKDOWN' || s.status === 'DIVERGING')
    .slice(0, 4)
    .map(s => `${s.description}: ${s.statusLabel} — ${s.insight}`);

  return {
    signals,
    health,
    keyDivergences,
    hasData: signals.some(s => s.hasData),
  };
}
