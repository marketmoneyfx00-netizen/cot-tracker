/**
 * narrativeEngine.js — Institutional Narrative Generator v2.0
 *
 * Asset-class-agnostic commentary. Covers FX, equities, commodities, bonds.
 * Regime-aware executive summaries. Sounds like a macro desk.
 *
 * v2 changes from v1:
 *   - No FX-only language ("monitored FX pairs", "EUR, GBP, commodity-linked pairs")
 *   - generateExecutiveSummary accepts regime + crossAssetCtx (optional, backward compat)
 *   - generatePairNarrative is cat-aware (FX / index / commodities / bonds)
 *   - generateMarketRegimeLabel uses riskRegime when available
 *   - New: generateMacroRegimeNarrative for report headers
 */

// ── UTILS ─────────────────────────────────────────────────────────────────────

function fmtScore(s)     { return s != null ? (s > 0 ? `+${s.toFixed(1)}` : s.toFixed(1)) : '—'; }

// ── MACRO CONTEXT ─────────────────────────────────────────────────────────────

function macroSentence(macroSignal, regime) {
  // If regime is available and specific, use it — richer than USD-only signal
  if (regime?.regime && regime.regime !== 'TRANSITIONAL' && (regime.confidence ?? 0) >= 45) {
    const regimeMap = {
      RISK_ON:
        'El posicionamiento entre activos refleja una postura institucional de apetito por riesgo, ' +
        'con asignaciones sensibles al crecimiento en expansión y exposición defensiva en declive.',
      RISK_OFF:
        'Los flujos entre activos indican una postura institucional defensiva, con posicionamiento ' +
        'en activos refugio elevado en renta fija y oro.',
      STAGFLATION:
        'El posicionamiento es coherente con presión estanflacionaria: las coberturas de inflación ' +
        'están demandadas, la duración bajo presión vendedora y los activos sensibles al crecimiento bajo estrés.',
      DISINFLATION:
        'Los flujos institucionales reflejan una repricing desinflacionaria: la acumulación de renta fija ' +
        'domina mientras el posicionamiento en energía y materias primas retrocede.',
      LIQUIDITY_STRESS:
        'Los patrones entre activos señalan estrés potencial de liquidez — la demanda de dólares está ' +
        'elevada junto con un desapalancamiento institucional generalizado.',
    };
    return regimeMap[regime.regime] ?? 'El entorno macro muestra señales de transición entre clases de activos.';
  }

  // Fall back to USD yield-spread signal (backward compat)
  if (!macroSignal?.bias || macroSignal.bias === 'NEUTRAL') {
    return 'El entorno macro permanece neutral, sin señal direccional dominante desde los diferenciales de tipos monitorizados.';
  }
  const conf      = macroSignal.confidence ?? 5;
  const confLabel = conf >= 8 ? 'sólida' : conf >= 5 ? 'moderada' : 'tentativa';
  const map = {
    USD_STRONG:
      `El entorno macro refleja una fortaleza ${confLabel} del USD, impulsada por dinámicas favorables de ` +
      `diferenciales de tipos — un viento en contra para posiciones sensibles al riesgo y financiadas en USD.`,
    USD_LEANING_STRONG:
      `El USD muestra una inclinación alcista ${confLabel} en la capa macro, aunque la convicción ` +
      `permanece por debajo del umbral definitivo.`,
    USD_WEAK:
      `Las condiciones macro reflejan debilidad ${confLabel} del USD en los diferenciales de tipos monitorizados — ` +
      `generalmente favorable para activos de riesgo y posicionamiento en divisas no-dólar.`,
    USD_LEANING_WEAK:
      `Un debilitamiento tentativo del USD es visible en la capa macro, aunque las señales basadas en diferenciales ` +
      `aún no han alcanzado convicción plena.`,
  };
  return map[macroSignal.bias] ?? 'El entorno macro muestra señales mixtas en los principales diferenciales de tipos.';
}

// ── DIVERGENCE COMMENTARY ─────────────────────────────────────────────────────

function divergenceSentence(biasArr) {
  const exhausted = biasArr.filter(b => b.divergence?.state === 'EXHAUSTION');
  const bullDiv   = biasArr.filter(b => b.divergence?.state === 'BULLISH_DIVERGENCE');
  const bearDiv   = biasArr.filter(b => b.divergence?.state === 'BEARISH_DIVERGENCE');

  const parts = [];

  if (exhausted.length) {
    parts.push(
      `El agotamiento del posicionamiento está activo en ${exhausted.map(b => b.pair).join(' y ')}, ` +
      `donde los z-scores extremos coinciden con la dirección de tendencia alineada — un entorno de riesgo de reversión elevado.`
    );
  }
  if (bullDiv.length) {
    parts.push(
      `${bullDiv.map(b => b.pair).join(' y ')} muestran acumulación institucional ante caída de precio — ` +
      `una configuración clásica de divergencia de smart money apuntando a una posible recuperación.`
    );
  }
  if (bearDiv.length) {
    parts.push(
      `${bearDiv.map(b => b.pair).join(' y ')} exhiben patrones de distribución, ` +
      `con Leveraged Money reduciendo exposición larga mientras el precio avanza — señal de divergencia bajista.`
    );
  }

  return parts.join(' ') || 'No se detectaron divergencias significativas de precio-posicionamiento en los activos monitorizados.';
}

