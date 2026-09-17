import { useEffect, useState } from 'react';
import type { GroupSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import type { GameModule } from '@/games/types';
import { GameCharacter } from './art';
import { Field } from './SettingField';

/**
 * The host's last look before a round: this game's settings, editable, and
 * a Start button. Games with no settings just ask for confirmation.
 * Saving goes through the ordinary updateGroupSettings call, so the round
 * starts with whatever is shown here.
 */
export function StartGameSheet({
  game,
  settings,
  busy,
  error,
  onCancel,
  onStart,
}: {
  game: GameModule;
  settings: GroupSettings;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  /** `changed` is this game's settings when the host edited them, else null. */
  onStart: (changed: Record<string, unknown> | null) => void;
}) {
  // Defaults underneath cover a group created before this game existed.
  const initial = {
    ...((DEFAULT_SETTINGS as any)[game.id] ?? {}),
    ...((settings as any)[game.id] ?? {}),
  };
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  const hasSettings = game.settingsSchema.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const changed = game.settingsSchema.some(
    (f) => JSON.stringify(draft[f.key]) !== JSON.stringify(initial[f.key]),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-game-title"
        data-game={game.id}
        className="flex max-h-[88dvh] w-full max-w-md animate-pop-in flex-col rounded-t-[1.8rem] border-2
                   border-edge bg-ash p-5 shadow-pop sm:rounded-[1.8rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3">
          <GameCharacter game={game.id} size={40} />
          <div className="min-w-0">
            <p className="label mb-0 text-accent">{hasSettings ? 'Before you start' : 'Ready?'}</p>
            <h2 id="start-game-title" className="font-display text-2xl font-extrabold leading-tight text-chalk">
              {hasSettings ? game.name : 'Start the game?'}
            </h2>
          </div>
        </div>

        {hasSettings ? (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {game.settingsSchema.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={draft[field.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
              />
            ))}
          </div>
        ) : (
          <p className="subtitle mt-3">{game.name} — {game.tagline}</p>
        )}

        {error && <p className="mt-3 text-center text-sm font-semibold text-blood">{error}</p>}

        <div className="mt-4 flex shrink-0 gap-2.5">
          <button className="btn-ghost flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary flex-1"
            disabled={busy}
            onClick={() => onStart(changed ? draft : null)}
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
