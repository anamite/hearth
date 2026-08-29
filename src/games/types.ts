import type { ComponentType } from 'react';
import type { GameType, RoundPlayerView, RoundView } from '@/types';

/** What every phase component receives. Nothing else is available to it. */
export interface PhaseProps {
  view: RoundView;
  /** The caller's own row, pulled out of `view.players` for convenience. */
  me: RoundPlayerView;
  submit: (kind: string, payload?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  error: string | null;
}

export type SettingField =
  | { key: string; label: string; help?: string; type: 'toggle' }
  | {
      key: string; label: string; help?: string; type: 'number';
      min: number; max: number; step?: number; unit?: string;
    }
  | {
      key: string; label: string; help?: string; type: 'select';
      options: { value: string; label: string }[];
    };

/**
 * Spec §10.2. Adding a game means adding one of these plus one line in the
 * manifest — nothing outside `src/games/{id}/` should need to change.
 */
export interface GameModule {
  id: GameType;
  name: string;
  tagline: string;
  /** Optional headline for the lobby card, e.g. Night Village's "everybody plays". */
  headline?: string;
  minPlayers: number;
  maxPlayers: number;
  /** Shown as advice on the lobby card when the group is below this. */
  bestWith?: number;
  estimatedMinutes: number;
  settingsSchema: SettingField[];
  phaseComponents: Record<string, ComponentType<PhaseProps>>;
  /** One line for the history list. */
  summarise: (result: Record<string, any>) => string;
}
