import type {
  AvatarKey, EphemeralEvent, GameType, GroupEvent, GroupSettings, HistoryEntry,
  LobbyView, PlayerStats, RoundEvent, RoundView, Unsubscribe,
} from '@/types';
import { HearthError } from '@/types';
import { uuid } from '@/lib/random';
import { CODE_ALPHABET, CODE_LENGTH, GROUP_MAX_PLAYERS, GROUP_NAME_ADJECTIVES, GROUP_NAME_NOUNS, GROUP_TTL_DAYS, NICKNAME_POOL } from '@/lib/constants';
import type { Backend } from '../types';
import {
  beginTxBuffer, broadcast, compareAndSwap, defaultSettings, discardTxBuffer,
  flushTxBuffer, loadDb, loadDbRaw, mockAuthUid, mockHashPin, onBroadcast,
} from './db';
import type { GroupRow, MockDb, PlayerRow, RoundRow } from './db';
import { GameCtx, buildView, finaliseRound, gameFor, isDue, registerGame, runAdvance } from '../mock/engine';
import { fakeArtistServer } from './games/fakeArtist';
import { dialServer } from './games/dial';
import { nightVillageServer } from './games/nightVillage';
import { gridServer } from './games/grid';
import { bidServer } from './games/bid';
import { nerveServer } from './games/nerve';

registerGame(fakeArtistServer);
registerGame(dialServer);
registerGame(nightVillageServer);
registerGame(gridServer);
registerGame(bidServer);
registerGame(nerveServer);

function nowIso(): string {
  return new Date().toISOString();
}

function plusDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function genCode(db: MockDb): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!db.groups.some((g) => g.code === code)) return code;
  }
  throw new HearthError('group_not_found', 'could not allocate a code');
}

function genDisplayName(): string {
  const a = GROUP_NAME_ADJECTIVES[Math.floor(Math.random() * GROUP_NAME_ADJECTIVES.length)];
  const n = GROUP_NAME_NOUNS[Math.floor(Math.random() * GROUP_NAME_NOUNS.length)];
  return `${a} ${n}`;
}

export class MockBackend implements Backend {
  private uid = '';

  async init(): Promise<void> {
    this.uid = mockAuthUid();
  }

  authUid(): string {
    return this.uid || (this.uid = mockAuthUid());
  }

  // -------------------------------------------------------------
  // Transaction helper. Read-modify-write stands in for the row lock
  // that the Postgres implementation takes (§8.3).
  // -------------------------------------------------------------
  private tx<T>(fn: (db: MockDb) => T): T {
    for (let attempt = 0; attempt < 40; attempt++) {
      const { db, raw } = loadDbRaw();
      beginTxBuffer();
      let out: T;
      try {
        out = fn(db);
      } catch (err) {
        discardTxBuffer();
        throw err;
      }
      if (compareAndSwap(raw, db)) {
        flushTxBuffer();
        return out;
      }
      // Another tab committed first — throw this attempt away and redo it
      // against the newer state.
      discardTxBuffer();
    }
    throw new HearthError('network', 'could not commit — too much contention');
  }

  private groupByCode(db: MockDb, code: string): GroupRow {
    const g = db.groups.find((x) => x.code.toUpperCase() === code.trim().toUpperCase());
    if (!g) throw new HearthError('group_not_found');
    return g;
  }

  private me(db: MockDb, groupId: string): PlayerRow {
    const p = db.players.find(
      (x) => x.group_id === groupId && x.auth_uid === this.authUid(),
    );
    if (!p) throw new HearthError('not_a_member');
    return p;
  }

  private activeRound(db: MockDb, groupId: string): RoundRow | undefined {
    return db.rounds.find((r) => r.group_id === groupId && !r.ended_at);
  }

  private touch(db: MockDb, groupId: string): void {
    const g = db.groups.find((x) => x.id === groupId);
    if (!g) return;
    g.last_active_at = nowIso();
    g.expires_at = plusDays(GROUP_TTL_DAYS); // an active group never expires
  }

  // -------------------------------------------------------------
  // §7.2 group and lobby
  // -------------------------------------------------------------

  async createGroup(a: {
    pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }) {
    validatePin(a.pin);
    validateNickname(a.nickname);

    return this.tx((db) => {
      const group: GroupRow = {
        id: uuid(),
        code: genCode(db),
        display_name: genDisplayName(),
        pin_hash: mockHashPin(a.pin),
        settings: defaultSettings(),
        created_at: nowIso(),
        last_active_at: nowIso(),
        expires_at: plusDays(GROUP_TTL_DAYS),
      };
      db.groups.push(group);

      const player: PlayerRow = {
        id: uuid(),
        group_id: group.id,
        auth_uid: this.authUid(),
        nickname: a.nickname,
        avatar_key: a.avatarKey,
        is_host: true,
        is_ready: true,
        has_left: false,
        joined_at: nowIso(),
        last_seen_at: nowIso(),
      };
      db.players.push(player);

      return {
        group_id: group.id,
        code: group.code,
        display_name: group.display_name,
        player_id: player.id,
      };
    });
  }

