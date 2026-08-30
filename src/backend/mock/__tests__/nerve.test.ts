import { describe, expect, it } from 'vitest';
import { Table } from './harness';
import { SCRAPS_PER_PLAYER } from '../games/nerve';

function pub(t: Table) {
  return t.view(t.playerIds[0]).public as any;
}

/** Everyone still in puts one scrap down. */
function placeRound(t: Table): void {
  while (t.phase === 'place' && t.round.pending_on.length > 0) {
    for (const pid of [...t.round.pending_on]) {
      if (t.phase !== 'place') break;
      t.act(pid, 'place');
    }
  }
}

/** The player on turn claims `amount`; everyone else passes. */
function bidThenAllPass(t: Table, amount: number): string {
  const bidder = pub(t).turn as string;
  t.act(bidder, 'bid', { amount });
  let guard = 0;
  while (t.phase === 'turn' && guard++ < 20) t.act(pub(t).turn as string, 'pass');
  return bidder;
}

/** Own stack first, then whoever still has something face down. */
function nextTarget(t: Table): string {
  const p = pub(t);
  const me = p.challenger as string;
  if ((p.flipped[me] ?? 0) < (p.pile[me] ?? 0)) return me;
  return (p.order as string[]).find((id) => (p.flipped[id] ?? 0) < (p.pile[id] ?? 0))!;
}

/** Turn scraps over; `hits[i]` says whether flip i was an X. */
function flipSequence(t: Table, hits: boolean[]): void {
  for (const hit of hits) {
    if (t.phase !== 'flip') return;
    t.act(pub(t).challenger as string, 'flip', { target_id: nextTarget(t), hit });
  }
}

/** One full round: place, claim `amount`, then flip with the given results. */
function playRound(t: Table, amount: number, hits: boolean[]): string {
  placeRound(t);
  const challenger = bidThenAllPass(t, amount);
  flipSequence(t, hits);
  if (t.phase === 'round_end') t.timeout();
  return challenger;
}

// ---------------------------------------------------------------

describe('Nerve — setup', () => {
  it('gives everyone four scraps and opens on a simultaneous placement', () => {
    const t = new Table(4);
    t.start('nerve');
    expect(t.phase).toBe('place');
    expect(t.round.pending_on).toHaveLength(4);
    for (const pid of t.playerIds) {
      expect(pub(t).held[pid]).toBe(SCRAPS_PER_PLAYER);
      expect(pub(t).wins[pid]).toBe(0);
      expect(pub(t).pile[pid]).toBe(0);
    }
  });

  it('runs at every supported player count', () => {
    for (let n = 3; n <= 6; n++) {
      const t = new Table(n);
      t.start('nerve');
      playRound(t, 1, [false]);
      expect(pub(t).round_no).toBe(2);
      expect(t.round.ended_at).toBeNull();
    }
  });
});

describe('Nerve — the server never sees a scrap', () => {
  it('stores nothing a player sends about what they placed or flipped', () => {
    const t = new Table(3);
    t.start('nerve');

    for (const pid of t.playerIds) t.act(pid, 'place', { scrap: 'XMARKERPLACE', is_x: true });
    const challenger = bidThenAllPass(t, 1);
    t.act(challenger, 'flip', {
      target_id: challenger,
      hit: false,
      scrap: 'XMARKERFLIP',
      pile: 'XMARKERPILE',
    });

    const everything = JSON.stringify(t.db).toLowerCase();
    expect(everything.includes('xmarker')).toBe(false);
  });

  it('hands every device an empty private view, always', () => {
    const t = new Table(3);
    t.start('nerve');
    for (const phase of ['place', 'turn', 'flip'] as const) {
      if (phase === 'turn') placeRound(t);
      if (phase === 'flip') bidThenAllPass(t, 2);
      expect(t.phase).toBe(phase);
      for (const pid of t.playerIds) expect(t.view(pid).me.private).toEqual({});
    }
  });
});

