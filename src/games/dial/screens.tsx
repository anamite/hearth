import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { Spectrum } from './Spectrum';

function header(view: PhaseProps['view']) {
  const pub = view.public as any;
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className="label mb-0.5 text-accent">
          Round {pub.round_index + 1} of {pub.total_rounds}
        </p>
        <p className="text-sm font-bold text-mute">
          <span className="text-chalk">{pub.total_score}</span>{' '}
          {pub.total_score === 1 ? 'point' : 'points'} so far
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
            <div className="relative">
              <AvatarBadge
                avatarKey={giver?.avatar_key ?? 'fox'}
                size={78}
                ring="rgb(var(--accent-rgb))"
              />
              <GameCharacter
                game="dial"
                size={30}
                className="absolute -right-4 -top-3 animate-float"
              />
            </div>
            <p className="font-display text-2xl font-extrabold text-chalk">
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

      <div className="relative overflow-hidden rounded-[1.6rem] border-2 border-accent/45 bg-accent/8 p-5 text-center shadow-pop">
        <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative">
          <p className="label mb-1 text-accent">The clue</p>
          <p className="font-display text-[1.9rem] font-extrabold leading-tight text-chalk">
            {pub.clue ? `“${pub.clue}”` : '(no clue given)'}
          </p>
        </div>
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
        <div className="rounded-[1.4rem] border-2 border-edge bg-slatey/60 p-4 text-center text-sm font-bold text-mute">
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
          className={`numeral mt-2 animate-pop-in text-[4.4rem] leading-none ${
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

      <p className="text-center text-sm font-bold text-mute">
        Running total: <span className="text-accent">{pub.total_score}</span>
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
        <GameCharacter game="dial" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
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
      <HeroPanel className="animate-pop-in" tone="moss" kicker="Final score">
        <p className="numeral text-[4rem] leading-none text-chalk">
          {result.total_score}
          <span className="text-2xl text-mute"> / {result.max_possible}</span>
        </p>
        <div className="mt-3 flex justify-center">
          <Sticker tone={pct >= 60 ? 'moss' : 'gold'} tilt={-2}>
            {pct}% of a perfect run
          </Sticker>
        </div>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">Round by round</p>
        <div className="space-y-3">
          {rounds.map((r, i) => {
            const giver = view.players.find((p) => p.player_id === r.clue_giver_id);
            return (
              <div key={i} className="flex items-start gap-3">
                <AvatarBadge avatarKey={giver?.avatar_key ?? 'fox'} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-chalk">
                    “{r.clue || '—'}”
                  </p>
                  <p className="text-xs text-mute">
                    {r.spectrum?.left} → {r.spectrum?.right} · target {r.target}, said {r.guess}
                  </p>
                </div>
                <span
                  className={`numeral text-lg ${r.points > 0 ? 'text-moss' : 'text-mute'}`}
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
