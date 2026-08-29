import type { GameType, GroupSettings, RoundResult, RoundView, RoundPlayerView } from '@/types';
import { HearthError } from '@/types';
import { uuid } from '@/lib/random';
import type {
  ActionRow, ContentItem, MockDb, PlayerRow, RoundPlayerRow, RoundRow,
} from './db';
import { CONTENT } from './db';

// ---------------------------------------------------------------
// The context a game module gets. Everything a game needs to read or
// change lives here, so a game never touches storage directly.
// ---------------------------------------------------------------

export class GameCtx {
  constructor(
    public db: MockDb,
    public round: RoundRow,
    public now: Date,
  ) {}

  get settings(): GroupSettings {
    return this.round.settings;
  }

  /** Round participants, in turn order where one exists. */
  get rps(): RoundPlayerRow[] {
    const rows = this.db.round_players.filter((r) => r.round_id === this.round.id);
    return rows.sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));
  }

  get actions(): ActionRow[] {
    return this.db.actions.filter((a) => a.round_id === this.round.id);
  }

  player(playerId: string): PlayerRow | undefined {
    return this.db.players.find((p) => p.id === playerId);
  }

  nickname(playerId: string): string {
    return this.player(playerId)?.nickname ?? 'Someone';
  }

  rp(playerId: string): RoundPlayerRow | undefined {
    return this.db.round_players.find(
      (r) => r.round_id === this.round.id && r.player_id === playerId,
    );
  }

  hasLeft(playerId: string): boolean {
    return this.player(playerId)?.has_left ?? false;
  }

  /** Alive, still present participants. */
  living(): RoundPlayerRow[] {
    return this.rps.filter((r) => r.is_alive && !this.hasLeft(r.player_id));
  }

  livingIds(): string[] {
    return this.living().map((r) => r.player_id);
  }

  present(): RoundPlayerRow[] {
    return this.rps.filter((r) => !this.hasLeft(r.player_id));
  }

  byRole(role: string): RoundPlayerRow[] {
    return this.rps.filter((r) => r.role === role);
  }

  actionsIn(phase: string, kind?: string): ActionRow[] {
    return this.actions.filter((a) => a.phase === phase && (!kind || a.kind === kind));
  }

  actionBy(phase: string, kind: string, playerId: string): ActionRow | undefined {
    return this.actions.find(
      (a) => a.phase === phase && a.kind === kind && a.player_id === playerId,
    );
  }

  /** Records an action, replacing any prior one of the same kind (§19.6). */
  putAction(playerId: string, kind: string, payload: Record<string, any>): void {
    const phase = this.round.phase;
    const existing = this.db.actions.findIndex(
      (a) =>
        a.round_id === this.round.id &&
        a.player_id === playerId &&
        a.phase === phase &&
        a.kind === kind,
    );
    const row: ActionRow = {
      id: uuid(),
      round_id: this.round.id,
      player_id: playerId,
      phase,
      kind,
      payload,
      created_at: this.now.toISOString(),
    };
    if (existing >= 0) this.db.actions[existing] = row;
    else this.db.actions.push(row);
  }

  dropAction(playerId: string, kind: string, phase = this.round.phase): void {
    this.db.actions = this.db.actions.filter(
      (a) =>
        !(
          a.round_id === this.round.id &&
          a.player_id === playerId &&
          a.phase === phase &&
          a.kind === kind
        ),
    );
  }

  clearPhaseActions(phase = this.round.phase, kind?: string): void {
    this.db.actions = this.db.actions.filter(
      (a) =>
        !(a.round_id === this.round.id && a.phase === phase && (!kind || a.kind === kind)),
    );
  }

  /**
   * Enter a phase. `pendingOn` non-empty means the phase can also end early
   * once everyone listed has acted; `seconds` null means no clock at all.
   */
  setPhase(
    phase: string,
    opts: { seconds?: number | null; pendingOn?: string[] } = {},
  ): void {
    const { seconds = null, pendingOn = [] } = opts;
    this.round.phase = phase;
    this.round.pending_on = pendingOn.filter((id) => !this.hasLeft(id));
    this.round.expects_actions = pendingOn.length > 0;
    this.round.phase_ends_at =
      seconds == null ? null : new Date(this.now.getTime() + seconds * 1000).toISOString();
  }

  clearPending(playerId: string): void {
    this.round.pending_on = this.round.pending_on.filter((id) => id !== playerId);
  }

  endRound(result: RoundResult): void {
    this.round.phase = 'result';
    this.round.pending_on = [];
    this.round.expects_actions = false;
    this.round.phase_ends_at = null;
    this.round.ended_at = this.now.toISOString();
    this.round.result = result;
  }

  // --- content bank (§11.3 step 1, §19.5) ---

  /**
   * Pick an unused content item for this group, resetting the group's used
   * list once if everything has been seen. Returns null only if the bank
   * itself is empty for this game type.
   */
  takeContent(gameType: GameType): { item: ContentItem; bankReset: boolean } | null {
    const bank = CONTENT.filter((c) => c.game_type === gameType && c.active);
    if (bank.length === 0) return null;

    const used = new Set(
      this.db.group_used_content
        .filter((u) => u.group_id === this.round.group_id)
        .map((u) => u.content_id),
    );
    let pool = bank.filter((c) => !used.has(c.id));
    let bankReset = false;

    if (pool.length === 0) {
      const bankIds = new Set(bank.map((c) => c.id));
      this.db.group_used_content = this.db.group_used_content.filter(
        (u) => !(u.group_id === this.round.group_id && bankIds.has(u.content_id)),
      );
      pool = bank;
      bankReset = true;
    }

    const item = pool[Math.floor(Math.random() * pool.length)];
    this.db.group_used_content.push({
      group_id: this.round.group_id,
      content_id: item.id,
      round_id: this.round.id,
      used_at: this.now.toISOString(),
    });
    return { item, bankReset };
  }

  // --- stats (§20) ---

  bumpStats(
    playerId: string,
    gameType: GameType,
    delta: Partial<Omit<import('./db').StatsRow, 'group_id' | 'player_id' | 'game_type'>>,
  ): void {
    let row = this.db.player_stats.find(
      (s) =>
        s.group_id === this.round.group_id &&
        s.player_id === playerId &&
        s.game_type === gameType,
    );
    if (!row) {
      row = {
        group_id: this.round.group_id,
        player_id: playerId,
        game_type: gameType,
        games_played: 0,
        games_won: 0,
        times_hidden: 0,
        times_caught: 0,
        points: 0,
      };
      this.db.player_stats.push(row);
    }
    for (const [k, v] of Object.entries(delta)) {
      (row as any)[k] += v as number;
    }
  }
}

