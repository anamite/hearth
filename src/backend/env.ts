/**
 * Supabase connection values, resolved once.
 *
 * Projects created from mid-2025 issue a publishable key (`sb_publishable_…`)
 * where older ones issued the legacy `anon` JWT. Both go in the same slot, so
 * accept either variable name — otherwise a project configured with the newer
 * name falls through to the mock backend silently, at build time, in produc-
 * tion, with nothing logged.
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();

export const SUPABASE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ''
).trim();
