import { useEffect, useRef } from 'react';
import type { AvatarKey } from '@/types';
import { AVATARS, NICKNAME_POOL } from '@/lib/constants';
import { Avatar } from './Avatar';
import { IS_MOCK } from '@/backend';

export function NicknamePicker({
  value,
  available,
  onChange,
}: {
  value: string | null;
  available: string[] | null;
  onChange: (name: string) => void;
}) {
  const free = new Set(available ?? NICKNAME_POOL);

  return (
    <div>
      <label className="label">Pick a name</label>
      <div className="grid grid-cols-3 gap-2">
        {NICKNAME_POOL.map((name) => {
          const taken = !free.has(name);
          return (
            <button
              key={name}
              type="button"
              disabled={taken}
              onClick={() => onChange(name)}
              className={`rounded-xl border-2 px-2 py-2.5 text-sm font-bold transition-all duration-100
                ${
                  value === name
                    ? 'border-accent bg-accent/18 text-chalk shadow-glow'
                    : 'border-edge/80 bg-slatey/55 text-mute'
                }
                ${
                  taken
                    ? 'cursor-not-allowed opacity-25 line-through'
                    : 'shadow-pop-sm active:translate-y-[3px] active:shadow-none'
                }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-mute">
        Fixed names — the narrator has a recording for each one.
      </p>
    </div>
  );
}

export function AvatarPicker({
  value,
  onChange,
  discouraged,
}: {
  value: AvatarKey | null;
  onChange: (key: AvatarKey) => void;
  /** Already used in this group; still allowed, just nudged against (§16.2). */
  discouraged?: Set<string>;
}) {
  return (
    <div>
      <label className="label">Pick a face</label>
      <div className="grid grid-cols-5 gap-2">
        {AVATARS.map((a) => {
          const used = discouraged?.has(a.key);
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onChange(a.key)}
              aria-label={a.label}
              className={`relative flex aspect-square items-center justify-center rounded-2xl border-2
                shadow-pop-sm transition-all duration-100 active:translate-y-[3px] active:shadow-none
                ${
                  value === a.key
                    ? 'border-accent bg-accent/15 shadow-glow'
                    : 'border-edge/80 bg-slatey/55'
                } ${used && value !== a.key ? 'opacity-45' : ''}`}
            >
              <Avatar avatarKey={a.key} size={34} className={value === a.key ? "animate-wobble" : ""} />
              {used && (
                <span className="absolute bottom-0.5 right-1 text-[0.6rem] text-mute">used</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Spec §18.1 — Turnstile appears on create and join only, never inside a game.
 * In mock mode there is no server to protect, so it resolves immediately.
 */
export function TurnstileGate({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const rendered = useRef(false);

  useEffect(() => {
    if (IS_MOCK || !siteKey) {
      onToken('mock-no-turnstile');
      return;
    }
    if (rendered.current) return;

    const render = () => {
      const ts = (window as any).turnstile;
      if (!ts || !ref.current || rendered.current) return;
      rendered.current = true;
      ts.render(ref.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: (token: string) => onToken(token),
        'error-callback': () => onToken(''),
        'expired-callback': () => onToken(''),
      });
    };

    if ((window as any).turnstile) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [siteKey, onToken]);

  if (IS_MOCK || !siteKey) return null;
  return <div ref={ref} className="flex justify-center py-1" />;
}
