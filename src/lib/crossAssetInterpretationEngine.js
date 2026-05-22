/**
 * crossAssetInterpretationEngine.js — Cross-Asset Interpretation Layer v1.0
 *
 * Reads multi-asset COT positioning and produces institutional-grade
 * relational analysis: equity-bond dynamic, gold-rates dynamic,
 * oil-macro dynamic, dollar-FX dynamic, and rotation detection.
 *
 * Input:  regime (from riskRegimeEngine) + allBiasArr + combinedData
 * Output: structured interpretation object consumed by narrativeEngine
 *         and injected directly into HTML/XLSX reports
 */

// ── RELATIONSHIP INTERPRETERS ─────────────────────────────────────────────────

function interpretEquityBond(eq, bonds) {
  if (!eq || !bonds) {
    return {
      type: 'unknown',
      description: 'Insufficient equity or bond data to establish a cross-asset relationship reading.',
    };
  }

  if (eq === 'bullish' && bonds === 'bearish') {
    return {
      type: 'risk-on',
      description:
        'Classic risk-on configuration: equity longs increasing while bond futures face ' +
        'institutional selling pressure — consistent with a growth-optimistic allocation shift ' +
        'away from fixed income.',
    };
  }
  if (eq === 'bearish' && bonds === 'bullish') {
    return {
      type: 'risk-off',
      description:
        'Classic risk-off configuration: equity positioning declining while fixed income ' +
        'absorbs institutional safe-haven demand — capital rotating into duration reflects ' +
        'elevated growth or credit concern.',
    };
  }
  if (eq === 'bullish' && bonds === 'bullish') {
    return {
      type: 'goldilocks',
      description:
        'Rare goldilocks dynamic: both equities and bonds are bid simultaneously — ' +
        'typically observed when the market prices a soft-landing scenario (contained ' +
        'inflation + resilient growth), supporting both asset classes concurrently.',
    };
  }
  if (eq === 'bearish' && bonds === 'bearish') {
    return {
      type: 'stagflationary',
      description:
        'Stagflationary pressure: both equities and bonds are under institutional selling ' +
        'pressure — a dual-asset bearish setup consistent with rising inflation expectations ' +
        'meeting deteriorating growth, eroding both earnings and fixed income returns.',
    };
  }
  return {
    type: 'neutral',
    description:
      'Equity and bond positioning are broadly neutral — no dominant risk-on or risk-off ' +
      'institutional rotation signal is currently established.',
  };
}

function interpretGoldRates(gld, bonds, usd) {
  if (!gld) return null;

  if (gld === 'bullish' && bonds === 'bearish') {
    return {
      type:        'inflation-protection',
      aligned:     true,
      description:
        'Gold accumulation alongside bond selling is consistent with institutional inflation ' +
        'protection: Leveraged Money is building gold longs as a real-yield hedge while ' +
        'reducing fixed income duration exposure.',
    };
  }
  if (gld === 'bullish' && bonds === 'bullish') {
    return {
      type:        'safety-stacking',
      aligned:     true,
      description:
        'Simultaneous gold and bond accumulation signals a defensive portfolio posture — ' +
        'institutions are stacking multiple safe-haven vehicles, suggesting elevated ' +
        'tail-risk hedging activity.',
    };
  }
  if (gld === 'bearish' && bonds === 'bullish') {
    return {
      type:        'disinflationary-rotation',
      aligned:     false,
      description:
        'Gold selling combined with bond buying points to a disinflationary rotation: ' +
        'declining inflation expectations make rate-adjusted fixed income more attractive ' +
        'than inflation hedges.',
    };
  }
  if (gld === 'bullish' && usd === 'bullish') {
    return {
      type:        'stress-driven',
      aligned:     false,
      description:
        'Gold and USD both bid simultaneously is atypical — historically associated with ' +
        'systemic stress where both safe havens are sought concurrently, or with ' +
        'USD-denominated gold demand driven by non-US institutional accounts.',
    };
  }
  return null;
}

