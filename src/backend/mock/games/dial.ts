import { HearthError } from '@/types';
import { randInt, shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

const REVEAL_SECONDS = 10;

export interface DialSubRound {
  clue_giver_id: string;
  spectrum: { left: string; right: string };
  clue: string;
  target: number;
  guess: number | null;
  points: number;
  skipped?: boolean;
}

/** Spec §13.1 scoring band. */
export function scoreFor(target: number, guess: number): number {
  const d = Math.abs(target - guess);
  if (d <= 3) return 4;
  if (d <= 8) return 3;
  if (d <= 15) return 2;
  return 0;
}

function orderedIds(ctx: GameCtx): string[] {
  return ctx.rps
    .filter((r) => r.turn_index != null)
    .sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0))
    .map((r) => r.player_id);
}

/** First present player at or after `from` in turn order. */
function nextPresent(ctx: GameCtx, from: number): string | null {
  const ids = orderedIds(ctx);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[(from + i) % ids.length];
    if (!ctx.hasLeft(id)) return id;
  }
  return null;
}

/** Spec §13.3 per-sub-round setup. */
function beginSubRound(ctx: GameCtx): void {
  const s = ctx.round.state;
  const ids = orderedIds(ctx);
  const n = ids.length;

  if (s.round_index >= s.total_rounds) return finish(ctx);

  const taken = ctx.takeContent('dial');
  if (!taken) throw new HearthError('content_exhausted');
  if (taken.bankReset) s.bank_reset = true;

  const clueGiver = nextPresent(ctx, s.round_index % n);
  const dialHolder = nextPresent(ctx, (s.round_index + 1) % n);
  if (!clueGiver || !dialHolder) return finish(ctx);

  const target = randInt(4, 96);

  s.clue_giver_id = clueGiver;
  s.dial_holder_id = dialHolder === clueGiver ? (nextPresent(ctx, (s.round_index + 2) % n) ?? dialHolder) : dialHolder;
  s.spectrum = { left: taken.item.payload.left, right: taken.item.payload.right };
  s.target = target;
  s.clue = null;
  s.guess = null;
  s.points = null;

  // The target reaches exactly one device (§13.3, M3 acceptance criterion 2).
  for (const rp of ctx.rps) {
    rp.private = rp.player_id === clueGiver ? { target, spectrum: s.spectrum } : {};
  }

  ctx.clearPhaseActions('clue');
  ctx.clearPhaseActions('guess');
  ctx.setPhase('clue', {
    seconds: ctx.settings.dial.clue_seconds,
    pendingOn: [clueGiver],
  });
}

function enterGuess(ctx: GameCtx): void {
  const s = ctx.round.state;
  ctx.setPhase('guess', {
    seconds: ctx.settings.dial.discussion_seconds,
    pendingOn: [s.dial_holder_id],
  });
}

function enterReveal(ctx: GameCtx): void {
  const s = ctx.round.state;
  const guess = typeof s.guess === 'number' ? s.guess : 50;
  const points = s.skip_score ? 0 : scoreFor(s.target, guess);

  s.guess = guess;
  s.points = points;
  s.total_score = (s.total_score ?? 0) + points;
  (s.history as DialSubRound[]).push({
    clue_giver_id: s.clue_giver_id,
    spectrum: s.spectrum,
    clue: s.clue ?? '',
    target: s.target,
    guess,
    points,
    skipped: !!s.skip_score,
  });
  s.skip_score = false;

  ctx.setPhase('reveal', { seconds: REVEAL_SECONDS });
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  ctx.endRound({
    total_score: s.total_score ?? 0,
    max_possible: (s.history as DialSubRound[]).length * 4,
    rounds: s.history ?? [],
    bank_reset: !!s.bank_reset,
  });
}

