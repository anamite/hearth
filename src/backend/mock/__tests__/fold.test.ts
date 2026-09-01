import { describe, expect, it } from 'vitest';
import { Table } from './harness';
import { CARD_MAX, MODIFIER_TEXT, TARGETS } from '../games/fold';
import type { Modifier } from '../games/fold';

function pub(t: Table, playerId = t.playerIds[0]) {
  return t.view(playerId).public as any;
}

/** Everyone taps "dealt" so the round gets to its first turn. */
function readyUp(t: Table): void {
  for (const pid of t.playerIds) {
    if (t.db.players.find((p) => p.id === pid)!.has_left) continue;
    if (t.phase !== 'deal') return;
    t.act(pid, 'ready');
  }
}

function current(t: Table): string | null {
  return pub(t).current_player_id ?? null;
}

/** Force the round into a known shape: one target, one modifier, zero total. */
function rig(t: Table, target: number, modifier: Modifier = 'none'): void {
  t.round.state.target = target;
  t.round.state.modifier = modifier;
  t.round.state.total = 0;
  t.round.state.log = [];
  t.round.state.first_card = false;
  t.round.state.blind_lifted = false;
}

/** Play the round out with everyone folding except `hero`. */
function foldToOne(t: Table, hero: string): void {
  let guard = 0;
  while (t.phase === 'turn' && guard++ < 60) {
    const pid = current(t);
    if (!pid) break;
    if (pid === hero) t.act(pid, 'play', { value: 1 });
    else t.act(pid, 'fold');
  }
}

function start(players: number, settings?: Record<string, unknown>) {
  const t = new Table(players, { fold: { modifiers: false, ...(settings ?? {}) } as any });
  t.start('fold');
  return t;
}

// ---------------------------------------------------------------

describe('Fold — setup', () => {
  it('deals every present player the same hand and opens on a real target', () => {
    const t = start(5, { hand_size: 5 });
    expect(t.phase).toBe('deal');
    const p = pub(t);
    expect(TARGETS).toContain(p.target);
    expect(Object.values(p.cards)).toEqual([5, 5, 5, 5, 5]);
    expect(p.round_number).toBe(1);
  });

  it('seats everyone exactly once, at every supported count', () => {
    for (let n = 2; n <= 8; n++) {
      const t = start(n);
      const order = pub(t).order as string[];
      expect(new Set(order).size).toBe(n);
      expect(order.sort()).toEqual([...t.playerIds].sort());
      expect(Object.values(pub(t).status)).toEqual(Array(n).fill('in'));
    }
  });

  it('describes whatever modifier it rolled', () => {
    for (let i = 0; i < 30; i++) {
      const t = new Table(4);
      t.start('fold');
      const p = pub(t);
      expect(MODIFIER_TEXT[p.modifier as Modifier]).toBe(p.modifier_text);
    }
  });
});

describe('Fold — the running total', () => {
  it('adds a card and hands the turn on', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 30);
    const first = current(t)!;
    t.act(first, 'play', { value: 7 });
    expect(pub(t).total).toBe(7);
    expect(current(t)).not.toBe(first);
    expect(pub(t).hand[first]).toBe(4);
  });

  it('busts anyone who goes over, and takes a card off them for good', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 10);
    const first = current(t)!;
    t.act(first, 'play', { value: 11 });
    expect(pub(t).status[first]).toBe('busted');
    expect(pub(t).cards[first]).toBe(4);
  });

  it('treats landing exactly on the target as safe', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 9);
    const first = current(t)!;
    t.act(first, 'play', { value: 9 });
    expect(pub(t).status[first]).toBe('in');
  });

  it('doubles the first card only, under double_first', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 40, 'double_first');
    const a = current(t)!;
    t.act(a, 'play', { value: 6 });
    expect(pub(t).total).toBe(12);
    const b = current(t)!;
    t.act(b, 'play', { value: 6 });
    expect(pub(t).total).toBe(18);
  });

  it('subtracts a heart under hearts_negative, and only then', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 30, 'hearts_negative');
    t.act(current(t)!, 'play', { value: 8, hearts: true });
    expect(pub(t).total).toBe(-8);

    const u = start(4);
    readyUp(u);
    rig(u, 30, 'none');
    u.act(current(u)!, 'play', { value: 8, hearts: true });
    expect(pub(u).total).toBe(8);
  });

  it('pays two for hitting the target exactly under exact_bonus', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 5, 'exact_bonus');
    const a = current(t)!;
    t.act(a, 'play', { value: 5 });
    expect(pub(t).scores[a]).toBe(2);
  });
});

describe('Fold — secrecy', () => {
  it('hides the total and every card value while blind, from everyone', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 30, 'blind');
    t.act(current(t)!, 'play', { value: 7 });

    for (const pid of t.playerIds) {
      const p = pub(t, pid);
      expect(p.blind).toBe(true);
      expect(p.total).toBeNull();
      for (const entry of p.log) expect(entry.value).toBeNull();
      // Nothing anywhere in the payload adds back up to the total.
      expect(JSON.stringify(t.view(pid).public)).not.toContain('"total":7');
    }
  });

  it('lifts the blind the moment somebody folds', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 30, 'blind');
    t.act(current(t)!, 'play', { value: 7 });
    t.act(current(t)!, 'fold');
    expect(pub(t).total).toBe(7);
    expect(pub(t).blind).toBe(false);
  });
});

