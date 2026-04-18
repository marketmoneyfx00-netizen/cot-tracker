/**
 * api/_lib/supabase/admin.js
 *
 * Service-role Supabase client para uso exclusivo del servidor.
 * Nunca importar desde componentes cliente o código del navegador.
 *
 * ✅ FIX: Inicialización lazy — no lanza en module load.
 * El error original lanzaba throw en el nivel de módulo,
 * lo que crasheaba toda la función con FUNCTION_INVOCATION_FAILED
 * antes de ejecutar ninguna línea de código de negocio.
 */

import { createClient } from "@supabase/supabase-js";

let _client = null;

function getSupabaseAdmin() {
  if (_client) return _client;

  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Log detallado para diagnóstico en Vercel
    console.error("[supabase/admin] Missing env vars:", {
      SUPABASE_URL:             supabaseUrl      ? "OK" : "MISSING",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey  ? "OK" : "MISSING",
    });
    throw new Error(
      "[supabase/admin] SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY no están configuradas. " +
      "Añádelas en Vercel → Settings → Environment Variables."
    );
  }

  _client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });

  return _client;
}

// Proxy que inicializa el cliente al primer acceso de cualquier propiedad
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      return getSupabaseAdmin()[prop];
    },
  }
);

/**
 * Inserta una entrada de log de fulfillment.
 * Fire-and-forget seguro — los errores se loguean pero no se propagan.
 */
export async function appendLog(entry) {
  try {
    const { error } = await getSupabaseAdmin()
      .from("fulfillment_logs")
      .insert(entry);

    if (error) {
      console.error("[appendLog] Insert failed:", error.message, entry);
    }
  } catch (err) {
    console.error("[appendLog] Unexpected error:", err.message, entry);
  }
}
