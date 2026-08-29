import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { GameType } from '@/types';
import { HearthError } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { GAMES } from '@/games/manifest';
import { gameTheme } from '@/lib/theme';
import { GameCharacter } from '@/components/art';
import { AvatarBadge } from '@/components/Avatar';
import {
  CodeDisplay, ErrorNote, Loading, Screen, Spacer, Sticker, TopBar,
} from '@/components/ui';

export function LobbyScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { lobby, status } = useLobby(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A round is live — everyone follows it in.
  useEffect(() => {
    if (lobby?.active_round) navigate(`/g/${code}/play`, { replace: true });
  }, [lobby?.active_round, code, navigate]);

  if (status === 'not_a_member') return <Navigate to={`/join?code=${code}`} replace />;
  if (status === 'missing') {
    return (
      <Screen>
        <TopBar title="No such group" onBack={() => navigate('/')} />
        <p className="subtitle">That code doesn’t match a group. It may have expired.</p>
        <Spacer />
        <Link to="/" className="btn-primary">
          Back to the start
        </Link>
      </Screen>
    );
  }
  if (!lobby) return <Screen><Loading label="Finding your group…" /></Screen>;

  const present = lobby.players.filter((p) => !p.has_left);
  const me = lobby.me;
  const everyoneReady = present.every((p) => p.is_ready);

  async function copyLink() {
    const url = `${location.origin}/g/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Couldn’t copy — read the code out instead.');
    }
  }

  async function start(gameType: GameType) {
    setBusy(true);
    setError(null);
    try {
      await getBackend().startRound(lobby!.group.id, gameType);
      navigate(`/g/${code}/play`);
    } catch (err) {
      const code_ = err instanceof HearthError ? err.code : 'network';
      setError(
        code_ === 'too_few_players'
          ? 'Not enough players for that one yet.'
          : code_ === 'not_host'
            ? 'Only the host can start a game.'
            : 'Couldn’t start the round.',
      );
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar
        eyebrow="Lobby"
        title={lobby.group.display_name}
        subtitle={`${present.length} ${present.length === 1 ? 'player' : 'players'} here`}
        right={
          <Link
            to={`/g/${code}/history`}
            className="mt-1 shrink-0 rounded-2xl border-2 border-edge bg-slatey/70 px-3 py-2
                       text-[0.7rem] font-extrabold uppercase tracking-wider text-mute
                       shadow-pop-sm transition-all duration-100 active:translate-y-[3px] active:shadow-none"
          >
            History
          </Link>
        }
      />

      <CodeDisplay code={lobby.group.code} onCopy={copyLink} />
      <p className="mt-2.5 text-center text-xs font-semibold text-mute">
        {copied ? '✓ Link copied' : 'Tap to copy the join link · say the PIN out loud'}
      </p>

      {/* Players */}
      <div className="mt-6 flex flex-wrap gap-2">
        {present.map((p, i) => (
          <div
            key={p.player_id}
            className={`flex animate-pop-in items-center gap-2 rounded-2xl border-2 py-1.5 pl-1.5 pr-3
              shadow-pop-sm ${
                p.is_ready ? 'border-moss/60 bg-moss/10' : 'border-edge/80 bg-slatey/60'
              }`}
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <AvatarBadge avatarKey={p.avatar_key} size={34} />
            <div className="leading-tight">
              <p className="text-sm font-bold text-chalk">
                {p.nickname}
                {p.player_id === me.player_id && <span className="text-mute"> · you</span>}
              </p>
              <p
                className={`text-[0.62rem] font-extrabold uppercase tracking-wider ${
                  p.is_host ? 'text-gold' : p.is_ready ? 'text-moss' : 'text-mute'
                }`}
              >
                {p.is_host ? '★ host' : p.is_ready ? 'ready' : 'not ready'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Games */}
      <div className="mt-8 flex items-center gap-2">
        <p className="label mb-0">Pick a game</p>
        <span className="h-0.5 flex-1 rounded-full bg-edge/70" />
      </div>

      <div className="mt-3 space-y-3">
        {GAMES.map((g) => {
          const tooFew = present.length < g.minPlayers;
          const tooMany = present.length > g.maxPlayers;
          const blocked = tooFew || tooMany;
          const t = gameTheme(g.id);
          return (
            <button
              key={g.id}
              data-game={g.id}
              disabled={blocked || !me.is_host || busy}
              onClick={() => start(g.id)}
              className={`relative w-full overflow-hidden rounded-[1.5rem] border-2 p-4 pl-[4.6rem] text-left
                transition-all duration-100
                ${
                  blocked
                    ? 'border-edge/50 bg-ash/40 opacity-45'
                    : 'border-accent/40 bg-ash/75 shadow-pop active:translate-y-[3px] active:shadow-pop-sm'
                }
                ${!me.is_host ? 'cursor-default' : ''}`}
            >
              {/* Mascot sits in a tinted gutter down the left edge. */}
              <span
                className="pointer-events-none absolute inset-y-0 left-0 flex w-[3.9rem] items-center justify-center"
                style={{ background: `linear-gradient(180deg, ${t.accent}26, ${t.accent}0d)` }}
              >
                <GameCharacter game={g.id} size={40} />
              </span>

              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-[1.35rem] font-extrabold leading-tight text-chalk">
                  {g.name}
                </span>
                <span className="shrink-0 text-[0.7rem] font-bold text-mute">
                  {g.minPlayers}–{g.maxPlayers} · {g.estimatedMinutes}m
                </span>
              </div>
              <p className="mt-1 text-[0.82rem] leading-snug text-mute">{g.tagline}</p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {g.headline && !blocked && <span className="pill-accent">{g.headline}</span>}
                {tooFew && <Sticker tone="blood" tilt={-1.5}>Needs {g.minPlayers}+</Sticker>}
                {tooMany && <Sticker tone="blood" tilt={-1.5}>Max {g.maxPlayers}</Sticker>}
                {!blocked && g.bestWith && present.length < g.bestWith && (
                  <span className="pill">Best with {g.bestWith}+</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <div className="mt-6 space-y-2.5">
        {!me.is_host && (
          <button
            className={me.is_ready ? 'btn-ghost' : 'btn-primary'}
            onClick={() => getBackend().setReady(lobby.group.id, !me.is_ready)}
          >
            {me.is_ready ? 'I’m not ready' : 'I’m ready'}
          </button>
        )}
        {me.is_host && !everyoneReady && (
          <p className="text-center text-xs text-mute">
            Waiting on {present.filter((p) => !p.is_ready).map((p) => p.nickname).join(', ')}
            {' '}— you can start anyway.
          </p>
        )}
        <div className="flex gap-2.5">
          {me.is_host && (
            <Link to={`/g/${code}/settings`} className="btn-ghost">
              Settings
            </Link>
          )}
          <button
            className="btn-quiet"
            onClick={async () => {
              await getBackend().leaveGroup(lobby.group.id);
              navigate('/');
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </Screen>
  );
}
