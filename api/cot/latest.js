/**
 * api/cot/latest.js — Serve latest parsed COT data
 *
 * GET /api/cot/latest
 *
 * Returns:
 *  { pairsData, source, combinedData, sourceCombined, lastSync }
 */

import { supabaseAdmin } from '../_lib/supabase/admin.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.FRONTEND_ORIGIN || 'https://app.cot-tracker.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [futRes, comRes, disaggRes, runRes] = await Promise.all([
      supabaseAdmin
        .from('cot_reports')
        .select('parsed_data, report_date, downloaded_at, asset_count')
        .eq('report_type', 'futures_only')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabaseAdmin
        .from('cot_reports')
        .select('parsed_data, report_date, downloaded_at, asset_count')
        .eq('report_type', 'combined')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabaseAdmin
        .from('cot_reports')
        .select('parsed_data, report_date, downloaded_at, asset_count')
        .eq('report_type', 'disaggregated')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabaseAdmin
        .from('cot_sync_runs')
        .select('started_at, completed_at, status, report_date, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const fut   = futRes.data;
    const com   = comRes.data;
    const disagg= disaggRes.data;
    const run   = runRes.data;

    const payload = {
      pairsData:          fut?.parsed_data    ?? null,
      source:             fut ? `Auto-sync ${fut.report_date}` : null,
      combinedData:       com?.parsed_data    ?? null,
      sourceCombined:     com ? `Auto-sync ${com.report_date}` : null,
      disaggregatedData:  disagg?.parsed_data ?? null,
      sourceDisaggregated:disagg ? `Auto-sync ${disagg.report_date}` : null,
      lastSync: {
        at:           run?.completed_at ?? run?.started_at ?? null,
        status:       run?.status       ?? 'never',
        reportDate:   run?.report_date  ?? fut?.report_date ?? null,
        errorMessage: run?.error_message ?? null,
      },
    };

    return res.status(200).json(payload);

  } catch (err) {
    console.error('[cot/latest] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
