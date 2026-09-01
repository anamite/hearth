import { describe, expect, it } from 'vitest';
import { Table, viewContains } from './harness';
import { SCORING_TEXT } from '../games/season';
import type { Scoring } from '../games/season';

function pub(t: Table, playerId = t.playerIds[0]) {
  return t.view(playerId).public as any;
}

/** Everyone taps "read it" so the season gets to its first trick. */
function readyUp(t: Table): void {
  for (const pid of t.playerIds) {
    if (t.db.players.find((p) => p.id === pid)!.has_left) continue;
    if (t.phase !== 'season') return;
    t.act(pid, 'ready');
  }
}

function start(players: number, settings?: Record<string, unknown>) {
  const t = new Table(players, {
    season: { secret_seasons: false, ...(settings ?? {}) } as any,
  });
  t.start('season');
  return t;
}

/** Claim every trick of the current season for `winner`. */
function sweepSeason(t: Table, winner: string): void {
  readyUp(t);
  const tricks = pub(t).tricks_total as number;
  const season = pub(t).season_number as number;
  for (let i = 0; i < tricks; i++) {
    if (t.phase !== 'trick' || pub(t).season_number !== season) return;
    t.act(winner, 'took', { player_id: winner });
  }
}

// ---------------------------------------------------------------

describe('Season — setup', () => {
  it('opens on a season announcement with a rule drawn from the bank', () => {
    const t = start(4);
    expect(t.phase).toBe('season');
    const p = pub(t);
    expect(p.season_number).toBe(1);
    expect(typeof p.rule).toBe('string');
    expect(p.rule.length).toBeGreaterThan(5);
    expect(SCORING_TEXT[p.scoring as Scoring]).toBe(p.scoring_text);
  });

  it('seats everyone exactly once, at every supported count', () => {
    for (let n = 3; n <= 6; n++) {
      const t = start(n);
      const seats = t.db.round_players
        .filter((rp) => rp.round_id === t.round.id)
        .map((rp) => rp.turn_index);
      expect(new Set(seats).size).toBe(n);
      expect(pub(t).season_tricks).toEqual(
        Object.fromEntries(t.playerIds.map((p) => [p, 0])),
      );
    }
  });

  it('never opens the game on a hidden season', () => {
    for (let i = 0; i < 25; i++) {
      const t = new Table(5);
      t.start('season');
      expect(pub(t).secret).toBe(false);
    }
  });
});

describe('Season — tricks', () => {
  it('banks a trick to whoever is named and moves on', () => {
    const t = start(4);
    readyUp(t);
    expect(t.phase).toBe('trick');
    const hero = t.playerIds[1];
    t.act(t.playerIds[0], 'took', { player_id: hero });
    expect(pub(t).season_tricks[hero]).toBe(1);
    expect(pub(t).trick_number).toBe(2);
  });

  it('undoes the last claim when the table says it was wrong', () => {
    const t = start(4);
    readyUp(t);
    const wrong = t.playerIds[1];
    t.act(t.playerIds[0], 'took', { player_id: wrong });
    t.act(t.playerIds[2], 'undo');
    expect(pub(t).season_tricks[wrong]).toBe(0);
    expect(pub(t).trick_number).toBe(1);
  });

  it('refuses a second undo, and an undo with nothing behind it', () => {
    const t = start(4);
    readyUp(t);
    expect(() => t.act(t.playerIds[0], 'undo')).toThrow(/wrong_phase/);
    t.act(t.playerIds[0], 'took', { player_id: t.playerIds[1] });
    t.act(t.playerIds[0], 'undo');
    expect(() => t.act(t.playerIds[0], 'undo')).toThrow(/wrong_phase/);
  });

  it('refuses a trick claimed for somebody who is not at the table', () => {
    const t = start(4);
    readyUp(t);
    expect(() => t.act(t.playerIds[0], 'took', { player_id: 'nobody' })).toThrow(
      /invalid_target/,
    );
  });

  it('turns the weather over after the last trick of a season', () => {
    const t = start(4, { tricks_per_season: 3, seasons_per_game: 3 });
    const first = pub(t).rule;
    sweepSeason(t, t.playerIds[0]);
    expect(t.phase).toBe('season');
    expect(pub(t).season_number).toBe(2);
    expect(pub(t).history).toHaveLength(1);
    expect(pub(t).history[0].rule).toBe(first);
  });
});

describe('Season — scoring', () => {
  it('pays one a trick under a normal season', () => {
    const t = start(4, { tricks_per_season: 4, seasons_per_game: 2 });
    t.round.state.scoring = 'normal';
    const hero = t.playerIds[2];
    sweepSeason(t, hero);
    expect(pub(t).scores[hero]).toBe(4);
  });

  it('pays double under a double season', () => {
    const t = start(4, { tricks_per_season: 3, seasons_per_game: 2 });
    t.round.state.scoring = 'double';
    const hero = t.playerIds[1];
    sweepSeason(t, hero);
    expect(pub(t).scores[hero]).toBe(6);
  });

  it('pays nothing at all under a void season — the tricks were for nothing', () => {
    const t = start(4, { tricks_per_season: 3, seasons_per_game: 2 });
    t.round.state.scoring = 'void';
    const hero = t.playerIds[1];
    sweepSeason(t, hero);
    expect(pub(t).scores[hero]).toBe(0);
    // The tricks still happened; only what they were worth changed.
    expect(pub(t).total_tricks[hero]).toBe(3);
  });

  it('ends after the last season and ranks everyone', () => {
    const t = start(4, { tricks_per_season: 2, seasons_per_game: 3 });
    for (let s = 0; s < 3; s++) {
      t.round.state.scoring = 'normal';
      sweepSeason(t, t.playerIds[0]);
    }
    expect(t.phase).toBe('result');
    expect(t.result.standings).toHaveLength(4);
    expect(t.result.winners).toEqual([t.playerIds[0]]);
    expect(t.result.best_score).toBe(6);
  });

  it('declares a dead heat when nobody takes a trick', () => {
    const t = start(4, { tricks_per_season: 2, seasons_per_game: 2, trick_seconds: 30 });
    let guard = 0;
    while (t.phase !== 'result' && guard++ < 40) t.timeout();
    expect(t.phase).toBe('result');
    expect(t.result.best_score).toBe(0);
    expect(t.result.winners).toHaveLength(4);
  });
});

