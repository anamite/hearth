import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RoundPlayerView } from '@/types';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';
import { SCRAPS_PER_PLAYER } from '@/backend/mock/games/nerve';

interface Pub {
  round_no: number;
  wins_needed: number;
  order: string[];
  held: Record<string, number>;
  wins: Record<string, number>;
  pile: Record<string, number>;
  flipped: Record<string, number>;
  passed: string[];
  bid: { player_id: string; amount: number } | null;
  table_total: number;
  turn: string | null;
  challenger: string | null;
  flips_done: number;
  last: {
    challenger_id: string | null;
    bid: number;
    flips_done: number;
    outcome: string;
  } | null;
}

function seated(view: PhaseProps['view'], pub: Pub): RoundPlayerView[] {
  const byId = new Map(view.players.map((p) => [p.player_id, p]));
  return pub.order.map((id) => byId.get(id)).filter((p): p is RoundPlayerView => !!p);
}

/** Face-down scraps as a row of chips; flipped ones are turned over. */
function Pile({ down, up }: { down: number; up: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: up }, (_, i) => (
        <span
          key={`u${i}`}
          className="h-3.5 w-3.5 rounded-[3px] border-2 border-edge bg-ink/60"
          aria-label="flipped"
        />
      ))}
      {Array.from({ length: Math.max(0, down - up) }, (_, i) => (
        <span
          key={`d${i}`}
          className="h-3.5 w-3.5 rounded-[3px] border-2 border-black/40 bg-accent"
          aria-label="face down"
        />
      ))}
      {down === 0 && <span className="text-[0.65rem] font-bold text-mute">nothing down</span>}
    </div>
  );
}

