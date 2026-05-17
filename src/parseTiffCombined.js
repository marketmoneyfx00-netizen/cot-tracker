/**
 * parseTiffCombined.js
 * ─────────────────────────────────────────────────────────────────
 * Parser module for CFTC "Traders in Financial Futures –
 * Futures and Options Combined" report (FinComYY.txt / fincom_YY.csv)
 *
 * Public API:
 *   detectCftcFileType(text)       → "futures_only" | "combined" | "unknown"
 *   validateCombinedHeaders(hdrs)  → { valid: bool, missing: string[] }
 *   parseTiffCombined(text)        → CombinedDataset | null (throws on hard error)
 *
 * Design rules:
 *  - Zero side effects, zero state
 *  - Returns clean, optimized objects only (no raw CSV rows in output)
 *  - Completely independent from parseTFFCsv / existing Futures Only logic
 * ─────────────────────────────────────────────────────────────────
 */

// ─── CONTRACT MAP ─────────────────────────────────────────────────────────────
// Maps CFTC market names → tradable assets with full metadata
// invert: true = underlying pair is quoted inverse (e.g. USD/JPY raw → JPY/USD futures)
export const CONTRACT_MAP_COMBINED = [
  // ── FX ───────────────────────────────────────────────────────────────────────
  {
    keys:    ["EURO FX - CHICAGO MERCANTILE"],
    pair:    "EUR/USD", asset: "EURUSD", cat: "fx", group: "fx",
    invert:  false,
    label:   "Euro / US Dollar",
    emoji:   "🇪🇺",
  },
  {
    keys:    ["BRITISH POUND - CHICAGO MERCANTILE"],
    pair:    "GBP/USD", asset: "GBPUSD", cat: "fx", group: "fx",
    invert:  false,
    label:   "British Pound / US Dollar",
    emoji:   "🇬🇧",
  },
  {
    keys:    ["JAPANESE YEN - CHICAGO MERCANTILE"],
    pair:    "USD/JPY", asset: "USDJPY", cat: "fx", group: "fx",
    invert:  true,
    label:   "US Dollar / Japanese Yen",
    emoji:   "🇯🇵",
  },
  {
    keys:    ["SWISS FRANC - CHICAGO MERCANTILE"],
    pair:    "USD/CHF", asset: "USDCHF", cat: "fx", group: "fx",
    invert:  true,
    label:   "US Dollar / Swiss Franc",
    emoji:   "🇨🇭",
  },
  {
    keys:    ["CANADIAN DOLLAR - CHICAGO MERCANTILE"],
    pair:    "USD/CAD", asset: "USDCAD", cat: "fx", group: "fx",
    invert:  true,
    label:   "US Dollar / Canadian Dollar",
    emoji:   "🇨🇦",
  },
  {
    keys:    ["AUSTRALIAN DOLLAR - CHICAGO MERCANTILE"],
    pair:    "AUD/USD", asset: "AUDUSD", cat: "fx", group: "fx",
    invert:  false,
    label:   "Australian Dollar / US Dollar",
    emoji:   "🇦🇺",
  },
  {
    keys:    ["NZ DOLLAR - CHICAGO MERCANTILE", "NEW ZEALAND DOLLAR"],
    pair:    "NZD/USD", asset: "NZDUSD", cat: "fx", group: "fx",
    invert:  false,
    label:   "New Zealand Dollar / US Dollar",
    emoji:   "🇳🇿",
  },
  {
    keys:    ["USD INDEX - ICE FUTURES"],
    pair:    "DXY", asset: "DXY", cat: "fx", group: "fx",
    invert:  false,
    label:   "US Dollar Index",
    emoji:   "💵",
  },
  // ── INDICES ──────────────────────────────────────────────────────────────────
  {
    keys:    ["E-MINI S&P 500 - CHICAGO MERCANTILE", "S&P 500 Consolidated"],
    pair:    "SP500", asset: "SP500", cat: "index", group: "index",
    invert:  false,
    label:   "S&P 500 E-Mini",
    emoji:   "📈",
  },
  {
    keys:    ["NASDAQ-100 Consolidated", "NASDAQ MINI - CHICAGO MERCANTILE"],
    pair:    "NAS100", asset: "NAS100", cat: "index", group: "index",
    invert:  false,
    label:   "Nasdaq-100",
    emoji:   "💻",
  },
  {
    keys:    ["RUSSELL E-MINI - CHICAGO MERCANTILE"],
    pair:    "RUSSELL2000", asset: "RUSSELL2000", cat: "index", group: "index",
    invert:  false,
    label:   "Russell 2000 E-Mini",
    emoji:   "🏭",
  },
  {
    keys:    ["NIKKEI STOCK AVERAGE - CHICAGO MERCANTILE"],
    pair:    "NIKKEI", asset: "NIKKEI", cat: "index", group: "index",
    invert:  false,
    label:   "Nikkei 225",
    emoji:   "🇯🇵",
  },
  // ── COMMODITIES ──────────────────────────────────────────────────────────────
  {
    keys:    ["GOLD - COMMODITY EXCHANGE INC.", "GOLD - COMEX", "GOLD"],
    pair:    "GOLD", asset: "GOLD", cat: "commodities", group: "commodities",
    invert:  false,
    label:   "Gold (COMEX)",
    emoji:   "🥇",
  },
  // ── BONDS ────────────────────────────────────────────────────────────────────
  {
    keys:    ["UST 10Y NOTE - CHICAGO BOARD", "ULTRA UST 10Y - CHICAGO BOARD"],
    pair:    "US10Y", asset: "US10Y", cat: "bonds", group: "bonds",
    invert:  false,
    label:   "US Treasury 10-Year Note",
    emoji:   "🏛️",
  },
  {
    keys:    ["UST 2Y NOTE - CHICAGO BOARD"],
    pair:    "US2Y", asset: "US2Y", cat: "bonds", group: "bonds",
    invert:  false,
    label:   "US Treasury 2-Year Note",
    emoji:   "🏛️",
  },
  {
    keys:    ["UST 5Y NOTE - CHICAGO BOARD"],
    pair:    "US5Y", asset: "US5Y", cat: "bonds", group: "bonds",
    invert:  false,
    label:   "US Treasury 5-Year Note",
    emoji:   "🏛️",
  },
  {
    keys:    ["UST BOND - CHICAGO BOARD", "ULTRA UST BOND - CHICAGO BOARD"],
    pair:    "US30Y", asset: "US30Y", cat: "bonds", group: "bonds",
    invert:  false,
    label:   "US Treasury Bond (30Y)",
    emoji:   "🏛️",
  },
];