describe('Season — the hidden season', () => {
  /** Force this season hidden and hand it to one named player. */
  function hide(t: Table, keeper: string): void {
    t.round.state.secret_to = keeper;
    t.round.state.rule = 'Lowest card wins the trick.';
    t.round.state.scoring = 'void';
  }

  it('sends the rule to the keeper and to nobody else, at every phase', () => {
    for (let i = 0; i < 25; i++) {
      const t = start(5, { tricks_per_season: 2, seasons_per_game: 2 });
      const keeper = t.playerIds[i % 5];
      hide(t, keeper);

      for (const phase of ['season', 'trick'] as const) {
        expect(t.phase).toBe(phase);
        for (const pid of t.playerIds) {
          const v = t.view(pid);
          if (pid === keeper) {
            expect((v.me.private as any).rule).toBe('Lowest card wins the trick.');
          } else {
            expect(viewContains(v, 'Lowest card wins the trick')).toBe(false);
            expect((v.public as any).rule).toBeNull();
            expect((v.public as any).scoring).toBeNull();
            expect(v.me.private).toEqual({});
          }
        }
        if (phase === 'season') readyUp(t);
      }
    }
  });

  it('says who is holding it, so the table knows whom to watch', () => {
    const t = start(5);
    hide(t, t.playerIds[3]);
    expect(pub(t).secret).toBe(true);
    expect(pub(t).secret_to).toBe(t.playerIds[3]);
  });

  it('publishes the rule once the season is over', () => {
    const t = start(4, { tricks_per_season: 2, seasons_per_game: 2 });
    hide(t, t.playerIds[0]);
    sweepSeason(t, t.playerIds[0]);
    expect(pub(t).history[0].rule).toBe('Lowest card wins the trick.');
    expect(pub(t).history[0].secret_to).toBe(t.playerIds[0]);
  });

  it('publishes it early if the keeper walks out', () => {
    const t = start(5);
    hide(t, t.playerIds[2]);
    t.leave(t.playerIds[2]);
    expect(pub(t).secret).toBe(false);
    expect(pub(t).rule).toBe('Lowest card wins the trick.');
  });
});

describe('Season — timeouts', () => {
  it('starts the tricks anyway when nobody confirms the announcement', () => {
    const t = start(4);
    t.timeout();
    expect(t.phase).toBe('trick');
  });

  it('gives an unclaimed trick to nobody and carries on', () => {
    const t = start(4, { tricks_per_season: 3, trick_seconds: 30 });
    readyUp(t);
    t.timeout();
    expect(t.phase).toBe('trick');
    expect(pub(t).trick_number).toBe(2);
    expect(Object.values(pub(t).season_tricks)).toEqual([0, 0, 0, 0]);
  });

  it('never stalls if the table walks away from the phone', () => {
    const t = start(5, { seasons_per_game: 3, tricks_per_season: 3, trick_seconds: 30 });
    let guard = 0;
    while (t.phase !== 'result' && guard++ < 200) t.timeout();
    expect(t.phase).toBe('result');
  });
});

describe('Season — someone leaves', () => {
  it('carries on with a smaller table', () => {
    const t = start(5, { tricks_per_season: 3 });
    readyUp(t);
    t.leave(t.playerIds[4]);
    expect(t.phase).toBe('trick');
    t.act(t.playerIds[0], 'took', { player_id: t.playerIds[0] });
    expect(pub(t).season_tricks[t.playerIds[0]]).toBe(1);
  });

  it('stops waiting on them during an announcement', () => {
    const t = start(4);
    for (const pid of t.playerIds.slice(0, 3)) t.act(pid, 'ready');
    expect(t.phase).toBe('season');
    t.leave(t.playerIds[3]);
    expect(t.phase).toBe('trick');
  });

  it('aborts once the table is too small for a trick', () => {
    const t = start(3);
    t.leave(t.playerIds[0]);
    expect(t.phase).toBe('result');
    expect(t.result.aborted).toBe('too_few_players');
  });
});

describe('Season — stats', () => {
  it('records a played round, the winner and the seasons they knew about', () => {
    const t = start(4, { tricks_per_season: 2, seasons_per_game: 2 });
    const hero = t.playerIds[1];
    t.round.state.scoring = 'normal';
    t.round.state.secret_to = hero;
    sweepSeason(t, hero);
    t.round.state.scoring = 'normal';
    sweepSeason(t, hero);

    expect(t.phase).toBe('result');
    const rows = t.db.player_stats.filter((s) => s.game_type === 'season');
    expect(rows).toHaveLength(4);
    const mine = rows.find((r) => r.player_id === hero)!;
    expect(mine.games_played).toBe(1);
    expect(mine.games_won).toBe(1);
    expect(mine.points).toBe(4);
    expect(mine.times_hidden).toBe(1);
  });

  it('writes none for an aborted round', () => {
    const t = start(3);
    t.leave(t.playerIds[0]);
    expect(t.db.player_stats.filter((s) => s.game_type === 'season')).toHaveLength(0);
  });
});
