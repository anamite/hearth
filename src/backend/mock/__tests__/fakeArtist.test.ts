import { describe, expect, it } from 'vitest';
import { Table, viewContains } from './harness';

/** Paper mode with no vote delay keeps the tests to the interesting parts. */
function table(n = 5, extra: Record<string, unknown> = {}) {
  return new Table(n, {
    fake_artist: {
      strokes_per_player: 2,
      canvas_mode: false,
      vote_delay_seconds: 0,
      allow_reroll: true,
      impostor_guess_seconds: 15,
      ...extra,
    } as any,
  });
}

function revealAll(t: Table) {
  for (const p of t.playerIds) t.act(p, 'revealed');
}

function drawEverything(t: Table) {
  let guard = 0;
  while (t.phase === 'drawing' && guard++ < 100) {
    const cur = (t.view(t.playerIds[0]).public as any).current_player_id as string;
    t.act(cur, 'pass_turn');
  }
}

describe('Fake Artist — setup', () => {
  it('assigns exactly one impostor and gives everyone else the word', () => {
    const t = table(6);
    t.start('fake_artist');

    expect(t.playersWithRole('impostor')).toHaveLength(1);
    expect(t.playersWithRole('artist')).toHaveLength(5);

    const word = t.round.state.word as string;
    for (const p of t.playerIds) {
      const v = t.view(p);
      if (v.me.role === 'impostor') expect(v.me.private).toEqual({});
      else expect((v.me.private as any).word).toBe(word);
    }
  });

  it('gives every player a distinct turn index', () => {
    const t = table(7);
    t.start('fake_artist');
    const idx = t.db.round_players
      .filter((rp) => rp.round_id === t.round.id)
      .map((rp) => rp.turn_index)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('Fake Artist — the impostor never receives the word (M1 criterion 3)', () => {
  it('leaks nothing at any phase before result', () => {
    const t = table(5);
    t.useOnlyContent('fa-3'); // "Lighthouse" — no overlap with names or avatar keys
    t.start('fake_artist');

    const word = t.round.state.word as string;
    expect(word).toBe('Lighthouse');
    const impostor = t.playersWithRole('impostor')[0];

    const assertClean = (label: string) => {
      const v = t.view(impostor);
      expect(viewContains(v, 'lighthouse'), `${label}: word present`).toBe(false);
      expect(viewContains(v, 'light house'), `${label}: alias present`).toBe(false);
      expect(JSON.stringify(v.me.private), `${label}: private not empty`).toBe('{}');
    };

    assertClean('reveal');
    revealAll(t);
    assertClean('drawing');
    drawEverything(t);
    assertClean('voting');

    for (const p of t.playerIds) t.act(p, 'vote', { target_id: impostor });
    expect(t.phase).toBe('guess');
    assertClean('guess');

    // Only once the round is over does the word become public.
    t.act(impostor, 'word_guess', { text: 'nonsense' });
    expect(t.phase).toBe('result');
    expect(viewContains(t.view(impostor), 'lighthouse')).toBe(true);
  });

  it('never exposes a `word` key to the impostor across many random rounds', () => {
    for (let i = 0; i < 40; i++) {
      const t = table(5);
      t.start('fake_artist');
      const impostor = t.playersWithRole('impostor')[0];
      const v = t.view(impostor);
      expect(v.me.private).toEqual({});
      expect(JSON.stringify(v)).not.toMatch(/"word"\s*:/);
      expect(JSON.stringify(v)).not.toMatch(/"aliases"\s*:/);
      expect(JSON.stringify(v)).not.toMatch(/"description"\s*:/);
    }
  });
});

describe('Fake Artist — voting and outcomes', () => {
  it('artists win when the impostor is caught and guesses wrong', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    const impostor = t.playersWithRole('impostor')[0];
    for (const p of t.playerIds) t.act(p, 'vote', { target_id: impostor });
    t.act(impostor, 'word_guess', { text: 'definitely not it' });

    expect(t.result.winner).toBe('artists');
    expect(t.result.reason).toBe('impostor_caught');
    expect(t.result.caught).toBe(true);
  });

  it('the impostor steals the win by naming the word', () => {
    const t = table(5);
    t.useOnlyContent('fa-1'); // Frying pan
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    const impostor = t.playersWithRole('impostor')[0];
    for (const p of t.playerIds) t.act(p, 'vote', { target_id: impostor });
    t.act(impostor, 'word_guess', { text: '  SKILLET! ' }); // alias, messy input

    expect(t.result.winner).toBe('impostor');
    expect(t.result.reason).toBe('impostor_guessed_word');
  });

  it('a wrong accusation hands the round to the impostor', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    const impostor = t.playersWithRole('impostor')[0];
    const scapegoat = t.playerIds.find((p) => p !== impostor)!;
    for (const p of t.playerIds) t.act(p, 'vote', { target_id: scapegoat });

    expect(t.result.winner).toBe('impostor');
    expect(t.result.reason).toBe('wrong_accusation');
    expect(t.result.caught).toBe(false);
  });

  it('a tie favours the impostor', () => {
    const t = table(4);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    const impostor = t.playersWithRole('impostor')[0];
    const others = t.playerIds.filter((p) => p !== impostor);
    // 2 votes for the impostor, 2 for someone else — no strict majority.
    t.act(others[0], 'vote', { target_id: impostor });
    t.act(others[1], 'vote', { target_id: impostor });
    t.act(others[2], 'vote', { target_id: others[0] });
    t.act(impostor, 'vote', { target_id: others[0] });

    expect(t.phase).toBe('result');
    expect(t.result.winner).toBe('impostor');
    expect(t.result.reason).toBe('impostor_escaped');
  });

  it('counts non-voters as abstentions rather than stalling', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    const impostor = t.playersWithRole('impostor')[0];
    const others = t.playerIds.filter((p) => p !== impostor);
    // Only two players vote; both name the impostor, so 2 > 2/2 is a majority.
    t.act(others[0], 'vote', { target_id: impostor });
    t.act(others[1], 'vote', { target_id: impostor });
    expect(t.phase).toBe('voting');

    t.timeout();
    expect(t.phase).toBe('guess');
  });

  it('treats a timed-out guess as wrong', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);
    const impostor = t.playersWithRole('impostor')[0];
    for (const p of t.playerIds) t.act(p, 'vote', { target_id: impostor });

    t.timeout();
    expect(t.result.winner).toBe('artists');
    expect(t.result.reason).toBe('impostor_caught');
  });
});

