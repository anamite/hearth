import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { Countdown } from '@/components/Countdown';
import { AvatarBadge } from '@/components/Avatar';
import { HoldToReveal } from '@/components/HoldToReveal';
import { PlayerGrid } from '@/components/PlayerGrid';
import { ErrorNote, HeroPanel, Spacer, Sticker } from '@/components/ui';
import { GameCharacter } from '@/components/art';
import { vibrate } from '@/lib/hooks';

interface SeasonRecord {
  season: number;
  rule: string;
  scoring: 'normal' | 'double' | 'void';
  secret_to: string | null;
  tricks: Record<string, number>;
  points: Record<string, number>;
}

const SCORING_STICKER: Record<string, { tone: 'accent' | 'gold' | 'blood'; text: string }> = {
  normal: { tone: 'accent', text: 'one point a trick' },
  double: { tone: 'gold', text: 'tricks count double' },
  void: { tone: 'blood', text: 'tricks count nothing' },
};

/** The running tally. Same shape on both screens so it reads as one thing. */
function Tally({ view, tricks }: { view: PhaseProps['view']; tricks: Record<string, number> }) {
  const pub = view.public as any;
  return (
    <div className="card">
      <p className="label">This season · banked</p>
      <div className="flex flex-wrap justify-center gap-3">
        {view.players.map((p) => (
          <div key={p.player_id} className="w-[3.6rem] text-center">
            <AvatarBadge avatarKey={p.avatar_key} size={30} dimmed={p.has_left} />
            <p className="numeral mt-1 text-sm text-chalk">{tricks[p.player_id] ?? 0}</p>
            <p className="numeral text-[0.66rem] text-mute">
              {pub.scores?.[p.player_id] ?? 0}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Season — the weather turns
// ---------------------------------------------------------------

export function SeasonScreen({ view, me, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as any;
  const secret: boolean = !!pub.secret;
  const iKnow = secret && pub.secret_to === me.player_id;
  const rule: string | null = iKnow ? priv.rule ?? null : pub.rule;
  const scoring: string | null = iKnow ? priv.scoring ?? null : pub.scoring;
  const history = (pub.history ?? []) as SeasonRecord[];
  const previous = history.length ? history[history.length - 1] : null;

  const ready = view.players.filter((p) => p.has_acted && !p.has_left).length;
  const total = view.players.filter((p) => !p.has_left).length;
  const keeperName =
    view.players.find((p) => p.player_id === pub.secret_to)?.nickname ?? 'Someone';

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Season {pub.season_number} of {pub.seasons_total}
          </p>
          <p className="text-sm font-bold text-mute">
            {ready} of {total} read it
          </p>
        </div>
        <Countdown />
      </div>

      {pub.season_number === 1 && (
        <p className="mb-3 text-center">
          <Sticker tone="accent2" tilt={-2}>
            Deal the whole deck out evenly
          </Sticker>
        </p>
      )}

      {iKnow ? (
        <HoldToReveal hint="Hold — this season is yours alone">
          <div className="no-select px-6 text-center">
            <p className="label mb-2 text-accent">Only you know this</p>
            <p className="font-display text-[1.5rem] font-extrabold leading-tight text-chalk">
              {rule}
            </p>
            {scoring && scoring !== 'normal' && (
              <p className="mt-3">
                <Sticker tone={SCORING_STICKER[scoring].tone} tilt={2}>
                  {SCORING_STICKER[scoring].text}
                </Sticker>
              </p>
            )}
          </div>
        </HoldToReveal>
      ) : secret ? (
        <div className="relative overflow-hidden rounded-[1.6rem] border-2 border-edge bg-slatey/60 p-7 text-center shadow-pop">
          <div className="dots pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <p className="label mb-2 text-accent">This season is hidden</p>
            <p className="font-display text-[1.6rem] font-extrabold leading-tight text-chalk">
              {keeperName} has been told the rule.
            </p>
            <p className="subtitle mt-2">The rest of you get to work it out.</p>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[1.6rem] border-2 border-accent/50 bg-accent/10 p-6 text-center shadow-pop">
          <div className="stripes pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <p className="label mb-2 text-accent">The rule this season</p>
            <p className="font-display text-[1.55rem] font-extrabold leading-tight text-chalk">
              {rule}
            </p>
            {scoring && scoring !== 'normal' && (
              <p className="mt-3">
                <Sticker tone={SCORING_STICKER[scoring].tone} tilt={-2}>
                  {SCORING_STICKER[scoring].text}
                </Sticker>
              </p>
            )}
          </div>
        </div>
      )}

      {previous && (
        <div className="card mt-4">
          <p className="label">Season {previous.season} was</p>
          <p className="text-sm font-semibold text-chalk">{previous.rule}</p>
          {previous.scoring !== 'normal' && (
            <p className="mt-1.5 text-xs font-bold uppercase tracking-wide text-mute">
              {SCORING_STICKER[previous.scoring].text}
            </p>
          )}
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
        {me.has_acted ? 'Waiting for the others…' : 'Read it — play on'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Trick — the phone goes quiet and waits to be told who took it
// ---------------------------------------------------------------

export function TrickScreen({ view, submit, busy, error }: PhaseProps) {
  const pub = view.public as any;
  const priv = view.me.private as any;
  const secret: boolean = !!pub.secret;
  const iKnow = secret && pub.secret_to === view.me.player_id;
  const rule: string | null = iKnow ? priv.rule ?? null : pub.rule;
  const last = pub.last_claim ?? null;
  const canUndo = !!last && last.season === pub.season_number;
  const lastName =
    view.players.find((p) => p.player_id === last?.player_id)?.nickname ?? 'Someone';

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="label mb-0.5 text-accent">
            Season {pub.season_number} · trick {pub.trick_number} of {pub.tricks_total}
          </p>
          <p className="font-display text-xl font-extrabold text-chalk">Play it out</p>
        </div>
        <Countdown warnAt={20} />
      </div>

      <div
        className={`rounded-[1.4rem] border-2 p-4 text-center ${
          secret && !iKnow ? 'border-edge bg-slatey/50' : 'border-accent/40 bg-accent/10'
        }`}
      >
        {secret && !iKnow ? (
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-mute">
            This season is hidden
          </p>
        ) : (
          <p className="text-sm font-semibold leading-snug text-chalk">{rule}</p>
        )}
      </div>

      <p className="subtitle mt-5 text-center">Who took the trick?</p>

      <div className="mt-3">
        <PlayerGrid
          players={view.players}
          onSelect={(id) => {
            vibrate(16);
            void submit('took', { player_id: id });
          }}
          columns={3}
          captions={Object.fromEntries(
            view.players.map((p) => [
              p.player_id,
              `${pub.season_tricks?.[p.player_id] ?? 0} this season`,
            ]),
          )}
        />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      {canUndo && (
        <button
          className="btn-quiet mt-4"
          disabled={busy}
          onClick={() => void submit('undo')}
        >
          Undo — that wasn’t {lastName}
        </button>
      )}

      <div className="mt-4">
        <Tally view={view} tricks={pub.season_tricks ?? {}} />
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
        <GameCharacter game="season" size={64} className="opacity-50" />
        <p className="font-display text-3xl font-extrabold text-chalk">Round abandoned</p>
        <p className="subtitle">Too few players left to keep a table going.</p>
        <button className="btn-primary mt-4" onClick={() => navigate(`/g/${code}`)}>
          Back to the lobby
        </button>
      </div>
    );
  }

  const standings = (result.standings ?? []) as {
    player_id: string;
    score: number;
    tricks: number;
    secrets: number;
  }[];
  const winners = new Set((result.winners ?? []) as string[]);
  const history = (result.history ?? []) as SeasonRecord[];
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
                  {s.tricks} trick{s.tricks === 1 ? '' : 's'} taken
                  {s.secrets > 0 && ` · knew ${s.secrets} season${s.secrets === 1 ? '' : 's'}`}
                </p>
              </div>
              <span className="numeral text-lg text-accent">{s.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4">
        <p className="label">Every season, now that it’s over</p>
        <div className="space-y-2.5">
          {history.map((h) => (
            <div key={h.season} className="border-t-2 border-edge/40 pt-2 first:border-0 first:pt-0">
              <p className="text-sm font-semibold leading-snug text-chalk">{h.rule}</p>
              <p className="mt-0.5 text-[0.66rem] font-bold uppercase tracking-wide text-mute">
                Season {h.season}
                {h.scoring !== 'normal' && ` · ${SCORING_STICKER[h.scoring].text}`}
                {h.secret_to && ` · only ${nameOf(h.secret_to)} knew`}
              </p>
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
