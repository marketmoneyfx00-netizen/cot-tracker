/**
 * marketLogic.js — Motor de lógica macro por tipo de indicador
 *
 * Arquitectura basada en 5 grupos con lógica propia:
 *   A) PRO_CURRENCY    — dato fuerte = divisa fuerte (PMI, GDP, Retail, NFP...)
 *   B) ANTI_CURRENCY   — dato fuerte = divisa débil  (Claims, Unemployment Rate)
 *   C) INFLATION       — hawkish/dovish dynamics      (CPI, PCE, PPI)
 *   D) COMMODITY_OIL   — commodity-first              (Crude, EIA, API)
 *   E) COMMODITY_GAS   — commodity-first              (Natural Gas Storage)
 *
 * Uso:
 *   const logic = getIndicatorLogic(eventName, currency, actual, forecast, previous)
 */

// ─── UTILS ────────────────────────────────────────────────────────────────────

function parseNum(v) {
  if (v === null || v === undefined) return NaN;
  return parseFloat(String(v).replace(/[%KMBT$,]/g,''));
}

function calcSurp(actual, forecast) {
  const a = parseNum(actual), f = parseNum(forecast);
  if (isNaN(a) || isNaN(f)) return null;
  const raw = a - f;
  const pct = f !== 0 ? ((a - f) / Math.abs(f)) * 100 : 0;
  return { raw, pct, dir: raw > 0 ? 1 : raw < 0 ? -1 : 0 };
}

function calcDelta(actual, previous) {
  const a = parseNum(actual), p = parseNum(previous);
  if (isNaN(a) || isNaN(p)) return null;
  const raw = a - p;
  const pct = p !== 0 ? ((a - p) / Math.abs(p)) * 100 : 0;
  return { raw, pct, dir: raw > 0 ? 1 : raw < 0 ? -1 : 0 };
}

// ─── CCY → ASSETS MAP ─────────────────────────────────────────────────────────
// Para cada moneda, define los activos afectados y su sensibilidad al ciclo económico.
// dir: +1 = sube cuando la divisa se fortalece / economía mejora
//      -1 = baja cuando la divisa se fortalece / economía mejora (refugio/inverso)