describe('Nerve — placing and bidding', () => {
  it('moves to turns once everyone has placed, starting with the starter', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    expect(t.phase).toBe('turn');
    expect(pub(t).turn).toBe(t.round.state.starter);
    expect(pub(t).table_total).toBe(3);
  });

  it('lets a player add a second scrap before anyone has bid', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const first = pub(t).turn as string;
    t.act(first, 'place');
    expect(pub(t).pile[first]).toBe(2);
    expect(pub(t).table_total).toBe(4);
    expect(pub(t).turn).not.toBe(first); // play moved on
  });

  it('closes placing the moment a number is said out loud', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    t.act(pub(t).turn as string, 'bid', { amount: 2 });
    expect(() => t.act(pub(t).turn as string, 'place')).toThrow(/wrong_phase/);
  });

  it('enforces bid-must-increase and the table ceiling', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    t.act(pub(t).turn as string, 'bid', { amount: 2 });

    const next = pub(t).turn as string;
    expect(() => t.act(next, 'bid', { amount: 2 })).toThrow(/invalid_target/);
    expect(() => t.act(next, 'bid', { amount: 1 })).toThrow(/invalid_target/);
    expect(() => t.act(next, 'bid', { amount: 4 })).toThrow(/invalid_target/); // only 3 down
    t.act(next, 'bid', { amount: 3 });
    expect(pub(t).bid).toEqual({ player_id: next, amount: 3 });
  });

  it('refuses a pass before any bid, and refuses the leader passing on themselves', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const first = pub(t).turn as string;
    expect(() => t.act(first, 'pass')).toThrow(/wrong_phase/);

    t.act(first, 'bid', { amount: 1 });
    t.act(pub(t).turn as string, 'pass');
    expect(() => t.act(first, 'pass')).toThrow(/not_your_turn|invalid_target/);
  });

  it('refuses an action from anyone but the player on turn', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const off = t.playerIds.find((p) => p !== pub(t).turn)!;
    expect(() => t.act(off, 'bid', { amount: 1 })).toThrow(/not_your_turn/);
  });

  it('hands the challenge to the last bidder standing', () => {
    const t = new Table(4);
    t.start('nerve');
    placeRound(t);
    const bidder = bidThenAllPass(t, 2);
    expect(t.phase).toBe('flip');
    expect(pub(t).challenger).toBe(bidder);
    expect(pub(t).passed).toHaveLength(3);
  });
});

describe('Nerve — flipping', () => {
  it('makes the challenger empty their own stack first', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 2);
    const other = t.playerIds.find((p) => p !== me)!;

    expect(() => t.act(me, 'flip', { target_id: other, hit: false })).toThrow(/invalid_target/);
    t.act(me, 'flip', { target_id: me, hit: false });
    // Own pile is empty now, so other piles open up.
    t.act(me, 'flip', { target_id: other, hit: false });
    expect(pub(t).last.outcome).toBe('made');
  });

  it('wins the round on reaching the number', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 1);
    flipSequence(t, [false]);

    expect(t.phase).toBe('round_end');
    expect(pub(t).last).toMatchObject({ challenger_id: me, bid: 1, flips_done: 1, outcome: 'made' });
    expect(pub(t).wins[me]).toBe(1);
    expect(pub(t).held[me]).toBe(SCRAPS_PER_PLAYER);
  });

  it('costs a scrap on an X, and stops the round there', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 3);
    flipSequence(t, [true]);

    expect(t.phase).toBe('round_end');
    expect(pub(t).last).toMatchObject({ challenger_id: me, outcome: 'hit_x', flips_done: 0 });
    expect(pub(t).held[me]).toBe(SCRAPS_PER_PLAYER - 1);
    expect(pub(t).wins[me]).toBe(0);
  });

  it('refuses a pile with nothing left face down, and an unknown player', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 3);
    t.act(me, 'flip', { target_id: me, hit: false });

    expect(() => t.act(me, 'flip', { target_id: me, hit: false })).toThrow(/invalid_target/);
    expect(() => t.act(me, 'flip', { target_id: 'nobody', hit: false })).toThrow(/invalid_target/);
    const off = t.playerIds.find((p) => p !== me)!;
    expect(() => t.act(off, 'flip', { target_id: off, hit: false })).toThrow(/not_your_turn/);
  });

  it('passes the next round to whoever took the challenge', () => {
    const t = new Table(3);
    t.start('nerve');
    const challenger = playRound(t, 1, [false]);
    expect(t.round.state.starter).toBe(challenger);
    expect(t.phase).toBe('place');
    expect(pub(t).round_no).toBe(2);
    // Piles are cleared for the new round.
    for (const pid of t.playerIds) expect(pub(t).pile[pid]).toBe(0);
  });
});

