/**
 * temporalHorizonEngine.js — Institutional Temporal Horizon Classifier v1.0
 *
 * Separates each asset's thesis into three distinct time horizons:
 *
 *   TACTICAL   (1–5 days)  — execution-driven; COT is context only
 *   SWING      (1–4 weeks) — COT primary signal; bias + persistence
 *   MACRO      (1–3 months)— regime + policy cycle + structural positioning
 *
 * Design:
 *   - Pure functions. No side effects. No state. No React.
 *   - COT data is weekly — never used as a tactical entry signal.
 *   - Macro thesis requires ≥3 consecutive CFTC confirmations.
 *   - Returns view labels compatible with export, HTML, and XLSX layers.
 *
 * Input:  biasEntry, pairRow, opts
 * Output: TemporalHorizon { tactical, swing, macro }
 */

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

export const HORIZON_VIEWS = {
  STRONG_BULLISH: 'STRONG_BULLISH',
  BULLISH:        'BULLISH',
  LEAN_BULLISH:   'LEAN_BULLISH',
  NEUTRAL:        'NEUTRAL',
  LEAN_BEARISH:   'LEAN_BEARISH',
  BEARISH:        'BEARISH',
  STRONG_BEARISH: 'STRONG_BEARISH',
  AVOID:          'AVOID',
  TRANSITIONAL:   'TRANSITIONAL',
  EARLY_SIGNAL:   'EARLY_SIGNAL',
  STRUCTURAL:     'STRUCTURAL',
};

export const HORIZON_COLORS = {
  STRONG_BULLISH: '#16a34a',
  BULLISH:        '#22c55e',
  LEAN_BULLISH:   '#86efac',
  NEUTRAL:        '#6b7280',
  LEAN_BEARISH:   '#fca5a5',
  BEARISH:        '#ef4444',
  STRONG_BEARISH: '#b91c1c',
  AVOID:          '#f97316',
  TRANSITIONAL:   '#f59e0b',
  EARLY_SIGNAL:   '#a78bfa',
  STRUCTURAL:     '#2563eb',
};

// Short labels for compact rendering (XLSX columns, HTML badges)
export const HORIZON_SHORT = {
  STRONG_BULLISH: '↑↑ Strong',
  BULLISH:        '↑ Bull',
  LEAN_BULLISH:   '↗ Lean Bull',
  NEUTRAL:        '→ Neutral',
  LEAN_BEARISH:   '↘ Lean Bear',
  BEARISH:        '↓ Bear',
  STRONG_BEARISH: '↓↓ Strong',
  AVOID:          '✕ Avoid',
  TRANSITIONAL:   '~ Transit',
  EARLY_SIGNAL:   '◌ Early',
  STRUCTURAL:     '⬛ Structural',
};

// ── TACTICAL HORIZON (1-5 days) ───────────────────────────────────────────────

function buildTacticalView(biasEntry, exec, direction) {
  const execScore = exec?.score ?? 0;
  const execLabel = exec?.permission?.label ?? 'RESTRICTED';
  const divState  = biasEntry?.divergence?.state ?? 'NONE';
  const basis     = [];

  // Exhaustion overrides everything — tactical AVOID regardless of execution
  if (divState === 'EXHAUSTION') {
    basis.push('Exhaustion signal active — positioning at extreme, reversal risk elevated');
    basis.push('No tactical entry recommended until positioning resets (Z below ±1.5)');
    return {
      view:           'AVOID',
      short_label:    HORIZON_SHORT.AVOID,
      strength:       0,
      basis,
      cot_applicable: false,
      note:           'COT is a weekly structural signal. Do not use for tactical entries.',
    };
  }

  let view = 'NEUTRAL';

  if (execLabel === 'FAVORABLE' || execScore >= 70) {
    if (direction === 'bullish') view = 'LEAN_BULLISH';
    else if (direction === 'bearish') view = 'LEAN_BEARISH';
    basis.push(`Execution conditions favorable (score: ${execScore}) — directional bias can be considered for tactical entries`);
  } else if (execScore < 45 || execLabel === 'RESTRICTED') {
    view = 'AVOID';
    basis.push(`Execution conditions restricted (score: ${execScore}) — wait for volatility/macro window`);
  } else {
    basis.push(`Execution conditions neutral (score: ${execScore}) — no strong tactical edge`);
  }

  // Z-score extreme aligned with bias = crowding warning even tactically
  const z = biasEntry?.zscore?.zscore ?? null;
  if (z != null && Math.abs(z) >= 2.5) {
    const zAligned = (z > 0 && direction === 'bullish') || (z < 0 && direction === 'bearish');
    if (zAligned) {
      basis.push(`Positioning extreme (Z: ${z?.toFixed(2)}) — entry at current levels carries crowding risk`);
      if (view !== 'AVOID') view = 'NEUTRAL'; // downgrade from lean
    }
  }

  return {
    view,
    short_label:    HORIZON_SHORT[view] ?? view,
    strength:       Math.round(execScore),
    basis,
    cot_applicable: false,
    note:           'COT data is weekly — used as directional context only at tactical horizon.',
  };
}

