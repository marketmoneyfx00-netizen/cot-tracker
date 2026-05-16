// api/rates/refresh.js
// Called by Vercel Cron (GET /api/rates/refresh) every 12 hours.
// Fetches G10 central bank policy rates from FRED and upserts into Supabase.
// Protected by CRON_SECRET env var — Vercel injects it as Authorization header.

import { supabaseAdmin } from '../_lib/supabase/admin.js';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_KEY  = process.env.FRED_API_KEY || '';

// Max movement allowed in a single rate decision (basis points).
// Larger moves are flagged as suspicious and blocked.
const MAX_DELTA_BPS = 200;

// FRED series per bank. Daily series give exact decision dates;
// monthly OECD series (IRSTCI01*) are used where no daily equivalent exists.
// Series selection rationale:
// - FED/BCE: native daily series from FRED → exact decision dates, always current
// - Others: switched from deprecated IRSTCI01* (OECD, 60-90 day lag) to
//   more frequently updated FRED alternatives where available.
//   BOE uses BOERUKQ (quarterly, published ~1 month lag)
//   SNB/RBNZ/RIX: IRSTCI01 series are no longer updated on FRED — kept as fallback
//   but data will not advance beyond their last known date.
const BANK_SERIES = {
  FED:  { id: 'DFEDTARU',          freq: 'daily',   limit: 3000 },
  BCE:  { id: 'ECBDFR',            freq: 'daily',   limit: 3000 },
  BOE:  { id: 'BOERUKQ',           freq: 'monthly', limit: 240 },  // BoE official rate (quarterly → monthly published)
  BOJ:  { id: 'IRSTCI01JPM156N',   freq: 'monthly', limit: 240 },
  SNB:  { id: 'IRSTCI01CHM156N',   freq: 'monthly', limit: 240 },
  RBA:  { id: 'IRSTCI01AUM156N',   freq: 'monthly', limit: 240 },
  BOC:  { id: 'IRSTCI01CAM156N',   freq: 'monthly', limit: 240 },
  RBNZ: { id: 'IRSTCI01NZM156N',   freq: 'monthly', limit: 240 },
  NB:   { id: 'IRSTCI01NOM156N',   freq: 'monthly', limit: 240 },
  RIX:  { id: 'IRSTCI01SEM156N',   freq: 'monthly', limit: 240 },
};

function signalLabel(rate, prevRate) {
  if (prevRate == null) return 'NEUTRO';
  const delta = rate - prevRate;
  if (delta > 0.05)  return 'RESTRICTIVO';
  if (delta < -0.05) return 'ACOMODATICIO';
  return 'NEUTRO';
}

function decisionLabel(rate, prevRate) {
  if (prevRate == null || Math.abs(rate - prevRate) < 0.005) return 'Sin cambios';
  const pb = Math.round((rate - prevRate) * 100);
  return pb > 0 ? `Subida ${pb} pb` : `Recorte ${Math.abs(pb)} pb`;
}

// Fetch observations from FRED and return only rate-change points.
// For daily series this gives exact meeting dates; for monthly it gives YYYY-MM-01.
async function fetchChangePoints(seriesCfg) {
  const params = new URLSearchParams({
    series_id:  seriesCfg.id,
    api_key:    FRED_KEY,
    file_type:  'json',
    sort_order: 'desc',              // desc → get most recent observations first
    limit:      String(seriesCfg.limit),
  });

  const res = await fetch(`${FRED_BASE}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesCfg.id}`);

  const { observations } = await res.json();
  if (!Array.isArray(observations)) throw new Error(`Bad FRED response for ${seriesCfg.id}`);

  // Reverse so we process oldest → newest (needed for change-point detection)
  observations.reverse();

  const points = [];
  let lastValue = null;

  for (const obs of observations) {
    if (obs.value === '.' || obs.value === '') continue;
    const val = parseFloat(obs.value);
    if (isNaN(val)) continue;

    if (lastValue === null || Math.abs(val - lastValue) >= 0.005) {
      points.push({ date: obs.date, rate: parseFloat(val.toFixed(3)) });
      lastValue = val;
    }
  }

  // Always include the most recent observation (even if rate hasn't changed)
  // so we have a current-rate record in the DB.
  const lastObs = observations.filter(o => o.value !== '.' && o.value !== '').at(-1);
  if (lastObs) {
    const lastRate = parseFloat(parseFloat(lastObs.value).toFixed(3));
    const alreadyIncluded = points.some(p => p.date === lastObs.date);
    if (!alreadyIncluded) {
      points.push({ date: lastObs.date, rate: lastRate });
    }
  }

  return points;
}

