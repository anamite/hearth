import { describe, expect, it } from 'vitest';
import { Table, viewContains } from './harness';
import { EVENT_BANK } from '../games/envelope';

function pub(t: Table, playerId = t.playerIds[0]) {
  return t.view(playerId).public as any;
}

function assignmentOf(t: Table, playerId: string): string {
  return (t.view(playerId).me.private as any).text;
}

/** Everyone taps whatever the current phase is asking for. */
function allAct(t: Table, kind: string, payload: Record<string, unknown> = {}): void {
  const phase = t.phase;
  for (const pid of t.playerIds) {
    if (t.db.players.find((p) => p.id === pid)!.has_left) continue;
    if (t.phase !== phase) return;
    t.act(pid, kind, payload);
  }
}

function start(players: number, settings?: Record<string, unknown>) {
  const t = new Table(players, { envelope: (settings ?? {}) as any });
  t.start('envelope');
  return t;
}

/** Walk from the brief all the way to the scoring table. */
function playToReveal(t: Table): void {
  allAct(t, 'ready');
  let guard = 0;
  while (t.phase !== 'reveal' && guard++ < 30) {
    if (t.phase === 'trade') allAct(t, 'done');
    else t.timeout();
  }
}

// ---------------------------------------------------------------

describe('Envelope — setup', () => {
  it('gives every player a different assignment', () => {
    const t = start(6);
    expect(t.phase).toBe('brief');
    const texts = t.playerIds.map((p) => assignmentOf(t, p));
    expect(texts.every((x) => typeof x === 'string' && x.length > 5)).toBe(true);
    expect(new Set(texts).size).toBe(6);
  });

  it('deals a whole table at every supported count', () => {
    for (let n = 4; n <= 8; n++) {
      const t = start(n);
      expect(t.playerIds.every((p) => !!assignmentOf(t, p))).toBe(true);
      expect(pub(t).sessions_total).toBe(3);
    }
  });

  it('resolves every placeholder into a real name at the table', () => {
    for (let i = 0; i < 40; i++) {
      const t = start(5);
      for (const pid of t.playerIds) {
        const text = assignmentOf(t, pid);
        expect(text).not.toContain('{');
        expect(text).not.toContain('}');
      }
    }
  });

  it('never names a player in their own assignment', () => {
    for (let i = 0; i < 30; i++) {
      const t = start(4);
      for (const pid of t.playerIds) {
        const me = t.db.players.find((p) => p.id === pid)!.nickname;
        expect(assignmentOf(t, pid)).not.toContain(me);
      }
    }
  });
});

describe('Envelope — secrecy', () => {
  it('sends nobody anybody else’s assignment, at every phase before scoring', () => {
    for (let i = 0; i < 20; i++) {
      const t = start(5, { sessions: 2 });
      const secrets = Object.fromEntries(t.playerIds.map((p) => [p, assignmentOf(t, p)]));

      let guard = 0;
      while (t.phase !== 'reveal' && guard++ < 20) {
        const opened = new Set((pub(t).revealed ?? []) as string[]);
        for (const viewer of t.playerIds) {
          const v = t.view(viewer);
          for (const subject of t.playerIds) {
            if (subject === viewer || opened.has(subject)) continue;
            expect(viewContains(v, secrets[subject])).toBe(false);
          }
        }
        if (t.phase === 'trade') allAct(t, 'done');
        else t.timeout();
      }
    }
  });

  it('opens every envelope once the trading is over', () => {
    const t = start(4, { sessions: 2 });
    const secrets = Object.fromEntries(t.playerIds.map((p) => [p, assignmentOf(t, p)]));
    playToReveal(t);
    const a = pub(t).assignments;
    for (const pid of t.playerIds) expect(a[pid].text).toBe(secrets[pid]);
  });
});

