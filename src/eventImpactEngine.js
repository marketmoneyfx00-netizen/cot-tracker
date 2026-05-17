/**
 * eventImpactEngine.js — Dynamic Macro Event Impact Engine
 *
 * Transforms static event importance into contextual sensitivity scores by
 * layering four market-context modifiers on top of the backend's dynamicScore:
 *
 *   finalImpactScore = baseScore
 *                    + positioningMod   (COT z-score extremes)
 *                    + volatilityMod    (VIX level)
 *                    + policyMod        (CB stance divergence × macro confidence)
 *                    + clusterMod       (event cluster in same session)
 *
 * Stars scale: 0-25→1★  26-50→2★  51-75→3★  76-100→4★ (Institucional)
 */

// ── Country → currency map ────────────────────────────────────────────────────
const COUNTRY_CCY = {
  US:'USD', EU:'EUR', GB:'GBP', JP:'JPY', CA:'CAD',
  AU:'AUD', NZ:'NZD', CH:'CHF', DE:'EUR', FR:'EUR',
  ES:'EUR', IT:'EUR', NL:'EUR', BE:'EUR', AT:'EUR',
  CN:'CNY', KR:'KRW', SG:'SGD', MX:'MXN', BR:'BRL',
  NO:'NOK', SE:'SEK', DK:'DKK', PL:'PLN',
};

export function eventCcy(country) {
  return COUNTRY_CCY[(country || '').toUpperCase()] || null;
}

// ── Client-side category enrichment ──────────────────────────────────────────
// Catches categories the backend newsScoringEngine may misclassify because
// event names from Forex Factory / FXStreet are short and domain-specific.
const ENRICH_RULES = [
  // G7/G20/multilateral summits → geopolitical
  { re: /\b(g[78]|g20|ecofin|eurogroup|imf|world bank|oecd|brics|eu summit|nato)\b/i, cat: 'geopolitical' },
  // Capital flows / TIC
  { re: /\b(tic (long.?term|purchases?|data)|capital flows?|cross.?border (flows?|investment)|net long.?term)\b/i, cat: 'flows' },
  // Bond auctions
  { re: /\b(\d+.?y(ear|r)? (bond|note|bill|gilt|bund|jgb|treasury) auction|bond auction|gilt auction|bund auction|jgb auction|t.?bill auction|treasury auction|(\d+.?year)? auction)\b/i, cat: 'bonds' },
  // Carry-sensitive rates
  { re: /\b(carry|swap rate|overnight rate|repo rate|libor|sofr|estr|tonar|sonia|interest rate swap|yield spread|bond spread)\b/i, cat: 'bonds' },
  // Monetary policy minutes (not a generic speech)
  { re: /\b(monetary policy (minutes?|meeting minutes?)|mpc minutes?|boj (minutes?|summary)|ecb (minutes?|accounts?)|fomc minutes?|rba minutes?|rbnz minutes?|boc minutes?|snb minutes?)\b/i, cat: 'central_bank' },
  // CB member speeches — elevated over generic speech
  { re: /\b(mpc member|boe (official|member|governor|deputy governor)|fed (governor|president|official) (speak|said|warned?|testif)|riksbank|snb (chairman|official)|norges bank official)\b/i, cat: 'speech' },
  // Inflation expectations / breakevens
  { re: /\b(inflation expectation|breakeven|tips spread|10.?year inflation)\b/i, cat: 'inflation' },
  // Yield-sensitive data not caught by server
  { re: /\b(10.?year (yield|bond)|bund yield|gilt yield|jgb yield|treasury yield)\b/i, cat: 'bonds' },
];

function enrichCategory(ev) {
  const title = (ev.event || ev.title || '').toLowerCase();
  for (const { re, cat } of ENRICH_RULES) {
    if (re.test(title)) return cat;
  }
  return ev.dynamicCategory || null;
}

