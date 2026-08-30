import type { GameModule } from '../types';
import { RevealScreen, ScoringScreen, ResultScreen } from './screens';

const grid: GameModule = {
  id: 'grid',
  name: 'Grid',
  tagline: 'One deck, one square each. Twenty-five bets on what comes next.',
  headline: 'Everybody plays at once.',
  minPlayers: 1,
  maxPlayers: 12,
  estimatedMinutes: 15,

  settingsSchema: [
    {
      key: 'reveal_seconds',
      type: 'number',
      label: 'Seconds per card',
      min: 4,
      max: 20,
      unit: 's',
      help: 'Eight is brisk. Six is mean.',
    },
    {
      key: 'show_tally',
      type: 'toggle',
      label: 'Show what is left in the deck',
      help: 'Off makes counting cards your own problem.',
    },
  ],

  phaseComponents: {
    reveal: RevealScreen,
    scoring: ScoringScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    return `Best grid ${result.best_score} of ${result.max_score}`;
  },
};

export default grid;
