/**
 * contentExtractionLayer.js — Market Intelligence Content Extraction v1.0
 *
 * PURPOSE: Transforms the Market Intelligence Object into structured
 * content-ready outputs for internal reuse. This module is INTENTIONALLY
 * SEPARATE from the user-facing product.
 *
 * IMPORTANT DESIGN RULES:
 *   - This module is NOT imported by any UI component.
 *   - It is NOT called from ExportPanel, App.jsx, or any user-visible path.
 *   - It is called ONLY from standalone extraction scripts or internal tooling.
 *   - All output is pure data — no rendering, no UI, no side effects.
 *   - If called from a CLI/script context, import directly.
 *   - If called from an API route, wrap in /api/internal/content-extract.js (auth-gated).
 *
 * OUTPUT FORMATS:
 *   - headlines[]     — punchy, fact-based, no hype
 *   - bullets[]       — 3-5 institutional insights per asset
 *   - hooks[]         — opening lines suitable for social/newsletters
 *   - summary         — 2-3 sentence condensed view
 *   - narrative        — full institutional prose block
 *   - key_figures[]   — data points that anchor the story
 *   - market_phrases[] — reusable analytical phrases
 *
 * INPUT: buildMarketIntelligenceSnapshot() → standardized snapshot object
 * No dependency on React, no side effects, no DOM.
 */

// ── UTILS ─────────────────────────────────────────────────────────────────────

function fmtK(n) {
  if (n == null || isNaN(n)) return null;
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (a >= 1_000)     return (n > 0 ? '+' : '') + (n / 1_000).toFixed(1) + 'K';
  return (n > 0 ? '+' : '') + String(n);
}

function dirStr(direction) {
  if (direction === 'bullish') return 'long';
  if (direction === 'bearish') return 'short';
  return 'neutral';
}

