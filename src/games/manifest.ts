import type { GameType } from '@/types';
import type { GameModule } from './types';
import fakeArtist from './fakeArtist';
import nightVillage from './nightVillage';
import dial from './dial';
import grid from './grid';
import bid from './bid';
import nerve from './nerve';

/**
 * The only place that knows which games exist. The lobby's picker and the
 * round router both read from here — adding a game is one line (§10.2).
 */
export const GAMES: GameModule[] = [fakeArtist, nightVillage, dial, grid, bid, nerve];

export const GAMES_BY_ID: Record<GameType, GameModule> = Object.fromEntries(
  GAMES.map((g) => [g.id, g]),
) as Record<GameType, GameModule>;

export function gameModule(id: GameType): GameModule | undefined {
  return GAMES_BY_ID[id];
}
