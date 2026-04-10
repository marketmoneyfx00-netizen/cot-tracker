/**
 * api/auth.js — Vercel Serverless Function
 * Proxy seguro entre el frontend y Google Apps Script (GAS)
 *
 * Columnas de Google Sheets:
 *   A = fecha_registro
 *   B = nombre          ← OJO: es nombre, NO email
 *   C = email           ← email está en columna C
 *   D = Plan
 *   E = Estado
 *   F = TrialEnd
 *   G = Source
 *
 * FIX CRÍTICO aplicado:
 *   - normalizeEmail() en AMBOS lados (input del usuario + email leído del sheet)
 *   - Mapeado de columnas correcto (B=nombre, C=email)
 *   - no-store en fetch al GAS para evitar datos cacheados
 *   - Logs de diagnóstico en todos los flujos
 */

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const GAS_URL = process.env.GAS_URL ||
  "https://script.google.com/macros/s/AKfycbyM1DDfqukrE0agkGXbZWejTKFaRE6QCOHfxtiZNnUPGvhH2TAAhSzD7QtMzzRXwo50/exec";

// Rate limiting simple en memoria (por IP)
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 10;
const WINDOW_MS     = 10 * 60 * 1000; // 10 min

// ─── normalizeEmail ─────────────────────────────────────────────────────────
/**
 * Normalización robusta de email.
 * Elimina espacios, caracteres invisibles, unicode compuesto, y pasa a minúsculas.
 * DEBE usarse en AMBOS lados: input del usuario y datos del sheet.
 */
function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\u200B/g, "")   // zero-width space (frecuente en copy-paste móvil)
    .replace(/\u00A0/g, "")   // non-breaking space
    .replace(/\uFEFF/g, "")   // BOM
    .normalize("NFKC");       // normalización unicode completa
}

// ─── parseSheetUsers ─────────────────────────────────────────────────────────
/**
 * Convierte la respuesta del GAS en un array de objetos de usuario.
 * Soporta formato de objeto con clave "rows" o array directo.
 *
 * Mapeado de columnas (índice 0):
 *   0 = fecha_registro (A)
 *   1 = nombre         (B)
 *   2 = email          (C)  ← CRÍTICO: email es índice 2, no 1
 *   3 = plan           (D)
 *   4 = estado         (E)
 *   5 = trialEnd       (F)
 *   6 = source         (G)
 */
function parseSheetUsers(gasData) {
  let rows = [];

  // El GAS puede devolver { rows: [...] } o directamente [...]
  if (Array.isArray(gasData)) {
    rows = gasData;
  } else if (gasData && Array.isArray(gasData.rows)) {
    rows = gasData.rows;
  } else if (gasData && Array.isArray(gasData.data)) {
    rows = gasData.data;
  } else if (gasData && Array.isArray(gasData.users)) {
    rows = gasData.users;
  } else {
    console.error("[AUTH] parseSheetUsers: formato inesperado del GAS:", JSON.stringify(gasData).slice(0, 200));
    return [];
  }

  return rows
    .filter(r => r !== null && r !== undefined)
    .map(row => {
      // Si la fila es un objeto con claves nombradas (el GAS puede devolverlo así)
      if (row && typeof row === "object" && !Array.isArray(row)) {
        // El GAS puede devolver claves en español o en inglés — manejar ambos
        const nombre  = row.nombre  || row.name  || row.B || "";
        const email   = row.email   || row.mail  || row.C || "";
        const plan    = row.plan    || row.Plan   || row.D || "trial";
        const estado  = row.estado  || row.Estado || row.E || "trial";
        const trialEnd= row.trialEnd|| row.TrialEnd||row.F || "";
        const source  = row.source  || row.Source || row.G || "";
        return { nombre, email: normalizeEmail(email), plan, estado, trialEnd, source };
      }

      // Si la fila es un array (formato CSV-like)
      if (Array.isArray(row)) {
        return {
          fecha_registro: row[0] || "",
          nombre:         row[1] || "",              // columna B
          email:          normalizeEmail(row[2] || ""), // columna C ← CRÍTICO
          plan:           row[3] || "trial",
          estado:         row[4] || "trial",
          trialEnd:       row[5] || "",
          source:         row[6] || "",
        };
      }

      return null;
    })
    .filter(Boolean)
    .filter(u => u.email && u.email.includes("@")); // descartar filas sin email válido
}