function interpretOilMacro(oil, eq, _usd) {
  if (!oil) return null;

  if (oil === 'bullish' && eq === 'bullish') {
    return {
      type:        'synchronized-growth',
      description:
        'Oil and equity institutional flows are both bullish — a synchronized growth signal: ' +
        'demand-side energy positioning aligns with equity risk appetite, consistent with ' +
        'global expansion expectations.',
    };
  }
  if (oil === 'bullish' && eq === 'bearish') {
    return {
      type:        'supply-shock',
      description:
        'Oil bid against declining equity exposure suggests a supply-shock narrative: energy ' +
        'cost pressure rising while growth concerns mount — a stagflationary configuration ' +
        'for corporate margins.',
    };
  }
  if (oil === 'bearish' && eq === 'bearish') {
    return {
      type:        'demand-destruction',
      description:
        'Both oil and equity positioning declining — demand destruction signal: institutional ' +
        'accounts reducing growth-sensitive exposure simultaneously, consistent with broad ' +
        'recession hedging or demand-side deterioration.',
    };
  }
  if (oil === 'bearish' && eq === 'bullish') {
    return {
      type:        'disinflation-equity',
      description:
        'Falling oil positioning alongside equity bid is a favorable disinflation signal: ' +
        'lower energy costs support margin recovery while equities discount rate-cut potential.',
    };
  }
  return null;
}

function interpretDollarFX(usd, allBiasArr) {
  if (!usd) return null;

  const fxPairs = (allBiasArr ?? []).filter(b => b.pair?.includes('/'));
  const bullFX  = fxPairs.filter(b => b.bias?.direction === 'bullish').map(b => b.pair);
  const bearFX  = fxPairs.filter(b => b.bias?.direction === 'bearish').map(b => b.pair);

  if (usd === 'bullish') {
    // Pairs bearish with bullish USD: EUR/USD, GBP/USD, AUD/USD, NZD/USD (quote = USD)
    const aligned = bearFX.filter(p => !p.startsWith('USD/')).slice(0, 3);
    return {
      usdDirection:   'bullish',
      alignedFxPairs: aligned,
      description:
        `USD strength is creating institutional tailwinds for USD-long exposure.` +
        (aligned.length > 0
          ? ` Bearish institutional bias in ${aligned.join(', ')} is directionally consistent with dollar demand.`
          : ' FX pair positioning is not yet fully aligned with the USD strength signal.'),
    };
  }
  if (usd === 'bearish') {
    const aligned = bullFX.filter(p => !p.startsWith('USD/')).slice(0, 3);
    return {
      usdDirection:   'bearish',
      alignedFxPairs: aligned,
      description:
        'USD weakness reflects soft yield-spread dynamics or institutional de-positioning of the dollar.' +
        (aligned.length > 0
          ? ` Bullish bias in ${aligned.join(', ')} is consistent with dollar outflow.`
          : ' FX institutional positioning is not yet fully expressing the USD weakness theme.'),
    };
  }
  return {
    usdDirection:   'neutral',
    alignedFxPairs: [],
    description:    'USD positioning is neutral — no dominant directional dollar flow signal is established.',
  };
}