// ── ASSET-CLASS OPENING SENTENCES ─────────────────────────────────────────────

const ASSET_CLASS_OPENERS = {
  fx: {
    strong_bull:  (pair) => `${pair} exhibe convicción institucional alcista fuerte, con Leveraged Money manteniendo posición neta larga significativa.`,
    mod_bull:     (pair) => `${pair} muestra sesgo institucional alcista moderado, respaldado por posicionamiento neto largo de Leveraged Money.`,
    weak_bull:    (pair) => `${pair} tiene una inclinación alcista leve desde cuentas institucionales, aunque la convicción sigue siendo limitada.`,
    neutral:      (pair) => `${pair} permanece en estado institucional neutral, sin sesgo direccional dominante de Leveraged Money.`,
    weak_bear:    (pair) => `${pair} tiene una inclinación bajista leve institucionalmente, aunque el posicionamiento neto corto carece de convicción sólida.`,
    mod_bear:     (pair) => `${pair} muestra sesgo institucional bajista moderado, con posicionamiento neto corto desde cuentas especulativas.`,
    strong_bear:  (pair) => `${pair} refleja presión institucional bajista fuerte, con Leveraged Money acumulando exposición neta corta.`,
  },
  index: {
    strong_bull:  (pair) => `${pair} refleja fuerte apetito institucional por renta variable, con Leveraged Money manteniendo exposición neta larga significativa en futuros de índice.`,
    mod_bull:     (pair) => `${pair} muestra sesgo alcista moderado en futuros de renta variable, con posicionamiento neto largo de Leveraged Money.`,
    weak_bull:    (pair) => `${pair} tiene una inclinación alcista leve en futuros de índice, aunque la convicción institucional sigue siendo limitada.`,
    neutral:      (pair) => `El posicionamiento en futuros de ${pair} es neutral — no se establece sesgo direccional institucional dominante.`,
    weak_bear:    (pair) => `Los futuros de ${pair} muestran una inclinación bajista leve, aunque el posicionamiento neto corto carece de convicción sólida.`,
    mod_bear:     (pair) => `${pair} refleja sesgo institucional bajista moderado en futuros de renta variable, con exposición neta larga en declive.`,
    strong_bear:  (pair) => `Los futuros de ${pair} están bajo fuerte presión vendedora institucional, con Leveraged Money acumulando exposición neta corta.`,
  },
  commodities: {
    strong_bull:  (pair) => `${pair} exhibe fuerte acumulación institucional, con Leveraged Money manteniendo exposición neta larga significativa — coherente con posicionamiento de demanda o cobertura de inflación.`,
    mod_bull:     (pair) => `${pair} muestra posicionamiento institucional alcista moderado, con exposición neta larga de Leveraged Money.`,
    weak_bull:    (pair) => `${pair} tiene una inclinación alcista leve desde cuentas institucionales.`,
    neutral:      (pair) => `El posicionamiento en ${pair} es neutral, sin sesgo direccional institucional dominante.`,
    weak_bear:    (pair) => `${pair} tiene una inclinación bajista leve institucionalmente, con posicionamiento neto corto modesto.`,
    mod_bear:     (pair) => `${pair} muestra sesgo institucional bajista moderado — Leveraged Money está reduciendo exposición.`,
    strong_bear:  (pair) => `${pair} refleja fuerte presión vendedora institucional, con Leveraged Money manteniendo exposición neta corta significativa.`,
  },
  bonds: {
    strong_bull:  (pair) => `${pair} refleja fuerte acumulación institucional de renta fija — Leveraged Money manteniendo exposición neta larga de duración significativa, coherente con expectativas de bajada de tipos.`,
    mod_bull:     (pair) => `${pair} muestra demanda institucional moderada de renta fija, con posicionamiento neto largo en el complejo de tipos.`,
    weak_bull:    (pair) => `${pair} tiene una inclinación alcista leve en posicionamiento de renta fija, aunque la convicción de duración sigue siendo limitada.`,
    neutral:      (pair) => `El posicionamiento de renta fija en ${pair} es neutral, sin sesgo de expectativa de tipos dominante establecido.`,
    weak_bear:    (pair) => `${pair} muestra una inclinación bajista leve en renta fija — el posicionamiento neto corto modesto implica expectativas limitadas de prima de inflación.`,
    mod_bear:     (pair) => `${pair} refleja ventas institucionales moderadas de renta fija, coherente con expectativas de subida de tipos.`,
    strong_bear:  (pair) => `La renta fija de ${pair} está bajo fuerte presión vendedora institucional — el posicionamiento neto corto de duración implica expectativas de prima de inflación elevadas.`,
  },
};

function getOpeningKey(score) {
  if (score >=  3)   return 'strong_bull';
  if (score >=  1.5) return 'mod_bull';
  if (score >=  0.5) return 'weak_bull';
  if (score > -0.5)  return 'neutral';
  if (score > -1.5)  return 'weak_bear';
  if (score > -3)    return 'mod_bear';
  return 'strong_bear';
}

// ── PAIR NARRATIVE ────────────────────────────────────────────────────────────

