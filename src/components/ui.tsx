import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Screen({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`screen ${className}`}>{children}</div>;
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title?: string;
  subtitle?: string;
  onBack?: (() => void) | 'history';
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const handleBack = onBack === 'history' ? () => navigate(-1) : onBack;

  return (
    <header className="mb-6 flex items-start gap-3">
      {handleBack && (
        <button
          onClick={handleBack}
          aria-label="Back"
          className="-ml-2 mt-0.5 rounded-xl p-2 text-mute transition active:scale-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        {title && <h1 className="title truncate">{title}</h1>}
        {subtitle && <p className="subtitle mt-1">{subtitle}</p>}
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
    <p role="alert" className="mt-3 rounded-xl border border-blood/40 bg-blood/10 px-3.5 py-2.5 text-sm text-blood">
      {children}
    </p>
  );
}

/** Spec §15.4 — never a blank screen; a persistent bar instead. */
export function ReconnectBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-ember/90 px-4 py-2 text-center text-sm font-semibold text-ink">
      Reconnecting…
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-mute">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full rounded-full bg-ember animate-pulse-ring" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-ember" />
      </span>
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-edge" />
      {label && <span className="text-xs uppercase tracking-[0.14em] text-mute">{label}</span>}
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

/** Big monospaced group code with a copy affordance. */
export function CodeDisplay({ code, onCopy }: { code: string; onCopy?: () => void }) {
  return (
    <button
      onClick={onCopy}
      className="w-full rounded-2xl border border-edge bg-ink/50 px-4 py-4 text-center transition active:scale-[0.99]"
    >
      <span className="label mb-1">Group code</span>
      <span className="block font-mono text-[2.1rem] font-bold tracking-[0.32em] text-chalk">
        {code}
      </span>
    </button>
  );
}