// ── Category modifier sensitivity ─────────────────────────────────────────────
// How strongly each category responds to each modifier type (0–1 multiplier).
// These are calibrated to institutional relevance, not retail convention.
const CAT_SENSITIVITY = {
  central_bank:     { positioning: 1.0, volatility: 0.8, policy: 1.0, cluster: 1.0 },
  inflation:        { positioning: 0.9, volatility: 0.7, policy: 1.0, cluster: 0.9 },
  employment:       { positioning: 0.8, volatility: 0.6, policy: 0.5, cluster: 0.8 },
  gdp:              { positioning: 0.7, volatility: 0.5, policy: 0.4, cluster: 0.7 },
  pmi:              { positioning: 0.6, volatility: 0.4, policy: 0.3, cluster: 0.6 },
  retail_sales:     { positioning: 0.7, volatility: 0.4, policy: 0.3, cluster: 0.7 },
  speech:           { positioning: 0.6, volatility: 0.3, policy: 0.9, cluster: 0.5 },
  flows:            { positioning: 1.0, volatility: 0.5, policy: 0.5, cluster: 0.6 },
  bonds:            { positioning: 0.8, volatility: 0.7, policy: 0.6, cluster: 0.7 },
  geopolitical:     { positioning: 0.5, volatility: 1.0, policy: 0.2, cluster: 0.8 },
  commodity_supply: { positioning: 0.5, volatility: 0.8, policy: 0.2, cluster: 0.5 },
  inventories:      { positioning: 0.5, volatility: 0.3, policy: 0.2, cluster: 0.5 },
  sentiment:        { positioning: 0.4, volatility: 0.6, policy: 0.2, cluster: 0.4 },
  generic_macro:    { positioning: 0.4, volatility: 0.3, policy: 0.2, cluster: 0.4 },
};

function getSens(cat) {
  return CAT_SENSITIVITY[cat] || CAT_SENSITIVITY.generic_macro;
}

// ── Base score (0–60) ─────────────────────────────────────────────────────────
// Uses backend dynamicScore (0–10) as the foundation. Falls back to static
// impact when dynamicScore is unavailable.
function computeBaseScore(ev) {
  if (typeof ev.dynamicScore === 'number' && ev.dynamicScore > 0) {
    return Math.round(ev.dynamicScore * 5.5); // 0–55
  }
  if (ev.impact === 'High')   return 40;
  if (ev.impact === 'Medium') return 25;
  return 10;
}

// ── MODIFIER 1: Positioning (0–25) ───────────────────────────────────────────
// COT z-score extremes for the event's currency amplify event importance.
// Rationale: when institutional positioning is crowded, any data release for
// that currency becomes a potential unwind catalyst.
function computePositioningMod(ccy, biasArr, catSens) {
  if (!biasArr?.length || !ccy) return { mod: 0, reasons: [] };

  const isUSD = ccy === 'USD';
  // USD is embedded in every pair; use all pairs. Others: only the pair containing that ccy.
  const relevant = isUSD
    ? biasArr
    : biasArr.filter(b => b.pair?.includes(ccy));

  if (!relevant.length) return { mod: 0, reasons: [] };

  const zscores = relevant
    .map(b => b.zscore?.zscore ?? null)
    .filter(z => z !== null && !isNaN(z));

  if (!zscores.length) return { mod: 0, reasons: [] };

  const maxZ = isUSD
    ? zscores.reduce((s, z) => s + Math.abs(z), 0) / zscores.length
    : Math.max(...zscores.map(Math.abs));

  const pairLabel = isUSD ? 'USD' : relevant[0]?.pair || ccy;
  const zRnd = (Math.round(maxZ * 10) / 10).toFixed(1);

  const reasons = [];
  let rawMod = 0;

  if (maxZ >= 2.0) {
    rawMod = 25;
    reasons.push(`Positioning extremo ${pairLabel} (z: ${zRnd}σ)`);
  } else if (maxZ >= 1.5) {
    rawMod = 16;
    reasons.push(`Positioning elevado ${pairLabel} (z: ${zRnd}σ)`);
  } else if (maxZ >= 1.0) {
    rawMod = 8;
    reasons.push(`Positioning por encima de media en ${pairLabel}`);
  }

  // High institutional confluence amplifies further
  if (rawMod > 0) {
    const avgConfl = relevant.reduce((s, b) => s + (b.confluence?.score ?? 0), 0) / relevant.length;
    if (avgConfl >= 70) {
      rawMod = Math.min(25, rawMod + 5);
      reasons.push(`Alta confluencia institucional (${Math.round(avgConfl)}%)`);
    }
  }

  return { mod: Math.round(rawMod * catSens.positioning), reasons };
}

