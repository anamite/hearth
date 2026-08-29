import { HearthError } from '@/types';
import { pick, shuffle } from '@/lib/random';
import type { RoundPlayerRow } from '../db';
import type { GameCtx, ServerGame } from '../engine';

const MORNING_SECONDS = 8;
const EVENING_SECONDS = 8;
const REVEAL_SAFETY_SECONDS = 180;

export type NvRole = 'wolf' | 'seer' | 'doctor' | 'villager';

/** Spec §12.3. */
export function wolvesFor(playerCount: number): number {
  if (playerCount <= 6) return 1;
  if (playerCount <= 9) return 2;
  return 3;
}

export interface NarrationLine {
  /** Logical clip keys; the client resolves a random variant per key. */
  clips: string[];
  /** MUST always be rendered on screen too (§14.6). */
  text: string;
}

function say(ctx: GameCtx, lines: NarrationLine[]): void {
  const s = ctx.round.state;
  s.narration = { seq: (s.narration?.seq ?? 0) + 1, lines };
}

function nameClip(ctx: GameCtx, playerId: string): string {
  return `names/${ctx.nickname(playerId).toLowerCase()}`;
}

// ---------------------------------------------------------------
// Eliminations and win conditions
// ---------------------------------------------------------------

function eliminate(ctx: GameCtx, playerId: string, cause: string): RoundPlayerRow | undefined {
  const rp = ctx.rp(playerId);
  if (!rp || !rp.is_alive) return undefined;
  rp.is_alive = false;
  ctx.round.state.eliminations.push({
    day: ctx.round.day_number,
    player_id: playerId,
    role: rp.role,
    cause,
  });
  return rp;
}

/** Spec §12.8. */
function checkWin(ctx: GameCtx): 'village' | 'wolves' | null {
  const living = ctx.rps.filter((r) => r.is_alive && !ctx.hasLeft(r.player_id));
  const wolves = living.filter((r) => r.role === 'wolf').length;
  const others = living.length - wolves;
  if (wolves === 0) return 'village';
  if (wolves >= others) return 'wolves';
  return null;
}

function endGame(ctx: GameCtx, winner: 'village' | 'wolves'): void {
  say(ctx, [
    {
      clips: [winner === 'village' ? 'outcomes/village_wins' : 'outcomes/wolves_wins'],
      text:
        winner === 'village'
          ? 'Every wolf has been driven out. The village survives.'
          : 'The wolves outnumber the village. The village falls.',
    },
  ]);
  ctx.endRound({
    winner,
    day_number: ctx.round.day_number,
    eliminations: ctx.round.state.eliminations,
    roles: ctx.rps.map((r) => ({
      player_id: r.player_id,
      role: r.role,
      is_alive: r.is_alive,
    })),
  });
}

// ---------------------------------------------------------------
// Phase entry
// ---------------------------------------------------------------

function livingWithRole(ctx: GameCtx, role: NvRole): RoundPlayerRow[] {
  return ctx.rps.filter((r) => r.role === role && r.is_alive && !ctx.hasLeft(r.player_id));
}

function enterNightWolves(ctx: GameCtx): void {
  const s = ctx.round.state;
  s.night_kill_target = null;
  s.night_protect_target = null;
  s.locked_wolf_target = null;

  const wolves = livingWithRole(ctx, 'wolf');
  ctx.clearPhaseActions('night_wolves');
  say(ctx, [
    { clips: ['cues/night_falls'], text: 'Night falls over the village.' },
    { clips: ['cues/wolves_wake'], text: 'The wolves wake, and choose.' },
  ]);
  ctx.setPhase('night_wolves', {
    seconds: ctx.settings.night_village.night_action_seconds,
    pendingOn: wolves.map((r) => r.player_id),
  });
}

