// ---------------------------------------------------------------
// Shared contracts. Both the mock backend and the Supabase backend
// speak exactly this language, and every screen consumes only this.
// Mirrors spec §7 (RPC API) and §10 (game module interface).
// ---------------------------------------------------------------

export type GameType = 'fake_artist' | 'night_village' | 'dial';

export type AvatarKey =
  | 'fox' | 'owl' | 'bear' | 'frog' | 'whale'
  | 'cat' | 'crow' | 'deer' | 'fish' | 'moth';

/** Spec §7.1 — every error the backend can raise. */
export type ErrorCode =
  | 'not_a_member'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'already_acted'
  | 'invalid_target'
  | 'not_host'
  | 'too_few_players'
  | 'too_many_players'
  | 'bad_pin'
  | 'group_not_found'
  | 'group_full'
  | 'nickname_taken'
  | 'content_exhausted'
  | 'rate_limited'
  | 'round_not_found'
  | 'round_active'
  | 'no_active_round'
  | 'network';

export class HearthError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'HearthError';
  }
}

// ---------------------------------------------------------------
// Settings (spec §5.1)
// ---------------------------------------------------------------

export interface FakeArtistSettings {
  strokes_per_player: number;
  canvas_mode: boolean;
  vote_delay_seconds: number;
  allow_reroll: boolean;
  impostor_guess_seconds: number;
}

export interface NightVillageSettings {
  discussion_seconds: number;
  include_seer: boolean;
  include_doctor: boolean;
  doctor_self_protect: 'once' | 'never' | 'always';
  reveal_role_on_death: boolean;
  night_action_seconds: number;
}

export interface DialSettings {
  rounds_per_game: number | null;
  clue_seconds: number;
  discussion_seconds: number;
}

export interface GroupSettings {
  fake_artist: FakeArtistSettings;
  night_village: NightVillageSettings;
  dial: DialSettings;
  /** player_id of the device that plays narration audio; null = host. */
  audio_speaker_id?: string | null;
}

export const DEFAULT_SETTINGS: GroupSettings = {
  fake_artist: {
    strokes_per_player: 2,
    canvas_mode: true,
    vote_delay_seconds: 60,
    allow_reroll: true,
    impostor_guess_seconds: 15,
  },
  night_village: {
    discussion_seconds: 240,
    include_seer: true,
    include_doctor: true,
    doctor_self_protect: 'once',
    reveal_role_on_death: true,
    night_action_seconds: 45,
  },
  dial: {
    rounds_per_game: null,
    clue_seconds: 60,
    discussion_seconds: 120,
  },
  audio_speaker_id: null,
};

// ---------------------------------------------------------------
// Lobby-level shapes
// ---------------------------------------------------------------

export interface GroupPublic {
  id: string;
  code: string;
  display_name: string;
  settings: GroupSettings;
  created_at: string;
  expires_at: string;
}

export interface PlayerPublic {
  player_id: string;
  group_id: string;
  nickname: string;
  avatar_key: AvatarKey;
  is_host: boolean;
  is_ready: boolean;
  has_left: boolean;
  joined_at: string;
  last_seen_at: string;
}

export interface LobbyView {
  group: GroupPublic;
  players: PlayerPublic[];
  me: PlayerPublic;
  active_round: { round_id: string; game_type: GameType } | null;
}

// ---------------------------------------------------------------
// Round view (spec §7.3 get_my_view)
// ---------------------------------------------------------------

export interface RoundPlayerView {
  player_id: string;
  nickname: string;
  avatar_key: AvatarKey;
  is_alive: boolean;
  has_left: boolean;
  /** Public lobby state; decides which device narrates by default (§14.6). */
  is_host: boolean;
  turn_index: number | null;
  has_acted: boolean;
  /** null until the round reaches a phase where this role is public. */
  role: string | null;
}

export interface RoundView<
  TPublic = Record<string, unknown>,
  TPrivate = Record<string, unknown>,
> {
  round_id: string;
  group_id: string;
  game_type: GameType;
  phase: string;
  /** ISO timestamp, or null when the phase waits on actions only. */
  phase_ends_at: string | null;
  /** ISO timestamp from the backend — never trust the device clock. */
  server_time: string;
  day_number: number;
  pending_on: string[];
  players: RoundPlayerView[];
  public: TPublic;
  me: {
    player_id: string;
    role: string | null;
    is_alive: boolean;
    private: TPrivate;
  };
  result: RoundResult | null;
  settings: GroupSettings;
}

export type RoundResult =
  | ({ aborted?: false | undefined } & Record<string, unknown>)
  | { aborted: true | string; reason?: string; [k: string]: unknown };

// ---------------------------------------------------------------
// History & stats (spec §20)
// ---------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  round_id: string;
  game_type: GameType;
  result: Record<string, unknown>;
  ended_at: string;
}

export interface PlayerStats {
  player_id: string;
  nickname: string;
  avatar_key: AvatarKey;
  game_type: GameType;
  games_played: number;
  games_won: number;
  times_hidden: number;
  times_caught: number;
  points: number;
}

// ---------------------------------------------------------------
// Realtime (spec §9)
// ---------------------------------------------------------------

/** Content-free by design — a broadcast bug can never leak a secret. */
export type RoundEvent =
  | { type: 'phase_changed'; phase: string; phase_ends_at: string | null }
  | { type: 'player_acted'; player_id: string }
  | { type: 'round_ended' };

export type GroupEvent =
  | { type: 'players_changed' }
  | { type: 'settings_changed' }
  | { type: 'round_started'; round_id: string };

/** Ephemeral, never persisted: live strokes (§11.6) and live dial (§13.6). */
export type EphemeralEvent =
  | { type: 'stroke_progress'; player_id: string; points: [number, number][]; color: string; width: number }
  | { type: 'stroke_end'; player_id: string }
  | { type: 'dial_move'; player_id: string; position: number };

export type Unsubscribe = () => void;