export function generatePairNarrative(pairRow, biasEntry, exec) {
  if (!biasEntry) return '';

  const pair      = pairRow?.pair ?? '';
  const cat       = (pairRow?.cat ?? 'fx').toLowerCase();
  const bias      = biasEntry.bias ?? biasEntry;
  const zsc       = biasEntry.zscore ?? {};
  const div       = biasEntry.divergence ?? {};
  const conf      = biasEntry.confluence ?? {};
  const sig       = pairRow?.signal ?? {};
  const score     = bias.score ?? 0;
  const direction = bias.direction ?? 'neutral';
  const execLabel = exec?.permission?.label ?? 'RESTRICTED';
  const streak    = sig.strength ?? 0;
  const confScore = conf.confluenceScore ?? conf.score ?? 0;

  const openerSet = ASSET_CLASS_OPENERS[cat] ?? ASSET_CLASS_OPENERS.fx;
  const sentences = [ openerSet[getOpeningKey(score)](pair) ];

  // Streak context (generic across all asset classes)
  if (streak >= 3 && direction !== 'neutral') {
    sentences.push(
      `El sesgo ${direction === 'bullish' ? 'alcista' : 'bajista'} ha persistido durante ${streak} informes CFTC consecutivos, ` +
      `reforzando la tesis direccional de mediano plazo.`
    );
  }

  // Z-score extremes (generic)
  if (zsc.zscore != null) {
    if (Math.abs(zsc.zscore) >= 2.5) {
      sentences.push(
        `El posicionamiento está en extremos históricos (Z-score: ${fmtScore(zsc.zscore)}, ` +
        `percentil ${zsc.percentile}) — riesgo de reversión elevado.`
      );
    } else if (Math.abs(zsc.zscore) >= 1.5) {
      sentences.push(
        `El Z-score marca ${fmtScore(zsc.zscore)} (percentil ${zsc.percentile}), indicando que ` +
        `el posicionamiento está estirado pero no aún en extremos.`
      );
    }
  }

  // Divergence (generic)
  if (div.state === 'EXHAUSTION') {
    sentences.push(
      `Una señal de agotamiento está activa — tendencia de precio y posicionamiento están alineados en extremos. ` +
      `Vigilar catalizadores de reversión.`
    );
  } else if (div.state === 'BULLISH_DIVERGENCE') {
    sentences.push(
      `Presente divergencia alcista: las instituciones acumulan mientras el precio cede — ` +
      `configuración de potencial reversión.`
    );
  } else if (div.state === 'BEARISH_DIVERGENCE') {
    sentences.push(
      `Divergencia bajista visible: las instituciones reducen exposición mientras el precio avanza — ` +
      `señal de distribución.`
    );
  }

  // Execution (generic)
  if (execLabel === 'FAVORABLE') {
    sentences.push(
      `Las condiciones de ejecución intradía son actualmente favorables para entradas direccionales alineadas ` +
      `con el sesgo institucional.`
    );
  } else if (execLabel === 'IMPROVING') {
    sentences.push(
      `Las condiciones de ejecución están mejorando — los pullbacks pueden ofrecer mejor riesgo/beneficio ` +
      `que perseguir la acción de precio actual.`
    );
  } else {
    sentences.push(
      `La ejecución intradía está restringida. Esperar mejora en condiciones macro y de volatilidad antes ` +
      `de ejecutar operaciones direccionales.`
    );
  }

  // Carry / confluence (FX-specific framing only for FX; generic for others)
  if (confScore >= 70) {
    sentences.push(
      cat === 'fx'
        ? `La puntuación de confluencia multifactor de ${Math.round(confScore)}/100 indica fuerte alineación ` +
          `entre COT, carry, macro y política de bancos centrales.`
        : `La puntuación de confluencia multifactor de ${Math.round(confScore)}/100 indica fuerte alineación ` +
          `entre posicionamiento COT, macro y régimen de volatilidad.`
    );
  } else if (confScore >= 45) {
    sentences.push(
      `La puntuación de confluencia de ${Math.round(confScore)}/100 muestra alineación parcial — se recomienda ` +
      `confirmación de al menos un factor adicional antes de añadir exposición direccional.`
    );
  }

  return sentences.join(' ');
}

// ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────────────

