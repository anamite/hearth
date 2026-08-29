import type {
  AvatarKey, GameType, GroupEvent, GroupSettings, HistoryEntry, LobbyView,
  PlayerStats, RoundEvent, EphemeralEvent, RoundView, Unsubscribe,
} from '@/types';

/**
 * The complete surface a Hearth backend must provide.
 * Method names map 1:1 onto the Postgres RPCs in spec §7, so the
 * Supabase implementation is a thin `.rpc()` wrapper and nothing else
 * in the app knows which backend it is talking to.
 */
export interface Backend {
  /** Establishes identity (anonymous). Safe to call repeatedly. */
  init(): Promise<void>;
  /** Stable per-device id — `auth.uid()` under Supabase. */
  authUid(): string;

  // --- §7.2 group and lobby ---
  createGroup(a: {
    pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }): Promise<{ group_id: string; code: string; display_name: string; player_id: string }>;

  joinGroup(a: {
    code: string; pin: string; nickname: string; avatarKey: AvatarKey; turnstileToken: string;
  }): Promise<{ group_id: string; code: string; display_name: string; player_id: string }>;

  /** Lobby state for a group the caller belongs to. */
  getLobby(code: string): Promise<LobbyView>;
  /** Names still free in this group, for the join screen (§16.1). */
  availableNicknames(code: string): Promise<string[]>;
  /** Does this code exist? Used to prefill/validate the join screen. */
  peekGroup(code: string): Promise<{ display_name: string; player_count: number } | null>;

  leaveGroup(groupId: string): Promise<void>;
  setReady(groupId: string, ready: boolean): Promise<void>;
  updateGroupSettings(groupId: string, settings: Partial<GroupSettings>): Promise<void>;
  heartbeat(groupId: string): Promise<void>;

  // --- §7.3 round lifecycle ---
  startRound(groupId: string, gameType: GameType): Promise<string>;
  getMyView(roundId: string): Promise<RoundView>;
  advanceIfDue(roundId: string): Promise<RoundView>;
  submitAction(roundId: string, kind: string, payload: Record<string, unknown>): Promise<RoundView>;
  abortRound(roundId: string): Promise<void>;

  // --- §20 history and stats ---
  getHistory(groupId: string, limit?: number): Promise<HistoryEntry[]>;
  getStats(groupId: string): Promise<PlayerStats[]>;
  /** Best previous cooperative score, for Dial's result screen. */
  getBestScore(groupId: string, gameType: GameType): Promise<number | null>;

  // --- §9 realtime ---
  subscribeGroup(groupId: string, cb: (e: GroupEvent) => void): Unsubscribe;
  subscribeRound(roundId: string, cb: (e: RoundEvent) => void): Unsubscribe;
  subscribeEphemeral(roundId: string, cb: (e: EphemeralEvent) => void): Unsubscribe;
  publishEphemeral(roundId: string, e: EphemeralEvent): void;
}
