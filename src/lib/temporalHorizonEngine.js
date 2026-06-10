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
  STRONG_BULLISH: '↑↑ Fuerte',
  BULLISH:        '↑ Alcista',
  LEAN_BULLISH:   '↗ Leve Alcista',
  NEUTRAL:        '→ Neutral',
  LEAN_BEARISH:   '↘ Leve Bajista',
  BEARISH:        '↓ Bajista',
  STRONG_BEARISH: '↓↓ Fuerte',
  AVOID:          '✕ Evitar',
  TRANSITIONAL:   '~ Transición',
  EARLY_SIGNAL:   '◌ Señal Temprana',
  STRUCTURAL:     '⬛ Estructural',
};

// ── TACTICAL HORIZON (1-5 days) ───────────────────────────────────────────────

function buildTacticalView(biasEntry, exec, direction) {
  const execScore = exec?.score ?? 0;
  const execLabel = exec?.permission?.label ?? 'RESTRICTED';
  const divState  = biasEntry?.divergence?.state ?? 'NONE';
  const basis     = [];

  // Exhaustion overrides everything — tactical AVOID regardless of execution
  if (divState === 'EXHAUSTION') {
    basis.push('Señal de agotamiento activa — posicionamiento en extremo, riesgo de reversión elevado');
    basis.push('No se recomienda entrada táctica hasta que el posicionamiento se normalice (Z por debajo de ±1.5)');
    return {
      view:           'AVOID',
      short_label:    HORIZON_SHORT.AVOID,
      strength:       0,
      basis,
      cot_applicable: false,
      note:           'El COT es una señal estructural semanal. No usar para entradas tácticas.',
    };
  }

  let view = 'NEUTRAL';

  if (execLabel === 'FAVORABLE' || execScore >= 70) {
    if (direction === 'bullish') view = 'LEAN_BULLISH';
    else if (direction === 'bearish') view = 'LEAN_BEARISH';
    basis.push(`Condiciones de ejecución favorables (puntuación: ${execScore}) — el sesgo direccional puede considerarse para entradas tácticas`);
  } else if (execScore < 45 || execLabel === 'RESTRICTED') {
    view = 'AVOID';
    basis.push(`Condiciones de ejecución restringidas (puntuación: ${execScore}) — esperar ventana de volatilidad/macro`);
  } else {
    basis.push(`Condiciones de ejecución neutras (puntuación: ${execScore}) — sin ventaja táctica clara`);
  }

  // Z-score extreme aligned with bias = crowding warning even tactically
  const z = biasEntry?.zscore?.zscore ?? null;
  if (z != null && Math.abs(z) >= 2.5) {
    const zAligned = (z > 0 && direction === 'bullish') || (z < 0 && direction === 'bearish');
    if (zAligned) {
      basis.push(`Posicionamiento extremo (Z: ${z?.toFixed(2)}) — entrada en niveles actuales conlleva riesgo de saturación`);
      if (view !== 'AVOID') view = 'NEUTRAL'; // downgrade from lean
    }
  }

  return {
    view,
    short_label:    HORIZON_SHORT[view] ?? view,
    strength:       Math.round(execScore),
    basis,
    cot_applicable: false,
    note:           'Datos COT son semanales — usados solo como contexto direccional en el horizonte táctico.',
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
      basis:          ['Posicionamiento institucional neutral — sin tesis direccional de swing dominante'],
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
    `Puntuación de sesgo COT ${biasScore > 0 ? '+' : ''}${biasScore?.toFixed(1)} — Leveraged Money neto ${direction === 'bullish' ? 'largo' : 'corto'}`,
  );

  // Streak modifier
  if (streak >= 4) {
    basis.push(`Racha consecutiva de ${streak} informes — alta persistencia institucional, tesis anclada estructuralmente`);
    // Upgrade view one level if not already at max
    if (view === 'LEAN_BULLISH') view = 'BULLISH';
    else if (view === 'LEAN_BEARISH') view = 'BEARISH';
  } else if (streak >= 2) {
    basis.push(`Racha de ${streak} informes — persistencia direccional confirmada`);
  } else if (streak === 1) {
    basis.push('Señal de un solo informe — racha insuficiente para entrada swing de alta convicción');
  }

  // Divergence modifier
  const bullDiv = divState === 'BULLISH_DIVERGENCE';
  const bearDiv = divState === 'BEARISH_DIVERGENCE';
  const divAligned = (bullDiv && direction === 'bullish') || (bearDiv && direction === 'bearish');
  const divConflict = (bullDiv && direction === 'bearish') || (bearDiv && direction === 'bullish');

  if (divState === 'EXHAUSTION') {
    basis.push('Señal de agotamiento — posicionamiento en extremo insostenible, riesgo de reversión swing elevado');
    view = 'AVOID';
  } else if (divAligned) {
    basis.push(`Divergencia ${bullDiv ? 'alcista' : 'bajista'} confirma dirección swing — acumulación de smart money en debilidad de precio`);
  } else if (divConflict) {
    basis.push('Divergencia en conflicto con dirección swing — señal de distribución institucional, proceder con cautela');
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
    const flowDir = chgNet > 0 ? 'acumulación' : 'distribución';
    const flowAligned = (chgNet > 0 && direction === 'bullish') || (chgNet < 0 && direction === 'bearish');
    basis.push(
      `Flujo semanal: ${flowDir} de ${flowK}K contratos — ${flowAligned ? 'confirma' : 'diverge de'} la tesis swing`,
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
      basis:          ['Sin sesgo direccional institucional — tesis macro indefinida'],
      cot_applicable: true,
      note:           'La tesis macro requiere ≥3 confirmaciones CFTC consecutivas.',
    };
  }

  // Macro thesis requires at least 2 reports; 3+ for full confirmation
  if (streak < 2) {
    return {
      view:           'EARLY_SIGNAL',
      short_label:    HORIZON_SHORT.EARLY_SIGNAL,
      strength:       Math.round(Math.abs(biasEntry?.bias?.score ?? 0) / 5 * 30),
      basis:          [
        `Solo ${streak} informe(s) CFTC confirman esta dirección — insuficiente para tesis macro`,
        'El posicionamiento macro requiere mínimo 2-3 confirmaciones semanales consecutivas',
      ],
      cot_applicable: true,
      note:           'La tesis macro requiere ≥3 confirmaciones CFTC consecutivas.',
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
    basis.push('Régimen macro y ciclo de política alineados — tesis estructural bien soportada');
  } else if (macroAligned || carryAligned) {
    view = direction === 'bullish' ? 'LEAN_BULLISH' : 'LEAN_BEARISH';
    basis.push(
      macroAligned
        ? 'Régimen macro confirma dirección; ciclo de política neutral o mixto'
        : 'Ciclo de política soporta dirección; régimen macro mixto',
    );
  } else if (macroConflict) {
    view = 'TRANSITIONAL';
    basis.push('El régimen macro genera vientos en contra estructurales — señal COT no confirmada por macro');
    macroStrength = 20;
  } else {
    view = 'TRANSITIONAL';
    basis.push('Entorno macro en transición — confirmación de régimen pendiente');
  }

  // Add regime detail
  if (riskRegime?.regime && riskRegime.regime !== 'TRANSITIONAL') {
    basis.push(
      `Régimen macro ${riskRegime.label ?? riskRegime.regime} (confianza: ${riskRegime.confidence ?? '?'}%)`,
    );
  }

  // Add policy cycle for FX / bonds
  if (cat === 'fx' || cat === 'bonds') {
    const fedCycle = cycleProfiles?.['FED'];
    if (fedCycle) {
      basis.push(
        `Ciclo FED: ${fedCycle.cycleLabel} — ${fedCycle.maturityLabel} ` +
        `(acumulado ${fedCycle.cumBps > 0 ? '+' : ''}${fedCycle.cumBps} bps)`,
      );
    }
  }

  // Streak context
  if (streak >= 4) {
    basis.push(`Racha direccional de ${streak} informes — compromiso macro institucional sostenido`);
  }

  // Check for structural signal: very long streak + regime alignment
  if (streak >= 6 && macroAligned) {
    view = direction === 'bullish' ? 'STRUCTURAL' : 'STRUCTURAL';
    basis.push('Racha extensa con alineación macro — tesis de posicionamiento estructural institucional activa');
  }

  return {
    view,
    short_label:    HORIZON_SHORT[view] ?? view,
    strength:       Math.min(100, Math.max(0, macroStrength)),
    basis,
    cot_applicable: true,
    note:           streak < 3 ? 'La tesis macro requiere ≥3 confirmaciones CFTC consecutivas.' : null,
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
    return 'Múltiples señales de horizonte temporal aconsejan evitar exposición direccional en los niveles actuales.';
  }
  if (dominant === 'BULLISH_ACROSS_ALL') {
    return 'Sesgo alcista confirmado en horizontes táctico, swing y macro — configuración de máxima calidad.';
  }
  if (dominant === 'BEARISH_ACROSS_ALL') {
    return 'Sesgo bajista confirmado en horizontes táctico, swing y macro — configuración corta de máxima calidad.';
  }
  if (dominant === 'PREDOMINANTLY_BULLISH') {
    return `Alcista en ${swing.view.includes('BULL') ? 'swing' : 'macro'} y ${macro.view.includes('BULL') ? 'macro' : 'táctico'} — el timing táctico puede variar.`;
  }
  if (dominant === 'PREDOMINANTLY_BEARISH') {
    return `Bajista en múltiples horizontes — tesis ${macro.view.includes('BEAR') ? 'macro' : 'swing'} reforzada. Las condiciones de ejecución pueden restringir la entrada táctica.`;
  }
  return `Señales de horizonte mixtas para tesis ${direction === 'bullish' ? 'alcista' : 'bajista'} — swing y macro no totalmente alineados.`;
}

// ── VIEW HELPERS (for export rendering) ───────────────────────────────────────

export function horizonViewColor(view) {
  return HORIZON_COLORS[view] ?? '#6b7280';
}

export function horizonShortLabel(view) {
  return HORIZON_SHORT[view] ?? view;
}