/** Skips absent or dead roles without disturbing neighbouring durations (§12.5). */
function enterAfterWolves(ctx: GameCtx): void {
  const seer = livingWithRole(ctx, 'seer');
  if (seer.length > 0) {
    ctx.clearPhaseActions('night_seer');
    say(ctx, [
      { clips: ['cues/wolves_sleep'], text: 'The wolves sleep.' },
      { clips: ['cues/seer_wake'], text: 'The seer wakes, and looks.' },
    ]);
    ctx.setPhase('night_seer', {
      seconds: ctx.settings.night_village.night_action_seconds,
      pendingOn: seer.map((r) => r.player_id),
    });
    return;
  }
  enterAfterSeer(ctx);
}

function enterAfterSeer(ctx: GameCtx): void {
  const doctor = livingWithRole(ctx, 'doctor');
  if (doctor.length > 0) {
    ctx.clearPhaseActions('night_doctor');
    say(ctx, [
      { clips: ['cues/seer_sleep'], text: 'The seer sleeps.' },
      { clips: ['cues/doctor_wake'], text: 'The doctor wakes, and protects.' },
    ]);
    ctx.setPhase('night_doctor', {
      seconds: ctx.settings.night_village.night_action_seconds,
      pendingOn: doctor.map((r) => r.player_id),
    });
    return;
  }
  enterMorning(ctx);
}

/** Spec §12.6 — night resolution. */
function enterMorning(ctx: GameCtx): void {
  const s = ctx.round.state;
  const target: string | null = s.night_kill_target;
  const protectedId: string | null = s.night_protect_target;

  let died: RoundPlayerRow | undefined;
  if (target && target !== protectedId) {
    died = eliminate(ctx, target, 'wolves');
  }

  const revealRole = ctx.settings.night_village.reveal_role_on_death;
  if (died) {
    const roleWord = roleLabel(died.role);
    say(ctx, [
      { clips: ['cues/morning_comes'], text: 'Morning comes over the village.' },
      { clips: [nameClip(ctx, died.player_id), 'outcomes/died'], text: revealRole
          ? `${ctx.nickname(died.player_id)} did not survive the night. ${ctx.nickname(died.player_id)} was ${article(roleWord)} ${roleWord}.`
          : `${ctx.nickname(died.player_id)} did not survive the night.` },
    ]);
    s.morning_summary = {
      died_id: died.player_id,
      died_role: revealRole ? died.role : null,
      saved: false,
    };
  } else {
    say(ctx, [
      { clips: ['cues/morning_comes'], text: 'Morning comes over the village.' },
      { clips: ['outcomes/survived'], text: 'Everybody survived the night.' },
    ]);
    s.morning_summary = { died_id: null, died_role: null, saved: !!(target && target === protectedId) };
  }

  // The doctor is never told whether the save landed (§12.7).
  const doctor = ctx.byRole('doctor')[0];
  if (doctor) doctor.private.protected_last_night = protectedId;

  ctx.setPhase('morning', { seconds: MORNING_SECONDS });
}

function enterDayDiscuss(ctx: GameCtx): void {
  ctx.round.day_number += 1;
  ctx.clearPhaseActions('day_discuss');
  ctx.setPhase('day_discuss', { seconds: ctx.settings.night_village.discussion_seconds });
}

function enterDayVote(ctx: GameCtx): void {
  ctx.clearPhaseActions('day_vote');
  ctx.setPhase('day_vote', { seconds: 60, pendingOn: ctx.livingIds() });
}

