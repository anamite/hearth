import type { GameModule } from '../types';
import { PlaceScreen, TurnScreen, FlipScreen, RoundEndScreen, ResultScreen } from './screens';

const nerve: GameModule = {
  id: 'nerve',
  name: 'Nerve',
  tagline: 'Four scraps of paper each. Three dots, one X, and your face.',
  headline: 'No luck in it at all.',
  minPlayers: 3,
  maxPlayers: 6,
  estimatedMinutes: 15,

  settingsSchema: [
    {
      key: 'wins_needed',
      type: 'number',
      label: 'Rounds needed to win',
      min: 1,
      max: 5,
      help: 'Two is the classic. One is a knife fight.',
    },
    {
      key: 'place_seconds',
      type: 'number',
      label: 'Time to lay the first scrap',
      min: 10,
      max: 120,
      step: 5,
      unit: 's',
    },
    {
      key: 'turn_seconds',
      type: 'number',
      label: 'Time per turn',
      min: 15,
      max: 180,
      step: 5,
      unit: 's',
    },
  ],

  phaseComponents: {
    place: PlaceScreen,
    turn: TurnScreen,
    flip: FlipScreen,
    round_end: RoundEndScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    if (result.reason === 'last_standing') return 'Won on the last scrap';
    const best = (result.standings ?? [])[0];
    return `Won ${best?.wins ?? 0} rounds`;
  },
};

export default nerve;