export function generateExecutiveSummary({ biasArr, macroSignal, cotDate, snapshotDate, regime, crossAssetCtx }) {
  if (!biasArr?.length) return 'No hay datos institucionales disponibles para el análisis.';

  const bullish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish');
  const bearish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish');
  const neutral = biasArr.filter(b => !['bullish', 'bearish'].includes(b.bias?.direction ?? b.direction));

  const topBullish = [...bullish].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topBearish = [...bearish].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const tone = bullish.length > bearish.length + 1 ? 'mayoritariamente alcista'
    : bearish.length > bullish.length + 1           ? 'mayoritariamente bajista'
    : 'mixto';

  const sentences = [];

  // Opening: asset count + tone
  sentences.push(
    `En el informe CFTC del ${cotDate ?? snapshotDate ?? 'último período'}, el posicionamiento institucional ` +
    `en ${biasArr.length} activo${biasArr.length !== 1 ? 's' : ''} monitorizados es ${tone}, ` +
    `con ${bullish.length} alcista${bullish.length !== 1 ? 's' : ''}, ${bearish.length} bajista${bearish.length !== 1 ? 's' : ''} y ${neutral.length} neutral${neutral.length !== 1 ? 'es' : ''}.`
  );

  // Macro / regime context
  sentences.push(macroSentence(macroSignal, regime));

  // Cross-asset dominant theme (if available)
  if (crossAssetCtx?.dominantTheme) {
    sentences.push(crossAssetCtx.dominantTheme);
  }

  // Top bullish setups
  if (topBullish.length >= 2) {
    sentences.push(
      `${topBullish.slice(0, 2).map(b => b.pair).join(' y ')} presentan las configuraciones institucionales ` +
      `alcistas más sólidas, con Leveraged Money manteniendo exposición neta larga elevada durante informes consecutivos.`
    );
  } else if (topBullish.length === 1) {
    sentences.push(
      `${topBullish[0].pair} destaca como la principal configuración institucional alcista de la semana.`
    );
  }

  // Top bearish setups
  if (topBearish.length >= 2) {
    sentences.push(
      `${topBearish.slice(0, 2).map(b => b.pair).join(' y ')} reflejan la mayor presión institucional ` +
      `bajista, con reducción continuada en la exposición neta larga.`
    );
  }

  // Divergence
  const divSentence = divergenceSentence(biasArr);
  if (divSentence) sentences.push(divSentence);

  // Extreme z-score risk note
  const extremes = biasArr.filter(b => b.zscore && Math.abs(b.zscore.zscore ?? 0) >= 2);
  if (extremes.length >= 2) {
    sentences.push(
      `Los Z-scores elevados en ${extremes.map(b => b.pair).join(', ')} exigen disciplina en gestión de riesgo ` +
      `— el posicionamiento extendido históricamente precede a movimientos bruscos de reversión a la media.`
    );
  }

  return sentences.join(' ');
}

// ── MACRO REGIME NARRATIVE ────────────────────────────────────────────────────

/**
 * Generates a structured macro regime narrative for report headers.
 * New in v2 — used directly by HTML report and XLSX commentary sections.
 *
 * @param {Object} regime  — from computeRiskRegime()
 * @param {Object} [crossAssetCtx] — from buildCrossAssetContext()
 * @returns {{ headline: string, body: string, keyDrivers: string[] }}
 */
export function generateMacroRegimeNarrative(regime, crossAssetCtx) {
  if (!regime?.regime || regime.regime === 'TRANSITIONAL') {
    return {
      headline:   'Entorno Macro en Transición',
      body:       regime?.description ?? 'El posicionamiento COT entre activos aún no establece un régimen macro dominante. Monitorizar la convergencia.',
      keyDrivers: regime?.keyDrivers ?? [],
    };
  }

  const conf = regime.confidence ?? 0;
  const confQual = conf >= 70 ? 'alta convicción' : conf >= 50 ? 'convicción moderada' : 'emergente';

  return {
    headline:   `${regime.label} (${confQual}, ${conf}% confianza)`,
    body:       regime.description,
    keyDrivers: [
      ...(regime.keyDrivers ?? []),
      ...(crossAssetCtx?.rotations?.slice(0, 2) ?? []),
    ].slice(0, 5),
  };
}

// ── ENRICHED ASSET REPORT ─────────────────────────────────────────────────────
/**
 * Generates a structured, asset-class-aware report for a single asset.
 * Covers: headline, macro context, institutional reading, positioning,
 * divergence, weekly flow, regime, cross-asset, rates, scenario main,
 * scenario alternative, invalidation, and operational conclusion.
 *
 * No relleno. No repetición. Cada bloque usa datos reales del asset.
 *
 * @param {Object} pairRow    — from parseTiffCombined or parseTFFCsv
 * @param {Object} biasEntry  — from buildBiasArray / cotBiasEngine
 * @param {Object} opts       — { exec, riskRegime, macroSignal, ratesData, cycleProfiles, crossAssetCtx }
 * @returns {EnrichedReport}
 */
