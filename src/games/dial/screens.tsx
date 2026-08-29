import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, Spacer } from '@/components/ui';
import { Spectrum } from './Spectrum';

function header(view: PhaseProps['view']) {
  const pub = view.public as any;
  return (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <p className="label mb-0.5">
          Round {pub.round_index + 1} of {pub.total_rounds}
        </p>
        <p className="text-sm text-mute">
          {pub.total_score} {pub.total_score === 1 ? 'point' : 'points'} so far
        </p>
      </div>
      <Countdown />
    </div>
  );
}

// ---------------------------------------------------------------
// Clue
// ---------------------------------------------------------------

export function ClueScreen({ view, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as any;
  const amClueGiver = pub.clue_giver_id === view.me.player_id;
  const giver = view.players.find((p) => p.player_id === pub.clue_giver_id);
  const [clue, setClue] = useState('');

  return (
    <div className="flex flex-1 flex-col">
      {header(view)}

      <div className="card">
        <Spectrum
          left={pub.spectrum?.left ?? ''}
          right={pub.spectrum?.right ?? ''}
          target={amClueGiver ? priv.target : null}
          showTarget={amClueGiver}
          guess={null}
        />
      </div>

      {amClueGiver ? (
        <>
          <p className="subtitle mt-5">
            Say <span className="text-chalk">one word or a short phrase</span> out loud that
            sits exactly there. Then type it in so everyone can see it.
          </p>
          <input
            autoFocus
            className="field mt-4 text-center text-lg"
            placeholder="e.g. a radiator"
            maxLength={80}
            value={clue}
            onChange={(e) => setClue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && clue.trim()) submit('clue_given', { clue });
            }}
          />
          <ErrorNote>{error}</ErrorNote>
          <Spacer />
          <button
            className="btn-primary"
            disabled={busy || !clue.trim()}
            onClick={() => submit('clue_given', { clue })}
          >
            Give this clue
          </button>
        </>
      ) : (
        <>
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <AvatarBadge avatarKey={giver?.avatar_key ?? 'fox'} size={72} ring="#E8743B" />
            <p className="font-display text-2xl text-chalk">
              {giver?.nickname} is thinking of a clue…
            </p>
            <p className="subtitle">Only they can see the target.</p>
          </div>
          <Spacer />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Guess
// ---------------------------------------------------------------

export function GuessScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const amHolder = pub.dial_holder_id === view.me.player_id;
  const holder = view.players.find((p) => p.player_id === pub.dial_holder_id);
  const [pos, setPos] = useState<number>(pub.guess ?? 50);

  return (
    <div className="flex flex-1 flex-col">
      {header(view)}

      <div className="rounded-3xl border border-ember/30 bg-ember/5 p-5 text-center">
        <p className="label mb-1">The clue</p>
        <p className="font-display text-3xl leading-tight text-chalk">
          {pub.clue ? `“${pub.clue}”` : '(no clue given)'}
        </p>
      </div>

      <div className="card mt-4">
        <Spectrum
          left={pub.spectrum?.left ?? ''}
          right={pub.spectrum?.right ?? ''}
          draggable={amHolder}
          roundId={view.round_id}
          guess={amHolder ? undefined : pub.guess}
          onChange={(p) => {
            setPos(p);
            void submit('dial_set', { position: p });
          }}
          showTarget={false}
        />
      </div>

      <p className="subtitle mt-4 text-center">
        {amHolder
          ? 'Talk it over, then drag the dial. Everyone can see it move.'
          : `Argue it out. ${holder?.nickname} moves the dial.`}
      </p>

      <Spacer />

      {amHolder ? (
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => submit('dial_set', { position: pos, locked: true })}
        >
          Lock it in
        </button>
      ) : (
        <div className="rounded-2xl border border-edge bg-ash/50 p-4 text-center text-sm text-mute">
          {holder?.nickname} locks in the final answer.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------

export function RevealScreen({ view }: PhaseProps) {
  const pub = view.public as any;
  const points = pub.points ?? 0;
  const giver = view.players.find((p) => p.player_id === pub.clue_giver_id);

  return (
    <div className="flex flex-1 flex-col">
      {header(view)}

      <div className="card">
        <Spectrum
          left={pub.spectrum?.left ?? ''}
          right={pub.spectrum?.right ?? ''}
          target={pub.target}
          guess={pub.guess}
          showTarget
        />
      </div>

      <div className="mt-6 text-center">
        <p className="label">{giver?.nickname} said “{pub.clue}”</p>
        <p
          className={`mt-2 font-display text-6xl ${
            points > 0 ? 'text-moss' : 'text-mute'
          }`}
        >
          {points > 0 ? `+${points}` : '0'}
        </p>
        <p className="subtitle mt-2">
          Target was {pub.target}. You said {pub.guess}.
        </p>
      </div>

      <Spacer />
      <p className="text-center text-sm text-mute">
        Running total: <span className="text-chalk">{pub.total_score}</span>
      </p>
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
        <p className="font-display text-3xl text-chalk">Round abandoned</p>
        <p className="subtitle">Too few players left to continue.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const rounds = (result.rounds ?? []) as any[];
  const pct = result.max_possible
    ? Math.round((result.total_score / result.max_possible) * 100)
    : 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="rounded-3xl border border-moss/40 bg-moss/10 p-6 text-center">
        <p className="label mb-1">Final score</p>
        <p className="font-display text-6xl text-chalk">
          {result.total_score}
          <span className="text-2xl text-mute"> / {result.max_possible}</span>
        </p>
        <p className="subtitle mt-2">{pct}% of a perfect run.</p>
      </div>

      <div className="card mt-4">
        <p className="label">Round by round</p>
        <div className="space-y-3">
          {rounds.map((r, i) => {
            const giver = view.players.find((p) => p.player_id === r.clue_giver_id);
            return (
              <div key={i} className="flex items-start gap-3">
                <AvatarBadge avatarKey={giver?.avatar_key ?? 'fox'} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-chalk">
                    “{r.clue || '—'}”
                  </p>
                  <p className="text-xs text-mute">
                    {r.spectrum?.left} → {r.spectrum?.right} · target {r.target}, said {r.guess}
                  </p>
                </div>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    r.points > 0 ? 'text-moss' : 'text-mute'
                  }`}
                >
                  {r.points}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Spacer />
      <button className="btn-primary mt-5" onClick={() => navigate(`/g/${code}`)}>
        Back to the lobby
      </button>
    </div>
  );
}
