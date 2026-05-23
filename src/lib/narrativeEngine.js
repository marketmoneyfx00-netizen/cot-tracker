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
        'Cross-asset positioning reflects a risk-on institutional posture, with growth-sensitive ' +
        'allocations increasing and defensive exposure declining.',
      RISK_OFF:
        'Multi-asset flows indicate a defensive institutional posture, with safe-haven ' +
        'positioning elevated across fixed income and gold.',
      STAGFLATION:
        'Positioning is consistent with stagflationary pressure: inflation hedges are bid, ' +
        'duration is under selling pressure, and growth-sensitive assets are under stress.',
      DISINFLATION:
        'Institutional flows reflect disinflationary repricing: fixed income accumulation ' +
        'dominates while energy and commodity positioning retreats.',
      LIQUIDITY_STRESS:
        'Cross-asset patterns signal potential liquidity stress — dollar demand elevated ' +
        'alongside broad institutional de-risking.',
    };
    return regimeMap[regime.regime] ?? 'Macro backdrop shows transitional signals across asset classes.';
  }

  // Fall back to USD yield-spread signal (backward compat)
  if (!macroSignal?.bias || macroSignal.bias === 'NEUTRAL') {
    return 'The macro backdrop remains neutral, with no dominant directional signal from monitored yield spreads.';
  }
  const conf      = macroSignal.confidence ?? 5;
  const confLabel = conf >= 8 ? 'strong' : conf >= 5 ? 'moderate' : 'tentative';
  const map = {
    USD_STRONG:
      `The macro environment reflects ${confLabel} USD strength, driven by favorable yield ` +
      `spread dynamics — a headwind for risk-sensitive and USD-funded positions.`,
    USD_LEANING_STRONG:
      `USD is showing a ${confLabel} bullish tilt in the macro layer, though conviction ` +
      `remains below definitive threshold.`,
    USD_WEAK:
      `Macro conditions reflect ${confLabel} USD weakness across monitored yield spreads — ` +
      `generally supportive for risk assets and non-dollar positioning.`,
    USD_LEANING_WEAK:
      `A tentative USD softening is visible in the macro layer, though spread-based signals ` +
      `have not yet reached full conviction.`,
  };
  return map[macroSignal.bias] ?? 'Macro backdrop shows mixed signals across major yield spreads.';
}

// ── DIVERGENCE COMMENTARY ─────────────────────────────────────────────────────

function divergenceSentence(biasArr) {
  const exhausted = biasArr.filter(b => b.divergence?.state === 'EXHAUSTION');
  const bullDiv   = biasArr.filter(b => b.divergence?.state === 'BULLISH_DIVERGENCE');
  const bearDiv   = biasArr.filter(b => b.divergence?.state === 'BEARISH_DIVERGENCE');

  const parts = [];

  if (exhausted.length) {
    parts.push(
      `Positioning exhaustion is active in ${exhausted.map(b => b.pair).join(' and ')}, ` +
      `where extreme z-scores coincide with aligned trend direction — an elevated reversal risk environment.`
    );
  }
  if (bullDiv.length) {
    parts.push(
      `${bullDiv.map(b => b.pair).join(' and ')} show institutional accumulation against declining ` +
      `price — a classic smart money divergence setup pointing toward potential recovery.`
    );
  }
  if (bearDiv.length) {
    parts.push(
      `${bearDiv.map(b => b.pair).join(' and ')} display distribution patterns, ` +
      `with Leveraged Money reducing long exposure while price advances — a bearish divergence signal.`
    );
  }

  return parts.join(' ') || 'No significant price-positioning divergence detected across monitored assets.';
}

// ── ASSET-CLASS OPENING SENTENCES ─────────────────────────────────────────────

