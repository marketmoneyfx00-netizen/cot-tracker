// api/rates/index.js
// Serves central bank rate data + carry differentials to InterestRatePanel.jsx.
// Reads from central_bank_rates (Supabase), populated by api/rates/refresh.js.
// Auth-protected (requires valid Supabase JWT).

import { supabaseAdmin } from '../_lib/supabase/admin.js';
import { verifyAuth }    from '../_lib/auth-middleware.js';

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Stance computation (on-the-fly, not relying on stored stance_label) ───────
function computeStanceFromRates(rate, prevRate) {
  if (prevRate == null) return { score: 0, label: 'Neutral' };
  const bps = Math.round((rate - prevRate) * 100);
  if (bps >= 75)  return { score: 5,  label: 'Extremadamente Restrictivo' };
  if (bps >= 25)  return { score: 3,  label: 'Restrictivo' };
  if (bps === 0)  return { score: 0,  label: 'Neutral' };
  if (bps >= -50) return { score: -3, label: 'Expansivo' };
  return              { score: -5, label: 'Expansivo Agresivo' };
}

// ── Freshness engine (TAREA 0.2) ─────────────────────────────────────────────
// Computes LIVE / DELAYED / STALE / ERROR based on minutes since last DB write.
function freshnessStatus(fetched_at) {
  if (!fetched_at) return 'ERROR';
  const mins = (Date.now() - new Date(fetched_at).getTime()) / 60_000;
  if (mins > 1440) return 'STALE';    // > 24 h
  if (mins > 180)  return 'DELAYED';  // > 3 h
  return 'LIVE';
}

// ── Interest Rate Differential Engine (TAREA 1.2) ────────────────────────────
// Computes carry direction and normalised score for each FX pair.
// carry_direction: 'long_base' | 'long_quote' | 'neutral'
// carry_score:     proportional to |rate_diff_bps|, capped at ±10

const FX_PAIRS = [
  { pair: 'EURUSD', base: 'EUR', quote: 'USD', base_bank: 'BCE',  quote_bank: 'FED'  },
  { pair: 'GBPUSD', base: 'GBP', quote: 'USD', base_bank: 'BOE',  quote_bank: 'FED'  },
  { pair: 'USDJPY', base: 'USD', quote: 'JPY', base_bank: 'FED',  quote_bank: 'BOJ'  },
  { pair: 'USDCHF', base: 'USD', quote: 'CHF', base_bank: 'FED',  quote_bank: 'SNB'  },
  { pair: 'AUDUSD', base: 'AUD', quote: 'USD', base_bank: 'RBA',  quote_bank: 'FED'  },
  { pair: 'NZDUSD', base: 'NZD', quote: 'USD', base_bank: 'RBNZ', quote_bank: 'FED'  },
  { pair: 'USDCAD', base: 'USD', quote: 'CAD', base_bank: 'FED',  quote_bank: 'BOC'  },
  { pair: 'GBPJPY', base: 'GBP', quote: 'JPY', base_bank: 'BOE',  quote_bank: 'BOJ'  },
  { pair: 'EURJPY', base: 'EUR', quote: 'JPY', base_bank: 'BCE',  quote_bank: 'BOJ'  },
  { pair: 'EURGBP', base: 'EUR', quote: 'GBP', base_bank: 'BCE',  quote_bank: 'BOE'  },
  { pair: 'AUDCAD', base: 'AUD', quote: 'CAD', base_bank: 'RBA',  quote_bank: 'BOC'  },
  { pair: 'AUDNZD', base: 'AUD', quote: 'NZD', base_bank: 'RBA',  quote_bank: 'RBNZ' },
];

