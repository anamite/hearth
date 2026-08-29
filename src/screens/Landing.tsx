import { Link } from 'react-router-dom';
import { Screen, Spacer } from '@/components/ui';
import { GAMES } from '@/games/manifest';
import { IS_MOCK } from '@/backend';

function Flame() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 4c1.5 7-4 9.5-7.5 14C13 22.5 12 26 12 29a12 12 0 0 0 24 0c0-4-1.5-7-4-10.5-.8 2.5-2.2 3.8-3.6 4.2 1.1-5.6-.6-13-4.4-18.7Z"
        fill="#E8743B"
      />
      <path
        d="M24 20c1 3.5-1.5 5-3 7.5-1 1.6-1.5 3-1.5 4.5a4.5 4.5 0 0 0 9 0c0-2-1-4-2.5-6-.4 1.2-1 1.8-1.7 2 .5-2.6-.3-5.6-1.3-8Z"
        fill="#F5D08A"
      />
    </svg>
  );
}

export function LandingScreen() {
  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center py-10">
        <Flame />
        <h1 className="title mt-5 text-[2.8rem]">Hearth</h1>
        <p className="subtitle mt-3 max-w-[19rem] text-base">
          Party games for people already in the same room. Your phone holds the
          secrets. Everything else happens out loud.
        </p>

        <div className="mt-9 space-y-2.5">
          {GAMES.map((g) => (
            <div key={g.id} className="flex items-baseline gap-3">
              <span className="w-1.5 shrink-0 self-center">
                <span className="block h-1.5 w-1.5 rounded-full bg-ember/70" />
              </span>
              <div>
                <p className="text-sm font-semibold text-chalk">{g.name}</p>
                <p className="text-xs text-mute">
                  {g.minPlayers}–{g.maxPlayers} players · {g.estimatedMinutes} min
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Spacer />

      <div className="space-y-2.5">
        <Link to="/create" className="btn-primary">
          Start a group
        </Link>
        <Link to="/join" className="btn-ghost">
          Join a group
        </Link>
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-mute/70">
        No accounts. No email. No app store.
        {IS_MOCK && (
          <>
            <br />
            <span className="text-ember/80">
              Local mode — open a new tab to add another player.
            </span>
          </>
        )}
      </p>
    </Screen>
  );
}
