import { useCallback, useEffect, useRef, useState } from 'react';

/** setInterval with a stable callback; pass null to pause. */
export function useInterval(cb: () => void, ms: number | null): void {
  const saved = useRef(cb);
  useEffect(() => {
    saved.current = cb;
  }, [cb]);
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Spec §9.2 — polling pauses when the tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * Spec §3.2 — hold the screen awake for the length of a round.
 * Degrades silently where the API is missing, and re-acquires the lock
 * after the tab comes back (browsers drop it on hide).
 */
export function useWakeLock(active: boolean): void {
  const visible = usePageVisible();
  useEffect(() => {
    if (!active || !visible) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let released = false;
    let sentinel: { release(): Promise<void> } | null = null;
    nav.wakeLock
      .request('screen')
      .then((s) => {
        if (released) void s.release();
        else sentinel = s;
      })
      .catch(() => {
        /* denied or unsupported — not worth telling the user */
      });

    return () => {
      released = true;
      void sentinel?.release().catch(() => {});
    };
  }, [active, visible]);
}

/** Spec §3.2 — a short haptic when it becomes your turn. Optional. */
export function vibrate(pattern: number | number[] = 18): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/**
 * Spec §15.4 — tap-and-hold to reveal, hiding again on release.
 * Returns the handlers to spread onto the card plus 0..1 progress.
 */
export function useHold(durationMs: number, onComplete?: () => void) {
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    cancelAnimationFrame(raf.current);
    timer.current = null;
    setHeld(false);
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (timer.current) return;
    const began = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - began) / durationMs);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    timer.current = setTimeout(() => {
      setHeld(true);
      if (!fired.current) {
        fired.current = true;
        onComplete?.();
      }
    }, durationMs);
  }, [durationMs, onComplete]);

  useEffect(() => () => stop(), [stop]);

  return {
    held,
    progress,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        start();
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

/** Re-renders roughly once a second, for countdowns. */
export function useTicker(active = true): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
  return Date.now();
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
