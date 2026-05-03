/**
 * interpretationEngine.js — Sistema de plantillas dinámicas de interpretación
 *
 * buildInterpretation(): genera texto de lectura clara + bullets de acción
 * basados en scoreF, scoreC, scoreT y sesgoCompuesto.
 *
 * Sin estado. Sin dependencias. Función pura.
 *
 * Fix 2: orden de plantillas corregido (fat tail → compresión → divergencia → momentum → neutral → moderado)
 * Fix 3: fat tail detectado por |scoreF| > 80 && scoreT === 0 (realista)
 * Fix 5: horizonte temporal añadido al final de cada reading
 * Fix 6: fallback ?? 0 para todos los inputs
 */

export function buildInterpretation({ sesgoCompuesto, scoreF, scoreC, scoreT }) {
  // Fix 6 — safety fallback anti-undefined
  sesgoCompuesto = sesgoCompuesto ?? 0;
  scoreF         = scoreF         ?? 0;
  scoreC         = scoreC         ?? 0;
  scoreT         = scoreT         ?? 0;

  const absTotal = Math.abs(sesgoCompuesto);

  // ── 1. TEMPLATE: Fat tail (evento extremo sin confirmación) ───────────────
  // Fix 3: condición realista — F muy fuerte pero T sin confirmar
  if (Math.abs(scoreF) > 80 && scoreT === 0 && Math.abs(scoreC) < 40) {
    return {
      reading: 'Evento de cola extrema detectado. El dato supera los parámetros históricos normales y el precio no ha confirmado. Las reglas de análisis estándar se suspenden. Horizonte: esperar mínimo 15–30 min antes de evaluar.',
      actions: [
        'No operar hasta que el precio confirme una estructura clara',
        'Esperar al menos 2–3 velas de 5m antes de evaluar',
        'Reducir tamaño de posición al mínimo si ya estás dentro',
        'Vigilar posible reversión violenta tras la volatilidad inicial',
      ],
    };
  }

  // ── 2. TEMPLATE: Compresión macro (F y C fuertes, T=0) ───────────────────
  if (Math.abs(scoreF) > 30 && Math.abs(scoreC) > 20 && scoreT === 0) {
    const dir = scoreF < 0 ? 'bajista' : 'alcista';
    return {
      reading: `Presión macro ${dir} clara en F y C, pero el precio no ha confirmado. Posible compresión antes de expansión. El mercado puede estar absorbiendo el dato. Horizonte: intradía (5m–1h) hasta que aparezca desplazamiento.`,
      actions: [
        'No entrar en la dirección fundamental sin confirmación de precio',
        'Vigilar ruptura de estructura en timeframe corto (1m–5m)',
        'Una vela de desplazamiento fuerte confirmaría la dirección',
        'Posible fakeout inicial — esperar cierre de vela de confirmación',
      ],
    };
  }

  // ── 3. TEMPLATE: Divergencia (F y T opuestos) ─────────────────────────────
  if (scoreF !== 0 && scoreT !== 0 && Math.abs(scoreF) > 15 && Math.abs(scoreT) > 15 && Math.sign(scoreF) !== Math.sign(scoreT)) {
    return {
      reading: 'Divergencia entre el dato fundamental y la acción del precio. El mercado no sigue la narrativa del dato. Posible trampa institucional o dato ya descontado. Horizonte: corto plazo (1h–4h) para resolución.',
      actions: [
        'Máxima precaución — reducir tamaño al mínimo',
        'No operar en la dirección del dato fundamental',
        'El precio manda sobre el dato — seguir la estructura',
        'Esperar resolución de la divergencia antes de posicionarse',
      ],
    };
  }

  // ── 4a. TEMPLATE: Momentum alcista fuerte ─────────────────────────────────
  if (sesgoCompuesto > 50 && scoreT > 15) {
    return {
      reading: 'Flujo alcista fuerte con alineación fundamental, contextual y técnica. Alta probabilidad de continuación en la dirección alcista. Horizonte: sesión actual (intradía).',
      actions: [
        'Buscar compras en retrocesos hacia niveles de soporte previos',
        'Stop por debajo del último mínimo relevante',
        'Take profit parcial en siguiente zona de liquidez',
        'Escalar posición si el precio aguanta sin romper estructura',
      ],
    };
  }

  // ── 4b. TEMPLATE: Momentum bajista fuerte ─────────────────────────────────
  if (sesgoCompuesto < -50 && scoreT < 0) {
    return {
      reading: 'Flujo bajista fuerte con alineación fundamental, contextual y técnica. Alta probabilidad de continuación a la baja. Horizonte: sesión actual (intradía).',
      actions: [
        'Buscar ventas en rebotes hacia zonas de oferta previas',
        'Stop por encima del último máximo relevante',
        'Take profit parcial en siguiente zona de liquidez',
        'Escalar posición si el precio aguanta sin romper estructura',
      ],
    };
  }

  // ── 5. TEMPLATE: Neutral — sin dirección clara ────────────────────────────
  if (absTotal <= 20) {
    return {
      reading: 'Sesgo neutral sin confirmación técnica. Alta probabilidad de rango o movimiento diferido. El mercado aún no ha decidido. Horizonte: esperar ruptura antes de operar.',
      actions: [
        'Evitar entradas inmediatas después de la noticia',
        'Esperar barrida de liquidez y posterior desplazamiento',
        'Buscar confirmación en estructura 1m–5m antes de entrar',
        'Solo entrar ante ruptura clara con volumen',
      ],
    };
  }

  // ── 6. TEMPLATE: Sesgo moderado (fallback) ────────────────────────────────
  const dir = sesgoCompuesto > 0 ? 'alcista' : 'bajista';
  return {
    reading: `Sesgo ${dir} moderado con confirmación parcial del precio. Operable con gestión de riesgo ajustada. Horizonte: corto plazo (1h–4h).`,
    actions: [
      `Priorizar entradas en la dirección ${dir} si el precio lo confirma`,
      'Reducir tamaño respecto a setups de alta convicción',
      'Usar stops ajustados ante posible reversión',
      'Confirmar en al menos un timeframe superior',
    ],
  };
}