// ── MODIFIER 2: Volatility (−5 to +15) ───────────────────────────────────────
// Elevated VIX amplifies risk-sensitive events; very calm markets dampen
// geopolitical / sentiment events that typically need stress to matter.
function computeVolatilityMod(liveVix, cat, catSens) {
  if (!liveVix || liveVix <= 0) return { mod: 0, reasons: [] };

  const reasons = [];
  let rawMod = 0;

  if (liveVix >= 30) {
    rawMod = 15;
    reasons.push(`VIX extremo (${liveVix.toFixed(1)}) — sensibilidad máxima`);
  } else if (liveVix >= 25) {
    rawMod = 10;
    reasons.push(`VIX elevado (${liveVix.toFixed(1)})`);
  } else if (liveVix >= 20) {
    rawMod = 6;
    reasons.push(`Volatilidad alta (VIX ${liveVix.toFixed(1)})`);
  } else if (liveVix < 14) {
    // Very calm market: geopolitical / sentiment carry less weight
    if (cat === 'geopolitical' || cat === 'sentiment') rawMod = -5;
  }

  return { mod: Math.round(rawMod * catSens.volatility), reasons };
}

// ── MODIFIER 3: Policy divergence (0–20) ─────────────────────────────────────
// Central-bank events gain weight when macro confidence is high and/or carry
// divergence signals a meaningful rate differential.
// Only applies to CB-relevant categories to avoid inflating noise events.
const POLICY_CATS = new Set(['central_bank', 'inflation', 'employment', 'speech', 'bonds']);

function computePolicyMod(ccy, biasArr, macroSignal, cat, catSens) {
  if (!POLICY_CATS.has(cat)) return { mod: 0, reasons: [] };

  const reasons = [];
  let rawMod = 0;

  // Macro signal confidence
  const conf = macroSignal?.confidence ?? 0;
  if (conf >= 8) {
    rawMod += 15;
    reasons.push(`Alta confianza macro (${conf.toFixed(1)}/10)`);
  } else if (conf >= 6) {
    rawMod += 8;
    reasons.push(`Señal macro activa (confianza ${conf.toFixed(1)}/10)`);
  } else if (conf >= 4) {
    rawMod += 4;
  }

  // Carry divergence for CB / speech events
  if (ccy && (cat === 'central_bank' || cat === 'speech')) {
    const relevant = biasArr?.filter(b =>
      b.pair?.includes(ccy) && typeof b.carryScore === 'number'
    ) ?? [];
    if (relevant.length) {
      const maxCarry = Math.max(...relevant.map(b => Math.abs(b.carryScore || 0)));
      if (maxCarry >= 5) {
        rawMod += 10;
        reasons.push(`Divergencia carry activa (${maxCarry.toFixed(1)}bp)`);
      } else if (maxCarry >= 2) {
        rawMod += 5;
        reasons.push(`Carry diferencial moderado`);
      }
    }
  }

  // Non-neutral macro bias adds marginal relevance for the USD-paired currencies
  if (macroSignal?.bias && macroSignal.bias !== 'NEUTRAL') {
    const involvesCcy = macroSignal.bias.startsWith('USD') &&
      (ccy === 'USD' || ['EUR', 'GBP', 'JPY', 'CHF'].includes(ccy));
    if (involvesCcy && rawMod === 0) rawMod += 3;
  }

  return { mod: Math.min(20, Math.round(rawMod * catSens.policy)), reasons };
}

