import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { GameType } from '@/types';
import { HearthError } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { GAMES } from '@/games/manifest';
import { AvatarBadge } from '@/components/Avatar';
import { CodeDisplay, ErrorNote, Loading, Screen, Spacer, TopBar } from '@/components/ui';

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
        title={lobby.group.display_name}
        subtitle={`${present.length} ${present.length === 1 ? 'player' : 'players'} here`}
        right={
          <Link
            to={`/g/${code}/history`}
            className="rounded-xl border border-edge px-3 py-2 text-xs font-semibold text-mute"
          >
            History
          </Link>
        }
      />

      <CodeDisplay code={lobby.group.code} onCopy={copyLink} />
      <p className="mt-2 text-center text-xs text-mute">
        {copied ? 'Link copied' : 'Tap to copy the join link · say the PIN out loud'}
      </p>

      {/* Players */}
      <div className="mt-6 flex flex-wrap gap-2">
        {present.map((p) => (
          <div
            key={p.player_id}
            className={`flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 ${
              p.is_ready ? 'border-moss/40 bg-moss/5' : 'border-edge/70 bg-ash/50'
            }`}
          >
            <AvatarBadge avatarKey={p.avatar_key} size={32} />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-chalk">
                {p.nickname}
                {p.player_id === me.player_id && <span className="text-mute"> · you</span>}
              </p>
              <p className="text-[0.65rem] text-mute">
                {p.is_host ? 'host' : p.is_ready ? 'ready' : 'not ready'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Games */}
      <p className="label mt-8">Pick a game</p>
      <div className="space-y-2.5">
        {GAMES.map((g) => {
          const tooFew = present.length < g.minPlayers;
          const tooMany = present.length > g.maxPlayers;
          const blocked = tooFew || tooMany;
          return (
            <button
              key={g.id}
              disabled={blocked || !me.is_host || busy}
              onClick={() => start(g.id)}
              className={`w-full rounded-2xl border p-4 text-left transition
                ${blocked ? 'border-edge/50 bg-ash/30 opacity-50' : 'border-edge bg-ash/60 active:scale-[0.99]'}
                ${!me.is_host ? 'cursor-default' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-xl text-chalk">{g.name}</span>
                <span className="shrink-0 text-xs text-mute">
                  {g.minPlayers}–{g.maxPlayers} · {g.estimatedMinutes}m
                </span>
              </div>
              <p className="mt-1 text-sm text-mute">{g.tagline}</p>
              {g.headline && !blocked && (
                <p className="mt-1.5 text-xs font-semibold text-ember">{g.headline}</p>
              )}
              {tooFew && (
                <p className="mt-1.5 text-xs text-blood">Needs {g.minPlayers}+</p>
              )}
              {tooMany && (
                <p className="mt-1.5 text-xs text-blood">Too many — max {g.maxPlayers}</p>
              )}
              {!blocked && g.bestWith && present.length < g.bestWith && (
                <p className="mt-1.5 text-xs text-mute">Best with {g.bestWith}+</p>
              )}
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
