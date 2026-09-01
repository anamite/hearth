import type { GameModule } from '../types';
import { DealScreen, TurnScreen, TallyScreen, ResultScreen } from './screens';

const fold: GameModule = {
  id: 'fold',
  name: 'Fold',
  tagline: 'Play a card or get out. Staying one card too long is what costs you.',
  headline: 'Needs a deck of cards.',
  minPlayers: 2,
  maxPlayers: 8,
  estimatedMinutes: 10,

  settingsSchema: [
    {
      key: 'rounds_per_game',
      type: 'number',
      label: 'Rounds',
      help: 'Ninety seconds each, roughly.',
      min: 2,
      max: 12,
    },
    {
      key: 'hand_size',
      type: 'number',
      label: 'Cards dealt each round',
      min: 3,
      max: 8,
    },
    {
      key: 'turn_seconds',
      type: 'number',
      label: 'Time on a turn',
      help: 'Run out of time and you fold.',
      min: 8,
      max: 60,
      step: 2,
      unit: 's',
    },
    {
      key: 'modifiers',
      type: 'toggle',
      label: 'Bend a rule now and then',
      help: 'Doubles, negative hearts, a hidden total. Off means straight rounds only.',
    },
  ],

  phaseComponents: {
    deal: DealScreen,
    turn: TurnScreen,
    tally: TallyScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    const n = result.best_score ?? 0;
    return `Won on ${n} point${n === 1 ? '' : 's'}`;
  },
};

export default fold;
