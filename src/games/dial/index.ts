import type { GameModule } from '../types';
import { ClueScreen, GuessScreen, RevealScreen, ResultScreen } from './screens';

const dial: GameModule = {
  id: 'dial',
  name: 'Dial',
  tagline: 'Get inside each other’s heads. One clue, one dial.',
  headline: 'Everyone is on the same team.',
  minPlayers: 3,
  maxPlayers: 10,
  estimatedMinutes: 17,

  settingsSchema: [
    {
      key: 'rounds_per_game',
      type: 'number',
      label: 'Rounds',
      min: 0,
      max: 20,
      help: 'Zero means one round per player.',
    },
    {
      key: 'clue_seconds',
      type: 'number',
      label: 'Time to give a clue',
      min: 15,
      max: 180,
      step: 15,
      unit: 's',
    },
    {
      key: 'discussion_seconds',
      type: 'number',
      label: 'Time to argue',
      min: 30,
      max: 300,
      step: 15,
      unit: 's',
    },
  ],

  phaseComponents: {
    clue: ClueScreen,
    guess: GuessScreen,
    reveal: RevealScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    return `Scored ${result.total_score} of ${result.max_possible}`;
  },
};

export default dial;