// ── SWING HORIZON (1-4 weeks) ─────────────────────────────────────────────────

function buildSwingView(biasEntry, pairRow) {
  const direction = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';
  const biasScore = biasEntry?.bias?.score ?? biasEntry?.score ?? 0;
  const streak    = pairRow?.signal?.strength ?? 0;
  const divState  = biasEntry?.divergence?.state ?? 'NONE';
  const absScore  = Math.abs(biasScore);
  const basis     = [];

  if (direction === 'neutral') {
    return {
      view:           'NEUTRAL',
      short_label:    HORIZON_SHORT.NEUTRAL,
      strength:       0,
      basis:          ['Institutional positioning neutral — no dominant swing directional thesis'],
      cot_applicable: true,
    };
  }

  // Primary: bias score magnitude → view strength
  let view;
  if (absScore >= 3.5)      view = direction === 'bullish' ? 'STRONG_BULLISH' : 'STRONG_BEARISH';
  else if (absScore >= 2.5) view = direction === 'bullish' ? 'BULLISH'        : 'BEARISH';
  else if (absScore >= 1.5) view = direction === 'bullish' ? 'LEAN_BULLISH'   : 'LEAN_BEARISH';
  else                      view = 'NEUTRAL';  // score too low for swing conviction

  basis.push(
    `COT bias score ${biasScore > 0 ? '+' : ''}${biasScore?.toFixed(1)} — Leveraged Money net ${direction}`,
  );

  // Streak modifier
  if (streak >= 4) {
    basis.push(`${streak}-report consecutive streak — high institutional persistence, thesis structurally anchored`);
    // Upgrade view one level if not already at max
    if (view === 'LEAN_BULLISH') view = 'BULLISH';
    else if (view === 'LEAN_BEARISH') view = 'BEARISH';
  } else if (streak >= 2) {
    basis.push(`${streak}-report streak — directional persistence confirmed`);
  } else if (streak === 1) {
    basis.push('Single-report signal — insufficient streak for high-conviction swing entry');
  }

  // Divergence modifier
  const bullDiv = divState === 'BULLISH_DIVERGENCE';
  const bearDiv = divState === 'BEARISH_DIVERGENCE';
  const divAligned = (bullDiv && direction === 'bullish') || (bearDiv && direction === 'bearish');
  const divConflict = (bullDiv && direction === 'bearish') || (bearDiv && direction === 'bullish');

  if (divState === 'EXHAUSTION') {
    basis.push('Exhaustion signal — positioning at unsustainable extreme, swing reversal risk elevated');
    view = 'AVOID';
  } else if (divAligned) {
    basis.push(`${bullDiv ? 'Bullish' : 'Bearish'} divergence confirms swing direction — smart-money accumulation into price weakness`);
  } else if (divConflict) {
    basis.push(`Divergence conflicts with swing direction — institutional distribution signal warrants caution`);
    if (view === 'STRONG_BULLISH' || view === 'STRONG_BEARISH') {
      view = view.replace('STRONG_', '');
    }
  }

  // Weekly flow
  const latest = pairRow?.latest ?? pairRow?.weeks?.[0] ?? {};
  const prev   = pairRow?.weeks?.[1] ?? {};
  const chgNet = latest.levChgNet ?? (latest.smartNet != null && prev.smartNet != null
    ? latest.smartNet - prev.smartNet : null);
  if (chgNet != null) {
    const flowK = Math.round(Math.abs(chgNet) / 1000);
    const flowDir = chgNet > 0 ? 'accumulation' : 'distribution';
    const flowAligned = (chgNet > 0 && direction === 'bullish') || (chgNet < 0 && direction === 'bearish');
    basis.push(
      `Weekly flow: ${flowDir} of ${flowK}K contracts — ${flowAligned ? 'confirms' : 'diverges from'} swing thesis`,
    );
  }

  return {
    view,
    short_label:    HORIZON_SHORT[view] ?? view,
    strength:       Math.min(100, Math.round((absScore / 5) * 100)),
    basis,
    cot_applicable: true,
  };
}

