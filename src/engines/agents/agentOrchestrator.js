/**
 * agentOrchestrator.js — Institutional Multi-Agent Decision System v1.0
 *
 * Synthesizes 6 specialized agents into a single Institutional Consensus.
 * All computation is pure: no API calls, no side effects, no state.
 *
 * Agents:
 *   COT Agent        — CFTC positioning, leveraged money flow, extremes
 *   Macro Agent      — yield spreads, USD bias, VIX regime
 *   Liquidity Agent  — liquidity conditions, risk regime classification
 *   Intraday Agent   — execution quality, tactical momentum, timing
 *   Crypto Agent     — crypto regime, BTC/DXY relationship, positioning
 *   Risk Manager     — VETO power, consensus aggregation, environment classification
 *
 * Input shape: AgentInputs (see JSDoc below)
 * Output shape: AgentConsensus (see JSDoc below)
 */

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const REGIME_LIQUIDITY_BASE = {
  RISK_ON:          75,
  RISK_OFF:         28,
  STAGFLATION:      32,
  DISINFLATION:     60,
  LIQUIDITY_STRESS: 8,
  TRANSITIONAL:     50,
};

const USD_BIAS_NUM = {
  USD_STRONG:         2,
  USD_LEANING_STRONG: 1,
  NEUTRAL:            0,
  USD_LEANING_WEAK:  -1,
  USD_WEAK:          -2,
};

// ─── COT AGENT ────────────────────────────────────────────────────────────────

function runCotAgent({ biasArr = [] }) {
  if (!biasArr.length) {
    return {
      score: 50, confidence: 'unavailable', direction: 'neutral',
      signals: ['Sin datos COT cargados — sube un archivo CFTC para activar'],
      warnings: [], breakdown: { bullCount: 0, bearCount: 0, extremeCount: 0 },
    };
  }

  const validBias = biasArr.filter(b => b && typeof b.score === 'number');
  if (!validBias.length) {
    return {
      score: 50, confidence: 'low', direction: 'neutral',
      signals: ['Datos COT presentes pero puntuaciones no disponibles'],
      warnings: [], breakdown: {},
    };
  }

  const bullish   = validBias.filter(b => b.score > 1);
  const bearish   = validBias.filter(b => b.score < -1);
  const strongBull = validBias.filter(b => b.score > 2.5);
  const strongBear = validBias.filter(b => b.score < -2.5);
  const extremes  = validBias.filter(b => Math.abs(b.score) >= 4);

  // Weighted average bias score
  const avgBias = validBias.reduce((s, b) => s + b.score, 0) / validBias.length;
  const score   = Math.min(100, Math.max(0, Math.round(50 + avgBias * 9)));

  // Expansion-state pairs = institutional positioning actively building
  const expansionPairs = validBias.filter(b => b.state === 'expansion' || b.state === 'building');
  const distribution   = validBias.filter(b => b.state === 'distribution');

  // Confluence: pairs where macro, carry, and COT all agree
  const highConfluence = validBias.filter(b => b.confluence?.score >= 3);

  const confidence = strongBull.length + strongBear.length >= 3 ? 'high'
                   : strongBull.length + strongBear.length >= 1 ? 'medium' : 'low';

  const direction = avgBias > 0.4 ? 'bull' : avgBias < -0.4 ? 'bear' : 'neutral';

  const signals = [];
  if (bullish.length > bearish.length) {
    signals.push(`${bullish.length}/${validBias.length} pares FX neto largo — flujo institucional alcista`);
  } else if (bearish.length > bullish.length) {
    signals.push(`${bearish.length}/${validBias.length} pares FX neto corto — flujo institucional bajista`);
  } else {
    signals.push(`Posicionamiento COT mixto — sin ventaja direccional establecida`);
  }
  if (expansionPairs.length >= 2) {
    signals.push(`${expansionPairs.length} pares en estado de expansión — acumulación activa detectada`);
  }
  if (highConfluence.length) {
    const names = highConfluence.slice(0, 3).map(b => b.pair).join(', ');
    signals.push(`Alineación de alta confluencia: ${names}`);
  }
  strongBull.slice(0, 2).forEach(b =>
    signals.push(`${b.pair}: posición neta larga institucional fuerte (puntuación ${b.score > 0 ? '+' : ''}${b.score?.toFixed(1)})`)
  );
  strongBear.slice(0, 2).forEach(b =>
    signals.push(`${b.pair}: posición neta corta institucional fuerte (puntuación ${b.score?.toFixed(1)})`)
  );

  const warnings = [];
  extremes.forEach(b => {
    warnings.push(`${b.pair}: posicionamiento en extremo — riesgo de reversión a la media elevado`);
  });
  if (distribution.length >= 2) {
    warnings.push(`${distribution.length} pares mostrando distribución — señal de desenredo institucional`);
  }

  return {
    score, confidence, direction, avgBias: parseFloat(avgBias.toFixed(2)),
    signals: signals.slice(0, 5),
    warnings: warnings.slice(0, 3),
    breakdown: {
      bullCount: bullish.length,
      bearCount: bearish.length,
      extremeCount: extremes.length,
      totalPairs: validBias.length,
    },
  };
}

