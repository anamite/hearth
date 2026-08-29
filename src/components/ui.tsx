import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { GameType } from '@/types';

export function Screen({
  children,
  className = '',
  game,
}: {
  children: ReactNode;
  className?: string;
  /** Re-skins everything inside to that game's accent (see index.css). */
  game?: GameType | null;
}) {
  return (
    <div className={`screen ${className}`} data-game={game ?? undefined}>
      {children}
    </div>
  );
}

/** Wraps a subtree in one game's colours without owning the layout. */
export function GameTheme({
  game,
  children,
  className = '',
}: {
  game: GameType | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-game={game ?? undefined} className={className}>
      {children}
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
  eyebrow,
}: {
  title?: string;
  subtitle?: string;
  onBack?: (() => void) | 'history';
  right?: ReactNode;
  /** Small kicker above the title, e.g. a phase name. */
  eyebrow?: string;
}) {
  const navigate = useNavigate();
  const handleBack = onBack === 'history' ? () => navigate(-1) : onBack;

  return (
    <header className="mb-6 flex items-start gap-3">
      {handleBack && (
        <button
          onClick={handleBack}
          aria-label="Back"
          className="-ml-1 mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl
                     border-2 border-edge bg-slatey/70 text-chalk shadow-pop-sm transition-all
                     duration-100 active:translate-y-[3px] active:shadow-none"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="label mb-1 text-accent">{eyebrow}</p>}
        {title && <h1 className="title break-words">{title}</h1>}
        {subtitle && <p className="subtitle mt-1.5">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Spacer() {
  return <div className="flex-1" />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="mt-3 animate-fade-up rounded-2xl border-2 border-blood/50 bg-blood/12 px-3.5 py-2.5
                 text-sm font-semibold text-blood"
    >
      {children}
    </p>
  );
}

/** Spec §15.4 — never a blank screen; a persistent bar instead. */
export function ReconnectBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-gold px-4 py-2 text-center text-sm font-extrabold uppercase tracking-widest text-ink">
      Reconnecting…
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-16">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inline-flex h-14 w-14 rounded-full bg-accent/50 animate-pulse-ring" />
        <span className="relative flex h-9 w-9 rotate-6 items-center justify-center rounded-2xl border-2 border-black/40 bg-accent shadow-pop-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" />
        </span>
      </div>
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-mute">{label}</p>
    </div>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-0.5 flex-1 rounded-full bg-edge/70" />
      {label && (
        <span className="text-[0.68rem] font-extrabold uppercase tracking-[0.2em] text-mute">
          {label}
        </span>
      )}
      <span className="h-0.5 flex-1 rounded-full bg-edge/70" />
    </div>
  );
}

/** A tilted sticker badge. `tone` picks the fill. */
export function Sticker({
  children,
  tone = 'accent',
  tilt = -2,
  className = '',
}: {
  children: ReactNode;
  tone?: 'accent' | 'accent2' | 'moss' | 'blood' | 'gold' | 'dark';
  tilt?: number;
  className?: string;
}) {
  const tones: Record<string, string> = {
    accent: 'bg-accent text-ink',
    accent2: 'bg-accent2 text-ink',
    moss: 'bg-moss text-ink',
    blood: 'bg-blood text-ink',
    gold: 'bg-gold text-ink',
    dark: 'bg-slatey text-chalk border-edge',
  };
  return (
    <span
      className={`sticker ${tones[tone]} ${className}`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {children}
    </span>
  );
}

/** A headline panel: big word, optional kicker, accent wash behind. */
export function HeroPanel({
  kicker,
  children,
  tone = 'accent',
  className = '',
}: {
  kicker?: string;
  children: ReactNode;
  tone?: 'accent' | 'moss' | 'blood';
  className?: string;
}) {
  const border =
    tone === 'moss' ? 'border-moss/50' : tone === 'blood' ? 'border-blood/50' : 'border-accent/50';
  const wash =
    tone === 'moss'
      ? 'from-moss/22'
      : tone === 'blood'
        ? 'from-blood/22'
        : 'from-accent/22';

  return (
    <div
      className={`relative overflow-hidden rounded-[1.6rem] border-2 ${border}
                  bg-gradient-to-br ${wash} to-transparent p-6 text-center ${className}`}
    >
      <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        {kicker && (
          <p className="label mb-1.5 text-chalk/70">{kicker}</p>
        )}
        {children}
      </div>
    </div>
  );
}

/** Big monospaced group code with a copy affordance. */
export function CodeDisplay({ code, onCopy }: { code: string; onCopy?: () => void }) {
  return (
    <button
      onClick={onCopy}
      className="group relative w-full overflow-hidden rounded-[1.6rem] border-2 border-accent/45
                 bg-ink/70 px-4 py-4 text-center shadow-pop transition-all duration-100
                 active:translate-y-[3px] active:shadow-pop-sm"
    >
      <div className="dots pointer-events-none absolute inset-0 opacity-60" />
      <span className="relative">
        <span className="label mb-1 text-accent">Group code</span>
        <span className="block font-mono text-[2.05rem] font-bold tracking-[0.3em] text-chalk">
          {code}
        </span>
      </span>
    </button>
  );
}
