/**
 * historicalStore.js — Memoria histórica ligera por indicador
 *
 * Almacena los últimos N valores de surprisePct por indicador
 * usando localStorage como capa de persistencia entre sesiones.
 *
 * Sin base de datos. Sin dependencias externas.
 * Estructura: { "OIL_INVENTORIES": [0.12, -0.08, 0.25, ...] }
 *
 * Reglas:
 *   - Máximo 50 registros por indicador (FIFO)
 *   - Mínimo 10 registros para activar fat tail
 *   - Clave de localStorage: "cot_hist_v1"
 */

const STORAGE_KEY   = 'cot_hist_v1';
const MAX_RECORDS   = 50;
const MIN_FOR_STATS = 10;

// ── Leer todo el store desde localStorage ────────────────────────────────────
function _loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

// ── Escribir todo el store en localStorage ────────────────────────────────────
function _saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage lleno o no disponible (SSR / private mode) → silencioso
  }
}

/**
 * getHistory — devuelve el array de surprisePct históricos para un indicador.
 * @param {string} indicatorId  ej: "OIL_INVENTORIES", "CPI_US"
 * @returns {number[]}          array de valores, puede estar vacío
 */
export function getHistory(indicatorId) {
  if (!indicatorId) return [];
  const store = _loadStore();
  const arr = store[indicatorId];
  return Array.isArray(arr) ? arr : [];
}

/**
 * updateHistory — añade un nuevo surprisePct al histórico del indicador.
 * Aplica política FIFO: descarta el más antiguo si supera MAX_RECORDS.
 * Solo acepta números finitos; ignora null, NaN, Infinity.
 *
 * @param {string} indicatorId
 * @param {number} surprisePct  valor numérico (puede ser negativo)
 */
export function updateHistory(indicatorId, surprisePct) {
  if (!indicatorId) return;
  if (typeof surprisePct !== 'number' || !isFinite(surprisePct)) return;

  const store = _loadStore();
  const existing = Array.isArray(store[indicatorId]) ? store[indicatorId] : [];

  // FIFO: añadir al final, truncar desde el inicio si supera el máximo
  const updated = [...existing, surprisePct];
  store[indicatorId] = updated.length > MAX_RECORDS
    ? updated.slice(updated.length - MAX_RECORDS)
    : updated;

  _saveStore(store);
}

/**
 * getStats — calcula media y desviación estándar del histórico.
 * Devuelve null si no hay suficientes datos (<10) para ser estadísticamente
 * relevante (evita fat tail prematuros con pocos datos).
 *
 * @param {string} indicatorId
 * @returns {{ mean: number, std: number, count: number } | null}
 */
export function getStats(indicatorId) {
  const history = getHistory(indicatorId);
  if (history.length < MIN_FOR_STATS) return null;

  const n    = history.length;
  const mean = history.reduce((acc, v) => acc + v, 0) / n;
  const variance = history.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const std  = Math.sqrt(variance);

  // std == 0 → todos los valores iguales → no calcular z-score (evita división x 0)
  if (std === 0) return null;

  return { mean, std, count: n };
}

/**
 * clearHistory — elimina el histórico de un indicador específico.
 * Útil para testing o reset manual.
 *
 * @param {string} indicatorId
 */
export function clearHistory(indicatorId) {
  if (!indicatorId) return;
  const store = _loadStore();
  delete store[indicatorId];
  _saveStore(store);
}

/**
 * clearAllHistory — elimina todo el store histórico.
 */
export function clearAllHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silencioso
  }
}