export const dialServer: ServerGame = {
  id: 'dial',
  minPlayers: 3,
  maxPlayers: 10,

  setup(ctx) {
    const order = shuffle(ctx.present().map((r) => r.player_id));
    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {};
    }
    const n = order.length;
    ctx.round.state = {
      round_index: 0,
      total_rounds: ctx.settings.dial.rounds_per_game ?? n,
      total_score: 0,
      history: [] as DialSubRound[],
    };
    beginSubRound(ctx);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const base = {
      round_index: s.round_index,
      total_rounds: s.total_rounds,
      total_score: s.total_score ?? 0,
      spectrum: s.spectrum ?? null,
      clue_giver_id: s.clue_giver_id ?? null,
      dial_holder_id: s.dial_holder_id ?? null,
      history: s.history ?? [],
    };

    switch (ctx.round.phase) {
      case 'clue':
        // No clue and no target: everyone else is just waiting.
        return { ...base, clue: null, target: null, guess: null };
      case 'guess':
        // The clue is public the moment it is submitted (§13.5).
        return { ...base, clue: s.clue ?? '', target: null, guess: s.guess ?? null };
      case 'reveal':
        return {
          ...base,
          clue: s.clue ?? '',
          target: s.target,
          guess: s.guess,
          points: s.points,
        };
      case 'result':
        return { ...base, clue: null, target: null, guess: null };
      default:
        return base;
    }
  },

  privateView(_ctx, rp) {
    return rp.private ?? {};
  },

  roleVisibleTo() {
    return true; // Dial has no hidden roles.
  },

  hasActed(ctx, rp) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'clue':
        return rp.player_id !== s.clue_giver_id || !!s.clue;
      case 'guess':
        return rp.player_id !== s.dial_holder_id || !!s.locked;
      default:
        return true;
    }
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'clue' && kind === 'clue_given') {
      if (rp.player_id !== s.clue_giver_id) throw new HearthError('not_your_turn');
      const clue = String(payload.clue ?? '').slice(0, 80).trim();
      s.clue = clue;
      ctx.putAction(rp.player_id, 'clue_given', { clue });
      ctx.clearPending(rp.player_id);
      return;
    }

    if (ctx.round.phase === 'guess' && kind === 'dial_set') {
      if (rp.player_id !== s.dial_holder_id) throw new HearthError('not_your_turn');
      const pos = Math.round(Number(payload.position));
      if (!Number.isFinite(pos) || pos < 0 || pos > 100) throw new HearthError('invalid_target');
      s.guess = pos;
      ctx.putAction(rp.player_id, 'dial_set', { position: pos, locked: !!payload.locked });
      if (payload.locked) {
        s.locked = true;
        ctx.clearPending(rp.player_id);
      }
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'clue':
        if (s.clue == null) s.clue = ''; // §19.2 — empty clue on timeout
        enterGuess(ctx);
        return;
      case 'guess':
        s.locked = false;
        enterReveal(ctx);
        return;
      case 'reveal':
        s.round_index += 1;
        if (s.round_index >= s.total_rounds) finish(ctx);
        else beginSubRound(ctx);
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    const s = ctx.round.state;
    ctx.clearPending(playerId);

    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }

    // §19.3 — a lost clue-giver forfeits the sub-round; a lost dial-holder
    // is simply replaced by the next player in turn order.
    if (playerId === s.clue_giver_id && ctx.round.phase !== 'reveal') {
      s.skip_score = true;
      s.clue = s.clue ?? '';
      s.guess = 50;
      enterReveal(ctx);
      return;
    }
    if (playerId === s.dial_holder_id) {
      const rp = ctx.rp(playerId);
      const replacement = nextPresent(ctx, ((rp?.turn_index ?? 0) + 1) % Math.max(1, orderedIds(ctx).length));
      if (replacement && replacement !== s.clue_giver_id) {
        s.dial_holder_id = replacement;
        if (ctx.round.phase === 'guess') {
          ctx.round.pending_on = [replacement];
        }
      }
    }
  },

  applyStats(ctx, result) {
    // Cooperative (§13.8): no wins recorded, the score is the shared trophy.
    const total = (result as any).total_score ?? 0;
    for (const rp of ctx.rps) {
      ctx.bumpStats(rp.player_id, 'dial', { games_played: 1, points: total });
    }
  },
};