// banks: the already-built per-bank summaries (contains stanceScore per bank_id)
function buildDifferentials(latestRates, banks = {}) {
  return FX_PAIRS.map(({ pair, base, quote, base_bank, quote_bank }) => {
    const baseRate  = latestRates[base_bank];
    const quoteRate = latestRates[quote_bank];

    // Stance scores from the CB summaries — positive = hawkish, negative = dovish
    const base_stance  = banks[base_bank]?.stanceScore  ?? 0;
    const quote_stance = banks[quote_bank]?.stanceScore ?? 0;
    // stanceDivergence > 0 → base CB more hawkish → structurally bullish for pair
    const stance_divergence = parseFloat((base_stance - quote_stance).toFixed(1));

    if (baseRate == null || quoteRate == null) {
      return { pair, base_currency: base, quote_currency: quote, base_bank, quote_bank,
               base_rate: null, quote_rate: null, rate_diff_bps: null,
               carry_direction: 'neutral', carry_score: 0,
               base_stance, quote_stance, stance_divergence };
    }
    const diffBps       = Math.round((baseRate - quoteRate) * 100);
    const carry_score   = parseFloat(Math.min(10, Math.max(-10, diffBps / 50)).toFixed(2));
    const carry_direction = diffBps > 10 ? 'long_base' : diffBps < -10 ? 'long_quote' : 'neutral';
    return { pair, base_currency: base, quote_currency: quote, base_bank, quote_bank,
             base_rate: baseRate, quote_rate: quoteRate, rate_diff_bps: diffBps,
             carry_direction, carry_score,
             base_stance, quote_stance, stance_divergence };
  });
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://app.cot-tracker.com';
  res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { user } = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL_MS) {
    res.setHeader('X-Rates-Cache', 'HIT');
    return res.status(200).json(_cache);
  }

  const { data, error } = await supabaseAdmin
    .from('central_bank_rates')
    .select(
      'bank_id, rate, previous_rate, decision_date, decision_label, signal_label,' +
      ' rate_type, rate_low, rate_mid, rate_high, stance_score, stance_label,' +
      ' change_bps, fetched_at'
    )
    .order('decision_date', { ascending: true });

  if (error) {
    console.error('[rates] Supabase error:', error.message);
    if (_cache) {
      res.setHeader('X-Rates-Cache', 'STALE');
      return res.status(200).json({ ..._cache, stale: true });
    }
    return res.status(503).json({ error: 'Central bank rates unavailable' });
  }

  if (!data?.length) {
    res.setHeader('X-Rates-Cache', 'EMPTY');
    return res.status(200).json({ timestamp: new Date().toISOString(), banks: {}, pairs: [] });
  }

  // ── Build per-bank summaries ──────────────────────────────────────────────
  const groups = {};
  for (const row of data) {
    if (!groups[row.bank_id]) groups[row.bank_id] = [];
    groups[row.bank_id].push(row);
  }

  const banks       = {};
  const latestRates = {};

  for (const [bankId, rows] of Object.entries(groups)) {
    const latest = rows.at(-1);
    const prev   = rows.at(-2);

    latestRates[bankId] = parseFloat(latest.rate);

    // Compute stance from the last row where rate actually changed (not a hold snapshot)
    const lastRealChange = [...rows].reverse().find(
      r => r.previous_rate != null && Math.abs(parseFloat(r.rate) - parseFloat(r.previous_rate)) >= 0.005
    );
    const computedStance = lastRealChange
      ? computeStanceFromRates(parseFloat(lastRealChange.rate), parseFloat(lastRealChange.previous_rate))
      : { score: 0, label: 'Neutral' };

    const history = rows.map(r => ({
      d: r.decision_date.slice(0, 7),
      r: parseFloat(r.rate),
    }));

    const decisions = [...rows].reverse().slice(0, 6).map(r => ({
      date:     formatDate(r.decision_date),
      rate:     parseFloat(r.rate).toFixed(2) + '%',
      prev:     r.previous_rate != null ? parseFloat(r.previous_rate).toFixed(2) + '%' : '—',
      cons:     parseFloat(r.rate).toFixed(2) + '%',
      surp:     '0.00%',
      decision: r.decision_label ?? 'Sin cambios',
      impact:   3,
      bear:     r.previous_rate != null && r.rate < r.previous_rate,
      bull:     r.previous_rate != null && r.rate > r.previous_rate,
    }));

    banks[bankId] = {
      current:      parseFloat(latest.rate),
      previous:     prev ? parseFloat(prev.rate) : parseFloat(latest.rate),
      signalLabel:  latest.signal_label ?? 'NEUTRO',
      lastDate:     latest.decision_date,
      // Rate range (FED publishes upper bound; lower = rate - 25bps)
      rateType:     latest.rate_type   ?? 'single',
      rateLow:      latest.rate_low    != null ? parseFloat(latest.rate_low)  : parseFloat(latest.rate),
      rateMid:      latest.rate_mid    != null ? parseFloat(latest.rate_mid)  : parseFloat(latest.rate),
      rateHigh:     latest.rate_high   != null ? parseFloat(latest.rate_high) : parseFloat(latest.rate),
      // Hawkish / Dovish stance — computed from last real rate change, not stored nullable field
      stanceScore:  computedStance.score,
      stanceLabel:  computedStance.label,
      changeBps:    lastRealChange ? Math.round((parseFloat(lastRealChange.rate) - parseFloat(lastRealChange.previous_rate)) * 100) : 0,
      // Freshness (TAREA 0.2)
      freshness:    freshnessStatus(latest.fetched_at),
      fetchedAt:    latest.fetched_at,
      history,
      decisions,
    };
  }

  // ── Interest Rate Differential Engine (TAREA 1.2) ─────────────────────────
  const pairs = buildDifferentials(latestRates, banks);

  // Persist differentials to pair_rate_differentials (fire-and-forget)
  const diffRows = pairs
    .filter(p => p.base_rate != null && p.quote_rate != null)
    .map(p => ({
      pair:            p.pair,
      base_currency:   p.base_currency,
      quote_currency:  p.quote_currency,
      base_bank:       p.base_bank,
      quote_bank:      p.quote_bank,
      base_rate:       p.base_rate,
      quote_rate:      p.quote_rate,
      rate_diff_bps:   p.rate_diff_bps,
      carry_direction: p.carry_direction,
      carry_score:     p.carry_score,
      updated_at:      new Date().toISOString(),
    }));
  if (diffRows.length) {
    supabaseAdmin
      .from('pair_rate_differentials')
      .upsert(diffRows, { onConflict: 'pair' })
      .then(({ error: uErr }) => {
        if (uErr) console.error('[rates] pair_rate_differentials upsert error:', uErr.message);
      });
  }

  const payload = {
    timestamp: new Date().toISOString(),
    banks,
    pairs,
  };

  _cache   = payload;
  _cacheTs = now;

  res.setHeader('X-Rates-Cache', 'MISS');
  return res.status(200).json(payload);
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  const months = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[parseInt(m, 10)]} ${y}`;
}
