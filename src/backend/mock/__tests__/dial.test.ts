import { describe, expect, it } from 'vitest';
import { Table } from './harness';
import { scoreFor } from '../games/dial';

function pub(t: Table, playerId: string) {
  return t.view(playerId).public as any;
}

function playSubRound(t: Table, position: number) {
  const p = pub(t, t.playerIds[0]);
  t.act(p.clue_giver_id, 'clue_given', { clue: 'a radiator' });
  t.act(pub(t, t.playerIds[0]).dial_holder_id, 'dial_set', { position, locked: true });
  t.timeout(); // step past the 10s reveal
}

describe('Dial — scoring bands (§13.1)', () => {
  it('scores by distance from the target', () => {
    expect(scoreFor(50, 50)).toBe(4);
    expect(scoreFor(50, 53)).toBe(4);
    expect(scoreFor(50, 54)).toBe(3);
    expect(scoreFor(50, 58)).toBe(3);
    expect(scoreFor(50, 59)).toBe(2);
    expect(scoreFor(50, 65)).toBe(2);
    expect(scoreFor(50, 66)).toBe(0);
    expect(scoreFor(50, 0)).toBe(0);
    expect(scoreFor(4, 96)).toBe(0);
  });
});

describe('Dial — setup', () => {
  it('runs one sub-round per player by default', () => {
    const t = new Table(5);
    t.start('dial');
    expect(t.round.state.total_rounds).toBe(5);
    expect(t.phase).toBe('clue');
  });

  it('honours an explicit round count', () => {
    const t = new Table(5, { dial: { rounds_per_game: 3, clue_seconds: 60, discussion_seconds: 120 } });
    t.start('dial');
    expect(t.round.state.total_rounds).toBe(3);
  });

  it('keeps the target away from the extremes', () => {
    for (let i = 0; i < 50; i++) {
      const t = new Table(4);
      t.start('dial');
      expect(t.round.state.target).toBeGreaterThanOrEqual(4);
      expect(t.round.state.target).toBeLessThanOrEqual(96);
    }
  });

  it('gives the clue-giver and dial-holder to different players', () => {
    const t = new Table(4);
    t.start('dial');
    const p = pub(t, t.playerIds[0]);
    expect(p.clue_giver_id).not.toBe(p.dial_holder_id);
  });
});

describe('Dial — the target reaches one device only (M3 criterion 2)', () => {
  it('is private to the clue-giver through clue and guess', () => {
    const t = new Table(5);
    t.start('dial');
    const clueGiver = pub(t, t.playerIds[0]).clue_giver_id as string;
    const target = t.round.state.target as number;

    const check = (label: string) => {
      for (const p of t.playerIds) {
        const v = t.view(p);
        expect((v.public as any).target, `${label}: public target`).toBeNull();
        if (p === clueGiver) {
          expect((v.me.private as any).target, `${label}: clue-giver`).toBe(target);
        } else {
          expect(v.me.private, `${label}: ${p}`).toEqual({});
        }
      }
    };

    check('clue');
    t.act(clueGiver, 'clue_given', { clue: 'a radiator' });
    expect(t.phase).toBe('guess');
    check('guess');

    t.act(pub(t, t.playerIds[0]).dial_holder_id, 'dial_set', { position: 70, locked: true });
    expect(t.phase).toBe('reveal');
    expect(pub(t, t.playerIds[0]).target).toBe(target);
  });
});

describe('Dial — the clue', () => {
  it('is hidden during the clue phase and public during the guess', () => {
    const t = new Table(4);
    t.start('dial');
    const clueGiver = pub(t, t.playerIds[0]).clue_giver_id as string;
    const other = t.playerIds.find((p) => p !== clueGiver)!;

    expect(pub(t, other).clue).toBeNull();
    t.act(clueGiver, 'clue_given', { clue: 'a radiator' });
    expect(pub(t, other).clue).toBe('a radiator');
  });

  it('only accepts a clue from the clue-giver', () => {
    const t = new Table(4);
    t.start('dial');
    const clueGiver = pub(t, t.playerIds[0]).clue_giver_id as string;
    const other = t.playerIds.find((p) => p !== clueGiver)!;
    expect(() => t.act(other, 'clue_given', { clue: 'cheating' })).toThrow(/not_your_turn/);
  });
});

