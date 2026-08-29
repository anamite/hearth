import { describe, expect, it } from 'vitest';
import { Table } from './harness';
import { wolvesFor } from '../games/nightVillage';

function revealAll(t: Table) {
  for (const p of t.playerIds.filter((id) => !t.db.players.find((x) => x.id === id)!.has_left)) {
    t.act(p, 'revealed');
  }
}

function livingOf(t: Table, role?: string): string[] {
  return t.db.round_players
    .filter(
      (rp) =>
        rp.round_id === t.round.id &&
        rp.is_alive &&
        !t.db.players.find((p) => p.id === rp.player_id)!.has_left &&
        (!role || rp.role === role),
    )
    .map((rp) => rp.player_id);
}

/** Wolves agree on one target, then the seer and doctor act if present. */
function playNight(t: Table, killTarget: string, protectTarget?: string) {
  expect(t.phase).toBe('night_wolves');
  for (const w of livingOf(t, 'wolf')) t.act(w, 'wolf_vote', { target_id: killTarget });

  if (t.phase === 'night_seer') {
    const seer = livingOf(t, 'seer')[0];
    const already = new Set(
      ((t.view(seer).me.private as any).checks ?? []).map((c: any) => c.target_id),
    );
    const target = livingOf(t).find((p) => p !== seer && !already.has(p));
    if (target) t.act(seer, 'seer_check', { target_id: target });
    else t.timeout();
  }
  if (t.phase === 'night_doctor') {
    const doc = livingOf(t, 'doctor')[0];
    const target = protectTarget ?? doc;
    try {
      t.act(doc, 'doctor_protect', { target_id: target });
    } catch {
      t.timeout();
    }
  }
  expect(t.phase).toBe('morning');
}

describe('Night Village — role distribution (§12.3)', () => {
  it('matches the table for every supported player count', () => {
    const expected: Record<number, number> = { 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3 };
    for (const n of [6, 7, 8, 9, 10, 11, 12]) {
      const t = new Table(n);
      t.start('night_village');
      expect(wolvesFor(n)).toBe(expected[n]);
      expect(t.playersWithRole('wolf')).toHaveLength(expected[n]);
      expect(t.playersWithRole('seer')).toHaveLength(1);
      expect(t.playersWithRole('doctor')).toHaveLength(1);
      expect(t.playersWithRole('villager')).toHaveLength(n - expected[n] - 2);
    }
  });

  it('turns a disabled special role into an extra villager', () => {
    const t = new Table(8, {
      night_village: {
        discussion_seconds: 240, include_seer: false, include_doctor: true,
        doctor_self_protect: 'once', reveal_role_on_death: true, night_action_seconds: 45,
      },
    });
    t.start('night_village');
    expect(t.playersWithRole('seer')).toHaveLength(0);
    expect(t.playersWithRole('villager')).toHaveLength(5);
  });
});

describe('Night Village — secrets (M4 criterion 2)', () => {
  it('shows the wolf list only to wolves', () => {
    const t = new Table(8);
    t.start('night_village');
    const wolves = t.playersWithRole('wolf');

    for (const p of t.playerIds) {
      const v = t.view(p);
      if (wolves.includes(p)) {
        const fellow = (v.me.private as any).fellow_wolves as string[];
        expect(fellow.sort()).toEqual(wolves.filter((w) => w !== p).sort());
      } else {
        expect((v.me.private as any).fellow_wolves).toBeUndefined();
        expect(JSON.stringify(v)).not.toMatch(/fellow_wolves/);
        // No other player's role is exposed either.
        expect(v.players.every((pl) => pl.role === null)).toBe(true);
      }
    }
  });

  it('delivers a seer result only to the seer', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);

    const seer = t.playersWithRole('seer')[0];
    const wolf = t.playersWithRole('wolf')[0];
    const villager = t.playersWithRole('villager')[0];

    for (const w of livingOf(t, 'wolf')) t.act(w, 'wolf_vote', { target_id: villager });
    expect(t.phase).toBe('night_seer');
    t.act(seer, 'seer_check', { target_id: wolf });

    const checks = (t.view(seer).me.private as any).checks;
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ target_id: wolf, is_wolf: true });

    for (const p of t.playerIds.filter((x) => x !== seer)) {
      const v = t.view(p);
      expect(JSON.stringify(v)).not.toMatch(/is_wolf/);
      expect((v.me.private as any).checks).toBeUndefined();
    }
  });

  it('shows wolf picks live to wolves and nobody else', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);

    const wolves = t.playersWithRole('wolf');
    const villager = t.playersWithRole('villager')[0];
    t.act(wolves[0], 'wolf_vote', { target_id: villager });

    expect((t.view(wolves[1]).me.private as any).wolf_votes).toHaveLength(1);
    expect((t.view(villager).me.private as any).wolf_votes).toBeUndefined();
  });
});