// ---------------------------------------------------------------
// What a game module must provide (spec §10.1: setup / private_view /
// action / advance / result, plus a public view and leave handling).
// ---------------------------------------------------------------

export interface ServerGame {
  id: GameType;
  minPlayers: number;
  maxPlayers: number;

  /** Assign roles and secrets, then enter the first phase. */
  setup(ctx: GameCtx): void;

  /** Phase-appropriate state that is safe for everyone to see. */
  publicView(ctx: GameCtx): Record<string, unknown>;

  /** Only ever reaches this one player. */
  privateView(ctx: GameCtx, rp: RoundPlayerRow): Record<string, unknown>;

  /** Whether `viewer` is entitled to see `subject`'s role right now. */
  roleVisibleTo(ctx: GameCtx, viewer: RoundPlayerRow | null, subject: RoundPlayerRow): boolean;

  /** Has this player done what the current phase asks of them? */
  hasActed(ctx: GameCtx, rp: RoundPlayerRow): boolean;

  /** Validate and apply one player action. Throws HearthError on abuse. */
  action(ctx: GameCtx, rp: RoundPlayerRow, kind: string, payload: Record<string, any>): void;

  /** The phase is due to end: apply timeout defaults and transition. */
  advance(ctx: GameCtx): void;

  /** Spec §19.3. */
  onPlayerLeft(ctx: GameCtx, playerId: string): void;

  /** Write player_stats when the round ends. */
  applyStats(ctx: GameCtx, result: RoundResult): void;
}

// ---------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------

const registry = new Map<GameType, ServerGame>();