/** Who is at the table, what they have down, and what they have left. */
function TableStrip({
  view,
  pub,
  onPick,
  pickable,
}: {
  view: PhaseProps['view'];
  pub: Pub;
  onPick?: (playerId: string) => void;
  pickable?: Set<string>;
}) {
  const passed = new Set(pub.passed ?? []);

  return (
    <div className="space-y-2">
      {seated(view, pub).map((p) => {
        const id = p.player_id;
        const out = (pub.held[id] ?? 0) === 0;
        const canPick = pickable?.has(id) ?? false;
        const isTurn = pub.turn === id;

        return (
          <button
            key={id}
            type="button"
            disabled={!canPick}
            onClick={canPick ? () => onPick?.(id) : undefined}
            className={[
              'flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left transition-all duration-100',
              isTurn ? 'border-accent bg-accent/12' : 'border-edge bg-slatey/60',
              canPick ? 'cursor-pointer active:translate-y-[2px] active:bg-accent/20' : '',
              out || p.has_left ? 'opacity-40' : '',
            ].join(' ')}
          >
            <AvatarBadge
              avatarKey={p.avatar_key}
              size={32}
              ring={isTurn ? 'rgb(var(--accent-rgb))' : undefined}
              dimmed={p.has_left}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-chalk">
                {p.player_id === view.me.player_id ? 'You' : p.nickname}
                {passed.has(id) && <span className="ml-2 text-xs text-mute">passed</span>}
                {p.has_left && <span className="ml-2 text-xs text-mute">gone</span>}
              </p>
              <Pile down={pub.pile[id] ?? 0} up={pub.flipped[id] ?? 0} />
            </div>
            <div className="text-right">
              <p className="numeral text-sm text-mute">
                {pub.held[id] ?? 0}
                <span className="text-[0.6rem]">/{SCRAPS_PER_PLAYER}</span>
              </p>
              <p className="text-[0.6rem] font-extrabold uppercase tracking-widest text-accent">
                {'★'.repeat(pub.wins[id] ?? 0) || '—'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function header(pub: Pub, line: string) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className="label mb-0.5 text-accent">
          Round {pub.round_no} · first to {pub.wins_needed}
        </p>
        <p className="font-display text-xl font-extrabold text-chalk">{line}</p>
      </div>
      <Countdown />
    </div>
  );
}

// ---------------------------------------------------------------
// Place — one scrap each, face down, at the same time
// ---------------------------------------------------------------

export function PlaceScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as unknown as Pub;
  const done = me.has_acted;
  const ready = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;

  return (
    <div className="flex flex-1 flex-col">
      {header(pub, done ? 'Scrap is down' : 'Put one scrap down')}

      <div className="card-accent text-center">
        <p className="subtitle">
          Choose a dot or your X and lay it face down in front of you. Nobody sees it — the
          app least of all.
        </p>
      </div>

      <div className="mt-4">
        <TableStrip view={view} pub={pub} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.14em] text-mute">
        {ready} of {total} down
      </p>
      <button
        className="btn-primary"
        disabled={done || busy}
        onClick={() => {
          vibrate();
          void submit('place');
        }}
      >
        {done ? 'Waiting for the others…' : 'It’s down'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Turn — add another, or say a number
// ---------------------------------------------------------------

export function TurnScreen({ view, submit, busy, error }: PhaseProps) {
  const pub = view.public as unknown as Pub;
  const meId = view.me.player_id;
  const myTurn = pub.turn === meId;
  const minBid = (pub.bid?.amount ?? 0) + 1;
  const canPlace = !pub.bid && (pub.pile[meId] ?? 0) < (pub.held[meId] ?? 0);
  const canBid = minBid <= pub.table_total;

  const [amount, setAmount] = useState(minBid);
  // The turn phase is re-entered many times in a round, so "this turn"
  // state needs an explicit reset — mounting is not one.
  const turnKey = `${pub.round_no}:${pub.turn}:${pub.bid?.amount ?? 0}:${pub.table_total}`;
  useEffect(() => {
    setAmount(Math.min(Math.max(minBid, 1), Math.max(pub.table_total, 1)));
    if (myTurn) vibrate([12, 40, 12]);
  }, [turnKey]);

  const onTurn = view.players.find((p) => p.player_id === pub.turn);
  const leader = view.players.find((p) => p.player_id === pub.bid?.player_id);

  return (
    <div className="flex flex-1 flex-col">
      {header(pub, myTurn ? 'Your call' : `${onTurn?.nickname ?? 'Someone'} is deciding`)}

      <div
        className={`relative overflow-hidden rounded-[1.6rem] border-2 p-5 text-center shadow-pop ${
          pub.bid ? 'border-accent/50 bg-accent/10' : 'border-edge bg-slatey/50'
        }`}
      >
        <div className="stripes pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative">
          <p className="label mb-1 text-accent">{pub.bid ? 'The claim' : 'No claim yet'}</p>
          {pub.bid ? (
            <>
              <p className="numeral text-[3.2rem] leading-none text-chalk">{pub.bid.amount}</p>
              <p className="subtitle mt-1">
                {leader?.nickname} says they can flip {pub.bid.amount} clean
              </p>
            </>
          ) : (
            <p className="subtitle">
              {pub.table_total} scrap{pub.table_total === 1 ? '' : 's'} on the table
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <TableStrip view={view} pub={pub} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      {myTurn ? (
        <div className="mt-4 space-y-2">
          {canBid && (
            <div className="flex items-center gap-2">
              <button
                className="btn-ghost h-14 w-16 shrink-0 text-2xl"
                disabled={busy || amount <= minBid}
                onClick={() => setAmount((n) => Math.max(minBid, n - 1))}
                aria-label="Lower"
              >
                −
              </button>
              <button
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => {
                  vibrate();
                  void submit('bid', { amount });
                }}
              >
                Say {amount}
              </button>
              <button
                className="btn-ghost h-14 w-16 shrink-0 text-2xl"
                disabled={busy || amount >= pub.table_total}
                onClick={() => setAmount((n) => Math.min(pub.table_total, n + 1))}
                aria-label="Higher"
              >
                +
              </button>
            </div>
          )}
          {canPlace && (
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                vibrate();
                void submit('place');
              }}
            >
              Add another scrap
            </button>
          )}
          {pub.bid && (
            <button className="btn-quiet" disabled={busy} onClick={() => void submit('pass')}>
              Pass
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-[1.4rem] border-2 border-edge bg-slatey/60 p-4 text-center text-sm font-bold text-mute">
          {pub.bid
            ? `Raise it or let it go — ${onTurn?.nickname} decides next.`
            : `${onTurn?.nickname} can add a scrap or start the bidding.`}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Flip — the challenger turns them over, out loud
// ---------------------------------------------------------------

export function FlipScreen({ view, submit, busy, error }: PhaseProps) {
  const pub = view.public as unknown as Pub;
  const meId = view.me.player_id;
  const mine = pub.challenger === meId;
  const target0 = pub.challenger ?? '';
  const ownLeft = (pub.pile[target0] ?? 0) - (pub.flipped[target0] ?? 0);

  const openPiles = new Set(
    (pub.order ?? []).filter((id) => (pub.flipped[id] ?? 0) < (pub.pile[id] ?? 0)),
  );
  // Your own stack first, top down; only then anybody else's.
  const pickable = ownLeft > 0 ? new Set([target0]) : openPiles;

  const [target, setTarget] = useState<string | null>(null);
  const flipKey = `${pub.round_no}:${pub.flips_done}:${ownLeft}`;
  useEffect(() => {
    setTarget(ownLeft > 0 ? target0 : null);
  }, [flipKey]);

  const challenger = view.players.find((p) => p.player_id === pub.challenger);
  const goal = pub.bid?.amount ?? 0;
  const targetName =
    target === meId ? 'your own' : view.players.find((p) => p.player_id === target)?.nickname;

  return (
    <div className="flex flex-1 flex-col">
      {header(pub, mine ? 'Turn them over' : `${challenger?.nickname} is flipping`)}

      <div className="card-accent text-center">
        <p className="numeral text-[2.6rem] leading-none text-chalk">
          {pub.flips_done}
          <span className="text-xl text-mute"> / {goal}</span>
        </p>
        <p className="subtitle mt-1">
          {mine ? 'clean so far' : `${challenger?.nickname} needs ${goal} clean`}
        </p>
      </div>

      <div className="mt-4">
        <TableStrip
          view={view}
          pub={pub}
          pickable={mine && !busy ? pickable : undefined}
          onPick={setTarget}
        />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      {mine ? (
        <div className="mt-4">
          <p className="mb-2 text-center text-sm font-bold text-mute">
            {target
              ? `Flipping ${targetName === 'your own' ? 'your own stack' : `${targetName}’s top scrap`} — what is it?`
              : ownLeft > 0
                ? 'Your own stack first.'
                : 'Pick a pile above.'}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={busy || !target}
              onClick={() => {
                vibrate();
                void submit('flip', { target_id: target, hit: false });
              }}
            >
              A dot
            </button>
            <button
              className="btn-danger flex-1"
              disabled={busy || !target}
              onClick={() => {
                vibrate([30, 60, 30]);
                void submit('flip', { target_id: target, hit: true });
              }}
            >
              The X
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-[1.4rem] border-2 border-edge bg-slatey/60 p-4 text-center text-sm font-bold text-mute">
          Watch the pile, not the phone.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Round end
// ---------------------------------------------------------------

const OUTCOME: Record<string, { line: string; tone: 'moss' | 'blood' | 'accent' }> = {
  made: { line: 'Made it', tone: 'moss' },
  hit_x: { line: 'Hit the X', tone: 'blood' },
  no_flip: { line: 'Ran out of time', tone: 'blood' },
  abandoned: { line: 'Round abandoned', tone: 'accent' },
};

export function RoundEndScreen({ view }: PhaseProps) {
  const pub = view.public as unknown as Pub;
  const last = pub.last;
  const who = view.players.find((p) => p.player_id === last?.challenger_id);
  const o = OUTCOME[last?.outcome ?? 'abandoned'] ?? OUTCOME.abandoned;

  return (
    <div className="flex flex-1 flex-col">
      {header(pub, 'Round over')}

      <HeroPanel className="animate-pop-in" tone={o.tone} kicker={who?.nickname ?? 'Nobody'}>
        <p className="font-display text-[2.2rem] font-extrabold leading-tight text-chalk">
          {o.line}
        </p>
        {last && last.outcome !== 'abandoned' && (
          <p className="subtitle mt-1">
            {last.flips_done} of {last.bid} turned over clean
          </p>
        )}
      </HeroPanel>

      <div className="mt-4">
        <TableStrip view={view} pub={pub} />
      </div>

      <Spacer />
      <p className="text-center text-sm font-bold text-mute">Next round in a moment…</p>
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
        <GameCharacter game="nerve" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Too few players left to continue.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as {
    player_id: string;
    wins: number;
    scraps: number;
  }[];
  const winner = view.players.find((p) => p.player_id === result.winner_id);

  return (
    <div className="flex flex-1 flex-col">
      <HeroPanel
        className="animate-pop-in"
        tone={result.winner_id === view.me.player_id ? 'moss' : 'accent'}
        kicker={result.reason === 'last_standing' ? 'Last one holding paper' : 'Held their nerve'}
      >
        <p className="font-display text-[2.2rem] font-extrabold leading-tight text-chalk">
          {winner?.nickname ?? 'Nobody'}
        </p>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">Rounds won</p>
        <div className="space-y-2">
          {standings.map((s, i) => {
            const p = view.players.find((x) => x.player_id === s.player_id);
            return (
              <div key={s.player_id} className="flex items-center gap-3">
                <span className="numeral w-5 text-sm text-mute">{i + 1}</span>
                <AvatarBadge
                  avatarKey={p?.avatar_key ?? 'fox'}
                  size={30}
                  ring={
                    s.player_id === result.winner_id ? 'rgb(var(--accent-rgb))' : undefined
                  }
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-chalk">
                  {p?.nickname}
                </span>
                {s.scraps === 0 && <Sticker tone="blood" tilt={-3}>out</Sticker>}
                <span className="numeral text-lg text-accent">{s.wins}</span>
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
