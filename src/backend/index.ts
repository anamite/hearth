import type { Backend } from './types';
import { MockBackend } from './mock';

/**
 * Backend selection. Defaults to the local mock so the app is fully
 * playable with no server at all; set VITE_BACKEND=supabase (plus the
 * URL and anon key) to switch to the real one.
 */
export const IS_MOCK = !(
  import.meta.env.VITE_BACKEND === 'supabase' &&
  !!import.meta.env.VITE_SUPABASE_URL &&
  !!import.meta.env.VITE_SUPABASE_ANON_KEY
);

let instance: Backend | null = null;

/** Called once at boot. Keeps the Supabase client out of the mock bundle. */
export async function initBackend(): Promise<Backend> {
  if (instance) return instance;
  const created: Backend = IS_MOCK
    ? new MockBackend()
    : new (await import('./supabase')).SupabaseBackend();
  await created.init();
  instance = created;
  return created;
}

export function getBackend(): Backend {
  if (!instance) throw new Error('backend not initialised — call initBackend() first');
  return instance;
}

export type { Backend };