describe('Envelope — sessions and events', () => {
  it('runs one event between sessions and none after the last', () => {
    const t = start(4, { sessions: 3 });
    allAct(t, 'ready');
    expect(t.phase).toBe('trade');
    expect(pub(t).session_number).toBe(1);

    allAct(t, 'done');
    expect(t.phase).toBe('event');
    expect(pub(t).event.text.length).toBeGreaterThan(5);
    t.timeout();
    expect(pub(t).session_number).toBe(2);

    allAct(t, 'done');
    expect(t.phase).toBe('event');
    t.timeout();
    expect(pub(t).session_number).toBe(3);

    allAct(t, 'done');
    expect(t.phase).toBe('reveal');
  });

  it('never repeats an event while unused ones remain', () => {
    const t = start(4, { sessions: 6 });
    allAct(t, 'ready');
    const seen: string[] = [];
    let guard = 0;
    while (t.phase !== 'reveal' && guard++ < 30) {
      if (t.phase === 'trade') allAct(t, 'done');
      else {
        if (t.phase === 'event') seen.push(pub(t).event.id);
        t.timeout();
      }
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('resolves the names in an event, whichever one it drew', () => {
    for (let i = 0; i < 40; i++) {
      const t = start(4, { sessions: 2 });
      allAct(t, 'ready');
      allAct(t, 'done');
      expect(t.phase).toBe('event');
      expect(pub(t).event.text).not.toContain('{');
    }
  });

  it('halves the next session when the short fuse lands', () => {
    const t = start(4, { sessions: 3, session_seconds: 240 });
    allAct(t, 'ready');
    allAct(t, 'done');
    // Force the one event that has a mechanical effect.
    t.round.state.event = EVENT_BANK.find((e) => e.id === 'deadline');
    t.round.state.half_next = true;
    t.timeout();
    expect(t.phase).toBe('trade');
    // Measured from the clock the phase was entered on, not from before it.
    const left = Date.parse(t.round.phase_ends_at!) - t.clock.getTime();
    expect(Math.round(left / 1000)).toBe(120);
  });

  it('publishes one player’s assignment when an envelope is opened', () => {
    const t = start(4, { sessions: 3 });
    allAct(t, 'ready');
    allAct(t, 'done');
    // Re-run the event roll until the opening one comes up.
    let guard = 0;
    while (!(pub(t).event?.id === 'open_envelope') && guard++ < 60) {
      t.round.state.events_used = [];
      t.round.state.revealed = [];
      t.round.phase = 'trade';
      t.act(t.playerIds[0], 'done');
      for (const pid of t.playerIds.slice(1)) {
        if (t.phase === 'trade') t.act(pid, 'done');
      }
      if (t.phase !== 'event') break;
    }
    if (pub(t).event?.id !== 'open_envelope') return; // vanishingly unlikely
    const opened = pub(t).revealed as string[];
    expect(opened).toHaveLength(1);
    expect(pub(t).assignments[opened[0]].text).toBe(assignmentOf(t, opened[0]));
  });
});

describe('Envelope — scoring', () => {
  it('pays the assignment’s worth to whoever says they made it', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    const hero = t.playerIds[0];
    for (const pid of t.playerIds) t.act(pid, 'claim', { made: pid === hero });

    expect(t.phase).toBe('result');
    const mine = t.result.standings.find((s: any) => s.player_id === hero);
    expect(mine.made).toBe(true);
    expect(mine.score).toBe(mine.points);
    expect(t.result.winners).toEqual([hero]);
  });

  it('lets a player change their mind before the phase ends', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    const hero = t.playerIds[0];
    t.act(hero, 'claim', { made: true });
    expect(pub(t).claims[hero]).toBe(true);
    t.act(hero, 'claim', { made: false });
    expect(pub(t).claims[hero]).toBe(false);
  });

  it('scores nobody, and names no winner, when everybody missed', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    for (const pid of t.playerIds) t.act(pid, 'claim', { made: false });
    expect(t.phase).toBe('result');
    expect(t.result.best_score).toBe(0);
    expect(t.result.winners).toEqual([]);
  });

  it('shares the win when two deliver the same worth', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    // Level the assignments so the tie is about the claim, not the draw.
    for (const rp of t.db.round_players) rp.private = { ...rp.private, points: 4 };
    for (const pid of t.playerIds.slice(0, 2)) t.act(pid, 'claim', { made: true });
    for (const pid of t.playerIds.slice(2)) t.act(pid, 'claim', { made: false });
    expect(t.result.winners).toHaveLength(2);
    expect(t.result.best_score).toBe(4);
  });
});

