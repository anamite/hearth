import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { SeasonSettings } from '@/types';
import { pick, shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Season — a trick-taking game a seven-year-old already knows, played
// under a rule that changes every two minutes.
//
// The phone is a weather system, not a board. It announces the season,
// goes dark, and chimes when the weather turns. The one thing paper
// cannot do is the hidden season: the rule goes to a single player and
// everybody else spends four tricks working out why the table has
// stopped making sense.
// ---------------------------------------------------------------

export const ANNOUNCE_SECONDS = 45;

export type Scoring = 'normal' | 'double' | 'void';

/** Weighted: most seasons score straight, a few are worth arguing about. */
const SCORING_BAG: Scoring[] = [
  'normal', 'normal', 'normal', 'normal', 'normal', 'normal',
  'double', 'double',
  'void',
];

export const SCORING_TEXT: Record<Scoring, string> = {
  normal: 'Tricks this season are worth one each.',
  double: 'Tricks this season are worth double.',
  void: 'Tricks this season are worth nothing at all.',
};

export interface SeasonRecord {
  season: number;
  rule: string;
  scoring: Scoring;
  secret_to: string | null;
  tricks: Record<string, number>;
  points: Record<string, number>;
}

export interface SeasonStanding {
  player_id: string;
  score: number;
  tricks: number;
  /** How many hidden seasons this player was the one who knew. */
  secrets: number;
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): SeasonSettings {
  return { ...DEFAULT_SETTINGS.season, ...((ctx.settings as any).season ?? {}) };
}

function multiplier(scoring: Scoring): number {
  return scoring === 'double' ? 2 : scoring === 'void' ? 0 : 1;
}

/** True while this season's rule belongs to one player only. */
function isHidden(ctx: GameCtx): boolean {
  return ctx.round.state.secret_to != null && ctx.round.phase !== 'result';
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  const history = (s.history ?? []) as SeasonRecord[];
  const standings: SeasonStanding[] = ctx
    .present()
    .map((rp) => ({
      player_id: rp.player_id,
      score: s.scores[rp.player_id] ?? 0,
      tricks: s.total_tricks[rp.player_id] ?? 0,
      secrets: history.filter((h) => h.secret_to === rp.player_id).length,
    }))
    .sort((a, b) => b.score - a.score || b.tricks - a.tricks);

  const best = standings.length ? standings[0].score : 0;
  ctx.endRound({
    standings,
    winners: standings.filter((x) => x.score === best).map((x) => x.player_id),
    best_score: best,
    seasons_played: s.season ?? 0,
    history: s.history ?? [],
    bank_reset: !!s.bank_reset,
  });
}

/** Bank what the season was worth, then turn the weather over. */
function endSeason(ctx: GameCtx): void {
  const s = ctx.round.state;
  const mult = multiplier(s.scoring as Scoring);
  const points: Record<string, number> = {};

  for (const rp of ctx.rps) {
    const won = s.season_tricks[rp.player_id] ?? 0;
    points[rp.player_id] = won * mult;
    s.scores[rp.player_id] = (s.scores[rp.player_id] ?? 0) + won * mult;
    s.total_tricks[rp.player_id] = (s.total_tricks[rp.player_id] ?? 0) + won;
  }

  const record: SeasonRecord = {
    season: s.season,
    rule: s.rule,
    scoring: s.scoring,
    secret_to: s.secret_to ?? null,
    tricks: { ...s.season_tricks },
    points,
  };
  s.history = [...(s.history ?? []), record];

  if (s.season >= s.seasons) return finish(ctx);
  beginSeason(ctx, s.season + 1);
}

function beginSeason(ctx: GameCtx, n: number): void {
  const s = ctx.round.state;
  const c = cfg(ctx);

  const taken = ctx.takeContent('season');
  if (!taken) throw new HearthError('content_exhausted');
  s.rule = taken.item.payload.text as string;
  s.content_id = taken.item.id;
  if (taken.bankReset) s.bank_reset = true;

  s.scoring = pick(SCORING_BAG);

  // Never the opening season — the table needs one honest one first.
  const present = ctx.present().map((r) => r.player_id);
  const hide = c.secret_seasons && n > 1 && present.length >= 3 && Math.random() < 0.34;
  s.secret_to = hide ? pick(present) : null;

  s.season = n;
  s.trick = 0;
  s.last_claim = null;
  s.season_tricks = {};
  for (const rp of ctx.rps) s.season_tricks[rp.player_id] = 0;

  ctx.setPhase('season', { seconds: ANNOUNCE_SECONDS, pendingOn: present });
}

function nextTrick(ctx: GameCtx): void {
  const s = ctx.round.state;
  if (s.trick >= s.tricks) return endSeason(ctx);
  ctx.setPhase('trick', { seconds: cfg(ctx).trick_seconds });
}

export const seasonServer: ServerGame = {
  id: 'season',
  minPlayers: 3,
  maxPlayers: 6,

  setup(ctx) {
    const c = cfg(ctx);
    const order = shuffle(ctx.present().map((r) => r.player_id));
    const scores: Record<string, number> = {};
    const totals: Record<string, number> = {};

    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {};
      scores[rp.player_id] = 0;
      totals[rp.player_id] = 0;
    }

    ctx.round.state = {
      order,
      seasons: Math.max(1, c.seasons_per_game),
      tricks: Math.max(1, c.tricks_per_season),
      season: 0,
      trick: 0,
      rule: '',
      content_id: null as string | null,
      scoring: 'normal' as Scoring,
      secret_to: null as string | null,
      season_tricks: {} as Record<string, number>,
      total_tricks: totals,
      scores,
      history: [] as SeasonRecord[],
      last_claim: null as { player_id: string; trick: number; season: number } | null,
      bank_reset: false,
    };
    beginSeason(ctx, 1);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const hidden = isHidden(ctx);

    return {
      season_number: s.season ?? 0,
      seasons_total: s.seasons ?? 0,
      trick_number: Math.min((s.trick ?? 0) + 1, s.tricks ?? 1),
      tricks_total: s.tricks ?? 0,
      // A hidden season's rule goes out through privateView and nowhere
      // else. Not a masked field — an absent one.
      rule: hidden ? null : s.rule ?? '',
      scoring: hidden ? null : (s.scoring ?? 'normal'),
      scoring_text: hidden ? null : SCORING_TEXT[(s.scoring ?? 'normal') as Scoring],
      secret: hidden,
      secret_to: hidden ? s.secret_to : null,
      season_tricks: s.season_tricks ?? {},
      total_tricks: s.total_tricks ?? {},
      scores: s.scores ?? {},
      // Past seasons are common knowledge, hidden ones included.
      history: s.history ?? [],
      last_claim: s.last_claim ?? null,
      bank_reset: !!s.bank_reset,
    };
  },

  privateView(ctx, rp) {
    const s = ctx.round.state;
    if (!isHidden(ctx) || s.secret_to !== rp.player_id) return {};
    return {
      rule: s.rule,
      scoring: s.scoring,
      scoring_text: SCORING_TEXT[s.scoring as Scoring],
    };
  },

  roleVisibleTo() {
    return true; // Season hides a rule, never a person.
  },

  hasActed(ctx, rp) {
    if (ctx.round.phase !== 'season') return true;
    return ctx.actionBy('season', `ready:${ctx.round.state.season}`, rp.player_id) != null;
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'season' && kind === 'ready') {
      // The phase name repeats every season, so the kind carries the
      // season number — otherwise season 2's tap collides with season 1's.
      ctx.putAction(rp.player_id, `ready:${s.season}`, {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (ctx.round.phase === 'trick' && kind === 'took') {
      const winner = typeof payload.player_id === 'string' ? payload.player_id : rp.player_id;
      const target = ctx.rp(winner);
      if (!target || ctx.hasLeft(winner)) throw new HearthError('invalid_target');

      s.season_tricks[winner] = (s.season_tricks[winner] ?? 0) + 1;
      s.last_claim = { player_id: winner, trick: s.trick, season: s.season, by: rp.player_id };
      s.trick = (s.trick ?? 0) + 1;
      nextTrick(ctx);
      return;
    }

    if (ctx.round.phase === 'trick' && kind === 'undo') {
      const last = s.last_claim;
      // One step back, and only within this season — the tap that ends a
      // season is already banked by the time anyone could regret it.
      if (
        !last ||
        last.season !== s.season ||
        s.trick !== last.trick + 1
      ) {
        throw new HearthError('wrong_phase');
      }
      s.season_tricks[last.player_id] = Math.max(0, (s.season_tricks[last.player_id] ?? 0) - 1);
      s.trick = last.trick;
      s.last_claim = null;
      ctx.setPhase('trick', { seconds: cfg(ctx).trick_seconds });
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'season':
        ctx.setPhase('trick', { seconds: cfg(ctx).trick_seconds });
        return;
      case 'trick':
        // §19.2 — nobody claimed it in three minutes, so the trick goes
        // to nobody and the season carries on regardless.
        s.trick = (s.trick ?? 0) + 1;
        s.last_claim = null;
        nextTrick(ctx);
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    const s = ctx.round.state;

    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }
    // A secret nobody holds is just a rule nobody can follow: publish it.
    if (s.secret_to === playerId) s.secret_to = null;
  },

  applyStats(ctx, result) {
    const winners = new Set(((result as any).winners ?? []) as string[]);
    const standings = ((result as any).standings ?? []) as SeasonStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'season', {
        games_played: 1,
        games_won: winners.has(st.player_id) ? 1 : 0,
        times_hidden: st.secrets ?? 0,
        points: st.score,
      });
    }
  },
};