export function generateEnrichedAssetReport(pairRow, biasEntry, opts = {}) {
  const { exec, riskRegime, macroSignal, ratesData, cycleProfiles, crossAssetCtx } = opts;

  if (!pairRow || !biasEntry) return null;

  const pair      = pairRow.pair ?? '';
  const cat       = (pairRow.cat ?? 'fx').toLowerCase();
  const bias      = biasEntry.bias ?? biasEntry;
  const zsc       = biasEntry.zscore   ?? {};
  const div       = biasEntry.divergence ?? {};
  const conf      = biasEntry.confluence ?? {};
  const latest    = pairRow.latest ?? pairRow.weeks?.[0] ?? {};
  const prev      = pairRow.weeks?.[1] ?? {};
  const signal    = pairRow.signal ?? {};
  const score     = bias.score ?? 0;
  const direction = bias.direction ?? 'neutral';
  const streak    = signal.strength ?? 0;

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  const headlineMap = {
    strong_bull:  (p) => `${p}: Acumulación institucional a escala — fuerte convicción alcista`,
    mod_bull:     (p) => `${p}: Leveraged Money neto largo, tesis alcista intacta`,
    weak_bull:    (p) => `${p}: Inclinación alcista leve — convicción insuficiente para configuración de alta probabilidad`,
    neutral:      (p) => `${p}: Sin sesgo direccional institucional dominante`,
    weak_bear:    (p) => `${p}: Inclinación bajista leve — convicción por debajo del umbral`,
    mod_bear:     (p) => `${p}: Leveraged Money neto corto, tesis bajista en construcción`,
    strong_bear:  (p) => `${p}: Distribución institucional confirmada — señal bajista fuerte`,
  };
  const headlineKey = getOpeningKey(score);
  const headline    = headlineMap[headlineKey]?.(pair) ?? `${pair}: Señal de posicionamiento disponible`;

  // ── MACRO CONTEXT ─────────────────────────────────────────────────────────
  let macroContext = null;
  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    macroContext = `El régimen macro está clasificado como ${riskRegime.label} (${riskRegime.confidence}% confianza). `;
    if (cat === 'fx') {
      macroContext += macroSignal?.bias
        ? `El sesgo macro del USD es ${macroSignal.bias.replace(/_/g, ' ')} con confianza ${macroSignal.confidence}/10.`
        : 'Las señales de diferenciales de tipos del USD no son concluyentes.';
    } else if (cat === 'index') {
      macroContext += riskRegime.regime === 'RISK_ON'
        ? 'Una postura macro de apetito por riesgo es constructiva para exposición larga en renta variable.'
        : riskRegime.regime === 'RISK_OFF'
        ? 'Un entorno macro defensivo crea vientos en contra para posiciones largas en futuros de renta variable.'
        : `El régimen ${riskRegime.regime.replace(/_/g, '-')} crea condiciones mixtas para futuros de renta variable.`;
    } else if (cat === 'bonds') {
      macroContext += riskRegime.regime === 'DISINFLATION'
        ? 'El régimen desinflacionario es constructivo para posiciones largas de duración en renta fija.'
        : riskRegime.regime === 'STAGFLATION'
        ? 'Las condiciones estanflacionarias crean vientos en contra para bonos largos — la prima de inflación presiona los tipos al alza.'
        : `El régimen macro actual tiene implicaciones ${riskRegime.signals?.bonds === direction ? 'alineadas' : 'mixtas'} para la renta fija.`;
    } else if (cat === 'commodities') {
      macroContext += riskRegime.regime === 'STAGFLATION'
        ? 'Las condiciones estanflacionarias son estructuralmente favorables para coberturas de inflación en materias primas.'
        : riskRegime.regime === 'RISK_ON'
        ? 'La postura macro de apetito por riesgo apoya la demanda impulsada de materias primas.'
        : `El régimen ${riskRegime.label} tiene implicaciones variables según la subclase de materia prima.`;
    }
  } else {
    macroContext = macroSignal?.implication
      ?? 'El contexto macro está en transición o es insuficiente para una clasificación de régimen de alta convicción.';
  }

  // ── INSTITUTIONAL READING ─────────────────────────────────────────────────
  const netStr     = latest.smartNet != null ? (latest.smartNet > 0 ? '+' : '') + Math.round(latest.smartNet / 1000) + 'K' : '—';
  const pctL       = latest.smartPctL != null ? latest.smartPctL.toFixed(1) + '%' : '—';
  const institutional = `Leveraged Money mantiene neto ${latest.smartNet >= 0 ? 'largo' : 'corto'} ${netStr} contratos (${pctL} largo). ` +
    (latest.assetNet != null
      ? `Asset Managers ${latest.assetNet > 0 ? 'confirman con neto largo' : 'divergen neto corto'} ${Math.round(Math.abs(latest.assetNet) / 1000)}K.`
      : '') +
    (streak >= 2
      ? ` Este sesgo direccional ha persistido durante ${streak} informes CFTC consecutivos.`
      : ' Racha por debajo del umbral para confirmación de tendencia.');

  // ── POSITIONING READING ───────────────────────────────────────────────────
  let positioning = null;
  if (zsc.zscore != null) {
    const zAbs = Math.abs(zsc.zscore);
    if (zAbs >= 2.5) {
      positioning = `El posicionamiento está en extremos plurianuales (Z-score: ${zsc.zscore > 0 ? '+' : ''}${zsc.zscore?.toFixed(2)}, percentil ${zsc.percentile}). ` +
        `En estos niveles, el riesgo histórico de reversión a la media es elevado. Se requiere alineación carry/macro antes de añadir exposición direccional.`;
    } else if (zAbs >= 1.5) {
      positioning = `El posicionamiento está estirado pero no en extremos (Z-score: ${zsc.zscore?.toFixed(2)}, percentil ${zsc.percentile}). ` +
        `No es señal de reversión por sí sola — requiere divergencia o catalizador para ser accionable.`;
    } else {
      positioning = `El posicionamiento está dentro del rango histórico normal (Z-score: ${zsc.zscore?.toFixed(2)}, percentil ${zsc.percentile}). ` +
        `Sin riesgo de saturación en los niveles actuales.`;
    }
  }

  // ── DIVERGENCE READING ────────────────────────────────────────────────────
  let divergence = null;
  if (div.state === 'EXHAUSTION') {
    divergence = `Señal de agotamiento activa: precio y posicionamiento se mueven juntos en extremos. ` +
      `Históricamente, esta configuración precede reversiones bruscas — priorizar gestión de riesgo sobre entrada direccional.`;
  } else if (div.state === 'BULLISH_DIVERGENCE') {
    divergence = `Divergencia alcista detectada: cuentas institucionales acumulando mientras el precio cae. ` +
      `Divergencia clásica de smart money — esperar confirmación de precio antes de entrar largo.`;
  } else if (div.state === 'BEARISH_DIVERGENCE') {
    divergence = `Divergencia bajista: Leveraged Money reduciendo exposición mientras el precio avanza. ` +
      `Señal de distribución — evitar añadir posiciones largas; evaluar cortos en agotamiento del precio.`;
  } else {
    divergence = `Sin divergencia significativa entre precio y posicionamiento. Tendencia y flujo institucional están alineados.`;
  }

  // ── WEEKLY FLOW ───────────────────────────────────────────────────────────
  const chgNet  = latest.levChgNet ?? (latest.smartNet - (prev.smartNet ?? 0));
  const flowMag = Math.round(Math.abs(chgNet) / 1000);
  const flowDir = chgNet > 0 ? 'acumulación' : chgNet < 0 ? 'distribución' : 'plano';
  const weeklyFlow = chgNet != null
    ? `El flujo semanal muestra ${flowDir} de ${flowMag}K contratos. ` +
      (flowDir === 'acumulación' && direction === 'bullish' ? 'Las entradas confirman la tesis direccional alcista.'
      : flowDir === 'distribución' && direction === 'bearish' ? 'Las salidas confirman la tesis direccional bajista.'
      : flowDir !== 'plano' ? 'El flujo semanal diverge del posicionamiento neto — vigilar el desarrollo de tendencia.'
      : 'Sin señal de flujo semanal significativa.')
    : 'Datos de flujo semanal no disponibles.';

  // ── RATES / CARRY (FX only) ───────────────────────────────────────────────
  let ratesReading = null;
  if (cat === 'fx' && ratesData?.pairs) {
    const pairKey = pair.replace('/', '').toUpperCase();
    const cp = ratesData.pairs.find(p => p.pair?.toUpperCase() === pairKey);
    if (cp) {
      const baseCycle  = cycleProfiles?.[cp.base_bank];
      const quoteCycle = cycleProfiles?.[cp.quote_bank];
      ratesReading = `Tipo ${cp.base_bank}: ${cp.base_rate?.toFixed(2) ?? '—'}% (${baseCycle?.cycleLabel ?? '—'}). ` +
        `Tipo ${cp.quote_bank}: ${cp.quote_rate?.toFixed(2) ?? '—'}% (${quoteCycle?.cycleLabel ?? '—'}). ` +
        `Diferencial: ${cp.rate_diff_bps != null ? (cp.rate_diff_bps > 0 ? '+' : '') + cp.rate_diff_bps + ' bps' : '—'}. ` +
        `Dirección carry: ${cp.carry_direction?.replace(/_/g, ' ') ?? 'neutral'}.`;
      if (baseCycle?.impact?.notes?.length) {
        ratesReading += ' ' + baseCycle.impact.notes[0];
      }
    }
  } else if (cat === 'bonds') {
    // For bonds, rate expectations from the FED cycle are directly relevant
    const fedCycle = cycleProfiles?.['FED'];
    if (fedCycle) {
      ratesReading = `FED actualmente ${fedCycle.cycleLabel} (${fedCycle.maturityLabel}). ` +
        `Movimiento acumulado del ciclo: ${fedCycle.cumBps > 0 ? '+' : ''}${fedCycle.cumBps} bps. ` +
        (fedCycle.cycleType === 'HIKING'
          ? 'Las subidas en curso crean vientos en contra estructurales para posiciones largas de larga duración.'
          : fedCycle.cycleType === 'CUTTING'
          ? 'Las bajadas de tipos respaldan los largos de renta fija — acumulación de duración favorecida.'
          : 'FED en pausa — vigilar señales de pivote de política que afecten al posicionamiento de duración.');
    }
  }

  // ── SCENARIO MAIN ─────────────────────────────────────────────────────────
  const scenarioMain = buildScenarioMain(cat, direction, streak, div.state, zsc.zscore, riskRegime?.regime, pair);

  // ── SCENARIO ALTERNATIVE ──────────────────────────────────────────────────
  const scenarioAlt = buildScenarioAlt(cat, direction, div.state, zsc.zscore, riskRegime?.regime, pair);

  // ── INVALIDATION ──────────────────────────────────────────────────────────
  const invalidation = buildInvalidation(cat, direction, latest, div.state, riskRegime?.regime, pair);

  // ── OPERATIONAL CONCLUSION ────────────────────────────────────────────────
  const conclusion = buildConclusion(cat, direction, streak, exec, div.state, conf, riskRegime?.regime);

  return {
    pair,
    cat,
    headline,
    macro_context:       macroContext,
    institutional:       institutional,
    positioning:         positioning,
    divergence:          divergence,
    weekly_flow:         weeklyFlow,
    regime_reading:      riskRegime?.description ?? null,
    cross_asset_reading: crossAssetCtx?.dominantTheme ?? null,
    rates_reading:       ratesReading,
    scenario_main:       scenarioMain,
    scenario_alt:        scenarioAlt,
    invalidation:        invalidation,
    conclusion:          conclusion,
  };
}