// ── MODIFIER 4: Event cluster (0–10) ─────────────────────────────────────────
// Several high-impact events in the same ±2h window create compounded
// uncertainty — total market sensitivity exceeds the sum of its parts.
function computeClusterMod(ev, allEvents, catSens) {
  if (!allEvents?.length) return { mod: 0, reasons: [] };

  const evMs = new Date(ev.date).getTime();
  if (isNaN(evMs)) return { mod: 0, reasons: [] };

  const TWO_H = 2 * 60 * 60 * 1000;
  const nearby = allEvents.filter(e => {
    if (e === ev || e.event === ev.event) return false;
    const ms = new Date(e.date).getTime();
    if (isNaN(ms)) return false;
    if (Math.abs(ms - evMs) > TWO_H) return false;
    return e.impact === 'High' || (e.dynamicScore ?? 0) >= 5;
  });

  if (nearby.length >= 3) return {
    mod: Math.round(10 * catSens.cluster),
    reasons: [`Cluster: ${nearby.length + 1} eventos de alto impacto en sesión`],
  };
  if (nearby.length >= 1) return {
    mod: Math.round(5 * catSens.cluster),
    reasons: [`Cluster de eventos (${nearby.length + 1} simultáneos)`],
  };
  return { mod: 0, reasons: [] };
}

// ── Label + color ─────────────────────────────────────────────────────────────
function getLabel(stars) {
  if (stars === 4) return { label: 'Institucional', color: '#a855f7' };
  if (stars === 3) return { label: 'Alto',          color: '#ef4444' };
  if (stars === 2) return { label: 'Medio',         color: '#f59e0b' };
  return                 { label: 'Bajo',           color: '#6b7280' };
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
/**
 * computeContextualImpact
 *
 * @param {object} ev            — calendar event with: impact, country, dynamicScore,
 *                                 dynamicCategory, dynamicLabel, event (title)
 * @param {object} marketContext — { biasArr, macroSignal, liveVix, allEvents }
 *
 * @returns {{
 *   baseScore: number,
 *   positioningMod: number,
 *   volatilityMod: number,
 *   policyMod: number,
 *   clusterMod: number,
 *   finalImpactScore: number,
 *   stars: 1|2|3|4,
 *   label: string,
 *   color: string,
 *   isContextualBoost: boolean,
 *   explanation: string,
 *   contextualReasons: string[],
 *   confidence: 'high'|'medium'|'low',
 *   category: string,
 * }}
 */
export function computeContextualImpact(ev, marketContext = {}) {
  const {
    biasArr    = [],
    macroSignal = null,
    liveVix    = null,
    allEvents  = [],
  } = marketContext;

  const ccy     = eventCcy(ev.country);
  const cat     = enrichCategory(ev) || 'generic_macro';
  const catSens = getSens(cat);

  const baseScore = computeBaseScore(ev);

  const { mod: posMod, reasons: posR } = computePositioningMod(ccy, biasArr, catSens);
  const { mod: volMod, reasons: volR } = computeVolatilityMod(liveVix, cat, catSens);
  const { mod: polMod, reasons: polR } = computePolicyMod(ccy, biasArr, macroSignal, cat, catSens);
  const { mod: clsMod, reasons: clsR } = computeClusterMod(ev, allEvents, catSens);

  const finalImpactScore = Math.min(100, Math.max(0,
    baseScore + posMod + volMod + polMod + clsMod,
  ));

  const stars = finalImpactScore >= 76 ? 4
              : finalImpactScore >= 51 ? 3
              : finalImpactScore >= 26 ? 2
              : 1;

  const baseStars = baseScore >= 76 ? 4
                  : baseScore >= 51 ? 3
                  : baseScore >= 26 ? 2
                  : 1;

  const isContextualBoost = stars > baseStars;

  const { label, color } = getLabel(stars);

  const contextualReasons = [...posR, ...volR, ...polR, ...clsR];

  // Single-line explanation: first contextual reason, or dynamic label from backend
  const explanation = contextualReasons.length > 0
    ? contextualReasons[0]
    : (ev.dynamicLabel || '');

  // Confidence in the contextual assessment
  const ctxSignals = (biasArr.length > 0 ? 1 : 0)
                   + (liveVix !== null ? 1 : 0)
                   + (macroSignal !== null ? 1 : 0);
  const confidence = ctxSignals >= 3 ? 'high' : ctxSignals >= 1 ? 'medium' : 'low';

  return {
    baseScore,
    positioningMod:  posMod,
    volatilityMod:   volMod,
    policyMod:       polMod,
    clusterMod:      clsMod,
    finalImpactScore,
    stars,
    isContextualBoost,
    label,
    color,
    explanation,
    contextualReasons,
    confidence,
    category: cat,
    _debug: { baseStars, ccy, cat },
  };
}
