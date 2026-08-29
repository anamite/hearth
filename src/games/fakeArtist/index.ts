import type { GameModule } from '../types';
import {
  RevealScreen, DrawingScreen, VotingScreen, GuessScreen, ResultScreen, FallbackScreen,
} from './screens';

const fakeArtist: GameModule = {
  id: 'fake_artist',
  name: 'Fake Artist',
  tagline: 'One of you has no idea what you are drawing.',
  minPlayers: 4,
  maxPlayers: 10,
  estimatedMinutes: 8,

  settingsSchema: [
    {
      key: 'canvas_mode',
      type: 'toggle',
      label: 'Draw on the phone',
      help: 'Off means paper and pens — less screen time, and the recommended way to start.',
    },
    {
      key: 'strokes_per_player',
      type: 'number',
      label: 'Turns each',
      min: 1,
      max: 4,
      help: 'How many times the drawing goes around the group.',
    },
    {
      key: 'vote_delay_seconds',
      type: 'number',
      label: 'Talk before voting',
      min: 0,
      max: 300,
      step: 15,
      unit: 's',
      help: 'Stops the group jumping straight to a vote.',
    },
    {
      key: 'impostor_guess_seconds',
      type: 'number',
      label: 'Impostor’s last guess',
      min: 5,
      max: 60,
      step: 5,
      unit: 's',
    },
    {
      key: 'allow_reroll',
      type: 'toggle',
      label: 'Allow rerolls',
      help: 'A majority can swap the word — and the Impostor — before drawing starts.',
    },
  ],

  phaseComponents: {
    reveal: RevealScreen,
    drawing: DrawingScreen,
    voting: VotingScreen,
    guess: GuessScreen,
    result: ResultScreen,
    setup: FallbackScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    const who = result.winner === 'artists' ? 'Artists won' : 'Impostor won';
    return `${who} · ${result.word ?? ''}`;
  },
};

export default fakeArtist;
