import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RoundPlayerView } from '@/types';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';
import { CARD_MAX, CARD_MIN } from '@/backend/mock/games/fold';

const VALUES = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN);

/** What to write on the button for a card worth n. */
function cardLabel(n: number): string {
  if (n === 1) return 'A';
  if (n === 11) return 'A';
  return String(n);
}

function cardHint(n: number): string | null {
  if (n === 1) return 'low';
  if (n === 10) return 'J Q K';
  if (n === 11) return 'high';
  return null;
}

const STATUS_TEXT: Record<string, string> = {
  in: 'in',
  folded: 'folded',
  busted: 'bust',
  out: 'no cards',
};

/** The target, and whatever the app has decided to bend this round. */
function TargetPanel({ target, text, big }: { target: number; text: string; big?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border-2 border-accent/50 bg-accent/10 p-5 text-center shadow-pop">
      <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        <p className="label mb-1 text-accent">Do not go over</p>
        <p className={`numeral leading-none text-accent ${big ? 'text-[4rem]' : 'text-[2.6rem]'}`}>
          {target}
        </p>
        <p className="subtitle mt-2">{text}</p>
      </div>
    </div>
  );
}

/** Everyone's standing this round, at a glance. */
function TableStrip({
  players,
  status,
  hand,
  activeId,
}: {
  players: RoundPlayerView[];
  status: Record<string, string>;
  hand: Record<string, number>;
  activeId?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-3">
      {players.map((p) => {
        const st = status[p.player_id] ?? 'in';
        const active = p.player_id === activeId;
        return (
          <div
            key={p.player_id}
            className={`w-[4.2rem] text-center ${active ? 'animate-wobble' : ''}`}
          >
            <AvatarBadge
              avatarKey={p.avatar_key}
              size={active ? 44 : 34}
              dimmed={st !== 'in' || p.has_left}
              ring={active ? 'rgb(var(--accent-rgb))' : undefined}
            />
            <p className="mt-1 truncate text-[0.66rem] font-bold text-mute">{p.nickname}</p>
            <p
              className={`text-[0.6rem] font-black uppercase tracking-wide ${
                st === 'busted' ? 'text-blood' : st === 'in' ? 'text-accent' : 'text-mute'
              }`}
            >
              {st === 'in' ? `${hand[p.player_id] ?? 0} left` : STATUS_TEXT[st] ?? st}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------
// Deal — the app tells the table what this round is
// ---------------------------------------------------------------

export function DealScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const mine = pub.cards?.[me.player_id] ?? 0;
  const most = Math.max(0, ...Object.values<number>(pub.cards ?? {}));
  const ready = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Round {pub.round_number} of {pub.rounds_total}
          </p>
          <p className="text-sm font-bold text-mute">
            {ready} of {total} dealt
          </p>
        </div>
        <Countdown />
      </div>

      <TargetPanel target={pub.target} text={pub.modifier_text} big />

      <div className="card mt-4 text-center">
        <p className="label">Deal yourself</p>
        <p className="numeral text-[2.4rem] leading-none text-chalk">{mine}</p>
        <p className="subtitle mt-1">
          {mine < most ? 'cards — busting has cost you some' : 'cards, from the top of the deck'}
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <TableStrip players={view.players} status={pub.status ?? {}} hand={pub.cards ?? {}} />

      <button
        className="btn-primary mt-5"
        disabled={busy || me.has_acted}
        onClick={() => void submit('ready')}
      >
        {me.has_acted ? 'Waiting for the others…' : 'Dealt — ready'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Turn — play a card, or get out while you can
// ---------------------------------------------------------------

export function TurnScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const myTurn = pub.current_player_id === me.player_id;
  const blind: boolean = !!pub.blind;
  const hearts: boolean = pub.modifier === 'hearts_negative';
  const myHand: number = pub.hand?.[me.player_id] ?? 0;

  const [chosen, setChosen] = useState<number | null>(null);
  const [isHeart, setIsHeart] = useState(false);

  // Pitfall 4: the phase does not change between turns, so anything
  // scoped to "this turn" has to be reset on an explicit key.
  const turnKey = `${pub.round_number}:${(pub.log ?? []).length}:${pub.current_player_id ?? ''}`;
  useEffect(() => {
    setChosen(null);
    setIsHeart(false);
    if (myTurn) vibrate([20, 60, 20]);
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeName =
    view.players.find((p) => p.player_id === pub.current_player_id)?.nickname ?? 'Someone';
  const log = (pub.log ?? []) as { player_id: string; value: number | null }[];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Round {pub.round_number} of {pub.rounds_total} · target {pub.target}
          </p>
          <p className="font-display text-xl font-extrabold text-chalk">
            {myTurn ? 'Your turn' : `${activeName} is thinking`}
          </p>
        </div>
        <Countdown warnAt={5} />
      </div>

      {/* The running total — the whole reason the phone is on the table. */}
      <div
        className={`relative overflow-hidden rounded-[1.6rem] border-2 p-5 text-center shadow-pop ${
          blind ? 'border-edge bg-slatey/60' : 'border-accent/50 bg-accent/10'
        }`}
      >
        <div className="dots pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative">
          <p className="label mb-1 text-accent">{blind ? 'Total hidden' : 'Running total'}</p>
          <p className="numeral text-[3.6rem] leading-none text-chalk">
            {blind ? '??' : pub.total}
          </p>
          <p className="subtitle mt-1">
            {blind ? pub.modifier_text : `Bust at ${pub.target + 1}`}
          </p>
        </div>
      </div>

      {pub.modifier !== 'none' && !blind && (
        <p className="mt-3 text-center">
          <Sticker tone="accent2" tilt={-2}>
            {pub.modifier_text}
          </Sticker>
        </p>
      )}

      {log.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {log.map((e, i) => (
            <span
              key={i}
              className="numeral rounded-lg border-2 border-edge bg-slatey/70 px-2 py-0.5 text-xs text-chalk"
            >
              {e.value == null ? '?' : e.value > 0 ? `+${e.value}` : e.value}
            </span>
          ))}
        </div>
      )}

      {myTurn ? (
        <>
          <p className="subtitle mt-4 text-center">
            {myHand > 0
              ? `${myHand} card${myHand === 1 ? '' : 's'} in hand. Tap what you are playing.`
              : 'Nothing left in your hand — you can only fold.'}
          </p>

          <div className="no-select mt-3 grid grid-cols-4 gap-2">
            {VALUES.map((n) => {
              const active = chosen === n;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={busy || myHand <= 0}
                  onClick={() => {
                    vibrate(12);
                    setChosen(n);
                  }}
                  className={[
                    'flex aspect-[4/3] flex-col items-center justify-center rounded-xl border-2',
                    'font-display font-extrabold tabular-nums transition-all duration-100',
                    active
                      ? 'border-accent bg-accent text-ink shadow-glow'
                      : 'border-edge bg-slatey/80 text-chalk active:translate-y-[2px]',
                  ].join(' ')}
                >
                  <span className="text-lg leading-none">{cardLabel(n)}</span>
                  {cardHint(n) && (
                    <span className="mt-0.5 text-[0.52rem] font-bold uppercase tracking-wide opacity-70">
                      {cardHint(n)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {hearts && (
            <button
              type="button"
              onClick={() => setIsHeart((v) => !v)}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3
                          text-sm font-extrabold transition-all duration-100 ${
                            isHeart
                              ? 'border-blood bg-blood/20 text-blood'
                              : 'border-edge bg-slatey/70 text-mute'
                          }`}
            >
              {isHeart ? '♥ counting as negative' : '♥ this card is a heart'}
            </button>
          )}

          <ErrorNote>{error}</ErrorNote>
          <Spacer />

          <button
            className="btn-primary mt-4"
            disabled={busy || chosen == null || myHand <= 0}
            onClick={() => {
              vibrate(20);
              void submit('play', { value: chosen, hearts: isHeart });
            }}
          >
            {chosen == null
              ? 'Pick a card'
              : `Play ${cardLabel(chosen)}${isHeart ? ' ♥' : ''}`}
          </button>
          <button
            className="btn-ghost mt-2"
            disabled={busy}
            onClick={() => {
              vibrate(30);
              void submit('fold');
            }}
          >
            Fold — keep what I have
          </button>
        </>
      ) : (
        <>
          <Spacer />
          <TableStrip
            players={view.players}
            status={pub.status ?? {}}
            hand={pub.hand ?? {}}
            activeId={pub.current_player_id}
          />
          <p className="subtitle mt-5 text-center">
            Waiting on {activeName}. Nothing to do but watch their face.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Tally — who was left holding cards
// ---------------------------------------------------------------

export function TallyScreen({ view }: PhaseProps) {
  const pub = view.public as any;
  const last = pub.last ?? {};
  const nameOf = (id: string) => view.players.find((p) => p.player_id === id)?.nickname ?? '—';

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="label text-accent">
          Round {last.round ?? pub.round_number} of {pub.rounds_total}
        </p>
        <Countdown />
      </div>

      <HeroPanel
        className="animate-pop-in"
        tone={last.survivor_id ? 'accent' : 'blood'}
        kicker={last.survivor_id ? 'Last one standing' : 'Everybody went over'}
      >
        <p className="font-display text-[1.9rem] font-extrabold leading-tight text-chalk">
          {last.survivor_id ? nameOf(last.survivor_id) : 'Nobody'}
        </p>
        <p className="numeral mt-1 text-[2.6rem] leading-none text-accent">
          {last.survivor_id ? `+${last.gained ?? 0}` : '0'}
        </p>
        <p className="subtitle mt-1">
          {last.survivor_id
            ? `${last.gained ?? 0} card${(last.gained ?? 0) === 1 ? '' : 's'} still in hand`
            : `The pile finished on ${last.total ?? pub.total}`}
        </p>
      </HeroPanel>

      {last.exact_id && (
        <p className="mt-3 text-center">
          <Sticker tone="gold" tilt={2}>
            {nameOf(last.exact_id)} hit {last.target} exactly · +2
          </Sticker>
        </p>
      )}

      <div className="card mt-4">
        <p className="label">How it went</p>
        <div className="space-y-2">
          {view.players.map((p) => {
            const st = pub.status?.[p.player_id] ?? 'in';
            const survived = last.survivor_id === p.player_id;
            return (
              <div key={p.player_id} className="flex items-center gap-3">
                <AvatarBadge
                  avatarKey={p.avatar_key}
                  size={30}
                  dimmed={p.has_left}
                  ring={survived ? 'rgb(var(--accent-rgb))' : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-chalk">
                  {p.nickname}
                </span>
                {st === 'busted' && <Sticker tone="blood" tilt={-3}>bust · −1 card</Sticker>}
                {survived && <Sticker tone="accent" tilt={2}>survived</Sticker>}
                <span className="numeral w-8 text-right text-lg text-accent">
                  {pub.scores?.[p.player_id] ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Spacer />
      <p className="subtitle text-center">Next round is dealing itself.</p>
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
        <GameCharacter game="fold" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Not enough players left at the table.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as {
    player_id: string;
    score: number;
    cards: number;
  }[];
  const winners = new Set((result.winners ?? []) as string[]);
  const nameOf = (id: string) => view.players.find((p) => p.player_id === id)?.nickname ?? '—';

  return (
    <div className="flex flex-1 flex-col">
      <HeroPanel
        className="animate-pop-in"
        tone={winners.has(view.me.player_id) ? 'moss' : 'accent'}
        kicker={winners.size > 1 ? 'Dead heat' : 'Winner'}
      >
        <p className="font-display text-[2rem] font-extrabold leading-tight text-chalk">
          {[...winners].map(nameOf).join(' & ')}
        </p>
        <p className="numeral mt-1 text-[2.8rem] leading-none text-accent">
          {result.best_score ?? 0}
        </p>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">Final scores</p>
        <div className="space-y-3">
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
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-chalk">{nameOf(s.player_id)}</p>
                <p className="truncate text-xs text-mute">
                  finished holding {s.cards} card{s.cards === 1 ? '' : 's'}
                </p>
              </div>
              <span className="numeral text-lg text-accent">{s.score}</span>
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