function detectRotations(allBiasArr, combinedData) {
  const rotations = [];

  const getDir = (key) => {
    const b = (allBiasArr ?? []).find(e => e.pair === key);
    if (b?.bias?.direction) return b.bias.direction;
    const c = combinedData?.byAsset?.[key];
    if (c?.latest) {
      const net = c.latest.smartNet ?? 0;
      return net > 3000 ? 'bullish' : net < -3000 ? 'bearish' : 'neutral';
    }
    return null;
  };

  const sp    = getDir('SP500');
  const nas   = getDir('NAS100');
  const bond  = getDir('US10Y');
  const gld   = getDir('GOLD');
  const oil   = getDir('WTI');
  const eq    = (sp === 'bearish' || nas === 'bearish') ? 'bearish'
              : (sp === 'bullish' || nas === 'bullish') ? 'bullish' : null;

  if (eq === 'bearish' && bond === 'bullish') {
    rotations.push(
      'Equity-to-fixed income rotation: institutional reduction of equity futures coincides ' +
      'with fixed income accumulation'
    );
  }
  if (eq === 'bullish' && bond === 'bearish') {
    rotations.push(
      'Fixed income-to-equity rotation: bond selling pressure redirects institutional flows ' +
      'into equity index futures'
    );
  }
  if (gld === 'bullish' && eq === 'bearish') {
    rotations.push(
      'Risk-to-safety rotation: equity de-risking accompanied by institutional gold ' +
      'accumulation'
    );
  }
  if (gld === 'bearish' && eq === 'bullish') {
    rotations.push(
      'Safety-to-risk rotation: gold being reduced while equity exposure builds — ' +
      'risk appetite expanding'
    );
  }
  if (oil === 'bullish' && bond === 'bearish') {
    rotations.push(
      'Reflationary rotation: energy demand bid alongside bond selling suggests a shift ' +
      'toward inflation-linked assets'
    );
  }

  return rotations;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Builds a structured cross-asset interpretation from available regime + positioning data.
 *
 * @param {{
 *   regime?: Object,        from computeRiskRegime()
 *   allBiasArr?: Array,     from buildBiasArray()
 *   combinedData?: Object,  from parseTiffCombined()
 *   macroSignal?: Object,
 *   ratesData?: Object,
 * }}
 * @returns {{
 *   equityBondDynamic: Object,
 *   goldRateDynamic: Object|null,
 *   oilMacroDynamic: Object|null,
 *   dollarFxDynamic: Object|null,
 *   rotations: string[],
 *   dominantTheme: string,
 *   keyDrivers: string[],
 * }}
 */
export function buildCrossAssetContext({
  regime       = {},
  allBiasArr   = [],
  combinedData = null,
  macroSignal: _macroSignal = null,
  ratesData:   _ratesData  = null,
} = {}) {
  const { signals = {} } = regime;
  const { equities: eq, bonds: bnd, gold: gld, oil, usd } = signals;

  const equityBondDynamic = interpretEquityBond(eq, bnd);
  const goldRateDynamic   = interpretGoldRates(gld, bnd, usd);
  const oilMacroDynamic   = interpretOilMacro(oil, eq, usd);
  const dollarFxDynamic   = interpretDollarFX(usd, allBiasArr);
  const rotations         = detectRotations(allBiasArr, combinedData);

  const regimeKey = regime.regime ?? 'TRANSITIONAL';

  const DOMINANT_THEMES = {
    RISK_ON:
      'The multi-asset positioning tableau is consistent with an institutional risk-on posture: ' +
      'growth-sensitive assets are being accumulated while defensive positioning is being reduced.',
    RISK_OFF:
      'Cross-asset flows reflect a coordinated institutional flight to safety: defensive assets ' +
      'are being accumulated as risk-sensitive positioning is wound down.',
    STAGFLATION:
      'The cross-asset tableau is consistent with a stagflationary macro environment: ' +
      'inflation hedges are bid, yield-bearing assets face institutional selling, and ' +
      'growth-sensitive positioning is under pressure.',
    DISINFLATION:
      'Institutional positioning reflects a disinflationary regime: duration is being ' +
      'accumulated in expectation of declining yields while inflation-sensitive positioning is reduced.',
    LIQUIDITY_STRESS:
      'Positioning patterns are consistent with an acute liquidity stress episode: the USD is ' +
      'being accumulated while risk assets face broad institutional selling — a characteristic ' +
      'signature of a dollar squeeze or systemic funding event.',
    TRANSITIONAL:
      'Multi-asset COT positioning is currently transitional, with no dominant directional ' +
      'thesis established across asset classes. Signals are mixed, suggesting institutional ' +
      'uncertainty or a regime change in progress.',
  };

  const dominantTheme = DOMINANT_THEMES[regimeKey] ?? DOMINANT_THEMES.TRANSITIONAL;

  // Collect the most informative relationship descriptions for the report
  const keyDrivers = [];
  if (equityBondDynamic?.type !== 'unknown') keyDrivers.push(equityBondDynamic.description);
  if (goldRateDynamic)                       keyDrivers.push(goldRateDynamic.description);
  if (oilMacroDynamic)                       keyDrivers.push(oilMacroDynamic.description);
  if (dollarFxDynamic?.usdDirection !== 'neutral' && dollarFxDynamic) {
    keyDrivers.push(dollarFxDynamic.description);
  }
  rotations.slice(0, 2).forEach(r => keyDrivers.push(r));

  return {
    equityBondDynamic,
    goldRateDynamic,
    oilMacroDynamic,
    dollarFxDynamic,
    rotations,
    dominantTheme,
    keyDrivers: keyDrivers.slice(0, 5),
  };
}
