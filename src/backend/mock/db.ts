import type { AvatarKey, GameType, GroupSettings, RoundResult } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import fakeArtistContent from '../../../content/fake_artist.json';
import dialContent from '../../../content/dial.json';
import seasonContent from '../../../content/season.json';
import envelopeContent from '../../../content/envelope.json';

// ---------------------------------------------------------------
// Row shapes — deliberately 1:1 with the SQL tables in spec §5 so
// that porting a query from here to Postgres is mechanical.
// ---------------------------------------------------------------

export interface GroupRow {
  id: string;
  code: string;
  display_name: string;
  pin_hash: string;
  settings: GroupSettings;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

export interface PlayerRow {
  id: string;
  group_id: string;
  auth_uid: string;
  nickname: string;
  avatar_key: AvatarKey;
  is_host: boolean;
  is_ready: boolean;
  has_left: boolean;
  joined_at: string;
  last_seen_at: string;
}

export interface RoundRow {
  id: string;
  group_id: string;
  game_type: GameType;
  phase: string;
  phase_ends_at: string | null;
  pending_on: string[];
  /**
   * True when the phase was entered expecting player actions. Without this,
   * a display-only phase (`morning`, 8s, nobody to act) would read as
   * "pending_on is empty, therefore due" and fire instantly. See §8.1.
   */
  expects_actions: boolean;
  /** SECRET. Never leaves the backend except through a game's view fn. */
  state: Record<string, any>;
  day_number: number;
  settings: GroupSettings;
  started_at: string;
  ended_at: string | null;
  result: RoundResult | null;
}

export interface RoundPlayerRow {
  round_id: string;
  player_id: string;
  role: string;
  /** SECRET, per-player. */
  private: Record<string, any>;
  is_alive: boolean;
  turn_index: number | null;
}

export interface ActionRow {
  id: string;
  round_id: string;
  player_id: string;
  phase: string;
  kind: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface UsedContentRow {
  group_id: string;
  content_id: string;
  round_id: string | null;
  used_at: string;
}

export interface HistoryRow {
  id: string;
  group_id: string;
  round_id: string;
  game_type: GameType;
  result: Record<string, any>;
  ended_at: string;
}

export interface StatsRow {
  group_id: string;
  player_id: string;
  game_type: GameType;
  games_played: number;
  games_won: number;
  times_hidden: number;
  times_caught: number;
  points: number;
}

export interface ContentItem {
  id: string;
  game_type: GameType;
  payload: Record<string, any>;
  category: string | null;
  difficulty: number;
  active: boolean;
}

export interface MockDb {
  v: number;
  groups: GroupRow[];
  players: PlayerRow[];
  rounds: RoundRow[];
  round_players: RoundPlayerRow[];
  actions: ActionRow[];
  group_used_content: UsedContentRow[];
  games_history: HistoryRow[];
  player_stats: StatsRow[];
}

const DB_KEY = 'hearth.mock.db.v1';
const UID_KEY = 'hearth.mock.uid';
export const MOCK_CHANNEL = 'hearth.mock.events';

function emptyDb(): MockDb {
  return {
    v: 1,
    groups: [],
    players: [],
    rounds: [],
    round_players: [],
    actions: [],
    group_used_content: [],
    games_history: [],
    player_stats: [],
  };
}

// ---------------------------------------------------------------
// Content bank. Ids are derived from the array index so that a
// group's "already used" list survives a page reload.
// ---------------------------------------------------------------

export const CONTENT: ContentItem[] = [
  ...(fakeArtistContent as any[]).map((p, i) => ({
    id: `fa-${i}`,
    game_type: 'fake_artist' as GameType,
    payload: { text: p.text, description: p.description, aliases: p.aliases },
    category: p.category ?? null,
    difficulty: p.difficulty ?? 1,
    active: true,
  })),
  ...(dialContent as any[]).map((p, i) => ({
    id: `dial-${i}`,
    game_type: 'dial' as GameType,
    payload: { left: p.left, right: p.right },
    category: p.category ?? null,
    difficulty: p.difficulty ?? 1,
    active: true,
  })),
  ...(seasonContent as any[]).map((p, i) => ({
    id: `season-${i}`,
    game_type: 'season' as GameType,
    payload: { text: p.text },
    category: p.category ?? null,
    difficulty: p.difficulty ?? 1,
    active: true,
  })),
  ...(envelopeContent as any[]).map((p, i) => ({
    id: `env-${i}`,
    game_type: 'envelope' as GameType,
    payload: { text: p.text, points: p.points ?? 3 },
    category: p.category ?? null,
    difficulty: p.difficulty ?? 1,
    active: true,
  })),
];

// ---------------------------------------------------------------
// Identity.
//
// sessionStorage, not localStorage — that is what makes each browser
// TAB a separate player, so one laptop can host a five-player game.
// The real Supabase backend persists identity in localStorage instead
// (spec §4.1); nothing outside this file depends on the difference.
// ---------------------------------------------------------------

export function mockAuthUid(): string {
  let uid = sessionStorage.getItem(UID_KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    sessionStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export function resetMockIdentity(): void {
  sessionStorage.removeItem(UID_KEY);
}

// ---------------------------------------------------------------
// Storage. Every mutation is read-modify-write against localStorage,
// so two tabs acting at once cannot each hold a stale snapshot for
// long. This stands in for `select ... for update` (spec §8.3).
// ---------------------------------------------------------------

export function loadDb(): MockDb {
  return loadDbRaw().db;
}

/** The parsed database plus the exact string it came from, for CAS below. */
export function loadDbRaw(): { db: MockDb; raw: string | null } {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { db: emptyDb(), raw: null };
    return { db: { ...emptyDb(), ...(JSON.parse(raw) as MockDb) }, raw };
  } catch {
    return { db: emptyDb(), raw: null };
  }
}

export function saveDb(db: MockDb): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

/**
 * Compare-and-swap. localStorage has no transactions, so two tabs writing at
 * the same instant would otherwise silently clobber one another — five people
 * tapping "ready" together is not a rare case. Writing only when the stored
 * string is still the one we read gives us the serialisation that
 * `select ... for update` provides on the real backend (§8.3).
 *
 * Safe because everything between the check and the write is synchronous:
 * no other tab's JS can interleave.
 */
export function compareAndSwap(expected: string | null, db: MockDb): boolean {
  if (localStorage.getItem(DB_KEY) !== expected) return false;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return true;
}

export function resetDb(): void {
  localStorage.removeItem(DB_KEY);
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(MOCK_CHANNEL);
  return channel;
}

export interface MockMessage {
  scope: 'group' | 'round' | 'ephemeral';
  id: string;
  event: any;
}

/**
 * Events raised inside a transaction are held until it commits, so a retried
 * attempt cannot emit a broadcast for work that was rolled back.
 */
let txBuffer: MockMessage[] | null = null;

export function beginTxBuffer(): void {
  txBuffer = [];
}
export function flushTxBuffer(): void {
  const pending = txBuffer ?? [];
  txBuffer = null;
  for (const msg of pending) emit(msg);
}
export function discardTxBuffer(): void {
  txBuffer = null;
}

function emit(msg: MockMessage): void {
  getChannel()?.postMessage(msg);
  // Same-tab listeners do not receive their own BroadcastChannel posts.
  window.dispatchEvent(new CustomEvent('hearth-mock', { detail: msg }));
}

export function broadcast(msg: MockMessage): void {
  if (txBuffer) txBuffer.push(msg);
  else emit(msg);
}

export function onBroadcast(cb: (m: MockMessage) => void): () => void {
  const ch = getChannel();
  const onMsg = (e: MessageEvent) => cb(e.data as MockMessage);
  const onLocal = (e: Event) => cb((e as CustomEvent).detail as MockMessage);
  ch?.addEventListener('message', onMsg);
  window.addEventListener('hearth-mock', onLocal);
  return () => {
    ch?.removeEventListener('message', onMsg);
    window.removeEventListener('hearth-mock', onLocal);
  };
}

/**
 * Mock-only PIN hash. This is NOT a security boundary — the mock DB lives
 * in the player's own browser and they can read it whenever they like.
 * The real backend uses bcrypt via pgcrypto (spec §4.2).
 */
export function mockHashPin(pin: string): string {
  let h = 2166136261;
  for (let i = 0; i < pin.length; i++) {
    h ^= pin.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `mock$${(h >>> 0).toString(36)}`;
}

export function defaultSettings(): GroupSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
