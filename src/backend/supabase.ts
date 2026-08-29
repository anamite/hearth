import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AvatarKey, EphemeralEvent, GameType, GroupEvent, GroupSettings, HistoryEntry,
  LobbyView, PlayerStats, RoundEvent, RoundView, Unsubscribe,
} from '@/types';
import { HearthError, type ErrorCode } from '@/types';
import type { Backend } from './types';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

const KNOWN_CODES = new Set<ErrorCode>([
  'not_a_member', 'wrong_phase', 'not_your_turn', 'already_acted', 'invalid_target',
  'not_host', 'too_few_players', 'too_many_players', 'bad_pin', 'group_not_found',
  'group_full', 'nickname_taken', 'content_exhausted', 'rate_limited',
  'round_not_found', 'round_active', 'no_active_round',
]);

/** Postgres raises `message = '<code>'`; anything else is a transport problem. */
function toHearthError(err: unknown): HearthError {
  const msg = (err as any)?.message ?? '';
  const code = String(msg).trim() as ErrorCode;
  if (KNOWN_CODES.has(code)) return new HearthError(code);
  return new HearthError('network', String(msg || 'request failed'));
}

/**
 * Thin wrapper over the Postgres RPCs in supabase/migrations. Every method
 * here is one `.rpc()` call — all game logic lives in the database, per §3.
 */
export class SupabaseBackend implements Backend {
  private client: SupabaseClient;
  private uid = '';
  private channels = new Map<string, ReturnType<SupabaseClient['channel']>>();

