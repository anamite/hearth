
import { HearthError } from '@/types';
import { shuffle, weightedPick } from '@/lib/random';
import { guessMatches } from '@/lib/text';
import { avatarColor } from '@/lib/constants';
import type { RoundPlayerRow } from '../db';
import type { GameCtx, ServerGame } from '../engine';

export interface Stroke {
  player_id: string;
  pass: number;
  points: [number, number][];
  color: string;
  width: number;
}

const MAX_POINTS_PER_STROKE = 400;
const MAX_REROLLS = 3;
const REVEAL_SAFETY_SECONDS = 180;
const TURN_SECONDS = 45;
const VOTING_SECONDS = 90;

/**
 * NOTE ON THE ACTION KEY (deviation from spec §5's unique constraint):
 * a player draws once per pass, so `(round_id, player_id, 'drawing', 'stroke')`
 * would collide on the second pass. Strokes are keyed `stroke:{pass}` instead,
 * which keeps the constraint working as a per-pass idempotency guard.
 */
const strokeKind = (pass: number) => `stroke:${pass}`;
const passKind = (pass: number) => `pass_turn:${pass}`;

// ---------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------

/**
 * Impostor player_id for the group's last `limit` rounds, newest first.
 * Insertion order breaks ties: two rounds can share a started_at, and an
 * arbitrary order there would silently defeat the back-to-back rule.
 * The SQL version orders by `(started_at desc, id desc)` for the same reason.
 */
function impostorHistory(ctx: GameCtx, limit: number): string[] {
  return ctx.db.rounds
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        r.group_id === ctx.round.group_id &&
        r.game_type === 'fake_artist' &&
        r.id !== ctx.round.id &&
        r.ended_at,
    )
    .sort((a, b) => Date.parse(b.r.started_at) - Date.parse(a.r.started_at) || b.i - a.i)
    .map(({ r }) => r)
    .slice(0, limit)
    .map(
      (r) =>
        ctx.db.round_players.find((rp) => rp.round_id === r.id && rp.role === 'impostor')
          ?.player_id ?? '',
    )
    .filter(Boolean);
}

/** Spec §11.3 step 3 — recent impostors are less likely, back-to-back-to-back is barred. */
function chooseImpostor(ctx: GameCtx, candidates: string[]): string {
  const recent = impostorHistory(ctx, 6);
  const lastTwo = recent.slice(0, 2);
  const barred =
    lastTwo.length === 2 && lastTwo[0] === lastTwo[1] ? new Set([lastTwo[0]]) : new Set<string>();

  let eligible = candidates.filter((id) => !barred.has(id));
  if (eligible.length < 3) eligible = candidates;

  return weightedPick(eligible, (id) => 1 / (1 + recent.filter((r) => r === id).length));
}

/** Steps 1–6 of §11.3. Shared by first setup and by reroll. */
function dealWordAndImpostor(ctx: GameCtx): { bankReset: boolean } {
  const taken = ctx.takeContent('fake_artist');
  if (!taken) throw new HearthError('content_exhausted');
  const { item, bankReset } = taken;

  const present = ctx.present();
  const impostorId = chooseImpostor(ctx, present.map((r) => r.player_id));

  const order = shuffle(present.map((r) => r.player_id));
  for (const rp of ctx.rps) {
    const idx = order.indexOf(rp.player_id);
    rp.turn_index = idx >= 0 ? idx : null;
    if (rp.player_id === impostorId) {
      rp.role = 'impostor';
      rp.private = {};
    } else {
      rp.role = 'artist';
      rp.private = {
        word: item.payload.text,
        description: item.payload.description ?? null,
        image_url: item.payload.image_url ?? null,
      };
    }
  }

  ctx.round.state = {
    ...ctx.round.state,
    content_id: item.id,
    word: item.payload.text,
    description: item.payload.description ?? null,
    aliases: item.payload.aliases ?? [String(item.payload.text).toLowerCase()],
    pass: 0,
    turn: 0,
    strokes: [] as Stroke[],
    bank_reset: bankReset || ctx.round.state.bank_reset || false,
  };

  return { bankReset };
}

// ---------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------

function enterReveal(ctx: GameCtx): void {
  ctx.setPhase('reveal', {
    seconds: REVEAL_SAFETY_SECONDS,
    pendingOn: ctx.present().map((r) => r.player_id),
  });
}

