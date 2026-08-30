import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { NerveSettings } from '@/types';
import { shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Nerve — four scraps of paper each, three dots and one X.
//
// The scraps are the one thing this server never sees. It knows how many
// are on the table and what was claimed out loud; whether the thing you
// just turned over is a dot or an X is reported by the player who flipped
// it, in front of everyone, exactly as it works on a real table.
// ---------------------------------------------------------------

export const SCRAPS_PER_PLAYER = 4;
/** Seconds the table spends looking at how the round went. */
export const ROUND_END_SECONDS = 8;

export type NerveOutcome = 'made' | 'hit_x' | 'no_flip' | 'abandoned';

export interface NerveRoundRecord {
  round_no: number;
  challenger_id: string | null;
  bid: number;
  flips_done: number;
  outcome: NerveOutcome;
}

export interface NerveStanding {
  player_id: string;
  wins: number;
  scraps: number;
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): NerveSettings {
  return { ...DEFAULT_SETTINGS.nerve, ...((ctx.settings as any).nerve ?? {}) };
}

function order(ctx: GameCtx): string[] {
  const s = ctx.round.state;
  return (s.order ?? []) as string[];
}

function held(ctx: GameCtx, pid: string): number {
  return ctx.round.state.held?.[pid] ?? 0;
}

function pile(ctx: GameCtx, pid: string): number {
  return ctx.round.state.pile?.[pid] ?? 0;
}

function flipped(ctx: GameCtx, pid: string): number {
  return ctx.round.state.flipped?.[pid] ?? 0;
}

/** Still here, still holding scraps. */
function inPlay(ctx: GameCtx, pid: string): boolean {
  return !ctx.hasLeft(pid) && held(ctx, pid) > 0;
}

function playersInPlay(ctx: GameCtx): string[] {
  return order(ctx).filter((pid) => inPlay(ctx, pid));
}

/** Everyone who has not yet passed out of the bidding. */
function contenders(ctx: GameCtx): string[] {
  const passed = new Set((ctx.round.state.passed ?? []) as string[]);
  return playersInPlay(ctx).filter((pid) => !passed.has(pid));
}

/** Scraps face down on the table right now — the ceiling on any bid. */
export function tableTotal(ctx: GameCtx): number {
  return playersInPlay(ctx).reduce((sum, pid) => sum + pile(ctx, pid), 0);
}

function currentBid(ctx: GameCtx): { player_id: string; amount: number } | null {
  return ctx.round.state.bid ?? null;
}

/** Next contender after `from` in seating order. */
function nextContender(ctx: GameCtx, from: string | null): string | null {
  const pool = contenders(ctx);
  if (pool.length === 0) return null;
  const ids = order(ctx);
  const start = from ? ids.indexOf(from) : -1;
  for (let i = 1; i <= ids.length; i++) {
    const id = ids[(start + i + ids.length) % ids.length];
    if (pool.includes(id)) return id;
  }
  return pool[0];
}

// ---------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------

function beginRound(ctx: GameCtx): void {
  const s = ctx.round.state;
  const playing = playersInPlay(ctx);
  if (playing.length < 2) return finish(ctx, playing[0] ?? null, 'last_standing');

  s.pile = {};
  s.flipped = {};
  s.passed = [];
  s.bid = null;
  s.challenger = null;
  s.flips_done = 0;
  s.turn = null;
  for (const pid of playing) {
    s.pile[pid] = 0;
    s.flipped[pid] = 0;
  }
  if (!playing.includes(s.starter)) s.starter = playing[0];

  ctx.setPhase('place', { seconds: cfg(ctx).place_seconds, pendingOn: playing });
}

function beginTurns(ctx: GameCtx): void {
  const s = ctx.round.state;
  const pool = contenders(ctx);
  if (pool.length === 0) return enterRoundEnd(ctx, 'abandoned');

  s.turn = pool.includes(s.starter) ? s.starter : pool[0];
  ctx.setPhase('turn', { seconds: cfg(ctx).turn_seconds, pendingOn: [s.turn] });
}

/** After any turn action: either the challenge is settled, or play moves on. */
function afterTurn(ctx: GameCtx): void {
  const s = ctx.round.state;
  const bid = currentBid(ctx);
  const pool = contenders(ctx);

  if (bid && !inPlay(ctx, bid.player_id)) {
    // The high bidder walked out from under their own claim.
    return enterRoundEnd(ctx, 'abandoned');
  }
  if (bid && pool.length <= 1) {
    s.challenger = bid.player_id;
    s.flips_done = 0;
    ctx.setPhase('flip', { seconds: cfg(ctx).turn_seconds, pendingOn: [bid.player_id] });
    return;
  }
  if (pool.length === 0) return enterRoundEnd(ctx, 'abandoned');

  s.turn = nextContender(ctx, s.turn);
  if (!s.turn) return enterRoundEnd(ctx, 'abandoned');
  ctx.setPhase('turn', { seconds: cfg(ctx).turn_seconds, pendingOn: [s.turn] });
}

function enterRoundEnd(ctx: GameCtx, outcome: NerveOutcome): void {
  const s = ctx.round.state;
  const challenger: string | null = s.challenger ?? null;
  const bidAmount = currentBid(ctx)?.amount ?? 0;

  if (outcome === 'made' && challenger) {
    s.wins[challenger] = (s.wins[challenger] ?? 0) + 1;
  }
  if ((outcome === 'hit_x' || outcome === 'no_flip') && challenger) {
    // One scrap gone for good. Which one is the table's business, not ours.
    s.held[challenger] = Math.max(0, (s.held[challenger] ?? 0) - 1);
  }

  const record: NerveRoundRecord = {
    round_no: s.round_no,
    challenger_id: challenger,
    bid: bidAmount,
    flips_done: s.flips_done ?? 0,
    outcome,
  };
  s.last = record;
  s.history = [...(s.history ?? []), record];

  // Whoever took the challenge starts the next round.
  if (challenger && inPlay(ctx, challenger)) s.starter = challenger;
  else s.starter = nextContender(ctx, s.starter) ?? playersInPlay(ctx)[0] ?? s.starter;

  ctx.setPhase('round_end', { seconds: ROUND_END_SECONDS });
}

function winnerByWins(ctx: GameCtx): string | null {
  const s = ctx.round.state;
  const needed = cfg(ctx).wins_needed;
  for (const pid of order(ctx)) {
    if ((s.wins[pid] ?? 0) >= needed) return pid;
  }
  return null;
}

function finish(ctx: GameCtx, winnerId: string | null, reason: string): void {
  const s = ctx.round.state;
  const standings: NerveStanding[] = order(ctx)
    .filter((pid) => !ctx.hasLeft(pid))
    .map((pid) => ({ player_id: pid, wins: s.wins[pid] ?? 0, scraps: held(ctx, pid) }))
    .sort((a, b) => b.wins - a.wins || b.scraps - a.scraps);

  ctx.endRound({
    winner_id: winnerId,
    reason,
    wins_needed: cfg(ctx).wins_needed,
    standings,
    history: s.history ?? [],
  });
}

// ---------------------------------------------------------------

export const nerveServer: ServerGame = {
  id: 'nerve',
  minPlayers: 3,
  maxPlayers: 6,

  setup(ctx) {
    const seating = shuffle(ctx.present().map((r) => r.player_id));
    const heldMap: Record<string, number> = {};
    const wins: Record<string, number> = {};

    for (const rp of ctx.rps) {
      const i = seating.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {}; // there is nothing secret to hand a device
      heldMap[rp.player_id] = SCRAPS_PER_PLAYER;
      wins[rp.player_id] = 0;
    }

    ctx.round.state = {
      order: seating,
      held: heldMap,
      wins,
      pile: {},
      flipped: {},
      passed: [],
      bid: null,
      turn: null,
      challenger: null,
      flips_done: 0,
      round_no: 1,
      starter: seating[0],
      history: [],
      last: null,
    };
    beginRound(ctx);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    // All of it is public: this game's only hidden information is on paper
    // and in people's faces.
    const base = {
      round_no: s.round_no ?? 1,
      wins_needed: cfg(ctx).wins_needed,
      scraps_per_player: SCRAPS_PER_PLAYER,
      order: s.order ?? [],
      held: s.held ?? {},
      wins: s.wins ?? {},
      pile: s.pile ?? {},
      flipped: s.flipped ?? {},
      passed: s.passed ?? [],
      bid: s.bid ?? null,
      table_total: tableTotal(ctx),
      turn: s.turn ?? null,
      challenger: s.challenger ?? null,
      flips_done: s.flips_done ?? 0,
      history: s.history ?? [],
      last: s.last ?? null,
    };

    switch (ctx.round.phase) {
      case 'place':
        return { ...base, turn: null, challenger: null };
      default:
        return base;
    }
  },

  privateView() {
    return {}; // by design: the server holds no secret of yours
  },

  roleVisibleTo() {
    return true; // Nerve has no hidden roles.
  },

  hasActed(ctx, rp) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'place':
        return !inPlay(ctx, rp.player_id) || pile(ctx, rp.player_id) > 0;
      case 'turn':
        return rp.player_id !== s.turn;
      case 'flip':
        return rp.player_id !== s.challenger;
      default:
        return true;
    }
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;
    const me = rp.player_id;

    if (ctx.round.phase === 'place' && kind === 'place') {
      if (!inPlay(ctx, me)) throw new HearthError('not_your_turn');
      if (pile(ctx, me) > 0) throw new HearthError('already_acted');
      s.pile[me] = 1;
      ctx.clearPending(me);
      return;
    }

    if (ctx.round.phase === 'turn') {
      if (me !== s.turn) throw new HearthError('not_your_turn');

      if (kind === 'place') {
        // Once a number has been said out loud, no more scraps go down.
        if (currentBid(ctx)) throw new HearthError('wrong_phase');
        if (pile(ctx, me) >= held(ctx, me)) throw new HearthError('invalid_target');
        s.pile[me] = pile(ctx, me) + 1;
        afterTurn(ctx);
        return;
      }

      if (kind === 'bid') {
        const amount = Math.trunc(Number(payload.amount));
        const floor = (currentBid(ctx)?.amount ?? 0) + 1;
        if (!Number.isFinite(amount) || amount < floor || amount > tableTotal(ctx)) {
          throw new HearthError('invalid_target');
        }
        s.bid = { player_id: me, amount };
        s.passed = ((s.passed ?? []) as string[]).filter((pid) => pid !== me);
        afterTurn(ctx);
        return;
      }

      if (kind === 'pass') {
        // There is nothing to pass on until somebody has claimed a number.
        if (!currentBid(ctx)) throw new HearthError('wrong_phase');
        if (currentBid(ctx)!.player_id === me) throw new HearthError('invalid_target');
        if (!((s.passed ?? []) as string[]).includes(me)) s.passed = [...s.passed, me];
        afterTurn(ctx);
        return;
      }
    }

    if (ctx.round.phase === 'flip' && kind === 'flip') {
      if (me !== s.challenger) throw new HearthError('not_your_turn');

      const targetId = String(payload.target_id ?? '');
      const target = ctx.rp(targetId);
      if (!target) throw new HearthError('invalid_target');
      if (flipped(ctx, targetId) >= pile(ctx, targetId)) throw new HearthError('invalid_target');
      // Your own stack first, top down — no cherry-picking other people
      // while your own X is still buried.
      if (flipped(ctx, me) < pile(ctx, me) && targetId !== me) {
        throw new HearthError('invalid_target');
      }

      s.flipped[targetId] = flipped(ctx, targetId) + 1;

      if (payload.hit === true) {
        enterRoundEnd(ctx, 'hit_x');
        return;
      }
      s.flips_done = (s.flips_done ?? 0) + 1;
      if (s.flips_done >= (currentBid(ctx)?.amount ?? 0)) {
        enterRoundEnd(ctx, 'made');
        return;
      }
      // Still going: the same player keeps the phase, with a fresh clock.
      ctx.setPhase('flip', { seconds: cfg(ctx).turn_seconds, pendingOn: [me] });
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;

    switch (ctx.round.phase) {
      case 'place': {
        // §19.2 — a scrap goes down for anyone who did not place one.
        for (const pid of playersInPlay(ctx)) {
          if (pile(ctx, pid) === 0) s.pile[pid] = 1;
        }
        beginTurns(ctx);
        return;
      }

      case 'turn': {
        const me: string | null = s.turn;
        if (!me) return beginTurns(ctx);
        const bid = currentBid(ctx);

        if (bid && bid.player_id !== me) {
          if (!((s.passed ?? []) as string[]).includes(me)) s.passed = [...s.passed, me];
        } else if (!bid && pile(ctx, me) < held(ctx, me)) {
          s.pile[me] = pile(ctx, me) + 1;
        } else {
          // Nothing left to place and no claim to hide behind: the clock
          // makes the smallest legal claim on their behalf.
          const floor = (bid?.amount ?? 0) + 1;
          if (floor <= tableTotal(ctx)) s.bid = { player_id: me, amount: floor };
          else if (!((s.passed ?? []) as string[]).includes(me)) s.passed = [...s.passed, me];
        }
        afterTurn(ctx);
        return;
      }

      case 'flip':
        // Did not flip in time — treated exactly like turning over an X.
        enterRoundEnd(ctx, 'no_flip');
        return;

      case 'round_end': {
        const champion = winnerByWins(ctx);
        if (champion) return finish(ctx, champion, 'wins');
        const playing = playersInPlay(ctx);
        if (playing.length < 2) return finish(ctx, playing[0] ?? null, 'last_standing');
        s.round_no += 1;
        beginRound(ctx);
        return;
      }

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
    if (ctx.round.phase === 'result' || ctx.round.ended_at) return;

    // Their scraps leave the table with them.
    if (s.pile) s.pile[playerId] = 0;
    if (s.flipped) s.flipped[playerId] = 0;
    s.passed = ((s.passed ?? []) as string[]).filter((pid) => pid !== playerId);

    const bid = currentBid(ctx);
    const wasChallenger = s.challenger === playerId;
    const wasBidder = bid?.player_id === playerId;

    if (wasChallenger || wasBidder) {
      // The claim on the table belonged to them: void the round rather
      // than hand somebody else a challenge they never took.
      s.challenger = null;
      s.bid = null;
      enterRoundEnd(ctx, 'abandoned');
      return;
    }

    if (ctx.round.phase === 'turn' && s.turn === playerId) {
      afterTurn(ctx);
      return;
    }
    if (ctx.round.phase === 'place') {
      // The engine ends the phase once everyone still here has placed.
      return;
    }
  },

  applyStats(ctx, result) {
    const winnerId = (result as any).winner_id ?? null;
    const standings = ((result as any).standings ?? []) as NerveStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'nerve', {
        games_played: 1,
        games_won: st.player_id === winnerId ? 1 : 0,
        points: st.wins,
      });
    }
  },
};