describe('Fake Artist — vote delay', () => {
  it('refuses votes until the delay has elapsed', () => {
    const t = new Table(5, {
      fake_artist: {
        strokes_per_player: 1, canvas_mode: false, vote_delay_seconds: 60,
        allow_reroll: true, impostor_guess_seconds: 15,
      } as any,
    });
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);

    expect(t.phase).toBe('voting');
    expect(() => t.act(t.playerIds[0], 'vote', { target_id: t.playerIds[1] })).toThrow(
      /wrong_phase/,
    );

    t.tick(61);
    expect(t.phase).toBe('voting');
    expect(() => t.act(t.playerIds[0], 'vote', { target_id: t.playerIds[1] })).not.toThrow();
  });
});

describe('Fake Artist — reroll (M2 criterion 4)', () => {
  it('needs strictly more than half and swaps both word and impostor', () => {
    const t = table(5);
    t.start('fake_artist');
    const firstWord = t.round.state.word;

    t.act(t.playerIds[0], 'reroll_request');
    t.act(t.playerIds[1], 'reroll_request');
    expect(t.round.state.word).toBe(firstWord); // 2 of 5 is not enough

    t.act(t.playerIds[2], 'reroll_request'); // 3 of 5 is
    expect(t.round.state.word).not.toBe(firstWord);
    expect(t.round.state.reroll_count).toBe(1);
    expect(t.phase).toBe('reveal');
    expect((t.view(t.playerIds[0]).public as any).reroll_requests).toBe(0);
  });

  it('lets a player withdraw their request', () => {
    const t = table(5);
    t.start('fake_artist');
    t.act(t.playerIds[0], 'reroll_request');
    expect((t.view(t.playerIds[0]).public as any).reroll_requests).toBe(1);
    t.act(t.playerIds[0], 'reroll_request');
    expect((t.view(t.playerIds[0]).public as any).reroll_requests).toBe(0);
  });

  it('caps at three rerolls', () => {
    const t = table(5);
    t.start('fake_artist');
    for (let i = 0; i < 3; i++) {
      t.act(t.playerIds[0], 'reroll_request');
      t.act(t.playerIds[1], 'reroll_request');
      t.act(t.playerIds[2], 'reroll_request');
    }
    expect(t.round.state.reroll_count).toBe(3);
    expect(() => t.act(t.playerIds[0], 'reroll_request')).toThrow(/wrong_phase/);
  });

  it('is refused entirely when the group has turned it off', () => {
    const t = table(5, { allow_reroll: false });
    t.start('fake_artist');
    expect(() => t.act(t.playerIds[0], 'reroll_request')).toThrow(/wrong_phase/);
  });
});

describe('Fake Artist — impostor rotation (M2 criterion 3)', () => {
  it('never picks the same impostor three rounds running', () => {
    const t = table(5);
    const seen: string[] = [];

    for (let round = 0; round < 20; round++) {
      t.start('fake_artist');
      seen.push(t.playersWithRole('impostor')[0]);
      revealAll(t);
      drawEverything(t);
      for (const p of t.playerIds) t.act(p, 'vote', { target_id: t.playerIds[0] });
      if (t.phase === 'guess') t.act(t.playersWithRole('impostor')[0], 'word_guess', { text: 'x' });
      expect(t.round.ended_at).toBeTruthy();
    }

    for (let i = 2; i < seen.length; i++) {
      expect(
        seen[i] === seen[i - 1] && seen[i - 1] === seen[i - 2],
        `three in a row at round ${i}`,
      ).toBe(false);
    }
  });
});