describe('Dial — the dial', () => {
  it('only moves for the dial-holder', () => {
    const t = new Table(4);
    t.start('dial');
    const p = pub(t, t.playerIds[0]);
    t.act(p.clue_giver_id, 'clue_given', { clue: 'x' });
    const holder = pub(t, t.playerIds[0]).dial_holder_id as string;
    const other = t.playerIds.find((x) => x !== holder)!;
    expect(() => t.act(other, 'dial_set', { position: 40 })).toThrow(/not_your_turn/);
  });

  it('rejects a position outside 0–100', () => {
    const t = new Table(4);
    t.start('dial');
    t.act(pub(t, t.playerIds[0]).clue_giver_id, 'clue_given', { clue: 'x' });
    const holder = pub(t, t.playerIds[0]).dial_holder_id as string;
    expect(() => t.act(holder, 'dial_set', { position: 140 })).toThrow(/invalid_target/);
    expect(() => t.act(holder, 'dial_set', { position: -1 })).toThrow(/invalid_target/);
  });

  it('keeps the last dragged position when the phase times out', () => {
    const t = new Table(4);
    t.start('dial');
    t.act(pub(t, t.playerIds[0]).clue_giver_id, 'clue_given', { clue: 'x' });
    const holder = pub(t, t.playerIds[0]).dial_holder_id as string;
    t.act(holder, 'dial_set', { position: 31 }); // dragged but never locked
    t.timeout();
    expect(t.phase).toBe('reveal');
    expect(pub(t, t.playerIds[0]).guess).toBe(31);
  });

  it('falls back to 50 when the dial never moved', () => {
    const t = new Table(4);
    t.start('dial');
    t.act(pub(t, t.playerIds[0]).clue_giver_id, 'clue_given', { clue: 'x' });
    t.timeout();
    expect(pub(t, t.playerIds[0]).guess).toBe(50);
  });
});

describe('Dial — full game', () => {
  it('runs one sub-round per player and totals the score', () => {
    const t = new Table(4);
    t.start('dial');

    const perRound: number[] = [];
    for (let i = 0; i < 4; i++) {
      expect(t.phase).toBe('clue');
      const target = t.round.state.target as number;
      playSubRound(t, target); // guess dead on, worth 4
      perRound.push(4);
    }

    expect(t.phase).toBe('result');
    expect(t.result.total_score).toBe(16);
    expect(t.result.max_possible).toBe(16);
    expect(t.result.rounds).toHaveLength(4);
    expect(perRound).toEqual([4, 4, 4, 4]);
  });

  it('rotates the clue-giver each sub-round', () => {
    const t = new Table(4);
    t.start('dial');
    const givers: string[] = [];
    for (let i = 0; i < 4; i++) {
      givers.push(pub(t, t.playerIds[0]).clue_giver_id);
      playSubRound(t, 50);
    }
    expect(new Set(givers).size).toBe(4);
  });

  it('submits an empty clue on timeout and keeps going', () => {
    const t = new Table(3);
    t.start('dial');
    t.timeout(); // clue-giver said nothing
    expect(t.phase).toBe('guess');
    expect(pub(t, t.playerIds[0]).clue).toBe('');
  });

  it('awards every player the shared score and no wins', () => {
    const t = new Table(3);
    t.start('dial');
    for (let i = 0; i < 3; i++) playSubRound(t, t.round.state.target as number);

    const stats = t.db.player_stats.filter((s) => s.game_type === 'dial');
    expect(stats).toHaveLength(3);
    for (const s of stats) {
      expect(s.games_played).toBe(1);
      expect(s.games_won).toBe(0);
      expect(s.points).toBe(12);
    }
  });
});

describe('Dial — players leaving (§19.3)', () => {
  it('forfeits the sub-round when the clue-giver leaves', () => {
    const t = new Table(5);
    t.start('dial');
    const clueGiver = pub(t, t.playerIds[0]).clue_giver_id as string;
    t.leave(clueGiver);
    expect(t.phase).toBe('reveal');
    expect(pub(t, t.playerIds.find((p) => p !== clueGiver)!).points).toBe(0);
  });

  it('passes the dial to the next player when the holder leaves', () => {
    const t = new Table(5);
    t.start('dial');
    t.act(pub(t, t.playerIds[0]).clue_giver_id, 'clue_given', { clue: 'x' });
    const holder = pub(t, t.playerIds[0]).dial_holder_id as string;
    const witness = t.playerIds.find((p) => p !== holder)!;

    t.leave(holder);
    const after = pub(t, witness).dial_holder_id as string;
    expect(after).not.toBe(holder);
    expect(t.phase).toBe('guess');
    expect(() => t.act(after, 'dial_set', { position: 60, locked: true })).not.toThrow();
  });

  it('aborts below the minimum', () => {
    const t = new Table(3);
    t.start('dial');
    const clueGiver = pub(t, t.playerIds[0]).clue_giver_id as string;
    t.leave(t.playerIds.find((p) => p !== clueGiver)!);
    expect(t.result.aborted).toBe('too_few_players');
  });
});
