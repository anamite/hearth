import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { HoldToReveal } from '@/components/HoldToReveal';
import { Countdown } from '@/components/Countdown';
import { PlayerGrid, PlayerRow } from '@/components/PlayerGrid';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { avatarColor } from '@/lib/constants';
import { vibrate } from '@/lib/hooks';
import { DrawingCanvas, DrawingView, type StrokeData } from './Canvas';
import { useRoundStore, secondsLeft } from '@/store/round';

function strokesOf(view: PhaseProps['view']): StrokeData[] {
  return ((view.public as any).strokes ?? []) as StrokeData[];
}

// ---------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------

export function RevealScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as any;
  const isImpostor = view.me.role === 'impostor';
  const [revealedOnce, setRevealedOnce] = useState(false);

  const readyCount = view.players.filter((p) => p.has_acted).length;

  // The server publishes only the count, never who asked — so the button's
  // own state is tracked here, and cleared whenever a reroll actually lands.
  const [iRequested, setIRequested] = useState(false);
  useEffect(() => setIRequested(false), [pub.reroll_count]);

  return (
    <div className="flex flex-1 flex-col">
      <p className="label">Everyone look at your own phone</p>

      <HoldToReveal
        tone={isImpostor ? 'danger' : 'default'}
        hint={isImpostor ? 'Hold to see your role' : 'Hold to see the word'}
        onFirstReveal={() => {
          setRevealedOnce(true);
          vibrate();
        }}
      >
        {isImpostor ? (
          <>
            <Sticker tone="blood" tilt={-3} className="mb-4">
              Shhh
            </Sticker>
            <p className="font-display text-[2.5rem] font-extrabold leading-[0.95] text-blood">
              You are the Impostor
            </p>
            <p className="subtitle mt-3">
              You don’t know the word. Draw like you do.
            </p>
          </>
        ) : (
          <>
            <p className="label text-accent">The word is</p>
            <p className="font-display text-[2.7rem] font-extrabold leading-[0.95] text-chalk text-accent-glow">
              {priv.word}
            </p>
            {priv.description && <p className="subtitle mt-3">{priv.description}</p>}
            {priv.image_url && (
              <img
                src={priv.image_url}
                alt=""
                className="mx-auto mt-4 max-h-32 rounded-xl object-contain"
              />
            )}
          </>
        )}
      </HoldToReveal>

      <p className="mt-4 text-center text-sm font-bold text-mute">
        <span className="text-chalk">{readyCount}</span> of {view.players.length} ready
      </p>

      <Spacer />

      {pub.reroll_allowed && (
        <button
          className="btn-quiet mb-2"
          disabled={busy}
          onClick={() => {
            setIRequested((v) => !v);
            void submit('reroll_request');
          }}
        >
          {iRequested ? 'Withdraw reroll' : 'Ask for a different word'}
          {pub.reroll_requests > 0 && (
            <span className="pill ml-1">
              {pub.reroll_requests}/{pub.reroll_needed}
            </span>
          )}
        </button>
      )}

      <button
        className="btn-primary"
        disabled={busy || !revealedOnce}
        onClick={() => submit('revealed')}
      >
        {revealedOnce ? 'Got it' : 'Hold the card first'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------

export function DrawingScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const myTurn = pub.current_player_id === view.me.player_id;
  const current = view.players.find((p) => p.player_id === pub.current_player_id);
  const myColor = avatarColor(
    view.players.find((p) => p.player_id === view.me.player_id)?.avatar_key ?? 'fox',
  );

  useEffect(() => {
    if (myTurn) vibrate([12, 40, 12]);
  }, [myTurn]);

  const doneIds = new Set(
    view.players.filter((p) => p.has_acted).map((p) => p.player_id),
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="label mb-0.5 text-accent">
            Pass {pub.pass + 1} of {pub.passes_total}
          </p>
          <p className="font-display text-xl font-extrabold text-chalk">
            {myTurn ? 'Your turn' : `${current?.nickname ?? '…'} is drawing`}
          </p>
        </div>
        <Countdown />
      </div>

      {pub.canvas_mode ? (
        <>
          <DrawingCanvas
            roundId={view.round_id}
            turnKey={`${pub.pass}:${pub.turn}`}
            strokes={strokesOf(view)}
            myTurn={myTurn && !busy}
            myColor={myColor}
            onCommit={(points) => submit('stroke', { points, width: 0.008 })}
          />
          <p className="mt-3 text-center text-sm text-mute">
            {myTurn
              ? 'One line. Lifting your finger ends your turn.'
              : 'Watch the line appear.'}
          </p>
        </>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-5 overflow-hidden rounded-[1.6rem] border-2 border-edge bg-ash/50 p-8 text-center">
          <div className="dots pointer-events-none absolute inset-0 opacity-50" />
          <AvatarBadge
            avatarKey={current?.avatar_key ?? 'fox'}
            size={76}
            ring="rgb(var(--accent-rgb))"
          />
          <div className="relative">
            <p className="font-display text-3xl font-extrabold text-chalk">
              {myTurn ? 'Draw your line' : current?.nickname}
            </p>
            <p className="subtitle mt-2">
              {myTurn
                ? 'One continuous line on the paper. Then tap Done.'
                : 'They are drawing on the paper.'}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4">
        <PlayerRow
          players={view.players}
          activeId={pub.current_player_id}
          doneIds={doneIds}
        />
      </div>

      <Spacer />

      {!pub.canvas_mode && (
        <button
          className="btn-primary"
          disabled={!myTurn || busy}
          onClick={() => submit('pass_turn')}
        >
          {myTurn ? 'Done — next player' : 'Waiting…'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Voting
// ---------------------------------------------------------------

export function VotingScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const [picked, setPicked] = useState<string | null>(null);
  const offset = useRoundStore((s) => s.offsetMs);

  const unlockMs = pub.vote_unlock_at
    ? Date.parse(pub.vote_unlock_at) - (Date.now() + offset)
    : 0;
  const locked = unlockMs > 0;
  const iVoted = view.me.player_id
    ? view.players.find((p) => p.player_id === view.me.player_id)?.has_acted
    : false;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-display text-xl font-extrabold leading-tight text-chalk">
            Who is the Impostor?
          </p>
          <p className="mt-0.5 text-sm font-semibold text-mute">
            <span className="text-accent">{pub.votes_cast}</span> of {pub.votes_needed} locked in
          </p>
        </div>
        <Countdown />
      </div>

      {pub.canvas_mode && <DrawingView strokes={strokesOf(view)} className="mb-4 max-h-64" />}

      <PlayerGrid
        players={view.players}
        selectedId={picked}
        onSelect={iVoted || locked ? undefined : setPicked}
        disabledIds={new Set([view.me.player_id])}
        showActed
      />

      <Spacer />

      {locked ? (
        <div className="rounded-[1.4rem] border-2 border-edge bg-slatey/60 p-4 text-center">
          <p className="text-sm font-semibold text-mute">Talk it through first.</p>
          <p className="numeral mt-1 text-2xl text-chalk">
            Voting opens in {Math.ceil(unlockMs / 1000)}s
          </p>
        </div>
      ) : iVoted ? (
        <p className="rounded-[1.4rem] border-2 border-moss/45 bg-moss/10 p-4 text-center text-sm font-bold text-moss">
          Locked in. Waiting for {pub.votes_needed - pub.votes_cast} more.
        </p>
      ) : (
        <button
          className="btn-primary"
          disabled={!picked || busy}
          onClick={() => picked && submit('vote', { target_id: picked })}
        >
          Lock in my vote
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Guess
// ---------------------------------------------------------------

export function GuessScreen({ view, submit, busy, error }: PhaseProps) {
  const isImpostor = view.me.role === 'impostor';
  const [text, setText] = useState('');
  const accused = view.players.find(
    (p) => p.player_id === (view.public as any).accused_id,
  );

  if (!isImpostor) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <AvatarBadge avatarKey={accused?.avatar_key ?? 'fox'} size={84} ring="#FF4D5E" />
        <div>
          <p className="font-display text-3xl font-extrabold text-chalk">
            You caught {accused?.nickname}
          </p>
          <p className="subtitle mt-2">
            They get one guess at the word. If they get it, they win anyway.
          </p>
        </div>
        <Countdown size="xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <span className="self-start">
        <Sticker tone="blood" tilt={-2}>You’ve been caught</Sticker>
      </span>
      <h2 className="title mt-3">One guess. What was the word?</h2>
      <p className="subtitle mt-2">Get it right and you win the round anyway.</p>

      <div className="mt-6 flex items-center justify-center">
        <Countdown size="xl" />
      </div>

      <input
        autoFocus
        className="field mt-6 text-center text-lg"
        placeholder="Type the word"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) submit('word_guess', { text });
        }}
      />
      <ErrorNote>{error}</ErrorNote>

      <Spacer />
      <button
        className="btn-primary"
        disabled={busy || !text.trim()}
        onClick={() => submit('word_guess', { text })}
      >
        Lock in my guess
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Result
// ---------------------------------------------------------------

export function ResultScreen({ view }: PhaseProps) {
  const navigate = useNavigate();
  const { code } = useParams();
  const pub = view.public as any;
  const result = (view.result ?? {}) as any;

  const impostor = view.players.find((p) => p.player_id === pub.impostor_id);
  const artistsWon = result.winner === 'artists';

  const votesByTarget = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of (pub.votes ?? []) as { voter_id: string; target_id: string }[]) {
      m.set(v.target_id, [...(m.get(v.target_id) ?? []), v.voter_id]);
    }
    return m;
  }, [pub.votes]);

  const reasonLine: Record<string, string> = {
    impostor_caught: 'Caught, and they had no idea what it was.',
    impostor_escaped: 'Nobody could agree. The Impostor walked away clean.',
    wrong_accusation: 'You picked the wrong person.',
    impostor_guessed_word: 'Caught — but they named the word anyway.',
  };

  if (result.aborted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <GameCharacter game="fake_artist" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">
          {result.aborted === 'impostor_left'
            ? 'The Impostor left the game.'
            : 'Too few players left to continue.'}
        </p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <HeroPanel
        className="animate-pop-in"
        tone={artistsWon ? 'moss' : 'blood'}
        kicker={artistsWon ? 'Artists win' : 'Impostor wins'}
      >
        <p className="font-display text-[2.6rem] font-extrabold leading-none text-chalk">
          {pub.word}
        </p>
        <p className="subtitle mt-2.5">{reasonLine[result.reason] ?? ''}</p>
      </HeroPanel>

      {pub.canvas_mode && <DrawingView strokes={strokesOf(view)} className="mt-4 max-h-56" />}

      <div className="card mt-4">
        <div className="flex items-center gap-3">
          <AvatarBadge avatarKey={impostor?.avatar_key ?? 'fox'} size={50} ring="#FF4D5E" />
          <div>
            <p className="label mb-0.5">The Impostor</p>
            <p className="font-display text-xl font-extrabold text-chalk">{impostor?.nickname}</p>
          </div>
          <span className="flex-1" />
          <GameCharacter game="fake_artist" size={38} className="animate-float" />
        </div>
        {pub.guess != null && pub.guess !== '' && (
          <p className="mt-3 text-sm text-mute">
            Their guess: <span className="text-chalk">“{pub.guess}”</span>
          </p>
        )}
      </div>

      <div className="card mt-3">
        <p className="label">Votes</p>
        <div className="space-y-2">
          {view.players.map((p) => {
            const voters = votesByTarget.get(p.player_id) ?? [];
            if (voters.length === 0) return null;
            return (
              <div key={p.player_id} className="flex items-center gap-2.5">
                <AvatarBadge avatarKey={p.avatar_key} size={30} />
                <span className="text-sm font-medium text-chalk">{p.nickname}</span>
                <span className="flex-1" />
                <span className="flex -space-x-1.5">
                  {voters.map((vid) => {
                    const voter = view.players.find((x) => x.player_id === vid);
                    return (
                      <AvatarBadge key={vid} avatarKey={voter?.avatar_key ?? 'fox'} size={24} />
                    );
                  })}
                </span>
              </div>
            );
          })}
          {(pub.votes ?? []).length === 0 && (
            <p className="text-sm text-mute">Nobody voted.</p>
          )}
        </div>
      </div>

      {result.bank_reset && (
        <p className="mt-3 text-center text-xs text-mute">
          You’ve played every word — starting the list over.
        </p>
      )}

      <Spacer />
      <button className="btn-primary mt-5" onClick={() => navigate(`/g/${code}`)}>
        Back to the lobby
      </button>
    </div>
  );
}

/** Shown if a phase somehow has no component — never a blank screen. */
export function FallbackScreen({ view }: PhaseProps) {
  const left = secondsLeft(view, 0);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-2xl font-extrabold text-chalk">{view.phase}</p>
      {left != null && <Countdown />}
    </div>
  );
}
