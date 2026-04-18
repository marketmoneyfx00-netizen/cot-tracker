/**
 * api/_lib/ratelimit.js
 * In-memory rate limiter para Vercel serverless.
 *
 * NOTA: En Vercel, cada función es una instancia independiente.
 * Este limiter es por-instancia (suficiente para protección básica).
 * Para rate limiting global multi-instancia usa @upstash/ratelimit + Redis.
 *
 * Presets disponibles:
 *   RATE_LIMITS.api    → 100 req / 15 min  (endpoints generales)
 *   RATE_LIMITS.auth   →   5 req / 15 min  (login/registro)
 *   RATE_LIMITS.strict →  10 req / 15 min  (pagos, admin)
 */

// ── Configuraciones ─────────────────────────────────────────────────────────
export const RATE_LIMITS = {
  api:    { max: 100, windowMs: 15 * 60 * 1000 },
  auth:   { max: 5,   windowMs: 15 * 60 * 1000 },
  strict: { max: 10,  windowMs: 15 * 60 * 1000 },
};

// ── Store en memoria ─────────────────────────────────────────────────────────
// key = `${limitName}:${ip}` → { count, resetAt }
const store = new Map();

// Limpiar entradas expiradas cada 5 minutos para evitar memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

// ── Helper: obtener IP real (Vercel pone la IP en x-forwarded-for) ───────────
export function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ── Rate limit check ─────────────────────────────────────────────────────────
/**
 * Comprueba el rate limit para una IP y un preset dado.
 * @param {string} ip
 * @param {'api'|'auth'|'strict'} preset
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, retryAfterSec: number }}
 */
export function checkRateLimit(ip, preset = 'api') {
  const { max, windowMs } = RATE_LIMITS[preset] ?? RATE_LIMITS.api;
  const key  = `${preset}:${ip}`;
  const now  = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // Ventana nueva
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs, retryAfterSec: 0 };
  }

  entry.count += 1;
  const remaining = Math.max(0, max - entry.count);
  const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed:       entry.count <= max,
    remaining,
    resetAt:       entry.resetAt,
    retryAfterSec: entry.count > max ? retryAfterSec : 0,
  };
}

/**
 * Aplica rate limiting a una request de Vercel.
 * Devuelve true si se respondió con 429 (handler debe hacer return).
 * Devuelve false si la request está permitida.
 */
export function applyRateLimit(req, res, preset = 'api') {
  const ip     = getClientIP(req);
  const result = checkRateLimit(ip, preset);

  // Siempre añadir headers informativos
  res.setHeader('X-RateLimit-Limit',     RATE_LIMITS[preset]?.max ?? 100);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfterSec);
    // Log (sin datos sensibles)
    console.warn(`[RATE_LIMIT] ip=${ip} preset=${preset} retryAfter=${result.retryAfterSec}s`);
    res.status(429).json({
      ok:    false,
      error: 'Too Many Requests',
      msg:   `Demasiadas peticiones. Espera ${result.retryAfterSec} segundos e inténtalo de nuevo.`,
      retryAfter: result.retryAfterSec,
    });
    return true; // blocked
  }

  return false; // allowed
}
