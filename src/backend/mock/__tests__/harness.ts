import type { GameType, GroupSettings, RoundView } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { NICKNAME_POOL, AVATAR_KEYS, GROUP_TTL_DAYS } from '@/lib/constants';
import { CONTENT } from '../db';
import type { MockDb, PlayerRow, RoundRow } from '../db';
import { GameCtx, buildView, finaliseRound, gameFor, isDue, registerGame, runAdvance } from '../engine';
import { fakeArtistServer } from '../games/fakeArtist';
import { dialServer } from '../games/dial';
import { nightVillageServer } from '../games/nightVillage';
import { gridServer } from '../games/grid';
import { bidServer } from '../games/bid';
import { nerveServer } from '../games/nerve';

registerGame(fakeArtistServer);
registerGame(dialServer);
registerGame(nightVillageServer);
registerGame(gridServer);
registerGame(bidServer);
registerGame(nerveServer);

let seq = 0;
const id = () => `id-${++seq}`;

/**
 * Drives rounds against an in-memory database with a controllable clock,
 * so tests can play whole games deterministically and inspect exactly what
 * each player's device would have received.
 */
export class Table {
  db: MockDb;
  groupId: string;
  playerIds: string[];
  round!: RoundRow;
  clock = new Date('2026-01-01T12:00:00Z');

  constructor(playerCount: number, settings?: Partial<GroupSettings>) {
    const merged: GroupSettings = {
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      ...(settings ?? {}),
      fake_artist: { ...DEFAULT_SETTINGS.fake_artist, ...(settings?.fake_artist ?? {}) },
      night_village: { ...DEFAULT_SETTINGS.night_village, ...(settings?.night_village ?? {}) },
      dial: { ...DEFAULT_SETTINGS.dial, ...(settings?.dial ?? {}) },
      grid: { ...DEFAULT_SETTINGS.grid, ...(settings?.grid ?? {}) },
      bid: { ...DEFAULT_SETTINGS.bid, ...(settings?.bid ?? {}) },
      nerve: { ...DEFAULT_SETTINGS.nerve, ...(settings?.nerve ?? {}) },
    };

    this.groupId = id();
    this.db = {
      v: 1,
      groups: [
        {
          id: this.groupId,
          code: 'TESTAA',
          display_name: 'Test Group',
          pin_hash: 'x',
          settings: merged,
          created_at: this.clock.toISOString(),
          last_active_at: this.clock.toISOString(),
          expires_at: new Date(Date.now() + GROUP_TTL_DAYS * 86400000).toISOString(),
        },
      ],
      players: [],
      rounds: [],
      round_players: [],
      actions: [],
      group_used_content: [],
      games_history: [],
      player_stats: [],
    };

    this.playerIds = [];
    for (let i = 0; i < playerCount; i++) {
      const p: PlayerRow = {
        id: id(),
        group_id: this.groupId,
        auth_uid: id(),
        nickname: NICKNAME_POOL[i],
        avatar_key: AVATAR_KEYS[i % AVATAR_KEYS.length],
        is_host: i === 0,
        is_ready: true,
        has_left: false,
        joined_at: new Date(this.clock.getTime() + i).toISOString(),
        last_seen_at: this.clock.toISOString(),
      };
      this.db.players.push(p);
      this.playerIds.push(p.id);
    }
  }

  /** Pin the content bank to one item so a test can assert on a known word. */
  useOnlyContent(contentId: string): void {
    for (const c of CONTENT) {
      if (c.id === contentId) continue;
      this.db.group_used_content.push({
        group_id: this.groupId,
        content_id: c.id,
        round_id: null,
        used_at: this.clock.toISOString(),
      });
    }
  }

  get settings(): GroupSettings {
    return this.db.groups[0].settings;
  }

  ctx(): GameCtx {
    return new GameCtx(this.db, this.round, new Date(this.clock));
  }

  start(gameType: GameType): RoundRow {
    this.clock = new Date(this.clock.getTime() + 1000); // rounds never share a timestamp
    const round: RoundRow = {
      id: id(),
      group_id: this.groupId,
      game_type: gameType,
      phase: 'setup',
      phase_ends_at: null,
      pending_on: [],
      expects_actions: false,
      state: {},
      day_number: 0,
      settings: JSON.parse(JSON.stringify(this.settings)),
      started_at: this.clock.toISOString(),
      ended_at: null,
      result: null,
    };
    this.db.rounds.push(round);
    for (const pid of this.playerIds) {
      const p = this.db.players.find((x) => x.id === pid)!;
      if (p.has_left) continue;
      this.db.round_players.push({
        round_id: round.id,
        player_id: pid,
        role: 'unassigned',
        private: {},
        is_alive: true,
        turn_index: null,
      });
    }
    this.round = round;
    gameFor(gameType).setup(this.ctx());
    return round;
  }

  /** The exact payload one player's device would receive. */
  view(playerId: string): RoundView {
    return buildView(this.ctx(), playerId);
  }

  views(): RoundView[] {
    return this.playerIds
      .filter((p) => this.db.round_players.some((rp) => rp.round_id === this.round.id && rp.player_id === p))
      .map((p) => this.view(p));
  }

  act(playerId: string, kind: string, payload: Record<string, any> = {}): void {
    const ctx = this.ctx();
    const rp = ctx.rp(playerId);
    if (!rp) throw new Error('not in round');
    gameFor(this.round.game_type).action(ctx, rp, kind, payload);
    if (isDue(ctx)) runAdvance(ctx);
    if (this.round.ended_at) finaliseRound(ctx);
  }

  /** Push the clock forward and let the engine settle. */
  tick(seconds = 0): void {
    this.clock = new Date(this.clock.getTime() + seconds * 1000);
    const ctx = this.ctx();
    if (isDue(ctx)) runAdvance(ctx);
    if (this.round.ended_at) finaliseRound(ctx);
  }

  /** Jump straight past the current phase's timer. */
  timeout(): void {
    const ends = this.round.phase_ends_at;
    if (ends) {
      const delta = Date.parse(ends) - this.clock.getTime();
      this.tick(Math.max(1, Math.ceil(delta / 1000) + 1));
    } else {
      this.tick(1);
    }
  }

  leave(playerId: string): void {
    const p = this.db.players.find((x) => x.id === playerId)!;
    p.has_left = true;
    const ctx = this.ctx();
    gameFor(this.round.game_type).onPlayerLeft(ctx, playerId);
    if (!this.round.ended_at && isDue(ctx)) runAdvance(ctx);
    if (this.round.ended_at) finaliseRound(ctx);
  }

  roleOf(playerId: string): string {
    return this.db.round_players.find(
      (rp) => rp.round_id === this.round.id && rp.player_id === playerId,
    )!.role;
  }

  playersWithRole(role: string): string[] {
    return this.db.round_players
      .filter((rp) => rp.round_id === this.round.id && rp.role === role)
      .map((rp) => rp.player_id);
  }

  get phase(): string {
    return this.round.phase;
  }

  get result(): any {
    return this.round.result;
  }
}

/**
 * Deep search of a serialised view for a forbidden string. This is the
 * mechanical version of "open devtools and inspect the network tab"
 * (M1 acceptance criterion 3).
 */
export function viewContains(view: unknown, needle: string): boolean {
  return JSON.stringify(view).toLowerCase().includes(needle.toLowerCase());
}
