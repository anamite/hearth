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
      className={`no-select relative isolate flex min-h-[19rem] w-full touch-none-safe cursor-pointer
                 select-none items-center justify-center overflow-hidden rounded-[1.8rem] border-[3px]
                 shadow-pop-lg transition-colors ${
                   held
                     ? tone === 'danger'
                       ? 'border-blood/70'
                       : 'border-accent/70'
                     : 'border-edge'
                 }`}
      style={{
        background:
          tone === 'danger'
            ? 'radial-gradient(120% 90% at 50% 0%, rgba(255,77,94,0.16), transparent 62%), linear-gradient(165deg,#1c1119,#100c14)'
            : 'radial-gradient(120% 90% at 50% 0%, rgb(var(--accent-rgb) / 0.16), transparent 62%), linear-gradient(165deg,#1d1a29,#111019)',
      }}
    >
      {/* A faint dot screen so the closed card doesn't read as a dead panel. */}
      <div className="dots pointer-events-none absolute inset-0 opacity-50" />

      {/* The secret. Only mounted while the finger is down. */}
      {held ? (
        <div className="relative animate-pop-in px-6 text-center">{children}</div>
      ) : (
        <div className="relative px-6 text-center">
          <span
            className="mx-auto mb-4 flex h-16 w-16 rotate-[-5deg] items-center justify-center
                       rounded-2xl border-2 border-black/40 bg-slatey shadow-pop"
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgb(var(--accent-rgb))"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <p className="font-display text-xl font-extrabold text-chalk">{hint}</p>
          <p className="subtitle mt-1.5">Keep it low. Keep it covered.</p>
        </div>
      )}

      {/* Fill bar showing hold progress. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-accent transition-none"
        style={{ width: `${progress * 100}%`, opacity: held ? 0 : 1 }}
      />
    </div>
  );
}