describe('Night Village — the night', () => {
  it('kills the wolves’ target when nobody protects them', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const victim = t.playersWithRole('villager')[0];
    playNight(t, victim, t.playersWithRole('doctor')[0]);

    const summary = (t.view(t.playerIds[0]).public as any).morning;
    expect(summary.died_id).toBe(victim);
    expect(livingOf(t)).not.toContain(victim);
  });

  it('saves the target when the doctor guesses right', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const victim = t.playersWithRole('villager')[0];
    playNight(t, victim, victim);

    const summary = (t.view(t.playerIds[0]).public as any).morning;
    expect(summary.died_id).toBeNull();
    expect(summary.saved).toBe(true);
    expect(livingOf(t)).toContain(victim);
  });

  it('kills nobody when the wolves never act', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const before = livingOf(t).length;

    t.timeout(); // wolves
    if (t.phase === 'night_seer') t.timeout();
    if (t.phase === 'night_doctor') t.timeout();
    expect(t.phase).toBe('morning');
    expect(livingOf(t)).toHaveLength(before);
  });

  it('waits for wolf consensus rather than the first click', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);

    const wolves = t.playersWithRole('wolf');
    const targets = t.playersWithRole('villager');
    t.act(wolves[0], 'wolf_vote', { target_id: targets[0] });
    t.act(wolves[1], 'wolf_vote', { target_id: targets[1] });
    expect(t.phase).toBe('night_wolves'); // disagreement holds the phase

    t.act(wolves[1], 'wolf_vote', { target_id: targets[0] });
    expect(t.phase).not.toBe('night_wolves');
  });

  it('picks randomly among voted targets when the wolves time out', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const wolves = t.playersWithRole('wolf');
    const targets = t.playersWithRole('villager');
    t.act(wolves[0], 'wolf_vote', { target_id: targets[0] });
    t.act(wolves[1], 'wolf_vote', { target_id: targets[1] });

    t.timeout();
    expect([targets[0], targets[1]]).toContain(t.round.state.night_kill_target);
  });

  it('stops wolves targeting themselves or the dead', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const wolf = t.playersWithRole('wolf')[0];
    expect(() => t.act(wolf, 'wolf_vote', { target_id: wolf })).toThrow(/invalid_target/);
  });

  it('never lets the seer check the same player twice', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const seer = t.playersWithRole('seer')[0];
    const villagers = t.playersWithRole('villager');

    for (const w of livingOf(t, 'wolf')) t.act(w, 'wolf_vote', { target_id: villagers[0] });
    t.act(seer, 'seer_check', { target_id: villagers[1] });
    if (t.phase === 'night_doctor') t.timeout();
    t.timeout(); // morning
    t.timeout(); // day_discuss
    t.timeout(); // day_vote
    t.timeout(); // evening -> night

    expect(t.phase).toBe('night_wolves');
    for (const w of livingOf(t, 'wolf')) t.act(w, 'wolf_vote', { target_id: villagers[2] });
    expect(t.phase).toBe('night_seer');
    expect(() => t.act(seer, 'seer_check', { target_id: villagers[1] })).toThrow(/invalid_target/);
  });

  it('stops the doctor protecting the same player two nights running', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const doc = t.playersWithRole('doctor')[0];
    const villagers = t.playersWithRole('villager');

    playNight(t, villagers[0], villagers[1]);
    t.timeout(); // morning
    t.timeout(); // day_discuss
    t.timeout(); // day_vote
    t.timeout(); // evening

    expect(t.phase).toBe('night_wolves');
    for (const w of livingOf(t, 'wolf')) t.act(w, 'wolf_vote', { target_id: villagers[2] });
    if (t.phase === 'night_seer') t.timeout();
    expect(t.phase).toBe('night_doctor');
    expect(() => t.act(doc, 'doctor_protect', { target_id: villagers[1] })).toThrow(
      /invalid_target/,
    );
  });

  it('honours the self-protection setting', () => {
    const never = new Table(8, {
      night_village: {
        discussion_seconds: 240, include_seer: true, include_doctor: true,
        doctor_self_protect: 'never', reveal_role_on_death: true, night_action_seconds: 45,
      },
    });
    never.start('night_village');
    revealAll(never);
    const doc = never.playersWithRole('doctor')[0];
    for (const w of livingOf(never, 'wolf')) {
      never.act(w, 'wolf_vote', { target_id: never.playersWithRole('villager')[0] });
    }
    if (never.phase === 'night_seer') never.timeout();
    expect(() => never.act(doc, 'doctor_protect', { target_id: doc })).toThrow(/invalid_target/);
  });
});

