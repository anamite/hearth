import type { GameModule } from '../types';
import { SeasonScreen, TrickScreen, ResultScreen } from './screens';

const season: GameModule = {
  id: 'season',
  name: 'Season',
  tagline: 'A trick-taking game so simple a child plays it — under a rule that keeps changing.',
  headline: 'Needs a deck of cards.',
  minPlayers: 3,
  maxPlayers: 6,
  bestWith: 4,
  estimatedMinutes: 20,

  settingsSchema: [
    {
      key: 'seasons_per_game',
      type: 'number',
      label: 'Seasons',
      help: 'One rule each. The game ends when the last one does.',
      min: 2,
      max: 10,
    },
    {
      key: 'tricks_per_season',
      type: 'number',
      label: 'Tricks in a season',
      min: 2,
      max: 8,
    },
    {
      key: 'secret_seasons',
      type: 'toggle',
      label: 'Hidden seasons',
      help: 'Sometimes only one player is shown the rule. Everyone else works it out live.',
    },
    {
      key: 'trick_seconds',
      type: 'number',
      label: 'Longest a trick may take',
      help: 'Nobody claims it in time and the trick goes to nobody.',
      min: 30,
      max: 600,
      step: 30,
      unit: 's',
    },
  ],

  phaseComponents: {
    season: SeasonScreen,
    trick: TrickScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    const n = result.best_score ?? 0;
    return `Won on ${n} trick${n === 1 ? '' : 's'}`;
  },
};

export default season;