  async joinGroup(a: {
    code: string; pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }) {
    return this.tx((db) => {
      const group = this.groupByCode(db, a.code);
      if (group.pin_hash !== mockHashPin(a.pin)) throw new HearthError('bad_pin');

      const existing = db.players.find(
        (p) => p.group_id === group.id && p.auth_uid === this.authUid(),
      );
      if (existing) {
        // Rejoin path — same device coming back (§7.2).
        existing.has_left = false;
        existing.last_seen_at = nowIso();
        this.touch(db, group.id);
        return {
          group_id: group.id,
          code: group.code,
          display_name: group.display_name,
          player_id: existing.id,
        };
      }

      const active = db.players.filter((p) => p.group_id === group.id && !p.has_left);
      if (active.length >= GROUP_MAX_PLAYERS) throw new HearthError('group_full');

      validateNickname(a.nickname);
      const taken = db.players.some(
        (p) => p.group_id === group.id && p.nickname === a.nickname,
      );
      if (taken) throw new HearthError('nickname_taken');

      const player: PlayerRow = {
        id: uuid(),
        group_id: group.id,
        auth_uid: this.authUid(),
        nickname: a.nickname,
        avatar_key: a.avatarKey,
        is_host: false,
        is_ready: false,
        has_left: false,
        joined_at: nowIso(),
        last_seen_at: nowIso(),
      };
      db.players.push(player);
      this.touch(db, group.id);
      broadcast({ scope: 'group', id: group.id, event: { type: 'players_changed' } });

      return {
        group_id: group.id,
        code: group.code,
        display_name: group.display_name,
        player_id: player.id,
      };
    });
  }

