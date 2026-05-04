import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      // flowType: 'implicit' (default for browser — DO NOT use 'pkce' with magic links)
      //
      // With 'pkce', Supabase stores the code_verifier in sessionStorage, which is
      // per-tab. When the user clicks the magic link from their email client, it
      // opens in a NEW TAB that has no access to the original tab's sessionStorage
      // → "PKCE code verifier not found in storage" error.
      //
      // With 'implicit' (default), Supabase delivers tokens directly in the URL
      // hash (#access_token=xxx). detectSessionInUrl picks them up automatically.
      // No cross-tab storage dependency. Works from any email client.
      flowType:           'implicit',
      storage:            window.localStorage,
    }
  }
);