// ── SCENARIO BUILDERS ─────────────────────────────────────────────────────────

function buildScenarioMain(cat, direction, streak, divState, zscore, regime, pair) {
  if (direction === 'neutral') {
    return `Esperar confirmación direccional de ${pair}. Sin escenario accionable mientras el posicionamiento es neutral.`;
  }

  const dirStr = direction === 'bullish' ? 'largo' : 'corto';
  const oppStr = direction === 'bullish' ? 'alcista' : 'bajista';
  const streakStr = streak >= 3 ? `(racha de ${streak} informes) ` : '';

  if (cat === 'fx') {
    return `Escenario principal: ${oppStr} en ${pair} ${streakStr}con Leveraged Money manteniendo exposición neta ${dirStr}. ` +
      (regime && regime !== 'TRANSITIONAL' && (
        (direction === 'bullish' && ['RISK_ON'].includes(regime)) ||
        (direction === 'bearish' && ['RISK_OFF', 'LIQUIDITY_STRESS'].includes(regime))
      )
        ? `El régimen macro ${regime.replace(/_/g, '-')} proporciona viento de cola adicional para esta configuración.`
        : 'El régimen macro no proporciona alineación direccional fuerte — depender de la calidad de la señal COT.');
  }

  if (cat === 'index') {
    return direction === 'bullish'
      ? `Escenario principal: el apetito por renta variable permanece elevado. Los largos institucionales en futuros de ${pair} persisten. ` +
        (regime === 'RISK_ON' ? 'El régimen macro de apetito por riesgo confirma el sesgo de renta variable.' : 'Vigilar confirmación de régimen para aumentar convicción.')
      : `Escenario principal: el desapalancamiento institucional de renta variable continúa. Los futuros de ${pair} permanecen bajo presión vendedora. ` +
        (regime === 'RISK_OFF' ? 'El régimen macro defensivo confirma el sesgo bajista de renta variable.' : 'Esperar confirmación del régimen macro para convicción plena.');
  }

  if (cat === 'bonds') {
    return direction === 'bullish'
      ? `Escenario principal: la acumulación de renta fija continúa — Leveraged Money espera bajadas de tipos o necesita exposición refugio. ` +
        (regime === 'DISINFLATION' ? 'El régimen macro desinflacionario apoya fuertemente esta tesis.' : 'Monitorizar la orientación de bancos centrales para confirmación del camino de tipos.')
      : `Escenario principal: la presión vendedora en bonos persiste — la prima de inflación impulsa la reducción de duración. ` +
        (regime === 'STAGFLATION' ? 'El régimen estanflacionario proporciona soporte fundamental para esta configuración.' : 'Seguir la curva de tipos para señales de aceleración.');
  }

  if (cat === 'commodities') {
    return direction === 'bullish'
      ? `Escenario principal: la acumulación institucional de materias primas continúa. ` +
        (pair === 'GOLD' || pair === 'SILVER' ? 'La demanda de metales preciosos es coherente con cobertura de inflación o demanda refugio.' : '') +
        (pair === 'WTI' ? 'La demanda de energía refleja confianza del lado de la demanda o restricción de oferta.' : '')
      : `Escenario principal: la presión vendedora en materias primas se extiende. ` +
        (pair === 'GOLD' || pair === 'SILVER' ? 'La reducción de metales preciosos implica mejora del apetito por riesgo o caída de expectativas de inflación.' : '') +
        (pair === 'WTI' ? 'Las ventas de energía son coherentes con debilidad de demanda o superávit de oferta.' : '');
  }

  return `Escenario principal ${oppStr}: el posicionamiento institucional soporta el sesgo direccional ${dirStr}.`;
}

