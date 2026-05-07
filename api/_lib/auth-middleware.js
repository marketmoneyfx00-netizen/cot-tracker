/**
 * api/_lib/auth-middleware.js
 * Verifica el JWT de Supabase enviado en el header Authorization.
 * Uso: const { user, error } = await verifyAuth(req);
 */

import { supabaseAdmin } from './supabase/admin.js';

/**
 * Extrae y verifica el Bearer token del header Authorization.
 * @returns {{ user: object|null, error: string|null }}
 */
export async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid Authorization header' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { user: null, error: 'Empty token' };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: error?.message ?? 'Invalid token' };
  }
  return { user, error: null };
}