// Cross Asset Flow display config — which assets appear in the CAF module
export const CROSS_ASSET_FLOW_ASSETS = ["EURUSD","DXY","SP500","NAS100","US10Y","US2Y","GBPUSD","USDJPY","GOLD"];

// ─── REQUIRED COLUMNS FOR VALIDATION ─────────────────────────────────────────
const REQUIRED_COLUMNS = [
  "dealer_positions_long_all",
  "dealer_positions_short_all",
  "asset_mgr_positions_long_all",
  "asset_mgr_positions_short_all",
  "lev_money_positions_long_all",
  "lev_money_positions_short_all",
];

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function parseCsvLine(raw) {
  const cols = [];
  let inQ = false, cur = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  cols.push(cur.trim());
  return cols;
}

function toInt(s) {
  const v = parseInt((s || "0").replace(/,/g, "").trim(), 10);
  return isNaN(v) ? 0 : v;
}

function parseIsoDate(s) {
  // Handles YYYY-MM-DD directly from Report_Date_as_YYYY-MM-DD column
  if (!s) return "";
  const clean = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return "";
}

function parseYYMMDD(s) {
  // Fallback: As_of_Date_In_Form_YYMMDD → "260414" → "2026-04-14"
  if (!s) return "";
  const clean = s.trim();
  if (clean.length === 6 && /^\d{6}$/.test(clean)) {
    return `20${clean.slice(0,2)}-${clean.slice(2,4)}-${clean.slice(4,6)}`;
  }
  return "";
}

// ─── PUBLIC: detectCftcFileType ───────────────────────────────────────────────
/**
 * Inspects the first two lines of a CSV file and returns its type.
 * Does NOT parse the whole file — very fast.
 * @param {string} text Raw CSV text
 * @returns {"futures_only" | "combined" | "unknown"}
 */