// ─── MACRO AGENT ─────────────────────────────────────────────────────────────

function runMacroAgent({ macroSignal, sharedLiveVix }) {
  if (!macroSignal) {
    return {
      score: 50, confidence: 'unavailable', regime: 'UNKNOWN', usdBias: 'NEUTRAL',
      vix: null, signals: ['Señal macro cargando — actualiza en 30 minutos'],
      warnings: [], biasNum: 0,
    };
  }

  const usdBias  = macroSignal.bias || 'NEUTRAL';
  const biasNum  = USD_BIAS_NUM[usdBias] ?? 0;
  const macroConf = macroSignal.confidence || 0; // 0-10

  // Base score from USD bias direction (50 = neutral)
  let score = 50 + biasNum * 9 + (macroConf - 5) * 1.5;

  // VIX adjustment
  const vix = typeof sharedLiveVix === 'number' ? sharedLiveVix : null;
  if (vix !== null) {
    if (vix > 30) score -= 15;
    else if (vix > 25) score -= 8;
    else if (vix > 20) score -= 3;
    else if (vix < 13) score += 5;
    else if (vix < 16) score += 2;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  const confidence = macroConf >= 7 ? 'high' : macroConf >= 4 ? 'medium' : 'low';

  // Regime from bias + VIX
  const regime = biasNum >= 1 ? 'USD_BULLISH'
               : biasNum <= -1 ? 'USD_BEARISH' : 'NEUTRAL';

  const signals = [];
  if (macroSignal.drivers?.length) {
    macroSignal.drivers.slice(0, 3).forEach(d => signals.push(d));
  } else {
    signals.push(`Sesgo macro USD: ${usdBias.replace(/_/g, ' ')}`);
  }
  if (vix !== null) {
    const vixLabel = vix > 30 ? 'miedo extremo' : vix > 25 ? 'miedo elevado' : vix > 20 ? 'cautela' : vix < 13 ? 'complacencia' : 'neutral';
    signals.push(`VIX ${vix.toFixed(1)} — ${vixLabel}`);
  }

  const warnings = [];
  if (vix !== null && vix > 25) warnings.push(`VIX ${vix.toFixed(0)} — presión risk-off activa, reducir tamaño`);
  if (usdBias === 'USD_WEAK' && vix !== null && vix > 20) {
    warnings.push('Debilidad USD + VIX elevado — riesgo de desenredo de carry activo');
  }
  if (macroConf <= 2) warnings.push('Confianza en señal macro baja — datos de spread de rendimiento insuficientes');

  return { score, confidence, regime, usdBias, biasNum, vix, signals, warnings };
}

// ─── LIQUIDITY AGENT ─────────────────────────────────────────────────────────

function runLiquidityAgent({ riskRegime, sharedLiveVix }) {
  const regime = riskRegime?.regime || 'TRANSITIONAL';
  const regimeConf = riskRegime?.confidence || 0;

  let score = REGIME_LIQUIDITY_BASE[regime] ?? 50;

  // Confidence adjustment
  if (regimeConf < 3) score = 50 + (score - 50) * 0.5; // low conf → pull toward neutral

  // VIX
  const vix = typeof sharedLiveVix === 'number' ? sharedLiveVix : null;
  if (vix !== null) {
    if (vix > 32) score -= 22;
    else if (vix > 27) score -= 13;
    else if (vix > 22) score -= 6;
    else if (vix < 13) score += 8;
    else if (vix < 16) score += 3;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  const condition = score >= 65 ? 'AMPLE' : score >= 42 ? 'ADEQUATE' : score >= 25 ? 'TIGHT' : 'STRESSED';
  const confidence = regimeConf >= 6 ? 'high' : regimeConf >= 3 ? 'medium' : 'low';

  const REGIME_LABELS = {
    RISK_ON:          'Expansión Risk-On',
    RISK_OFF:         'Risk-Off / Defensivo',
    STAGFLATION:      'Presión Estanflacionaria',
    DISINFLATION:     'Repricing Desinflacionario',
    LIQUIDITY_STRESS: 'Estrés de Liquidez',
    TRANSITIONAL:     'Transicional / Mixto',
  };

  const signals = [];
  signals.push(`Régimen: ${REGIME_LABELS[regime] || regime}`);
  signals.push(`Condición de liquidez: ${condition}`);
  if (riskRegime?.keyDrivers?.length) {
    riskRegime.keyDrivers.slice(0, 2).forEach(d => signals.push(d));
  }

  const warnings = [];
  if (condition === 'STRESSED') warnings.push('Estrés de liquidez — el tamaño de posición debe reducirse');
  if (regime === 'LIQUIDITY_STRESS') warnings.push('Patrón de desapalancamiento institucional forzado detectado');
  if (regime === 'RISK_OFF') warnings.push('Régimen defensivo — demanda de USD y bonos elevada');
  if (condition === 'TIGHT') warnings.push('Liquidez ajustada — evitar entradas en sesiones de baja liquidez');

  return { score, condition, regime, confidence, regimeLabel: REGIME_LABELS[regime], signals, warnings };
}

// ─── INTRADAY AGENT ───────────────────────────────────────────────────────────

function runIntradayAgent({ currentContext, sentimentData, allSentimentData, tradeReadinessScore, tacStateMap, selectedPair }) {
  // Use currentContext.intradayScore if available, else tradeReadinessScore as proxy
  const intradayScore = typeof currentContext?.intradayScore === 'number'
    ? currentContext.intradayScore
    : typeof tradeReadinessScore === 'number' ? tradeReadinessScore : 50;

  const trs = typeof tradeReadinessScore === 'number' ? tradeReadinessScore : 100;
  const fg  = allSentimentData?.fg ?? sentimentData?.fg ?? 50;
  const highEventCount = allSentimentData?.highCount ?? sentimentData?.highCount ?? 0;

  // Score
  let score = intradayScore;
  // Bias from fear/greed extremes
  if (fg < 20) score -= 8;
  else if (fg < 30) score -= 4;
  else if (fg > 80) score -= 5; // extreme greed → overextension risk

  score = Math.min(100, Math.max(0, Math.round(score)));

  const quality = score >= 78 ? 'HIGH' : score >= 62 ? 'MEDIUM' : score >= 45 ? 'LOW' : 'AVOID';

  // Tactical momentum
  const tac = tacStateMap?.[selectedPair || 'EUR/USD'];
  const tacLabel = tac?.pressure === 'bullish' ? 'momentum alcista'
                 : tac?.pressure === 'bearish' ? 'momentum bajista'
                 : tac?.pressure === 'neutral' ? 'momentum neutral' : null;

  const signals = [];
  signals.push(`Calidad de ejecución: ${quality} (${score}/100)`);
  signals.push(`Preparación para operar: ${trs}/100`);
  if (tacLabel) signals.push(`Momentum táctico 4H: ${tacLabel}`);
  const fgLabel = fg < 25 ? 'miedo extremo' : fg < 40 ? 'miedo' : fg > 75 ? 'codicia extrema' : fg > 60 ? 'codicia' : 'neutral';
  signals.push(`Índice Miedo/Codicia: ${fgLabel} (${Math.round(fg)})`);

  const warnings = [];
  if (quality === 'AVOID') warnings.push('Ejecución bloqueada — condiciones por debajo del umbral mínimo');
  else if (quality === 'LOW') warnings.push('Ventana de ejecución subóptima — reducir tamaño de posición');
  if (highEventCount >= 3) warnings.push(`${highEventCount} eventos de alto impacto programados — precaución pre-evento`);
  if (fg < 20) warnings.push('Miedo extremo — acción del precio por pánico, evitar seguir tendencias');

  return { score, quality, trs, fg, signals, warnings };
}

// ─── RISK MANAGER AGENT (VETO POWER) ─────────────────────────────────────────

function runRiskManagerAgent({ cotAgent, macroAgent, liquidityAgent, intradayAgent }) {
  // Weighted consensus
  const WEIGHTS = { cot: 0.32, macro: 0.30, liquidity: 0.24, intraday: 0.14 };
  const score = Math.round(
    cotAgent.score      * WEIGHTS.cot      +
    macroAgent.score    * WEIGHTS.macro     +
    liquidityAgent.score * WEIGHTS.liquidity +
    intradayAgent.score  * WEIGHTS.intraday
  );

  // Risk level from total warning count + individual agent states
  const allWarnings = [
    ...cotAgent.warnings,
    ...macroAgent.warnings,
    ...liquidityAgent.warnings,
    ...intradayAgent.warnings,
  ];
  const riskLevel = allWarnings.length >= 5 ? 'EXTREME'
                  : allWarnings.length >= 3 ? 'HIGH'
                  : allWarnings.length >= 1 ? 'MODERATE' : 'LOW';

  // Veto logic — hard conditions that override consensus
  const vetoConditions = [
    liquidityAgent.score < 15
      ? 'Liquidity stress critical — disorderly price action risk'
      : null,
    intradayAgent.quality === 'AVOID'
      ? 'Execution conditions below minimum threshold — stand aside'
      : null,
    riskLevel === 'EXTREME' && score < 32
      ? 'Multiple concurrent extreme risk factors — capital preservation mode'
      : null,
    liquidityAgent.regime === 'LIQUIDITY_STRESS' && macroAgent.score < 35
      ? 'Liquidity stress + macro deterioration — dangerous combination'
      : null,
  ].filter(Boolean);

  const veto = vetoConditions.length > 0;
  const vetoReason = vetoConditions[0] || null;

  // Environment classification
  const environment = veto ? 'DANGER'
                    : score >= 68 ? 'FAVORABLE'
                    : score >= 52 ? 'CAUTION'
                    : score >= 36 ? 'DEFENSIVE'
                    : 'DANGER';

  const ENV_CONFIG = {
    FAVORABLE: { color: '#22c55e', label: 'FAVORABLE',   desc: 'Alineación institucional favorable para ejecución' },
    CAUTION:   { color: '#f59e0b', label: 'PRECAUCIÓN',  desc: 'Condiciones mixtas — ejecución selectiva únicamente' },
    DEFENSIVE: { color: '#f97316', label: 'DEFENSIVO',   desc: 'Riesgo elevado — reducir exposición y esperar claridad' },
    DANGER:    { color: '#ef4444', label: 'PELIGRO',     desc: 'Condiciones adversas — prioridad: preservar capital' },
  };

  // Best conditions (actionable)
  const best = [];
  if (cotAgent.direction === 'bull' && cotAgent.confidence !== 'low') {
    best.push('Long positioning aligned with institutional COT flow');
  }
  if (cotAgent.direction === 'bear' && cotAgent.confidence !== 'low') {
    best.push('Short positioning aligned with institutional COT flow');
  }
  if (liquidityAgent.condition === 'AMPLE') best.push('Market depth supports normal position sizing');
  if (macroAgent.biasNum < 0) best.push('USD weakness creates favorable backdrop for risk assets');
  if (macroAgent.biasNum > 0) best.push('USD strength favors USD-long, commodity-short positioning');
  if (intradayAgent.quality === 'HIGH') best.push('Execution conditions at premium — full sizing permitted');
  if (liquidityAgent.regime === 'RISK_ON') best.push('Risk-on institutional flows support broad long bias');

  // Avoid conditions
  const avoid = [];
  if (riskLevel === 'HIGH' || riskLevel === 'EXTREME') avoid.push('Oversizing in current risk environment');
  if (intradayAgent.quality === 'LOW' || intradayAgent.quality === 'AVOID') {
    avoid.push('Intraday scalping — execution conditions degraded');
  }
  if (macroAgent.vix > 25) avoid.push('Directional trend-following with VIX above 25');
  if (cotAgent.breakdown?.extremeCount >= 2) avoid.push('Counter-trend positioning — extreme COT readings present');
  allWarnings.slice(0, 3).forEach(w => { if (!avoid.includes(w)) avoid.push(w); });

  return {
    score, riskLevel, veto, vetoReason, environment,
    envConfig: ENV_CONFIG[environment],
    best: best.slice(0, 5),
    avoid: avoid.slice(0, 5),
    allWarnings: allWarnings.slice(0, 8),
  };
}

// ─── ORCHESTRATOR — PUBLIC API ────────────────────────────────────────────────

/**
 * runAgentConsensus — main entry point.
 *
 * @param {{
 *   biasArr:            Array,
 *   fxPairs:            Array,
 *   allBiasArr:         Array,
 *   combinedData:       Object|null,
 *   macroSignal:        Object|null,
 *   ratesData:          Object|null,
 *   riskRegime:         Object|null,
 *   sharedLiveVix:      number|null,
 *   sentimentData:      Object,
 *   allSentimentData:   Object,
 *   tradeReadinessScore:number,
 *   tacStateMap:        Object,
 *   selectedPair:       string,
 *   currentContext:     Object|null,
 * }} inputs
 *
 * @returns {{
 *   consensus:   { score, label, direction, confidence },
 *   environment: string,
 *   envConfig:   { color, label, desc },
 *   probability: { continuation, reversal, trap },
 *   risk:        { level, veto, vetoReason, factors },
 *   conditions:  { best, avoid },
 *   agents:      { cot, macro, liquidity, intraday, riskManager },
 *   summary:     string,
 *   timestamp:   Date,
 * }}
 */
export function runAgentConsensus(inputs = {}) {
  const cotAgent       = runCotAgent(inputs);
  const macroAgent     = runMacroAgent(inputs);
  const liquidityAgent = runLiquidityAgent(inputs);
  const intradayAgent  = runIntradayAgent(inputs);
  const riskManager    = runRiskManagerAgent({
    cotAgent, macroAgent, liquidityAgent, intradayAgent,
  });

  const direction = cotAgent.direction === 'bull' ? 'LONG BIAS'
                  : cotAgent.direction === 'bear' ? 'SHORT BIAS' : 'NEUTRAL';

  const summary = riskManager.veto
    ? `RISK MANAGER VETO — ${riskManager.vetoReason}`
    : `${riskManager.envConfig?.label || riskManager.environment} · ${direction} · ${riskManager.riskLevel} RISK`;

  // Probability estimates
  const probContinuation = Math.min(95, Math.max(10, riskManager.score + 5));
  const probReversal     = Math.max(5, 100 - riskManager.score - 5);
  const probTrap = riskManager.riskLevel === 'EXTREME' ? 45
                 : riskManager.riskLevel === 'HIGH'    ? 30
                 : riskManager.riskLevel === 'MODERATE'? 18 : 10;

  return {
    consensus: {
      score:      riskManager.score,
      label:      riskManager.envConfig?.label || riskManager.environment,
      direction,
      confidence: cotAgent.confidence,
    },
    environment:  riskManager.environment,
    envConfig:    riskManager.envConfig,
    probability: {
      continuation: probContinuation,
      reversal:     probReversal,
      trap:         probTrap,
    },
    risk: {
      level:      riskManager.riskLevel,
      veto:       riskManager.veto,
      vetoReason: riskManager.vetoReason,
      factors:    riskManager.allWarnings,
    },
    conditions: {
      best:  riskManager.best,
      avoid: riskManager.avoid,
    },
    agents: {
      cot:         cotAgent,
      macro:       macroAgent,
      liquidity:   liquidityAgent,
      intraday:    intradayAgent,
      riskManager,
    },
    summary,
    timestamp: new Date(),
  };
}
