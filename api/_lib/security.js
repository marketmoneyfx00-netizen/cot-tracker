/**
 * api/_lib/security.js
 * Headers de seguridad HTTP y validación de inputs.
 */

// ── Security Headers ─────────────────────────────────────────────────────────
export function setSecurityHeaders(res) {
  // Evita que el navegador "adivine" el content-type
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Evita que la página sea embedida en iframes (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // Fuerza HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Referrer info limitada
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Desactiva features del navegador no necesarias
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP: solo permite recursos del propio dominio + Forex Factory + Google
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",   // React necesita inline scripts en dev
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://nfs.faireconomy.media https://script.google.com",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; '));
  // CORS para los endpoints de la API
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── CORS preflight handler ───────────────────────────────────────────────────
export function handleCORS(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

// ── Input validators ─────────────────────────────────────────────────────────

const VALID_RANGES  = new Set(['thisweek', 'nextweek', 'lastweek', 'hoy']);
const VALID_BOOLEANS = new Set(['true', 'false', '1', '0']);

/**
 * Valida y sanitiza los query params del endpoint /api/calendar.
 * Devuelve { ok, range, force, error? }
 */
export function validateCalendarParams(query) {
  const rawRange = String(query.range ?? 'thisweek').trim().toLowerCase();
  const rawForce = String(query.force  ?? 'false').trim().toLowerCase();

  if (!VALID_RANGES.has(rawRange)) {
    return {
      ok: false,
      error: `Parámetro 'range' inválido: "${rawRange}". Valores permitidos: ${[...VALID_RANGES].join(', ')}`,
    };
  }

  if (!VALID_BOOLEANS.has(rawForce)) {
    return {
      ok: false,
      error: `Parámetro 'force' inválido: "${rawForce}". Valores permitidos: true, false`,
    };
  }

  return {
    ok:    true,
    range: rawRange,
    force: rawForce === 'true' || rawForce === '1',
  };
}

/**
 * Valida y sanitiza los inputs del endpoint /api/auth.
 * Devuelve { ok, email?, tipo?, error? }
 */
export function validateAuthParams(query, body) {
  // Soporta GET (query params) y POST (body)
  const source = body ?? query;

  const rawTipo  = String(source.tipo  ?? '').trim().toLowerCase();
  const rawEmail = String(source.email ?? '').trim().toLowerCase();

  // Tipos permitidos
  const VALID_TIPOS = new Set(['login', 'registro', 'acceso', 'check', 'bug']);
  if (!VALID_TIPOS.has(rawTipo)) {
    return {
      ok: false,
      error: `Parámetro 'tipo' inválido: "${rawTipo}"`,
    };
  }

  // Validación de email con regex estricto (sin depender de librerías externas)
  const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!EMAIL_RE.test(rawEmail)) {
    return {
      ok: false,
      error: 'Email inválido o con formato incorrecto.',
    };
  }

  // Longitud máxima para evitar ataques de buffer
  if (rawEmail.length > 254) {
    return { ok: false, error: 'Email demasiado largo.' };
  }

  return { ok: true, email: rawEmail, tipo: rawTipo };
}

// ── Logging de seguridad ─────────────────────────────────────────────────────
// NUNCA loguear datos sensibles — solo metadata

export function logSecurityEvent(type, details) {
  const safeDetails = { ...details };
  // Eliminar campos sensibles por si acaso llegan
  delete safeDetails.password;
  delete safeDetails.token;
  delete safeDetails.apiKey;
  delete safeDetails.secret;

  console.warn(`[SECURITY:${type}]`, JSON.stringify({
    ts:  new Date().toISOString(),
    ...safeDetails,
  }));
}
