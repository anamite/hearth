import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { FoldSettings } from '@/types';
import { pick, shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Fold — blackjack turned into a group standoff.
//
// The app owns the three things paper cannot: a running total nobody
// miscounts, a target that moves every round, and the modifier that is
// the whole reason round six is not round one again.
//
// Cards live on the table, not in here. The only numbers this module
// tracks are the ones the table would otherwise have to remember.
// ---------------------------------------------------------------

/** How long the table gets to deal itself back up to strength. */
export const DEAL_SECONDS = 60;
export const TALLY_SECONDS = 10;

/** Ace low through ace high — the whole range one card can be worth. */
export const CARD_MIN = 1;
export const CARD_MAX = 11;

export const TARGETS = [15, 18, 20, 21, 24, 26, 28, 30, 34, 40];

export type Modifier =
  | 'none'
  | 'double_first'
  | 'hearts_negative'
  | 'blind'
  | 'exact_bonus';

/** Weighted so a plain round is still the commonest one. */
const MODIFIER_BAG: Modifier[] = [
  'none', 'none', 'none', 'none',
  'double_first', 'hearts_negative', 'blind', 'exact_bonus',
];

export const MODIFIER_TEXT: Record<Modifier, string> = {
  none: 'Straight round. Nothing bent.',
  double_first: 'The first card played counts double.',
  hearts_negative: 'Hearts subtract instead of adding.',
  blind: 'The total is hidden until somebody folds or busts.',
  exact_bonus: 'Land exactly on the target and take two points.',
};

export type PlayerStatus = 'in' | 'folded' | 'busted' | 'out';

export interface FoldPlay {
  player_id: string;
  /** What the card was worth after the modifier — null while blind. */
  value: number | null;
  total: number | null;
  hearts: boolean;
  doubled: boolean;
}

export interface FoldRoundRecord {
  round: number;
  target: number;
  modifier: Modifier;
  total: number;
  survivor_id: string | null;
  gained: number;
  exact_id: string | null;
  busted: string[];
  folded: string[];
  log: FoldPlay[];
}

export interface FoldStanding {
  player_id: string;
  score: number;
  cards: number;
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): FoldSettings {
  return { ...DEFAULT_SETTINGS.fold, ...((ctx.settings as any).fold ?? {}) };
}

function inIds(ctx: GameCtx): string[] {
  const s = ctx.round.state;
  return ((s.order ?? []) as string[]).filter((id) => s.status[id] === 'in');
}

export function activeId(ctx: GameCtx): string | null {
  const s = ctx.round.state;
  if (ctx.round.phase !== 'turn') return null;
  return ((s.order ?? []) as string[])[s.turn] ?? null;
}

/**
 * The next player owed a turn, starting at `start` inclusive. Anyone who
 * has left, or who has no cards left to play, folds on the way past — a
 * phase must never wait on somebody who cannot act (§19.2).
 */
function pickFrom(ctx: GameCtx, start: number): string | null {
  const s = ctx.round.state;
  const order = s.order as string[];
  const n = order.length;
  for (let step = 0; step < n; step++) {
    const idx = (start + step) % n;
    const pid = order[idx];
    if (s.status[pid] !== 'in') continue;
    if (ctx.hasLeft(pid)) {
      s.status[pid] = 'folded';
      continue;
    }
    if ((s.hand[pid] ?? 0) <= 0) {
      s.status[pid] = 'folded';
      continue;
    }
    s.turn = idx;
    return pid;
  }
  return null;
}

function enterTally(ctx: GameCtx): void {
  const s = ctx.round.state;
  const remaining = inIds(ctx);
  const survivor = remaining.length === 1 ? remaining[0] : null;
  const gained = survivor ? (s.hand[survivor] ?? 0) : 0;
  if (survivor && gained > 0) {
    s.scores[survivor] = (s.scores[survivor] ?? 0) + gained;
  }

  const record: FoldRoundRecord = {
    round: s.round,
    target: s.target,
    modifier: s.modifier,
    total: s.total,
    survivor_id: survivor,
    gained,
    exact_id: s.exact_id ?? null,
    busted: (s.order as string[]).filter((id) => s.status[id] === 'busted'),
    folded: (s.order as string[]).filter((id) => s.status[id] === 'folded'),
    log: s.log ?? [],
  };
  s.last = record;
  s.history = [...(s.history ?? []), record];

  ctx.setPhase('tally', { seconds: TALLY_SECONDS });
}

function continueRound(ctx: GameCtx): void {
  const s = ctx.round.state;
  if (inIds(ctx).length <= 1) return enterTally(ctx);
  const next = pickFrom(ctx, (s.turn + 1) % (s.order as string[]).length);
  if (next == null || inIds(ctx).length <= 1) return enterTally(ctx);
  ctx.setPhase('turn', { seconds: cfg(ctx).turn_seconds, pendingOn: [next] });
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  const standings: FoldStanding[] = ctx
    .present()
    .map((rp) => ({
      player_id: rp.player_id,
      score: s.scores[rp.player_id] ?? 0,
      cards: s.cards[rp.player_id] ?? 0,
    }))
    .sort((a, b) => b.score - a.score || b.cards - a.cards);

  const best = standings.length ? standings[0].score : 0;
  ctx.endRound({
    standings,
    winners: standings.filter((x) => x.score === best).map((x) => x.player_id),
    best_score: best,
    rounds_played: s.round ?? 0,
    history: s.history ?? [],
  });
}

/** Deal a fresh round: new target, new modifier, everyone back to strength. */
function beginRound(ctx: GameCtx, roundNumber: number): void {
  const s = ctx.round.state;
  const c = cfg(ctx);

  s.round = roundNumber;
  s.target = pick(TARGETS);
  s.modifier = c.modifiers ? pick(MODIFIER_BAG) : 'none';
  s.total = 0;
  s.log = [];
  s.first_card = false;
  s.blind_lifted = false;
  s.exact_id = null;
  s.hand = {};

  for (const rp of ctx.rps) {
    const pid = rp.player_id;
    const cards = s.cards[pid] ?? 0;
    s.hand[pid] = cards;
    if (ctx.hasLeft(pid)) s.status[pid] = 'folded';
    else if (cards <= 0) s.status[pid] = 'out';
    else s.status[pid] = 'in';
  }

  // Nobody left holding cards — the game is simply over.
  if (inIds(ctx).length < 2) return finish(ctx);

  // The lead moves one seat every round so nobody is permanently first.
  s.start = (roundNumber - 1) % (s.order as string[]).length;
  ctx.setPhase('deal', {
    seconds: DEAL_SECONDS,
    pendingOn: ctx.present().map((r) => r.player_id),
  });
}

export const foldServer: ServerGame = {
  id: 'fold',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    const c = cfg(ctx);
    const order = shuffle(ctx.present().map((r) => r.player_id));
    const cards: Record<string, number> = {};
    const scores: Record<string, number> = {};

    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {};
      cards[rp.player_id] = i >= 0 ? Math.max(1, c.hand_size) : 0;
      scores[rp.player_id] = 0;
    }

    ctx.round.state = {
      order,
      rounds: Math.max(1, c.rounds_per_game),
      round: 0,
      turn: 0,
      start: 0,
      target: 0,
      modifier: 'none' as Modifier,
      total: 0,
      log: [] as FoldPlay[],
      first_card: false,
      blind_lifted: false,
      exact_id: null as string | null,
      status: {} as Record<string, PlayerStatus>,
      hand: {} as Record<string, number>,
      cards,
      scores,
      history: [] as FoldRoundRecord[],
      last: null as FoldRoundRecord | null,
    };
    beginRound(ctx, 1);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const phase = ctx.round.phase;
    const blind = s.modifier === 'blind' && !s.blind_lifted && phase !== 'tally';

    const base = {
      round_number: s.round ?? 0,
      rounds_total: s.rounds ?? 0,
      target: s.target ?? 0,
      modifier: (s.modifier ?? 'none') as Modifier,
      modifier_text: MODIFIER_TEXT[(s.modifier ?? 'none') as Modifier],
      order: s.order ?? [],
      status: s.status ?? {},
      hand: s.hand ?? {},
      cards: s.cards ?? {},
      scores: s.scores ?? {},
      card_min: CARD_MIN,
      card_max: CARD_MAX,
      blind,
    };

    switch (phase) {
      case 'deal':
        return { ...base, total: 0, log: [], current_player_id: null, last: s.last ?? null };
      case 'turn':
        return {
          ...base,
          // Under `blind` the total is nobody's to know — and neither are
          // the card values, which add straight back up to it.
          total: blind ? null : s.total ?? 0,
          log: blind
            ? ((s.log ?? []) as FoldPlay[]).map((e) => ({
                player_id: e.player_id,
                value: null,
                total: null,
                hearts: false,
                doubled: false,
              }))
            : s.log ?? [],
          current_player_id: activeId(ctx),
          last: null,
        };
      case 'tally':
        return {
          ...base,
          total: s.total ?? 0,
          log: s.log ?? [],
          current_player_id: null,
          last: s.last ?? null,
        };
      default:
        return {
          ...base,
          total: s.total ?? 0,
          log: s.log ?? [],
          current_player_id: null,
          last: s.last ?? null,
        };
    }
  },

  privateView() {
    // Fold hides a number from everyone or from nobody; there is no
    // per-player secret to hand out.
    return {};
  },

  roleVisibleTo() {
    return true;
  },

  hasActed(ctx, rp) {
    if (ctx.round.phase === 'deal') {
      return ctx.actionBy('deal', 'ready', rp.player_id) != null;
    }
    if (ctx.round.phase === 'turn') return rp.player_id !== activeId(ctx);
    return true;
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'deal' && kind === 'ready') {
      ctx.putAction(rp.player_id, 'ready', {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (ctx.round.phase === 'turn' && (kind === 'play' || kind === 'fold')) {
      if (rp.player_id !== activeId(ctx)) throw new HearthError('not_your_turn');

      if (kind === 'fold') {
        s.status[rp.player_id] = 'folded';
        s.blind_lifted = true;
        continueRound(ctx);
        return;
      }

      const raw = Math.trunc(Number(payload.value));
      if (!Number.isFinite(raw) || raw < CARD_MIN || raw > CARD_MAX) {
        throw new HearthError('invalid_target');
      }
      if ((s.hand[rp.player_id] ?? 0) <= 0) throw new HearthError('invalid_target');

      const hearts = s.modifier === 'hearts_negative' && payload.hearts === true;
      const doubled = s.modifier === 'double_first' && !s.first_card;
      let value = raw;
      if (doubled) value *= 2;
      if (hearts) value = -value;

      s.first_card = true;
      s.hand[rp.player_id] = (s.hand[rp.player_id] ?? 0) - 1;
      s.total = (s.total ?? 0) + value;
      s.log = [
        ...(s.log ?? []),
        { player_id: rp.player_id, value, total: s.total, hearts, doubled } as FoldPlay,
      ];

      if (s.total > s.target) {
        // Bust: out of the round, and one card gone for good.
        s.status[rp.player_id] = 'busted';
        s.cards[rp.player_id] = Math.max(0, (s.cards[rp.player_id] ?? 0) - 1);
        s.blind_lifted = true;
      } else if (s.total === s.target && s.modifier === 'exact_bonus') {
        s.exact_id = rp.player_id;
        s.scores[rp.player_id] = (s.scores[rp.player_id] ?? 0) + 2;
      }

      continueRound(ctx);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'deal': {
        const first = pickFrom(ctx, s.start ?? 0);
        if (first == null || inIds(ctx).length <= 1) return enterTally(ctx);
        ctx.setPhase('turn', { seconds: cfg(ctx).turn_seconds, pendingOn: [first] });
        return;
      }
      case 'turn': {
        // §19.2 — a player who says nothing folds. Safe, and the same
        // default whether they are thinking or gone.
        const pid = activeId(ctx);
        if (pid) {
          s.status[pid] = 'folded';
          s.blind_lifted = true;
        }
        continueRound(ctx);
        return;
      }
      case 'tally': {
        if ((s.round ?? 0) >= (s.rounds ?? 0)) return finish(ctx);
        beginRound(ctx, s.round + 1);
        return;
      }
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    const s = ctx.round.state;
    const wasActive = activeId(ctx) === playerId;
    if (s.status?.[playerId] === 'in') s.status[playerId] = 'folded';

    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }
    // Their turn cannot be waited on any longer.
    if (ctx.round.phase === 'turn' && wasActive) continueRound(ctx);
  },

  applyStats(ctx, result) {
    const winners = new Set(((result as any).winners ?? []) as string[]);
    const standings = ((result as any).standings ?? []) as FoldStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'fold', {
        games_played: 1,
        games_won: winners.has(st.player_id) ? 1 : 0,
        points: st.score,
      });
    }
  },
};