describe('Fake Artist — turn order and strokes', () => {
  it('gives every player exactly one turn per pass', () => {
    const t = table(4);
    t.start('fake_artist');
    revealAll(t);

    const turns: string[] = [];
    let guard = 0;
    while (t.phase === 'drawing' && guard++ < 50) {
      const cur = (t.view(t.playerIds[0]).public as any).current_player_id as string;
      turns.push(cur);
      t.act(cur, 'pass_turn');
    }
    expect(turns).toHaveLength(8); // 4 players x 2 passes
    expect(new Set(turns.slice(0, 4)).size).toBe(4);
    expect(new Set(turns.slice(4, 8)).size).toBe(4);
  });

  it('rejects a stroke from anyone but the current player', () => {
    const t = new Table(4, {
      fake_artist: {
        strokes_per_player: 2, canvas_mode: true, vote_delay_seconds: 0,
        allow_reroll: true, impostor_guess_seconds: 15,
      } as any,
    });
    t.start('fake_artist');
    revealAll(t);

    const cur = (t.view(t.playerIds[0]).public as any).current_player_id as string;
    const other = t.playerIds.find((p) => p !== cur)!;
    expect(() =>
      t.act(other, 'stroke', { points: [[0.1, 0.1], [0.2, 0.2]], width: 0.008 }),
    ).toThrow(/not_your_turn/);

    t.act(cur, 'stroke', { points: [[0.1, 0.1], [0.2, 0.2]], width: 0.008 });
    expect((t.view(other).public as any).strokes).toHaveLength(1);
  });

  it('clamps stroke coordinates and length', () => {
    const t = new Table(4, {
      fake_artist: {
        strokes_per_player: 1, canvas_mode: true, vote_delay_seconds: 0,
        allow_reroll: true, impostor_guess_seconds: 15,
      } as any,
    });
    t.start('fake_artist');
    revealAll(t);

    const cur = (t.view(t.playerIds[0]).public as any).current_player_id as string;
    const points = Array.from({ length: 900 }, (_, i) => [i / 900, 5 - i]);
    t.act(cur, 'stroke', { points, width: 99 });

    const stroke = (t.view(cur).public as any).strokes[0];
    expect(stroke.points.length).toBe(400);
    expect(stroke.width).toBeLessThanOrEqual(0.05);
    for (const [x, y] of stroke.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe('Fake Artist — players leaving (§19.3)', () => {
  it('aborts when the impostor walks out', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    t.leave(t.playersWithRole('impostor')[0]);
    expect(t.result.aborted).toBe('impostor_left');
  });

  it('skips an absent artist’s turns and still reaches a result', () => {
    const t = table(6);
    t.start('fake_artist');
    revealAll(t);

    const impostor = t.playersWithRole('impostor')[0];
    const quitter = t.playerIds.find((p) => p !== impostor)!;
    t.leave(quitter);

    let guard = 0;
    while (t.phase === 'drawing' && guard++ < 50) {
      const cur = (t.view(impostor).public as any).current_player_id as string;
      expect(cur).not.toBe(quitter);
      t.act(cur, 'pass_turn');
    }
    expect(t.phase).toBe('voting');
  });

  it('aborts when too few players remain', () => {
    const t = table(4);
    t.start('fake_artist');
    revealAll(t);
    const impostor = t.playersWithRole('impostor')[0];
    t.leave(t.playerIds.find((p) => p !== impostor)!);
    expect(t.result.aborted).toBe('too_few_players');
  });
});

describe('Fake Artist — stats', () => {
  it('records played, won, hidden and caught', () => {
    const t = table(5);
    t.start('fake_artist');
    revealAll(t);
    drawEverything(t);
    const impostor = t.playersWithRole('impostor')[0];
    for (const p of t.playerIds) t.act(p, 'vote', { target_id: impostor });
    t.act(impostor, 'word_guess', { text: 'wrong' });

    const stats = t.db.player_stats.filter((s) => s.game_type === 'fake_artist');
    expect(stats).toHaveLength(5);
    const imp = stats.find((s) => s.player_id === impostor)!;
    expect(imp.times_hidden).toBe(1);
    expect(imp.times_caught).toBe(1);
    expect(imp.games_won).toBe(0);
    for (const s of stats.filter((s) => s.player_id !== impostor)) {
      expect(s.games_won).toBe(1);
      expect(s.times_hidden).toBe(0);
    }
    expect(t.db.games_history).toHaveLength(1);
  });
});