const ASSET_CLASS_OPENERS = {
  fx: {
    strong_bull:  (pair) => `${pair} exhibits strong bullish institutional conviction, with Leveraged Money maintaining significant net long positioning.`,
    mod_bull:     (pair) => `${pair} shows moderate bullish institutional bias, supported by net long Leveraged Money positioning.`,
    weak_bull:    (pair) => `${pair} carries a mild bullish lean from institutional accounts, though conviction remains limited.`,
    neutral:      (pair) => `${pair} remains in a neutral institutional state, with no dominant directional bias from Leveraged Money.`,
    weak_bear:    (pair) => `${pair} has a mild bearish lean institutionally, though net short positioning lacks strong conviction.`,
    mod_bear:     (pair) => `${pair} shows moderate bearish institutional bias, with net short positioning from speculative accounts.`,
    strong_bear:  (pair) => `${pair} reflects strong bearish institutional pressure, with Leveraged Money accumulating net short exposure.`,
  },
  index: {
    strong_bull:  (pair) => `${pair} reflects strong institutional equity risk appetite, with Leveraged Money maintaining significant net long exposure in index futures.`,
    mod_bull:     (pair) => `${pair} shows moderate bullish bias in equity futures, with net long Leveraged Money positioning.`,
    weak_bull:    (pair) => `${pair} carries a mild bullish lean in index futures, though institutional conviction remains limited.`,
    neutral:      (pair) => `${pair} index futures positioning is neutral — no dominant directional institutional bias is established.`,
    weak_bear:    (pair) => `${pair} index futures show a mild bearish lean, though net short positioning lacks strong conviction.`,
    mod_bear:     (pair) => `${pair} reflects moderate bearish institutional bias in equity futures, with declining net long exposure.`,
    strong_bear:  (pair) => `${pair} equity futures are under strong institutional selling pressure, with Leveraged Money accumulating net short exposure.`,
  },
  commodities: {
    strong_bull:  (pair) => `${pair} exhibits strong institutional accumulation, with Leveraged Money holding significant net long exposure — consistent with demand-side or inflation-hedge positioning.`,
    mod_bull:     (pair) => `${pair} shows moderate bullish institutional positioning, with net long Leveraged Money exposure.`,
    weak_bull:    (pair) => `${pair} carries a mild bullish lean from institutional accounts.`,
    neutral:      (pair) => `${pair} positioning is neutral, with no dominant directional institutional bias.`,
    weak_bear:    (pair) => `${pair} has a mild bearish lean institutionally, with modest net short positioning.`,
    mod_bear:     (pair) => `${pair} shows moderate bearish institutional bias — Leveraged Money is reducing exposure.`,
    strong_bear:  (pair) => `${pair} reflects strong institutional selling pressure, with Leveraged Money holding significant net short exposure.`,
  },
  bonds: {
    strong_bull:  (pair) => `${pair} reflects strong institutional fixed income accumulation — Leveraged Money maintaining significant net long duration exposure, consistent with rate-decline expectations.`,
    mod_bull:     (pair) => `${pair} shows moderate institutional demand for fixed income, with net long positioning in the rate complex.`,
    weak_bull:    (pair) => `${pair} carries a mild bullish lean in fixed income positioning, though duration conviction remains limited.`,
    neutral:      (pair) => `${pair} fixed income positioning is neutral, with no dominant rate expectation bias established.`,
    weak_bear:    (pair) => `${pair} shows a mild bearish lean in fixed income — modest net short positioning implies limited inflation premium expectations.`,
    mod_bear:     (pair) => `${pair} reflects moderate institutional fixed income selling, consistent with rising yield expectations.`,
    strong_bear:  (pair) => `${pair} fixed income is under strong institutional selling pressure — net short duration positioning implies elevated inflation premium expectations.`,
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
      `The ${direction} bias has persisted for ${streak} consecutive CFTC reports, ` +
      `reinforcing the medium-term directional thesis.`
    );
  }

  // Z-score extremes (generic)
  if (zsc.zscore != null) {
    if (Math.abs(zsc.zscore) >= 2.5) {
      sentences.push(
        `Positioning is at historical extremes (Z-score: ${fmtScore(zsc.zscore)}, ` +
        `${zsc.percentile}th percentile) — elevated reversal risk.`
      );
    } else if (Math.abs(zsc.zscore) >= 1.5) {
      sentences.push(
        `Z-score reads ${fmtScore(zsc.zscore)} (${zsc.percentile}th percentile), indicating ` +
        `positioning is stretched but not yet extreme.`
      );
    }
  }

  // Divergence (generic)
  if (div.state === 'EXHAUSTION') {
    sentences.push(
      `An exhaustion signal is active — price trend and positioning are aligned at extremes. ` +
      `Watch for reversal catalysts.`
    );
  } else if (div.state === 'BULLISH_DIVERGENCE') {
    sentences.push(
      `A bullish divergence is present: institutions are accumulating while price softens — ` +
      `a potential reversal setup.`
    );
  } else if (div.state === 'BEARISH_DIVERGENCE') {
    sentences.push(
      `A bearish divergence is visible: institutions are reducing exposure into price strength — ` +
      `distribution signal.`
    );
  }

  // Execution (generic)
  if (execLabel === 'FAVORABLE') {
    sentences.push(
      `Intraday execution conditions are currently favorable for directional entries aligned ` +
      `with the institutional bias.`
    );
  } else if (execLabel === 'IMPROVING') {
    sentences.push(
      `Execution conditions are improving — pullback setups may offer better risk/reward ` +
      `than chasing current price action.`
    );
  } else {
    sentences.push(
      `Intraday execution is restricted. Await improvement in macro risk conditions before ` +
      `executing directional trades.`
    );
  }

  // Carry / confluence (FX-specific framing only for FX; generic for others)
  if (confScore >= 70) {
    sentences.push(
      cat === 'fx'
        ? `Multi-factor confluence score of ${Math.round(confScore)}/100 indicates strong alignment ` +
          `across COT, carry, macro, and central bank policy vectors.`
        : `Multi-factor confluence score of ${Math.round(confScore)}/100 indicates strong signal ` +
          `alignment across COT positioning, macro, and volatility regime vectors.`
    );
  } else if (confScore >= 45) {
    sentences.push(
      `Confluence score of ${Math.round(confScore)}/100 shows partial alignment — confirmation ` +
      `from at least one additional factor is advisable before adding directional exposure.`
    );
  }

  return sentences.join(' ');
}

// ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────────────

export function generateExecutiveSummary({ biasArr, macroSignal, cotDate, snapshotDate, regime, crossAssetCtx }) {
  if (!biasArr?.length) return 'No institutional data available for analysis.';

  const bullish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish');
  const bearish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish');
  const neutral = biasArr.filter(b => !['bullish', 'bearish'].includes(b.bias?.direction ?? b.direction));

  const topBullish = [...bullish].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topBearish = [...bearish].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const tone = bullish.length > bearish.length + 1 ? 'broadly bullish'
    : bearish.length > bullish.length + 1           ? 'broadly bearish'
    : 'mixed';

  const sentences = [];

  // Opening: asset count + tone
  sentences.push(
    `As of the ${cotDate ?? snapshotDate ?? 'latest'} CFTC report, institutional positioning ` +
    `across ${biasArr.length} monitored asset${biasArr.length !== 1 ? 's' : ''} is ${tone}, ` +
    `with ${bullish.length} bullish, ${bearish.length} bearish, and ${neutral.length} neutral.`
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
      `${topBullish.slice(0, 2).map(b => b.pair).join(' and ')} present the strongest bullish ` +
      `institutional setups, with Leveraged Money maintaining elevated net long exposure ` +
      `across consecutive reports.`
    );
  } else if (topBullish.length === 1) {
    sentences.push(
      `${topBullish[0].pair} stands out as the primary bullish institutional setup this week.`
    );
  }

  // Top bearish setups
  if (topBearish.length >= 2) {
    sentences.push(
      `${topBearish.slice(0, 2).map(b => b.pair).join(' and ')} reflect the most significant ` +
      `bearish institutional pressure, with continued reduction in net long exposure.`
    );
  }

  // Divergence
  const divSentence = divergenceSentence(biasArr);
  if (divSentence) sentences.push(divSentence);

  // Extreme z-score risk note
  const extremes = biasArr.filter(b => b.zscore && Math.abs(b.zscore.zscore ?? 0) >= 2);
  if (extremes.length >= 2) {
    sentences.push(
      `Elevated z-scores in ${extremes.map(b => b.pair).join(', ')} warrant risk management ` +
      `discipline — extended positioning historically precedes sharp mean-reversion moves.`
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
      headline:   'Transitional Macro Environment',
      body:       regime?.description ?? 'Cross-asset COT positioning does not yet establish a dominant macro regime. Monitor for convergence.',
      keyDrivers: regime?.keyDrivers ?? [],
    };
  }

  const conf = regime.confidence ?? 0;
  const confQual = conf >= 70 ? 'high-conviction' : conf >= 50 ? 'moderate-conviction' : 'emerging';

  return {
    headline:   `${regime.label} (${confQual}, ${conf}% confidence)`,
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
    strong_bull:  (p) => `${p}: Institutional accumulation at scale — strong bullish conviction`,
    mod_bull:     (p) => `${p}: Leveraged Money net long, bullish thesis intact`,
    weak_bull:    (p) => `${p}: Mild bullish lean — insufficient conviction for high-probability setup`,
    neutral:      (p) => `${p}: No dominant institutional directional bias`,
    weak_bear:    (p) => `${p}: Mild bearish lean — conviction below threshold`,
    mod_bear:     (p) => `${p}: Leveraged Money net short, bearish thesis building`,
    strong_bear:  (p) => `${p}: Institutional distribution confirmed — strong bearish signal`,
  };
  const headlineKey = getOpeningKey(score);
  const headline    = headlineMap[headlineKey]?.(pair) ?? `${pair}: Positioning signal available`;

  // ── MACRO CONTEXT ─────────────────────────────────────────────────────────
  let macroContext = null;
  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    macroContext = `The macro regime is classified as ${riskRegime.label} (${riskRegime.confidence}% confidence). `;
    if (cat === 'fx') {
      macroContext += macroSignal?.bias
        ? `USD macro bias reads ${macroSignal.bias.replace(/_/g, ' ')} with ${macroSignal.confidence}/10 confidence.`
        : 'USD yield spread signals are not conclusive.';
    } else if (cat === 'index') {
      macroContext += riskRegime.regime === 'RISK_ON'
        ? 'A risk-on macro posture is constructive for equity long exposure.'
        : riskRegime.regime === 'RISK_OFF'
        ? 'A risk-off macro environment creates headwinds for equity futures longs.'
        : `The ${riskRegime.regime.replace(/_/g, '-')} regime creates mixed conditions for equity futures.`;
    } else if (cat === 'bonds') {
      macroContext += riskRegime.regime === 'DISINFLATION'
        ? 'Disinflationary regime is constructive for fixed income duration longs.'
        : riskRegime.regime === 'STAGFLATION'
        ? 'Stagflationary conditions create headwinds for bond longs — inflation premium drives yields higher.'
        : `The current macro regime has ${riskRegime.signals?.bonds === direction ? 'aligned' : 'mixed'} implications for fixed income.`;
    } else if (cat === 'commodities') {
      macroContext += riskRegime.regime === 'STAGFLATION'
        ? 'Stagflationary conditions are structurally supportive for commodity inflation hedges.'
        : riskRegime.regime === 'RISK_ON'
        ? 'Risk-on macro posture supports demand-driven commodity bid.'
        : `${riskRegime.label} regime has varying implications across commodity sub-classes.`;
    }
  } else {
    macroContext = macroSignal?.implication
      ?? 'Macro context is transitional or insufficient for high-conviction regime classification.';
  }

  // ── INSTITUTIONAL READING ─────────────────────────────────────────────────
  const netStr     = latest.smartNet != null ? (latest.smartNet > 0 ? '+' : '') + Math.round(latest.smartNet / 1000) + 'K' : '—';
  const pctL       = latest.smartPctL != null ? latest.smartPctL.toFixed(1) + '%' : '—';
  const institutional = `Leveraged Money holds net ${latest.smartNet >= 0 ? 'long' : 'short'} ${netStr} contracts (${pctL} long). ` +
    (latest.assetNet != null
      ? `Asset Managers ${latest.assetNet > 0 ? 'confirm with net long' : 'diverge net short'} ${Math.round(Math.abs(latest.assetNet) / 1000)}K.`
      : '') +
    (streak >= 2
      ? ` This directional bias has persisted for ${streak} consecutive CFTC reports.`
      : ' Streak below threshold for trend confirmation.');

  // ── POSITIONING READING ───────────────────────────────────────────────────
  let positioning = null;
  if (zsc.zscore != null) {
    const zAbs = Math.abs(zsc.zscore);
    if (zAbs >= 2.5) {
      positioning = `Positioning is at a multi-year extreme (Z-score: ${zsc.zscore > 0 ? '+' : ''}${zsc.zscore?.toFixed(2)}, ${zsc.percentile}th percentile). ` +
        `At these levels, historical mean-reversion risk is elevated. Carry/macro alignment required before adding directional exposure.`;
    } else if (zAbs >= 1.5) {
      positioning = `Positioning is stretched but not extreme (Z-score: ${zsc.zscore?.toFixed(2)}, ${zsc.percentile}th percentile). ` +
        `Not a reversal signal in isolation — requires divergence or catalyst to turn actionable.`;
    } else {
      positioning = `Positioning is within normal historical range (Z-score: ${zsc.zscore?.toFixed(2)}, ${zsc.percentile}th percentile). ` +
        `No crowding risk at current levels.`;
    }
  }

  // ── DIVERGENCE READING ────────────────────────────────────────────────────
  let divergence = null;
  if (div.state === 'EXHAUSTION') {
    divergence = `An exhaustion signal is active: price and positioning are co-moving at extremes. ` +
      `Historically, this configuration precedes sharp reversals — prioritize risk management over directional entry.`;
  } else if (div.state === 'BULLISH_DIVERGENCE') {
    divergence = `Bullish divergence detected: institutional accounts accumulating while price declines. ` +
      `Classic smart-money divergence — watch for price confirmation before entering long.`;
  } else if (div.state === 'BEARISH_DIVERGENCE') {
    divergence = `Bearish divergence: Leveraged Money reducing exposure while price advances. ` +
      `Distribution signal — avoid adding longs; evaluate short setups on price exhaustion.`;
  } else {
    divergence = `No significant divergence between price and positioning. Trend and institutional flow are aligned.`;
  }

  // ── WEEKLY FLOW ───────────────────────────────────────────────────────────
  const chgNet  = latest.levChgNet ?? (latest.smartNet - (prev.smartNet ?? 0));
  const flowDir = chgNet > 0 ? 'accumulation' : chgNet < 0 ? 'distribution' : 'flat';
  const flowMag = Math.round(Math.abs(chgNet) / 1000);
  const weeklyFlow = chgNet != null
    ? `Weekly flow shows ${flowDir} of ${flowMag}K contracts. ` +
      (flowDir === 'accumulation' && direction === 'bullish' ? 'Inflows confirm the bullish directional thesis.'
      : flowDir === 'distribution' && direction === 'bearish' ? 'Outflows confirm the bearish directional thesis.'
      : flowDir !== 'flat' ? 'Weekly flow diverges from net positioning — watch for trend development.'
      : 'No significant weekly flow signal.')
    : 'Weekly flow data not available.';

  // ── RATES / CARRY (FX only) ───────────────────────────────────────────────
  let ratesReading = null;
  if (cat === 'fx' && ratesData?.pairs) {
    const pairKey = pair.replace('/', '').toUpperCase();
    const cp = ratesData.pairs.find(p => p.pair?.toUpperCase() === pairKey);
    if (cp) {
      const baseCycle  = cycleProfiles?.[cp.base_bank];
      const quoteCycle = cycleProfiles?.[cp.quote_bank];
      ratesReading = `${cp.base_bank} rate: ${cp.base_rate?.toFixed(2) ?? '—'}% (${baseCycle?.cycleLabel ?? '—'}). ` +
        `${cp.quote_bank} rate: ${cp.quote_rate?.toFixed(2) ?? '—'}% (${quoteCycle?.cycleLabel ?? '—'}). ` +
        `Differential: ${cp.rate_diff_bps != null ? (cp.rate_diff_bps > 0 ? '+' : '') + cp.rate_diff_bps + ' bps' : '—'}. ` +
        `Carry direction: ${cp.carry_direction?.replace(/_/g, ' ') ?? 'neutral'}.`;
      if (baseCycle?.impact?.notes?.length) {
        ratesReading += ' ' + baseCycle.impact.notes[0];
      }
    }
  } else if (cat === 'bonds') {
    // For bonds, rate expectations from the FED cycle are directly relevant
    const fedCycle = cycleProfiles?.['FED'];
    if (fedCycle) {
      ratesReading = `FED currently ${fedCycle.cycleLabel} (${fedCycle.maturityLabel}). ` +
        `Cumulative cycle move: ${fedCycle.cumBps > 0 ? '+' : ''}${fedCycle.cumBps} bps. ` +
        (fedCycle.cycleType === 'HIKING'
          ? 'Ongoing hikes create structural headwinds for long-duration bond positions.'
          : fedCycle.cycleType === 'CUTTING'
          ? 'Rate cuts support fixed income longs — duration accumulation favored.'
          : 'FED on hold — watch for policy pivot signals that affect duration positioning.');
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
    return `Wait for directional confirmation from ${pair}. No actionable scenario while positioning is neutral.`;
  }

  const dirStr = direction === 'bullish' ? 'long' : 'short';
  const oppStr = direction === 'bullish' ? 'bullish' : 'bearish';
  const streakStr = streak >= 3 ? `(${streak}-report streak) ` : '';

  if (cat === 'fx') {
    return `Primary scenario: ${oppStr} ${pair} ${streakStr}with Leveraged Money maintaining net ${dirStr} exposure. ` +
      (regime && regime !== 'TRANSITIONAL' && (
        (direction === 'bullish' && ['RISK_ON'].includes(regime)) ||
        (direction === 'bearish' && ['RISK_OFF', 'LIQUIDITY_STRESS'].includes(regime))
      )
        ? `The ${regime.replace(/_/g, '-')} macro regime provides additional tailwind for this setup.`
        : 'Macro regime is not providing strong directional alignment — rely on COT signal quality.');
  }

  if (cat === 'index') {
    return direction === 'bullish'
      ? `Primary scenario: equity risk appetite remains elevated. ${pair} index futures institutional longs persist. ` +
        (regime === 'RISK_ON' ? 'Risk-on macro regime confirms equity bias.' : 'Watch for regime confirmation to increase conviction.')
      : `Primary scenario: institutional equity de-risking continues. ${pair} futures remain under selling pressure. ` +
        (regime === 'RISK_OFF' ? 'Risk-off macro regime confirms bearish equity bias.' : 'Await macro regime confirmation for full conviction.');
  }

  if (cat === 'bonds') {
    return direction === 'bullish'
      ? `Primary scenario: fixed income accumulation continues — Leveraged Money expects rate declines or needs haven exposure. ` +
        (regime === 'DISINFLATION' ? 'Disinflationary macro regime strongly supports this thesis.' : 'Monitor central bank guidance for rate path confirmation.')
      : `Primary scenario: bond selling pressure persists — inflation premium drives duration reduction. ` +
        (regime === 'STAGFLATION' ? 'Stagflationary regime provides fundamental support for this setup.' : 'Track yield curve for acceleration signals.');
  }

  if (cat === 'commodities') {
    return direction === 'bullish'
      ? `Primary scenario: institutional commodity accumulation continues. ` +
        (pair === 'GOLD' || pair === 'SILVER' ? 'Precious metals bid consistent with inflation hedge or haven demand.' : '') +
        (pair === 'WTI' ? 'Energy bid reflects demand-side confidence or supply constraint.' : '')
      : `Primary scenario: commodity selling pressure extends. ` +
        (pair === 'GOLD' || pair === 'SILVER' ? 'Precious metals reduction implies improving risk appetite or declining inflation expectations.' : '') +
        (pair === 'WTI' ? 'Energy selling consistent with demand softness or supply surplus.' : '');
  }

  return `Primary ${oppStr} scenario: institutional positioning supports ${dirStr} directional bias.`;
}

