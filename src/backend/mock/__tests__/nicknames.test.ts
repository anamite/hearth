import { describe, expect, it } from 'vitest';
import { cleanNickname } from '@/lib/text';

describe('custom nicknames', () => {
  it('accepts a typed name, trimmed and with whitespace collapsed', () => {
    expect(cleanNickname('  Big   Al ')).toBe('Big Al');
    expect(cleanNickname('Anand')).toBe('Anand');
  });

  it('allows any script and emoji', () => {
    expect(cleanNickname('ആനന്ദ്')).toBe('ആനന്ദ്');
    expect(cleanNickname('José')).toBe('José');
    expect(cleanNickname('Pizza 🍕')).toBe('Pizza 🍕');
    expect(cleanNickname('👨‍👩‍👧 Fam')).toBe('👨‍👩‍👧 Fam'); // zero-width joiners
  });

  it('enforces 2 to 15 characters', () => {
    expect(cleanNickname('A')).toBeNull();
    expect(cleanNickname('   ')).toBeNull();
    expect(cleanNickname('Ab')).toBe('Ab');
    expect(cleanNickname('x'.repeat(15))).toBe('x'.repeat(15));
    expect(cleanNickname('x'.repeat(16))).toBeNull();
    // Counted in characters, not UTF-16 units.
    expect(cleanNickname('🍕'.repeat(15))).toBe('🍕'.repeat(15));
  });

  it('rejects control and invisible characters', () => {
    expect(cleanNickname('Bak\u200Ber')).toBeNull();
    expect(cleanNickname('Bak\u202Eer')).toBeNull();
    expect(cleanNickname('Bak\u0007er')).toBeNull();
  });

  it('snaps a quick-pick name to the pool spelling so narration still works', () => {
    expect(cleanNickname('baker')).toBe('Baker');
    expect(cleanNickname(' MILLER ')).toBe('Miller');
  });
});