// ── MACRO HORIZON (1-3 months) ────────────────────────────────────────────────

function buildMacroView(biasEntry, pairRow, opts) {
  const { riskRegime, cycleProfiles, convictionProfile, cat } = opts;
  const direction  = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';
  const streak     = pairRow?.signal?.strength ?? 0;
  const basis      = [];

  if (direction === 'neutral') {
    return {
      view:           'NEUTRAL',
      short_label:    HORIZON_SHORT.NEUTRAL,
      strength:       0,
      basis:          ['No institutional directional bias — macro thesis undefined'],
      cot_applicable: true,
      note:           'Macro thesis requires ≥3 consecutive CFTC confirmations.',
    };
  }

  // Macro thesis requires at least 2 reports; 3+ for full confirmation
  if (streak < 2) {
    return {
      view:           'EARLY_SIGNAL',
      short_label:    HORIZON_SHORT.EARLY_SIGNAL,
      strength:       Math.round(Math.abs(biasEntry?.bias?.score ?? 0) / 5 * 30),
      basis:          [
        `Only ${streak} CFTC report(s) confirm this direction — insufficient for macro thesis`,
        'Macro positioning requires minimum 2-3 consecutive weekly confirmations',
      ],
      cot_applicable: true,
      note:           'Macro thesis requires ≥3 consecutive CFTC confirmations.',
    };
  }

  // Factor gates for macro view
  const macroFactor  = convictionProfile?.factors?.macro_regime;
  const carryFactor  = convictionProfile?.factors?.carry_policy;
  const macroScore   = macroFactor?.raw ?? 0.40;
  const carryScore   = carryFactor?.raw ?? 0.40;

  const macroAligned = macroScore >= 0.60;
  const carryAligned = carryScore >= 0.60;
  const macroConflict = macroScore < 0.30;

  let view;
  let macroStrength = Math.round((macroScore + carryScore) / 2 * 100);

  if (macroAligned && carryAligned && streak >= 3) {
    view = direction === 'bullish' ? 'BULLISH' : 'BEARISH';
    if (streak >= 5) view = direction === 'bullish' ? 'STRONG_BULLISH' : 'STRONG_BEARISH';
    basis.push('Macro regime and policy cycle both aligned — structural thesis well-supported');
  } else if (macroAligned || carryAligned) {
    view = direction === 'bullish' ? 'LEAN_BULLISH' : 'LEAN_BEARISH';
    basis.push(
      macroAligned
        ? 'Macro regime confirms direction; policy cycle neutral or mixed'
        : 'Policy cycle supports direction; macro regime mixed',
    );
  } else if (macroConflict) {
    view = 'TRANSITIONAL';
    basis.push('Macro regime creates structural headwinds — COT signal not macro-confirmed');
    macroStrength = 20;
  } else {
    view = 'TRANSITIONAL';
    basis.push('Macro environment transitional — regime confirmation pending');
  }

  // Add regime detail
  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    basis.push(
      `${riskRegime.label ?? riskRegime.regime} macro regime (${riskRegime.confidence ?? '?'}% confidence)`,
    );
  }

  // Add policy cycle for FX / bonds
  if (cat === 'fx' || cat === 'bonds') {
    const fedCycle = cycleProfiles?.['FED'];
    if (fedCycle) {
      basis.push(
        `FED cycle: ${fedCycle.cycleLabel} — ${fedCycle.maturityLabel} ` +
        `(cumulative ${fedCycle.cumBps > 0 ? '+' : ''}${fedCycle.cumBps} bps)`,
      );
    }
  }

  // Streak context
  if (streak >= 4) {
    basis.push(`${streak}-report directional streak — institutional macro commitment sustained`);
  }

  // Check for structural signal: very long streak + regime alignment
  if (streak >= 6 && macroAligned) {
    view = direction === 'bullish' ? 'STRUCTURAL' : 'STRUCTURAL';
    basis.push('Extended streak with macro alignment — institutional structural positioning thesis active');
  }

  return {
    view,
    short_label:    HORIZON_SHORT[view] ?? view,
    strength:       Math.min(100, Math.max(0, macroStrength)),
    basis,
    cot_applicable: true,
    note:           streak < 3 ? 'Macro thesis requires ≥3 consecutive CFTC confirmations.' : null,
  };
}

