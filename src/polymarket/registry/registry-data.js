// =============================================================================
// POLYMARKET × COT TRACKER — CURATED MARKET REGISTRY DATA
// src/polymarket/registry/registry-data.js
//
// Slugs are resolved to conditionIds at service startup via API.
// The slug is the stable identifier. conditionId is populated dynamically.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — FED POLICY
// ─────────────────────────────────────────────────────────────────────────────

export const FED_POLICY_MARKETS = [
  {
    slug: 'fed-rate-cut-june-2025',
    category: 'FED_POLICY',
    compositeIndices: ['PUI', 'MSC'],
    compositeWeight: 0.50,
    minOI: 300_000,
    maxSpread: 0.08,
    minDaysToExpiry: 3,
    minVolume24h: 15_000,
    priority: 1,
    refreshStrategy: 'REALTIME_WS',
    calendarKeywords: ['FOMC', 'Federal Reserve', 'rate decision', 'Fed'],
    description: 'Will the Fed cut rates at the June 2025 meeting?',
  },
  {
    slug: 'fed-rate-cut-july-2025',
    category: 'FED_POLICY',
    compositeIndices: ['PUI', 'MSC'],
    compositeWeight: 0.40,
    minOI: 200_000,
    maxSpread: 0.10,
    minDaysToExpiry: 3,
    minVolume24h: 10_000,
    priority: 1,
    refreshStrategy: 'POLLING_15MIN',
    calendarKeywords: ['FOMC', 'Federal Reserve', 'rate decision', 'Fed'],
    description: 'Will the Fed cut rates at the July 2025 meeting?',
  },
  {
    slug: 'fed-rate-cuts-2025',
    category: 'FED_POLICY',
    compositeIndices: ['PUI'],
    compositeWeight: 0.60,
    minOI: 500_000,
    maxSpread: 0.06,
    minDaysToExpiry: 30,
    minVolume24h: 20_000,
    priority: 1,
    refreshStrategy: 'POLLING_15MIN',
    calendarKeywords: ['Fed', 'rate path', 'dots', 'cuts'],
    description: 'How many Fed rate cuts in 2025?',
  },
  {
    slug: 'fed-funds-rate-end-2025',
    category: 'FED_POLICY',
    compositeIndices: ['PUI'],
    compositeWeight: 0.45,
    minOI: 200_000,
    maxSpread: 0.10,
    minDaysToExpiry: 30,
    minVolume24h: 5_000,
    priority: 1,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['Fed', 'rate path', 'year end rate'],
    description: 'Fed funds rate level at end of 2025',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — RECESSION RISK
// ─────────────────────────────────────────────────────────────────────────────

export const RECESSION_MARKETS = [
  {
    slug: 'us-recession-2025',
    category: 'RECESSION',
    compositeIndices: ['RRC', 'MSC'],
    compositeWeight: 0.45,
    minOI: 100_000,
    maxSpread: 0.12,
    minDaysToExpiry: 30,
    minVolume24h: 5_000,
    priority: 1,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['GDP', 'recession', 'growth', 'contraction'],
    description: 'Will the US enter a recession in 2025?',
  },
  {
    slug: 'us-recession-2026',
    category: 'RECESSION',
    compositeIndices: ['RRC'],
    compositeWeight: 0.28,
    minOI: 50_000,
    maxSpread: 0.15,
    minDaysToExpiry: 90,
    minVolume24h: 2_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['GDP', 'recession', 'growth'],
    description: 'Will the US enter a recession in 2026?',
  },
  {
    slug: 'us-gdp-negative-q2-2025',
    category: 'RECESSION',
    compositeIndices: ['RRC'],
    compositeWeight: 0.20,
    minOI: 50_000,
    maxSpread: 0.15,
    minDaysToExpiry: 14,
    minVolume24h: 2_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['GDP', 'Q2', 'growth rate'],
    description: 'Will US Q2 2025 GDP be negative?',
  },
  {
    slug: 'us-unemployment-above-5-percent-2025',
    category: 'EMPLOYMENT',
    compositeIndices: ['RRC'],
    compositeWeight: 0.07,
    minOI: 30_000,
    maxSpread: 0.18,
    minDaysToExpiry: 30,
    minVolume24h: 1_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['unemployment', 'jobless', 'labor market'],
    description: 'Will US unemployment exceed 5% in 2025?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — GEOPOLITICAL
// ─────────────────────────────────────────────────────────────────────────────

export const GEOPOLITICAL_MARKETS = [
  {
    slug: 'russia-ukraine-ceasefire-2025',
    category: 'GEOPOLITICAL',
    compositeIndices: ['GTRP', 'MSC'],
    compositeWeight: 0.30,
    minOI: 200_000,
    maxSpread: 0.10,
    minDaysToExpiry: 7,
    minVolume24h: 10_000,
    priority: 1,
    refreshStrategy: 'POLLING_15MIN',
    calendarKeywords: ['Russia', 'Ukraine', 'geopolitical', 'conflict'],
    description: 'Will Russia-Ukraine ceasefire happen in 2025?',
  },
  {
    slug: 'iran-nuclear-deal-2025',
    category: 'GEOPOLITICAL',
    compositeIndices: ['GTRP'],
    compositeWeight: 0.15,
    minOI: 100_000,
    maxSpread: 0.12,
    minDaysToExpiry: 14,
    minVolume24h: 5_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['Iran', 'nuclear', 'Middle East'],
    description: 'Will Iran nuclear deal be reached in 2025?',
  },
  {
    slug: 'nato-article-5-2025',
    category: 'GEOPOLITICAL',
    compositeIndices: ['GTRP'],
    compositeWeight: 0.20,
    minOI: 50_000,
    maxSpread: 0.15,
    minDaysToExpiry: 30,
    minVolume24h: 2_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['NATO', 'Article 5', 'military conflict'],
    description: 'Will NATO invoke Article 5 in 2025?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — TRADE WAR
// ─────────────────────────────────────────────────────────────────────────────

export const TRADE_WAR_MARKETS = [
  {
    slug: 'us-china-tariff-escalation-2025',
    category: 'TRADE_WAR',
    compositeIndices: ['GTRP', 'MSC'],
    compositeWeight: 0.25,
    minOI: 100_000,
    maxSpread: 0.12,
    minDaysToExpiry: 14,
    minVolume24h: 5_000,
    priority: 1,
    refreshStrategy: 'POLLING_15MIN',
    calendarKeywords: ['tariff', 'trade war', 'China', 'customs', 'trade policy'],
    description: 'Will US-China tariff escalation continue in 2025?',
  },
  {
    slug: 'us-tariffs-above-25-percent',
    category: 'TRADE_WAR',
    compositeIndices: ['GTRP'],
    compositeWeight: 0.20,
    minOI: 50_000,
    maxSpread: 0.15,
    minDaysToExpiry: 14,
    minVolume24h: 2_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['tariff', 'trade policy', 'import duty'],
    description: 'Will average US tariffs remain above 25%?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — FISCAL / DEBT
// ─────────────────────────────────────────────────────────────────────────────

export const FISCAL_DEBT_MARKETS = [
  {
    slug: 'us-government-shutdown-2025',
    category: 'FISCAL_DEBT',
    compositeIndices: ['MSC'],
    compositeWeight: 0.20,
    minOI: 100_000,
    maxSpread: 0.10,
    minDaysToExpiry: 3,
    minVolume24h: 5_000,
    priority: 1,
    refreshStrategy: 'REALTIME_WS',
    calendarKeywords: ['government shutdown', 'continuing resolution', 'fiscal'],
    description: 'Will there be a US government shutdown in 2025?',
  },
  {
    slug: 'us-debt-ceiling-deal-2025',
    category: 'FISCAL_DEBT',
    compositeIndices: ['MSC'],
    compositeWeight: 0.25,
    minOI: 100_000,
    maxSpread: 0.10,
    minDaysToExpiry: 3,
    minVolume24h: 5_000,
    priority: 1,
    refreshStrategy: 'REALTIME_WS',
    calendarKeywords: ['debt ceiling', 'Treasury', 'X-date', 'default'],
    description: 'Will US debt ceiling deal be reached before X-date?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — INFLATION
// ─────────────────────────────────────────────────────────────────────────────

export const INFLATION_MARKETS = [
  {
    slug: 'cpi-below-3-percent-2025',
    category: 'INFLATION',
    compositeIndices: ['PUI'],
    compositeWeight: 0.15,
    minOI: 50_000,
    maxSpread: 0.15,
    minDaysToExpiry: 14,
    minVolume24h: 2_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['CPI', 'inflation', 'consumer price', 'PCE'],
    description: 'Will CPI fall below 3% in 2025?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MASTER REGISTRY — all Tier 1 + Tier 2 markets
// ─────────────────────────────────────────────────────────────────────────────

export const INITIAL_REGISTRY = [
  ...FED_POLICY_MARKETS,
  ...RECESSION_MARKETS,
  ...GEOPOLITICAL_MARKETS,
  ...TRADE_WAR_MARKETS,
  ...FISCAL_DEBT_MARKETS,
  ...INFLATION_MARKETS,
];

// ─────────────────────────────────────────────────────────────────────────────
// GEOPOLITICAL SUBCATEGORY WEIGHTS (for GTRP calculation)
// ─────────────────────────────────────────────────────────────────────────────

export const GEOPOLITICAL_WEIGHTS = {
  active_conflict_escalation: 0.35,
  trade_war_escalation: 0.30,
  nuclear_systemic_risk: 0.20,
  diplomatic_breakdown: 0.15,
};

// Maps slugs to geopolitical subcategories
export const SLUG_GEOCATEGORY_MAP = {
  'russia-ukraine-ceasefire-2025': 'active_conflict_escalation',
  'nato-article-5-2025': 'active_conflict_escalation',
  'iran-nuclear-deal-2025': 'nuclear_systemic_risk',
  'us-china-tariff-escalation-2025': 'trade_war_escalation',
  'us-tariffs-above-25-percent': 'trade_war_escalation',
};

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR EVENT → SLUGS (pre-event monitoring)
// ─────────────────────────────────────────────────────────────────────────────

export const CALENDAR_TO_POLYMARKET_MAP = {
  'FOMC': ['fed-rate-cut-june-2025', 'fed-rate-cut-july-2025', 'fed-rate-cuts-2025'],
  'CPI':  ['cpi-below-3-percent-2025'],
  'NFP':  [],
  'GDP':  ['us-recession-2025', 'us-gdp-negative-q2-2025'],
  'PCE':  ['cpi-below-3-percent-2025'],
};