export function registerGame(g: ServerGame): void {
  registry.set(g.id, g);
}

export function gameFor(t: GameType): ServerGame {
  const g = registry.get(t);
  if (!g) throw new HearthError('round_not_found', `no server module for ${t}`);
  return g;
}

export function allGames(): ServerGame[] {
  return [...registry.values()];
}

/**
 * Spec §8.1. A phase is due when its clock has run out, or when it was
 * waiting on actions and everyone still present has acted.
 */
export function isDue(ctx: GameCtx): boolean {
  const r = ctx.round;
  if (r.ended_at) return false;
  if (r.phase_ends_at && ctx.now.getTime() >= Date.parse(r.phase_ends_at)) return true;
  if (!r.expects_actions) return false;
  const stillWaiting = r.pending_on.filter((id) => !ctx.hasLeft(id));
  return stillWaiting.length === 0;
}

/**
 * Runs transitions until the round settles. The bound is a safety net: a
 * game whose `advance` never reaches a waiting state would otherwise spin.
 */
export function runAdvance(ctx: GameCtx): void {
  const game = gameFor(ctx.round.game_type);
  for (let guard = 0; guard < 64; guard++) {
    if (!isDue(ctx)) return;
    const before = `${ctx.round.phase}:${ctx.round.day_number}:${ctx.round.pending_on.join()}`;
    game.advance(ctx);
    if (ctx.round.ended_at) return;
    const after = `${ctx.round.phase}:${ctx.round.day_number}:${ctx.round.pending_on.join()}`;
    if (before === after && isDue(ctx)) {
      // A phase that cannot make progress would hang the round (§19.2).
      console.error('[hearth] phase made no progress, aborting round', before);
      ctx.endRound({ aborted: 'stuck_phase', reason: 'stuck_phase' });
      return;
    }
  }
}

// ---------------------------------------------------------------
// get_my_view (spec §7.3) — the single filtered read path.
// ---------------------------------------------------------------

export function buildView(ctx: GameCtx, viewerPlayerId: string): RoundView {
  const game = gameFor(ctx.round.game_type);
  const viewer = ctx.rp(viewerPlayerId) ?? null;

  const players: RoundPlayerView[] = ctx.rps.map((rp) => {
    const p = ctx.player(rp.player_id);
    return {
      player_id: rp.player_id,
      nickname: p?.nickname ?? '???',
      avatar_key: (p?.avatar_key ?? 'fox') as RoundPlayerView['avatar_key'],
      is_alive: rp.is_alive,
      has_left: p?.has_left ?? false,
      is_host: p?.is_host ?? false,
      turn_index: rp.turn_index,
      has_acted: game.hasActed(ctx, rp),
      role: game.roleVisibleTo(ctx, viewer, rp) ? rp.role : null,
    };
  });

  return {
    round_id: ctx.round.id,
    group_id: ctx.round.group_id,
    game_type: ctx.round.game_type,
    phase: ctx.round.phase,
    phase_ends_at: ctx.round.phase_ends_at,
    server_time: ctx.now.toISOString(),
    day_number: ctx.round.day_number,
    pending_on: ctx.round.pending_on.filter((id) => !ctx.hasLeft(id)),
    players,
    public: game.publicView(ctx),
    me: {
      player_id: viewerPlayerId,
      role: viewer?.role ?? null,
      is_alive: viewer?.is_alive ?? false,
      private: viewer ? game.privateView(ctx, viewer) : {},
    },
    result: ctx.round.result,
    settings: ctx.round.settings,
  };
}

/** Called by the backend once a round has ended, exactly once. */
export function finaliseRound(ctx: GameCtx): void {
  const r = ctx.round;
  if (!r.result) return;
  const already = ctx.db.games_history.some((h) => h.round_id === r.id);
  if (already) return;

  ctx.db.games_history.push({
    id: uuid(),
    group_id: r.group_id,
    round_id: r.id,
    game_type: r.game_type,
    result: r.result as Record<string, any>,
    ended_at: r.ended_at ?? ctx.now.toISOString(),
  });

  if (!r.result.aborted) {
    gameFor(r.game_type).applyStats(ctx, r.result);
  }
}
