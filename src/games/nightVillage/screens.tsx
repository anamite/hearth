import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhaseProps } from '../types';
import { HoldToReveal } from '@/components/HoldToReveal';
import { Countdown, PhaseProgress } from '@/components/Countdown';
import { PlayerGrid } from '@/components/PlayerGrid';
import { AvatarBadge } from '@/components/Avatar';
import { Spacer } from '@/components/ui';
import { avatarColor } from '@/lib/constants';
import { vibrate, useLocalStorage } from '@/lib/hooks';
import { playSequence, preloadAll, unlock } from '@/lib/audio';

const ROLE_COPY: Record<string, { title: string; body: string; tone: 'danger' | 'default' }> = {
  wolf: {
    title: 'You are a Wolf',
    body: 'Kill quietly at night. Blend in by day. Do not get caught.',
    tone: 'danger',
  },
  seer: {
    title: 'You are the Seer',
    body: 'Each night you learn whether one player is a Wolf. Saying so out loud paints a target on you.',
    tone: 'default',
  },
  doctor: {
    title: 'You are the Doctor',
    body: 'Each night you protect one player. You will never be told whether it worked.',
    tone: 'default',
  },
  villager: {
    title: 'You are a Villager',
    body: 'You have no special power. You have your judgement, and your mouth.',
    tone: 'default',
  },
};

// ---------------------------------------------------------------
// Narration — plays on exactly one device, text always on screen
// ---------------------------------------------------------------

function useNarration(view: PhaseProps['view']) {
  // Spec §14.6 — exactly one device plays. Default is the host; the settings
  // screen lets anyone take over, stored per group on that device.
  const [speaker, setSpeaker] = useLocalStorage(
    `hearth.speaker.${view.group_id}`,
    null as boolean | null,
  );
  const isHost = view.players.find((p) => p.player_id === view.me.player_id)?.is_host ?? false;
  const amSpeaker = speaker ?? isHost;
  const narration = (view.public as any).narration as
    | { seq: number; lines: { clips: string[]; text: string }[] }
    | undefined;
  const lastSeq = useRef(-1);

  useEffect(() => {
    void preloadAll();
  }, []);

  useEffect(() => {
    if (!narration || narration.seq === lastSeq.current) return;
    lastSeq.current = narration.seq;
    if (!amSpeaker) return;
    void playSequence(narration.lines.flatMap((l) => l.clips));
  }, [narration, amSpeaker]);

  return { lines: narration?.lines ?? [], amSpeaker, setSpeaker };
}

