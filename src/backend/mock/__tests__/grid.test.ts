import { describe, expect, it } from 'vitest';
import { Table } from './harness';
import {
  GRID_CELLS,
  LINE_COUNT,
  MAX_SCORE,
  REVEALS,
  buildDeck,
  lineCells,
  lineScore,
  longestRun,
  scoreGrid,
} from '../games/grid';

function pub(t: Table, playerId: string) {
  return t.view(playerId).public as any;
}

function cellsOf(t: Table, playerId: string): (number | null)[] {
  return (t.view(playerId).me.private as any).cells;
}

/** Every player writes the current card into their first empty cell. */
function placeAll(t: Table, chooser?: (pid: string, cells: (number | null)[]) => number): void {
  for (const pid of t.playerIds) {
    if (t.db.players.find((p) => p.id === pid)!.has_left) continue;
    if (t.phase !== 'reveal') return;
    const cells = cellsOf(t, pid);
    const cell = chooser ? chooser(pid, cells) : cells.findIndex((c) => c == null);
    if (cell >= 0) t.act(pid, 'place', { cell });
  }
}

/** Run the 25 reveals, then walk the 10 scoring lines. */
function playToResult(t: Table): void {
  for (let i = 0; i < REVEALS && t.phase === 'reveal'; i++) placeAll(t);
  for (let i = 0; i < LINE_COUNT + 1 && t.phase === 'scoring'; i++) t.timeout();
}

/** Every key name appearing anywhere in a serialised view. */
function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------

describe('Grid — scoring', () => {
  it('scores the longest non-decreasing run', () => {
    expect(longestRun([1, 2, 3, 4, 5])).toBe(5);
    expect(longestRun([1, 1, 1, 1, 1])).toBe(5); // equal counts as non-decreasing
    expect(longestRun([5, 4, 3, 2, 1])).toBe(1);
    expect(longestRun([3, 1, 2, 9, 4])).toBe(3); // 1,2,9
    expect(longestRun([])).toBe(0);
  });

  it('treats a hole as a break, never as a bridge', () => {
    expect(longestRun([1, 2, null, 3, 4])).toBe(2);
    expect(longestRun([null, null, null, null, null])).toBe(0);
    expect(longestRun([null, 1, 2, 3, null])).toBe(3);
  });

  it('pays 1 / 3 / 6 / 10 for runs of 2 / 3 / 4 / 5', () => {
    expect(lineScore([5, 9, 3, 8, 2])).toBe(1); // longest run is 5,9
    expect(lineScore([1, 2, 3, 1, 1])).toBe(3);
    expect(lineScore([1, 2, 3, 4, 1])).toBe(6);
    expect(lineScore([1, 2, 3, 4, 5])).toBe(10);
    expect(lineScore([5, 4, 3, 2, 1])).toBe(0); // a run of 1 is worth nothing
  });

  it('reads rows left-to-right and columns top-to-bottom', () => {
    expect(lineCells(0)).toEqual([0, 1, 2, 3, 4]);
    expect(lineCells(4)).toEqual([20, 21, 22, 23, 24]);
    expect(lineCells(5)).toEqual([0, 5, 10, 15, 20]);
    expect(lineCells(9)).toEqual([4, 9, 14, 19, 24]);
  });

  it('caps a perfect grid at 100 and scores an empty one at 0', () => {
    const ascending = new Array(GRID_CELLS).fill(null).map((_, i) => (i % 5) + 1);
    // Every row is 1..5; every column is a repeated value, also non-decreasing.
    expect(scoreGrid(ascending).total).toBe(MAX_SCORE);
    expect(MAX_SCORE).toBe(100);
    expect(scoreGrid(new Array(GRID_CELLS).fill(null)).total).toBe(0);
    expect(scoreGrid(new Array(GRID_CELLS).fill(null)).lines).toHaveLength(LINE_COUNT);
  });
});

describe('Grid — the deck', () => {
  it('is thirty cards, three of each number', () => {
    for (let i = 0; i < 30; i++) {
      const deck = buildDeck();
      expect(deck).toHaveLength(30);
      for (let n = 1; n <= 10; n++) {
        expect(deck.filter((c) => c === n)).toHaveLength(3);
      }
    }
  });

  it('leaves five cards unseen', () => {
    const t = new Table(3);
    t.start('grid');
    playToResult(t);
    const drawn = pub(t, t.playerIds[0]).drawn as number[];
    expect(drawn).toHaveLength(REVEALS);
    expect(t.round.state.deck).toHaveLength(30);
  });
});

