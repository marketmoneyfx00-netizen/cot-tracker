import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseInstance = null;

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      // implicit: el magic link llega con #access_token en el hash.
      // detectSessionInUrl lo procesa al inicializar el cliente.
      // Los locks que había antes los causaban el AuthProvider y accessGuard,
      // ya corregidos. No cambiar a pkce: rompería el flujo OTP.
      flowType: 'implicit',
    },
    global: {
      headers: { 'X-Client-Info': 'cot-tracker-app' },
    },
  });

  return supabaseInstance;
}

export const supabase = getSupabaseClient();
