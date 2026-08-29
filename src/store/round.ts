import { create } from 'zustand';
import type { RoundView } from '@/types';
import { HearthError } from '@/types';
import { getBackend, IS_MOCK } from '@/backend';

type Status = 'idle' | 'loading' | 'ok' | 'reconnecting' | 'gone';

interface RoundState {
  roundId: string | null;
  view: RoundView | null;
  status: Status;
  /** serverTime − deviceTime, so countdowns ignore a wrong device clock (§8.2). */
  offsetMs: number;
  failures: number;
  lastError: string | null;

  attach(roundId: string): void;
  detach(): void;
  refresh(): Promise<void>;
  submit(kind: string, payload?: Record<string, unknown>): Promise<void>;
  /** Milliseconds remaining on the current phase, or null when untimed. */
  msLeft(): number | null;
}

function applyView(set: (p: Partial<RoundState>) => void, view: RoundView) {
  // Local mode only: exposes exactly what this device received, so the
  // "the impostor's phone never sees the word" check (M1 criterion 3) can be
  // run by hand from the console. It holds nothing the network didn't deliver.
  if (IS_MOCK) (window as any).__hearthView = view;

  set({
    view,
    status: 'ok',
    failures: 0,
    lastError: null,
    offsetMs: Date.parse(view.server_time) - Date.now(),
  });
}

export const useRoundStore = create<RoundState>((set, get) => ({
  roundId: null,
  view: null,
  status: 'idle',
  offsetMs: 0,
  failures: 0,
  lastError: null,

  attach(roundId) {
    if (get().roundId === roundId) return;
    set({ roundId, view: null, status: 'loading', failures: 0, lastError: null });
  },

  detach() {
    set({ roundId: null, view: null, status: 'idle', failures: 0, lastError: null });
  },

  /**
   * One tick of the loop. `advance_if_due` doubles as the read: the server
   * decides whether the phase has expired, never the client (§8.2).
   */
  async refresh() {
    const { roundId } = get();
    if (!roundId) return;
    try {
      const view = await getBackend().advanceIfDue(roundId);
      applyView(set, view);
    } catch (err) {
      const failures = get().failures + 1;
      if (err instanceof HearthError && err.code === 'round_not_found') {
        set({ status: 'gone', failures });
        return;
      }
      // Spec §15.4 — two consecutive failures raise the reconnect banner.
      set({ failures, status: failures >= 2 ? 'reconnecting' : get().status });
    }
  },

  async submit(kind, payload = {}) {
    const { roundId } = get();
    if (!roundId) return;
    const view = await getBackend().submitAction(roundId, kind, payload);
    applyView(set, view);
  },

  msLeft() {
    const { view, offsetMs } = get();
    if (!view?.phase_ends_at) return null;
    return Date.parse(view.phase_ends_at) - (Date.now() + offsetMs);
  },
}));

/** Seconds remaining, floored at zero — what a countdown should render. */
export function secondsLeft(view: RoundView | null, offsetMs: number): number | null {
  if (!view?.phase_ends_at) return null;
  const ms = Date.parse(view.phase_ends_at) - (Date.now() + offsetMs);
  return Math.max(0, Math.ceil(ms / 1000));
}
