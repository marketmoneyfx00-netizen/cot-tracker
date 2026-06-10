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
      description: 'Datos insuficientes de renta variable o bonos para establecer una lectura de relación multi-activo.',
    };
  }

  if (eq === 'bullish' && bonds === 'bearish') {
    return {
      type: 'risk-on',
      description:
        'Configuración clásica risk-on: los largos en renta variable aumentan mientras los futuros de bonos ' +
        'enfrentan presión vendedora institucional — coherente con un cambio de asignación optimista sobre el ' +
        'crecimiento, alejándose de la renta fija.',
    };
  }
  if (eq === 'bearish' && bonds === 'bullish') {
    return {
      type: 'risk-off',
      description:
        'Configuración clásica risk-off: el posicionamiento en renta variable disminuye mientras la renta ' +
        'fija absorbe demanda institucional de refugio seguro — la rotación de capital hacia duración refleja ' +
        'preocupación elevada de crecimiento o crédito.',
    };
  }
  if (eq === 'bullish' && bonds === 'bullish') {
    return {
      type: 'goldilocks',
      description:
        'Dinámica goldilocks poco común: tanto renta variable como bonos están comprados simultáneamente — ' +
        'típicamente observado cuando el mercado descuenta un aterrizaje suave (inflación contenida + ' +
        'crecimiento resiliente), respaldando ambas clases de activos de forma concurrente.',
    };
  }
  if (eq === 'bearish' && bonds === 'bearish') {
    return {
      type: 'stagflationary',
      description:
        'Presión estanflacionaria: tanto renta variable como bonos están bajo presión vendedora institucional ' +
        '— una configuración bajista en ambos activos coherente con expectativas de inflación crecientes ' +
        'combinadas con deterioro del crecimiento, erosionando tanto los beneficios como los rendimientos de renta fija.',
    };
  }
  return {
    type: 'neutral',
    description:
      'El posicionamiento en renta variable y bonos es ampliamente neutral — no se ha establecido ninguna ' +
      'señal de rotación institucional dominante risk-on o risk-off.',
  };
}

