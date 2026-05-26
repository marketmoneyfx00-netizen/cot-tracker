// =============================================================================
// POLYMARKET × COT TRACKER — NARRATIVE GENERATOR
// src/polymarket/narrative/NarrativeGenerator.js
//
// Template-based narrative generation for composite signals.
// Sounds like a macro desk, not a signal service.
// =============================================================================

export class NarrativeGenerator {
  /** @param {import('../signals/SignalBus.js').SignalBus} bus */
  constructor(bus) {
    this._bus = bus;
  }

  // ── RRC ──────────────────────────────────────────────────────────────────

  generateRRCNarrative(rrc) {
    const { value, regime, delta7d, confidence } = rrc;
    if (confidence === 'INSUFFICIENT') {
      return 'Datos de mercado de predicción insuficientes para estimar riesgo de recesión.';
    }

    const delta = delta7d ?? 0;
    const trend = delta > 5  ? ` Subió ${delta.toFixed(0)}pp en 7 días.`
                : delta < -5 ? ` Bajó ${Math.abs(delta).toFixed(0)}pp en 7 días.`
                : '';

    const base = {
      EXPANSION:  `Mercados de predicción asignan ${value}% de probabilidad a recesión en EE.UU. — régimen de expansión.`,
      WATCH:      `Riesgo de recesión en ${value}% según Polymarket. Zona de vigilancia, sin señal clara aún.`,
      ELEVATED:   `Riesgo de recesión elevado en ${value}%. Mercados comenzando a descontar deterioro macro.`,
      HIGH_RISK:  `Riesgo de recesión en ${value}% — zona de alto riesgo. Posicionamiento defensivo justificado.`,
      SEVERE:     `Riesgo de recesión severo: ${value}%. Crowd market descuenta contracción inminente.`,
    }[regime] ?? `Riesgo de recesión: ${value}%.`;

    return base + trend;
  }

  // ── GTRP ─────────────────────────────────────────────────────────────────

  generateGTRPNarrative(gtrp) {
    const { value, dominantRisk, confidence } = gtrp;
    if (confidence === 'INSUFFICIENT') {
      return 'Liquidez insuficiente en mercados geopolíticos para generar señal de riesgo de cola.';
    }

    const pct = (value * 100).toFixed(0);
    const domLabel = {
      GEOPOLITICAL: 'conflictos activos',
      TRADE_WAR:    'escalada comercial',
      GLOBAL_MACRO: 'riesgo nuclear/sistémico',
      FISCAL_DEBT:  'ruptura diplomática',
    }[dominantRisk] ?? 'riesgo geopolítico';

    if (value > 0.70) {
      return `Riesgo de cola geopolítico elevado (${pct}%). Componente dominante: ${domLabel}. Contexto de aversión al riesgo activo.`;
    }
    if (value > 0.55) {
      return `Riesgo geopolítico moderado-alto (${pct}%). Mercados descuentan tensión en ${domLabel}. Monitorear escalada.`;
    }
    return `Riesgo geopolítico contenido (${pct}%). ${domLabel} presente pero sin señal de cola activa.`;
  }

  // ── MSC ──────────────────────────────────────────────────────────────────

  generateMSCNarrative(msc) {
    const { value, regime, riskCompressionExpansion: rce } = msc;

    const direction = rce > 10  ? 'expandiéndose' :
                      rce < -10 ? 'comprimiéndose' : 'estable';

    const base = {
      LOW:      `Estrés macro en niveles bajos (${value}/100). Entorno de menor riesgo sistémico.`,
      MODERATE: `Estrés macro moderado (${value}/100). Condiciones de fondo sin señal crítica.`,
      ELEVATED: `Estrés macro elevado (${value}/100). Composición de factores de riesgo en aumento.`,
      HIGH:     `Estrés macro alto (${value}/100). Múltiples señales de riesgo convergiendo.`,
      EXTREME:  `Estrés macro extremo (${value}/100). Mercados de predicción señalan deterioro sistémico severo.`,
    }[regime] ?? `Macro Stress Composite: ${value}/100.`;

    return `${base} Riesgo ${direction}.`;
  }

  // ── Pre-event (PISI) ──────────────────────────────────────────────────────

  generateEventNarrative(snapshot, cv, calendarEventId) {
    const pct  = (snapshot.midpoint * 100).toFixed(0);
    const dir  = cv?.direction?.includes('UP')   ? '↑ momentum alcista' :
                 cv?.direction?.includes('DOWN')  ? '↓ momentum bajista' : 'estable';
    const oi   = (snapshot.openInterest / 1000).toFixed(0);

    return `Crowd market [${calendarEventId}]: ${pct}% probabilidad · ${dir} · OI $${oi}k`;
  }

  // ── FDS ───────────────────────────────────────────────────────────────────

  generateFDSNarrative(fds) {
    return fds?.implication ?? 'CME FedWatch no disponible para comparación.';
  }

  // ── Generic signal → narrative ────────────────────────────────────────────

  signalToNarrative(signal) {
    if (signal.narrative) return signal.narrative;
    return `Señal ${signal.type}: ${signal.value.toFixed(1)} (${signal.magnitude})`;
  }
}
