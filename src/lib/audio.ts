/**
 * Spec §14. All narration is pre-generated and served as static files —
 * there is no runtime text-to-speech call, ever.
 *
 * Every clip is optional at runtime: if the manifest is missing, or a file
 * 404s, playback degrades to silence and the on-screen text carries the game
 * on its own (§14.6). The game must be fully playable muted.
 */

export interface AudioManifest {
  /** logical key -> variant file paths, e.g. "cues/night_falls" -> [...] */
  clips: Record<string, string[]>;
}

const BASE = '/audio/';

let manifest: AudioManifest | null = null;
let manifestLoaded = false;
const cache = new Map<string, HTMLAudioElement>();
const lastVariant = new Map<string, number>();
let unlocked = false;

export async function loadManifest(): Promise<AudioManifest | null> {
  if (manifestLoaded) return manifest;
  manifestLoaded = true;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'force-cache' });
    if (!res.ok) return null;
    manifest = (await res.json()) as AudioManifest;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Spec §14.3 — variety matters more than it sounds like it should. Pick a
 * variant at random but never the same one twice running.
 */
function resolve(key: string): string | null {
  const variants = manifest?.clips?.[key];
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return variants[0];

  const previous = lastVariant.get(key);
  let index = Math.floor(Math.random() * variants.length);
  if (index === previous) index = (index + 1) % variants.length;
  lastVariant.set(key, index);
  return variants[index];
}

function element(path: string): HTMLAudioElement {
  let el = cache.get(path);
  if (!el) {
    el = new Audio(BASE + path);
    el.preload = 'auto';
    cache.set(path, el);
  }
  return el;
}

/** Spec §14.6 — preload the whole set when a round starts. */
export async function preloadAll(): Promise<void> {
  const m = await loadManifest();
  if (!m) return;
  for (const variants of Object.values(m.clips)) {
    for (const path of variants) element(path).load();
  }
}

/** iOS needs a real user gesture before any audio will play. */
export function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  const el = new Audio();
  el.muted = true;
  void el.play().catch(() => {});
}

function playOne(path: string): Promise<void> {
  return new Promise((resolve) => {
    const el = element(path);
    const done = () => {
      el.removeEventListener('ended', done);
      el.removeEventListener('error', done);
      resolve();
    };
    el.addEventListener('ended', done);
    el.addEventListener('error', done);
    el.currentTime = 0;
    el.play().catch(done);
    // Never let a stuck clip hold up the game.
    setTimeout(done, 8000);
  });
}

let playToken = 0;

/**
 * Play a composed line, e.g. ["cues/morning_comes","names/baker","outcomes/died"].
 * Missing clips are skipped rather than failing the sequence.
 */
export async function playSequence(keys: string[]): Promise<void> {
  const token = ++playToken;
  await loadManifest();
  for (const key of keys) {
    if (token !== playToken) return; // a newer line superseded this one
    const path = resolve(key);
    if (path) await playOne(path);
  }
}

export function stopAll(): void {
  playToken++;
  for (const el of cache.values()) {
    el.pause();
    el.currentTime = 0;
  }
}
