/**
 * newsScoringEngine.js — 4-Layer News Relevance Engine
 *
 * Formula:
 *   finalScore = (baseImpact * 0.35) + (surpriseScore * 0.30)
 *              + (regimeBoost * 0.25) + (assetSensitivity * 0.10)
 *   Scaled to 0–10, rounded to 1 decimal.
 *
 * Outputs a payload fully compatible with existing MarketPulsePanel.jsx:
 *   { score, label, color, assets, category, direction, regimeContext, tier }
 *
 * "tier" kept for logging continuity (A = score >= 5, B = score < 5).
 */

// ─── LAYER 1: BASE IMPACT ─────────────────────────────────────────────────────
// Max raw value: 5. Weight 35% → contributes 0–1.75 to final 0–10 scale.
const BASE_IMPACT_MAP = {
  central_bank:      5,
  inflation:         5,
  employment:        5,
  gdp:               4,
  geopolitical:      4,
  commodity_supply:  4,
  pmi:               3,
  retail_sales:      3,
  inventories:       3,
  sentiment:         2,
  speech:            2,
  generic_macro:     2,
};

// Category classifiers — ordered by priority (first match wins)
// Each entry: { re, category }
const CATEGORY_RULES = [
  // Central banks (specific decisions/meetings — not generic mentions)
  { re: /\b(fomc|federal open market|rate (hike|cut|pause|hold|decision)|ecb (decision|hike|cut|hold)|boe (decision|hike|cut|hold)|boj (decision|policy|hold|hike)|central bank (decision|meeting|rate)|basis point|bps (hike|cut))\b/i, category: 'central_bank' },
  // Inflation
  { re: /\b(cpi|consumer price(s)?|pce( deflator)?|core inflation|inflation (data|report|print|rate|above|below|rose|fell)|ppi|producer price(s)?)\b/i, category: 'inflation' },
  // Employment
  { re: /\b(nonfarm|non-farm|payroll(s)?|nfp|jobs report|employment (report|data|number)|adp (employment|payroll|national)|jobless claims|unemployment claims|initial claims|jolts|job openings)\b/i, category: 'employment' },
  // GDP
  { re: /\b(gdp|gross domestic product|economic (growth|contraction|expansion|output)|q[1-4] gdp)\b/i, category: 'gdp' },
  // Geopolitical
  { re: /\b(war|conflict|military (strike|action|invasion)|sanctions|ceasefire|nuclear (threat|deal)|tariff(s)? (imposed|raised|threat)|trade war|geopoliti)\b/i, category: 'geopolitical' },
  // Commodity supply shocks
  { re: /\b(opec|oil (production|supply|output|cut|boost)|crude (output|supply)|brent|wti|energy (supply|crisis)|gas (supply|pipeline)|commodity (shock|supply))\b/i, category: 'commodity_supply' },
  // PMI / ISM
  { re: /\b(pmi|purchasing managers|ism (manufacturing|services|non-manufacturing|report)|composite pmi)\b/i, category: 'pmi' },
  // Retail / consumer
  { re: /\b(retail sales|consumer spending|consumer confidence|consumer sentiment)\b/i, category: 'retail_sales' },
  // Inventories / housing
  { re: /\b(inventories|housing (starts?|permits?|sales?)|existing home sales|building permits)\b/i, category: 'inventories' },
  // CB speeches (not decisions)
  { re: /\b(powell (speaks?|testif|comments?|remarks?)|lagarde (speaks?|comments?)|bailey (speaks?|comments?)|ueda (speaks?|comments?)|fed (speak|official|member|governor) (say|speak|warn|signal))\b/i, category: 'speech' },
  // Sentiment / survey
  { re: /\b(michigan sentiment|consumer sentiment survey|business confidence|economic sentiment)\b/i, category: 'sentiment' },
];

function classifyCategory(title) {
  for (const { re, category } of CATEGORY_RULES) {
    if (re.test(title)) return category;
  }
  return 'generic_macro';
}

function getBaseImpact(category) {
  return BASE_IMPACT_MAP[category] ?? 2;
}

// ─── LAYER 2: SURPRISE SCORE ──────────────────────────────────────────────────
// Max raw: 4. Weight 30% → contributes 0–1.20 to final.
// Only computed when actual + forecast are present.
function getSurpriseScore(actual, forecast) {
  if (actual == null || forecast == null) return 0;
  const a = parseFloat(String(actual).replace(/[%KMBkmbp,\s]/g, ''));
  const f = parseFloat(String(forecast).replace(/[%KMBkmbp,\s]/g, ''));
  if (isNaN(a) || isNaN(f) || f === 0) return 0;
  const surprise = Math.abs(a - f) / Math.abs(f);
  if (surprise < 0.10) return 0;
  if (surprise < 0.25) return 1;
  if (surprise < 0.50) return 2;
  if (surprise < 1.00) return 3;
  return 4;
}

