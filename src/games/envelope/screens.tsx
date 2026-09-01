import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { HoldToReveal } from '@/components/HoldToReveal';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';

interface Assignment {
  text: string;
  points: number;
}

/** Your own envelope, never anyone else's, always behind a hold. */
function MyEnvelope({ priv, hint }: { priv: Assignment; hint?: string }) {
  return (
    <HoldToReveal hint={hint ?? 'Hold to read your envelope'}>
      <div className="no-select px-6 text-center">
        <p className="label mb-2 text-accent">Yours alone</p>
        <p className="font-display text-[1.5rem] font-extrabold leading-tight text-chalk">
          {priv.text}
        </p>
        <p className="mt-4">
          <Sticker tone="accent2" tilt={2}>
            worth {priv.points}
          </Sticker>
        </p>
      </div>
    </HoldToReveal>
  );
}

// ---------------------------------------------------------------
// Brief — read it, then put the phone face down
// ---------------------------------------------------------------

export function BriefScreen({ view, me, submit, busy, error }: PhaseProps) {
  const priv = view.me.private as unknown as Assignment;
  const ready = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">Your envelope</p>
          <p className="text-sm font-bold text-mute">
            {ready} of {total} have read theirs
          </p>
        </div>
        <Countdown />
      </div>

      <p className="subtitle mb-3 text-center">
        Deal the whole deck out evenly. Then read this, and tell nobody.
      </p>

      {priv?.text ? (
        <MyEnvelope priv={priv} />
      ) : (
        <div className="card text-center">
          <p className="subtitle">No envelope for you this round.</p>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <button
        className="btn-primary mt-5"
        disabled={busy || me.has_acted}
        onClick={() => {
          vibrate(14);
          void submit('ready');
        }}
      >
        {me.has_acted ? 'Waiting for the others…' : 'Read it — start trading'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Trade — the screen has nothing to say for four minutes
// ---------------------------------------------------------------

export function TradeScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as unknown as Assignment;
  const done = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;
  const opened = (pub.revealed ?? []) as string[];
  const assignments = (pub.assignments ?? {}) as Record<string, Assignment>;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Session {pub.session_number} of {pub.sessions_total}
          </p>
          <p className="font-display text-xl font-extrabold text-chalk">Trade</p>
        </div>
        <Countdown size="xl" warnAt={30} />
      </div>

      <p className="subtitle text-center">
        Talk, offer, refuse, lie. No turns. The app will buzz when it’s over.
      </p>

      {opened.length > 0 && (
        <div className="card mt-4">
          <p className="label">Opened in public</p>
          <div className="space-y-2">
            {opened.map((id) => (
              <div key={id} className="flex items-start gap-2.5">
                <AvatarBadge
                  avatarKey={
                    view.players.find((p) => p.player_id === id)?.avatar_key ?? 'fox'
                  }
                  size={26}
                />
                <p className="min-w-0 flex-1 text-xs font-semibold leading-snug text-chalk">
                  {assignments[id]?.text ?? '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {priv?.text && (
        <div className="mt-4">
          <MyEnvelope priv={priv} hint="Hold to check yours again" />
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <p className="mb-2 text-center text-sm font-bold text-mute">
        {done} of {total} say they’re finished
      </p>
      <button
        className="btn-ghost"
        disabled={busy || me.has_acted}
        onClick={() => void submit('done')}
      >
        {me.has_acted ? 'Waiting for the others…' : 'I’m done trading'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Event — the one thing the app does between sessions
// ---------------------------------------------------------------

export function EventScreen({ view }: PhaseProps) {
  const pub = view.public as any;
  const event = pub.event ?? { title: 'Something happens', text: '' };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="label text-accent">Session {pub.session_number} is over</p>
        <Countdown />
      </div>

      <Spacer />

      <HeroPanel className="animate-pop-in" kicker="Public event">
        <p className="font-display text-[1.7rem] font-extrabold leading-tight text-accent">
          {event.title}
        </p>
        <p className="mt-3 text-[1.05rem] font-semibold leading-snug text-chalk">{event.text}</p>
      </HeroPanel>

      <p className="subtitle mt-5 text-center">
        Do it now. The clock starts again in a moment.
      </p>

      <Spacer />
    </div>
  );
}

// ---------------------------------------------------------------
// Reveal — envelopes open, table decides who is lying
// ---------------------------------------------------------------

export function RevealScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const assignments = (pub.assignments ?? {}) as Record<string, Assignment>;
  const claims = (pub.claims ?? {}) as Record<string, boolean | null>;
  const mine = claims[me.player_id];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">Envelopes open</p>
          <p className="font-display text-xl font-extrabold text-chalk">
            Did you manage it?
          </p>
        </div>
        <Countdown />
      </div>

      <p className="subtitle mb-3 text-center">
        Everyone’s goal is on the table now. Lay your cards out and let them check.
      </p>

      <div className="card">
        <div className="space-y-3">
          {view.players.map((p) => {
            const a = assignments[p.player_id];
            const claim = claims[p.player_id];
            return (
              <div key={p.player_id} className="flex items-start gap-2.5">
                <AvatarBadge avatarKey={p.avatar_key} size={30} dimmed={p.has_left} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-wide text-mute">
                    {p.nickname}
                  </p>
                  <p className="text-sm font-semibold leading-snug text-chalk">
                    {a?.text ?? '—'}
                  </p>
                </div>
                <div className="shrink-0 pt-1">
                  {claim === true ? (
                    <Sticker tone="moss" tilt={2}>+{a?.points ?? 0}</Sticker>
                  ) : claim === false ? (
                    <Sticker tone="dark" tilt={-2}>missed</Sticker>
                  ) : (
                    <span className="text-xs font-bold text-mute">…</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          className={mine === true ? 'btn-primary' : 'btn-ghost'}
          disabled={busy}
          onClick={() => {
            vibrate(16);
            void submit('claim', { made: true });
          }}
        >
          I made it
        </button>
        <button
          className={mine === false ? 'btn-primary' : 'btn-ghost'}
          disabled={busy}
          onClick={() => void submit('claim', { made: false })}
        >
          I missed
        </button>
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
        <GameCharacter game="envelope" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Too few players left to trade with.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as {
    player_id: string;
    score: number;
    made: boolean;
    assignment: string;
    points: number;
  }[];
  const winners = new Set((result.winners ?? []) as string[]);
  const nameOf = (id: string) => view.players.find((p) => p.player_id === id)?.nickname ?? '—';

  return (
    <div className="flex flex-1 flex-col">
      <HeroPanel
        className="animate-pop-in"
        tone={winners.has(view.me.player_id) ? 'moss' : 'accent'}
        kicker={winners.size > 1 ? 'Dead heat' : winners.size ? 'Winner' : 'Nobody delivered'}
      >
        <p className="font-display text-[2rem] font-extrabold leading-tight text-chalk">
          {winners.size ? [...winners].map(nameOf).join(' & ') : 'Everybody missed'}
        </p>
        <p className="numeral mt-1 text-[2.8rem] leading-none text-accent">
          {result.best_score ?? 0}
        </p>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">What everyone was after</p>
        <div className="space-y-3">
          {standings.map((s) => (
            <div key={s.player_id} className="flex items-start gap-3">
              <AvatarBadge
                avatarKey={
                  view.players.find((p) => p.player_id === s.player_id)?.avatar_key ?? 'fox'
                }
                size={30}
                ring={winners.has(s.player_id) ? 'rgb(var(--accent-rgb))' : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-wide text-mute">
                  {nameOf(s.player_id)}
                </p>
                <p className="text-sm font-semibold leading-snug text-chalk">{s.assignment}</p>
              </div>
              <span
                className={`numeral shrink-0 text-lg ${s.made ? 'text-accent' : 'text-mute'}`}
              >
                {s.score}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Spacer />
      <button className="btn-primary mt-5" onClick={() => navigate(`/g/${code}`)}>
        Back to the lobby
      </button>
    </div>
  );
}
