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
            className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition
              ${selected ? 'border-ember bg-ember/10' : 'border-edge/70 bg-ash/50'}
              ${disabled ? 'opacity-40' : 'active:scale-95'}`}
          >
            <AvatarBadge
              avatarKey={p.avatar_key}
              size={46}
              dimmed={dead}
              ring={rings?.[p.player_id]}
            />
            <span className="max-w-full truncate text-sm font-semibold text-chalk">
              {p.nickname}
            </span>

            {captions?.[p.player_id] ? (
              <span className="text-[0.68rem] leading-tight text-mute">
                {captions[p.player_id]}
              </span>
            ) : dead ? (
              <span className="text-[0.68rem] text-mute">{p.has_left ? 'left' : 'out'}</span>
            ) : showActed ? (
              <span
                className={`text-[0.68rem] ${p.has_acted ? 'text-moss' : 'text-mute/60'}`}
              >
                {p.has_acted ? 'ready' : 'thinking'}
              </span>
            ) : p.role ? (
              <span className="text-[0.68rem] uppercase tracking-wide text-mute">{p.role}</span>
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
          <div key={p.player_id} className="relative">
            <AvatarBadge
              avatarKey={p.avatar_key}
              size={active ? 44 : 34}
              dimmed={p.has_left || (!active && !doneIds?.has(p.player_id))}
              ring={active ? '#E8743B' : undefined}
            />
            {doneIds?.has(p.player_id) && !active && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-moss text-[0.55rem] font-bold text-ink">
                ✓
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