// ─── LAYER 3: MARKET REGIME ───────────────────────────────────────────────────
// Max raw: up to +2 per active flag. Weight 25%.
// Regime is inferred from the last N headlines passed in.

const REGIME_DETECTORS = {
  inflationFocus:     /\b(cpi|inflation|pce|price(s)? (rise|surge|above)|rate (hike|rise|above))\b/i,
  geopoliticalStress: /\b(war|conflict|tension|sanction|military|strike|escalat|nuclear|crisis|invasion)\b/i,
  commodityShock:     /\b(oil (surge|spike|above|price|supply)|opec|brent|wti|energy (crisis|supply)|commodity)\b/i,
  riskOff:            /\b(risk.?off|safe.?haven|flight to (safety|quality)|vix spike|market (crash|sell.?off|plunge|fear))\b/i,
  cbWeek:             /\b(fomc|ecb (meeting|decision)|boe (meeting|decision)|central bank (week|decision|meeting))\b/i,
};

// Minimum occurrences in recent headlines to activate a regime flag
const REGIME_THRESHOLD = 2;

/**
 * @param {string[]} recentTitles — last 10–20 headlines already collected
 * @returns {object} regime flags
 */
function inferMarketRegime(recentTitles) {
  const regime = {
    inflationFocus:     false,
    geopoliticalStress: false,
    commodityShock:     false,
    riskOff:            false,
    cbWeek:             false,
  };
  if (!recentTitles?.length) return regime;

  for (const [flag, detector] of Object.entries(REGIME_DETECTORS)) {
    const hits = recentTitles.filter(t => detector.test(t)).length;
    if (hits >= REGIME_THRESHOLD) regime[flag] = true;
  }
  return regime;
}

// Regime boost: +0 to +2 per activated flag, applied only when category aligns
function getRegimeBoost(category, regime) {
  let boost = 0;
  if (regime.inflationFocus     && (category === 'inflation' || category === 'central_bank')) boost += 2;
  if (regime.commodityShock     && category === 'commodity_supply')                           boost += 2;
  if (regime.cbWeek             && (category === 'central_bank' || category === 'speech'))    boost += 2;
  if (regime.geopoliticalStress && category === 'geopolitical')                               boost += 2;
  if (regime.riskOff            && (category === 'geopolitical' || category === 'central_bank')) boost += 1;
  return Math.min(boost, 4); // cap to avoid over-inflation
}

// ─── LAYER 4: ASSET SENSITIVITY ───────────────────────────────────────────────
// Max raw: 1. Weight 10%.
// Maps category to a sensitivity score for commonly affected assets.
const ASSET_SENSITIVITY_MAP = {
  central_bank:      1.0,  // direct rate/FX impact
  inflation:         1.0,  // direct rates / gold / DXY impact
  employment:        0.9,
  gdp:               0.8,
  geopolitical:      0.8,
  commodity_supply:  0.8,
  pmi:               0.7,
  retail_sales:      0.6,
  speech:            0.5,
  inventories:       0.4,
  sentiment:         0.3,
  generic_macro:     0.2,
};

function getAssetSensitivity(category) {
  return ASSET_SENSITIVITY_MAP[category] ?? 0.2;
}

// ─── DIRECTION INFERENCE ──────────────────────────────────────────────────────
const BULLISH_WORDS = /\b(rises?|rose|higher|up|surges?|beats?|beat|above|strong(er)?|jumps?|gains?|rallies?|rally|expands?|growth|recovery|boost|positive|exceeded|better.?than)\b/i;
const BEARISH_WORDS = /\b(falls?|fell|lower|down|drops?|misses?|missed|below|weak(er)?|contracts?|shrinks?|declines?|slumps?|plunges?|fears?|concern|negative|contraction|slowdown|worse.?than)\b/i;

function inferDirection(title) {
  const bull = BULLISH_WORDS.test(title);
  const bear = BEARISH_WORDS.test(title);
  if (bull && !bear) return 'bullish';
  if (bear && !bull) return 'bearish';
  return 'neutral';
}