function titleCase(s) {
  return (s ?? '').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── HEADLINE GENERATORS ───────────────────────────────────────────────────────

function generateHeadlines(asset) {
  const { symbol, cat, bias, raw, positioning, cot_signal, flow } = asset;
  const dir    = bias?.direction ?? 'neutral';
  const score  = bias?.normalized ?? 50;
  const net    = raw?.smart_net;
  const pctL   = raw?.smart_pct_l;
  const zscore = positioning?.zscore;
  const streak = cot_signal?.strength ?? 0;
  const chg    = flow?.weekly_net_change;
  const headlines = [];

  // Headline 1: Primary institutional thesis
  if (dir === 'bullish' && streak >= 3) {
    headlines.push(`Institutional longs in ${symbol} hit ${streak}-week streak — Leveraged Money net long ${fmtK(net)}`);
  } else if (dir === 'bearish' && streak >= 3) {
    headlines.push(`${symbol} under institutional selling pressure for ${streak} straight CFTC reports — net short ${fmtK(net)}`);
  } else if (dir === 'bullish') {
    headlines.push(`${symbol}: Leveraged Money net long ${fmtK(net)} — bullish institutional bias intact`);
  } else if (dir === 'bearish') {
    headlines.push(`${symbol}: Leveraged Money net short ${fmtK(net)} — bearish institutional conviction`);
  } else {
    headlines.push(`${symbol}: No directional institutional bias — positioning neutral at ${pctL != null ? pctL.toFixed(1) + '% long' : 'undetermined'}`);
  }

  // Headline 2: Positioning extreme (if applicable)
  if (zscore != null && Math.abs(zscore) >= 2.0) {
    const extreme = zscore > 0 ? 'extreme long' : 'extreme short';
    headlines.push(`${symbol} at ${extreme} positioning extreme — z-score ${zscore > 0 ? '+' : ''}${zscore.toFixed(2)} flags elevated reversal risk`);
  }

  // Headline 3: Weekly flow signal
  if (chg != null && Math.abs(chg) > 2000) {
    const flowWord = chg > 0 ? 'accumulation' : 'distribution';
    headlines.push(`${symbol} weekly flow: ${fmtK(chg)} net contracts — institutional ${flowWord} this week`);
  }

  // Headline 4: Asset-class specific
  if (cat === 'index') {
    headlines.push(dir === 'bullish'
      ? `Risk-on signal: ${symbol} equity futures net long — Leveraged Money adding risk exposure`
      : dir === 'bearish'
      ? `Risk-off warning: ${symbol} equity futures net short — institutional de-risking underway`
      : `${symbol} equity futures neutral — no dominant risk-on or risk-off signal from CFTC data`);
  } else if (cat === 'bonds') {
    headlines.push(dir === 'bullish'
      ? `${symbol}: Institutions pricing rate declines — fixed income net long signals duration accumulation`
      : dir === 'bearish'
      ? `${symbol}: Bond selling pressure — Leveraged Money net short implies rising yield expectations`
      : `${symbol}: Fixed income positioning neutral — no dominant rate expectation signal`);
  } else if (cat === 'commodities' && (symbol === 'GOLD' || symbol === 'SILVER')) {
    headlines.push(dir === 'bullish'
      ? `${symbol} COT: Haven demand active — Leveraged Money net long ${fmtK(net)}`
      : dir === 'bearish'
      ? `${symbol} COT: Precious metal selling — risk appetite or disinflation reading from institutions`
      : `${symbol}: No dominant haven or inflation-hedge signal from CFTC positioning`);
  } else if (cat === 'commodities' && symbol === 'WTI') {
    headlines.push(dir === 'bullish'
      ? `WTI COT: Energy demand bid — Leveraged Money building crude longs`
      : dir === 'bearish'
      ? `WTI COT: Energy selling — institutions position for demand slowdown or supply surplus`
      : `WTI: Neutral crude positioning — no dominant growth or inflation signal`);
  }

  return headlines.filter(Boolean).slice(0, 3);
}

// ── BULLET GENERATORS ─────────────────────────────────────────────────────────

function generateBullets(asset) {
  const { symbol, cat, bias, raw, positioning, cot_signal, flow, rates_carry, regime, cross_asset, asset_context } = asset;
  const dir    = bias?.direction ?? 'neutral';
  const net    = raw?.smart_net;
  const pctL   = raw?.smart_pct_l;
  const assetNet  = raw?.asset_net;
  const dealerNet = raw?.dealer_net;
  const chg    = flow?.weekly_net_change;
  const zscore = positioning?.zscore;
  const pct    = positioning?.percentile;
  const divState = positioning?.divergence?.state;
  const streak = cot_signal?.strength ?? 0;
  const bullets = [];

  // Bullet 1: Net positioning fact
  if (net != null && pctL != null) {
    bullets.push(`${symbol} Leveraged Money: net ${dir}s at ${fmtK(net)} contracts (${pctL.toFixed(1)}% long)`);
  }

  // Bullet 2: Asset Manager confirmation or divergence
  if (assetNet != null) {
    const amDir = assetNet > 0 ? 'long' : 'short';
    const alignment = (dir === 'bullish' && assetNet > 0) || (dir === 'bearish' && assetNet < 0) ? 'confirms' : 'diverges from';
    bullets.push(`Asset Managers net ${amDir} ${fmtK(assetNet)} — ${alignment} Leveraged Money directional bias`);
  }

  // Bullet 3: Weekly flow
  if (chg != null) {
    const flowStr = chg > 0 ? `adding ${fmtK(chg)} longs` : `removing ${fmtK(Math.abs(chg))} longs`;
    bullets.push(`Weekly institutional flow: ${flowStr} — ${chg > 0 ? 'accumulation' : 'distribution'} pattern`);
  }

  // Bullet 4: Positioning extreme
  if (zscore != null && pct != null) {
    bullets.push(`Positioning extremity: z-score ${zscore > 0 ? '+' : ''}${zscore.toFixed(2)}, ${pct}th percentile — ` +
      (Math.abs(zscore) >= 2.5 ? 'EXTREME — mean reversion risk elevated'
      : Math.abs(zscore) >= 1.5 ? 'stretched — not yet actionable as contrarian signal'
      : 'within normal historical range'));
  }

  // Bullet 5: Divergence signal
  if (divState && divState !== 'NEUTRAL') {
    const divDesc = {
      EXHAUSTION:         'Exhaustion: price and positioning co-moving at extremes — reversal risk',
      BULLISH_DIVERGENCE: 'Bullish divergence: institutions accumulating vs declining price',
      BEARISH_DIVERGENCE: 'Bearish divergence: institutions distributing vs rising price',
    };
    if (divDesc[divState]) bullets.push(divDesc[divState]);
  }

  // Bullet 6: Streak
  if (streak >= 2) {
    bullets.push(`${streak}-report ${dir} positioning streak — medium-term directional bias ${streak >= 3 ? 'confirmed' : 'building'}`);
  }

  // Bullet 7: Carry (FX only)
  if (cat === 'fx' && rates_carry) {
    const { diff_bps, carry_direction, base_rate, quote_rate } = rates_carry;
    if (diff_bps != null) {
      bullets.push(`Carry differential: ${diff_bps > 0 ? '+' : ''}${diff_bps} bps — carry ${carry_direction?.replace(/_/g, ' ') ?? 'neutral'} (base ${base_rate?.toFixed(2) ?? '—'}% vs quote ${quote_rate?.toFixed(2) ?? '—'}%)`);
    }
  }

  // Bullet 8: Regime alignment
  if (regime?.regime && regime.regime !== 'TRANSITIONAL') {
    const regimeAligned = (
      (dir === 'bullish' && ['RISK_ON'].includes(regime.regime) && cat === 'index') ||
      (dir === 'bearish' && ['RISK_OFF'].includes(regime.regime) && cat === 'index') ||
      (dir === 'bullish' && ['DISINFLATION'].includes(regime.regime) && cat === 'bonds') ||
      (dir === 'bullish' && ['STAGFLATION', 'RISK_OFF'].includes(regime.regime) && (symbol === 'GOLD' || symbol === 'SILVER'))
    );
    if (regimeAligned) {
      bullets.push(`Macro regime (${regime.label}) ALIGNED with ${dir} ${symbol} COT signal — elevated conviction`);
    }
  }

  return bullets.filter(Boolean).slice(0, 6);
}

// ── HOOK GENERATORS ───────────────────────────────────────────────────────────

function generateHooks(asset) {
  const { symbol, cat, bias, raw, positioning } = asset;
  const dir    = bias?.direction ?? 'neutral';
  const net    = raw?.smart_net;
  const zscore = positioning?.zscore;
  const hooks  = [];

  if (dir === 'neutral') {
    hooks.push(`The institutional community is sending no clear message on ${symbol} this week — watch for the next CFTC release.`);
    return hooks;
  }

  // Hook 1: Question format
  const qMap = {
    bullish: `Why are institutions piling into ${symbol} while retail investors stay cautious?`,
    bearish: `What do the largest futures traders know about ${symbol} that most traders don't?`,
  };
  if (qMap[dir]) hooks.push(qMap[dir]);

  // Hook 2: Data-anchored opening
  if (net != null) {
    hooks.push(`${fmtK(net)} contracts. That's the net ${dirStr(dir)} position Leveraged Money holds in ${symbol} right now.`);
  }

  // Hook 3: Extreme positioning
  if (zscore != null && Math.abs(zscore) >= 2.0) {
    hooks.push(`${symbol} positioning is sitting at a statistical extreme — z-score ${Math.abs(zscore).toFixed(1)}. History says this level doesn't hold forever.`);
  }

  // Hook 4: Asset-class specific angle
  if (cat === 'index') {
    hooks.push(dir === 'bullish'
      ? `Smart money isn't buying the recession narrative — equity futures longs in ${symbol} tell a different story.`
      : `Institutional traders are quietly reducing equity exposure in ${symbol}. Is the market about to catch up?`);
  }
  if (cat === 'bonds') {
    hooks.push(dir === 'bullish'
      ? `Bond futures positioning in ${symbol} suggests institutions are betting on rate relief — before the central bank announces it.`
      : `Rising yield expectations are showing up in ${symbol} futures positioning — Leveraged Money is net short duration.`);
  }
  if (cat === 'commodities' && (symbol === 'GOLD' || symbol === 'SILVER')) {
    hooks.push(dir === 'bullish'
      ? `Institutional accounts aren't done buying gold. CFTC data shows Leveraged Money still building longs.`
      : `Gold's haven narrative is losing institutional support — Leveraged Money is reducing precious metal exposure.`);
  }
  if (cat === 'commodities' && symbol === 'WTI') {
    hooks.push(dir === 'bullish'
      ? `Energy demand is reading constructive in the futures market — institutions are adding crude longs.`
      : `Oil futures are seeing institutional selling pressure — is a demand slowdown already priced in?`);
  }

  return hooks.filter(Boolean).slice(0, 3);
}

// ── KEY FIGURES ───────────────────────────────────────────────────────────────

function extractKeyFigures(asset) {
  const { symbol, raw, positioning, cot_signal, rates_carry, cftc_date } = asset;
  const figures = [];

  if (raw?.smart_net != null) {
    figures.push({ label: 'Leveraged Money Net',   value: fmtK(raw.smart_net),           unit: 'contracts', symbol });
  }
  if (raw?.smart_pct_l != null) {
    figures.push({ label: '% Long',                 value: raw.smart_pct_l.toFixed(1),    unit: '%',         symbol });
  }
  if (raw?.lev_chg_net != null) {
    figures.push({ label: 'Weekly Flow',             value: fmtK(raw.lev_chg_net),        unit: 'contracts', symbol });
  }
  if (positioning?.zscore != null) {
    figures.push({ label: 'Z-Score',                 value: positioning.zscore.toFixed(2), unit: 'σ',        symbol });
  }
  if (positioning?.percentile != null) {
    figures.push({ label: 'Position Percentile',    value: positioning.percentile,         unit: 'pct',      symbol });
  }
  if (rates_carry?.diff_bps != null) {
    figures.push({ label: 'Carry Differential',      value: rates_carry.diff_bps,          unit: 'bps',      symbol });
  }
  if (raw?.open_interest != null) {
    figures.push({ label: 'Open Interest',           value: fmtK(raw.open_interest),       unit: 'contracts', symbol });
  }
  if (cftc_date) {
    figures.push({ label: 'CFTC Report Date',        value: cftc_date,                      unit: 'date',     symbol });
  }

  return figures;
}

// ── MARKET PHRASES ────────────────────────────────────────────────────────────

function extractMarketPhrases(asset, riskRegime) {
  const { symbol, cat, bias, positioning } = asset;
  const dir    = bias?.direction ?? 'neutral';
  const zscore = positioning?.zscore;
  const divSt  = positioning?.divergence?.state;
  const phrases = [];

  // Analytical phrases — reusable in content, not hyped
  if (dir !== 'neutral') phrases.push(`institutional ${dir} bias in ${symbol}`);
  if (Math.abs(zscore ?? 0) >= 2.0) phrases.push(`extended ${dir} positioning in ${symbol}`);
  if (divSt === 'BULLISH_DIVERGENCE') phrases.push(`smart money accumulation against price weakness in ${symbol}`);
  if (divSt === 'BEARISH_DIVERGENCE') phrases.push(`institutional distribution into ${symbol} price strength`);
  if (divSt === 'EXHAUSTION') phrases.push(`positioning exhaustion signal in ${symbol}`);

  if (cat === 'index' && dir === 'bullish') phrases.push('risk appetite expansion in equity futures');
  if (cat === 'index' && dir === 'bearish') phrases.push('institutional equity de-risking');
  if (cat === 'bonds' && dir === 'bullish') phrases.push('fixed income duration accumulation');
  if (cat === 'bonds' && dir === 'bearish') phrases.push('yield-rise positioning in bond futures');
  if ((symbol === 'GOLD' || symbol === 'SILVER') && dir === 'bullish') phrases.push('precious metals haven demand');
  if (symbol === 'WTI' && dir === 'bullish') phrases.push('energy demand-side confidence');

  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    phrases.push(`${riskRegime.label.toLowerCase()} macro environment`);
  }

  return [...new Set(phrases)]; // deduplicate
}

