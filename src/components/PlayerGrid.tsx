import type { RoundPlayerView } from '@/types';
import { AvatarBadge } from './Avatar';

export interface PlayerGridProps {
  players: RoundPlayerView[];
  selectedId?: string | null;
  onSelect?: (playerId: string) => void;
  /** Players that cannot be picked, with the reason shown underneath. */
  disabledIds?: Set<string>;
  /** Coloured rings, e.g. fellow wolves' current picks (§12.12). */
  rings?: Record<string, string>;
  /** Small caption under a name, e.g. "voted" or a seer result. */
  captions?: Record<string, string>;
  showActed?: boolean;
  columns?: 2 | 3;
}

export function PlayerGrid({
  players,
  selectedId,
  onSelect,
  disabledIds,
  rings,
  captions,
  showActed = false,
  columns = 3,
}: PlayerGridProps) {
  return (
    <div className={`grid gap-2.5 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {players.map((p) => {
        const dead = !p.is_alive || p.has_left;
        const disabled = dead || disabledIds?.has(p.player_id) || !onSelect;
        const selected = selectedId === p.player_id;

        return (
          <button
            key={p.player_id}
            disabled={disabled}
            onClick={() => onSelect?.(p.player_id)}
            className={`relative flex flex-col items-center gap-1.5 rounded-[1.15rem] border-2 p-3
              transition-all duration-100
              ${
                selected
                  ? 'border-accent bg-accent/15 shadow-glow'
                  : 'border-edge/80 bg-slatey/55'
              }
              ${
                disabled
                  ? 'opacity-40'
                  : 'shadow-pop-sm active:translate-y-[3px] active:shadow-none'
              }`}
          >
            {selected && (
              <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 rotate-6 items-center justify-center rounded-lg border-2 border-black/40 bg-accent text-[0.7rem] font-black text-ink">
                ✓
              </span>
            )}

            <AvatarBadge
              avatarKey={p.avatar_key}
              size={46}
              dimmed={dead}
              ring={rings?.[p.player_id]}
            />
            <span className="max-w-full truncate text-sm font-bold text-chalk">
              {p.nickname}
            </span>

            {captions?.[p.player_id] ? (
              <span className="text-[0.66rem] font-bold uppercase leading-tight tracking-wide text-mute">
                {captions[p.player_id]}
              </span>
            ) : dead ? (
              <span className="text-[0.66rem] font-bold uppercase tracking-wide text-mute">
                {p.has_left ? 'left' : 'out'}
              </span>
            ) : showActed ? (
              <span
                className={`text-[0.66rem] font-bold uppercase tracking-wide ${
                  p.has_acted ? 'text-moss' : 'text-mute/60'
                }`}
              >
                {p.has_acted ? 'ready' : 'thinking'}
              </span>
            ) : p.role ? (
              <span className="text-[0.66rem] font-bold uppercase tracking-wide text-mute">
                {p.role}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A compact horizontal row, for turn order and progress. */
export function PlayerRow({
  players,
  activeId,
  doneIds,
}: {
  players: RoundPlayerView[];
  activeId?: string | null;
  doneIds?: Set<string>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {players.map((p) => {
        const active = p.player_id === activeId;
        return (
          <div key={p.player_id} className={`relative ${active ? 'animate-wobble' : ''}`}>
            <AvatarBadge
              avatarKey={p.avatar_key}
              size={active ? 46 : 34}
              dimmed={p.has_left || (!active && !doneIds?.has(p.player_id))}
              ring={active ? 'rgb(var(--accent-rgb))' : undefined}
            />
            {doneIds?.has(p.player_id) && !active && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-ink bg-moss text-[0.5rem] font-black text-ink">
                ✓
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
