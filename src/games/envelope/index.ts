import type { GameModule } from '../types';
import { BriefScreen, TradeScreen, EventScreen, RevealScreen, ResultScreen } from './screens';

const envelope: GameModule = {
  id: 'envelope',
  name: 'Envelope',
  tagline: 'Everyone wants something. Nobody will say what. Now start trading.',
  headline: 'Needs a deck of cards.',
  minPlayers: 4,
  maxPlayers: 8,
  bestWith: 5,
  estimatedMinutes: 25,

  settingsSchema: [
    {
      key: 'sessions',
      type: 'number',
      label: 'Trading sessions',
      help: 'An event lands between each one.',
      min: 2,
      max: 6,
    },
    {
      key: 'session_seconds',
      type: 'number',
      label: 'Length of a session',
      min: 60,
      max: 600,
      step: 30,
      unit: 's',
    },
    {
      key: 'brief_seconds',
      type: 'number',
      label: 'Time to read your envelope',
      min: 20,
      max: 180,
      step: 10,
      unit: 's',
    },
  ],

  phaseComponents: {
    brief: BriefScreen,
    trade: TradeScreen,
    event: EventScreen,
    reveal: RevealScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    const standings = (result.standings ?? []) as { made: boolean }[];
    const made = standings.filter((s) => s.made).length;
    return `${made} of ${standings.length} delivered`;
  },
};

export default envelope;