describe('Night Village — the day', () => {
  it('eliminates on a strict majority of the living', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);
    t.timeout(); // morning -> day_discuss
    t.timeout(); // day_discuss -> day_vote
    expect(t.phase).toBe('day_vote');

    const living = livingOf(t); // 7 alive
    const accused = living[0];
    for (const p of living.slice(1)) t.act(p, 'day_vote', { target_id: accused });
    expect(t.phase).toBe('day_vote'); // the accused is still owed a vote
    t.act(accused, 'day_vote', { target_id: null });

    expect(t.phase).toBe('evening');
    const result = (t.view(living[1]).public as any).day_result;
    expect(result.eliminated_id).toBe(accused);
  });

  it('eliminates nobody without a majority', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);
    t.timeout();
    t.timeout();

    const living = livingOf(t);
    // Split the vote evenly enough that nobody clears half.
    living.forEach((p, i) => t.act(p, 'day_vote', { target_id: living[i % 3] }));
    expect(t.phase).toBe('evening');
    expect((t.view(living[0]).public as any).day_result.eliminated_id).toBeNull();
  });

  it('counts abstentions toward the threshold but not toward a target', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);
    t.timeout();
    t.timeout();

    const living = livingOf(t); // 7 alive, so 4 votes are needed
    const accused = living[0];
    t.act(living[1], 'day_vote', { target_id: accused });
    t.act(living[2], 'day_vote', { target_id: accused });
    t.act(living[3], 'day_vote', { target_id: accused });
    t.act(accused, 'day_vote', { target_id: null });
    for (const p of living.slice(4)) t.act(p, 'day_vote', { target_id: null });

    expect((t.view(living[1]).public as any).day_result.eliminated_id).toBeNull();
  });

  it('skips discussion on a majority request', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);
    t.timeout();
    expect(t.phase).toBe('day_discuss');

    const living = livingOf(t);
    for (const p of living.slice(0, 3)) t.act(p, 'skip_discussion');
    expect(t.phase).toBe('day_discuss');
    t.act(living[3], 'skip_discussion'); // 4 of 7
    expect(t.phase).toBe('day_vote');
  });

  it('refuses actions from the dead', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const victim = t.playersWithRole('villager')[0];
    playNight(t, victim, t.playersWithRole('doctor')[0]);
    t.timeout();
    t.timeout();
    expect(() => t.act(victim, 'day_vote', { target_id: livingOf(t)[0] })).toThrow(/wrong_phase/);
  });
});

describe('Night Village — ghost view (§12.9)', () => {
  it('reveals every role to a dead player and to nobody else', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const victim = t.playersWithRole('villager')[0];
    playNight(t, victim, t.playersWithRole('doctor')[0]);

    const ghost = t.view(victim);
    expect(ghost.players.every((p) => p.role !== null)).toBe(true);

    const alive = livingOf(t).find((p) => t.roleOf(p) === 'villager')!;
    const living = t.view(alive);
    const wolves = t.playersWithRole('wolf');
    for (const w of wolves) {
      expect(living.players.find((p) => p.player_id === w)!.role).toBeNull();
    }
  });
});

