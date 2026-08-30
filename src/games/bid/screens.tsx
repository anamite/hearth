import { useNavigate, useParams } from 'react-router-dom';
import type { RoundPlayerView } from '@/types';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';
import { SLIP_MAX, SLIP_MIN } from '@/backend/mock/games/bid';

const SLIPS = Array.from({ length: SLIP_MAX - SLIP_MIN + 1 }, (_, i) => i + SLIP_MIN);

function signClass(value: number): string {
  return value < 0 ? 'text-blood' : 'text-accent';
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** The prize on the table, big enough to argue about. */
function PrizeCard({ prize, kicker }: { prize: number; kicker: string }) {
  const bad = prize < 0;
  return (
    <div
      className={`relative overflow-hidden rounded-[1.6rem] border-2 p-5 text-center shadow-pop ${
        bad ? 'border-blood/55 bg-blood/12' : 'border-accent/50 bg-accent/10'
      }`}
    >
      <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        <p className={`label mb-1 ${bad ? 'text-blood' : 'text-accent'}`}>{kicker}</p>
        <p className={`numeral text-[3.4rem] leading-none ${signClass(prize)}`}>{signed(prize)}</p>
        <p className="subtitle mt-1">
          {bad ? 'Lowest bid is stuck with it' : 'Highest bid takes it'}
        </p>
      </div>
    </div>
  );
}

/**
 * The public burn table. Tracking this by memory is the tedious part of
 * the game on paper, so it is the one thing always on screen.
 */
function BurnTable({
  players,
  spent,
  meId,
}: {
  players: RoundPlayerView[];
  spent: Record<string, number[]>;
  meId: string;
}) {
  return (
    <div className="card">
      <p className="label">Slips already burned</p>
      <div className="space-y-2">
        {players.map((p) => {
          const gone = new Set(spent[p.player_id] ?? []);
          return (
            <div key={p.player_id} className="flex items-center gap-2">
              <AvatarBadge avatarKey={p.avatar_key} size={26} dimmed={p.has_left} />
              <span
                className={`w-14 shrink-0 truncate text-[0.7rem] font-extrabold uppercase tracking-wide ${
                  p.player_id === meId ? 'text-accent' : 'text-mute'
                }`}
              >
                {p.player_id === meId ? 'You' : p.nickname}
              </span>
              <div className="flex flex-1 gap-[3px]">
                {SLIPS.map((n) => (
                  <span
                    key={n}
                    title={String(n)}
                    className={`h-4 flex-1 rounded-[3px] text-center text-[0.5rem] font-black leading-4 ${
                      gone.has(n)
                        ? 'bg-edge/50 text-mute line-through'
                        : 'bg-accent/70 text-ink'
                    }`}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Bid — choose a slip, face down
// ---------------------------------------------------------------

export function BidScreen({ view, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as any;
  const remaining = new Set((priv.remaining ?? []) as number[]);
  const chosen: number | null = priv.slip ?? null;

  const ready = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Prize {pub.prize_number} of {pub.prize_count}
          </p>
          <p className="text-sm font-bold text-mute">
            {ready} of {total} face down
          </p>
        </div>
        <Countdown warnAt={5} />
      </div>

      <PrizeCard prize={pub.prize} kicker="On the table" />

      <p className="subtitle mt-4 text-center">
        {chosen
          ? 'Locked in. You can still change it until the clock runs out.'
          : 'Pick a slip. Ties cancel each other out.'}
      </p>

      <div className="no-select mt-3 grid grid-cols-5 gap-2">
        {SLIPS.map((n) => {
          const burned = !remaining.has(n);
          const active = chosen === n;
          return (
            <button
              key={n}
              type="button"
              disabled={burned || busy}
              onClick={() => {
                vibrate(12);
                void submit('bid', { slip: n });
              }}
              className={[
                'flex aspect-[4/3] items-center justify-center rounded-xl border-2',
                'font-display text-lg font-extrabold tabular-nums transition-all duration-100',
                burned
                  ? 'border-edge/50 bg-ink/40 text-mute/40 line-through'
                  : active
                    ? 'border-accent bg-accent text-ink shadow-glow'
                    : 'border-edge bg-slatey/80 text-chalk active:translate-y-[2px]',
              ].join(' ')}
            >
              {n}
            </button>
          );
        })}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <Spacer />

      <div className="mt-4">
        <BurnTable players={view.players} spent={pub.spent} meId={view.me.player_id} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Reveal — everything face up at once
// ---------------------------------------------------------------

export function RevealScreen({ view }: PhaseProps) {
  const pub = view.public as any;
  const last = pub.last ?? { bids: {}, cancelled: [], winner_id: null, prize: pub.prize };
  const cancelled = new Set((last.cancelled ?? []) as number[]);
  const nameOf = (id: string) => view.players.find((p) => p.player_id === id)?.nickname ?? '—';

  const rows = [...view.players]
    .filter((p) => last.bids?.[p.player_id] != null)
    .sort((a, b) => (last.bids[b.player_id] ?? 0) - (last.bids[a.player_id] ?? 0));

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="label text-accent">
          Prize {pub.prize_number} of {pub.prize_count}
        </p>
        <Countdown />
      </div>

      <PrizeCard prize={last.prize} kicker={last.winner_id ? 'Taken' : 'Nobody took it'} />

      <div className="card mt-4">
        <p className="label">What everyone played</p>
        <div className="space-y-2">
          {rows.map((p) => {
            const slip = last.bids[p.player_id] as number;
            const won = last.winner_id === p.player_id;
            const struck = cancelled.has(slip);
            return (
              <div key={p.player_id} className="flex items-center gap-3">
                <AvatarBadge
                  avatarKey={p.avatar_key}
                  size={30}
                  ring={won ? 'rgb(var(--accent-rgb))' : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-chalk">
                  {p.nickname}
                </span>
                {struck && <Sticker tone="blood" tilt={-3}>cancelled</Sticker>}
                <span
                  className={`numeral text-xl ${
                    struck ? 'text-blood line-through' : won ? 'text-accent' : 'text-mute'
                  }`}
                >
                  {slip}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="subtitle mt-4 text-center">
        {last.winner_id
          ? `${nameOf(last.winner_id)} takes ${signed(last.prize)}.`
          : 'Every bid was matched, so it goes nowhere.'}
      </p>

      <Spacer />

      <div className="card">
        <p className="label">Scores</p>
        <div className="flex flex-wrap justify-center gap-3">
          {view.players.map((p) => (
            <div key={p.player_id} className="text-center">
              <AvatarBadge avatarKey={p.avatar_key} size={30} dimmed={p.has_left} />
              <p className={`numeral mt-1 text-sm ${signClass(pub.scores[p.player_id] ?? 0)}`}>
                {signed(pub.scores[p.player_id] ?? 0)}
              </p>
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
        <GameCharacter game="bid" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Not enough players left to read.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as {
    player_id: string;
    score: number;
    prizes: number[];
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
        <p className={`numeral mt-1 text-[2.8rem] leading-none ${signClass(result.best_score)}`}>
          {signed(result.best_score)}
        </p>
      </HeroPanel>

      <div className="card mt-4">
        <p className="label">Final scores</p>
        <div className="space-y-3">
          {standings.map((s, i) => (
            <div key={s.player_id} className="flex items-start gap-3">
              <span className="numeral w-5 pt-1 text-sm text-mute">{i + 1}</span>
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
                  {s.prizes.length ? s.prizes.map(signed).join(' · ') : 'took nothing'}
                </p>
              </div>
              <span className={`numeral text-lg ${signClass(s.score)}`}>{signed(s.score)}</span>
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