describe('Grid — setup', () => {
  it('deals every player an empty 5x5 and opens on the first card', () => {
    const t = new Table(4);
    t.start('grid');
    expect(t.phase).toBe('reveal');
    for (const pid of t.playerIds) {
      const cells = cellsOf(t, pid);
      expect(cells).toHaveLength(GRID_CELLS);
      expect(cells.every((c) => c == null)).toBe(true);
    }
    expect(pub(t, t.playerIds[0]).current_card).toBeGreaterThanOrEqual(1);
    expect(pub(t, t.playerIds[0]).current_card).toBeLessThanOrEqual(10);
  });

  it('runs at every supported player count', () => {
    for (let n = 1; n <= 12; n++) {
      const t = new Table(n);
      t.start('grid');
      expect(t.phase).toBe('reveal');
      expect(t.round.pending_on).toHaveLength(n);
      playToResult(t);
      expect(t.phase).toBe('result');
      expect(t.result.standings).toHaveLength(n);
    }
  });
});

describe('Grid — secrecy (the undealt deck and other people’s grids)', () => {
  it('never publishes the tail of the deck, at any point', () => {
    const t = new Table(4);
    t.start('grid');

    for (let card = 0; card < REVEALS; card++) {
      const index = t.round.state.index as number;
      const tail = (t.round.state.deck as number[]).slice(index + 1);

      for (const pid of t.playerIds) {
        const v = t.view(pid);
        const wire = JSON.stringify(v);
        // The whole remaining order, verbatim, is the thing that must not leak.
        expect(wire.includes(JSON.stringify(tail))).toBe(false);
        expect(keysDeep(v).has('deck')).toBe(false);
        // And the published prefix is never one card ahead of the screen.
        expect((v.public as any).drawn).toHaveLength((v.public as any).card_number);
      }
      placeAll(t);
    }
  });

  it('keeps every grid on its own device until the game is over', () => {
    const t = new Table(4);
    t.start('grid');

    for (let card = 0; card < REVEALS; card++) {
      for (const pid of t.playerIds) {
        const v = t.view(pid);
        expect((v.public as any).grids).toBeNull();
        expect((v.public as any).scores).toBeNull();
        // The only cells on the wire are this viewer's own.
        expect(JSON.stringify(v.public).includes('cells')).toBe(false);
        expect((v.me.private as any).cells).toHaveLength(GRID_CELLS);
      }
      placeAll(t);
    }

    // Scoring is exactly when they all become public.
    expect(t.phase).toBe('scoring');
    const grids = pub(t, t.playerIds[0]).grids;
    expect(Object.keys(grids)).toHaveLength(4);
  });
});

describe('Grid — placing', () => {
  it('writes the card on screen into the chosen cell', () => {
    const t = new Table(2);
    t.start('grid');
    const card = pub(t, t.playerIds[0]).current_card;
    t.act(t.playerIds[0], 'place', { cell: 12 });
    expect(cellsOf(t, t.playerIds[0])[12]).toBe(card);
    expect(cellsOf(t, t.playerIds[1])[12]).toBeNull();
  });

  it('refuses an occupied cell, an out-of-range cell, and a second placement', () => {
    const t = new Table(2);
    t.start('grid');
    t.act(t.playerIds[0], 'place', { cell: 0 });

    expect(() => t.act(t.playerIds[0], 'place', { cell: 1 })).toThrow(/already_acted/);
    expect(() => t.act(t.playerIds[1], 'place', { cell: 25 })).toThrow(/invalid_target/);
    expect(() => t.act(t.playerIds[1], 'place', { cell: -1 })).toThrow(/invalid_target/);
    expect(() => t.act(t.playerIds[1], 'place', { cell: 1.5 })).not.toThrow(); // truncates to 1

    t.act(t.playerIds[0], 'place', { cell: 3 }); // card 2, a new kind
    expect(() => t.act(t.playerIds[0], 'place', { cell: 3 })).toThrow(/already_acted/);
  });

  it('moves on as soon as everybody has placed, without waiting out the clock', () => {
    const t = new Table(3);
    t.start('grid');
    expect(t.round.state.index).toBe(0);
    placeAll(t);
    expect(t.round.state.index).toBe(1);
    expect(t.phase).toBe('reveal');
  });
});