function NarrationText({ lines }: { lines: { text: string }[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5 text-center">
      {lines.map((l, i) => (
        <p key={i} className="font-display text-2xl leading-snug text-chalk animate-fade-up">
          {l.text}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------

export function RevealScreen({ view, submit, busy }: PhaseProps) {
  const role = view.me.role ?? 'villager';
  const copy = ROLE_COPY[role] ?? ROLE_COPY.villager;
  const priv = view.me.private as any;
  const [seen, setSeen] = useState(false);

  const fellowWolves = ((priv.fellow_wolves ?? []) as string[])
    .map((id) => view.players.find((p) => p.player_id === id))
    .filter(Boolean);

  const readyCount = view.players.filter((p) => p.has_acted).length;

  return (
    <div className="flex flex-1 flex-col">
      <p className="label">Everyone look at your own phone</p>

      <HoldToReveal
        tone={copy.tone}
        hint="Hold to see your role"
        onFirstReveal={() => {
          setSeen(true);
          unlock();
          vibrate();
        }}
      >
        <p
          className={`font-display text-[2.3rem] leading-tight ${
            copy.tone === 'danger' ? 'text-blood' : 'text-chalk'
          }`}
        >
          {copy.title}
        </p>
        <p className="subtitle mt-3">{copy.body}</p>

        {fellowWolves.length > 0 && (
          <>
            <p className="label mt-6">Your pack</p>
            <div className="flex justify-center gap-3">
              {fellowWolves.map((p) => (
                <div key={p!.player_id} className="flex flex-col items-center gap-1">
                  <AvatarBadge avatarKey={p!.avatar_key} size={44} ring="#C6413B" />
                  <span className="text-xs text-chalk">{p!.nickname}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {role === 'wolf' && fellowWolves.length === 0 && (
          <p className="mt-6 text-sm text-mute">You hunt alone.</p>
        )}
      </HoldToReveal>

      <p className="mt-4 text-center text-sm text-mute">
        {readyCount} of {view.players.length} ready
      </p>

      <Spacer />
      <button className="btn-primary" disabled={busy || !seen} onClick={() => submit('revealed')}>
        {seen ? 'Got it' : 'Hold the card first'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Night
// ---------------------------------------------------------------

export function NightScreen({ view, submit, busy }: PhaseProps) {
  const phase = view.phase;
  const role = view.me.role;
  const priv = view.me.private as any;
  const alive = view.me.is_alive;

  const acting =
    alive &&
    ((phase === 'night_wolves' && role === 'wolf') ||
      (phase === 'night_seer' && role === 'seer') ||
      (phase === 'night_doctor' && role === 'doctor'));

  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [phase, view.day_number]);
  useEffect(() => {
    if (acting) vibrate([14, 50, 14]);
  }, [acting]);

  const iActed = view.players.find((p) => p.player_id === view.me.player_id)?.has_acted;

  // Not acting: the phone must show nothing at all (§12.12 screen 2).
  if (!acting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="h-2 w-2 rounded-full bg-mute/40" />
        <p className="font-display text-3xl text-mute">The village sleeps</p>
        {!alive && (
          <p className="pill">You are out — watching only</p>
        )}
        <p className="subtitle max-w-[16rem]">Put the phone face down on the table.</p>
      </div>
    );
  }

  const targets = view.players.filter((p) => p.is_alive && !p.has_left);
  const disabled = new Set<string>();
  const captions: Record<string, string> = {};
  const rings: Record<string, string> = {};

  if (phase === 'night_wolves') {
    disabled.add(view.me.player_id);
    // Wolves converge without speaking: show each other's live picks.
    for (const v of (priv.wolf_votes ?? []) as { wolf_id: string; target_id: string }[]) {
      const wolf = view.players.find((p) => p.player_id === v.wolf_id);
      rings[v.target_id] = avatarColor(wolf?.avatar_key ?? 'crow');
    }
  }

  if (phase === 'night_seer') {
    disabled.add(view.me.player_id);
    for (const c of (priv.checks ?? []) as { target_id: string; is_wolf: boolean }[]) {
      disabled.add(c.target_id);
      captions[c.target_id] = c.is_wolf ? 'Wolf' : 'Not a wolf';
    }
  }

  if (phase === 'night_doctor') {
    const mode = view.settings.night_village.doctor_self_protect;
    const selfUsed = (priv.self_protects_used ?? 0) >= 1;
    if (mode === 'never' || (mode === 'once' && selfUsed)) disabled.add(view.me.player_id);
    if (priv.protected_last_night) {
      disabled.add(priv.protected_last_night);
      captions[priv.protected_last_night] = 'protected last night';
    }
  }

  const prompt =
    phase === 'night_wolves'
      ? 'Choose who dies tonight'
      : phase === 'night_seer'
        ? 'Choose who to look at'
        : 'Choose who to protect';

  const action =
    phase === 'night_wolves' ? 'wolf_vote' : phase === 'night_seer' ? 'seer_check' : 'doctor_protect';

  const latestCheck = ((priv.checks ?? []) as any[]).at(-1);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-lg font-semibold text-chalk">{prompt}</p>
        <Countdown />
      </div>
      <PhaseProgress total={view.settings.night_village.night_action_seconds} />

      <div className="mt-4">
        <PlayerGrid
          players={targets}
          selectedId={picked}
          onSelect={setPicked}
          disabledIds={disabled}
          rings={rings}
          captions={captions}
        />
      </div>

      {phase === 'night_seer' && iActed && latestCheck && (
        <div
          className={`mt-5 rounded-2xl border p-4 text-center ${
            latestCheck.is_wolf ? 'border-blood/40 bg-blood/10' : 'border-moss/40 bg-moss/10'
          }`}
        >
          <p className="label mb-1">You looked at</p>
          <p className="font-display text-2xl text-chalk">
            {view.players.find((p) => p.player_id === latestCheck.target_id)?.nickname}
          </p>
          <p className={`mt-1 text-lg font-semibold ${latestCheck.is_wolf ? 'text-blood' : 'text-moss'}`}>
            {latestCheck.is_wolf ? 'They are a Wolf' : 'They are not a Wolf'}
          </p>
        </div>
      )}

      <Spacer />

      {phase === 'night_wolves' && iActed && (
        <p className="mb-2 text-center text-sm text-mute">
          Waiting for the pack to agree. Tap another name to change your mind.
        </p>
      )}

      {!(phase === 'night_seer' && iActed) && (
        <button
          className="btn-primary"
          disabled={!picked || busy}
          onClick={() => picked && submit(action, { target_id: picked })}
        >
          {phase === 'night_wolves' && iActed ? 'Change my pick' : 'Confirm'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Morning / Evening — narration beats
// ---------------------------------------------------------------

export function MorningScreen({ view }: PhaseProps) {
  const { lines } = useNarration(view);
  const summary = (view.public as any).morning as
    | { died_id: string | null; died_role: string | null; saved: boolean }
    | null;
  const died = view.players.find((p) => p.player_id === summary?.died_id);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
      <NarrationText lines={lines} />
      {died ? (
        <div className="flex flex-col items-center gap-3">
          <AvatarBadge avatarKey={died.avatar_key} size={80} dimmed />
          <p className="font-display text-3xl text-chalk">{died.nickname}</p>
          {summary?.died_role && (
            <p className="pill">was a {roleWord(summary.died_role)}</p>
          )}
        </div>
      ) : (
        <p className="pill">Everyone is still here</p>
      )}
      <Countdown size="sm" />
    </div>
  );
}

export function EveningScreen({ view }: PhaseProps) {
  const { lines } = useNarration(view);
  const result = (view.public as any).day_result as
    | { votes: { voter_id: string; target_id: string | null }[]; eliminated_id: string | null; eliminated_role: string | null }
    | null;

  const byTarget = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of result?.votes ?? []) {
      const key = v.target_id ?? 'abstain';
      m.set(key, [...(m.get(key) ?? []), v.voter_id]);
    }
    return m;
  }, [result]);

  const out = view.players.find((p) => p.player_id === result?.eliminated_id);

  return (
    <div className="flex flex-1 flex-col">
      <div className="py-6">
        <NarrationText lines={lines} />
      </div>

      {out && (
        <div className="mb-5 flex flex-col items-center gap-2">
          <AvatarBadge avatarKey={out.avatar_key} size={72} dimmed />
          <p className="font-display text-2xl text-chalk">{out.nickname}</p>
          {result?.eliminated_role && (
            <p className="pill">was a {roleWord(result.eliminated_role)}</p>
          )}
        </div>
      )}

      <div className="card">
        <p className="label">Every vote</p>
        <div className="space-y-2">
          {[...byTarget.entries()].map(([target, voters]) => {
            const p = view.players.find((x) => x.player_id === target);
            return (
              <div key={target} className="flex items-center gap-2.5">
                {p ? (
                  <AvatarBadge avatarKey={p.avatar_key} size={28} />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-ink/70 text-xs text-mute">
                    —
                  </span>
                )}
                <span className="text-sm text-chalk">{p?.nickname ?? 'Abstained'}</span>
                <span className="flex-1" />
                <span className="flex -space-x-1.5">
                  {voters.map((vid) => {
                    const voter = view.players.find((x) => x.player_id === vid);
                    return <AvatarBadge key={vid} avatarKey={voter?.avatar_key ?? 'fox'} size={22} />;
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Spacer />
      <div className="text-center">
        <Countdown size="sm" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Day
// ---------------------------------------------------------------

export function DayDiscussScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const alive = view.me.is_alive;
  const [asked, setAsked] = useState(false);
  useEffect(() => setAsked(false), [view.day_number]);

  return (
    <div className="flex flex-1 flex-col">
      <p className="label text-center">Day {view.day_number} · talk it out</p>

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Countdown size="xl" warnAt={30} />
        <p className="subtitle max-w-[16rem] text-center">
          The game is happening in the room, not on the screen.
        </p>
      </div>

      <div className="mb-5">
        <PhaseProgress total={view.settings.night_village.discussion_seconds} />
      </div>

      {alive && (
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            setAsked((v) => !v);
            void submit('skip_discussion');
          }}
        >
          {asked ? 'Keep talking' : 'Skip to the vote'}
          <span className="pill ml-1">
            {pub.skip_votes}/{pub.skip_needed}
          </span>
        </button>
      )}
    </div>
  );
}

export function DayVoteScreen({ view, submit, busy }: PhaseProps) {
  const pub = view.public as any;
  const [picked, setPicked] = useState<string | null>(null);
  const alive = view.me.is_alive;
  const iVoted = view.players.find((p) => p.player_id === view.me.player_id)?.has_acted;

  if (!alive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <p className="pill">You are out</p>
        <p className="font-display text-2xl text-mute">The village is voting</p>
        <p className="text-sm text-mute">
          {pub.votes_cast} of {pub.votes_needed} have voted
        </p>
        <Countdown />
      </div>
    );
  }

  const living = view.players.filter((p) => p.is_alive && !p.has_left);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="label mb-0.5">Who leaves the village?</p>
          <p className="text-sm text-mute">
            {pub.votes_cast} of {pub.votes_needed} voted
          </p>
        </div>
        <Countdown />
      </div>

      <PlayerGrid
        players={living}
        selectedId={picked}
        onSelect={iVoted ? undefined : setPicked}
        showActed
      />

      <Spacer />

      {iVoted ? (
        <p className="rounded-2xl border border-edge bg-ash/50 p-4 text-center text-sm text-mute">
          Vote locked in.
        </p>
      ) : (
        <div className="space-y-2">
          <button
            className="btn-primary"
            disabled={!picked || busy}
            onClick={() => picked && submit('day_vote', { target_id: picked })}
          >
            Vote them out
          </button>
          <button
            className="btn-quiet"
            disabled={busy}
            onClick={() => submit('day_vote', { target_id: null })}
          >
            Abstain
          </button>
        </div>
      )}
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
  const { lines } = useNarration(view);

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

  const villageWon = result.winner === 'village';
  const eliminations = (result.eliminations ?? []) as any[];

  return (
    <div className="flex flex-1 flex-col">
      <div
        className={`rounded-3xl border p-6 text-center ${
          villageWon ? 'border-moss/40 bg-moss/10' : 'border-blood/40 bg-blood/10'
        }`}
      >
        <p className="label mb-1">{villageWon ? 'The village wins' : 'The wolves win'}</p>
        <NarrationText lines={lines} />
      </div>

      <div className="card mt-4">
        <p className="label">Everyone</p>
        <div className="grid grid-cols-2 gap-2.5">
          {view.players.map((p) => (
            <div
              key={p.player_id}
              className={`flex items-center gap-2.5 rounded-2xl border p-2.5 ${
                p.role === 'wolf' ? 'border-blood/40 bg-blood/5' : 'border-edge/70'
              }`}
            >
              <AvatarBadge avatarKey={p.avatar_key} size={34} dimmed={!p.is_alive} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-chalk">{p.nickname}</p>
                <p className="text-[0.68rem] text-mute">{roleWord(p.role ?? '')}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {eliminations.length > 0 && (
        <div className="card mt-3">
          <p className="label">How it went</p>
          <ol className="space-y-2">
            {eliminations.map((e, i) => {
              const p = view.players.find((x) => x.player_id === e.player_id);
              return (
                <li key={i} className="flex items-center gap-2.5 text-sm">
                  <span className="w-14 shrink-0 text-xs text-mute">
                    {e.cause === 'vote' ? `Day ${e.day}` : e.cause === 'left' ? 'Left' : `Night ${e.day}`}
                  </span>
                  <AvatarBadge avatarKey={p?.avatar_key ?? 'fox'} size={24} dimmed />
                  <span className="text-chalk">{p?.nickname}</span>
                  <span className="flex-1" />
                  <span className="text-xs text-mute">{roleWord(e.role)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <Spacer />
      <button className="btn-primary mt-5" onClick={() => navigate(`/g/${code}`)}>
        Back to the lobby
      </button>
    </div>
  );
}

function roleWord(role: string): string {
  return role === 'wolf'
    ? 'Wolf'
    : role === 'seer'
      ? 'Seer'
      : role === 'doctor'
        ? 'Doctor'
        : 'Villager';
}
