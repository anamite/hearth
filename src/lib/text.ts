import { NICKNAME_MAX, NICKNAME_MIN, NICKNAME_POOL } from './constants';

/**
 * Spec §11.2 — grading normalises by lowercasing, trimming, collapsing
 * whitespace and stripping punctuation, then checks set membership.
 */
export function normaliseGuess(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function guessMatches(guess: string, aliases: string[]): boolean {
  const g = normaliseGuess(guess);
  if (!g) return false;
  return aliases.some((a) => normaliseGuess(a) === g);
}

/**
 * Tidy a typed name, or return null if it breaks the rules: 2–15 characters
 * after trimming, no control or invisible formatting characters. Any script
 * and emoji are fine. Mirrored by `hearth_clean_nickname` in SQL — keep the
 * two in step.
 *
 * A name that matches a quick-pick name in any case takes the pool's
 * spelling, so "baker" still gets Baker's narration clip.
 */
export function cleanNickname(input: string): string | null {
  const name = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return null;
  // The zero-width joiner is allowed because emoji sequences need it.
  if (/[\p{Cc}\p{Cf}]/u.test(name.replace(/‍/g, ''))) return null;
  const pooled = NICKNAME_POOL.find((n) => n.toLowerCase() === name.toLowerCase());
  return pooled ?? name;
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function listNames(names: string[]): string {
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