describe('Grid — timeouts (§19.2)', () => {
  it('leaves a hole for a card nobody placed, and keeps going', () => {
    const t = new Table(2);
    t.start('grid');
    t.timeout(); // nobody places card 1

    expect(t.phase).toBe('reveal');
    expect(t.round.state.index).toBe(1);
    expect(cellsOf(t, t.playerIds[0]).every((c) => c == null)).toBe(true);

    playToResult(t);
    expect(t.phase).toBe('result');
    // Twenty-four cards placed into twenty-five cells: one hole survives.
    const grid = t.result.grids[t.playerIds[0]] as (number | null)[];
    expect(grid.filter((c) => c == null)).toHaveLength(1);
  });

  it('walks all ten lines and then ends', () => {
    const t = new Table(2);
    t.start('grid');
    for (let i = 0; i < REVEALS; i++) placeAll(t);

    expect(t.phase).toBe('scoring');
    for (let line = 0; line < LINE_COUNT; line++) {
      expect(pub(t, t.playerIds[0]).line_index).toBe(line);
      t.timeout();
    }
    expect(t.phase).toBe('result');
  });
});

describe('Grid — results and stats', () => {
  it('ranks by total, shares a tie, and matches the walkthrough', () => {
    const t = new Table(3);
    t.start('grid');
    playToResult(t);

    const st = t.result.standings as { player_id: string; total: number; lines: number[] }[];
    expect(st).toHaveLength(3);
    for (let i = 1; i < st.length; i++) expect(st[i - 1].total).toBeGreaterThanOrEqual(st[i].total);

    for (const row of st) {
      expect(row.lines).toHaveLength(LINE_COUNT);
      expect(row.lines.reduce((a, b) => a + b, 0)).toBe(row.total);
      expect(row.total).toBeLessThanOrEqual(MAX_SCORE);
      // The end-of-game numbers are the ones the walkthrough showed.
      expect(scoreGrid(t.result.grids[row.player_id]).total).toBe(row.total);
    }

    const best = st[0].total;
    expect(t.result.winners).toEqual(st.filter((r) => r.total === best).map((r) => r.player_id));
    expect((t.result.winners as string[]).length).toBeGreaterThanOrEqual(1);
  });

  it('writes one played row per player and a win for each winner', () => {
    const t = new Table(3);
    t.start('grid');
    playToResult(t);

    const winners = new Set(t.result.winners as string[]);
    for (const pid of t.playerIds) {
      const row = t.db.player_stats.find((s) => s.player_id === pid && s.game_type === 'grid')!;
      expect(row.games_played).toBe(1);
      expect(row.games_won).toBe(winners.has(pid) ? 1 : 0);
      expect(row.points).toBe(
        (t.result.standings as any[]).find((r) => r.player_id === pid).total,
      );
    }
  });

  it('writes no stats for an aborted round', () => {
    const t = new Table(2);
    t.start('grid');
    placeAll(t);
    t.leave(t.playerIds[0]);
    t.leave(t.playerIds[1]);

    expect(t.result.aborted).toBe('too_few_players');
    expect(t.db.player_stats.filter((s) => s.game_type === 'grid')).toHaveLength(0);
    expect(t.db.games_history).toHaveLength(1);
  });
});

describe('Grid — someone leaves', () => {
  it('lets the rest carry on from any phase', () => {
    for (const leaveAfter of [0, 5, 24]) {
      const t = new Table(4);
      t.start('grid');
      for (let i = 0; i < leaveAfter; i++) placeAll(t);

      t.leave(t.playerIds[2]);
      expect(t.round.ended_at).toBeNull();
      expect(t.round.pending_on).not.toContain(t.playerIds[2]);

      playToResult(t);
      expect(t.phase).toBe('result');
      // They are off the podium, and out of the stats.
      const ids = (t.result.standings as any[]).map((r) => r.player_id);
      expect(ids).not.toContain(t.playerIds[2]);
      expect(ids).toHaveLength(3);
    }
  });

  it('survives a departure during the scoring walkthrough', () => {
    const t = new Table(3);
    t.start('grid');
    for (let i = 0; i < REVEALS; i++) placeAll(t);
    expect(t.phase).toBe('scoring');

    t.leave(t.playerIds[1]);
    for (let i = 0; i < LINE_COUNT + 1 && t.phase === 'scoring'; i++) t.timeout();
    expect(t.phase).toBe('result');
    expect(t.result.standings).toHaveLength(2);
  });
});
