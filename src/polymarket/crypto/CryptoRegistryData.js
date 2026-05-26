// =============================================================================
// POLYMARKET × COT TRACKER — CRYPTO INTELLIGENCE REGISTRY
// src/polymarket/crypto/CryptoRegistryData.js
//
// Institutional-only crypto markets. Focused exclusively on:
//   • Regulatory regime and policy uncertainty (CRR)
//   • ETF flows and institutional adoption (CESI)
//   • Stablecoin systemic risk (SSI)
//
// NOT included: price prediction, retail sentiment, memecoins, altcoins.
// The crypto layer contextualizes macro regime — it does NOT predict crypto prices.
//
// Slugs are resolved at startup via MarketRegistry.resolveAdditional().
// Markets that don't resolve (expired/renamed) are silently skipped.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO REGULATORY REGIME MARKETS (→ CRR)
// ─────────────────────────────────────────────────────────────────────────────

export const CRYPTO_REGULATION_MARKETS = [
  {
    slug: 'us-crypto-regulatory-framework-2025',
    category: 'CRYPTO_REGULATION',
    compositeIndices: ['CRR'],
    compositeWeight: 0.40,
    minOI: 30_000,
    maxSpread: 0.18,
    minDaysToExpiry: 14,
    minVolume24h: 1_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['crypto regulation', 'SEC', 'digital assets', 'crypto bill', 'FIT21'],
    description: 'Will the US pass comprehensive crypto market structure legislation in 2025?',
    riskReducing: true, // YES = clarity = lower regulatory risk
  },
  {
    slug: 'stablecoin-legislation-2025',
    category: 'CRYPTO_REGULATION',
    compositeIndices: ['CRR', 'SSI'],
    compositeWeight: 0.30,
    minOI: 20_000,
    maxSpread: 0.20,
    minDaysToExpiry: 14,
    minVolume24h: 500,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['stablecoin', 'GENIUS Act', 'stablecoin bill', 'digital dollar'],
    description: 'Will the US pass stablecoin regulation (GENIUS Act or equivalent) in 2025?',
    riskReducing: true,
  },
  {
    slug: 'bitcoin-strategic-reserve-2025',
    category: 'CRYPTO_REGULATION',
    compositeIndices: ['CRR'],
    compositeWeight: 0.30,
    minOI: 30_000,
    maxSpread: 0.18,
    minDaysToExpiry: 30,
    minVolume24h: 1_000,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['bitcoin reserve', 'strategic bitcoin reserve', 'BTC government'],
    description: 'Will the US government establish a bitcoin strategic reserve in 2025?',
    riskReducing: false, // outcome itself uncertain — political signal, not clarity
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO ETF / INSTITUTIONAL ADOPTION MARKETS (→ CESI)
// ─────────────────────────────────────────────────────────────────────────────

export const CRYPTO_ETF_MARKETS = [
  {
    slug: 'bitcoin-etf-10b-inflows-2025',
    category: 'CRYPTO_ETF',
    compositeIndices: ['CESI'],
    compositeWeight: 0.55,
    minOI: 20_000,
    maxSpread: 0.20,
    minDaysToExpiry: 14,
    minVolume24h: 500,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['bitcoin ETF', 'BTC ETF', 'IBIT', 'spot bitcoin', 'ETF flows'],
    description: 'Will spot Bitcoin ETFs exceed $10B net inflows in 2025?',
  },
  {
    slug: 'ethereum-etf-staking-approval-2025',
    category: 'CRYPTO_ETF',
    compositeIndices: ['CESI'],
    compositeWeight: 0.45,
    minOI: 10_000,
    maxSpread: 0.22,
    minDaysToExpiry: 14,
    minVolume24h: 300,
    priority: 3,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['ethereum ETF', 'ETH ETF', 'staking', 'SEC Ethereum'],
    description: 'Will SEC approve Ethereum ETF staking in 2025?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// STABLECOIN SYSTEMIC RISK MARKETS (→ SSI)
// ─────────────────────────────────────────────────────────────────────────────

export const CRYPTO_STABLECOIN_MARKETS = [
  {
    slug: 'tether-depeg-2025',
    category: 'CRYPTO_STABLECOIN',
    compositeIndices: ['SSI'],
    compositeWeight: 0.65,
    minOI: 10_000,
    maxSpread: 0.22,
    minDaysToExpiry: 30,
    minVolume24h: 300,
    priority: 2,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['USDT', 'Tether', 'stablecoin depeg', 'USDT peg'],
    description: 'Will Tether (USDT) lose its dollar peg (>2% deviation) in 2025?',
  },
  {
    slug: 'usdc-depeg-2025',
    category: 'CRYPTO_STABLECOIN',
    compositeIndices: ['SSI'],
    compositeWeight: 0.35,
    minOI: 5_000,
    maxSpread: 0.25,
    minDaysToExpiry: 30,
    minVolume24h: 100,
    priority: 3,
    refreshStrategy: 'BATCH_DAILY',
    calendarKeywords: ['USDC', 'Circle', 'stablecoin', 'depeg'],
    description: 'Will USDC lose its dollar peg in 2025?',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MASTER CRYPTO REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const CRYPTO_REGISTRY = [
  ...CRYPTO_REGULATION_MARKETS,
  ...CRYPTO_ETF_MARKETS,
  ...CRYPTO_STABLECOIN_MARKETS,
];

// Calendar keywords → slugs for pre-event monitoring
export const CRYPTO_CALENDAR_MAP = {
  'CRYPTO_REGULATION': [
    'us-crypto-regulatory-framework-2025',
    'stablecoin-legislation-2025',
  ],
  'BITCOIN_ETF': [
    'bitcoin-etf-10b-inflows-2025',
    'ethereum-etf-staking-approval-2025',
  ],
};

// Slug → geopolitical-equivalent subcategory for SSI display
export const CRYPTO_STABLECOIN_SLUGS = new Set([
  'tether-depeg-2025',
  'usdc-depeg-2025',
]);
