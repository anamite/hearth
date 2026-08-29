import type { GameModule } from '../types';
import {
  RevealScreen, NightScreen, MorningScreen, DayDiscussScreen,
  DayVoteScreen, EveningScreen, ResultScreen,
} from './screens';

const nightVillage: GameModule = {
  id: 'night_village',
  name: 'Night Village',
  tagline: 'Some of you are wolves. Nobody sits this one out.',
  headline: 'The app is the moderator — everybody plays.',
  minPlayers: 6,
  maxPlayers: 12,
  bestWith: 8,
  estimatedMinutes: 22,

  settingsSchema: [
    {
      key: 'discussion_seconds',
      type: 'number',
      label: 'Discussion time',
      min: 60,
      max: 600,
      step: 30,
      unit: 's',
    },
    {
      key: 'night_action_seconds',
      type: 'number',
      label: 'Night action time',
      min: 20,
      max: 120,
      step: 5,
      unit: 's',
    },
    { key: 'include_seer', type: 'toggle', label: 'Include the Seer' },
    { key: 'include_doctor', type: 'toggle', label: 'Include the Doctor' },
    {
      key: 'doctor_self_protect',
      type: 'select',
      label: 'Doctor can protect themselves',
      options: [
        { value: 'once', label: 'Once per game' },
        { value: 'never', label: 'Never' },
        { value: 'always', label: 'Any night' },
      ],
    },
    {
      key: 'reveal_role_on_death',
      type: 'toggle',
      label: 'Announce the role on death',
      help: 'Off makes the village’s job much harder. For experienced groups.',
    },
  ],

  phaseComponents: {
    reveal: RevealScreen,
    night_wolves: NightScreen,
    night_seer: NightScreen,
    night_doctor: NightScreen,
    morning: MorningScreen,
    day_discuss: DayDiscussScreen,
    day_vote: DayVoteScreen,
    evening: EveningScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    return result.winner === 'village' ? 'The village survived' : 'The wolves took the village';
  },
};

export default nightVillage;
