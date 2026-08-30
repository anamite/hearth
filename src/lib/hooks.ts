import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

/**
 * Drives the `.scroll-fade` mask: fades whichever edge still has list
 * behind it, so a list scrolled to its end has a crisp edge instead of a
 * permanently dimmed one. Attach the returned ref to the scrolling box.
 */
export function useScrollFade<T extends HTMLElement>(
  deps: unknown[] = [],
  maxPx = 26,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // A few sub-pixels of slack is not a scroll — don't dim an edge for it.
      const room = el.scrollHeight - el.clientHeight;
      const scrollable = room > 4;
      const top = scrollable ? Math.max(0, Math.min(maxPx, el.scrollTop)) : 0;
      const bottom = scrollable
        ? Math.max(0, Math.min(maxPx, room - el.scrollTop))
        : 0;
      el.style.setProperty('--fade-top', `${top}px`);
      el.style.setProperty('--fade-bottom', `${bottom}px`);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPx, ...deps]);
  return ref;
}

/**
 * Slides children to their new places when the list is re-ordered (FLIP),
 * so a game jumping to the top reads as a move rather than a jump-cut.
 * Children must carry `data-flip-id`. Pass a key that changes with order.
 */
export function useReorderFlip(
  ref: React.RefObject<HTMLElement | null>,
  orderKey: string,
) {
  const seen = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.flipId;
      if (!id) continue;
      const top = child.offsetTop - el.offsetTop;
      next.set(id, top);
      const was = seen.current.get(id);
      if (!reduced && was != null && Math.abs(was - top) > 1) {
        child.animate?.(
          [{ transform: `translateY(${was - top}px)` }, { transform: 'none' }],
          { duration: 340, easing: 'cubic-bezier(.2,.9,.25,1)' },
        );
      }
    }
    seen.current = next;
  }, [ref, orderKey]);
}