/** Spec §12.7 day vote — strictly more than half of the LIVING, abstentions included in L. */
function enterEvening(ctx: GameCtx): void {
  const s = ctx.round.state;
  const living = ctx.livingIds();
  const L = living.length;

  const votes = ctx.actionsIn('day_vote', 'day_vote').map((a) => ({
    voter_id: a.player_id,
    target_id: (a.payload.target_id ?? null) as string | null,
  }));

  const counts = new Map<string, number>();
  for (const v of votes) if (v.target_id) counts.set(v.target_id, (counts.get(v.target_id) ?? 0) + 1);

  let eliminatedId: string | null = null;
  for (const [target, c] of counts) if (c > L / 2) eliminatedId = target;

  const revealRole = ctx.settings.night_village.reveal_role_on_death;
  let removed: RoundPlayerRow | undefined;
  if (eliminatedId) removed = eliminate(ctx, eliminatedId, 'vote');

  s.day_result = {
    votes,
    eliminated_id: eliminatedId,
    eliminated_role: removed && revealRole ? removed.role : null,
  };

  if (removed) {
    const roleWord = roleLabel(removed.role);
    say(ctx, [
      {
        clips: [nameClip(ctx, removed.player_id), 'outcomes/voted_out'],
        text: revealRole
          ? `The village votes out ${ctx.nickname(removed.player_id)}. ${ctx.nickname(removed.player_id)} was ${article(roleWord)} ${roleWord}.`
          : `The village votes out ${ctx.nickname(removed.player_id)}.`,
      },
    ]);
  } else {
    say(ctx, [
      { clips: ['outcomes/no_majority'], text: 'The village cannot agree. Nobody is voted out.' },
    ]);
  }

  ctx.setPhase('evening', { seconds: EVENING_SECONDS });
}

function roleLabel(role: string): string {
  return role === 'wolf' ? 'Wolf' : role === 'seer' ? 'Seer' : role === 'doctor' ? 'Doctor' : 'Villager';
}
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

// ---------------------------------------------------------------
// Module
// ---------------------------------------------------------------

