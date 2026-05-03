const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_KEY  = process.env.FRED_API_KEY || '';

const SERIES = {
  US10Y: 'DGS10',
  US2Y:  'DGS2',
  DE10Y: 'IRLTLT01DEM156N',
  UK10Y: 'IRLTLT01GBM156N',
  JP10Y: 'IRLTLT01JPM156N',
  CN10Y: 'IRLTLT01CNM156N',
};

async function fetchSeries(seriesId) {
  try {
    const params = new URLSearchParams({
      series_id:  seriesId,
      api_key:    FRED_KEY,
      file_type:  'json',
      sort_order: 'desc',
      limit:      '20',
    });

    const res = await fetch(`${FRED_BASE}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[getYields] HTTP ${res.status} for ${seriesId}`);
      return null;
    }

    const data = await res.json();
    const obs  = Array.isArray(data?.observations) ? data.observations : [];

    const valid = [];
    for (const o of obs) {
      if (valid.length === 2) break;
      const v = parseFloat(o.value);
      if (!isNaN(v)) valid.push(parseFloat(v.toFixed(4)));
    }

    if (valid.length === 0) {
      console.warn(`[getYields] No valid observations for ${seriesId}`);
      return null;
    }

    return {
      current: valid[0],
      prev:    valid[1] ?? null,
    };

  } catch (err) {
    console.error(`[getYields] fetchSeries failed for ${seriesId}:`, err.message);
    return null;
  }
}

async function getYields() {
  const keys = ['US10Y', 'US2Y', 'DE10Y', 'UK10Y', 'JP10Y', 'CN10Y'];
  const results = await Promise.all(keys.map((key) => fetchSeries(SERIES[key])));
  return Object.fromEntries(keys.map((key, i) => [key, results[i]]));
}

module.exports = { getYields };
