import type { GameType } from '@/types';

/**
 * Each game gets its own accent pair. The CSS variables that drive the
 * whole UI live in `index.css` under `[data-game=…]`; these literals are
 * the same colours, for the handful of places that need a real hex —
 * SVG stroke props, avatar rings, canvas ink.
 */
export interface GameTheme {
  accent: string;
  accent2: string;
  /** One word for the vibe, shown as a sticker on the lobby card. */
  flavour: string;
}

export const APP_THEME: GameTheme = {
  accent: '#FF7A29',
  accent2: '#FFC53D',
  flavour: 'Hearth',
};

export const GAME_THEMES: Record<GameType, GameTheme> = {
  fake_artist: { accent: '#FF3D8B', accent2: '#22D3EE', flavour: 'Bluff' },
  night_village: { accent: '#A78BFA', accent2: '#FF4D5E', flavour: 'Hunt' },
  dial: { accent: '#22D3EE', accent2: '#FFC53D', flavour: 'Team' },
  grid: { accent: '#B9F227', accent2: '#FF7A29', flavour: 'Race' },
  bid: { accent: '#FFC53D', accent2: '#FF3D8B', flavour: 'Duel' },
  nerve: { accent: '#3DDC84', accent2: '#FF4D5E', flavour: 'Dare' },
  fold: { accent: '#FF4D5E', accent2: '#FFC53D', flavour: 'Push' },
  season: { accent: '#22D3EE', accent2: '#B9F227', flavour: 'Weather' },
  envelope: { accent: '#A78BFA', accent2: '#FFC53D', flavour: 'Deal' },
};

export function gameTheme(id: GameType | null | undefined): GameTheme {
  return (id && GAME_THEMES[id]) || APP_THEME;
}

export function gameAccent(id: GameType | null | undefined): string {
  return gameTheme(id).accent;
}