export function detectCftcFileType(text) {
  if (!text || typeof text !== "string") return "unknown";
  const firstNewline = text.indexOf("\n");
  const headerLine   = firstNewline > -1 ? text.slice(0, firstNewline) : text.slice(0, 2000);
  const lower        = headerLine.toLowerCase();

  // Disaggregated Futures: has m_money (Managed Money) and prod_merc columns
  const hasDisaggCols = lower.includes("m_money_positions_long_all") ||
                        lower.includes("prod_merc_positions_long_all");
  if (hasDisaggCols) return "disaggregated";

  // Combined: has _all suffix columns AND FutOnly_or_Combined column
  const hasCombinedCols = lower.includes("lev_money_positions_long_all") &&
                          lower.includes("futonly_or_combined");

  // Futures Only: has _futonly suffix columns
  const hasFutOnlyCols  = lower.includes("lev_money_positions_long_futonly") ||
                          lower.includes("dealer_positions_long_futonly");

  // Also check second data line for "Combined" value in last column
  const secondNewline = text.indexOf("\n", firstNewline + 1);
  const dataLine      = secondNewline > -1
    ? text.slice(firstNewline + 1, secondNewline)
    : "";
  const hasCombinedValue = dataLine.toLowerCase().includes('"combined"') ||
                           dataLine.toLowerCase().endsWith(',combined') ||
                           dataLine.toLowerCase().endsWith(',"combined"\r');

  if (hasCombinedCols || hasCombinedValue) return "combined";
  if (hasFutOnlyCols) return "futures_only";

  // Heuristic: if it has _all columns but no _futonly, it's likely combined
  if (lower.includes("_long_all") && lower.includes("_short_all") &&
      lower.includes("lev_money")) {
    return "combined";
  }

  return "unknown";
}

// ─── PUBLIC: validateCombinedHeaders ─────────────────────────────────────────
/**
 * Validates that the CSV has all required columns for Combined parsing.
 * @param {string[]} headers Array of lowercase header strings
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateCombinedHeaders(headers) {
  const missing = REQUIRED_COLUMNS.filter(
    req => !headers.some(h => h.includes(req))
  );
  return { valid: missing.length === 0, missing };
}

// ─── CONTRACT MATCHER ────────────────────────────────────────────────────────
function matchCombinedContract(market) {
  const upper = market.toUpperCase().trim();
  return CONTRACT_MAP_COMBINED.find(c =>
    c.keys.some(k => upper.startsWith(k.toUpperCase()) || upper.includes(k.toUpperCase()))
  ) || null;
}

// ─── BUILD CLEAN RECORD ──────────────────────────────────────────────────────
/**
 * Transforms raw row data into a clean, optimized record.
 * No raw column data is preserved.
 */
function buildCombinedRecord(contract, raw) {
  const inv = contract.invert;

  // Apply inversion for pairs quoted opposite to futures
  const levLong    = inv ? raw.levShort    : raw.levLong;
  const levShort   = inv ? raw.levLong     : raw.levShort;
  const assetLong  = inv ? raw.assetShort  : raw.assetLong;
  const assetShort = inv ? raw.assetLong   : raw.assetShort;
  const dealerLong = inv ? raw.dealerShort : raw.dealerLong;
  const dealerShort= inv ? raw.dealerLong  : raw.dealerShort;

  // Weekly change (Combined file has this — bonus signal)
  const levChgLong  = inv ? raw.levChgShort  : raw.levChgLong;
  const levChgShort = inv ? raw.levChgLong   : raw.levChgShort;

  // Smart Money = Leveraged Money (primary institutional signal)
  const smartNet   = levLong - levShort;
  const smartTotal = levLong + levShort;
  const smartPctL  = smartTotal > 0 ? Math.round((levLong / smartTotal) * 100) : 50;

  // Asset Manager net (secondary confirmation)
  const assetNet  = assetLong - assetShort;
  const dealerNet = dealerLong - dealerShort;

  // Weekly change in Lev Money net
  const levChgNet = levChgLong - levChgShort;

  return {
    // Identity
    pair:       contract.pair,
    asset:      contract.asset,
    cat:        contract.cat,
    group:      contract.group,
    label:      contract.label,
    emoji:      contract.emoji,
    invert:     inv,
    source:     "tiff_combined",

    // Date
    isoDate:     raw.isoDate,
    displayDate: raw.displayDate,

    // Leveraged Money (primary signal)
    levLong,
    levShort,
    smartNet,
    smartTotal,
    smartPctL,

    // Asset Managers (confirmation)
    assetLong,
    assetShort,
    assetNet,

    // Dealers (contra signal)
    dealerLong,
    dealerShort,
    dealerNet,

    // Weekly changes (unique to Combined dataset)
    levChgLong,
    levChgShort,
    levChgNet,

    // Open interest context
    openInterest: raw.openInterest,
  };
}

