import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { BidSettings } from '@/types';
import { shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Bid — fifteen slips, fifteen prizes, and everyone reading everyone.
//
// The rule that makes it: tied high bids cancel. Both players still burn
// the slip, and the prize falls through to the next distinct bid. Which
// is why the obvious 15 on a +10 is rarely the right 15.
// ---------------------------------------------------------------

export const SLIP_MIN = 1;
export const SLIP_MAX = 15;
/** Fifteen slips, fifteen prizes: every slip is spent exactly once. */
export const PRIZE_COUNT = SLIP_MAX;

/** -5..-1 and +1..+10 — five penalties among ten rewards. */
export const PRIZE_VALUES: number[] = [
  -5, -4, -3, -2, -1,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

export interface BidRoundRecord {
  prize: number;
  bids: Record<string, number>;
  winner_id: string | null;
  cancelled: number[];
}

export interface BidStanding {
  player_id: string;
  score: number;
  prizes: number[];
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): BidSettings {
  return { ...DEFAULT_SETTINGS.bid, ...((ctx.settings as any).bid ?? {}) };
}

export function buildPrizes(): number[] {
  return shuffle(PRIZE_VALUES);
}

/**
 * Spec of the whole game in one function.
 *
 * A positive prize goes to the highest bid, a negative one to the lowest.
 * Any value two or more players played is struck out entirely and the
 * prize falls through to the next value down (or up). If every value is
 * contested the prize goes nowhere.
 */
export function resolveBids(
  prize: number,
  bids: Record<string, number>,
): { winner_id: string | null; cancelled: number[] } {
  const byValue = new Map<number, string[]>();
  for (const [pid, slip] of Object.entries(bids)) {
    const list = byValue.get(slip) ?? [];
    list.push(pid);
    byValue.set(slip, list);
  }

  const values = [...byValue.keys()].sort((a, b) => (prize < 0 ? a - b : b - a));
  const cancelled: number[] = [];
  for (const v of values) {
    const players = byValue.get(v)!;
    if (players.length === 1) return { winner_id: players[0], cancelled };
    cancelled.push(v);
  }
  return { winner_id: null, cancelled };
}

function spentOf(ctx: GameCtx, playerId: string): number[] {
  const spent = (ctx.round.state.spent ?? {})[playerId];
  return Array.isArray(spent) ? spent : [];
}

export function remainingOf(ctx: GameCtx, playerId: string): number[] {
  const spent = new Set(spentOf(ctx, playerId));
  const out: number[] = [];
  for (let n = SLIP_MIN; n <= SLIP_MAX; n++) if (!spent.has(n)) out.push(n);
  return out;
}

/** The bid a player has locked in for the prize on the table, if any. */
function bidOf(ctx: GameCtx, playerId: string): number | null {
  const a = ctx.actionBy('bid', `bid:${ctx.round.state.index}`, playerId);
  return a ? (a.payload.slip as number) : null;
}

function beginBid(ctx: GameCtx): void {
  const s = ctx.round.state;
  if (s.index >= PRIZE_COUNT) return finish(ctx);

  const waiting = ctx
    .present()
    .filter((rp) => remainingOf(ctx, rp.player_id).length > 0)
    .map((rp) => rp.player_id);
  if (waiting.length === 0) return finish(ctx);

  ctx.setPhase('bid', { seconds: cfg(ctx).bid_seconds, pendingOn: waiting });
}

function enterReveal(ctx: GameCtx): void {
  const s = ctx.round.state;
  const prize: number = s.prizes[s.index];

  // §19.2 — a player who never chose plays their lowest remaining slip.
  // Uniform in both directions, so it is a rule players can plan around.
  const bids: Record<string, number> = {};
  for (const rp of ctx.present()) {
    const remaining = remainingOf(ctx, rp.player_id);
    if (remaining.length === 0) continue;
    const chosen = bidOf(ctx, rp.player_id);
    bids[rp.player_id] = chosen != null && remaining.includes(chosen) ? chosen : remaining[0];
  }

  const { winner_id, cancelled } = resolveBids(prize, bids);

  // Every slip played is burned, won or lost.
  for (const [pid, slip] of Object.entries(bids)) {
    s.spent[pid] = [...spentOf(ctx, pid), slip].sort((a, b) => a - b);
  }
  if (winner_id) {
    s.scores[winner_id] = (s.scores[winner_id] ?? 0) + prize;
    s.won[winner_id] = [...(s.won[winner_id] ?? []), prize];
  }

  const record: BidRoundRecord = { prize, bids, winner_id, cancelled };
  s.last = record;
  s.history = [...(s.history ?? []), record];

  ctx.setPhase('reveal', { seconds: cfg(ctx).reveal_seconds });
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  const standings: BidStanding[] = ctx
    .present()
    .map((rp) => ({
      player_id: rp.player_id,
      score: s.scores[rp.player_id] ?? 0,
      prizes: s.won[rp.player_id] ?? [],
    }))
    .sort((a, b) => b.score - a.score);

  const best = standings.length ? standings[0].score : 0;
  ctx.endRound({
    standings,
    winners: standings.filter((x) => x.score === best).map((x) => x.player_id),
    best_score: best,
    history: s.history ?? [],
  });
}

export const bidServer: ServerGame = {
  id: 'bid',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    const order = shuffle(ctx.present().map((r) => r.player_id));
    const spent: Record<string, number[]> = {};
    const scores: Record<string, number> = {};
    const won: Record<string, number[]> = {};

    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {};
      spent[rp.player_id] = [];
      scores[rp.player_id] = 0;
      won[rp.player_id] = [];
    }

    ctx.round.state = {
      prizes: buildPrizes(), // SECRET past the current index
      index: 0,
      spent,
      scores,
      won,
      history: [],
      last: null,
    };
    beginBid(ctx);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const index: number = s.index ?? 0;
    const prizes: number[] = s.prizes ?? [];

    const base = {
      prize_number: Math.min(index + 1, PRIZE_COUNT),
      prize_count: PRIZE_COUNT,
      slip_min: SLIP_MIN,
      slip_max: SLIP_MAX,
      // The public burn table — the thing nobody wants to track on paper.
      spent: s.spent ?? {},
      scores: s.scores ?? {},
      won: s.won ?? {},
      history: s.history ?? [],
      // Which prizes are still to come, as a set: the values are known,
      // their order is not.
      prizes_left: prizes.slice(index + 1).slice().sort((a, b) => a - b),
    };

    switch (ctx.round.phase) {
      case 'bid':
        // Nobody's chosen slip travels anywhere until the reveal.
        return { ...base, prize: prizes[index] ?? null, bids: null, last: null };
      case 'reveal':
        return { ...base, prize: prizes[index] ?? null, bids: s.last?.bids ?? {}, last: s.last };
      default:
        return { ...base, prize: null, bids: null, last: null };
    }
  },

  privateView(ctx, rp) {
    if (ctx.round.phase !== 'bid') {
      return { slip: null, remaining: remainingOf(ctx, rp.player_id) };
    }
    return { slip: bidOf(ctx, rp.player_id), remaining: remainingOf(ctx, rp.player_id) };
  },

  roleVisibleTo() {
    return true; // Bid has no hidden roles, only hidden choices.
  },

  hasActed(ctx, rp) {
    if (ctx.round.phase !== 'bid') return true;
    if (remainingOf(ctx, rp.player_id).length === 0) return true;
    return bidOf(ctx, rp.player_id) != null;
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'bid' && kind === 'bid') {
      const slip = Math.trunc(Number(payload.slip));
      if (!Number.isFinite(slip) || slip < SLIP_MIN || slip > SLIP_MAX) {
        throw new HearthError('invalid_target');
      }
      if (!remainingOf(ctx, rp.player_id).includes(slip)) {
        throw new HearthError('invalid_target'); // already burned
      }
      // Re-bidding before the reveal is deliberate: putAction replaces, so
      // changing your mind is free right up to the countdown.
      ctx.putAction(rp.player_id, `bid:${s.index}`, { slip });
      ctx.clearPending(rp.player_id);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'bid':
        enterReveal(ctx);
        return;
      case 'reveal':
        s.index += 1;
        if (s.index >= PRIZE_COUNT) finish(ctx);
        else beginBid(ctx);
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    // Two is the floor: with one player left there is nobody to read.
    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
    }
    // Otherwise they simply stop bidding. Their burned slips stay on the
    // public table, because the others counted on that information.
  },

  applyStats(ctx, result) {
    const winners = new Set(((result as any).winners ?? []) as string[]);
    const standings = ((result as any).standings ?? []) as BidStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'bid', {
        games_played: 1,
        games_won: winners.has(st.player_id) ? 1 : 0,
        points: st.score,
      });
    }
  },
};