function currentDrawer(ctx: GameCtx): RoundPlayerRow | undefined {
  return ctx.rps.find((r) => r.turn_index === ctx.round.state.turn);
}

/** Enters the drawing turn described by state.pass/state.turn, skipping absences. */
function enterDrawingTurn(ctx: GameCtx): void {
  const n = ctx.rps.filter((r) => r.turn_index != null).length;
  const strokesPer = ctx.settings.fake_artist.strokes_per_player;

  for (let guard = 0; guard <= n * strokesPer + 1; guard++) {
    if (ctx.round.state.pass >= strokesPer) return enterVoting(ctx);
    const drawer = currentDrawer(ctx);
    if (drawer && !ctx.hasLeft(drawer.player_id)) {
      ctx.setPhase('drawing', { seconds: TURN_SECONDS, pendingOn: [drawer.player_id] });
      return;
    }
    stepTurn(ctx, n);
  }
  enterVoting(ctx);
}

function stepTurn(ctx: GameCtx, n: number): void {
  ctx.round.state.turn += 1;
  if (ctx.round.state.turn >= n) {
    ctx.round.state.turn = 0;
    ctx.round.state.pass += 1;
  }
}

function enterVoting(ctx: GameCtx): void {
  // §11.4 — a paper-mode round can otherwise reach the vote in seconds.
  const unlockAt = Math.max(
    ctx.now.getTime(),
    Date.parse(ctx.round.started_at) +
      ctx.settings.fake_artist.vote_delay_seconds * 1000,
  );
  ctx.round.state.vote_unlock_at = new Date(unlockAt).toISOString();
  const endsAt = unlockAt + VOTING_SECONDS * 1000;

  ctx.setPhase('voting', { pendingOn: ctx.livingIds() });
  ctx.round.phase_ends_at = new Date(endsAt).toISOString();
}

function tallyVotes(ctx: GameCtx): {
  votes: { voter_id: string; target_id: string }[];
  accusedId: string | null;
} {
  const votes = ctx
    .actionsIn('voting', 'vote')
    .map((a) => ({ voter_id: a.player_id, target_id: a.payload.target_id as string }))
    .filter((v) => !!v.target_id);

  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v.target_id, (counts.get(v.target_id) ?? 0) + 1);

  // Strictly more than half of those who actually voted. Ties favour the
  // Impostor, which falls out of the strict inequality (§11.4).
  const n = votes.length;
  let accusedId: string | null = null;
  for (const [target, c] of counts) {
    if (c > n / 2) accusedId = target;
  }
  return { votes, accusedId };
}

function finishFromVote(ctx: GameCtx): void {
  const { votes, accusedId } = tallyVotes(ctx);
  const impostor = ctx.byRole('impostor')[0];
  ctx.round.state.votes = votes;
  ctx.round.state.accused_id = accusedId;

  if (accusedId && impostor && accusedId === impostor.player_id) {
    ctx.round.state.caught = true;
    ctx.setPhase('guess', {
      seconds: ctx.settings.fake_artist.impostor_guess_seconds,
      pendingOn: [impostor.player_id],
    });
    return;
  }

  ctx.endRound({
    winner: 'impostor',
    reason: accusedId ? 'wrong_accusation' : 'impostor_escaped',
    word: ctx.round.state.word,
    impostor_id: impostor?.player_id ?? null,
    accused_id: accusedId,
    votes,
    guess: null,
    caught: false,
    bank_reset: !!ctx.round.state.bank_reset,
  });
}

function finishFromGuess(ctx: GameCtx): void {
  const impostor = ctx.byRole('impostor')[0];
  const guessAction = impostor
    ? ctx.actionBy('guess', 'word_guess', impostor.player_id)
    : undefined;
  const guess = (guessAction?.payload.text as string) ?? '';
  const correct = guessMatches(guess, ctx.round.state.aliases ?? []);

  ctx.endRound({
    winner: correct ? 'impostor' : 'artists',
    reason: correct ? 'impostor_guessed_word' : 'impostor_caught',
    word: ctx.round.state.word,
    impostor_id: impostor?.player_id ?? null,
    accused_id: ctx.round.state.accused_id ?? null,
    votes: ctx.round.state.votes ?? [],
    guess,
    caught: true,
    bank_reset: !!ctx.round.state.bank_reset,
  });
}

