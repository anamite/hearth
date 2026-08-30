import { describe, expect, it } from 'vitest';
import type { RoundView } from '@/types';
import { Table } from './harness';
import { PRIZE_COUNT, PRIZE_VALUES, SLIP_MAX, buildPrizes, resolveBids } from '../games/bid';

function pub(t: Table, playerId: string) {
  return t.view(playerId).public as any;
}

function remaining(t: Table, playerId: string): number[] {
  return (t.view(playerId).me.private as any).remaining;
}

/** Everyone bids, then the reveal is stepped past. */
function playPrize(t: Table, pick: (pid: string, left: number[], prize: number) => number): void {
  const prize = pub(t, t.playerIds[0]).prize as number;
  for (const pid of t.playerIds) {
    if (t.db.players.find((p) => p.id === pid)!.has_left) continue;
    if (t.phase !== 'bid') return;
    t.act(pid, 'bid', { slip: pick(pid, remaining(t, pid), prize) });
  }
  if (t.phase === 'reveal') t.timeout();
}

/** A default that keeps bids distinct so prizes actually get taken. */
function spread(t: Table) {
  return (pid: string, left: number[]) => left[Math.min(t.playerIds.indexOf(pid), left.length - 1)];
}

function playAll(t: Table): void {
  for (let i = 0; i < PRIZE_COUNT && t.phase !== 'result'; i++) playPrize(t, spread(t));
}

/** Everything a bid phase is allowed to change in someone else's view. */
function redact(v: RoundView): string {
  return JSON.stringify({
    ...v,
    server_time: '',
    pending_on: [],
    players: v.players.map((p) => ({ ...p, has_acted: false })),
  });
}

// ---------------------------------------------------------------

describe('Bid — resolution', () => {
  it('gives a positive prize to the highest bid', () => {
    expect(resolveBids(10, { a: 15, b: 4, c: 1 })).toEqual({ winner_id: 'a', cancelled: [] });
  });

  it('cancels a tied high bid and falls through to the next value', () => {
    // Both 15s burn, and a 4 walks off with the +10.
    expect(resolveBids(10, { a: 15, b: 15, c: 4 })).toEqual({ winner_id: 'c', cancelled: [15] });
  });

  it('falls through more than once', () => {
    expect(resolveBids(10, { a: 15, b: 15, c: 9, d: 9, e: 2 })).toEqual({
      winner_id: 'e',
      cancelled: [15, 9],
    });
  });

  it('gives nobody the prize when every value is contested', () => {
    expect(resolveBids(10, { a: 7, b: 7, c: 3, d: 3 })).toEqual({
      winner_id: null,
      cancelled: [7, 3],
    });
  });

  it('reverses for a negative prize — the lowest bid is stuck with it', () => {
    expect(resolveBids(-5, { a: 1, b: 8, c: 15 })).toEqual({ winner_id: 'a', cancelled: [] });
    expect(resolveBids(-5, { a: 1, b: 1, c: 8 })).toEqual({ winner_id: 'c', cancelled: [1] });
  });

  it('handles a single bidder and an empty table', () => {
    expect(resolveBids(6, { a: 3 })).toEqual({ winner_id: 'a', cancelled: [] });
    expect(resolveBids(6, {})).toEqual({ winner_id: null, cancelled: [] });
  });
});

describe('Bid — the prize deck', () => {
  it('is fifteen prizes from -5 to +10, one of each', () => {
    for (let i = 0; i < 30; i++) {
      const prizes = buildPrizes();
      expect(prizes).toHaveLength(PRIZE_COUNT);
      expect([...prizes].sort((a, b) => a - b)).toEqual([...PRIZE_VALUES].sort((a, b) => a - b));
    }
    expect(Math.min(...PRIZE_VALUES)).toBe(-5);
    expect(Math.max(...PRIZE_VALUES)).toBe(10);
  });
});

describe('Bid — setup', () => {
  it('hands everyone fifteen slips and opens on a prize', () => {
    const t = new Table(4);
    t.start('bid');
    expect(t.phase).toBe('bid');
    for (const pid of t.playerIds) {
      expect(remaining(t, pid)).toHaveLength(SLIP_MAX);
      expect(pub(t, pid).spent[pid]).toEqual([]);
    }
    expect(PRIZE_VALUES).toContain(pub(t, t.playerIds[0]).prize);
  });

  it('runs at every supported player count', () => {
    for (let n = 2; n <= 8; n++) {
      const t = new Table(n);
      t.start('bid');
      playAll(t);
      expect(t.phase).toBe('result');
      expect(t.result.standings).toHaveLength(n);
      expect(t.result.history).toHaveLength(PRIZE_COUNT);
    }
  });
});

