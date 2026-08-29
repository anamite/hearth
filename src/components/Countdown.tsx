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

  const warning = left <= warnAt;

  // The extra-large one gets a full badge; the smaller ones stay inline.
  if (size === 'xl') {
    return (
      <span
        className={`relative inline-flex items-center justify-center rounded-[1.4rem] border-2
                    px-7 py-3 shadow-pop ${
                      warning
                        ? 'animate-jiggle border-blood/60 bg-blood/15'
                        : 'border-accent/45 bg-accent/12'
                    } ${className}`}
        aria-live="off"
      >
        <span
          className={`numeral text-[3.6rem] leading-none ${
            warning ? 'text-blood' : 'text-chalk text-accent-glow'
          }`}
        >
          {format(left)}
        </span>
      </span>
    );
  }

  const cls =
    size === 'sm'
      ? 'text-sm font-extrabold tabular-nums'
      : 'numeral text-2xl';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-2.5 py-1 ${
        warning
          ? 'border-blood/50 bg-blood/12 text-blood'
          : 'border-edge/80 bg-slatey/60 text-chalk'
      } ${cls} ${className}`}
      aria-live="off"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          warning ? 'animate-blink-dot bg-blood' : 'bg-accent'
        }`}
      />
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
    <div className="h-2.5 w-full overflow-hidden rounded-full border-2 border-edge/70 bg-ink/60">
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
          pct < 20 ? 'bg-blood' : 'bg-accent'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
