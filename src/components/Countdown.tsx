import { useRoundStore, secondsLeft } from '@/store/round';
import { useTicker } from '@/lib/hooks';

function format(s: number): string {
  if (s < 60) return `${s}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Rendered from `phase_ends_at − server_time`, never from the raw device
 * clock (spec §15.4). The client only displays it — expiry is the server's
 * call, made when the poll loop calls advance_if_due.
 */
export function Countdown({
  size = 'md',
  className = '',
  warnAt = 10,
}: {
  size?: 'sm' | 'md' | 'xl';
  className?: string;
  warnAt?: number;
}) {
  useTicker();
  const view = useRoundStore((s) => s.view);
  const offset = useRoundStore((s) => s.offsetMs);
  const left = secondsLeft(view, offset);
  if (left == null) return null;

  const cls =
    size === 'xl'
      ? 'font-display text-7xl tabular-nums'
      : size === 'sm'
        ? 'text-sm font-semibold tabular-nums'
        : 'text-2xl font-semibold tabular-nums';

  return (
    <span
      className={`${cls} ${left <= warnAt ? 'text-ember' : 'text-chalk'} ${className}`}
      aria-live="off"
    >
      {format(left)}
    </span>
  );
}

/** A thin bar that drains over the phase — easier to read at a glance. */
export function PhaseProgress({ total }: { total: number }) {
  useTicker();
  const view = useRoundStore((s) => s.view);
  const offset = useRoundStore((s) => s.offsetMs);
  const left = secondsLeft(view, offset);
  if (left == null || total <= 0) return null;

  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-edge/60">
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
          pct < 20 ? 'bg-ember' : 'bg-mute'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
