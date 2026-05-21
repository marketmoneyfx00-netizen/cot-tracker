/**
 * narrativeEngine.js — Institutional Narrative Generator v1.0
 *
 * Rule-based commentary from COT Tracker engine outputs.
 * Produces institutional-grade English copy for reports, HTML exports, and PDF.
 */

// ── UTILS ─────────────────────────────────────────────────────────────────────

function top(arr, n = 2) { return arr.slice(0, n); }
function pairLabel(p)    { return p?.pair ?? p ?? '—'; }
function fmtScore(s)     { return s != null ? (s > 0 ? `+${s.toFixed(1)}` : s.toFixed(1)) : '—'; }

// ── MACRO CONTEXT ─────────────────────────────────────────────────────────────

function macroSentence(macroSignal) {
  if (!macroSignal?.bias || macroSignal.bias === 'NEUTRAL') {
    return 'The macro backdrop remains neutral, with no dominant directional USD signal from yield spreads.';
  }
  const conf = macroSignal.confidence ?? 5;
  const confLabel = conf >= 8 ? 'strong' : conf >= 5 ? 'moderate' : 'tentative';
  const map = {
    USD_STRONG:        `The macro environment reflects ${confLabel} USD strength, driven by favorable yield spread dynamics — a headwind for EUR, GBP, and commodity-linked pairs.`,
    USD_LEANING_STRONG:`USD is showing a ${confLabel} bullish tilt in the macro layer, though conviction remains below definitive threshold.`,
    USD_WEAK:          `Macro conditions reflect ${confLabel} USD weakness across monitored yield spreads — supportive for EUR/USD, GBP/USD, and risk-sensitive pairs.`,
    USD_LEANING_WEAK:  `A tentative USD softening is visible in the macro layer, though spread-based signals have not yet reached full conviction.`,
  };
  return map[macroSignal.bias] ?? 'Macro backdrop shows mixed signals across major yield spreads.';
}

// ── DIVERGENCE COMMENTARY ─────────────────────────────────────────────────────

function divergenceSentence(biasArr) {
  const exhausted  = biasArr.filter(b => b.divergence?.state === 'EXHAUSTION');
  const bullDiv    = biasArr.filter(b => b.divergence?.state === 'BULLISH_DIVERGENCE');
  const bearDiv    = biasArr.filter(b => b.divergence?.state === 'BEARISH_DIVERGENCE');

  const parts = [];

  if (exhausted.length) {
    parts.push(
      `Positioning exhaustion is active in ${exhausted.map(b => b.pair).join(' and ')}, ` +
      `where extreme z-scores coincide with aligned trend direction — an elevated reversal risk environment.`
    );
  }
  if (bullDiv.length) {
    parts.push(
      `${bullDiv.map(b => b.pair).join(' and ')} show institutional accumulation against declining price — ` +
      `a classic smart money divergence setup pointing toward potential recovery.`
    );
  }
  if (bearDiv.length) {
    parts.push(
      `${bearDiv.map(b => b.pair).join(' and ')} display distribution patterns, ` +
      `with Leveraged Money reducing long exposure while price advances — a bearish divergence signal.`
    );
  }

  return parts.join(' ') || 'No significant price-positioning divergence detected across monitored pairs.';
}

// ── PAIR COMMENTARY ───────────────────────────────────────────────────────────

