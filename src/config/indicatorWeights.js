/**
 * indicatorWeights.js — Pesos W por indicador/familia
 *
 * Arquitectura: Zero lógica aquí. Solo datos de configuración.
 * El motor (compositeScoreEngine.js) los consume, nunca los define.
 *
 * Pesos globales (obligatorios por spec):
 *   W1 (fundamental)  = 0.25
 *   W2 (contextual)   = 0.25
 *   W3 (técnico)      = 0.50  ← mayor peso al precio real
 *
 * fatTailSigma: desviaciones estándar para activar modo protección (default 3.0)
 * pricedInThreshold: % de drift previo para activar descuento (default 1.5)
 * pricedInMaxReduction: reducción máxima del score fundamental (default 0.70)
 *
 * indicatorKey: debe coincidir con el evType de marketLogic.js (detectType)
 * o con el nombre normalizado que devuelve classifyCategory de newsScoringEngine
 */

// ── Pesos por defecto para indicadores no listados explícitamente ─────────────
export const DEFAULT_WEIGHTS = {
  W1: 0.25,
  W2: 0.25,
  W3: 0.50,
  fatTailSigma:        3.0,
  pricedInThreshold:   1.5,   // 1.5% drift previo activa el descuento
  pricedInMaxReduction:0.70,  // reducción máxima del score fundamental
};

/**
 * Mapa de configuración por indicador.
 * Clave: evType de marketLogic.js (detectType) o categoría de newsScoringEngine.
 *
 * Familias:
 *   A — Inflación/Costos:  CPI, PPI, PCE
 *   B — Empleo/Crecimiento: NFP, CLAIMS, GDP, ADP
 *   C — Actividad/Encuestas: PMI, ISM, RETAIL
 *   D — Commodities: OIL, NAT_GAS
 *   E — Bancos Centrales: RATE_DECISION, CB_MINUTES
 */
export const INDICATOR_WEIGHTS = {

  // ── Familia A: Inflación ───────────────────────────────────────────────────
  CPI: {
    family: 'A',
    W1: 0.25, W2: 0.25, W3: 0.50,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.2,  // CPI muy seguido → mercado anticipa bien
    pricedInMaxReduction: 0.65,
  },
  PCE: {
    family: 'A',
    W1: 0.25, W2: 0.25, W3: 0.50,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.2,
    pricedInMaxReduction: 0.60,
  },
  PPI: {
    family: 'A',
    W1: 0.30, W2: 0.25, W3: 0.45,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.60,
  },

  // ── Familia B: Empleo / Crecimiento ────────────────────────────────────────
  NFP: {
    family: 'B',
    W1: 0.25, W2: 0.20, W3: 0.55,  // NFP mueve mercado muy rápido → más peso técnico
    fatTailSigma:         2.5,       // umbral menor: NFP tiene fat tails frecuentes
    pricedInThreshold:    2.0,
    pricedInMaxReduction: 0.70,
  },
  CLAIMS: {
    family: 'B',
    W1: 0.25, W2: 0.30, W3: 0.45,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.55,
  },
  GDP: {
    family: 'B',
    W1: 0.30, W2: 0.25, W3: 0.45,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.8,
    pricedInMaxReduction: 0.65,
  },
  ADP: {
    family: 'B',
    W1: 0.20, W2: 0.30, W3: 0.50,
    fatTailSigma:         3.0,
    pricedInThreshold:    2.0,
    pricedInMaxReduction: 0.55,
  },
  EMPLOYMENT: {
    family: 'B',
    W1: 0.25, W2: 0.25, W3: 0.50,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.60,
  },

  // ── Familia C: Actividad / Encuestas ───────────────────────────────────────
  PMI: {
    family: 'C',
    W1: 0.25, W2: 0.30, W3: 0.45,
    fatTailSigma:         3.5,  // PMI menos volátil → umbral más alto para fat tail
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.50,
  },
  RETAIL: {
    family: 'C',
    W1: 0.25, W2: 0.25, W3: 0.50,
    fatTailSigma:         3.0,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.55,
  },

  // ── Familia D: Commodities ─────────────────────────────────────────────────
  OIL: {
    family: 'D',
    W1: 0.20, W2: 0.25, W3: 0.55,  // Oil muy dependiente de flujo real
    fatTailSigma:         2.5,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.70,
  },
  NAT_GAS: {
    family: 'D',
    W1: 0.20, W2: 0.25, W3: 0.55,
    fatTailSigma:         2.5,
    pricedInThreshold:    1.5,
    pricedInMaxReduction: 0.65,
  },

  // ── Familia E: Bancos Centrales ────────────────────────────────────────────
  RATE_DECISION: {
    family: 'E',
    W1: 0.35, W2: 0.25, W3: 0.40,  // Decisión de tipos: el fundamental importa más
    fatTailSigma:         4.0,       // Rarísimamente son fat tail (son eventos binarios)
    pricedInThreshold:    2.5,       // Los mercados anticipan mucho las decisiones
    pricedInMaxReduction: 0.75,
  },
  CB_MINUTES: {
    family: 'E',
    W1: 0.30, W2: 0.30, W3: 0.40,
    fatTailSigma:         4.0,
    pricedInThreshold:    2.0,
    pricedInMaxReduction: 0.60,
  },
};

/**
 * getWeights — retorna la configuración de pesos para un indicador dado.
 * Usa DEFAULT_WEIGHTS si el indicador no está en el mapa.
 *
 * @param {string} evType  — evType de marketLogic.js (ej: "CPI", "NFP", "OIL")
 * @returns {object}       — config con W1, W2, W3, fatTailSigma, etc.
 */
export function getWeights(evType) {
  return INDICATOR_WEIGHTS[evType] ?? DEFAULT_WEIGHTS;
}