describe('Bid — secrecy of a face-down slip', () => {
  it('changes nothing in anybody else’s view when a slip goes down', () => {
    const t = new Table(4);
    t.start('bid');
    const [a, b] = t.playerIds;

    const before = redact(t.view(b));
    t.act(a, 'bid', { slip: 13 });
    expect(redact(t.view(b))).toBe(before);

    // Changing your mind is equally invisible.
    t.act(a, 'bid', { slip: 2 });
    expect(redact(t.view(b))).toBe(before);
  });

  it('publishes no bids at all until the reveal', () => {
    const t = new Table(3);
    t.start('bid');
    for (const pid of t.playerIds) t.act(pid, 'bid', { slip: 5 + t.playerIds.indexOf(pid) });

    // Everyone has acted, so the phase has already flipped to reveal.
    expect(t.phase).toBe('reveal');
    expect(Object.keys(pub(t, t.playerIds[0]).bids)).toHaveLength(3);

    t.timeout();
    expect(t.phase).toBe('bid');
    expect(pub(t, t.playerIds[0]).bids).toBeNull();
  });

  it('shows a player only their own slip', () => {
    const t = new Table(3);
    t.start('bid');
    t.act(t.playerIds[0], 'bid', { slip: 9 });
    expect((t.view(t.playerIds[0]).me.private as any).slip).toBe(9);
    expect((t.view(t.playerIds[1]).me.private as any).slip).toBeNull();
  });
});

describe('Bid — burning slips', () => {
  it('burns every slip played, including the ones that cancelled', () => {
    const t = new Table(3);
    t.start('bid');
    const [a, b, c] = t.playerIds;
    t.act(a, 'bid', { slip: 15 });
    t.act(b, 'bid', { slip: 15 });
    t.act(c, 'bid', { slip: 4 });
    t.timeout();

    const spent = pub(t, a).spent;
    expect(spent[a]).toEqual([15]);
    expect(spent[b]).toEqual([15]);
    expect(spent[c]).toEqual([4]);
    expect(remaining(t, a)).not.toContain(15);
  });

  it('refuses a burned slip and an out-of-range one', () => {
    const t = new Table(2);
    t.start('bid');
    const [a, b] = t.playerIds;
    t.act(a, 'bid', { slip: 15 });
    t.act(b, 'bid', { slip: 1 });
    t.timeout();

    expect(() => t.act(a, 'bid', { slip: 15 })).toThrow(/invalid_target/);
    expect(() => t.act(a, 'bid', { slip: 0 })).toThrow(/invalid_target/);
    expect(() => t.act(a, 'bid', { slip: 16 })).toThrow(/invalid_target/);
  });

  it('makes the burn table public to everyone', () => {
    const t = new Table(3);
    t.start('bid');
    playPrize(t, spread(t));
    for (const pid of t.playerIds) {
      const spent = pub(t, pid).spent;
      expect(Object.keys(spent)).toHaveLength(3);
      for (const other of t.playerIds) expect(spent[other]).toHaveLength(1);
    }
  });
});

describe('Bid — timeouts (§19.2)', () => {
  it('plays the lowest remaining slip for anyone who did not choose', () => {
    const t = new Table(3);
    t.start('bid');
    const [a, b, c] = t.playerIds;
    t.act(a, 'bid', { slip: 12 });
    t.timeout(); // b and c never chose

    const last = pub(t, a).last;
    expect(last.bids[a]).toBe(12);
    expect(last.bids[b]).toBe(1);
    expect(last.bids[c]).toBe(1);
    // Two 1s settle nothing whichever way the prize points, so the 12
    // resolves it: highest bid on a reward, stuck with it on a penalty.
    expect(last.winner_id).toBe(a);
    if (last.prize < 0) expect(last.cancelled).toContain(1);
    else expect(last.cancelled).toEqual([]);
  });

  it('reaches a result on a table where nobody ever acts', () => {
    const t = new Table(3);
    t.start('bid');
    for (let i = 0; i < PRIZE_COUNT * 2 + 4 && t.phase !== 'result'; i++) t.timeout();
    expect(t.phase).toBe('result');
    expect(t.result.history).toHaveLength(PRIZE_COUNT);
  });
});