function buildScenarioAlt(cat, direction, divState, zscore, regime, pair) {
  const inverse = direction === 'bullish' ? 'bajista' : direction === 'bearish' ? 'alcista' : 'neutral';

  if (divState === 'EXHAUSTION' || (zscore != null && Math.abs(zscore) >= 2.5)) {
    return `Escenario alternativo (probabilidad elevada): el posicionamiento está extendido — un movimiento de reversión a la media impulsado por catalizador es posible. ` +
      `Los extremos de Z-score históricamente preceden movimientos correctivos de 2-4 semanas. Monitorizar la reversión del flujo semanal (cambio de signo en levChgNet) como aviso temprano.`;
  }

  if (divState === 'BULLISH_DIVERGENCE') {
    return `Escenario alternativo ${inverse}: el precio podría continuar cayendo a pesar de la acumulación institucional. ` +
      `Las divergencias de smart money no siempre se resuelven de inmediato — se requiere vela de confirmación o cierre semanal por encima de nivel clave antes de actuar.`;
  }

  if (divState === 'BEARISH_DIVERGENCE') {
    return `Escenario alternativo ${inverse}: la fortaleza del precio podría persistir a pesar de la distribución institucional. ` +
      `La compra forzada del retail puede extender el precio por encima de las ventas institucionales — esperar capitulación del posicionamiento (cruce neto al lado opuesto) antes de actuar.`;
  }

  // Regime conflict scenarios
  if (direction === 'bullish' && regime === 'RISK_OFF') {
    return `Escenario alternativo: el régimen macro defensivo podría sobreponerse a la señal COT alcista de ${pair}. ` +
      `Si el deterioro macro se acelera, la reversión del posicionamiento institucional es posible a pesar del sesgo largo actual.`;
  }
  if (direction === 'bearish' && regime === 'RISK_ON') {
    return `Escenario alternativo: los vientos de cola macro de apetito por riesgo podrían forzar cobertura de cortos en ${pair}. ` +
      `Monitorizar patrones de capitulación en el posicionamiento — un giro neto a largo invalidaría la configuración bajista.`;
  }

  return `Escenario alternativo: el posicionamiento podría revertir si un catalizador disrumpe el consenso institucional actual. ` +
    `Un giro neto semanal de la exposición de Leveraged Money señalaría la necesidad de reevaluar el sesgo ${direction === 'bullish' ? 'alcista' : 'bajista'}.`;
}

