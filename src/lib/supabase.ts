import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true cuando faltan las variables públicas (p. ej. un clon recién descargado sin .env.local). */
export const backendMissing = !url || !key || url.includes('<ref>');

/**
 * Cliente público. La sesión vive en localStorage: reabrir la app sin internet
 * mantiene la sesión iniciada (el token se renueva al reconectar).
 */
export const supabase: SupabaseClient | null = backendMissing
  ? null
  : createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