// ─── PUBLIC: parseTiffCombined ────────────────────────────────────────────────
/**
 * Main parser for CFTC TFF Futures + Options Combined reports.
 *
 * @param {string} text Raw CSV text
 * @returns {{
 *   byAsset: Object.<string, CombinedAssetData>,
 *   byGroup: { fx: CombinedAssetData[], index: CombinedAssetData[], bonds: CombinedAssetData[] },
 *   reportDate: string,     // most recent report date ISO
 *   assetCount: number,
 *   source: "tiff_combined"
 * }}
 * @throws {Error} on empty file or invalid format
 */
export function parseTiffCombined(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Archivo vacío o formato inválido.");
  }

  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("El archivo no contiene datos (menos de 2 líneas).");
  }

  // ── PARSE HEADERS ──────────────────────────────────────────────────────────
  const rawHeaders = parseCsvLine(lines[0]);
  const headers    = rawHeaders.map(h => h.toLowerCase().trim());

  // ── VALIDATE ───────────────────────────────────────────────────────────────
  const validation = validateCombinedHeaders(headers);
  if (!validation.valid) {
    throw new Error(
      `Formato incorrecto: faltan columnas requeridas: ${validation.missing.join(", ")}. ` +
      `¿Has cargado el archivo Futures Only en lugar del Combined?`
    );
  }

  // ── COLUMN INDEX MAP ───────────────────────────────────────────────────────
  const fi = name => headers.findIndex(h => h.includes(name.toLowerCase()));

  const iMrkt        = fi("market_and_exchange") !== -1 ? fi("market_and_exchange") : 0;
  const iDateISO     = fi("report_date_as_yyyy");      // YYYY-MM-DD column (Combined)
  const iDateYYMMDD  = fi("as_of_date_in_form");       // YYMMDD fallback
  const iOI          = fi("open_interest_all");

  // Positions
  const iDealerL  = fi("dealer_positions_long_all");
  const iDealerS  = fi("dealer_positions_short_all");
  const iAssetL   = fi("asset_mgr_positions_long_all");
  const iAssetS   = fi("asset_mgr_positions_short_all");
  const iLevL     = fi("lev_money_positions_long_all");
  const iLevS     = fi("lev_money_positions_short_all");

  // Weekly changes (bonus — Combined only)
  const iChgLevL  = fi("change_in_lev_money_long_all");
  const iChgLevS  = fi("change_in_lev_money_short_all");

  // Sanity check for Lev Money columns (must exist)
  if (iLevL === -1 || iLevS === -1) {
    throw new Error(
      "No se encontraron columnas de Leveraged Money (_all). " +
      "Verifica que el archivo sea el informe TFF Futures+Options Combined."
    );
  }

  // ── PARSE ROWS ─────────────────────────────────────────────────────────────
  // Accumulate raw rows per matched contract
  const rawByPair = {};  // pair → [raw row objects]

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols   = parseCsvLine(line);
    const market = (cols[iMrkt] || "").toUpperCase().trim();
    if (!market) continue;

    const contract = matchCombinedContract(market);
    if (!contract) continue;

    // ── DATE ────────────────────────────────────────────────────────────────
    let isoDate = "";
    if (iDateISO !== -1 && cols[iDateISO]) {
      isoDate = parseIsoDate(cols[iDateISO]);
    }
    if (!isoDate && iDateYYMMDD !== -1 && cols[iDateYYMMDD]) {
      isoDate = parseYYMMDD(cols[iDateYYMMDD]);
    }
    if (!isoDate) continue;  // skip rows without valid date

    // Display date: use ISO format (cleaner than MM/DD/YYYY)
    const displayDate = isoDate;

    // ── POSITIONS ───────────────────────────────────────────────────────────
    const rawRow = {
      isoDate,
      displayDate,
      openInterest: iOI !== -1 ? toInt(cols[iOI]) : 0,
      dealerLong:   toInt(cols[iDealerL]),
      dealerShort:  toInt(cols[iDealerS]),
      assetLong:    toInt(cols[iAssetL]),
      assetShort:   toInt(cols[iAssetS]),
      levLong:      toInt(cols[iLevL]),
      levShort:     toInt(cols[iLevS]),
      levChgLong:   iChgLevL !== -1 ? toInt(cols[iChgLevL]) : 0,
      levChgShort:  iChgLevS !== -1 ? toInt(cols[iChgLevS]) : 0,
    };

    // Skip rows where all positions are zero (corrupted/empty rows)
    if (rawRow.levLong === 0 && rawRow.levShort === 0 &&
        rawRow.assetLong === 0 && rawRow.assetShort === 0) {
      continue;
    }

    const key = contract.pair;
    if (!rawByPair[key]) rawByPair[key] = { contract, rows: [] };
    rawByPair[key].rows.push(rawRow);
  }

  if (Object.keys(rawByPair).length === 0) {
    throw new Error(
      "No se reconocieron contratos en el archivo. " +
      "Asegúrate de usar el archivo TFF Futures and Options Combined."
    );
  }

  // ── BUILD CLEAN DATASET ────────────────────────────────────────────────────
  // Sort weeks descending (newest first), build clean records, no raw data kept
  const byAsset = {};
  const byGroup = { fx: [], index: [], bonds: [], commodities: [] };

  let mostRecentDate = "";

  for (const [pair, { contract, rows }] of Object.entries(rawByPair)) {
    // Sort descending by date
    rows.sort((a, b) => b.isoDate.localeCompare(a.isoDate));

    // Build clean records
    const weeks = rows.map(raw => buildCombinedRecord(contract, raw)).filter(Boolean);
    if (weeks.length === 0) continue;

    const latest = weeks[0];

    // Track most recent report date
    if (!mostRecentDate || latest.isoDate > mostRecentDate) {
      mostRecentDate = latest.isoDate;
    }

    // Generate signal for this asset
    const signal = generateCombinedSignal(weeks);

    const assetData = {
      pair,
      asset:   contract.asset,
      cat:     contract.cat,
      group:   contract.group,
      label:   contract.label,
      emoji:   contract.emoji,
      weeks,
      latest,
      signal,
      weekCount: weeks.length,
    };

    byAsset[contract.asset] = assetData;

    // Group by category
    const g = contract.group;
    if (byGroup[g]) byGroup[g].push(assetData);
    else            byGroup[g] = [assetData];
  }

  // Sort groups by absolute net position (strongest signal first)
  for (const g of Object.keys(byGroup)) {
    byGroup[g].sort((a, b) => Math.abs(b.latest.smartNet) - Math.abs(a.latest.smartNet));
  }

  return {
    byAsset,
    byGroup,
    reportDate:  mostRecentDate,
    assetCount:  Object.keys(byAsset).length,
    source:      "tiff_combined",
  };
}

