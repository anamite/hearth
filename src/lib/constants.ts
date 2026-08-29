import type { AvatarKey } from '@/types';

/** Spec §16.1 — exactly 24, fixed, because narration audio needs one clip per name. */
export const NICKNAME_POOL = [
  'Baker', 'Miller', 'Fletcher', 'Mason', 'Cooper', 'Sawyer',
  'Fox', 'Wren', 'Pike', 'Crow', 'Hare', 'Moth',
  'Ash', 'Birch', 'Cove', 'Fern', 'Reed', 'Vale',
  'Ember', 'Frost', 'Dusk', 'Flint', 'Slate', 'Wick',
] as const;

/** Spec §16.2 — 10 avatars; the colour doubles as the player's stroke colour. */
export const AVATARS: { key: AvatarKey; color: string; label: string }[] = [
  { key: 'fox',   color: '#E8743B', label: 'Fox' },
  { key: 'owl',   color: '#7C5CBF', label: 'Owl' },
  { key: 'bear',  color: '#8B5E3C', label: 'Bear' },
  { key: 'frog',  color: '#4CA64C', label: 'Frog' },
  { key: 'whale', color: '#2E7DAF', label: 'Whale' },
  { key: 'cat',   color: '#D4A017', label: 'Cat' },
  { key: 'crow',  color: '#3A3A3A', label: 'Crow' },
  { key: 'deer',  color: '#B8654F', label: 'Deer' },
  { key: 'fish',  color: '#2FA8A0', label: 'Fish' },
  { key: 'moth',  color: '#B45D9E', label: 'Moth' },
];

export const AVATAR_KEYS = AVATARS.map((a) => a.key);

export function avatarColor(key: AvatarKey | string): string {
  return AVATARS.find((a) => a.key === key)?.color ?? '#8B8798';
}

/** Spec §4.2 — ambiguous 0/O/1/I/L excluded. 31 chars, ~887M codes. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/** Cosmetic two-word group names (§4.2). Plays no part in access control. */
export const GROUP_NAME_ADJECTIVES = [
  'Amber', 'Copper', 'Quiet', 'Hollow', 'Velvet', 'Crimson', 'Golden', 'Silver',
  'Restless', 'Midnight', 'Wandering', 'Gentle', 'Iron', 'Paper', 'Salt', 'Wild',
  'Distant', 'Bramble', 'Clover', 'Marble', 'Rusted', 'Drifting', 'Sunken', 'Bright',
];
export const GROUP_NAME_NOUNS = [
  'Fox', 'Lantern', 'Harbour', 'Thicket', 'Compass', 'Sparrow', 'Kettle', 'Orchard',
  'Anchor', 'Meadow', 'Chapel', 'Ferry', 'Willow', 'Beacon', 'Cellar', 'Bellows',
  'Hollow', 'Bridge', 'Almanac', 'Cinder', 'Quarry', 'Tavern', 'Lighthouse', 'Kestrel',
];

export const GROUP_MAX_PLAYERS = 12;
export const GROUP_TTL_DAYS = 100;

/** How often the client refreshes while a round is live (§9.2). */
export const POLL_INTERVAL_MS = 2000;
export const HEARTBEAT_INTERVAL_MS = 20000;
/** Spec §15.4 — every secret card must require a deliberate hold. */
export const REVEAL_HOLD_MS = 400;