describe('Fold — scoring a round', () => {
  it('pays the last player standing one for every card still in hand', () => {
    const t = start(4, { rounds_per_game: 2, hand_size: 5 });
    readyUp(t);
    rig(t, 40);
    const hero = current(t)!;
    foldToOne(t, hero);

    expect(t.phase).toBe('tally');
    const last = pub(t).last;
    expect(last.survivor_id).toBe(hero);
    // One card went into the pile, four are still in hand.
    expect(last.gained).toBe(4);
    expect(pub(t).scores[hero]).toBe(4);
  });

  it('ends the round the instant only one player is left', () => {
    const t = start(2, { rounds_per_game: 1 });
    readyUp(t);
    rig(t, 12);
    const a = current(t)!;
    t.act(a, 'fold');
    // The other player is now alone, so it is over before they play.
    expect(t.phase).toBe('tally');
    expect(pub(t).last.survivor_id).not.toBe(a);
  });

  it('runs the configured number of rounds and then ends', () => {
    const t = start(3, { rounds_per_game: 3 });
    for (let r = 1; r <= 3; r++) {
      expect(t.phase).toBe('deal');
      expect(pub(t).round_number).toBe(r);
      readyUp(t);
      rig(t, 40);
      foldToOne(t, current(t)!);
      expect(t.phase).toBe('tally');
      t.timeout();
    }
    expect(t.phase).toBe('result');
    expect(t.result.standings).toHaveLength(3);
  });

  it('declares a dead heat when two players take a round each', () => {
    const t = start(2, { rounds_per_game: 2, hand_size: 3 });
    // The lead moves a seat every round, so whoever folds first alternates
    // and both players walk off with one untouched hand apiece.
    for (let r = 0; r < 2; r++) {
      readyUp(t);
      rig(t, 40);
      t.act(current(t)!, 'fold');
      expect(t.phase).toBe('tally');
      t.timeout();
    }
    expect(t.phase).toBe('result');
    expect(t.result.best_score).toBe(3);
    expect(t.result.winners).toHaveLength(2);
  });
});

describe('Fold — validation', () => {
  it('refuses a card from anyone but the player on turn', () => {
    const t = start(4);
    readyUp(t);
    const other = t.playerIds.find((p) => p !== current(t))!;
    expect(() => t.act(other, 'play', { value: 5 })).toThrow(/not_your_turn/);
  });

  it('refuses a value no single card can be worth', () => {
    const t = start(4);
    readyUp(t);
    const me = current(t)!;
    expect(() => t.act(me, 'play', { value: 0 })).toThrow(/invalid_target/);
    expect(() => t.act(me, 'play', { value: CARD_MAX + 1 })).toThrow(/invalid_target/);
  });

  it('refuses an action from the wrong phase', () => {
    const t = start(4);
    expect(() => t.act(t.playerIds[0], 'play', { value: 3 })).toThrow(/wrong_phase/);
  });
});

describe('Fold — timeouts', () => {
  it('starts the turns anyway when nobody says they are dealt', () => {
    const t = start(4);
    t.timeout();
    expect(t.phase).toBe('turn');
    expect(current(t)).not.toBeNull();
  });

  it('folds a player who runs out the clock', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 40);
    const dawdler = current(t)!;
    t.timeout();
    expect(pub(t).status[dawdler]).toBe('folded');
  });

  it('rolls the tally into the next deal', () => {
    const t = start(3, { rounds_per_game: 2 });
    readyUp(t);
    rig(t, 40);
    foldToOne(t, current(t)!);
    expect(t.phase).toBe('tally');
    t.timeout();
    expect(t.phase).toBe('deal');
    expect(pub(t).round_number).toBe(2);
  });

  it('never stalls, whatever the phase, if everyone stops answering', () => {
    const t = start(5, { rounds_per_game: 3 });
    let guard = 0;
    while (t.phase !== 'result' && guard++ < 400) t.timeout();
    expect(t.phase).toBe('result');
  });
});

describe('Fold — someone leaves', () => {
  it('folds them and moves the turn on when it was theirs', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 40);
    const gone = current(t)!;
    t.leave(gone);
    expect(pub(t).status[gone]).toBe('folded');
    expect(current(t)).not.toBe(gone);
    expect(t.phase).not.toBe('result');
  });

  it('folds them without disturbing anything when it was not their turn', () => {
    const t = start(4);
    readyUp(t);
    rig(t, 40);
    const onTurn = current(t)!;
    const gone = t.playerIds.find((p) => p !== onTurn)!;
    t.leave(gone);
    expect(current(t)).toBe(onTurn);
    expect(pub(t).status[gone]).toBe('folded');
  });

  it('aborts once there is nobody left to play against', () => {
    const t = start(2);
    readyUp(t);
    t.leave(t.playerIds[0]);
    expect(t.phase).toBe('result');
    expect(t.result.aborted).toBe('too_few_players');
  });

  it('survives a departure in the deal phase', () => {
    const t = start(3);
    t.leave(t.playerIds[1]);
    expect(t.phase).toBe('deal');
    t.timeout();
    expect(t.phase).toBe('turn');
  });
});

describe('Fold — stats', () => {
  it('writes one played row per player and marks the winner', () => {
    const t = start(3, { rounds_per_game: 1 });
    readyUp(t);
    rig(t, 40);
    const hero = current(t)!;
    foldToOne(t, hero);
    t.timeout();
    expect(t.phase).toBe('result');

    const rows = t.db.player_stats.filter((s) => s.game_type === 'fold');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.games_played === 1)).toBe(true);
    expect(rows.find((r) => r.player_id === hero)!.games_won).toBe(1);
    expect(rows.find((r) => r.player_id === hero)!.points).toBeGreaterThan(0);
  });

  it('writes none for an aborted round', () => {
    const t = start(2);
    t.leave(t.playerIds[0]);
    expect(t.db.player_stats.filter((s) => s.game_type === 'fold')).toHaveLength(0);
  });
});