// ── CONTENIDO DE TOOLTIPS ─────────────────────────────────────────────────────

export const TOOLTIPS = {
  sesgoFinal: `📊 Sesgo Final\n\nResultado ponderado de los factores Fundamental, Contextual y Técnico.\n\nInterpretación:\n+20 a +100 → Sesgo alcista\n-20 a -100 → Sesgo bajista\n-20 a +20 → Neutro / sin dirección\n\nQué hacer: Si el sesgo es neutro, reducir riesgo o esperar confirmación antes de operar.`,

  senalCoherente: `✅ Señal coherente\n\nTodos los factores apuntan en la misma dirección.\n\nEl fundamental, el contexto macro y el precio están alineados.\n\nQué hacer: Operar con precaución respetando el nivel de riesgo habitual. Confirmar en timeframe superior antes de entrar.`,

  senalMixta: `⚖️ Señal mixta\n\nLos factores del mercado no están alineados entre sí (macro vs acción del precio).\n\nRiesgo: Alta probabilidad de movimiento errático o choppy.\n\nQué hacer: Reducir tamaño de posición o esperar confirmación de estructura antes de entrar.`,

  macroLogic: `🧠 Lógica macro\n\nEjemplo — Desempleo alto:\nMás desempleo → economía más débil → expectativas dovish (tipos a la baja) → divisa más débil.\n\nEl dato impacta por su relación con las expectativas del banco central, no solo por su valor absoluto.`,

  // Fix 1: funciones que reciben el peso real
  factorF: (weight) => `F — Fundamental (${weight}%)\n\nImpacto directo del dato económico publicado.\n\nMide: cuánto sorprendió el dato respecto al consenso de analistas.\n\nMayor sorpresa → mayor impacto en mercado.`,

  factorC: (weight) => `C — Contextual (${weight}%)\n\nRelación del dato con las expectativas del ciclo macro.\n\nIncluye: si el dato ya estaba descontado en precio, tendencia de datos anteriores, régimen actual de política monetaria.`,

  factorT: (weight) => `T — Técnico (${weight}%)\n\nConfirmación del precio tras la publicación del dato.\n\nMide: si el mercado reacciona en la dirección que indica el análisis fundamental.\n\nT=0 → el mercado no ha confirmado la narrativa del dato.`,

  compresion: `⏸️ Mercado en compresión\n\nEl precio no ha reaccionado claramente al dato publicado.\n\nQué suele ocurrir después:\n→ Expansión de volatilidad\n→ Posible fakeout (trampa) en primera dirección\n\nQué hacer: Esperar ruptura de estructura con desplazamiento claro antes de operar.`,
};