export const nightVillageServer: ServerGame = {
  id: 'night_village',
  minPlayers: 6,
  maxPlayers: 12,

  setup(ctx) {
    const cfg = ctx.settings.night_village;
    const ids = shuffle(ctx.present().map((r) => r.player_id));
    const n = ids.length;

    const roles: NvRole[] = [];
    for (let i = 0; i < wolvesFor(n); i++) roles.push('wolf');
    if (cfg.include_seer) roles.push('seer');
    if (cfg.include_doctor) roles.push('doctor');
    while (roles.length < n) roles.push('villager');

    const wolfIds = ids.filter((_, i) => roles[i] === 'wolf');

    for (const rp of ctx.rps) {
      const i = ids.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.is_alive = i >= 0;
      const role = i >= 0 ? roles[i] : 'villager';
      rp.role = role;
      switch (role) {
        case 'wolf':
          rp.private = { fellow_wolves: wolfIds.filter((id) => id !== rp.player_id) };
          break;
        case 'seer':
          rp.private = { checks: [] };
          break;
        case 'doctor':
          rp.private = { protected_last_night: null, self_protects_used: 0 };
          break;
        default:
          rp.private = {};
      }
    }

    ctx.round.state = {
      night_kill_target: null,
      night_protect_target: null,
      eliminations: [],
      narration: { seq: 0, lines: [] },
    };
    ctx.round.day_number = 0;
    ctx.setPhase('reveal', {
      seconds: REVEAL_SAFETY_SECONDS,
      pendingOn: ctx.present().map((r) => r.player_id),
    });
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const base = {
      narration: s.narration ?? { seq: 0, lines: [] },
      eliminations: s.eliminations ?? [],
      day_number: ctx.round.day_number,
      living_count: ctx.livingIds().length,
    };

    switch (ctx.round.phase) {
      case 'night_wolves':
      case 'night_seer':
      case 'night_doctor':
        // Nothing about who is acting or what they chose. §12.12 screen 2.
        return { ...base, acting_role: ctx.round.phase.replace('night_', '') };
      case 'morning':
        return { ...base, morning: s.morning_summary ?? null };
      case 'day_discuss': {
        const skips = new Set(ctx.actionsIn('day_discuss', 'skip_discussion').map((a) => a.player_id));
        return {
          ...base,
          skip_votes: skips.size,
          skip_needed: Math.floor(ctx.livingIds().length / 2) + 1,
        };
      }
      case 'day_vote':
        return {
          ...base,
          votes_cast: new Set(ctx.actionsIn('day_vote', 'day_vote').map((a) => a.player_id)).size,
          votes_needed: ctx.livingIds().length,
        };
      case 'evening':
        return { ...base, day_result: s.day_result ?? null };
      case 'result':
        return {
          ...base,
          roles: ctx.rps.map((r) => ({ player_id: r.player_id, role: r.role, is_alive: r.is_alive })),
          winner: (ctx.round.result as any)?.winner ?? null,
        };
      default:
        return base;
    }
  },

  privateView(ctx, rp) {
    const priv = { ...(rp.private ?? {}) };

    // Wolves converge without speaking (§12.7) — but only wolves see this.
    if (rp.role === 'wolf' && ctx.round.phase === 'night_wolves') {
      priv.wolf_votes = ctx
        .actionsIn('night_wolves', 'wolf_vote')
        .map((a) => ({ wolf_id: a.player_id, target_id: a.payload.target_id }));
    }
    return priv;
  },

  roleVisibleTo(ctx, viewer, subject) {
    if (ctx.round.phase === 'result') return true;
    // Ghost view (§12.9): the dead watch with full information.
    if (viewer && (!viewer.is_alive || ctx.hasLeft(viewer.player_id))) return true;
    if (!subject.is_alive && ctx.settings.night_village.reveal_role_on_death) return true;
    return false;
  },

  hasActed(ctx, rp) {
    switch (ctx.round.phase) {
      case 'reveal':
        return !!ctx.actionBy('reveal', 'revealed', rp.player_id);
      case 'night_wolves':
        return !!ctx.actionBy('night_wolves', 'wolf_vote', rp.player_id);
      case 'night_seer':
        return !!ctx.actionBy('night_seer', 'seer_check', rp.player_id);
      case 'night_doctor':
        return !!ctx.actionBy('night_doctor', 'doctor_protect', rp.player_id);
      case 'day_vote':
        return !!ctx.actionBy('day_vote', 'day_vote', rp.player_id);
      default:
        return true;
    }
  },

  action(ctx, rp, kind, payload) {
    const phase = ctx.round.phase;
    const s = ctx.round.state;
    const targetId = payload.target_id as string | null;

    const assertLivingTarget = (allowSelf: boolean) => {
      const t = targetId ? ctx.rp(targetId) : undefined;
      if (!t || !t.is_alive || ctx.hasLeft(t.player_id)) throw new HearthError('invalid_target');
      if (!allowSelf && t.player_id === rp.player_id) throw new HearthError('invalid_target');
      return t;
    };

    if (phase === 'reveal' && kind === 'revealed') {
      ctx.putAction(rp.player_id, 'revealed', {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (!rp.is_alive) throw new HearthError('wrong_phase'); // the dead act never (§12.9)

    if (phase === 'night_wolves' && kind === 'wolf_vote') {
      if (rp.role !== 'wolf') throw new HearthError('not_your_turn');
      assertLivingTarget(false);
      ctx.putAction(rp.player_id, 'wolf_vote', { target_id: targetId });

      // The phase ends only on unanimity (§12.7), not on "everyone clicked".
      const wolves = livingWithRole(ctx, 'wolf');
      const votes = ctx.actionsIn('night_wolves', 'wolf_vote');
      const allVoted = wolves.every((w) => votes.some((v) => v.player_id === w.player_id));
      const unanimous =
        allVoted && new Set(votes.map((v) => v.payload.target_id)).size === 1;
      if (unanimous) {
        s.locked_wolf_target = votes[0].payload.target_id;
        ctx.round.pending_on = [];
      }
      return;
    }

    if (phase === 'night_seer' && kind === 'seer_check') {
      if (rp.role !== 'seer') throw new HearthError('not_your_turn');
      const t = assertLivingTarget(false);
      const checks = (rp.private.checks ?? []) as { target_id: string }[];
      if (checks.some((c) => c.target_id === t.player_id)) throw new HearthError('invalid_target');

      // Computed here and delivered only into the seer's own private view.
      rp.private.checks = [
        ...checks,
        { day: ctx.round.day_number, target_id: t.player_id, is_wolf: t.role === 'wolf' },
      ];
      ctx.putAction(rp.player_id, 'seer_check', { target_id: t.player_id });
      ctx.clearPending(rp.player_id);
      return;
    }

    if (phase === 'night_doctor' && kind === 'doctor_protect') {
      if (rp.role !== 'doctor') throw new HearthError('not_your_turn');
      const mode = ctx.settings.night_village.doctor_self_protect;
      const isSelf = targetId === rp.player_id;
      if (isSelf) {
        if (mode === 'never') throw new HearthError('invalid_target');
        if (mode === 'once' && (rp.private.self_protects_used ?? 0) >= 1)
          throw new HearthError('invalid_target');
      }
      const t = assertLivingTarget(true);
      if (rp.private.protected_last_night === t.player_id) throw new HearthError('invalid_target');

      if (isSelf) rp.private.self_protects_used = (rp.private.self_protects_used ?? 0) + 1;
      s.night_protect_target = t.player_id;
      ctx.putAction(rp.player_id, 'doctor_protect', { target_id: t.player_id });
      ctx.clearPending(rp.player_id);
      return;
    }

    if (phase === 'day_discuss' && kind === 'skip_discussion') {
      if (ctx.actionBy('day_discuss', 'skip_discussion', rp.player_id)) {
        ctx.dropAction(rp.player_id, 'skip_discussion');
        return;
      }
      ctx.putAction(rp.player_id, 'skip_discussion', {});
      const skips = new Set(
        ctx.actionsIn('day_discuss', 'skip_discussion').map((a) => a.player_id),
      ).size;
      if (skips > ctx.livingIds().length / 2) enterDayVote(ctx);
      return;
    }

    if (phase === 'day_vote' && kind === 'day_vote') {
      if (targetId !== null && targetId !== undefined) assertLivingTarget(true);
      ctx.putAction(rp.player_id, 'day_vote', { target_id: targetId ?? null });
      ctx.clearPending(rp.player_id);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'reveal':
        enterNightWolves(ctx);
        return;

      case 'night_wolves': {
        if (s.locked_wolf_target) {
          s.night_kill_target = s.locked_wolf_target;
        } else {
          // §19.2 — random among targets that got at least one vote, else nobody.
          const votes = ctx
            .actionsIn('night_wolves', 'wolf_vote')
            .map((a) => a.payload.target_id as string)
            .filter(Boolean);
          s.night_kill_target = votes.length ? pick(votes) : null;
        }
        enterAfterWolves(ctx);
        return;
      }

      case 'night_seer':
        enterAfterSeer(ctx);
        return;

      case 'night_doctor':
        enterMorning(ctx);
        return;

      case 'morning': {
        const w = checkWin(ctx);
        if (w) return endGame(ctx, w);
        enterDayDiscuss(ctx);
        return;
      }

      case 'day_discuss':
        enterDayVote(ctx);
        return;

      case 'day_vote':
        enterEvening(ctx);
        return;

      case 'evening': {
        const w = checkWin(ctx);
        if (w) return endGame(ctx, w);
        enterNightWolves(ctx);
        return;
      }

      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    const rp = ctx.rp(playerId);
    if (!rp || !rp.is_alive) return;

    // §19.3 — treated as eliminated, with a neutral announcement.
    eliminate(ctx, playerId, 'left');
    say(ctx, [
      { clips: [nameClip(ctx, playerId), 'outcomes/left'], text: `${ctx.nickname(playerId)} has left the village.` },
    ]);

    if (ctx.present().length < 4) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }
    const w = checkWin(ctx);
    if (w) endGame(ctx, w);
  },

  applyStats(ctx, result) {
    const winner = (result as any).winner as 'village' | 'wolves';
    for (const rp of ctx.rps) {
      const isWolf = rp.role === 'wolf';
      const won = (winner === 'wolves') === isWolf;
      ctx.bumpStats(rp.player_id, 'night_village', {
        games_played: 1,
        games_won: won ? 1 : 0,
        times_hidden: isWolf ? 1 : 0,
        times_caught:
          isWolf &&
          (ctx.round.state.eliminations ?? []).some(
            (e: any) => e.player_id === rp.player_id && e.cause === 'vote',
          )
            ? 1
            : 0,
        points: rp.is_alive ? 1 : 0, // survival count, surfaced as survival rate
      });
    }
  },
};