// ── SNAPSHOT SUMMARY ──────────────────────────────────────────────────────────

function generateSnapshotSummary(assets, riskRegime) {
  const bull = assets.filter(a => a.bias?.direction === 'bullish').length;
  const bear = assets.filter(a => a.bias?.direction === 'bearish').length;
  const neut = assets.length - bull - bear;
  const tone = bull > bear * 1.5 ? 'broadly bullish' : bear > bull * 1.5 ? 'broadly bearish' : 'mixed';
  const regime = riskRegime?.label ?? 'Transitional';

  const topBull = [...assets].filter(a => a.bias?.direction === 'bullish')
    .sort((a, b) => (b.bias?.normalized ?? 50) - (a.bias?.normalized ?? 50))
    .slice(0, 2).map(a => a.symbol);

  const topBear = [...assets].filter(a => a.bias?.direction === 'bearish')
    .sort((a, b) => (a.bias?.normalized ?? 50) - (b.bias?.normalized ?? 50))
    .slice(0, 2).map(a => a.symbol);

  let summary = `Institutional COT positioning across ${assets.length} assets is ${tone} — ` +
    `${bull} bullish, ${bear} bearish, ${neut} neutral. ` +
    `Macro regime: ${regime}.`;

  if (topBull.length) summary += ` Strongest bullish conviction: ${topBull.join(', ')}.`;
  if (topBear.length) summary += ` Strongest bearish pressure: ${topBear.join(', ')}.`;

  return summary;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Extracts content-ready output for a single asset.
 *
 * @param {Object} asset       — Market intelligence object (from buildMarketIntelligenceObject)
 * @param {Object} [riskRegime] — from computeRiskRegime()
 * @returns {AssetContentPackage}
 */
export function extractAssetContent(asset, riskRegime = null) {
  if (!asset) return null;

  return {
    symbol:         asset.symbol,
    cat:            asset.cat,
    direction:      asset.bias?.direction ?? 'neutral',
    bias_score:     asset.bias?.normalized ?? null,
    cftc_date:      asset.cftc_date,
    headlines:      generateHeadlines(asset),
    bullets:        generateBullets(asset),
    hooks:          generateHooks(asset),
    summary:        generateBullets(asset).slice(0, 3).join(' '),
    key_figures:    extractKeyFigures(asset),
    market_phrases: extractMarketPhrases(asset, riskRegime),
  };
}

/**
 * Extracts content-ready output for a full snapshot of assets.
 *
 * @param {Object[]} assets    — Array of market intelligence objects
 * @param {Object} [riskRegime]
 * @param {Object} [opts]
 * @returns {SnapshotContentPackage}
 */
export function extractSnapshotContent(assets, riskRegime = null, opts = {}) {
  if (!assets?.length) return null;

  const { cotDate, snapshotDate } = opts;

  // Per-asset content
  const assetContent = assets.map(a => extractAssetContent(a, riskRegime)).filter(Boolean);

  // Grouped by cat
  const byCategory = {};
  for (const ac of assetContent) {
    if (!byCategory[ac.cat]) byCategory[ac.cat] = [];
    byCategory[ac.cat].push(ac);
  }

  // Top-level hooks and headlines across all assets
  const allHeadlines = assetContent.flatMap(a => a.headlines);
  const topHeadlines = allHeadlines.slice(0, 5); // most relevant first

  const allPhrases   = [...new Set(assetContent.flatMap(a => a.market_phrases))];

  // Regime-level content
  const regimeContent = riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL'
    ? {
        regime:      riskRegime.regime,
        label:       riskRegime.label,
        confidence:  riskRegime.confidence,
        headline:    `${riskRegime.label} regime detected — ${riskRegime.confidence}% confidence from multi-asset COT positioning`,
        description: riskRegime.description,
        drivers:     riskRegime.keyDrivers ?? [],
      }
    : null;

  const snapshotSummary = generateSnapshotSummary(assets, riskRegime);

  return {
    snapshot_date:  snapshotDate ?? new Date().toISOString().slice(0, 10),
    cftc_date:      cotDate ?? null,
    asset_count:    assets.length,
    snapshot_summary: snapshotSummary,
    regime_content:  regimeContent,
    top_headlines:   topHeadlines,
    market_phrases:  allPhrases.slice(0, 15),
    by_category:     byCategory,
    assets:          assetContent,
  };
}