describe('Bid — the whole game', () => {
  it('spends exactly one slip per prize and ends after fifteen', () => {
    const t = new Table(4);
    t.start('bid');
    playAll(t);

    expect(t.result.history).toHaveLength(PRIZE_COUNT);
    for (const pid of t.playerIds) {
      const spent = (t.result.standings as any[]).length ? pub(t, pid).spent[pid] : [];
      expect(spent).toHaveLength(SLIP_MAX);
      expect([...new Set(spent)]).toHaveLength(SLIP_MAX); // all fifteen, no repeats
    }
  });

  it('totals each player’s prizes and ranks them', () => {
    const t = new Table(3);
    t.start('bid');
    playAll(t);

    const st = t.result.standings as { player_id: string; score: number; prizes: number[] }[];
    for (let i = 1; i < st.length; i++) expect(st[i - 1].score).toBeGreaterThanOrEqual(st[i].score);
    for (const row of st) {
      expect(row.prizes.reduce((a, b) => a + b, 0)).toBe(row.score);
    }
    // Every prize that was taken went to exactly one player.
    const taken = (t.result.history as any[]).filter((h) => h.winner_id);
    expect(st.reduce((n, r) => n + r.prizes.length, 0)).toBe(taken.length);

    const best = st[0].score;
    expect(t.result.winners).toEqual(st.filter((r) => r.score === best).map((r) => r.player_id));
  });

  it('shares the win when two players tie', () => {
    // Both play identically, so both end on the same score.
    const t = new Table(2);
    t.start('bid');
    for (let i = 0; i < PRIZE_COUNT && t.phase !== 'result'; i++) {
      playPrize(t, (_pid, left) => left[0]);
    }
    const st = t.result.standings as { player_id: string; score: number }[];
    expect(st[0].score).toBe(st[1].score);
    expect(t.result.winners).toHaveLength(2);
  });

  it('writes stats, and none for an aborted round', () => {
    const t = new Table(3);
    t.start('bid');
    playAll(t);

    const winners = new Set(t.result.winners as string[]);
    for (const pid of t.playerIds) {
      const row = t.db.player_stats.find((s) => s.player_id === pid && s.game_type === 'bid')!;
      expect(row.games_played).toBe(1);
      expect(row.games_won).toBe(winners.has(pid) ? 1 : 0);
      expect(row.points).toBe(
        (t.result.standings as any[]).find((r) => r.player_id === pid).score,
      );
    }

    const u = new Table(2);
    u.start('bid');
    u.leave(u.playerIds[0]);
    expect(u.result.aborted).toBe('too_few_players');
    expect(u.db.player_stats.filter((s) => s.game_type === 'bid')).toHaveLength(0);
  });
});

describe('Bid — someone leaves', () => {
  it('aborts once fewer than two remain', () => {
    for (const phase of ['bid', 'reveal'] as const) {
      const t = new Table(2);
      t.start('bid');
      if (phase === 'reveal') {
        t.act(t.playerIds[0], 'bid', { slip: 3 });
        t.act(t.playerIds[1], 'bid', { slip: 4 });
      }
      t.leave(t.playerIds[1]);
      expect(t.result.aborted).toBe('too_few_players');
    }
  });

  it('carries on with three, and keeps the leaver’s burned slips on the table', () => {
    const t = new Table(3);
    t.start('bid');
    playPrize(t, spread(t));
    const burned = pub(t, t.playerIds[0]).spent[t.playerIds[2]];
    expect(burned).toHaveLength(1);

    t.leave(t.playerIds[2]);
    expect(t.round.ended_at).toBeNull();
    expect(pub(t, t.playerIds[0]).spent[t.playerIds[2]]).toEqual(burned);

    for (let i = 0; i < PRIZE_COUNT * 2 && t.phase !== 'result'; i++) t.timeout();
    expect(t.phase).toBe('result');
    // They are off the podium; the two who stayed are on it.
    expect((t.result.standings as any[]).map((r) => r.player_id)).not.toContain(t.playerIds[2]);
    expect(t.result.standings).toHaveLength(2);
  });
});
