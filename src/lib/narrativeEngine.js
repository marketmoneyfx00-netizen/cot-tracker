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
