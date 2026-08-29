import { useState } from 'react';
import { resetDb, resetMockIdentity } from '@/backend/mock/db';

/**
 * Only rendered in local mock mode. Each browser TAB is a separate player,
 * so this shows which one you are and lets you become somebody new.
 */
export function DevBadge() {
  const [open, setOpen] = useState(false);
  const uid = sessionStorage.getItem('hearth.mock.uid') ?? '—';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-40 rounded-full border-2 border-edge bg-ash/95 px-2.5 py-1 font-mono text-[0.6rem] font-bold text-mute shadow-pop-sm backdrop-blur"
      >
        local · {uid.slice(0, 4)}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-40 w-60 rounded-2xl border-2 border-edge bg-ash/97 p-3 text-xs shadow-pop backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-extrabold uppercase tracking-wider text-chalk">Local mode</span>
        <button onClick={() => setOpen(false)} className="text-mute">
          ✕
        </button>
      </div>
      <p className="mb-2 leading-relaxed text-mute">
        This tab is one player (<span className="font-mono">{uid.slice(0, 8)}</span>).
        Open another tab to add a second.
      </p>
      <div className="space-y-1.5">
        <button
          className="w-full rounded-xl border-2 border-edge bg-slatey/60 py-1.5 font-bold text-mute"
          onClick={() => {
            resetMockIdentity();
            location.href = '/';
          }}
        >
          Become a new player
        </button>
        <button
          className="w-full rounded-xl border-2 border-blood/50 bg-blood/10 py-1.5 font-bold text-blood"
          onClick={() => {
            if (!confirm('Wipe all local groups and games?')) return;
            resetDb();
            location.href = '/';
          }}
        >
          Wipe local data
        </button>
      </div>
    </div>
  );
}