function interpretGoldRates(gld, bonds, usd) {
  if (!gld) return null;

  if (gld === 'bullish' && bonds === 'bearish') {
    return {
      type:        'inflation-protection',
      aligned:     true,
      description:
        'La acumulación de oro junto con la venta de bonos es coherente con la protección institucional ' +
        'contra la inflación: Leveraged Money está construyendo largos en oro como cobertura de rendimiento ' +
        'real mientras reduce exposición a duración de renta fija.',
    };
  }
  if (gld === 'bullish' && bonds === 'bullish') {
    return {
      type:        'safety-stacking',
      aligned:     true,
      description:
        'La acumulación simultánea de oro y bonos señala una postura de cartera defensiva — las instituciones ' +
        'están apilando múltiples vehículos de refugio seguro, lo que sugiere actividad elevada de cobertura ' +
        'de riesgo de cola.',
    };
  }
  if (gld === 'bearish' && bonds === 'bullish') {
    return {
      type:        'disinflationary-rotation',
      aligned:     false,
      description:
        'La venta de oro combinada con la compra de bonos apunta a una rotación desinflacionaria: la caída ' +
        'de las expectativas de inflación hace que la renta fija ajustada por tipos sea más atractiva que ' +
        'las coberturas de inflación.',
    };
  }
  if (gld === 'bullish' && usd === 'bullish') {
    return {
      type:        'stress-driven',
      aligned:     false,
      description:
        'Oro y USD comprados simultáneamente es atípico — históricamente asociado con estrés sistémico ' +
        'donde se buscan ambos refugios de forma concurrente, o con demanda de oro denominada en USD ' +
        'impulsada por cuentas institucionales no estadounidenses.',
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
        'Los flujos institucionales en petróleo y renta variable son ambos alcistas — una señal de crecimiento ' +
        'sincronizado: el posicionamiento en energía por el lado de la demanda se alinea con el apetito de ' +
        'riesgo en renta variable, coherente con expectativas de expansión global.',
    };
  }
  if (oil === 'bullish' && eq === 'bearish') {
    return {
      type:        'supply-shock',
      description:
        'El petróleo comprado frente a la reducción de exposición en renta variable sugiere una narrativa de ' +
        'shock de oferta: la presión de costes energéticos aumenta mientras crecen las preocupaciones de ' +
        'crecimiento — una configuración estanflacionaria para los márgenes corporativos.',
    };
  }
  if (oil === 'bearish' && eq === 'bearish') {
    return {
      type:        'demand-destruction',
      description:
        'Tanto el petróleo como la renta variable están disminuyendo en posicionamiento — señal de destrucción ' +
        'de demanda: las cuentas institucionales reducen exposición sensible al crecimiento simultáneamente, ' +
        'coherente con cobertura de recesión amplia o deterioro del lado de la demanda.',
    };
  }
  if (oil === 'bearish' && eq === 'bullish') {
    return {
      type:        'disinflation-equity',
      description:
        'La caída del posicionamiento en petróleo junto con la compra de renta variable es una señal ' +
        'desinflacionaria favorable: los menores costes energéticos apoyan la recuperación de márgenes ' +
        'mientras la renta variable descuenta el potencial de bajadas de tipos.',
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
    const aligned = bearFX.filter(p => !p.startsWith('USD/')).slice(0, 3);
    return {
      usdDirection:   'bullish',
      alignedFxPairs: aligned,
      description:
        `La fortaleza del USD está creando vientos favorables institucionales para exposiciones largas en USD.` +
        (aligned.length > 0
          ? ` El sesgo institucional bajista en ${aligned.join(', ')} es direccionalmente coherente con la demanda de dólar.`
          : ' El posicionamiento en pares de divisas aún no está completamente alineado con la señal de fortaleza del USD.'),
    };
  }
  if (usd === 'bearish') {
    const aligned = bullFX.filter(p => !p.startsWith('USD/')).slice(0, 3);
    return {
      usdDirection:   'bearish',
      alignedFxPairs: aligned,
      description:
        'La debilidad del USD refleja dinámicas de diferencial de rendimientos débiles o desposicionamiento institucional del dólar.' +
        (aligned.length > 0
          ? ` El sesgo alcista en ${aligned.join(', ')} es coherente con la salida de flujos del dólar.`
          : ' El posicionamiento institucional en divisas aún no expresa completamente el tema de debilidad del USD.'),
    };
  }
  return {
    usdDirection:   'neutral',
    alignedFxPairs: [],
    description:    'El posicionamiento en USD es neutral — no se ha establecido ninguna señal dominante de flujo direccional en el dólar.',
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
      'Rotación de renta variable a renta fija: la reducción de futuros de índices coincide ' +
      'con acumulación de renta fija'
    );
  }
  if (eq === 'bullish' && bond === 'bearish') {
    rotations.push(
      'Rotación de renta fija a renta variable: la presión vendedora en bonos redirige flujos ' +
      'institucionales hacia futuros de índices de renta variable'
    );
  }
  if (gld === 'bullish' && eq === 'bearish') {
    rotations.push(
      'Rotación de riesgo a seguridad: reducción de riesgo en renta variable acompañada de ' +
      'acumulación institucional de oro'
    );
  }
  if (gld === 'bearish' && eq === 'bullish') {
    rotations.push(
      'Rotación de seguridad a riesgo: el oro se está reduciendo mientras se construye exposición ' +
      'en renta variable — apetito por riesgo en expansión'
    );
  }
  if (oil === 'bullish' && bond === 'bearish') {
    rotations.push(
      'Rotación reflacionaria: la demanda de energía al alza junto con la venta de bonos sugiere ' +
      'un desplazamiento hacia activos vinculados a la inflación'
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
      'El panorama de posicionamiento multi-activo es coherente con una postura institucional risk-on: ' +
      'los activos sensibles al crecimiento se están acumulando mientras el posicionamiento defensivo se reduce.',
    RISK_OFF:
      'Los flujos multi-activo reflejan una huida coordinada institucional hacia la seguridad: los activos ' +
      'defensivos se están acumulando mientras el posicionamiento sensible al riesgo se deshace.',
    STAGFLATION:
      'El panorama multi-activo es coherente con un entorno macro estanflacionario: las coberturas de ' +
      'inflación están compradas, los activos con rendimiento enfrentan ventas institucionales y el ' +
      'posicionamiento sensible al crecimiento está bajo presión.',
    DISINFLATION:
      'El posicionamiento institucional refleja un régimen desinflacionario: se está acumulando duración ' +
      'en anticipación de tipos a la baja mientras el posicionamiento sensible a la inflación se reduce.',
    LIQUIDITY_STRESS:
      'Los patrones de posicionamiento son coherentes con un episodio agudo de estrés de liquidez: el USD ' +
      'se está acumulando mientras los activos de riesgo enfrentan ventas institucionales generalizadas — ' +
      'firma característica de un squeeze del dólar o evento sistémico de financiación.',
    TRANSITIONAL:
      'El posicionamiento COT multi-activo es actualmente transicional, sin una tesis direccional dominante ' +
      'establecida entre clases de activos. Las señales son mixtas, sugiriendo incertidumbre institucional ' +
      'o un cambio de régimen en curso.',
  };

  const dominantTheme = DOMINANT_THEMES[regimeKey] ?? DOMINANT_THEMES.TRANSITIONAL;

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