// ─── SIGNAL GENERATOR (Combined-specific) ────────────────────────────────────
/**
 * Generates institutional signal from Combined dataset.
 * Similar logic to Futures Only but uses Combined-specific fields.
 */
function generateCombinedSignal(weeks) {
  if (!weeks || weeks.length === 0) {
    return { signal: "wait", strength: 0, reason: "Sin datos" };
  }

  const latest = weeks[0];
  const prev   = weeks[1];
  const prev2  = weeks[2];

  const net  = latest.smartNet;
  const pctL = latest.smartPctL;

  // Weekly trend
  const trend = prev ? net - prev.smartNet : 0;

  // Asset Manager confirmation
  const assetAligned = latest.assetNet != null
    ? (net > 0 && latest.assetNet > 0) || (net < 0 && latest.assetNet < 0)
    : null;

  // Consecutive streak
  let streak = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (net > 0 && weeks[i].smartNet > 0) streak++;
    else if (net < 0 && weeks[i].smartNet < 0) streak++;
    else break;
  }

  const extremeLong  = pctL >= 80;
  const extremeShort = pctL <= 20;
  const accelerating = prev2
    ? Math.abs(trend) > Math.abs(prev.smartNet - prev2.smartNet)
    : false;

  // Weekly change from Combined dataset (bonus signal)
  const hasChgData = latest.levChgNet !== 0;
  const chgAligned = hasChgData
    ? (net > 0 && latest.levChgNet > 0) || (net < 0 && latest.levChgNet < 0)
    : null;

  const sourceNote = "Combined (Futuros+Opciones)";

  if (extremeLong && trend < 0) {
    return { signal: "sell", strength: 3,
      reason: `Posición larga extrema (${pctL}%) con reversión — institucionales reduciendo largos [${sourceNote}]` };
  }
  if (extremeShort && trend > 0) {
    return { signal: "buy", strength: 3,
      reason: `Posicionamiento corto extremo (${pctL}% largo) con inversión — Leveraged Money cubriendo posiciones cortas [${sourceNote}]` };
  }
  if (net > 0 && trend > 0 && streak >= 2 && assetAligned !== false) {
    const str = streak >= 3 ? (accelerating ? 3 : 2) : 1;
    return { signal: "buy", strength: str,
      reason: `Sesgo Alcista ${streak >= 3 ? "confirmado" : "detectado"} — ${streak} informes consecutivos acumulación neta positiva. Asset Managers ${assetAligned ? "alineados" : "divergentes"}. ${chgAligned === true ? "Flujo semanal confirma." : ""} [${sourceNote}]` };
  }
  if (net < 0 && trend < 0 && streak >= 2 && assetAligned !== false) {
    const str = streak >= 3 ? (accelerating ? 3 : 2) : 1;
    return { signal: "sell", strength: str,
      reason: `Sesgo Bajista ${streak >= 3 ? "confirmado" : "detectado"} — ${streak} informes consecutivos reducción neta. Asset Managers ${assetAligned ? "alineados" : "divergentes"}. ${chgAligned === false ? "Flujo semanal confirma." : ""} [${sourceNote}]` };
  }
  if (net > 0 && trend > 0) {
    return { signal: "buy", strength: 1,
      reason: `Sesgo Alcista incipiente — acumulación neta positiva Leveraged Money. Pendiente de confirmación [${sourceNote}]` };
  }
  if (net < 0 && trend < 0) {
    return { signal: "sell", strength: 1,
      reason: `Sesgo Bajista incipiente — reducción neta Leveraged Money. Pendiente de confirmación [${sourceNote}]` };
  }
  if (Math.abs(net) < 5000 || (trend > 0 && net < 0) || (trend < 0 && net > 0)) {
    return { signal: "indecision", strength: 0,
      reason: `Datos divergentes — posible cambio de sesgo en curso [${sourceNote}]` };
  }
  return { signal: "wait", strength: 0,
    reason: `Posicionamiento neutro sin sesgo definido [${sourceNote}]` };
}