function buildInvalidation(cat, direction, latest, divState, regime, pair) {
  const netPos  = latest.smartNet ?? 0;
  const netStr  = Math.round(Math.abs(netPos) / 1000) + 'K';

  const baseInvalidation = direction === 'bullish'
    ? `La tesis alcista de ${pair} queda invalidada si: (1) el neto de Leveraged Money gira a negativo (actualmente +${netStr}); ` +
      `(2) los Asset Managers cambian a neto corto; (3) el flujo semanal muestra 2+ semanas consecutivas de distribución.`
    : direction === 'bearish'
    ? `La tesis bajista de ${pair} queda invalidada si: (1) el neto de Leveraged Money gira a positivo (actualmente ${Math.round(netPos / 1000)}K); ` +
      `(2) el flujo de acumulación semanal persiste 2+ semanas consecutivas; (3) el % largo supera el 50%.`
    : `Sin tesis activa que invalidar. Confirmar el sesgo direccional antes de establecer criterios de invalidación.`;

  // Asset-class-specific additions
  if (cat === 'index' && direction === 'bearish') {
    return baseInvalidation + ` Adicionalmente: si el VIX cae por debajo de 15 con futuros de renta variable mostrando acumulación semanal, la tesis bajista queda comprometida.`;
  }
  if (cat === 'bonds' && direction === 'bullish') {
    return baseInvalidation + ` Adicionalmente: un giro hawkish sorpresa de la FED invalidaría la tesis de acumulación de bonos independientemente de la señal COT.`;
  }
  if ((pair === 'GOLD' || pair === 'SILVER') && direction === 'bullish') {
    return baseInvalidation + ` Adicionalmente: un ciclo sostenido de fortaleza del USD o desinflación rápida presionaría los largos de oro a pesar de la acumulación institucional.`;
  }

  return baseInvalidation;
}

function buildConclusion(cat, direction, streak, exec, divState, conf) {
  const execLabel = exec?.permission?.label ?? 'RESTRICTED';
  const confScore = conf?.confluenceScore ?? conf?.score ?? 0;
  const execOK    = execLabel === 'FAVORABLE';

  if (direction === 'neutral') {
    return 'Sin conclusión operacional activa — esperar confirmación direccional de los datos de posicionamiento antes de establecer un sesgo.';
  }

  if (divState === 'EXHAUSTION') {
    return `ATENCIÓN: Señal de agotamiento activa. No añadir exposición direccional en los niveles de posicionamiento actuales. ` +
      `Esperar que el posicionamiento se normalice (z-score por debajo de ±1.5) antes de re-entrar en la dirección del sesgo institucional.`;
  }

  if (!execOK) {
    return `El sesgo direccional es ${direction === 'bullish' ? 'alcista' : 'bajista'} — pero las condiciones de ejecución son ${execLabel.toLowerCase()}. ` +
      `Mantener la tesis de la configuración, esperar a que las condiciones macro y de volatilidad mejoren antes de comprometer capital.`;
  }

  if (streak >= 3 && confScore >= 60 && execOK) {
    return `Configuración operacional de alta convicción: racha ${direction === 'bullish' ? 'alcista' : 'bajista'} de ${streak} informes, confluencia ${Math.round(confScore)}/100 y condiciones de ejecución favorables. ` +
      `El dimensionamiento de posición puede reflejar la elevada calidad de la señal — gestionar el riesgo mediante monitoreo del neto semanal, no solo del precio.`;
  }

  if (streak >= 2 && execOK) {
    return `Configuración ${direction === 'bullish' ? 'alcista' : 'bajista'} moderada con condiciones mejorando. ` +
      `El timing de entrada debe referenciar estructura intradía alineada con la dirección institucional. ` +
      `Dimensionamiento estándar — no sobreponderar hasta que la confluencia supere 65+.`;
  }

  return `Sesgo ${direction === 'bullish' ? 'alcista' : 'bajista'} identificado con condiciones de ejecución favorables. ` +
    `La racha de señal es limitada (${streak} informes) — tratar como configuración en etapa temprana y dimensionar en consecuencia. ` +
    `La convicción plena requiere al menos 2-3 informes confirmatorios consecutivos.`;
}

// ── MARKET REGIME LABEL ───────────────────────────────────────────────────────

export function generateMarketRegimeLabel(biasArr, macroSignal, riskRegime) {
  // Use riskRegime if available and specific
  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    return riskRegime.label ?? riskRegime.regime;
  }

  // Fall back to original heuristic
  const bull = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish').length;
  const bear = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish').length;
  const dist = biasArr.filter(b => b.state === 'distribution').length;
  const exp  = biasArr.filter(b => b.state === 'expansion').length;

  if (dist >= 2)         return 'Fase de Distribución';
  if (exp  >= 3)         return 'Expansión de Tendencia';
  if (bull > bear * 1.5) return 'Sesgo Apetito por Riesgo';
  if (bear > bull * 1.5) return 'Sesgo Defensivo';
  return 'Transición / Mixto';
}