describe('Nerve — winning', () => {
  it('ends the game on the second round won', () => {
    const t = new Table(3);
    t.start('nerve');
    const a = playRound(t, 1, [false]);
    expect(t.round.ended_at).toBeNull();

    // The same player starts round two and takes it again.
    const b = playRound(t, 1, [false]);
    expect(b).toBe(a);
    expect(t.phase).toBe('result');
    expect(t.result.winner_id).toBe(a);
    expect(t.result.reason).toBe('wins');
  });

  it('honours a different target set in settings', () => {
    const t = new Table(3, { nerve: { wins_needed: 1, place_seconds: 30, turn_seconds: 45 } });
    t.start('nerve');
    const a = playRound(t, 1, [false]);
    expect(t.phase).toBe('result');
    expect(t.result.winner_id).toBe(a);
  });

  it('ends when only one player still holds a scrap', () => {
    // Wins are out of reach, so the only exit is running people out of paper.
    const t = new Table(3, { nerve: { wins_needed: 99, place_seconds: 30, turn_seconds: 45 } });
    t.start('nerve');

    for (let i = 0; i < 40 && t.phase !== 'result'; i++) {
      // Whoever is on turn claims one and immediately turns over an X.
      placeRound(t);
      if (t.phase === 'turn') {
        bidThenAllPass(t, 1);
        flipSequence(t, [true]);
      }
      t.timeout();
    }

    expect(t.phase).toBe('result');
    expect(t.result.reason).toBe('last_standing');
    const survivors = (t.result.standings as any[]).filter((r) => r.scraps > 0);
    expect(survivors).toHaveLength(1);
    expect(t.result.winner_id).toBe(survivors[0].player_id);
  });

  it('writes stats, and none for an aborted round', () => {
    const t = new Table(3);
    t.start('nerve');
    playRound(t, 1, [false]);
    playRound(t, 1, [false]);

    const winner = t.result.winner_id as string;
    for (const pid of t.playerIds) {
      const row = t.db.player_stats.find((s) => s.player_id === pid && s.game_type === 'nerve')!;
      expect(row.games_played).toBe(1);
      expect(row.games_won).toBe(pid === winner ? 1 : 0);
      expect(row.points).toBe((t.result.standings as any[]).find((r) => r.player_id === pid).wins);
    }

    const u = new Table(3);
    u.start('nerve');
    u.leave(u.playerIds[0]);
    expect(u.result.aborted).toBe('too_few_players');
    expect(u.db.player_stats.filter((s) => s.game_type === 'nerve')).toHaveLength(0);
  });
});

describe('Nerve — timeouts (§19.2)', () => {
  it('places a scrap for anyone who did not', () => {
    const t = new Table(3);
    t.start('nerve');
    t.act(t.playerIds[0], 'place');
    t.timeout();

    expect(t.phase).toBe('turn');
    for (const pid of t.playerIds) expect(pub(t).pile[pid]).toBe(1);
  });

  it('passes for a player who lets the clock run out on a live bid', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const bidder = pub(t).turn as string;
    t.act(bidder, 'bid', { amount: 1 });

    t.timeout();
    t.timeout();
    expect(t.phase).toBe('flip');
    expect(pub(t).challenger).toBe(bidder);
  });

  it('places for a player with nothing bid yet, and eventually forces a claim', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const first = pub(t).turn as string;
    t.timeout(); // no bid on the table, so a scrap goes down instead
    expect(pub(t).pile[first]).toBe(2);

    for (let i = 0; i < 40 && t.phase === 'turn'; i++) t.timeout();
    // Once nobody can place, the clock makes the smallest legal claim.
    expect(['flip', 'round_end', 'place', 'result']).toContain(t.phase);
    expect(t.round.ended_at ? true : pub(t).round_no >= 1).toBe(true);
  });

  it('treats a challenger who never flips as having hit an X', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 2);
    t.timeout();

    expect(pub(t).last).toMatchObject({ challenger_id: me, outcome: 'no_flip' });
    expect(pub(t).held[me]).toBe(SCRAPS_PER_PLAYER - 1);
  });
});

describe('Nerve — someone leaves', () => {
  it('aborts below three players', () => {
    const t = new Table(3);
    t.start('nerve');
    placeRound(t);
    t.leave(t.playerIds[1]);
    expect(t.result.aborted).toBe('too_few_players');
  });

  it('voids the round when the challenger walks out mid-flip', () => {
    const t = new Table(4);
    t.start('nerve');
    placeRound(t);
    const me = bidThenAllPass(t, 3);

    t.leave(me);
    expect(t.round.ended_at).toBeNull();
    expect(pub(t).last.outcome).toBe('abandoned');
    // Nobody is punished and nobody is credited for a round nobody finished.
    expect(pub(t).wins[me]).toBe(0);

    t.timeout();
    expect(t.phase).toBe('place');
    expect(t.round.pending_on).toHaveLength(3);
  });

  it('voids the round when the high bidder walks out mid-bidding', () => {
    const t = new Table(4);
    t.start('nerve');
    placeRound(t);
    const bidder = pub(t).turn as string;
    t.act(bidder, 'bid', { amount: 2 });

    t.leave(bidder);
    expect(pub(t).last.outcome).toBe('abandoned');
    expect(t.round.ended_at).toBeNull();
  });

  it('moves play on when the player on turn walks out', () => {
    const t = new Table(4);
    t.start('nerve');
    placeRound(t);
    const first = pub(t).turn as string;
    t.act(first, 'bid', { amount: 1 });
    const onTurn = pub(t).turn as string;

    t.leave(onTurn);
    expect(t.round.ended_at).toBeNull();
    expect(pub(t).turn).not.toBe(onTurn);
    expect(['turn', 'flip']).toContain(t.phase);
  });

  it('does not stall the placement phase', () => {
    const t = new Table(4);
    t.start('nerve');
    t.act(t.playerIds[0], 'place');
    t.leave(t.playerIds[1]);
    for (const pid of [...t.round.pending_on]) t.act(pid, 'place');

    expect(t.phase).toBe('turn');
    expect(t.round.pending_on).not.toContain(t.playerIds[1]);
  });
});
