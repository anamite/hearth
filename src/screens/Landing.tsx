import { Link } from 'react-router-dom';
import { Screen, Spacer, Sticker } from '@/components/ui';
import { Blob, GameCharacter, HearthMark, Squiggle } from '@/components/art';
import { GAMES } from '@/games/manifest';
import { gameTheme } from '@/lib/theme';
import { IS_MOCK } from '@/backend';

export function LandingScreen() {
  return (
    <Screen className="overflow-hidden">
      {/* Background shapes. Decorative only. */}
      <Blob className="pointer-events-none absolute -left-24 -top-16 h-64 w-64 animate-float-slow blur-2xl" opacity={0.22} />
      <Blob className="pointer-events-none absolute -right-28 top-40 h-56 w-56 animate-float blur-2xl" opacity={0.14} />

      <div className="relative flex flex-1 flex-col justify-center py-8">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 rotate-[-6deg] items-center justify-center rounded-2xl border-2 border-black/40 bg-slatey shadow-pop">
            <HearthMark size={30} />
          </span>
          <Sticker tone="accent2" tilt={3}>Same room · no accounts</Sticker>
        </div>

        <h1 className="title mt-6 text-[3.4rem] leading-[0.9]">
          Hearth
        </h1>
        <Squiggle className="-mt-1 h-3 w-32" />

        <p className="subtitle mt-4 max-w-[20rem] text-[0.95rem]">
          Party games for people already in the same room. Your phone holds the
          secrets. Everything else happens out loud.
        </p>

        <div className="mt-8 space-y-3">
          {GAMES.map((g, i) => {
            const t = gameTheme(g.id);
            return (
              <div
                key={g.id}
                data-game={g.id}
                className="animate-rise relative flex items-center gap-3.5 overflow-hidden rounded-[1.4rem]
                           border-2 border-edge/80 bg-ash/70 p-3.5"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
                  style={{ background: t.accent }}
                />
                <span className="flex h-12 w-12 shrink-0 items-center justify-center">
                  <GameCharacter game={g.id} size={44} className="animate-float" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[1.05rem] font-extrabold text-chalk">{g.name}</p>
                  <p className="truncate text-xs text-mute">
                    {g.minPlayers}–{g.maxPlayers} players · {g.estimatedMinutes} min
                  </p>
                </div>
                <span className="pill-accent shrink-0">{t.flavour}</span>
              </div>
            );
          })}
        </div>
      </div>

      <Spacer />

      <div className="relative space-y-2.5">
        <Link to="/create" className="btn-primary">
          Start a group
        </Link>
        <Link to="/join" className="btn-ghost">
          Join a group
        </Link>
      </div>

      <p className="relative mt-5 text-center text-xs leading-relaxed text-mute/70">
        No accounts. No email. No app store.
        {IS_MOCK && (
          <>
            <br />
            <span className="font-semibold text-accent/90">
              Local mode — open a new tab to add another player.
            </span>
          </>
        )}
      </p>
    </Screen>
  );
}
