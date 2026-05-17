/**
 * api/_lib/cotParser.js
 *
 * Node.js port of the futures-only COT parser from src/App.jsx.
 * Also re-exports detectCftcFileType and parseTiffCombined from the shared module.
 */

export { detectCftcFileType, parseTiffCombined, parseDisaggregated, mergeCombinedData } from '../../src/parseTiffCombined.js';

const CONTRACT_MAP = [
  { keys: ["EURO FX - CHICAGO MERCANTILE", "EURO FX - CHICAGO"],                     pair: "EUR/USD",   cat: "fx", invert: false },
  { keys: ["BRITISH POUND - CHICAGO MERCANTILE", "BRITISH POUND - CHICAGO"],          pair: "GBP/USD",   cat: "fx", invert: false },
  { keys: ["JAPANESE YEN - CHICAGO MERCANTILE", "JAPANESE YEN - CHICAGO"],            pair: "USD/JPY",   cat: "fx", invert: true  },
  { keys: ["SWISS FRANC - CHICAGO MERCANTILE", "SWISS FRANC - CHICAGO"],              pair: "USD/CHF",   cat: "fx", invert: true  },
  { keys: ["CANADIAN DOLLAR - CHICAGO MERCANTILE", "CANADIAN DOLLAR - CHICAGO"],      pair: "USD/CAD",   cat: "fx", invert: true  },
  { keys: ["AUSTRALIAN DOLLAR - CHICAGO MERCANTILE", "AUSTRALIAN DOLLAR - CHICAGO"],  pair: "AUD/USD",   cat: "fx", invert: false },
  { keys: ["NZ DOLLAR - CHICAGO", "NEW ZEALAND DOLLAR"],                              pair: "NZD/USD",   cat: "fx", invert: false },
  { keys: ["USD INDEX - ICE FUTURES", "USD INDEX"],                                   pair: "USD Index", cat: "fx", invert: false },
];

function parseTFFCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV vacio');

  const parseLine = (raw) => {
    const cols = []; let inQ = false, cur = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; } else cur += c;
    }
    cols.push(cur.trim()); return cols;
  };
  const toInt = (s) => { const v = parseInt((s || '0').replace(/,/g, ''), 10); return isNaN(v) ? 0 : v; };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
  const fi = (name) => headers.findIndex(h => h.includes(name.toLowerCase()));

  const iMrkt    = fi('market_and_exchange') !== -1 ? fi('market_and_exchange') : 0;
  const iDateMD  = fi('report_date_as_mm_dd');
  const iDateYY  = fi('as_of_date_in_form');
  const iDealerL = fi('dealer_positions_long');
  const iDealerS = fi('dealer_positions_short');
  const iAssetL  = fi('asset_mgr_positions_long');
  const iAssetS  = fi('asset_mgr_positions_short');
  const iLevL    = fi('lev_money_positions_long');
  const iLevS    = fi('lev_money_positions_short');
  const iNcL     = fi('noncomm_positions_long');
  const iNcS     = fi('noncomm_positions_short');
  const iCmL     = fi('comm_positions_long');
  const iCmS     = fi('comm_positions_short');
  const isTFF    = iLevL !== -1;
  const iDate    = iDateMD !== -1 ? iDateMD : iDateYY;

  const allRows = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]; if (!raw.trim()) continue;
    const cols = parseLine(raw);
    const market = (cols[iMrkt] || '').toUpperCase().trim();
    if (!market) continue;

    let dateStr = (iDate !== -1 && cols[iDate]) ? cols[iDate].trim() : (cols[2] || cols[1] || '').trim();
    let isoDate = '';
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const [m, d, y] = parts;
        isoDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    } else if (dateStr.length === 6) {
      isoDate = `20${dateStr.slice(0, 2)}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}`;
    }
    if (!isoDate) continue;

    if (isTFF) {
      const dL = toInt(cols[iDealerL]), dS = toInt(cols[iDealerS]);
      const aL = toInt(cols[iAssetL]),  aS = toInt(cols[iAssetS]);
      const lL = toInt(cols[iLevL]),    lS = toInt(cols[iLevS]);
      allRows.push({ market, isoDate, displayDate: dateStr, dealerLong: dL, dealerShort: dS, assetLong: aL, assetShort: aS, levLong: lL, levShort: lS, format: 'tff' });
    } else {
      const nL = toInt(cols[iNcL !== -1 ? iNcL : 7]), nS = toInt(cols[iNcS !== -1 ? iNcS : 8]);
      const cL = toInt(cols[iCmL !== -1 ? iCmL : 11]), cS = toInt(cols[iCmS !== -1 ? iCmS : 12]);
      if (nL === 0 && nS === 0) continue;
      allRows.push({ market, isoDate, displayDate: dateStr, ncLong: nL, ncShort: nS, commLong: cL, commShort: cS, format: 'legacy' });
    }
  }
  return allRows;
}

