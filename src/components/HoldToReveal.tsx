import type { ReactNode } from 'react';
import { useHold } from '@/lib/hooks';
import { REVEAL_HOLD_MS } from '@/lib/constants';

/**
 * Spec §15.4 — every secret card sits behind a 400 ms hold and hides again
 * the moment the finger lifts. This is the only thing standing between a
 * player's role and the person sitting next to them.
 */
export function HoldToReveal({
  children,
  hint = 'Hold to reveal',
  onFirstReveal,
  tone = 'default',
}: {
  children: ReactNode;
  hint?: string;
  onFirstReveal?: () => void;
  tone?: 'default' | 'danger';
}) {
  const { held, progress, handlers } = useHold(REVEAL_HOLD_MS, onFirstReveal);

  return (
    <div
      {...handlers}
      className="no-select relative isolate flex min-h-[19rem] w-full touch-none-safe cursor-pointer
                 select-none items-center justify-center overflow-hidden rounded-3xl border border-edge"
      style={{
        background:
          tone === 'danger'
            ? 'linear-gradient(160deg,#1a1013,#120c10)'
            : 'linear-gradient(160deg,#1b1a22,#131218)',
      }}
    >
      {/* The secret. Only mounted while the finger is down. */}
      {held ? (
        <div className="animate-fade-up px-6 text-center">{children}</div>
      ) : (
        <div className="px-6 text-center">
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="mx-auto mb-3 text-mute"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
          <p className="text-base font-semibold text-chalk">{hint}</p>
          <p className="subtitle mt-1.5">Keep it low. Keep it covered.</p>
        </div>
      )}

      {/* Fill ring showing hold progress. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-ember transition-none"
        style={{ width: `${progress * 100}%`, opacity: held ? 0 : 1 }}
      />
    </div>
  );
}