// ─── fetchGAS ─────────────────────────────────────────────────────────────────
async function fetchGAS(params) {
  const url = `${GAS_URL}?${new URLSearchParams(params).toString()}`;
  console.log("[AUTH] fetchGAS →", url.replace(GAS_URL, "[GAS]"));

  const res = await fetch(url, {
    method:  "GET",
    cache:   "no-store",   // CRÍTICO: sin caché → siempre datos frescos del sheet
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma":        "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`GAS HTTP ${res.status}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("[AUTH] fetchGAS: respuesta no es JSON:", text.slice(0, 300));
    throw new Error("GAS returned non-JSON");
  }
}

// ─── checkRateLimit ───────────────────────────────────────────────────────────
function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > MAX_ATTEMPTS;
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Headers anti-caché en la respuesta al cliente
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma",        "no-cache");
  res.setHeader("Expires",       "0");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { tipo, email, nombre, plan, source, mensaje } = req.query;

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (tipo === "login") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
    if (checkRateLimit(ip)) {
      return res.status(429).json({ found: false, msg: "Demasiados intentos. Espera unos minutos." });
    }

    if (!email) {
      return res.status(400).json({ found: false, msg: "Email requerido" });
    }

    // ── NORMALIZAR INPUT DEL USUARIO ────────────────────────────────────────
    const userInput = normalizeEmail(email);
    console.log("[LOGIN INPUT]", userInput);

    if (!userInput || !userInput.includes("@")) {
      return res.status(400).json({ found: false, msg: "Email inválido" });
    }

    try {
      // Pedir usuarios al GAS — siempre fresco (no-store arriba)
      const gasData = await fetchGAS({ tipo: "getUsers" });
      const users   = parseSheetUsers(gasData);

      console.log("[SHEET USERS]", users.map(u => u.email)); // log de todos los emails del sheet

      // ── COMPARAR con normalización en AMBOS lados ────────────────────────
      // parseSheetUsers ya normaliza los emails del sheet al parsearlos.
      // Aquí solo comparamos normalizeEmail(input) === user.email (ya normalizado)
      const matchedUser = users.find(u => u.email === userInput);

      console.log("[MATCH FOUND]", matchedUser ? { email: matchedUser.email, plan: matchedUser.plan, estado: matchedUser.estado } : null);

      if (!matchedUser) {
        // Extra debug: buscar coincidencias parciales para detectar el problema real
        const partial = users.find(u => u.email.includes(userInput.split("@")[0]));
        if (partial) {
          console.warn("[AUTH] ⚠️ Coincidencia parcial encontrada:", partial.email, "vs input:", userInput);
        }
        return res.status(200).json({ found: false });
      }

      // Usuario encontrado → devolver datos
      return res.status(200).json({
        found:  true,
        nombre: matchedUser.nombre || userInput.split("@")[0],
        email:  matchedUser.email,
        plan:   matchedUser.plan   || "trial",
        estado: matchedUser.estado || "trial",
        trialEnd: matchedUser.trialEnd || "",
      });

    } catch (err) {
      console.error("[AUTH] login error:", err.message);
      return res.status(500).json({ found: false, msg: "Error del servidor. Inténtalo de nuevo." });
    }
  }

  // ── REGISTRO ───────────────────────────────────────────────────────────────
  if (tipo === "registro" || tipo === "register") {
    if (!email || !nombre) {
      return res.status(400).json({ ok: false, msg: "Email y nombre requeridos" });
    }

    const emailNorm  = normalizeEmail(email);
    const nombreClean = String(nombre || "").trim().slice(0, 100);

    if (!emailNorm.includes("@")) {
      return res.status(400).json({ ok: false, msg: "Email inválido" });
    }

    try {
      // Verificar si ya existe — siempre fresco
      const gasData = await fetchGAS({ tipo: "getUsers" });
      const users   = parseSheetUsers(gasData);
      const exists  = users.find(u => u.email === emailNorm);

      if (exists) {
        console.log("[AUTH] registro: email ya existe →", emailNorm);
        return res.status(200).json({ ok: false, msg: "Este email ya está registrado" });
      }

      // Registrar en el GAS
      const regData = await fetchGAS({
        tipo:   "registro",
        nombre: nombreClean,
        email:  emailNorm,   // siempre normalizado al escribir en el sheet
        plan:   plan || "trial",
        source: source || "app",
      });

      console.log("[AUTH] registro OK →", emailNorm, regData);
      return res.status(200).json({ ok: true, msg: "Registro exitoso" });

    } catch (err) {
      console.error("[AUTH] registro error:", err.message);
      return res.status(500).json({ ok: false, msg: "Error del servidor" });
    }
  }

  // ── BUG REPORT ─────────────────────────────────────────────────────────────
  if (tipo === "bug") {
    try {
      await fetchGAS({
        tipo:    "bug",
        email:   normalizeEmail(email || ""),
        mensaje: String(mensaje || "").slice(0, 500),
      });
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(200).json({ ok: false });
    }
  }

  // ── HEALTH CHECK ───────────────────────────────────────────────────────────
  if (tipo === "ping") {
    return res.status(200).json({ ok: true, ts: Date.now() });
  }

  return res.status(400).json({ error: "tipo no reconocido" });
}