function buildScenarioAlt(cat, direction, divState, zscore, regime, pair) {
  const inverse = direction === 'bullish' ? 'bearish' : direction === 'bearish' ? 'bullish' : 'neutral';

  if (divState === 'EXHAUSTION' || (zscore != null && Math.abs(zscore) >= 2.5)) {
    return `Alternative scenario (elevated probability): positioning is extended — a catalyst-driven mean-reversion move is possible. ` +
      `Z-score extremes historically precede 2-4 week corrective moves. Monitor for weekly flow reversal (levChgNet sign change) as early warning.`;
  }

  if (divState === 'BULLISH_DIVERGENCE') {
    return `Alternative ${inverse} scenario: price could continue declining despite institutional accumulation. ` +
      `Smart money divergences do not always resolve immediately — confirmation candle or weekly close above key level required before acting.`;
  }

  if (divState === 'BEARISH_DIVERGENCE') {
    return `Alternative ${inverse} scenario: price strength could persist despite institutional distribution. ` +
      `Forced retail buying can extend price above institutional selling — await positioning capitulation (net cross to opposite side) before acting.`;
  }

  // Regime conflict scenarios
  if (direction === 'bullish' && regime === 'RISK_OFF') {
    return `Alternative scenario: risk-off macro regime could override bullish ${pair} COT signal. ` +
      `If macro deterioration accelerates, institutional position reversal is possible despite current long bias.`;
  }
  if (direction === 'bearish' && regime === 'RISK_ON') {
    return `Alternative scenario: risk-on macro tailwinds could force short covering in ${pair}. ` +
      `Monitor for capitulation pattern in positioning — net flip to long would invalidate the bearish setup.`;
  }

  return `Alternative scenario: positioning could reverse if a catalyst disrupts the current institutional consensus. ` +
    `A weekly net flip of Leveraged Money exposure would signal the need to reassess the ${direction} bias.`;
}