// Sanity check: block any move larger than MAX_DELTA_BPS basis points.
async function sanityCheck(bankId, newRate) {
  const { data } = await supabaseAdmin
    .from('central_bank_rates')
    .select('rate')
    .eq('bank_id', bankId)
    .order('decision_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { ok: true };

  const deltaBps = Math.abs(newRate - data.rate) * 100;
  if (deltaBps > MAX_DELTA_BPS) {
    return {
      ok: false,
      prev: data.rate,
      new: newRate,
      deltaBps,
      reason: `Delta ${deltaBps.toFixed(0)} pb supera límite ${MAX_DELTA_BPS} pb`,
    };
  }
  return { ok: true };
}

async function alertAdmin(bankId, check, seriesId) {
  if (!process.env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM_EMAIL,
      to:      [process.env.RESEND_REPLY_EMAIL],
      subject: `[COT Tracker] ALERTA: dato sospechoso en ${bankId}`,
      html: `<p><b>Banco:</b> ${bankId}</p>
             <p><b>Tasa anterior:</b> ${check.prev}%</p>
             <p><b>Tasa nueva (bloqueada):</b> ${check.new}%</p>
             <p><b>Variación:</b> ${check.deltaBps?.toFixed(0)} pb</p>
             <p><b>Serie FRED:</b> ${seriesId}</p>
             <p>Revisa el dato manualmente en <a href="https://fred.stlouisfed.org/series/${seriesId}">FRED</a>.</p>`,
    }),
  }).catch(e => console.error('[rates/refresh] Alert email failed:', e.message));
}

export default async function handler(req, res) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers['authorization'] ?? '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = { updated: [], skipped: [], errors: [] };

  for (const [bankId, seriesCfg] of Object.entries(BANK_SERIES)) {
    try {
      const points = await fetchChangePoints(seriesCfg);
      if (!points.length) {
        results.errors.push({ bankId, reason: 'No data points from FRED' });
        continue;
      }

      for (const point of points) {
        // Skip if already in DB
        const { data: existing, error: existingErr } = await supabaseAdmin
          .from('central_bank_rates')
          .select('id')
          .eq('bank_id', bankId)
          .eq('decision_date', point.date)
          .maybeSingle();

        if (existingErr) {
          results.errors.push({ bankId, date: point.date, reason: existingErr.message, code: existingErr.code, step: 'check_existing' });
          continue;
        }
        if (existing) {
          results.skipped.push(`${bankId}:${point.date}`);
          continue;
        }

        // Sanity check only for the latest point (largest potential jump)
        const isLatest = point === points.at(-1);
        if (isLatest) {
          const check = await sanityCheck(bankId, point.rate);
          if (!check.ok) {
            results.errors.push({ bankId, date: point.date, ...check });
            await alertAdmin(bankId, check, seriesCfg.id);
            continue;
          }
        }

        // Fetch previous rate for labels
        const { data: prev } = await supabaseAdmin
          .from('central_bank_rates')
          .select('rate')
          .eq('bank_id', bankId)
          .lt('decision_date', point.date)
          .order('decision_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const prevRate = prev?.rate ?? null;

        const { error: insertErr } = await supabaseAdmin
          .from('central_bank_rates')
          .insert({
            bank_id:          bankId,
            rate:             point.rate,
            previous_rate:    prevRate,
            decision_date: point.date,
            decision_label:   decisionLabel(point.rate, prevRate),
            signal_label:     signalLabel(point.rate, prevRate),
            source:           'FRED',
            fetched_at:       new Date().toISOString(),
          });

        if (insertErr) {
          if (insertErr.code === '23505') {
            // Race condition: another process inserted simultaneously — safe to ignore
            results.skipped.push(`${bankId}:${point.date}:duplicate`);
          } else {
            results.errors.push({
              bankId,
              date:    point.date,
              reason:  insertErr.message,
              code:    insertErr.code,
              details: insertErr.details ?? null,
              hint:    insertErr.hint   ?? null,
            });
          }
        } else {
          results.updated.push(`${bankId}:${point.date}:${point.rate}%`);
        }
      }
    } catch (err) {
      console.error(`[rates/refresh] ${bankId}:`, err.message);
      results.errors.push({ bankId, reason: err.message });
    }
  }

  console.log('[rates/refresh]', JSON.stringify(results));
  return res.status(200).json(results);
}