// ─── DISAGGREGATED FUTURES PARSER ────────────────────────────────────────────
/**
 * Parses CFTC Disaggregated Futures & Options Combined report.
 * Used to extract gold and other physical commodities.
 *
 * Column mapping to TFF-equivalent fields:
 *   M_Money_Positions_Long_All  → levLong  (Managed Money ≈ Leveraged Money)
 *   M_Money_Positions_Short_All → levShort
 *   Prod_Merc_Positions_Long_All→ dealerLong (Producers/Merchants ≈ Commercial)
 *   Other_Rept_Positions_Long_All→assetLong  (Other Reportables ≈ Asset Managers)
 *
 * @param {string} text Raw CSV text of Disaggregated report
 * @returns Same shape as parseTiffCombined() — compatible with CrossAssetFlow
 */
export function parseDisaggregated(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Archivo vacío o formato inválido.");
  }

  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("El archivo no contiene datos.");
  }

  const rawHeaders = parseCsvLine(lines[0]);
  const headers    = rawHeaders.map(h => h.toLowerCase().trim());
  const fi         = name => headers.findIndex(h => h.includes(name.toLowerCase()));

  const iMrkt       = fi("market_and_exchange") !== -1 ? fi("market_and_exchange") : 0;
  const iDateISO    = fi("report_date_as_yyyy");
  const iDateYYMMDD = fi("as_of_date_in_form");
  const iOI         = fi("open_interest_all");

  // Disaggregated columns → mapped to TFF-equivalent fields
  const iLevL    = fi("m_money_positions_long_all");
  const iLevS    = fi("m_money_positions_short_all");
  const iDealerL = fi("prod_merc_positions_long_all");
  const iDealerS = fi("prod_merc_positions_short_all");
  const iAssetL  = fi("other_rept_positions_long_all");
  const iAssetS  = fi("other_rept_positions_short_all");
  const iChgLevL = fi("change_in_m_money_long_all");
  const iChgLevS = fi("change_in_m_money_short_all");

  if (iLevL === -1 || iLevS === -1) {
    throw new Error(
      "No se encontraron columnas de Managed Money. " +
      "Verifica que el archivo sea el Disaggregated Futures and Options Combined."
    );
  }

  const rawByPair = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols   = parseCsvLine(line);
    const market = (cols[iMrkt] || "").toUpperCase().trim();
    if (!market) continue;

    const contract = matchCombinedContract(market);
    if (!contract || contract.group !== "commodities") continue;

    let isoDate = "";
    if (iDateISO !== -1 && cols[iDateISO]) isoDate = parseIsoDate(cols[iDateISO]);
    if (!isoDate && iDateYYMMDD !== -1 && cols[iDateYYMMDD]) isoDate = parseYYMMDD(cols[iDateYYMMDD]);
    if (!isoDate) continue;

    const rawRow = {
      isoDate,
      displayDate: isoDate,
      openInterest: iOI !== -1 ? toInt(cols[iOI]) : 0,
      dealerLong:   iDealerL !== -1 ? toInt(cols[iDealerL]) : 0,
      dealerShort:  iDealerS !== -1 ? toInt(cols[iDealerS]) : 0,
      assetLong:    iAssetL  !== -1 ? toInt(cols[iAssetL])  : 0,
      assetShort:   iAssetS  !== -1 ? toInt(cols[iAssetS])  : 0,
      levLong:      toInt(cols[iLevL]),
      levShort:     toInt(cols[iLevS]),
      levChgLong:   iChgLevL !== -1 ? toInt(cols[iChgLevL]) : 0,
      levChgShort:  iChgLevS !== -1 ? toInt(cols[iChgLevS]) : 0,
    };

    if (rawRow.levLong === 0 && rawRow.levShort === 0) continue;

    const key = contract.pair;
    if (!rawByPair[key]) rawByPair[key] = { contract, rows: [] };
    rawByPair[key].rows.push(rawRow);
  }

  if (Object.keys(rawByPair).length === 0) {
    throw new Error("No se reconocieron activos de commodities en el archivo Disaggregated.");
  }

  const byAsset = {};
  const byGroup = { fx: [], index: [], bonds: [], commodities: [] };
  let mostRecentDate = "";

  for (const [pair, { contract, rows }] of Object.entries(rawByPair)) {
    rows.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
    const weeks = rows.map(raw => ({
      ...buildCombinedRecord(contract, raw),
      source: "disaggregated",
    })).filter(Boolean);
    if (weeks.length === 0) continue;

    const latest = weeks[0];
    if (!mostRecentDate || latest.isoDate > mostRecentDate) mostRecentDate = latest.isoDate;

    const signal   = generateCombinedSignal(weeks);
    const assetData = {
      pair,
      asset:     contract.asset,
      cat:       contract.cat,
      group:     contract.group,
      label:     contract.label,
      emoji:     contract.emoji,
      weeks,
      latest,
      signal,
      weekCount: weeks.length,
      source:    "disaggregated",
    };

    byAsset[contract.asset] = assetData;
    byGroup[contract.group] = byGroup[contract.group] ?? [];
    byGroup[contract.group].push(assetData);
  }

  return {
    byAsset,
    byGroup,
    reportDate: mostRecentDate,
    assetCount: Object.keys(byAsset).length,
    source:     "disaggregated",
  };
}

/**
 * Merges two parsed datasets (e.g. TFF + Disaggregated) into one.
 * Used when the user uploads both files.
 */
export function mergeCombinedData(base, incoming) {
  if (!base) return incoming;
  if (!incoming) return base;

  const byAsset = { ...base.byAsset, ...incoming.byAsset };
  const byGroup = {};
  for (const g of ["fx", "index", "bonds", "commodities"]) {
    byGroup[g] = [...(base.byGroup[g] ?? []), ...(incoming.byGroup[g] ?? [])];
  }

  const reportDate = base.reportDate > incoming.reportDate
    ? base.reportDate : incoming.reportDate;

  return {
    byAsset,
    byGroup,
    reportDate,
    assetCount: Object.keys(byAsset).length,
    source: "merged",
  };
}