function matchContract(market) {
  return CONTRACT_MAP.find(c => c.keys.some(k => market.startsWith(k.toUpperCase()) || market.includes(k.toUpperCase())));
}

function buildProcessedRow(contract, raw) {
  const inv = contract.invert;
  let levLong, levShort, assetLong, assetShort, dealerLong, dealerShort, ncLong, ncShort, commLong, commShort;
  if (raw.format === 'tff') {
    levLong = inv ? raw.levShort : raw.levLong; levShort = inv ? raw.levLong : raw.levShort;
    assetLong = inv ? raw.assetShort : raw.assetLong; assetShort = inv ? raw.assetLong : raw.assetShort;
    dealerLong = inv ? raw.dealerShort : raw.dealerLong; dealerShort = inv ? raw.dealerLong : raw.dealerShort;
    ncLong = null; ncShort = null; commLong = null; commShort = null;
  } else {
    ncLong = inv ? raw.ncShort : raw.ncLong; ncShort = inv ? raw.ncLong : raw.ncShort;
    commLong = inv ? raw.commShort : raw.commLong; commShort = inv ? raw.commLong : raw.commShort;
    levLong = null; levShort = null; assetLong = null; assetShort = null; dealerLong = null; dealerShort = null;
  }
  const smartLong = levLong ?? ncLong ?? 0, smartShort = levShort ?? ncShort ?? 0;
  const smartNet = smartLong - smartShort, smartTotal = smartLong + smartShort;
  const smartPctL = smartTotal > 0 ? Math.round((smartLong / smartTotal) * 100) : 50;
  return {
    pair: contract.pair, cat: contract.cat, invert: inv, isoDate: raw.isoDate, displayDate: raw.displayDate, format: raw.format,
    levLong, levShort, assetLong, assetShort, dealerLong, dealerShort, ncLong, ncShort, commLong, commShort,
    smartNet, smartLong, smartShort, smartTotal, smartPctL,
    assetNet: assetLong != null ? assetLong - assetShort : null,
    dealerNet: dealerLong != null ? dealerLong - dealerShort : null,
    ncNet: ncLong != null ? ncLong - ncShort : null,
    commNet: commLong != null ? commLong - commShort : null,
  };
}

function generateSignal(rows) {
  if (!rows || rows.length === 0) return { signal: 'wait', strength: 0, reason: 'Sin datos' };
  const latest = rows[0], prev = rows[1], prev2 = rows[2];
  const net = latest.smartNet, pctL = latest.smartPctL;
  const trend = prev ? net - prev.smartNet : 0;
  const assetAligned = latest.assetNet != null ? (net > 0 && latest.assetNet > 0) || (net < 0 && latest.assetNet < 0) : null;
  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    if (net > 0 && rows[i].smartNet > 0) streak++;
    else if (net < 0 && rows[i].smartNet < 0) streak++;
    else break;
  }
  const extremeLong = pctL >= 80, extremeShort = pctL <= 20;
  const accelerating = Math.abs(trend) > Math.abs(prev2 ? prev.smartNet - prev2.smartNet : 0);
  if (extremeLong && trend < 0) return { signal: 'sell', strength: 3, reason: `Posicion larga extrema (${pctL}%) con reversion` };
  if (extremeShort && trend > 0) return { signal: 'buy', strength: 3, reason: `Posicionamiento corto extremo (${pctL}% largo) con inversion` };
  if (net > 0 && trend > 0 && streak >= 2 && assetAligned !== false) return { signal: 'buy', strength: streak >= 3 ? (accelerating ? 3 : 2) : 1, reason: `Sesgo Alcista ${streak >= 3 ? 'confirmado' : 'detectado'} — ${streak} informes consecutivos` };
  if (net < 0 && trend < 0 && streak >= 2 && assetAligned !== false) return { signal: 'sell', strength: streak >= 3 ? (accelerating ? 3 : 2) : 1, reason: `Sesgo Bajista ${streak >= 3 ? 'confirmado' : 'detectado'} — ${streak} informes consecutivos` };
  if (net > 0 && trend > 0) return { signal: 'buy', strength: 1, reason: 'Sesgo Alcista incipiente' };
  if (net < 0 && trend < 0) return { signal: 'sell', strength: 1, reason: 'Sesgo Bajista incipiente' };
  return { signal: 'wait', strength: 0, reason: 'Posicionamiento neutro sin sesgo definido' };
}

export function buildPairsData(csvText) {
  const allRows = parseTFFCsv(csvText);

  const byPair = {};
  for (const raw of allRows) {
    const contract = matchContract(raw.market);
    if (!contract) continue;
    const key = contract.pair;
    if (!byPair[key]) byPair[key] = { contract, rows: [] };
    byPair[key].rows.push(buildProcessedRow(contract, raw));
  }

  return Object.values(byPair).map(({ contract, rows }) => {
    rows.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
    const latest = rows[0];
    const signal = generateSignal(rows);
    return {
      pair: contract.pair,
      cat: contract.cat,
      latest,
      weeks: rows,
      signal,
    };
  });
}
