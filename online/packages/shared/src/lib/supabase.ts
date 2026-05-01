import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

export type DxdSupabase = SupabaseClient;

/** Opciones del SDK + credenciales opcionales (recomendado en Next/Expo **en el cliente**). */
export type BrowserSupabaseOptions = SupabaseClientOptions<any> & {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export type NativeSupabaseOptions = SupabaseClientOptions<any> & {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export function getSupabaseConfigFromEnv(): { url: string; anonKey: string } {
  const url = readEnv("EXPO_PUBLIC_SUPABASE_URL") ?? readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey =
    readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env: set EXPO_PUBLIC_* (mobile) or NEXT_PUBLIC_* (web) for URL and anon key.",
    );
  }
  return { url, anonKey };
}

function readEnv(name: string): string | undefined {
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  const v = g.process?.env?.[name];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Cliente para **Next.js (browser)**: sesión en `localStorage` por defecto del SDK.
 *
 * En el **navegador**, pasá `supabaseUrl` y `supabaseAnonKey` (p. ej. `process.env.NEXT_PUBLIC_*` desde
 * tu página): el bundle de `@dxd/shared` no recibe `process.env` inyectado por Next.
 */
export function createBrowserSupabaseClient(options?: BrowserSupabaseOptions): DxdSupabase {
  const { supabaseUrl, supabaseAnonKey, ...rest } = options ?? {};
  let url: string;
  let anonKey: string;
  if (supabaseUrl !== undefined || supabaseAnonKey !== undefined) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "createBrowserSupabaseClient: pasá **ambos** `supabaseUrl` y `supabaseAnonKey` (típico: desde `process.env.NEXT_PUBLIC_*` en la app), o ninguno para leer solo variables de entorno (Node / scripts).",
      );
    }
    url = supabaseUrl;
    anonKey = supabaseAnonKey;
  } else {
    ({ url, anonKey } = getSupabaseConfigFromEnv());
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(rest.auth ?? {}),
    },
    ...rest,
  });
}

/**
 * Cliente para **Expo / React Native**: pasá `auth.storage` (AsyncStorage) en `options`.
 * En el dispositivo, conviene pasar también `supabaseUrl` y `supabaseAnonKey` desde `process.env.EXPO_PUBLIC_*`.
 */
export function createNativeSupabaseClient(options: NativeSupabaseOptions): DxdSupabase {
  const { supabaseUrl, supabaseAnonKey, ...rest } = options;
  let url: string;
  let anonKey: string;
  if (supabaseUrl !== undefined || supabaseAnonKey !== undefined) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "createNativeSupabaseClient: pasá **ambos** `supabaseUrl` y `supabaseAnonKey`, o ninguno para leer solo variables de entorno.",
      );
    }
    url = supabaseUrl;
    anonKey = supabaseAnonKey;
  } else {
    ({ url, anonKey } = getSupabaseConfigFromEnv());
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(rest.auth ?? {}),
    },
    ...rest,
  });
}