  async getLobby(code: string): Promise<LobbyView> {
    const db = loadDb();
    const group = this.groupByCode(db, code);
    const me = this.me(db, group.id);
    const round = this.activeRound(db, group.id);

    return {
      group: {
        id: group.id,
        code: group.code,
        display_name: group.display_name,
        settings: group.settings,
        created_at: group.created_at,
        expires_at: group.expires_at,
      },
      players: db.players
        .filter((p) => p.group_id === group.id)
        .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at))
        .map(toPublicPlayer),
      me: toPublicPlayer(me),
      active_round: round ? { round_id: round.id, game_type: round.game_type } : null,
    };
  }

  async availableNicknames(code: string): Promise<string[]> {
    const db = loadDb();
    const group = db.groups.find((x) => x.code.toUpperCase() === code.trim().toUpperCase());
    if (!group) return [...NICKNAME_POOL];
    const used = new Set(db.players.filter((p) => p.group_id === group.id).map((p) => p.nickname));
    return NICKNAME_POOL.filter((n) => !used.has(n));
  }

  async peekGroup(code: string) {
    const db = loadDb();
    const group = db.groups.find((x) => x.code.toUpperCase() === code.trim().toUpperCase());
    if (!group) return null;
    return {
      display_name: group.display_name,
      player_count: db.players.filter((p) => p.group_id === group.id && !p.has_left).length,
    };
  }

  async leaveGroup(groupId: string): Promise<void> {
    this.tx((db) => {
      const me = this.me(db, groupId);
      me.has_left = true;
      me.is_ready = false;

      if (me.is_host) {
        me.is_host = false;
        const next = db.players
          .filter((p) => p.group_id === groupId && !p.has_left)
          .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at))[0];
        if (next) next.is_host = true; // §19.4
      }

      const round = this.activeRound(db, groupId);
      if (round) {
        const ctx = new GameCtx(db, round, new Date());
        gameFor(round.game_type).onPlayerLeft(ctx, me.id);
        if (!round.ended_at) runAdvance(ctx);
        if (round.ended_at) {
          finaliseRound(ctx);
          broadcast({ scope: 'round', id: round.id, event: { type: 'round_ended' } });
        } else {
          broadcast({
            scope: 'round',
            id: round.id,
            event: { type: 'phase_changed', phase: round.phase, phase_ends_at: round.phase_ends_at },
          });
        }
      }
      broadcast({ scope: 'group', id: groupId, event: { type: 'players_changed' } });
    });
  }

  async setReady(groupId: string, ready: boolean): Promise<void> {
    this.tx((db) => {
      this.me(db, groupId).is_ready = ready;
      broadcast({ scope: 'group', id: groupId, event: { type: 'players_changed' } });
    });
  }

  async updateGroupSettings(groupId: string, settings: Partial<GroupSettings>): Promise<void> {
    this.tx((db) => {
      const me = this.me(db, groupId);
      if (!me.is_host) throw new HearthError('not_host');
      if (this.activeRound(db, groupId)) throw new HearthError('round_active');

      // A group created before these games existed has no key for them,
      // so the defaults come first (§ legacy groups).
      const base = defaultSettings();
      const group = db.groups.find((g) => g.id === groupId)!;
      group.settings = {
        ...group.settings,
        ...settings,
        fake_artist: { ...group.settings.fake_artist, ...(settings.fake_artist ?? {}) },
        night_village: { ...group.settings.night_village, ...(settings.night_village ?? {}) },
        dial: { ...group.settings.dial, ...(settings.dial ?? {}) },
        grid: { ...base.grid, ...group.settings.grid, ...(settings.grid ?? {}) },
        bid: { ...base.bid, ...group.settings.bid, ...(settings.bid ?? {}) },
        nerve: { ...base.nerve, ...group.settings.nerve, ...(settings.nerve ?? {}) },
      };
      broadcast({ scope: 'group', id: groupId, event: { type: 'settings_changed' } });
    });
  }

  async heartbeat(groupId: string): Promise<void> {
    this.tx((db) => {
      const me = db.players.find(
        (p) => p.group_id === groupId && p.auth_uid === this.authUid(),
      );
      if (!me) return;
      me.last_seen_at = nowIso();
      this.touch(db, groupId);
    });
  }

  // -------------------------------------------------------------
  // §7.3 round lifecycle
  // -------------------------------------------------------------

  async startRound(groupId: string, gameType: GameType): Promise<string> {
    return this.tx((db) => {
      const me = this.me(db, groupId);
      if (!me.is_host) throw new HearthError('not_host');

      const existing = this.activeRound(db, groupId);
      if (existing) return existing.id; // idempotent

      const group = db.groups.find((g) => g.id === groupId)!;
      const present = db.players.filter((p) => p.group_id === groupId && !p.has_left);
      const game = gameFor(gameType);
      if (present.length < game.minPlayers) throw new HearthError('too_few_players');
      if (present.length > game.maxPlayers) throw new HearthError('too_many_players');

      const round: RoundRow = {
        id: uuid(),
        group_id: groupId,
        game_type: gameType,
        phase: 'setup',
        phase_ends_at: null,
        pending_on: [],
        expects_actions: false,
        state: {},
        day_number: 0,
        settings: JSON.parse(JSON.stringify(group.settings)), // snapshot (§5.1)
        started_at: nowIso(),
        ended_at: null,
        result: null,
      };
      db.rounds.push(round);

      for (const p of present) {
        db.round_players.push({
          round_id: round.id,
          player_id: p.id,
          role: 'unassigned',
          private: {},
          is_alive: true,
          turn_index: null,
        });
      }

      const ctx = new GameCtx(db, round, new Date());
      game.setup(ctx);

      for (const p of db.players.filter((x) => x.group_id === groupId)) p.is_ready = false;
      this.touch(db, groupId);

      broadcast({ scope: 'group', id: groupId, event: { type: 'round_started', round_id: round.id } });
      return round.id;
    });
  }

  async getMyView(roundId: string): Promise<RoundView> {
    const db = loadDb();
    const round = db.rounds.find((r) => r.id === roundId);
    if (!round) throw new HearthError('round_not_found');
    const me = this.me(db, round.group_id);
    return buildView(new GameCtx(db, round, new Date()), me.id);
  }

  async advanceIfDue(roundId: string): Promise<RoundView> {
    return this.tx((db) => {
      const round = db.rounds.find((r) => r.id === roundId);
      if (!round) throw new HearthError('round_not_found');
      const me = this.me(db, round.group_id);

      const ctx = new GameCtx(db, round, new Date());
      const before = round.phase;
      if (isDue(ctx)) runAdvance(ctx);

      if (round.phase !== before) {
        broadcast({
          scope: 'round',
          id: round.id,
          event: { type: 'phase_changed', phase: round.phase, phase_ends_at: round.phase_ends_at },
        });
      }
      if (round.ended_at) {
        finaliseRound(ctx);
        if (before !== 'result') {
          broadcast({ scope: 'round', id: round.id, event: { type: 'round_ended' } });
        }
      }
      return buildView(ctx, me.id);
    });
  }

  async submitAction(
    roundId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<RoundView> {
    return this.tx((db) => {
      const round = db.rounds.find((r) => r.id === roundId);
      if (!round) throw new HearthError('round_not_found');
      if (round.ended_at) throw new HearthError('wrong_phase');

      const me = this.me(db, round.group_id);
      const ctx = new GameCtx(db, round, new Date());
      const rp = ctx.rp(me.id);
      if (!rp) throw new HearthError('not_a_member');

      const before = round.phase;
      gameFor(round.game_type).action(ctx, rp, kind, payload);

      // An action can complete the phase; don't make everyone wait 2s for it.
      if (isDue(ctx)) runAdvance(ctx);

      broadcast({ scope: 'round', id: round.id, event: { type: 'player_acted', player_id: me.id } });
      if (round.phase !== before) {
        broadcast({
          scope: 'round',
          id: round.id,
          event: { type: 'phase_changed', phase: round.phase, phase_ends_at: round.phase_ends_at },
        });
      }
      if (round.ended_at) {
        finaliseRound(ctx);
        broadcast({ scope: 'round', id: round.id, event: { type: 'round_ended' } });
      }
      return buildView(ctx, me.id);
    });
  }

  async abortRound(roundId: string): Promise<void> {
    this.tx((db) => {
      const round = db.rounds.find((r) => r.id === roundId);
      if (!round || round.ended_at) return;
      const me = this.me(db, round.group_id);
      if (!me.is_host) throw new HearthError('not_host');

      const ctx = new GameCtx(db, round, new Date());
      ctx.endRound({ aborted: 'host_aborted', reason: 'host_aborted' });
      finaliseRound(ctx);
      broadcast({ scope: 'round', id: round.id, event: { type: 'round_ended' } });
      broadcast({ scope: 'group', id: round.group_id, event: { type: 'players_changed' } });
    });
  }

  // -------------------------------------------------------------
  // §20 history and stats
  // -------------------------------------------------------------

  async getHistory(groupId: string, limit = 50): Promise<HistoryEntry[]> {
    const db = loadDb();
    this.me(db, groupId);
    return db.games_history
      .filter((h) => h.group_id === groupId)
      .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))
      .slice(0, limit)
      .map((h) => ({
        id: h.id,
        round_id: h.round_id,
        game_type: h.game_type,
        result: h.result,
        ended_at: h.ended_at,
      }));
  }

  async getStats(groupId: string): Promise<PlayerStats[]> {
    const db = loadDb();
    this.me(db, groupId);
    return db.player_stats
      .filter((s) => s.group_id === groupId)
      .map((s) => {
        const p = db.players.find((x) => x.id === s.player_id);
        return {
          player_id: s.player_id,
          nickname: p?.nickname ?? '???',
          avatar_key: (p?.avatar_key ?? 'fox') as AvatarKey,
          game_type: s.game_type,
          games_played: s.games_played,
          games_won: s.games_won,
          times_hidden: s.times_hidden,
          times_caught: s.times_caught,
          points: s.points,
        };
      });
  }

  async getBestScore(groupId: string, gameType: GameType): Promise<number | null> {
    const db = loadDb();
    const scores = db.games_history
      .filter((h) => h.group_id === groupId && h.game_type === gameType)
      .map((h) => (h.result as any)?.total_score)
      .filter((n) => typeof n === 'number');
    return scores.length ? Math.max(...scores) : null;
  }

  // -------------------------------------------------------------
  // §9 realtime — BroadcastChannel stands in for Supabase Realtime
  // -------------------------------------------------------------

  subscribeGroup(groupId: string, cb: (e: GroupEvent) => void): Unsubscribe {
    return onBroadcast((m) => {
      if (m.scope === 'group' && m.id === groupId) cb(m.event as GroupEvent);
    });
  }

  subscribeRound(roundId: string, cb: (e: RoundEvent) => void): Unsubscribe {
    return onBroadcast((m) => {
      if (m.scope === 'round' && m.id === roundId) cb(m.event as RoundEvent);
    });
  }

  subscribeEphemeral(roundId: string, cb: (e: EphemeralEvent) => void): Unsubscribe {
    return onBroadcast((m) => {
      if (m.scope === 'ephemeral' && m.id === roundId) cb(m.event as EphemeralEvent);
    });
  }

  publishEphemeral(roundId: string, e: EphemeralEvent): void {
    broadcast({ scope: 'ephemeral', id: roundId, event: e });
  }
}

function toPublicPlayer(p: PlayerRow) {
  return {
    player_id: p.id,
    group_id: p.group_id,
    nickname: p.nickname,
    avatar_key: p.avatar_key,
    is_host: p.is_host,
    is_ready: p.is_ready,
    has_left: p.has_left,
    joined_at: p.joined_at,
    last_seen_at: p.last_seen_at,
  };
}

function validatePin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new HearthError('bad_pin', 'PIN must be 4–6 digits');
}

function validateNickname(nickname: string): void {
  if (!(NICKNAME_POOL as readonly string[]).includes(nickname)) {
    throw new HearthError('nickname_taken', 'unknown nickname');
  }
}
