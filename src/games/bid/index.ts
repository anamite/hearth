import type { GameModule } from '../types';
import { BidScreen, RevealScreen, ResultScreen } from './screens';

const bid: GameModule = {
  id: 'bid',
  name: 'Bid',
  tagline: 'Fifteen slips, fifteen prizes. Match someone and you both get nothing.',
  headline: 'Works properly at two.',
  minPlayers: 2,
  maxPlayers: 8,
  estimatedMinutes: 20,

  settingsSchema: [
    {
      key: 'bid_seconds',
      type: 'number',
      label: 'Time to choose a slip',
      min: 10,
      max: 120,
      step: 5,
      unit: 's',
    },
    {
      key: 'reveal_seconds',
      type: 'number',
      label: 'Time to look at the reveal',
      min: 4,
      max: 30,
      unit: 's',
    },
  ],

  phaseComponents: {
    bid: BidScreen,
    reveal: RevealScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    const score = result.best_score ?? 0;
    return `Won on ${score > 0 ? `+${score}` : score}`;
  },
};

export default bid;
