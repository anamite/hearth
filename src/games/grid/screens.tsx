import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { PlayerRow } from '@/components/PlayerGrid';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';
import { Board, lineLabel } from './Board';
import { printBlankGrids } from './printSheet';

function myCells(view: PhaseProps['view']): (number | null)[] {
  return ((view.me.private as any).cells ?? []) as (number | null)[];
}

/** How many of each number are still unseen. Three of everything to start. */
function Tally({ tally }: { tally: number[] }) {
  return (
    <div className="grid grid-cols-10 gap-1">
      {tally.map((seen, i) => {
        const left = 3 - seen;
        return (
          <div
            key={i}
            className={`rounded-lg border-2 px-0.5 py-1 text-center ${
              left === 0 ? 'border-edge/60 bg-ink/50 opacity-40' : 'border-edge bg-slatey/70'
            }`}
          >
            <p className="font-display text-[0.8rem] font-extrabold leading-none text-chalk">
              {i + 1}
            </p>
            <p className="numeral mt-0.5 text-[0.62rem] leading-none text-mute">{left}</p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------
// Reveal — one card, eight seconds, everybody at once
// ---------------------------------------------------------------

export function RevealScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const cells = myCells(view);
  const placed = me.has_acted;

  // A nudge to look up, once per card — not on every render.
  useEffect(() => {
    vibrate(14);
  }, [pub.card_number]);

  const doneIds = new Set(view.players.filter((p) => p.has_acted).map((p) => p.player_id));

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Card {pub.card_number} of {pub.cards_total}
          </p>
          <p className="text-sm font-bold text-mute">
            {placed ? 'Placed — waiting for the rest' : 'Write it in, anywhere'}
          </p>
        </div>
        <Countdown warnAt={3} />
      </div>

      <div
        key={pub.card_number}
        className="relative mb-3 flex animate-pop-in items-center justify-center overflow-hidden
                   rounded-[1.6rem] border-2 border-accent/50 bg-accent/10 py-4 shadow-pop"
      >
        <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
        <span className="numeral relative text-[3.6rem] leading-none text-chalk">
          {pub.current_card}
        </span>
      </div>

      {pub.show_tally && (
        <div className="mb-3">
          <p className="label mb-1.5">Still in the deck</p>
          <Tally tally={pub.tally} />
        </div>
      )}

      <Board
        cells={cells}
        disabled={placed || busy}
        onPick={(cell) => {
          vibrate(12);
          void submit('place', { cell });
        }}
      />

      <ErrorNote>{error}</ErrorNote>

      <Spacer />

      <div className="mt-4">
        <PlayerRow players={view.players} doneIds={doneIds} />
        <p className="mt-2 text-center text-xs font-bold uppercase tracking-[0.14em] text-mute">
          {doneIds.size} of {view.players.filter((p) => !p.has_left).length} placed
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Scoring — the ten lines, one at a time
// ---------------------------------------------------------------

export function ScoringScreen({ view }: PhaseProps) {
  const pub = view.public as any;
  const line: number = pub.line_index ?? 0;
  const scores = (pub.scores ?? {}) as Record<string, { lines: number[]; total: number }>;
  const cells = (pub.grids?.[view.me.player_id] ?? myCells(view)) as (number | null)[];

  const running = (pid: string) =>
    (scores[pid]?.lines ?? []).slice(0, line + 1).reduce((a, b) => a + b, 0);

  const mine = scores[view.me.player_id]?.lines?.[line] ?? 0;
  const board = [...view.players]
    .filter((p) => !p.has_left)
    .sort((a, b) => running(b.player_id) - running(a.player_id));

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Scoring {line + 1} of {pub.line_count}
          </p>
          <p className="font-display text-xl font-extrabold text-chalk">{lineLabel(line)}</p>
        </div>
        <Countdown />
      </div>

      <Board cells={cells} highlightLine={line} disabled />

      <div className="mt-4 text-center">
        <p
          key={line}
          className={`numeral animate-pop-in text-[3rem] leading-none ${
            mine > 0 ? 'text-moss' : 'text-mute'
          }`}
        >
          {mine > 0 ? `+${mine}` : '0'}
        </p>
        <p className="subtitle mt-1">
          {mine > 0 ? 'for your longest run here' : 'no run of two or more here'}
        </p>
      </div>

      <Spacer />

      <div className="card mt-4">
        <p className="label">Running totals</p>
        <div className="space-y-2">
          {board.map((p) => (
            <div key={p.player_id} className="flex items-center gap-3">
              <AvatarBadge avatarKey={p.avatar_key} size={30} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-chalk">
                {p.nickname}
              </span>
              <span className="numeral text-lg text-accent">{running(p.player_id)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Result
// ---------------------------------------------------------------

export function ResultScreen({ view }: PhaseProps) {
  const navigate = useNavigate();
  const { code } = useParams();
  const result = (view.result ?? {}) as any;

  if (result.aborted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <GameCharacter game="grid" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Everybody left before the deck ran out.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as { player_id: string; total: number }[];
  const winners = new Set((result.winners ?? []) as string[]);
  const nameOf = (id: string) => view.players.find((p) => p.player_id === id)?.nickname ?? '—';
  const mine = standings.find((s) => s.player_id === view.me.player_id);
  const grid = (result.grids?.[view.me.player_id] ?? []) as (number | null)[];

  return (
    <div className="flex flex-1 flex-col">
      <HeroPanel
        className="animate-pop-in"
        tone={winners.has(view.me.player_id) ? 'moss' : 'accent'}
        kicker={winners.size > 1 ? 'Tied at the top' : 'Best grid'}
      >
        <p className="font-display text-[2rem] font-extrabold leading-tight text-chalk">
          {[...winners].map(nameOf).join(' & ')}
        </p>
        <p className="numeral mt-1 text-[2.6rem] leading-none text-chalk">
          {result.best_score}
          <span className="text-xl text-mute"> / {result.max_score}</span>
        </p>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">Final grids</p>
        <div className="space-y-2">
          {standings.map((s, i) => (
            <div key={s.player_id} className="flex items-center gap-3">
              <span className="numeral w-5 text-sm text-mute">{i + 1}</span>
              <AvatarBadge
                avatarKey={
                  view.players.find((p) => p.player_id === s.player_id)?.avatar_key ?? 'fox'
                }
                size={30}
                ring={winners.has(s.player_id) ? 'rgb(var(--accent-rgb))' : undefined}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-chalk">
                {nameOf(s.player_id)}
              </span>
              <span className="numeral text-lg text-accent">{s.total}</span>
            </div>
          ))}
        </div>
      </div>

      {mine && (
        <div className="card mt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="label mb-0">Your grid</p>
            <Sticker tone="dark" tilt={-2}>
              {mine.total} points
            </Sticker>
          </div>
          <Board cells={grid} size="sm" disabled />
        </div>
      )}

      <Spacer />

      <button className="btn-primary mt-5" onClick={() => navigate(`/g/${code}`)}>
        Back to the lobby
      </button>
      <button className="btn-quiet mt-2" onClick={() => printBlankGrids(6)}>
        Print blank grids for the table
      </button>
    </div>
  );
}