// ─── ASSET MAPPING (directional) ─────────────────────────────────────────────
function deriveAssets(category, direction) {
  const up = 'up', dn = 'down', nu = 'neutral';
  const isBull = direction === 'bullish';
  const isBear = direction === 'bearish';

  const maps = {
    central_bank:     [{ name:'DXY', dir: isBull?up:isBear?dn:nu }, { name:'EUR/USD', dir: isBull?dn:isBear?up:nu }, { name:'GOLD', dir: isBull?dn:isBear?up:nu }],
    inflation:        [{ name:'DXY', dir: isBull?up:isBear?dn:nu }, { name:'GOLD', dir: isBull?dn:isBear?up:nu }, { name:'NAS100', dir: isBull?dn:isBear?up:nu }],
    employment:       [{ name:'DXY', dir: isBull?up:isBear?dn:nu }, { name:'EUR/USD', dir: isBull?dn:isBear?up:nu }, { name:'NAS100', dir: isBull?up:isBear?dn:nu }],
    gdp:              [{ name:'DXY', dir: isBull?up:isBear?dn:nu }, { name:'NAS100', dir: isBull?up:isBear?dn:nu }, { name:'GOLD', dir: isBull?dn:isBear?up:nu }],
    geopolitical:     [{ name:'GOLD', dir:up }, { name:'DXY', dir:up }, { name:'EUR/USD', dir:dn }],
    commodity_supply: [{ name:'USD/CAD', dir: isBull?dn:isBear?up:nu }, { name:'WTI', dir: isBull?up:isBear?dn:nu }, { name:'GOLD', dir:nu }],
    pmi:              [{ name:'EUR/USD', dir: isBull?up:isBear?dn:nu }, { name:'GBP/USD', dir: isBull?up:isBear?dn:nu }, { name:'DXY', dir: isBull?dn:isBear?up:nu }],
    retail_sales:     [{ name:'DXY', dir: isBull?up:isBear?dn:nu }, { name:'NAS100', dir: isBull?up:isBear?dn:nu }],
    speech:           [{ name:'DXY', dir:nu }, { name:'EUR/USD', dir:nu }],
    inventories:      [{ name:'DXY', dir:nu }],
    sentiment:        [{ name:'NAS100', dir: isBull?up:isBear?dn:nu }],
    generic_macro:    [{ name:'DXY', dir:nu }, { name:'EUR/USD', dir:nu }],
  };
  return (maps[category] || maps.generic_macro).slice(0, 3);
}

// ─── LABEL + COLOR ────────────────────────────────────────────────────────────
function getLabel(score) {
  if (score >= 7.0) return { label: 'CRÍTICA', color: '#dc2626' };
  if (score >= 5.0) return { label: 'ALTA',    color: '#ef4444' };
  if (score >= 3.0) return { label: 'MEDIA',   color: '#f59e0b' };
  return                   { label: 'BAJA',    color: '#94a3b8' };
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
/**
 * scoreNews — full 4-layer scoring
 *
 * @param {string}   title          — news headline
 * @param {object}   [data]         — { actual, forecast, previous } if available
 * @param {object}   [regime]       — output of inferMarketRegime()
 * @returns {object|null}           — null if irrelevant
 */
export function scoreNews(title, data = {}, regime = {}) {
  // Layer 1 — base impact
  const category   = classifyCategory(title);
  const baseImpact = getBaseImpact(category);        // 0–5

  // Layer 2 — surprise score
  const surpriseScore = getSurpriseScore(data?.actual, data?.forecast); // 0–4

  // Layer 3 — regime boost
  const regimeBoost = getRegimeBoost(category, regime); // 0–4

  // Layer 4 — asset sensitivity
  const assetSensitivity = getAssetSensitivity(category); // 0–1

  // Formula: scale each component to its max contribution, then to 0–10
  // baseImpact max=5 * 0.35 = 1.75
  // surpriseScore max=4 * 0.30 = 1.20
  // regimeBoost max=4 * 0.25 = 1.00
  // assetSensitivity max=1 * 0.10 = 0.10
  // Total max raw = 4.05 → scale to 10 → multiply by (10/4.05) ≈ 2.469
  const RAW_MAX = (5 * 0.35) + (4 * 0.30) + (4 * 0.25) + (1 * 0.10); // = 4.05
  const rawScore =
    (baseImpact      * 0.35) +
    (surpriseScore   * 0.30) +
    (regimeBoost     * 0.25) +
    (assetSensitivity * 0.10);

  const finalScore = Math.round((rawScore / RAW_MAX) * 10 * 10) / 10; // 0–10, 1 decimal

  const direction = inferDirection(title);
  const assets    = deriveAssets(category, direction);
  const { label, color } = getLabel(finalScore);

  return {
    score:         finalScore,
    label,
    color,
    category,
    direction,
    assets,
    regimeContext: {
      inflationFocus:     regime.inflationFocus     ?? false,
      geopoliticalStress: regime.geopoliticalStress ?? false,
      commodityShock:     regime.commodityShock     ?? false,
      riskOff:            regime.riskOff            ?? false,
      cbWeek:             regime.cbWeek             ?? false,
    },
    tier: finalScore >= 5 ? 'A' : 'B',  // backwards-compat for logging
    _debug: {
      baseImpact, surpriseScore, regimeBoost,
      assetSensitivity, rawScore, category,
    },
  };
}

export { inferMarketRegime, classifyCategory };