describe('Night Village — win conditions (M4 criterion 1)', () => {
  it('the village wins once every wolf is gone', () => {
    const t = new Table(6); // one wolf
    t.start('night_village');
    revealAll(t);
    const wolf = t.playersWithRole('wolf')[0];

    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);
    t.timeout(); // morning
    t.timeout(); // discuss
    const living = livingOf(t);
    for (const p of living.filter((p) => p !== wolf)) t.act(p, 'day_vote', { target_id: wolf });
    t.act(wolf, 'day_vote', { target_id: null });
    expect(t.phase).toBe('evening');
    t.timeout(); // evening -> result

    expect(t.phase).toBe('result');
    expect(t.result.winner).toBe('village');
  });

  it('the wolves win once they equal the rest', () => {
    const t = new Table(6);
    t.start('night_village');
    revealAll(t);
    const wolf = t.playersWithRole('wolf')[0];
    const doctor = t.playersWithRole('doctor')[0];

    // Kill villagers night after night; nobody is ever voted out.
    let guard = 0;
    while (t.phase !== 'result' && guard++ < 12) {
      const prey = livingOf(t).find((p) => p !== wolf && p !== doctor)
        ?? livingOf(t).find((p) => p !== wolf)!;
      playNight(t, prey, wolf);
      t.timeout(); // morning
      if (t.phase === 'result') break;
      t.timeout(); // discuss
      const living = livingOf(t);
      for (const p of living) t.act(p, 'day_vote', { target_id: null });
      t.timeout(); // evening
    }

    expect(t.phase).toBe('result');
    expect(t.result.winner).toBe('wolves');
    expect(t.result.roles).toHaveLength(6);
  });
});

describe('Night Village — disconnection (M4 criterion 5)', () => {
  it('never stalls a night phase past its timer', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    expect(t.phase).toBe('night_wolves');
    expect(t.round.phase_ends_at).toBeTruthy();

    t.timeout();
    expect(t.phase).not.toBe('night_wolves');
  });

  it('auto-reveals players who never tap', () => {
    const t = new Table(8);
    t.start('night_village');
    expect(t.phase).toBe('reveal');
    t.timeout();
    expect(t.phase).toBe('night_wolves');
  });

  it('treats a departure as an elimination and re-checks the win', () => {
    const t = new Table(6);
    t.start('night_village');
    revealAll(t);
    const villagers = t.playersWithRole('villager');

    t.leave(villagers[0]);
    expect(livingOf(t)).not.toContain(villagers[0]);
    const narration = (t.view(t.playerIds[0]).public as any).narration;
    expect(JSON.stringify(narration)).toMatch(/has left the village/);
  });
});

describe('Night Village — narration (M4 criteria 3 and 4)', () => {
  it('always ships on-screen text alongside the clip keys', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    playNight(t, t.playersWithRole('villager')[0], t.playersWithRole('doctor')[0]);

    const narration = (t.view(t.playerIds[0]).public as any).narration;
    expect(narration.lines.length).toBeGreaterThan(0);
    for (const line of narration.lines) {
      expect(typeof line.text).toBe('string');
      expect(line.text.length).toBeGreaterThan(0);
      expect(Array.isArray(line.clips)).toBe(true);
    }
  });

  it('names the eliminated player', () => {
    const t = new Table(8);
    t.start('night_village');
    revealAll(t);
    const victim = t.playersWithRole('villager')[0];
    const nickname = t.db.players.find((p) => p.id === victim)!.nickname;
    playNight(t, victim, t.playersWithRole('doctor')[0]);

    const narration = (t.view(t.playerIds[0]).public as any).narration;
    const joined = JSON.stringify(narration);
    expect(joined).toContain(nickname);
    expect(joined).toContain(`names/${nickname.toLowerCase()}`);
  });
});