const CCY_ASSET_MAP = {
  USD: [
    { asset:'USD',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'US10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'SPX',    proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },  // dovish = rate cut rally
    { asset:'NAS100', proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },  // growth loves low rates
    { asset:'XAUUSD', proCcy:-1, antiCcy:1,  hawkish:-1, dovish:1  },  // safe haven + real rates
  ],
  EUR: [
    { asset:'EUR',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'DE10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'STOXX50',proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },
    { asset:'XAUUSD', proCcy:-1, antiCcy:1,  hawkish:-1, dovish:1  },
  ],
  GBP: [
    { asset:'GBP',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'UK10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'FTSE',   proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },
    { asset:'XAUUSD', proCcy:-1, antiCcy:1,  hawkish:-1, dovish:1  },
  ],
  JPY: [
    { asset:'JPY',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'JP10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'NIKKEI', proCcy:-1, antiCcy:1,  hawkish:-1, dovish:1  }, // weak JPY → Nikkei up
  ],
  CAD: [
    { asset:'CAD',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'CA10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'TSX',    proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },
    { asset:'WTI',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },  // CAD correlates with oil
  ],
  AUD: [
    { asset:'AUD',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'AU10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'ASX200', proCcy:1,  antiCcy:1,  hawkish:-1, dovish:1  },
  ],
  NZD: [
    { asset:'NZD',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'NZ10Y',  proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
  ],
  CHF: [
    { asset:'CHF',    proCcy:1,  antiCcy:-1, hawkish:1,  dovish:-1 },
    { asset:'SMI',    proCcy:-1, antiCcy:1,  hawkish:-1, dovish:1  }, // safe haven currency
  ],
};

// Oil-specific assets (commodity-first, not USD-centric)
const OIL_ASSETS = [
  // dir: +1 = up when oil is bullish (less inventory), -1 = down when oil is bullish
  { asset:'WTI',    bullOil:1,  bearOil:-1 },
  { asset:'BRENT',  bullOil:1,  bearOil:-1 },
  { asset:'CAD',    bullOil:1,  bearOil:-1 },  // oil-correlated currency
  { asset:'USD',    bullOil:-1, bearOil:1  },  // energy price = inflation concern
  { asset:'XAUUSD', bullOil:1,  bearOil:-1 },  // inflation hedge
];

const GAS_ASSETS = [
  { asset:'NG',     bullGas:1,  bearGas:-1 },
  { asset:'USD',    bullGas:-1, bearGas:1  },
];

// ─── EVENT TYPE DETECTION ─────────────────────────────────────────────────────

function detectType(name) {
  const n = (name || '').toLowerCase();

  // ── Anti-currency ──
  if (/jobless|initial claims|continuing claims|unemployment claims|peticiones|subsidio por desempleo/.test(n))
    return 'CLAIMS';
  if (/unemployment rate|tasa de desempleo/.test(n))
    return 'UNEMPLOYMENT_RATE';

  // ── Commodity-first ──
  if (/crude oil|oil inventories|eia crude|api weekly crude|petroleum inventories|inventarios de petróleo/.test(n))
    return 'OIL';
  if (/natural gas storage|natural gas inventories|gas storage/.test(n))
    return 'NAT_GAS';

  // ── Inflation ──
  if (/\bcpi\b|consumer price|hicp|\bipc\b|core cpi|\bpce\b|core pce|personal consumption expenditure/.test(n))
    return 'CPI';
  if (/\bppi\b|producer price|wholesale price|factory gate/.test(n))
    return 'PPI';

  // ── Rates ──
  if (/interest rate decision|rate decision|tipos de interés|base rate|overnight rate|cash rate|decisión de tipos/.test(n))
    return 'RATE_DECISION';
  if (/fomc|fed minutes|meeting minutes|monetary policy minutes|federal open|actas de la/.test(n))
    return 'CB_MINUTES';
  if (/speaks|speech|testimony|press conference/.test(n))
    return 'CB_SPEECH';

  // ── Employment pro-currency ──
  if (/non.farm|nonfarm|nfp|nóminas no agr|nominas no agr/.test(n) || (n.includes('payroll') && !n.includes('adp')))
    return 'NFP';
  if (/\badp\b/.test(n) || (n.includes('employment change') && n.includes('adp')))
    return 'ADP';
  if (/employment|average earnings|average hourly|wage|salary|\bjobs\b|labor market|labour market|empleo|jolts|job openings|hiring/.test(n))
    return 'EMPLOYMENT';

  // ── Growth / PMI ──
  if (/\bpmi\b|purchasing managers|ism |manufacturing index|services index|composite pmi|ivey|caixin|markit|business activity/.test(n))
    return 'PMI';
  if (/\bgdp\b|gross domestic|\bpib\b|growth rate/.test(n))
    return 'GDP';
  if (/retail sales|ventas minoristas|core retail/.test(n))
    return 'RETAIL';
  if (/durable goods|factory orders|capital goods|bienes duraderos|core durable/.test(n))
    return 'DURABLE_GOODS';
  if (/industrial production|manufacturing output|industrial output|capacity utilization/.test(n))
    return 'INDUSTRIAL';
  if (/trade balance|current account|balanza comercial|trade deficit/.test(n))
    return 'TRADE';
  if (/consumer confidence|consumer sentiment|michigan|confianza del consumidor|optimism|zew|ifo|economic optimism|business confidence/.test(n))
    return 'CONFIDENCE';
  if (/housing|home sales|building permits|housing starts|existing home|new home|real estate|mortgage/.test(n))
    return 'HOUSING';
  if (/consumer credit|lending|credit growth|money supply/.test(n))
    return 'CREDIT';
  if (/bond auction|t-note|t-bond|bund auction|gilt auction/.test(n) || (n.includes('auction') && (n.includes('year') || n.includes('y '))))
    return 'BOND_AUCTION';

  return null;
}

// ─── SCORE CALCULATION ────────────────────────────────────────────────────────

const TYPE_META = {
  // Group, inverse (true = high number is BAD for currency), tier
  CLAIMS:           { group:'ANTI_CURRENCY',   inverse:true,  tier:'medium' },
  UNEMPLOYMENT_RATE:{ group:'ANTI_CURRENCY',   inverse:true,  tier:'medium' },
  CPI:              { group:'INFLATION',        inverse:false, tier:'high'   },
  PPI:              { group:'INFLATION',        inverse:false, tier:'medium' },
  RATE_DECISION:    { group:'RATE',             inverse:false, tier:'high'   },
  CB_MINUTES:       { group:'QUALITATIVE',      inverse:false, tier:'medium' },
  CB_SPEECH:        { group:'QUALITATIVE',      inverse:false, tier:'low'    },
  NFP:              { group:'PRO_CURRENCY',     inverse:false, tier:'high'   },
  ADP:              { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  EMPLOYMENT:       { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  PMI:              { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  GDP:              { group:'PRO_CURRENCY',     inverse:false, tier:'high'   },
  RETAIL:           { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  DURABLE_GOODS:    { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  INDUSTRIAL:       { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  TRADE:            { group:'PRO_CURRENCY',     inverse:false, tier:'medium' },
  CONFIDENCE:       { group:'PRO_CURRENCY',     inverse:false, tier:'low'    },
  HOUSING:          { group:'PRO_CURRENCY',     inverse:false, tier:'low'    },
  CREDIT:           { group:'PRO_CURRENCY',     inverse:false, tier:'low'    },
  OIL:              { group:'COMMODITY_OIL',    inverse:true,  tier:'medium' },
  NAT_GAS:          { group:'COMMODITY_GAS',    inverse:true,  tier:'medium' },
  BOND_AUCTION:     { group:'BOND',             inverse:false, tier:'low'    },
};

function calcScore(surprise, delta, meta) {
  if (!surprise) return 0;
  const inv = meta?.inverse ? -1 : 1;
  let score = 0;
  score += Math.max(-60, Math.min(60, surprise.pct * 10)) * inv;
  if (delta) score += Math.max(-30, Math.min(30, delta.pct * 3)) * inv;
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function scoreToLabel(s) {
  if (s >  50) return 'Muy Alcista';
  if (s >  20) return 'Alcista';
  if (s > -20) return 'Neutral';
  if (s > -50) return 'Bajista';
  return 'Muy Bajista';
}

function scoreToColor(s) {
  if (s >  20) return '#22c55e';
  if (s < -20) return '#ef4444';
  return '#f59e0b';
}

// ─── ASSET DIRECTIONS ─────────────────────────────────────────────────────────

function arrowCol(dir) {
  return {
    arrow: dir > 0 ? '↑' : dir < 0 ? '↓' : '→',
    col:   dir > 0 ? '#22c55e' : dir < 0 ? '#ef4444' : '#8b90a0',
  };
}

function getAssetDirections(group, ccy, effectiveDir) {
  if (group === 'COMMODITY_OIL') {
    const bull = effectiveDir > 0;
    return OIL_ASSETS.map(a => {
      const dir = bull ? a.bullOil : a.bearOil;
      return { asset: a.asset, ...arrowCol(dir) };
    });
  }
  if (group === 'COMMODITY_GAS') {
    const bull = effectiveDir > 0;
    return GAS_ASSETS.map(a => {
      const dir = bull ? a.bullGas : a.bearGas;
      return { asset: a.asset, ...arrowCol(dir) };
    });
  }

  const map = CCY_ASSET_MAP[ccy] || CCY_ASSET_MAP['USD'];

  return map.map(a => {
    let dir;
    if (group === 'INFLATION') {
      dir = effectiveDir > 0 ? a.hawkish : effectiveDir < 0 ? a.dovish : 0;
    } else {
      dir = effectiveDir > 0 ? a.proCcy : effectiveDir < 0 ? a.antiCcy : 0;
    }
    return { asset: a.asset, ...arrowCol(dir) };
  });
}

// ─── SCENARIOS TABLE ──────────────────────────────────────────────────────────
// Genera el objeto de escenarios compatible con el render existente de App.jsx.
// DÉBIL = dato débil del indicador (desde la perspectiva del indicador, no de la economía)
// Para ANTI_CURRENCY (Claims): DÉBIL = pocas peticiones = BUENO para la divisa

function buildScenarios(evType, group, ccy) {
  const map = CCY_ASSET_MAP[ccy] || CCY_ASSET_MAP['USD'];

  const CAT_MAP = {
    PRO_CURRENCY:  { cat:'CRECIMIENTO',       col:'#10b981' },
    ANTI_CURRENCY: { cat:'EMPLEO',             col:'#3b82f6' },
    INFLATION:     { cat:'INFLACIÓN',          col:'#ef4444' },
    COMMODITY_OIL: { cat:'ENERGÍA',            col:'#f59e0b' },
    COMMODITY_GAS: { cat:'ENERGÍA',            col:'#f59e0b' },
    RATE:          { cat:'POLÍTICA MONETARIA', col:'#f97316' },
    BOND:          { cat:'BONOS',              col:'#6b7280' },
  };

  // Override per specific type
  const CAT_OVERRIDE = {
    PMI:'ADELANTADOS', CPI:'INFLACIÓN', PPI:'INFLACIÓN',
    NFP:'EMPLEO', ADP:'EMPLEO', EMPLOYMENT:'EMPLEO',
    CLAIMS:'EMPLEO', UNEMPLOYMENT_RATE:'EMPLEO',
    GDP:'CRECIMIENTO', RETAIL:'CONSUMO', CONFIDENCE:'SENTIMIENTO',
    TRADE:'COMERCIO', HOUSING:'VIVIENDA',
  };
  const meta   = TYPE_META[evType] || {};
  const catObj = CAT_MAP[group] || { cat:'MACRO', col:'#6b7280' };
  const cat    = CAT_OVERRIDE[evType] || catObj.cat;
  const col    = catObj.col;

  let assets, weak, inline, strong, result_up, result_down;
  const N = n => Array(n).fill('⇄ Neutral');

  if (group === 'COMMODITY_OIL') {
    assets = OIL_ASSETS.map(a => a.asset);
    // DÉBIL = menos inventario (alcista WTI), FUERTE = más inventario (bajista WTI)
    // NOTE: inverse=true, so actual>forecast = bearish oil. FUERTE = muchos inventarios = bajista WTI
    weak   = OIL_ASSETS.map(a => a.bullOil > 0 ? '↑ Sube' : '↓ Baja');  // DÉBIL = pocos = alcista WTI
    strong = OIL_ASSETS.map(a => a.bullOil > 0 ? '↓ Baja' : '↑ Sube');  // FUERTE = muchos = bajista WTI
    inline = N(assets.length);
    result_up   = 'Inventarios por encima del consenso indican exceso de oferta. Bajista para WTI y Brent. El CAD puede ceder. El USD se beneficia levemente por menor presión inflacionaria.';
    result_down = 'Inventarios menores de lo esperado señalan escasez de oferta o alta demanda. Alcista para WTI y Brent. El CAD se fortalece. Presión alcista sobre inflación.';
    return { cat, col, assets, weak, inline, strong, result_up, result_down };
  }

  if (group === 'COMMODITY_GAS') {
    assets = GAS_ASSETS.map(a => a.asset);
    weak   = GAS_ASSETS.map(a => a.bullGas > 0 ? '↑ Sube' : '↓ Baja');
    strong = GAS_ASSETS.map(a => a.bullGas > 0 ? '↓ Baja' : '↑ Sube');
    inline = N(assets.length);
    result_up   = 'Inyección de gas mayor de lo esperado indica exceso de oferta. Bajista para el precio del gas natural.';
    result_down = 'Inyección menor de lo esperado indica demanda fuerte o menor producción. Alcista para el gas natural.';
    return { cat, col, assets, weak, inline, strong, result_up, result_down };
  }

  // Standard CCY-based
  assets = map.map(a => a.asset);
  inline = N(assets.length);

  if (group === 'ANTI_CURRENCY') {
    // DÉBIL = pocas peticiones / tasa baja = BUENO para divisa → proCcy direction
    weak   = map.map(a => a.proCcy > 0 ? '↑ Sube' : a.proCcy < 0 ? '↓ Baja' : '⇄ Neutral');
    // FUERTE = muchas peticiones / tasa alta = MALO para divisa → antiCcy direction
    strong = map.map(a => a.antiCcy > 0 ? '↑ Sube' : a.antiCcy < 0 ? '↓ Baja' : '⇄ Neutral');

    if (evType === 'CLAIMS') {
      result_up   = `Más peticiones de desempleo señalan deterioro laboral. Aumentan expectativas dovish: ${ccy} y yields bajan. Renta variable y oro pueden subir por expectativas de recortes.`;
      result_down = `Pocas peticiones confirman mercado laboral fuerte. Expectativas hawkish: ${ccy} y yields al alza. Activos de riesgo bajo presión por menor probabilidad de recortes.`;
    } else {
      result_up   = `Tasa de desempleo mayor de lo esperado señala deterioro laboral. Presión bajista sobre ${ccy}.`;
      result_down = `Tasa de desempleo menor de lo esperado confirma fortaleza laboral. Refuerza ${ccy}.`;
    }
    return { cat, col, assets, weak, inline, strong, result_up, result_down };
  }

  if (group === 'INFLATION') {
    // DÉBIL = inflación baja = dovish → dovish direction
    weak   = map.map(a => a.dovish > 0 ? '↑ Sube' : a.dovish < 0 ? '↓ Baja' : '⇄ Neutral');
    // FUERTE = inflación alta = hawkish → hawkish direction
    strong = map.map(a => a.hawkish > 0 ? '↑ Sube' : a.hawkish < 0 ? '↓ Baja' : '⇄ Neutral');

    const banco = ccy==='USD'?'Fed':ccy==='EUR'?'BCE':ccy==='GBP'?'BOE':ccy==='JPY'?'BOJ':ccy==='CAD'?'BOC':ccy==='AUD'?'RBA':'banco central';
    result_up   = `Inflación por encima del consenso activa escenario hawkish. El ${banco} puede mantener o subir tipos. ${ccy} y yields al alza. Renta variable bajo presión.`;
    result_down = `Inflación inferior al consenso refuerza expectativas de recorte. Presión bajista sobre ${ccy} y yields. Renta variable y oro pueden beneficiarse.`;
    return { cat, col, assets, weak, inline, strong, result_up, result_down };
  }

  // PRO_CURRENCY (default)
  weak   = map.map(a => a.antiCcy > 0 ? '↑ Sube' : a.antiCcy < 0 ? '↓ Baja' : '⇄ Neutral');
  strong = map.map(a => a.proCcy  > 0 ? '↑ Sube' : a.proCcy  < 0 ? '↓ Baja' : '⇄ Neutral');

  const zona = ccy==='USD'?'estadounidense':ccy==='EUR'?'europeo':ccy==='GBP'?'británico':ccy==='JPY'?'japonés':ccy==='CAD'?'canadiense':ccy==='AUD'?'australiano':ccy;

  // Specific texts per type
  const texts = {
    NFP:    ['Nóminas fuertes refuerzan el mercado laboral. USD y yields al alza. La Fed puede mantener tipos restrictivos más tiempo. Oro bajo presión.',
             'Creación de empleo débil aumenta presión para recortes. USD y yields bajan. Oro y activos refugio se benefician.'],
    ADP:    [`ADP fuerte anticipa NFP sólido. ${ccy} al alza.`, `ADP débil genera dudas sobre el viernes. ${ccy} bajo presión.`],
    PMI:    [`PMI por encima de 50 indica expansión del sector ${zona}. Fortalece ${ccy} y apoya renta variable local. Activos refugio pueden ceder.`,
             `PMI bajo 50 señala contracción. Debilita ${ccy} y presiona la bolsa. Oro y bonos soberanos como refugio.`],
    GDP:    [`PIB fuerte confirma solidez económica. Reduce expectativas de recortes y refuerza ${ccy}, la bolsa y los rendimientos del bono.`,
             `PIB débil aumenta probabilidad de recortes. Debilita ${ccy} y puede generar presión en renta variable.`],
    RETAIL: [`Ventas minoristas fuertes reflejan consumo sólido. Positivo para ${ccy} y renta variable local.`,
             `Ventas débiles sugieren desaceleración del consumo. Señal negativa para ${ccy} y bolsa.`],
    EMPLOYMENT: [`Dato laboral fuerte respalda ${ccy} y puede mantener postura restrictiva del banco central.`,
                 `Dato laboral débil genera presión para relajar la política monetaria. Debilita ${ccy}.`],
  };
  const t = texts[evType] || [
    `Dato por encima del consenso refuerza la economía ${zona} y fortalece ${ccy}. Activos de riesgo al alza.`,
    `Dato por debajo del consenso señala desaceleración. Presiona ${ccy} y activos de riesgo locales.`,
  ];
  result_up   = t[0];
  result_down = t[1];
  return { cat, col, assets, weak, inline, strong, result_up, result_down };
}

// ─── REGIME LABEL ─────────────────────────────────────────────────────────────

function getRegime(evType, group, surprise, actual) {
  if (!surprise) return null;
  const up  = surprise.dir > 0;
  const inv = TYPE_META[evType]?.inverse ?? false;
  // Effective economic impact: positive = good for economy/currency
  const econ = inv ? -surprise.dir : surprise.dir;

  if (group === 'INFLATION') {
    return up
      ? { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Inflación alta → banco central restrictivo → USD/yields al alza' }
      : { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Inflación baja → expectativas de recortes → activos de riesgo al alza' };
  }
  if (group === 'ANTI_CURRENCY') {
    return up
      ? { label:'DOVISH',  color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:`Dato alto = señal negativa para la economía → expectativas dovish → divisa baja` }
      : { label:'HAWKISH', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:`Dato bajo = señal positiva para la economía → mercado laboral fuerte` };
  }
  if (group === 'COMMODITY_OIL') {
    return up
      ? { label:'BAJISTA WTI', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Exceso de inventario → mayor oferta → presión bajista sobre el petróleo' }
      : { label:'ALCISTA WTI', color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'Déficit de inventario → menor oferta → soporte para el precio del crudo' };
  }
  if (evType === 'PMI') {
    const a = parseNum(actual);
    if (!isNaN(a)) {
      if (a >= 55) return { label:'EXPANSIÓN FUERTE', color:'#22c55e', bg:'rgba(34,197,94,0.12)', icon:'🟢', desc:'PMI ≥55: crecimiento sólido' };
      if (a >= 50) return { label:'EXPANSIÓN',        color:'#84cc16', bg:'rgba(132,204,22,0.12)', icon:'🟡', desc:'PMI ≥50: sector en expansión' };
      if (a >= 45) return { label:'CONTRACCIÓN',      color:'#f97316', bg:'rgba(249,115,22,0.12)', icon:'🟠', desc:'PMI <50: sector en contracción' };
      return              { label:'RECESIÓN',          color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'PMI <45: contracción severa' };
    }
  }
  // Default: positive economic impact
  return econ > 0
    ? { label:'POSITIVO', color:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢', desc:'Dato mejor de lo esperado → fortaleza económica' }
    : { label:'NEGATIVO', color:'#ef4444', bg:'rgba(239,68,68,0.12)', icon:'🔴', desc:'Dato peor de lo esperado → señal de debilidad' };
}

// ─── TEMPORAL HORIZON ─────────────────────────────────────────────────────────

function getHorizon(evType, surprisePct) {
  const abs = Math.abs(surprisePct || 0);
  const im  = abs >= 2 ? '1–3 min' : abs >= 0.5 ? '2–5 min' : '5–15 min';
  const id  = abs >= 2 ? 'sesión completa' : 'resto de sesión';
  const notes = {
    NFP:              'Evento de máxima relevancia macro — puede re-pricear la curva de tipos durante días',
    CPI:              'Alta volatilidad inicial — movimiento puede sostenerse si confirma cambio de narrativa',
    RATE_DECISION:    'Impacto sostenido en curva de tipos y divisas durante días',
    CB_MINUTES:       'Puede generar re-pricing de expectativas de tipos a corto y medio plazo',
    GDP:              'Dato revisable — reacción inicial puede revertirse con la segunda estimación',
    ADP:              'Indicador previo del NFP — efecto limitado sin sesgo de mercado claro',
    CLAIMS:           'Dato semanal laboral — peso menor que NFP mensual, pero mueve expectativas dovish/hawkish',
    PPI:              'Indicador adelantado de CPI — vigilar si diverge del dato de inflación al consumidor',
    PMI:              'Indicador adelantado de actividad — mueve expectativas de crecimiento a 1–2 meses',
    OIL:              'Impacto directo en WTI/Brent — reversa posible si datos previos ya estaban descontados',
    NAT_GAS:          'Mueve gas natural directamente — efecto en utilities y energéticas',
  };
  const macro = {
    NFP:'2–5 días', CPI:'1–3 días', RATE_DECISION:'3–7 días', CB_MINUTES:'2–4 días',
    GDP:'2–4 días', CLAIMS:'1–2 días', PMI:'1–2 días', PPI:'1–3 días',
    OIL:'1–2 días', NAT_GAS:'1 día',
  };
  return {
    immediate: im,
    intraday:  id,
    macro:     macro[evType] || '< 1 día',
    note:      notes[evType] || 'Monitorizar reacción del mercado en los primeros minutos tras el dato',
  };
}

// ─── CONFIDENCE BADGE ─────────────────────────────────────────────────────────

function getConfidence(surprisePct, evType) {
  const abs = Math.abs(surprisePct || 0);
  const hi  = new Set(['NFP','CPI','RATE_DECISION','GDP']).has(evType);
  if (abs >= 2.0 || (abs >= 1.0 && hi)) return { label:'Confianza alta',  color:'#22c55e', bg:'rgba(34,197,94,0.12)'  };
  if (abs >= 0.5)                        return { label:'Confianza media', color:'#f59e0b', bg:'rgba(245,158,11,0.12)' };
  if (abs >= 0.1)                        return { label:'Confianza baja',  color:'#f97316', bg:'rgba(249,115,22,0.12)' };
  return                                        { label:'Sin sorpresa',     color:'#8b90a0', bg:'rgba(139,144,160,0.12)'};
}

// ─── EXPLANATION ──────────────────────────────────────────────────────────────

function buildExplanation(evType, group, ccy, surprise, delta, surpriseDir_effective) {
  if (!surprise) return null;
  const sfmt = v => `${v.dir>0?'+':''}${v.raw.toFixed(2)} (${v.dir>0?'+':''}${v.pct.toFixed(2)}%)`;
  const impAbs = Math.abs(surprise.pct);
  const impLabel = impAbs < 0.3 ? 'en línea' : impAbs < 1 ? 'moderado' : impAbs < 2 ? 'fuerte' : 'extremo';
  const parts = [];

  if (surprise.dir > 0)
    parts.push(`Dato <strong>superior al consenso</strong> en ${sfmt(surprise)} — impacto ${impLabel}.`);
  else if (surprise.dir < 0)
    parts.push(`Dato <strong>inferior al consenso</strong> en ${sfmt(surprise)} — impacto ${impLabel}.`);
  else
    parts.push(`Dato <strong>en línea con el consenso</strong>. Impacto de mercado limitado.`);

  if (delta && delta.raw !== 0) {
    const vs = delta.dir > 0 ? 'Mejora' : 'Deterioro';
    parts.push(`${vs} vs dato anterior de ${sfmt(delta)}.`);
  }

  // Group-specific context
  if (group === 'ANTI_CURRENCY' && evType === 'CLAIMS') {
    if (surpriseDir_effective < 0) parts.push(`Dato peor de lo esperado.`);
    else parts.push(`Dato mejor de lo esperado.`);
  }

  return parts.join(' ');
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * getIndicatorLogic — función principal del motor de lógica macro
 *
 * @param {string} eventName  - nombre del evento (e.g. "ISM Services PMI")
 * @param {string} currency   - moneda del país (e.g. "USD", "EUR")
 * @param {any}    actual     - dato publicado
 * @param {any}    forecast   - previsión/consenso
 * @param {any}    previous   - dato anterior
 * @returns {object}          - objeto completo con toda la lógica para el render
 */
export function getIndicatorLogic(eventName, currency, actual, forecast, previous) {
  const evType  = detectType(eventName);
  const meta    = TYPE_META[evType] || { group:'PRO_CURRENCY', inverse:false, tier:'low' };
  const group   = meta.group;
  const ccy     = (currency || 'USD').toUpperCase();

  const surprise = calcSurp(actual, forecast);
  const delta    = calcDelta(actual, previous);

  // biasScore: from currency/commodity perspective
  // For ANTI_CURRENCY: high actual = bad = negative score
  // For COMMODITY_OIL: high inventory = bearish WTI = negative score
  const rawScore     = calcScore(surprise, delta, meta);
  const biasScore    = rawScore;
  const biasLabel    = scoreToLabel(biasScore);
  const biasColor    = scoreToColor(biasScore);
  const primaryBias  = biasScore > 15 ? 'bullish' : biasScore < -15 ? 'bearish' : 'neutral';

  // Effective economic direction (what the data means economically)
  // For PRO_CURRENCY: surprise.dir > 0 = economically positive
  // For ANTI_CURRENCY: surprise.dir > 0 = economically negative → flip
  const econDir      = surprise ? (meta.inverse ? -surprise.dir : surprise.dir) : 0;

  // Asset directions based on economic impact
  const affectedAssets = surprise
    ? getAssetDirections(group, ccy, econDir * (group === 'INFLATION' ? 1 : 1))
    : [];

  // Special: for INFLATION, effectiveDir is econDir (surprise.dir, no inversion)
  const scenarioAssetDir = group === 'INFLATION'
    ? (surprise?.dir || 0)
    : econDir;

  const scenarios  = (evType && group !== 'QUALITATIVE')
    ? buildScenarios(evType, group, ccy)
    : null;

  const regime     = getRegime(evType, group, surprise, actual);
  const horizon    = surprise ? getHorizon(evType, surprise.pct) : null;
  const confidence = surprise ? getConfidence(surprise.pct, evType) : null;
  const explanation = buildExplanation(evType, group, ccy, surprise, delta, econDir);

  return {
    // Identification
    evType,
    group,

    // Scores
    biasScore,
    biasLabel,
    primaryBias,
    biasColor,

    // Raw calculations
    surprise,
    delta,
    econDir,

    // UI helpers
    regime,
    affectedAssets,
    scenarios,
    horizon,
    confidence,
    explanation,

    // For App.jsx backward-compat
    macroScore: surprise ? { score: biasScore, label: biasLabel, color: biasColor } : null,
  };
}

// Named re-exports for individual use in App.jsx if needed
export { detectType as detectEventType, getHorizon as getTemporalHorizon, getConfidence as getConfidenceBadge };
