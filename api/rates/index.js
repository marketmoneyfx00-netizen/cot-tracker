// api/rates/index.js
// Serves central bank rate data to InterestRatePanel.jsx.
// Reads from central_bank_rates (Supabase), populated by api/rates/refresh.js.
// Auth-protected (requires valid Supabase JWT).

import { supabaseAdmin } from '../_lib/supabase/admin.js';
import { verifyAuth }    from '../_lib/auth-middleware.js';

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

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

  // Fetch all historical rows (for chart) ordered asc, then we'll slice for decisions
  const { data, error } = await supabaseAdmin
    .from('central_bank_rates')
    .select('bank_id, rate, previous_rate, decision_date, decision_label, signal_label')
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
    // DB not yet seeded — return empty so frontend falls back to static data
    res.setHeader('X-Rates-Cache', 'EMPTY');
    return res.status(200).json({ timestamp: new Date().toISOString(), banks: {} });
  }

  // Group rows by bank_id
  const groups = {};
  for (const row of data) {
    if (!groups[row.bank_id]) groups[row.bank_id] = [];
    groups[row.bank_id].push(row);
  }

  const banks = {};
  for (const [bankId, rows] of Object.entries(groups)) {
    const latest   = rows.at(-1);
    const prev     = rows.at(-2);

    // history: all change points formatted for the SVG chart (d: 'YYYY-MM')
    const history = rows.map(r => ({
      d: r.decision_date.slice(0, 7), // 'YYYY-MM'
      r: parseFloat(r.rate),
    }));

    // decisions: last 6 rows reversed (most-recent first), for the table
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
      current:     parseFloat(latest.rate),
      previous:    prev ? parseFloat(prev.rate) : parseFloat(latest.rate),
      signalLabel: latest.signal_label ?? 'NEUTRO',
      lastDate:    latest.decision_date,
      history,
      decisions,
    };
  }

  const payload = {
    timestamp: new Date().toISOString(),
    banks,
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