function buildInvalidation(cat, direction, latest, divState, regime, pair) {
  const netPos  = latest.smartNet ?? 0;
  const netStr  = Math.round(Math.abs(netPos) / 1000) + 'K';

  const baseInvalidation = direction === 'bullish'
    ? `${pair} bullish thesis is invalidated if: (1) Leveraged Money net flips to negative (currently +${netStr}); ` +
      `(2) Asset Managers shift to net short; (3) Weekly flow shows 2+ consecutive weeks of distribution.`
    : direction === 'bearish'
    ? `${pair} bearish thesis is invalidated if: (1) Leveraged Money net flips to positive (currently ${Math.round(netPos / 1000)}K); ` +
      `(2) Weekly accumulation flow persists 2+ consecutive weeks; (3) % long rises above 50%.`
    : `No active thesis to invalidate. Confirm directional bias before establishing invalidation criteria.`;

  // Asset-class-specific additions
  if (cat === 'index' && direction === 'bearish') {
    return baseInvalidation + ` Additionally: if VIX drops below 15 with equity futures showing weekly accumulation, bearish thesis is compromised.`;
  }
  if (cat === 'bonds' && direction === 'bullish') {
    return baseInvalidation + ` Additionally: a surprise hawkish pivot from the FED would invalidate the bond accumulation thesis regardless of COT signal.`;
  }
  if ((pair === 'GOLD' || pair === 'SILVER') && direction === 'bullish') {
    return baseInvalidation + ` Additionally: a sustained USD strength cycle or rapid disinflation would pressure gold longs despite institutional accumulation.`;
  }

  return baseInvalidation;
}