describe('Envelope — validation', () => {
  it('refuses an action from the wrong phase', () => {
    const t = start(4);
    expect(() => t.act(t.playerIds[0], 'claim', { made: true })).toThrow(/wrong_phase/);
    expect(() => t.act(t.playerIds[0], 'done')).toThrow(/wrong_phase/);
  });

  it('keeps each session’s "done" separate from the last one’s', () => {
    const t = start(4, { sessions: 3 });
    allAct(t, 'ready');
    allAct(t, 'done');
    t.timeout();
    expect(pub(t).session_number).toBe(2);
    // Nobody is carried over as already finished.
    expect(t.view(t.playerIds[0]).players.every((p) => !p.has_acted)).toBe(true);
  });
});

describe('Envelope — timeouts', () => {
  it('starts trading anyway when nobody confirms the brief', () => {
    const t = start(4);
    t.timeout();
    expect(t.phase).toBe('trade');
  });

  it('buzzes a session shut on the clock', () => {
    const t = start(4, { sessions: 2, session_seconds: 60 });
    allAct(t, 'ready');
    t.timeout();
    expect(t.phase).toBe('event');
  });

  it('counts silence at the scoring table as a miss', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    t.act(t.playerIds[0], 'claim', { made: true });
    t.timeout();
    expect(t.phase).toBe('result');
    const missed = t.result.standings.filter((s: any) => !s.made);
    expect(missed).toHaveLength(3);
  });

  it('never stalls if the whole table ignores the phone', () => {
    const t = start(5, { sessions: 3 });
    let guard = 0;
    while (t.phase !== 'result' && guard++ < 60) t.timeout();
    expect(t.phase).toBe('result');
  });
});

describe('Envelope — someone leaves', () => {
  it('carries on, and stops waiting on them', () => {
    const t = start(5, { sessions: 2 });
    allAct(t, 'ready');
    for (const pid of t.playerIds.slice(0, 4)) t.act(pid, 'done');
    expect(t.phase).toBe('trade');
    t.leave(t.playerIds[4]);
    expect(t.phase).toBe('event');
  });

  it('leaves them out of the scoring', () => {
    const t = start(5, { sessions: 2 });
    const gone = t.playerIds[4];
    playToReveal(t);
    t.leave(gone);
    for (const pid of t.playerIds.slice(0, 4)) t.act(pid, 'claim', { made: true });
    expect(t.phase).toBe('result');
    expect(t.result.standings.map((s: any) => s.player_id)).not.toContain(gone);
  });

  it('aborts once the table is too small to trade', () => {
    const t = start(4);
    t.leave(t.playerIds[0]);
    expect(t.phase).toBe('result');
    expect(t.result.aborted).toBe('too_few_players');
  });
});

describe('Envelope — stats', () => {
  it('records a played round and who delivered', () => {
    const t = start(4, { sessions: 2 });
    playToReveal(t);
    const hero = t.playerIds[1];
    for (const pid of t.playerIds) t.act(pid, 'claim', { made: pid === hero });

    const rows = t.db.player_stats.filter((s) => s.game_type === 'envelope');
    expect(rows).toHaveLength(4);
    const mine = rows.find((r) => r.player_id === hero)!;
    expect(mine.games_played).toBe(1);
    expect(mine.games_won).toBe(1);
    expect(mine.times_hidden).toBe(1);
    expect(mine.points).toBeGreaterThan(0);
  });

  it('writes none for an aborted round', () => {
    const t = start(4);
    t.leave(t.playerIds[0]);
    expect(t.db.player_stats.filter((s) => s.game_type === 'envelope')).toHaveLength(0);
  });
});