// ---------------------------------------------------------------
// Module
// ---------------------------------------------------------------

export const fakeArtistServer: ServerGame = {
  id: 'fake_artist',
  minPlayers: 4,
  maxPlayers: 10,

  setup(ctx) {
    dealWordAndImpostor(ctx);
    ctx.round.state.reroll_count = 0;
    enterReveal(ctx);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const phase = ctx.round.phase;
    const strokes: Stroke[] = s.strokes ?? [];

    switch (phase) {
      case 'reveal': {
        const requests = new Set(
          ctx.actionsIn('reveal', 'reroll_request').map((a) => a.player_id),
        ).size;
        const present = ctx.present().length;
        return {
          reroll_count: s.reroll_count ?? 0,
          reroll_requests: requests,
          reroll_needed: Math.floor(present / 2) + 1,
          reroll_allowed:
            ctx.settings.fake_artist.allow_reroll && (s.reroll_count ?? 0) < MAX_REROLLS,
          canvas_mode: ctx.settings.fake_artist.canvas_mode,
        };
      }
      case 'drawing':
        return {
          pass: s.pass,
          turn: s.turn,
          passes_total: ctx.settings.fake_artist.strokes_per_player,
          current_player_id: currentDrawer(ctx)?.player_id ?? null,
          canvas_mode: ctx.settings.fake_artist.canvas_mode,
          strokes,
        };
      case 'voting':
        return {
          strokes,
          canvas_mode: ctx.settings.fake_artist.canvas_mode,
          votes_cast: new Set(ctx.actionsIn('voting', 'vote').map((a) => a.player_id)).size,
          votes_needed: ctx.livingIds().length,
          vote_unlock_at: s.vote_unlock_at ?? null,
          // Individual votes are deliberately absent until the phase ends.
        };
      case 'guess':
        return {
          strokes,
          canvas_mode: ctx.settings.fake_artist.canvas_mode,
          accused_id: s.accused_id ?? null,
          votes: s.votes ?? [],
        };
      case 'result':
        return {
          strokes,
          canvas_mode: ctx.settings.fake_artist.canvas_mode,
          word: s.word,
          description: s.description ?? null,
          impostor_id: ctx.byRole('impostor')[0]?.player_id ?? null,
          accused_id: s.accused_id ?? null,
          votes: s.votes ?? [],
          guess: (ctx.round.result as any)?.guess ?? null,
          winner: (ctx.round.result as any)?.winner ?? null,
        };
      default:
        return {};
    }
  },

  privateView(_ctx, rp) {
    // The Impostor's row simply has no word in it — there is nothing to strip.
    return rp.private ?? {};
  },

  roleVisibleTo(ctx, _viewer, _subject) {
    return ctx.round.phase === 'result';
  },

  hasActed(ctx, rp) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'reveal':
        return !!ctx.actionBy('reveal', 'revealed', rp.player_id);
      case 'drawing':
        return (
          !!ctx.actionBy('drawing', strokeKind(s.pass), rp.player_id) ||
          !!ctx.actionBy('drawing', passKind(s.pass), rp.player_id)
        );
      case 'voting':
        return !!ctx.actionBy('voting', 'vote', rp.player_id);
      case 'guess':
        return !!ctx.actionBy('guess', 'word_guess', rp.player_id);
      default:
        return true;
    }
  },

  action(ctx, rp, kind, payload) {
    const phase = ctx.round.phase;
    const s = ctx.round.state;

    if (phase === 'reveal' && kind === 'revealed') {
      ctx.putAction(rp.player_id, 'revealed', {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (phase === 'reveal' && kind === 'reroll_request') {
      if (!ctx.settings.fake_artist.allow_reroll) throw new HearthError('wrong_phase');
      if ((s.reroll_count ?? 0) >= MAX_REROLLS) throw new HearthError('wrong_phase');

      // Toggle: sending again withdraws the request (§11.7).
      if (ctx.actionBy('reveal', 'reroll_request', rp.player_id)) {
        ctx.dropAction(rp.player_id, 'reroll_request');
        return;
      }
      ctx.putAction(rp.player_id, 'reroll_request', {});

      const requests = new Set(
        ctx.actionsIn('reveal', 'reroll_request').map((a) => a.player_id),
      ).size;
      if (requests > ctx.present().length / 2) {
        // §11.5 — new word AND new impostor; the old word stays used.
        const count = (s.reroll_count ?? 0) + 1;
        dealWordAndImpostor(ctx);
        ctx.round.state.reroll_count = count;
        ctx.clearPhaseActions('reveal');
        enterReveal(ctx);
      }
      return;
    }

    if (phase === 'drawing') {
      const drawer = currentDrawer(ctx);
      if (!drawer || drawer.player_id !== rp.player_id) throw new HearthError('not_your_turn');

      if (kind === 'stroke') {
        if (!ctx.settings.fake_artist.canvas_mode) throw new HearthError('wrong_phase');
        const raw = Array.isArray(payload.points) ? payload.points : [];
        const points = raw
          .slice(0, MAX_POINTS_PER_STROKE)
          .map((p: any) => [clamp01(Number(p[0])), clamp01(Number(p[1]))] as [number, number])
          .filter((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (points.length < 2) throw new HearthError('invalid_target');

        const color = avatarColor(ctx.player(rp.player_id)?.avatar_key ?? 'fox');
        const stroke: Stroke = {
          player_id: rp.player_id,
          pass: s.pass,
          points,
          color,
          width: clampWidth(Number(payload.width)),
        };
        ctx.putAction(rp.player_id, strokeKind(s.pass), { count: points.length });
        s.strokes = [...(s.strokes ?? []), stroke];
        ctx.clearPending(rp.player_id);
        return;
      }

      if (kind === 'pass_turn') {
        ctx.putAction(rp.player_id, passKind(s.pass), {});
        ctx.clearPending(rp.player_id);
        return;
      }
    }

    if (phase === 'voting' && kind === 'vote') {
      const unlock = s.vote_unlock_at ? Date.parse(s.vote_unlock_at) : 0;
      if (ctx.now.getTime() < unlock) throw new HearthError('wrong_phase');
      const target = payload.target_id as string;
      const targetRp = ctx.rp(target);
      if (!targetRp || !targetRp.is_alive) throw new HearthError('invalid_target');
      ctx.putAction(rp.player_id, 'vote', { target_id: target }); // overwritable
      ctx.clearPending(rp.player_id);
      return;
    }

    if (phase === 'guess' && kind === 'word_guess') {
      if (rp.role !== 'impostor') throw new HearthError('not_your_turn');
      ctx.putAction(rp.player_id, 'word_guess', { text: String(payload.text ?? '') });
      ctx.clearPending(rp.player_id);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const n = ctx.rps.filter((r) => r.turn_index != null).length;
    switch (ctx.round.phase) {
      case 'reveal':
        // §19.2 — anyone who never tapped is auto-revealed.
        ctx.round.state.pass = 0;
        ctx.round.state.turn = 0;
        enterDrawingTurn(ctx);
        return;
      case 'drawing':
        stepTurn(ctx, n); // a timed-out turn simply records no stroke
        enterDrawingTurn(ctx);
        return;
      case 'voting':
        finishFromVote(ctx);
        return;
      case 'guess':
        finishFromGuess(ctx);
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    const rp = ctx.rp(playerId);
    if (!rp) return;
    ctx.clearPending(playerId);

    if (rp.role === 'impostor') {
      ctx.endRound({ aborted: 'impostor_left', reason: 'impostor_left' });
      return;
    }
    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }
    // Their remaining turns are skipped by enterDrawingTurn's absence check.
  },

  applyStats(ctx, result) {
    const r = result as any;
    for (const rp of ctx.rps) {
      const won =
        (r.winner === 'impostor' && rp.role === 'impostor') ||
        (r.winner === 'artists' && rp.role !== 'impostor');
      ctx.bumpStats(rp.player_id, 'fake_artist', {
        games_played: 1,
        games_won: won ? 1 : 0,
        times_hidden: rp.role === 'impostor' ? 1 : 0,
        times_caught: rp.role === 'impostor' && r.caught ? 1 : 0,
      });
    }
  },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function clampWidth(n: number): number {
  return Number.isFinite(n) ? Math.min(0.05, Math.max(0.002, n)) : 0.008;
}