function buildConclusion(cat, direction, streak, exec, divState, conf) {
  const execLabel = exec?.permission?.label ?? 'RESTRICTED';
  const confScore = conf?.confluenceScore ?? conf?.score ?? 0;
  const execOK    = execLabel === 'FAVORABLE';

  if (direction === 'neutral') {
    return 'No active operational conclusion — await directional confirmation from positioning data before establishing a bias.';
  }

  if (divState === 'EXHAUSTION') {
    return `CAUTION: Exhaustion signal active. Do not add directional exposure at current positioning levels. ` +
      `Wait for positioning reset (z-score below ±1.5) before re-entering in the direction of the institutional bias.`;
  }

  if (!execOK) {
    return `Directional bias is ${direction} — but execution conditions are ${execLabel.toLowerCase()}. ` +
      `Hold the setup thesis, await macro and volatility conditions to improve before committing capital.`;
  }

  if (streak >= 3 && confScore >= 60 && execOK) {
    return `High-conviction operational setup: ${streak}-report ${direction} streak, confluence ${Math.round(confScore)}/100, and favorable execution conditions. ` +
      `Position sizing can reflect elevated signal quality — manage risk via weekly net monitoring, not just price.`;
  }

  if (streak >= 2 && execOK) {
    return `Moderate ${direction} setup with improving conditions. ` +
      `Entry timing should reference intraday structure aligned with the institutional direction. ` +
      `Standard position sizing — do not overweight until confluence crosses 65+.`;
  }

  return `${direction.charAt(0).toUpperCase() + direction.slice(1)} bias noted with execution conditions favorable. ` +
    `Signal streak is limited (${streak} reports) — treat as an early-stage setup and size accordingly. ` +
    `Full conviction requires at least 2-3 consecutive confirmatory reports.`;
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

  if (dist >= 2)         return 'Distribution Phase';
  if (exp  >= 3)         return 'Trend Expansion';
  if (bull > bear * 1.5) return 'Risk-On Bias';
  if (bear > bull * 1.5) return 'Risk-Off Bias';
  return 'Transition / Mixed';
}