// ── PUBLIC: TEMPORAL HORIZON ──────────────────────────────────────────────────

/**
 * Builds a full temporal horizon profile for a single asset.
 *
 * @param {Object} biasEntry        — from buildBiasArray / cotBiasEngine
 * @param {Object} pairRow          — from parseTiffCombined
 * @param {Object} opts             — {
 *   exec,              — from intradayExecutionEngine
 *   riskRegime,        — from riskRegimeEngine
 *   cycleProfiles,     — from buildCbCycleProfiles
 *   convictionProfile, — from buildConvictionProfile (pre-computed)
 * }
 *
 * @returns {TemporalHorizon}
 */
export function buildTemporalHorizon(biasEntry, pairRow, opts = {}) {
  const { exec, riskRegime, cycleProfiles, convictionProfile } = opts;
  const cat       = (pairRow?.cat ?? biasEntry?.cat ?? 'fx').toLowerCase();
  const direction = biasEntry?.bias?.direction ?? biasEntry?.direction ?? 'neutral';

  const tactical = buildTacticalView(biasEntry, exec, direction);
  const swing    = buildSwingView(biasEntry, pairRow);
  const macro    = buildMacroView(biasEntry, pairRow, {
    riskRegime, cycleProfiles, convictionProfile, cat,
  });

  // Horizon summary: dominant view across all three
  const horizonViews = [tactical.view, swing.view, macro.view];
  const bullViews = horizonViews.filter(v => v.includes('BULL') || v === 'STRUCTURAL').length;
  const bearViews = horizonViews.filter(v => v.includes('BEAR')).length;
  const avoidViews = horizonViews.filter(v => v === 'AVOID').length;

  let dominant_view;
  if (avoidViews >= 2)  dominant_view = 'AVOID';
  else if (bullViews === 3) dominant_view = 'BULLISH_ACROSS_ALL';
  else if (bearViews === 3) dominant_view = 'BEARISH_ACROSS_ALL';
  else if (bullViews >= 2)  dominant_view = 'PREDOMINANTLY_BULLISH';
  else if (bearViews >= 2)  dominant_view = 'PREDOMINANTLY_BEARISH';
  else                      dominant_view = 'MIXED';

  return {
    tactical,
    swing,
    macro,
    dominant_view,
    summary: buildHorizonSummary(dominant_view, direction, swing, macro),
  };
}

// ── HORIZON SUMMARY ───────────────────────────────────────────────────────────

function buildHorizonSummary(dominant, direction, swing, macro) {
  if (dominant === 'AVOID') {
    return 'Multiple time horizon signals advise against directional exposure at current levels.';
  }
  if (dominant === 'BULLISH_ACROSS_ALL') {
    return `Bullish bias confirmed at tactical, swing, and macro horizons — highest-quality setup configuration.`;
  }
  if (dominant === 'BEARISH_ACROSS_ALL') {
    return `Bearish bias confirmed at tactical, swing, and macro horizons — highest-quality short configuration.`;
  }
  if (dominant === 'PREDOMINANTLY_BULLISH') {
    return `Bullish at ${swing.view.includes('BULL') ? 'swing' : 'macro'} and ${macro.view.includes('BULL') ? 'macro' : 'tactical'} — tactical timing may vary.`;
  }
  if (dominant === 'PREDOMINANTLY_BEARISH') {
    return `Bearish at multiple horizons — ${macro.view.includes('BEAR') ? 'macro' : 'swing'} thesis reinforced. Execution conditions may restrict tactical entry.`;
  }
  return `Mixed horizon signals for ${direction} thesis — swing and macro not fully aligned.`;
}

// ── VIEW HELPERS (for export rendering) ───────────────────────────────────────

export function horizonViewColor(view) {
  return HORIZON_COLORS[view] ?? '#6b7280';
}

export function horizonShortLabel(view) {
  return HORIZON_SHORT[view] ?? view;
}
