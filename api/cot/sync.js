/**
 * api/cot/sync.js — COT Auto-Sync Job
 *
 * Triggered by Vercel Cron every Friday at 22:00 UTC.
 * Can also be triggered manually via POST with the same CRON_SECRET header.
 */

import { unzipSync } from 'fflate';
import { supabaseAdmin } from '../_lib/supabase/admin.js';
import { buildPairsData, parseTiffCombined, parseDisaggregated, detectCftcFileType } from '../_lib/cotParser.js';

const CFTC_YEAR = new Date().getUTCFullYear();
const CFTC_URLS = {
  futures_only:  `https://www.cftc.gov/files/dea/history/fut_fin_txt_${CFTC_YEAR}.zip`,
  combined:      `https://www.cftc.gov/files/dea/history/com_fin_txt_${CFTC_YEAR}.zip`,
  disaggregated: `https://www.cftc.gov/files/dea/history/com_disagg_txt_${CFTC_YEAR}.zip`,
};

async function fetchAndExtract(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'COTTracker/1.0 (automated; contact marketmoneyfx00@gmail.com)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`CFTC fetch failed: ${res.status} ${res.statusText} — ${url}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);
  const entries = Object.values(files);
  if (entries.length === 0) throw new Error(`ZIP vacio desde ${url}`);

  return new TextDecoder('utf-8').decode(entries[0]);
}

function latestDateFromPairs(pairsData) {
  let best = '';
  for (const p of pairsData) {
    const d = p.latest?.isoDate || p.weeks?.[0]?.isoDate || '';
    if (d > best) best = d;
  }
  return best || null;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', 'application/json');

  let runId = null;
  try {
    const { data: run, error: runErr } = await supabaseAdmin
      .from('cot_sync_runs')
      .insert({ status: 'running' })
      .select('id')
      .single();
    if (runErr) throw runErr;
    runId = run.id;
  } catch (e) {
    console.error('[cot/sync] Failed to create sync run:', e.message);
  }

  const updateRun = async (patch) => {
    if (!runId) return;
    try {
      await supabaseAdmin
        .from('cot_sync_runs')
        .update({ ...patch, completed_at: new Date().toISOString() })
        .eq('id', runId);
    } catch { /* fire-and-forget */ }
  };

  try {
    let filesDownloaded = 0;
    let reportDate = null;
    const results = {};

    // Futures Only
    try {
      console.log('[cot/sync] Downloading Futures Only...');
      const csvText = await fetchAndExtract(CFTC_URLS.futures_only);
      const pairsData = buildPairsData(csvText);
      reportDate = latestDateFromPairs(pairsData);

      if (reportDate) {
        const { error: upsertErr } = await supabaseAdmin
          .from('cot_reports')
          .upsert({
            report_type: 'futures_only',
            report_date: reportDate,
            downloaded_at: new Date().toISOString(),
            parsed_data: pairsData,
            asset_count: pairsData.length,
          }, { onConflict: 'report_type,report_date', ignoreDuplicates: true });

        if (upsertErr) throw upsertErr;
        filesDownloaded++;
        results.futures_only = { ok: true, pairs: pairsData.length, date: reportDate };
        console.log(`[cot/sync] Futures Only OK — ${pairsData.length} pairs, date ${reportDate}`);
      }
    } catch (e) {
      console.error('[cot/sync] Futures Only failed:', e.message);
      results.futures_only = { ok: false, error: e.message };
    }

    // Combined
    try {
      console.log('[cot/sync] Downloading Combined...');
      const csvText = await fetchAndExtract(CFTC_URLS.combined);

      const fileType = detectCftcFileType(csvText);
      if (fileType !== 'combined') throw new Error(`Unexpected file type: ${fileType}`);

      const combinedData = parseTiffCombined(csvText);
      const combinedDate = combinedData.reportDate || reportDate;

      if (combinedDate) {
        const { error: upsertErr } = await supabaseAdmin
          .from('cot_reports')
          .upsert({
            report_type: 'combined',
            report_date: combinedDate,
            downloaded_at: new Date().toISOString(),
            parsed_data: combinedData,
            asset_count: combinedData.assetCount,
          }, { onConflict: 'report_type,report_date', ignoreDuplicates: true });

        if (upsertErr) throw upsertErr;
        filesDownloaded++;
        results.combined = { ok: true, assets: combinedData.assetCount, date: combinedDate };
        console.log(`[cot/sync] Combined OK — ${combinedData.assetCount} assets, date ${combinedDate}`);
      }
    } catch (e) {
      console.error('[cot/sync] Combined failed:', e.message);
      results.combined = { ok: false, error: e.message };
    }

    // Disaggregated (gold + commodities)
    try {
      console.log('[cot/sync] Downloading Disaggregated...');
      const csvText = await fetchAndExtract(CFTC_URLS.disaggregated);

      const fileType = detectCftcFileType(csvText);
      if (fileType !== 'disaggregated') throw new Error(`Unexpected file type: ${fileType}`);

      const disaggData = parseDisaggregated(csvText);
      const disaggDate = disaggData.reportDate || reportDate;

      if (disaggDate) {
        const { error: upsertErr } = await supabaseAdmin
          .from('cot_reports')
          .upsert({
            report_type:   'disaggregated',
            report_date:   disaggDate,
            downloaded_at: new Date().toISOString(),
            parsed_data:   disaggData,
            asset_count:   disaggData.assetCount,
          }, { onConflict: 'report_type,report_date', ignoreDuplicates: true });

        if (upsertErr) throw upsertErr;
        filesDownloaded++;
        results.disaggregated = { ok: true, assets: disaggData.assetCount, date: disaggDate };
        console.log(`[cot/sync] Disaggregated OK — ${disaggData.assetCount} assets, date ${disaggDate}`);
      }
    } catch (e) {
      console.error('[cot/sync] Disaggregated failed:', e.message);
      results.disaggregated = { ok: false, error: e.message };
    }

    await updateRun({
      status: filesDownloaded > 0 ? 'completed' : 'failed',
      report_date: reportDate,
      files_downloaded: filesDownloaded,
    });

    return res.status(200).json({ ok: true, filesDownloaded, reportDate, results });

  } catch (err) {
    console.error('[cot/sync] Fatal error:', err.message);
    await updateRun({ status: 'failed', error_message: err.message.slice(0, 500) });
    return res.status(200).json({ ok: false, error: err.message });
  }
}