  constructor(url = SUPABASE_URL, publishableKey = SUPABASE_KEY) {
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  /** Spec §4.1 — anonymous sign-in, never surfaced to the user. */
  async init(): Promise<void> {
    const { data } = await this.client.auth.getSession();
    if (data.session?.user?.id) {
      this.uid = data.session.user.id;
      return;
    }
    const { data: signed, error } = await this.client.auth.signInAnonymously();
    if (error) throw toHearthError(error);
    this.uid = signed.user?.id ?? '';
  }

  authUid(): string {
    return this.uid;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toHearthError(error);
    return data as T;
  }

  /**
   * Spec §18.1 — exchange the Turnstile token for a short-lived signed nonce
   * that create_group / join_group will accept.
   */
  private async turnstileNonce(token: string): Promise<string> {
    const { data, error } = await this.client.functions.invoke('verify-turnstile', {
      body: { token },
    });
    if (error) throw new HearthError('rate_limited', 'bot check failed');
    return (data as { nonce: string }).nonce;
  }

  async createGroup(a: {
    pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }) {
    const nonce = await this.turnstileNonce(a.turnstileToken);
    return this.rpc<{ group_id: string; code: string; display_name: string; player_id: string }>('create_group', {
      p_pin: a.pin,
      p_nickname: a.nickname,
      p_avatar_key: a.avatarKey,
      p_turnstile_nonce: nonce,
    });
  }

  async joinGroup(a: {
    code: string; pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }) {
    const nonce = await this.turnstileNonce(a.turnstileToken);
    return this.rpc<{ group_id: string; code: string; display_name: string; player_id: string }>('join_group', {
      p_code: a.code,
      p_pin: a.pin,
      p_nickname: a.nickname,
      p_avatar_key: a.avatarKey,
      p_turnstile_nonce: nonce,
    });
  }

  getLobby(code: string): Promise<LobbyView> {
    return this.rpc('get_lobby', { p_code: code });
  }

  availableNicknames(code: string): Promise<string[]> {
    return this.rpc('available_nicknames', { p_code: code });
  }

  peekGroup(code: string): Promise<{ display_name: string; player_count: number } | null> {
    return this.rpc('peek_group', { p_code: code });
  }

  leaveGroup(groupId: string): Promise<void> {
    return this.rpc('leave_group', { p_group_id: groupId });
  }

  setReady(groupId: string, ready: boolean): Promise<void> {
    return this.rpc('set_ready', { p_group_id: groupId, p_ready: ready });
  }

  updateGroupSettings(groupId: string, settings: Partial<GroupSettings>): Promise<void> {
    return this.rpc('update_group_settings', { p_group_id: groupId, p_settings: settings });
  }

  heartbeat(groupId: string): Promise<void> {
    return this.rpc('heartbeat', { p_group_id: groupId });
  }

  startRound(groupId: string, gameType: GameType): Promise<string> {
    return this.rpc('start_round', { p_group_id: groupId, p_game_type: gameType });
  }

  getMyView(roundId: string): Promise<RoundView> {
    return this.rpc('get_my_view', { p_round_id: roundId });
  }

  advanceIfDue(roundId: string): Promise<RoundView> {
    return this.rpc('advance_if_due', { p_round_id: roundId });
  }

  submitAction(roundId: string, kind: string, payload: Record<string, unknown>): Promise<RoundView> {
    return this.rpc('submit_action', { p_round_id: roundId, p_kind: kind, p_payload: payload });
  }

  abortRound(roundId: string): Promise<void> {
    return this.rpc('abort_round', { p_round_id: roundId });
  }

  getHistory(groupId: string, limit = 50): Promise<HistoryEntry[]> {
    return this.rpc('get_history', { p_group_id: groupId, p_limit: limit });
  }

  getStats(groupId: string): Promise<PlayerStats[]> {
    return this.rpc('get_stats', { p_group_id: groupId });
  }

  getBestScore(groupId: string, gameType: GameType): Promise<number | null> {
    return this.rpc('get_best_score', { p_group_id: groupId, p_game_type: gameType });
  }

  // -------------------------------------------------------------
  // §9 realtime
  // -------------------------------------------------------------

  /** Lobby membership is public, so Postgres Changes on the view is safe. */
  subscribeGroup(groupId: string, cb: (e: GroupEvent) => void): Unsubscribe {
    const key = `group:${groupId}`;
    const ch = this.client
      .channel(key)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `group_id=eq.${groupId}` },
        () => cb({ type: 'players_changed' }),
      )
      .on('broadcast', { event: 'group' }, ({ payload }) => cb(payload as GroupEvent))
      .subscribe();
    this.channels.set(key, ch);
    return () => {
      this.client.removeChannel(ch);
      this.channels.delete(key);
    };
  }

  /** `rounds` denies SELECT, so phase changes arrive as content-free broadcasts. */
  subscribeRound(roundId: string, cb: (e: RoundEvent) => void): Unsubscribe {
    const key = `round:${roundId}`;
    const ch = this.client
      .channel(key)
      .on('broadcast', { event: 'phase_changed' }, ({ payload }) =>
        cb({ type: 'phase_changed', ...(payload as any) }))
      .on('broadcast', { event: 'player_acted' }, ({ payload }) =>
        cb({ type: 'player_acted', ...(payload as any) }))
      .on('broadcast', { event: 'round_ended' }, () => cb({ type: 'round_ended' }))
      .subscribe();
    this.channels.set(key, ch);
    return () => {
      this.client.removeChannel(ch);
      this.channels.delete(key);
    };
  }

  /** Never touches the database (§11.6, §13.6). */
  subscribeEphemeral(roundId: string, cb: (e: EphemeralEvent) => void): Unsubscribe {
    const key = `draw:${roundId}`;
    const ch = this.client
      .channel(key, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'e' }, ({ payload }) => cb(payload as EphemeralEvent))
      .subscribe();
    this.channels.set(key, ch);
    return () => {
      this.client.removeChannel(ch);
      this.channels.delete(key);
    };
  }

  publishEphemeral(roundId: string, e: EphemeralEvent): void {
    const ch = this.channels.get(`draw:${roundId}`);
    ch?.send({ type: 'broadcast', event: 'e', payload: e });
  }
}