export function generatePairNarrative(pairRow, biasEntry, exec) {
  if (!biasEntry) return '';

  const pair  = pairRow?.pair ?? '';
  const bias  = biasEntry.bias ?? biasEntry;
  const zsc   = biasEntry.zscore ?? {};
  const div   = biasEntry.divergence ?? {};
  const conf  = biasEntry.confluence ?? {};
  const sig   = pairRow?.signal ?? {};
  const latest = pairRow?.latest ?? pairRow?.weeks?.[0] ?? {};

  const direction  = bias.direction ?? 'neutral';
  const score      = bias.score ?? 0;
  const execLabel  = exec?.permission?.label ?? 'RESTRICTED';
  const streak     = sig.strength ?? 0;
  const confScore  = conf.confluenceScore ?? conf.score ?? 0;

  const sentences = [];

  // Opening — bias
  if (direction === 'bullish') {
    if (score >= 3)
      sentences.push(`${pair} exhibits strong bullish institutional conviction, with Leveraged Money maintaining significant net long positioning.`);
    else if (score >= 1.5)
      sentences.push(`${pair} shows moderate bullish institutional bias, supported by net long Leveraged Money positioning.`);
    else
      sentences.push(`${pair} carries a mild bullish lean from institutional accounts, though conviction remains limited.`);
  } else if (direction === 'bearish') {
    if (score <= -3)
      sentences.push(`${pair} reflects strong bearish institutional pressure, with Leveraged Money accumulating net short exposure.`);
    else if (score <= -1.5)
      sentences.push(`${pair} shows moderate bearish institutional bias, with net short positioning from speculative accounts.`);
    else
      sentences.push(`${pair} has a mild bearish lean institutionally, though net short positioning lacks strong conviction.`);
  } else {
    sentences.push(`${pair} remains in a neutral institutional state, with no dominant directional bias from Leveraged Money.`);
  }

  // Streak context
  if (streak >= 3 && direction !== 'neutral') {
    sentences.push(`The ${direction} bias has persisted for ${streak} consecutive CFTC reports, reinforcing the medium-term directional thesis.`);
  }

  // Z-score / extremes
  if (zsc.zscore != null) {
    if (Math.abs(zsc.zscore) >= 2.5)
      sentences.push(`Positioning is at historical extremes (Z-score: ${fmtScore(zsc.zscore)}, ${zsc.percentile}th percentile) — elevated reversal risk.`);
    else if (Math.abs(zsc.zscore) >= 1.5)
      sentences.push(`Z-score reads ${fmtScore(zsc.zscore)} (${zsc.percentile}th percentile), indicating positioning is stretched but not yet extreme.`);
  }

  // Divergence
  if (div.state === 'EXHAUSTION')
    sentences.push(`An exhaustion signal is active — price trend and positioning are aligned at extremes. Watch for reversal catalysts.`);
  else if (div.state === 'BULLISH_DIVERGENCE')
    sentences.push(`A bullish divergence is present: institutions are accumulating while price softens — a potential reversal setup for longs.`);
  else if (div.state === 'BEARISH_DIVERGENCE')
    sentences.push(`A bearish divergence is visible: institutions are reducing exposure into price strength — distribution signal.`);

  // Execution
  if (execLabel === 'FAVORABLE')
    sentences.push(`Intraday execution conditions are currently favorable for directional entries aligned with the institutional bias.`);
  else if (execLabel === 'IMPROVING')
    sentences.push(`Execution conditions are improving — pullback setups may offer better risk/reward than chasing current price action.`);
  else
    sentences.push(`Intraday execution is restricted. Await improvement in macro risk conditions before executing directional trades.`);

  // Carry / confluence
  if (confScore >= 70)
    sentences.push(`Multi-factor confluence score of ${Math.round(confScore)}/100 indicates strong alignment across COT, carry, macro, and central bank policy vectors.`);
  else if (confScore >= 45)
    sentences.push(`Confluence score of ${Math.round(confScore)}/100 shows partial alignment — confirmation from at least one additional factor is advisable.`);

  return sentences.join(' ');
}

// ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────────────

export function generateExecutiveSummary({ biasArr, macroSignal, cotDate, snapshotDate }) {
  if (!biasArr?.length) return 'No institutional data available for analysis.';

  const bullish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish');
  const bearish = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish');
  const neutral = biasArr.filter(b => !['bullish', 'bearish'].includes(b.bias?.direction ?? b.direction));

  const topBullish = [...bullish].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topBearish = [...bearish].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const tone = bullish.length > bearish.length + 1 ? 'broadly bullish'
    : bearish.length > bullish.length + 1          ? 'broadly bearish'
    : 'mixed';

  const sentences = [];

  // Opening
  sentences.push(
    `As of the ${cotDate ?? snapshotDate ?? 'latest'} CFTC report, institutional positioning across monitored FX pairs is ${tone}, ` +
    `with ${bullish.length} pair${bullish.length !== 1 ? 's' : ''} showing bullish bias, ` +
    `${bearish.length} bearish, and ${neutral.length} neutral.`
  );

  // Macro
  sentences.push(macroSentence(macroSignal));

  // Top signals
  if (topBullish.length >= 2) {
    sentences.push(
      `${topBullish.slice(0, 2).map(b => b.pair).join(' and ')} present the strongest bullish institutional setups, ` +
      `with Leveraged Money maintaining elevated net long exposure across consecutive reports.`
    );
  } else if (topBullish.length === 1) {
    sentences.push(
      `${topBullish[0].pair} stands out as the primary bullish institutional setup this week.`
    );
  }

  if (topBearish.length >= 2) {
    sentences.push(
      `${topBearish.slice(0, 2).map(b => b.pair).join(' and ')} reflect the most significant bearish institutional pressure, ` +
      `with continued reduction in Leveraged Money net long exposure.`
    );
  }

  // Divergence
  const divSentence = divergenceSentence(biasArr);
  if (divSentence) sentences.push(divSentence);

  // Closing risk note
  const extremes = biasArr.filter(b => b.zscore && Math.abs(b.zscore.zscore ?? 0) >= 2);
  if (extremes.length >= 2) {
    sentences.push(
      `Elevated z-scores in ${extremes.map(b => b.pair).join(', ')} warrant risk management discipline — ` +
      `extended positioning historically precedes sharp mean-reversion moves.`
    );
  }

  return sentences.join(' ');
}

// ── MARKET REGIME LABEL ───────────────────────────────────────────────────────

export function generateMarketRegimeLabel(biasArr, macroSignal) {
  const bull = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bullish').length;
  const bear = biasArr.filter(b => (b.bias?.direction ?? b.direction) === 'bearish').length;
  const dist = biasArr.filter(b => b.state === 'distribution').length;
  const exp  = biasArr.filter(b => b.state === 'expansion').length;

  if (dist >= 2)           return 'Distribution Phase';
  if (exp  >= 3)           return 'Trend Expansion';
  if (bull > bear * 1.5)   return 'Risk-On Bias';
  if (bear > bull * 1.5)   return 'Risk-Off Bias';
  return 'Transition / Mixed';
}
