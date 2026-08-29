import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { GameType, HistoryEntry, PlayerStats } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { GAMES, gameModule } from '@/games/manifest';
import { AvatarBadge } from '@/components/Avatar';
import { Loading, Screen, TopBar } from '@/components/ui';

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

/** Spec §20.2 — different games want different columns. */
function StatsTable({ gameType, rows }: { gameType: GameType; rows: PlayerStats[] }) {
  if (rows.length === 0) return null;

  const columns: { head: string; get: (r: PlayerStats) => string; emphasise?: boolean }[] =
    gameType === 'fake_artist'
      ? [
          { head: 'Played', get: (r) => String(r.games_played) },
          { head: 'Impostor', get: (r) => String(r.times_hidden) },
          {
            head: 'Impostor win',
            get: (r) => pct(r.times_hidden - r.times_caught, r.times_hidden),
            emphasise: true,
          },
          { head: 'Caught', get: (r) => String(r.times_caught) },
        ]
      : gameType === 'night_village'
        ? [
            { head: 'Played', get: (r) => String(r.games_played) },
            { head: 'Wolf', get: (r) => String(r.times_hidden) },
            { head: 'Win rate', get: (r) => pct(r.games_won, r.games_played), emphasise: true },
            { head: 'Survived', get: (r) => pct(r.points, r.games_played) },
          ]
        : [
            { head: 'Played', get: (r) => String(r.games_played) },
            { head: 'Points', get: (r) => String(r.points), emphasise: true },
            {
              head: 'Avg',
              get: (r) => (r.games_played ? (r.points / r.games_played).toFixed(1) : '—'),
            },
          ];

  const sorted = [...rows].sort((a, b) => b.games_played - a.games_played);

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[19rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-[0.65rem] uppercase tracking-wider text-mute">
            <th className="pb-2 pl-1 font-semibold">Player</th>
            {columns.map((c) => (
              <th key={c.head} className="pb-2 text-right font-semibold">
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.player_id} className="border-t border-edge/50">
              <td className="py-2 pl-1">
                <span className="flex items-center gap-2">
                  <AvatarBadge avatarKey={r.avatar_key} size={26} />
                  <span className="text-chalk">{r.nickname}</span>
                </span>
              </td>
              {columns.map((c) => (
                <td
                  key={c.head}
                  className={`py-2 text-right tabular-nums ${
                    c.emphasise ? 'font-bold text-ember' : 'text-mute'
                  }`}
                >
                  {c.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryScreen() {
  const { code = '' } = useParams();
  const { lobby, status } = useLobby(code);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [tab, setTab] = useState<'games' | 'stats'>('games');

  useEffect(() => {
    const id = lobby?.group.id;
    if (!id) return;
    void (async () => {
      const [h, s] = await Promise.all([
        getBackend().getHistory(id, 50),
        getBackend().getStats(id),
      ]);
      setHistory(h);
      setStats(s);
    })();
  }, [lobby?.group.id]);

  if (status === 'not_a_member') return <Navigate to={`/join?code=${code}`} replace />;
  if (!lobby || !history) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <TopBar title="History" subtitle={lobby.group.display_name} onBack="history" />

      <div className="mb-5 flex gap-1 rounded-2xl border border-edge bg-ash/50 p-1">
        {(['games', 'stats'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold capitalize transition ${
              tab === t ? 'bg-ember text-ink' : 'text-mute'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'games' ? (
        history.length === 0 ? (
          <p className="subtitle">No games yet. Go and play one.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => {
              const g = gameModule(h.game_type);
              return (
                <li
                  key={h.id}
                  className="flex items-baseline justify-between gap-3 rounded-2xl border border-edge/70 bg-ash/50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-chalk">{g?.name ?? h.game_type}</p>
                    <p className="truncate text-xs text-mute">
                      {g?.summarise(h.result) ?? ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-mute">{when(h.ended_at)}</span>
                </li>
              );
            })}
          </ul>
        )
      ) : stats.length === 0 ? (
        <p className="subtitle">No stats yet.</p>
      ) : (
        <div className="space-y-5">
          {GAMES.map((g) => {
            const rows = stats.filter((s) => s.game_type === g.id);
            if (rows.length === 0) return null;
            return (
              <section key={g.id} className="card">
                <p className="label">{g.name}</p>
                <StatsTable gameType={g.id} rows={rows} />
              </section>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
