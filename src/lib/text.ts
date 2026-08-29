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

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function listNames(names: string[]): string {
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
