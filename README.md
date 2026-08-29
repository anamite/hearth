# Hearth

Party games for people already in the same room. The phone holds the secrets;
everything else happens out loud.

Three games ship: **Fake Artist** (4–10), **Night Village** (6–12), **Dial** (3–10).

Built to `hearth-spec.md` v1.0.

---

## Run it right now

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. **Each browser tab is a separate player** — open
five tabs and you have a five-player game on one laptop. Create a group in the
first tab, then join from the others with the code and PIN.

No server, no Supabase, no accounts. The local backend keeps everything in
`localStorage` and syncs tabs over `BroadcastChannel`.

A small `local · xxxx` badge sits bottom-left: it shows which player this tab
is, lets you become a new one, and wipes local data.

## Checks

```bash
npm run check
```

Runs the type checker, the 69 game-logic tests, the Postgres grammar check on
every migration, and the cross-migration reference check.

---

## Where things are

```
content/                 222 Fake Artist words, 101 Dial spectrum pairs (JSON)
public/audio/            manifest.json + SCRIPTS.md (the 77 clips to record)
scripts/                 seed generation, SQL validation

src/
  types.ts               the shared contract every layer speaks
  backend/
    types.ts             the Backend interface — one method per RPC in §7
    index.ts             picks mock or Supabase from VITE_BACKEND
    supabase.ts          thin .rpc() wrapper; no game logic
    mock/
      db.ts              localStorage tables, mirroring the SQL schema
      engine.ts          phase engine, get_my_view, the ServerGame interface
      games/*.ts         the three games, server-side
      __tests__/         69 tests incl. the secrecy invariant
  games/
    manifest.ts          the only file that knows which games exist
    {game}/index.ts      module definition: settings schema + phase components
    {game}/screens.tsx   one component per phase
  screens/               landing, create, join, lobby, settings, play, history
  components/            avatars, hold-to-reveal, countdown, player grid
  store/round.ts         the poll loop and the round view

supabase/
  migrations/            8 files: schema, RLS, core RPCs, three games, grants
  functions/             verify-turnstile edge function
  seed.sql               GENERATED — run `npm run seed:sql`
```

### Adding a fourth game

Per spec §10.1 this must touch only:

1. five new `{game}_*` functions in a new migration
2. one branch in each dispatcher in `0003_core.sql`
3. a new `src/backend/mock/games/{game}.ts` and `src/games/{game}/`
4. one line in `src/games/manifest.ts`

Dial was built third specifically to prove that boundary holds. It does.

---

## The invariant everything rests on

> A client must never receive information the player isn't entitled to see,
> not even in a field it doesn't render.

Enforced in three places:

- **RLS denies all SELECT** on `rounds`, `round_players` and `actions`
  (`supabase/migrations/0002_rls.sql`). Those tables hold the word, the
  impostor, the wolf list, the seer's results and the dial target.
- **One read path**: `get_my_view(round_id)` merges public round state with
  only the caller's private data. Nothing else reads round state.
- **Realtime payloads are content-free**: `phase_changed` carries a phase name,
  `player_acted` carries a player id. Never what. A broadcast bug cannot leak.

Verified by `src/backend/mock/__tests__/fakeArtist.test.ts` — 40 randomised
rounds asserting the impostor's payload contains no `word`, `aliases` or
`description` key, plus a fixed-word round checking every phase — and by hand
in the browser (see below).

### Checking it yourself

In local mode every device's received payload is exposed as
`window.__hearthView`. On the impostor's tab, during any phase before the
result:

```js
JSON.stringify(window.__hearthView).toLowerCase().includes('yourword')
// false
```

That object is exactly what the network delivered — nothing more.

---

## Switching to Supabase

See **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)**. Short version: create the
project, push the migrations, seed the content, deploy one edge function, and
change `VITE_BACKEND=mock` to `supabase` in `.env.local`. No application code
changes.

---

## Known gaps

- **Narration audio is not recorded.** The pipeline, manifest and on-screen
  text fallback are complete; the 77 MP3s are not. Scripts and file paths are
  in `public/audio/SCRIPTS.md`. The game is fully playable silent, which the
  spec requires anyway (§14.6).
- **The PL/pgSQL bodies have never run.** They parse, and every function
  reference resolves, but no Postgres has executed them. Budget an hour of
  debugging on first push.
- **"Fake Artist" is a placeholder name.** Spec §23 recommends replacing it
  before any public launch; *One Line Lie* is the suggested alternative.
