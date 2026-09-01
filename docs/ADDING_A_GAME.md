# Adding a game to Hearth

Everything you need to ship another game without breaking the six that
already work. Read the whole thing once before you write any code — most of
the mistakes available to you are structural, and cheap to avoid up front.

**Short answer to "how hard is it?"** — about a day for a simple game. The
architecture was built for this: nine games ship, and Grid, Bid, Nerve, Fold,
Season and Envelope were each added afterwards by following this document. Nothing in the router, the
store, the poll loop, the Supabase client, the lobby or the RLS policies needs
to know your game exists.

There are **24 files/edits** in the complete list below. Nine are your own new
files. Four are one-liners in registries. TypeScript forces six of them. The
rest are the ones people forget — those are marked ⚠️.

---

## Table of contents

1. [The mental model](#1-the-mental-model)
2. [The complete touch list](#2-the-complete-touch-list)
3. [Step 1 — the shared contract](#3-step-1--the-shared-contract-srctypests)
4. [Step 2 — the server module](#4-step-2--the-server-module)
5. [Step 3 — content](#5-step-3--content-only-if-you-need-a-word-bank)
6. [Step 4 — tests](#6-step-4--tests)
7. [Step 5 — the frontend module](#7-step-5--the-frontend-module)
8. [Step 6 — the visual identity](#8-step-6--the-visual-identity)
9. [Step 7 — the SQL port](#9-step-7--the-sql-port)
10. [The frontend design language](#10-the-frontend-design-language)
11. [Backend surface reference](#11-backend-surface-reference)
12. [Pitfalls — read this one twice](#12-pitfalls--read-this-one-twice)
13. [Player counts: supporting any number](#13-player-counts-supporting-any-number)
14. [Definition of done](#14-definition-of-done)

---

## 1. The mental model

Hearth is a **server-authoritative phase machine**. A game is not a loop; it is
a set of named phases plus a function that decides what happens when one ends.

```
        ┌──────────────────────────────────────────────┐
        │  every 2s, every device: advance_if_due()    │
        └──────────────────────────────────────────────┘
                             │
                  isDue(round)?  ── no ──▶ just return the view
                             │ yes
                             ▼
                   game.advance(ctx)          ← YOUR CODE
                             │
                    ctx.setPhase(...)  or  ctx.endRound(...)
                             │
                             ▼
                  buildView(ctx, viewer)      ← engine
                             │
             ┌───────────────┴────────────────┐
             │                                │
      game.publicView(ctx)          game.privateView(ctx, rp)
      (safe for everyone)           (this one player only)
```

Four rules follow from that picture, and everything else in this document is
detail:

1. **The client never decides anything.** Not whose turn it is, not whether a
   timer expired, not who won. It renders `view` and calls `submit()`.
2. **`rounds.state` is secret.** It is never sent anywhere. The only things
   that reach a device are what your `publicView` and `privateView` return.
3. **A phase is due** when its clock expires, *or* when it was entered with a
   `pendingOn` list and everyone on that list has acted. `advance()` is then
   called, and it must move the round somewhere new.
4. **Two implementations, one spec.** The TypeScript module in
   `src/backend/mock/` and the PL/pgSQL functions in `supabase/migrations/`
   are the same game written twice. The mock is what the tests cover and what
   `npm run dev` runs; the SQL is what production runs.

### Which layer knows what

| Layer | Knows about your game? | Why |
|---|---|---|
| `src/store/round.ts` (poll loop) | no | speaks `RoundView` only |
| `src/screens/Play.tsx` (router) | no | looks your phase up in the manifest |
| `src/backend/supabase.ts` | no | thin `.rpc()` wrapper, zero game logic |
| `src/backend/mock/engine.ts` | no | calls the `ServerGame` interface |
| RLS policies (`0002_rls.sql`) | no | deny-all on `rounds`/`round_players`/`actions` |
| Lobby, Settings, History screens | via the manifest | read `GameModule` fields |

If you find yourself editing any of the "no" rows, stop — you are solving the
problem in the wrong place.

---

## 2. The complete touch list

Using `charades` as the example id. ⚠️ marks the ones nothing will catch for
you.

### New files you write (up to 6)

| File | What it is |
|---|---|
| `src/backend/mock/games/charades.ts` | the game, server-side |
| `src/backend/mock/__tests__/charades.test.ts` | its tests |
| `src/games/charades/index.ts` | the `GameModule` |
| `src/games/charades/screens.tsx` | one component per phase |
| `supabase/migrations/00NN_game_charades.sql` | the SQL port |
| `content/charades.json` | *only if* the game needs a content bank |

### Edits (15)

| # | File | Change | Caught by |
|---|---|---|---|
| 1 | `src/types.ts` | add `'charades'` to `GameType` | tsc (everywhere) |
| 2 | `src/types.ts` | `CharadesSettings` interface | — |
| 3 | `src/types.ts` | `GroupSettings.charades` | tsc |
| 4 | `src/types.ts` | `DEFAULT_SETTINGS.charades` | tsc |
| 5 | `src/backend/mock/index.ts` | import + `registerGame(charadesServer)` | runtime crash |
| 6 | `src/backend/mock/index.ts` ⚠️ | deep-merge branch in `updateGroupSettings` | nothing |
| 7 | `src/backend/mock/__tests__/harness.ts` | `registerGame` + settings merge | test failure |
| 8 | `src/games/manifest.ts` | one line in `GAMES` | — |
| 9 | `src/lib/theme.ts` | `GAME_THEMES.charades` | tsc |
| 10 | `src/components/art.tsx` | `MASCOTS.charades` | tsc |
| 11 | `src/index.css` ⚠️ | `[data-game='charades']` accent block | nothing (falls back to app orange) |
| 12 | `src/screens/History.tsx` ⚠️ | stats columns for your game | nothing (silently uses Dial's) |
| 13 | `supabase/migrations/0003_core.sql` | 11 dispatcher branches | `npm run check:sql` |
| 14 | `scripts/check-sql-refs.mjs` ⚠️ | `OURS` regex + `GAMES` array | nothing (your SQL stops being validated) |
| 15 | `scripts/generate-seed-sql.mjs` | content rows — *only if* you added content | — |

`src/backend/supabase.ts`, `src/screens/Play.tsx`, `src/store/round.ts`,
`src/lib/useLobby.ts`, `src/screens/Lobby.tsx`, `src/screens/Settings.tsx` and
every RLS policy stay untouched. If your change needs them, rethink it.

---

## 3. Step 1 — the shared contract (`src/types.ts`)

Start here. Adding the id first makes the compiler walk you through six of the
edits above.

```ts
export type GameType = 'fake_artist' | 'night_village' | 'dial' | 'charades';

export interface CharadesSettings {
  round_seconds: number;
  teams: boolean;
  skips_allowed: number;
}

export interface GroupSettings {
  fake_artist: FakeArtistSettings;
  night_village: NightVillageSettings;
  dial: DialSettings;
  charades: CharadesSettings;          // ← add
  audio_speaker_id?: string | null;
}

export const DEFAULT_SETTINGS: GroupSettings = {
  /* … */
  charades: { round_seconds: 90, teams: false, skips_allowed: 2 },
};
```

Now run `npx tsc --noEmit`. Every exhaustive `Record<GameType, …>` in the
codebase lights up: `GAME_THEMES`, `MASCOTS`, `GAMES_BY_ID`. That list is your
to-do list for the registries.

**Settings rules**

- Settings are **snapshotted into the round** at `start_round`. Changing them
  mid-round is impossible by design; a running round keeps the values it began
  with (`rounds.settings`).
- Only the host can change them, and only with no round active.
- Keep them flat, JSON-serialisable, and few. Every field costs a row on the
  Settings screen and a line of explanation at the table.
- ⚠️ **Groups created before your game existed have no `charades` key.** In
  the mock a group lives in `localStorage`; in production it lives for 100
  days. `ctx.settings.charades.round_seconds` throws on those. See
  [Pitfall 8](#pitfall-8-legacy-groups-have-no-settings-for-your-game).

---

## 4. Step 2 — the server module

`src/backend/mock/games/charades.ts` exports one object satisfying
`ServerGame` (`src/backend/mock/engine.ts`). Twelve members:

```ts
export const charadesServer: ServerGame = {
  id: 'charades',
  minPlayers: 4,
  maxPlayers: 12,

  setup(ctx)                       { /* deal roles, enter the first phase */ },
  publicView(ctx)                  { /* safe for every device, per phase   */ },
  privateView(ctx, rp)             { /* this player's secrets only         */ },
  roleVisibleTo(ctx, viewer, subj) { /* may viewer see subj's role now?    */ },
  hasActed(ctx, rp)                { /* drives players[].has_acted         */ },
  action(ctx, rp, kind, payload)   { /* validate + apply one action        */ },
  advance(ctx)                     { /* the phase ended — go somewhere new */ },
  onPlayerLeft(ctx, playerId)      { /* §19.3 — never stall                */ },
  applyStats(ctx, result)          { /* write player_stats                 */ },
};
```

### `setup(ctx)`

Runs inside `start_round`, after `round_players` rows exist with
`role: 'unassigned'`. Assign roles, deal secrets, write `ctx.round.state`,
then enter the first phase. It must end with a `setPhase` or `endRound`.

```ts
setup(ctx) {
  const order = shuffle(ctx.present().map((r) => r.player_id));
  for (const rp of ctx.rps) {
    rp.turn_index = order.indexOf(rp.player_id);
    rp.role = 'player';
    rp.private = { prompt: item.payload.text };   // per-player secret
  }
  ctx.round.state = { turn: 0, scores: {} };      // SECRET, never sent
  ctx.setPhase('reveal', { seconds: 180, pendingOn: ctx.present().map(r => r.player_id) });
}
```

### `publicView(ctx)` — the security boundary

Switch on `ctx.round.phase` and return **only** what that phase entitles
everyone to see. This is the single place a leak can happen. The rule from the
README:

> A client must never receive information the player isn't entitled to see,
> not even in a field it doesn't render.

Note how Dial does it — during `guess` the clue is public but the target is
not; during `reveal` both are:

```ts
case 'guess':  return { ...base, clue, target: null, guess: null };
case 'reveal': return { ...base, clue, target: s.target, guess: s.guess };
```

Do not return `ctx.round.state` and trust the UI to ignore fields. The UI is
not the boundary; this function is.

### `privateView(ctx, rp)`

Usually `return rp.private ?? {}`. Keep the *absence* of a secret meaningful —
Fake Artist gives the impostor `private: {}` rather than `{ word: null }`, so
there is literally nothing to strip and nothing to accidentally serialise.

### `hasActed(ctx, rp)`

Per phase, has this player done what is being asked? It drives
`players[].has_acted` in the view, which the UI renders as "4 of 6 ready" and
as the ticks on `PlayerGrid`/`PlayerRow`. Return `true` for players the phase
doesn't ask anything of, or the count reads wrong.

### `action(ctx, rp, kind, payload)`

Validate hard, then apply. Everything is hostile input.

```ts
action(ctx, rp, kind, payload) {
  if (ctx.round.phase === 'perform' && kind === 'scored') {
    if (rp.player_id !== currentPerformer(ctx)?.player_id)
      throw new HearthError('not_your_turn');
    const n = Math.max(0, Math.min(20, Number(payload.count) || 0));  // clamp
    ctx.putAction(rp.player_id, `scored:${ctx.round.state.turn}`, { n });
    ctx.clearPending(rp.player_id);
    return;
  }
  throw new HearthError('wrong_phase');   // the mandatory last line
}
```

- Check the phase **and** the kind. Fall through to `wrong_phase`.
- Clamp and coerce every number; validate every `target_id` through
  `ctx.rp(id)` and check `is_alive`.
- `ctx.putAction` replaces a prior action of the same kind — idempotent by
  construction, which is what makes a double-tap or a retried request safe.
- Finish with `ctx.clearPending(rp.player_id)` when the player is done, or the
  phase will never end early.

### `advance(ctx)`

The phase is over — timer expired, or everyone acted. Apply the timeout
default (spec §19.2: *a phase must never stall waiting for a player who has
gone*), then move.

**`advance` must always change something.** The engine compares
`phase:day_number:pending_on` before and after; if nothing changed and the
round is still due, it aborts the whole round with `stuck_phase`. That is a
deliberate crash-loud, and you do not want to see it in production.

### `onPlayerLeft(ctx, playerId)`

Someone closed the tab. Options, in rough order of preference:

1. **Skip them** — `ctx.clearPending(playerId)` and let the turn logic route
   around absences (Fake Artist).
2. **Substitute** — hand their job to the next player in turn order (Dial's
   dial-holder).
3. **Forfeit the sub-round** — score it zero and move on (Dial's clue-giver).
4. **Abort** — `ctx.endRound({ aborted: 'reason', reason: 'reason' })` when
   the game cannot continue (Fake Artist losing its impostor, or dropping
   below `minPlayers`).

Always call `ctx.clearPending(playerId)` first, whatever else you do.

### `applyStats(ctx, result)`

```ts
ctx.bumpStats(playerId, 'charades', {
  games_played: 1, games_won: won ? 1 : 0,
  times_hidden: 0, times_caught: 0, points: score,
});
```

⚠️ The stats table has a **fixed five columns** shared by all games:
`games_played, games_won, times_hidden, times_caught, points`. They are
already overloaded — `points` is Dial's shared score and Night Village's
survival count. If your game needs a sixth counter, add a column in a
migration and to `StatsRow`; do not overload `times_caught` further.

Skipped entirely for aborted rounds (`hearth_finalise` checks `result.aborted`).

### Register it

```ts
// src/backend/mock/index.ts  AND  src/backend/mock/__tests__/harness.ts
import { charadesServer } from './games/charades';
registerGame(charadesServer);
```

Both files. The test harness has its own registry bootstrap.

---

## 5. Step 3 — content (only if you need a word bank)

Skip this whole section if your game generates its own material.

1. `content/charades.json` — an array of plain objects. Shape is yours;
   `category` and `difficulty` are conventional:
   ```json
   [{"text":"Riding a horse","category":"actions","difficulty":1}]
   ```
2. `src/backend/mock/db.ts` — map it into `CONTENT` with a stable id prefix:
   ```ts
   ...(charadesContent as any[]).map((p, i) => ({
     id: `ch-${i}`, game_type: 'charades' as GameType,
     payload: { text: p.text }, category: p.category ?? null,
     difficulty: p.difficulty ?? 1, active: true,
   })),
   ```
   ⚠️ Ids are derived from array **index**. Only ever append to the JSON —
   reordering or deleting an entry silently re-points every group's
   "already used" list.
3. `scripts/generate-seed-sql.mjs` — add the same mapping, then
   `npm run seed:sql`. `supabase/seed.sql` is generated; never hand-edit it.
4. Draw items with `ctx.takeContent('charades')`, which handles the
   per-group used-list and the bank reset:
   ```ts
   const taken = ctx.takeContent('charades');
   if (!taken) throw new HearthError('content_exhausted');
   const { item, bankReset } = taken;
   ```
   Carry `bankReset` into your result so the result screen can say "you've
   played every card — starting over", as the other two games do.

---

## 6. Step 4 — tests

`src/backend/mock/__tests__/harness.ts` gives you a `Table`: an in-memory
database, a controllable clock, and one method per thing a player can do.

```ts
const t = new Table(6, { charades: { round_seconds: 90, teams: false, skips_allowed: 2 } });
t.start('charades');

t.act(t.playerIds[0], 'revealed');       // submit an action
t.timeout();                             // jump past the current phase clock
t.tick(30);                              // advance the clock 30s and settle
t.leave(t.playerIds[3]);                 // someone disconnects
t.view(playerId);                        // exactly what that device receives
t.useOnlyContent('ch-3');                // pin the bank for a deterministic word
```

⚠️ Add your settings key to the merge block in the `Table` constructor, or
your tests silently run on `DEFAULT_SETTINGS` and any override is ignored.

**Cover at minimum** — this is the bar the three existing suites meet:

- the **secrecy invariant**, via `viewContains(view, 'secret')` at *every*
  phase, for the player who must not know. Randomise over 20–40 rounds.
- role/turn distribution at **every supported player count**, min to max.
- every **win condition** and every **tie**.
- every **timeout default** — for each phase, let the clock run out and assert
  the round is somewhere sensible.
- a **mid-round departure** in each phase, including whoever the game depends
  on most.
- **stats** after a completed round, and that an aborted round writes none.

Run with `npx vitest run`. 221 tests pass today; yours should join them.

---

## 7. Step 5 — the frontend module

### `src/games/charades/index.ts`

```ts
const charades: GameModule = {
  id: 'charades',
  name: 'Charades',
  tagline: 'One line for the lobby card. Say what it feels like, not the rules.',
  headline: 'Optional pill — e.g. "Everyone is on the same team."',
  minPlayers: 4,          // MUST match the server module and the SQL
  maxPlayers: 12,
  bestWith: 6,            // optional: shows "Best with 6+" when below
  estimatedMinutes: 12,

  settingsSchema: [ /* toggle | number | select fields */ ],

  phaseComponents: {
    reveal: RevealScreen,
    perform: PerformScreen,
    result: ResultScreen,
  },

  summarise(result) {
    if (result.aborted) return 'Abandoned';
    return `${result.score} of ${result.max}`;   // one line, history list
  },
};
```

⚠️ `minPlayers`/`maxPlayers` exist in **three** places — this module, the
`ServerGame`, and `game_min_players`/`game_max_players` in `0003_core.sql`.
Nothing checks that they agree. Disagreement means the lobby card offers a
game the backend then refuses to start.

`phaseComponents` must have a key for **every phase name your server can
enter**. A missing one is not a crash — `Play.tsx` renders a "this phase has
no screen yet" fallback — but it is a dead end for the player.

Then one line in `src/games/manifest.ts`:

```ts
export const GAMES: GameModule[] = [fakeArtist, nightVillage, dial, charades];
```

Order here is the order on the lobby picker.

### `src/games/charades/screens.tsx`

Every phase component receives exactly `PhaseProps` and nothing else:

```ts
interface PhaseProps {
  view: RoundView;      // the whole server view
  me: RoundPlayerView;  // your row, pulled out of view.players
  submit: (kind: string, payload?: Record<string, unknown>) => Promise<void>;
  busy: boolean;        // a submit is in flight — disable the button
  error: string | null; // last action error, already humanised
}
```

Read `view.public` (typed `unknown`; the games cast with
`const pub = view.public as any` — pragmatic, and the server view is the real
contract), `view.me.private`, `view.players`. Call `submit()`. That is the
whole API.

**Do not** call the backend directly, keep a copy of game state in React
state, or compute whose turn it is. The one legitimate exception is the
ephemeral channel for sub-second liveness (live strokes, live dial):
`getBackend().publishEphemeral(roundId, …)` / `subscribeEphemeral`. It is
fire-and-forget, never persisted, and never authoritative.

---

## 8. Step 6 — the visual identity

Four edits give your game its own skin.

**`src/lib/theme.ts`** — the hex pair, for SVG props and canvas ink:
```ts
charades: { accent: '#B9F227', accent2: '#FF7A29', flavour: 'Act' },
```

**`src/index.css`** ⚠️ — the same colours as RGB triplets. This is the one
that actually re-skins the UI:
```css
[data-game='charades'] {
  --accent-rgb: 185 242 39;   /* lime  */
  --accent2-rgb: 255 122 41;  /* ember */
}
```
Miss it and every screen silently renders in the app's default orange. Keep
the two files in sync — they are the same colour written twice, deliberately,
because CSS variables cannot be read from SVG attributes.

**`src/components/art.tsx`** — a mascot, `viewBox="0 0 64 64"`:
```ts
const MASCOTS: Record<GameType, () => JSX.Element> = { /* … */ charades: MimeFace };
```
The whole file is explicitly placeholder art built from simple shapes. Match
the existing construction: flat accent fill, `#0B0A10` stroke at ~2.4 width,
one bold silhouette that still reads at 24px.

**`src/screens/History.tsx`** ⚠️ — stats columns. The existing chain is
`fake_artist ? … : night_village ? … : <cooperative default>`, so a new game
**silently inherits Dial's columns**. Add your branch:
```tsx
: gameType === 'charades'
  ? [{ head: 'Played', get: (r) => String(r.games_played) },
     { head: 'Points',  get: (r) => String(r.points), emphasise: true }]
```

Pick colours from the toybox in `tailwind.config.js` (`ember, punch, grape,
lagoon, lime, gold, moss, blood`) so the app stays one family. Do not
introduce a new hue unless all eight genuinely clash with your game's mood.

---

## 9. Step 7 — the SQL port

Production runs PL/pgSQL, not TypeScript. The mock and the SQL are structured
to mirror each other function-for-function, so this is mechanical
transliteration, not redesign. **Port the mock after it is tested and settled**
— porting a moving target twice is how they drift.

### The nine functions

New file `supabase/migrations/00NN_game_charades.sql` (next free number):

| SQL function | Mock equivalent |
|---|---|
| `charades_setup(round_id)` | `setup` |
| `charades_public_view(round_id) → jsonb` | `publicView` |
| `charades_private_view(round_id, player_id) → jsonb` | `privateView` |
| `charades_has_acted(round_id, player_id) → boolean` | `hasActed` |
| `charades_action(round_id, player_id, kind, payload)` | `action` |
| `charades_advance(round_id)` | `advance` |
| `charades_on_left(round_id, player_id)` | `onPlayerLeft` |
| `charades_result(round_id, result)` | `applyStats` |
| `charades_role_visible(round_id, viewer, subject) → boolean` | `roleVisibleTo` — optional; the dispatcher can hardcode `true` for a game with no hidden roles, as it does for Dial |

Every one:
```sql
create or replace function charades_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
```
`security definer` + `set search_path = public` is not optional. RLS denies all
direct access to `rounds`, `round_players` and `actions`; these functions are
how the data is reachable at all, and the pinned search_path is what stops a
hostile schema from shadowing a call.

### The eleven dispatcher branches in `0003_core.sql`

`game_setup`, `game_public_view`, `game_private_view`, `game_action`,
`game_advance`, `game_apply_stats`, `game_on_player_left`, `game_has_acted`,
`game_role_visible`, `game_min_players`, `game_max_players`.

### Helpers you get for free (`0003_core.sql`)

`hearth_present`, `hearth_living`, `hearth_has_left`, `hearth_set_phase`,
`hearth_clear_pending`, `hearth_end_round`, `hearth_put_action`,
`hearth_drop_action`, `hearth_clear_phase_actions`, `hearth_action_payload`,
`hearth_has_action`, `hearth_take_content`, `hearth_bump_stats`,
`hearth_raise`, plus `hearth_patch_state` (defined in `0005_…`).

### ⚠️ Do not grant execute on your game's functions

`0008_grants_and_cron.sql` revokes everything from `public/anon/authenticated`
and grants back only the 17 client-facing RPCs (plus two helpers RLS
itself calls). A game function reachable
from a client is a game function that bypasses every phase check in
`submit_action`.

### Read settings defensively

The SQL idiom, and the reason legacy groups don't break in production:
```sql
select coalesce((settings #>> '{charades,round_seconds}')::int, 90)
into v_secs from rounds where id = p_round_id;
```
Always `coalesce` to a literal default. Always.

### ⚠️ Teach the checker about your game

`scripts/check-sql-refs.mjs` has two hardcoded lists:
```js
const OURS = /^(hearth_|game_|fake_artist_|night_village_|dial_|nv_|charades_|…)/;
const GAMES = ['fake_artist', 'night_village', 'dial', /* … */ 'charades'];
```
Without the first, calls to your functions are never validated. Without the
second, a missing `charades_advance()` is never reported. Neither omission
fails anything — you just quietly lose the check.

Then:
```bash
npm run check
```
Type checker, all tests, Postgres grammar on every migration, cross-migration
reference check. And be honest about what it proves: `check-sql.mjs` parses the
SQL, but the grammar treats a PL/pgSQL body as an opaque string. **Only
`supabase db push` against a real database proves the bodies run.** Budget
debugging time.

---

## 10. The frontend design language

The look: **arcade at night** — deep violet-black ground, chunky sticker
surfaces with hard drop shadows, one loud accent per game, heavy display type.
Everything is phone-first and one-handed.

### The accent system — how theming actually works

`Play.tsx` wraps every phase in `<Screen game={view.game_type}>`, which sets
`data-game` on the container. `src/index.css` maps that to two RGB triplets:

```css
[data-game='charades'] { --accent-rgb: 185 242 39; --accent2-rgb: 255 122 41; }
```

Tailwind exposes them as real colours with working opacity modifiers:
`bg-accent`, `border-accent/45`, `text-accent`, `shadow-glow`, `bg-accent2/12`.

**Consequence:** write your screens with `accent`/`accent2` and they are
themed for free. Hardcode `#FF3D8B` and you have pinned your game to Fake
Artist's pink forever. Reach for a literal hex only where CSS variables cannot
go — SVG `stroke`/`fill` attributes and canvas ink — and take it from
`gameTheme()` or `avatarColor()`, never a magic string.

### Tokens

| | |
|---|---|
| **Ground** | `ink #0B0A10` · `ash #161522` · `slatey #221F33` |
| **Lines** | `edge #38334F` |
| **Text** | `chalk #F4F1FA` primary · `mute #948FAE` secondary |
| **Toybox** | `ember punch grape lagoon lime gold moss blood` |
| **Live** | `accent` · `accent2` (per-game, above) |
| **Type** | `font-display` Bricolage Grotesque (headlines) · `font-sans` Outfit (body) · `font-mono` Space Mono (codes) |
| **Depth** | `shadow-pop` / `pop-sm` / `pop-lg` — hard offset black, no blur |
| **Radius** | `rounded-2xl` controls · `rounded-[1.4rem]`–`[1.8rem]` surfaces |

### Component classes (`src/index.css`)

`.btn-primary` `.btn-ghost` `.btn-quiet` `.btn-danger` · `.card` `.card-accent`
· `.field` · `.label` · `.pill` `.pill-accent` · `.sticker` · `.title`
`.subtitle` · `.numeral` (tabular figures for timers and scores).

Utilities: `.touch-none-safe` (**required** on any drag surface, or the page
scrolls under the finger), `.text-accent-glow`, `.stripes`, `.dots`, `.tilt-l`
`.tilt-r`, `.no-select` (**required** on anything holding a secret).

### Shared components

| Component | Use it for |
|---|---|
| `<Screen game>` | the phase root — max-w-md, safe-area padding, sets the accent |
| `<TopBar title subtitle eyebrow onBack right>` | headers |
| `<Spacer/>` | pushes the primary action to the bottom of the screen |
| `<HoldToReveal tone hint onFirstReveal>` | **every** secret. 400ms hold, hides on lift |
| `<Countdown size warnAt>` | the phase timer — reads the store itself, no props needed |
| `<PhaseProgress total>` | a progress bar for the current phase |
| `<PlayerGrid players selectedId onSelect disabledIds rings captions showActed columns>` | picking a player |
| `<PlayerRow players activeId doneIds>` | a compact turn strip |
| `<AvatarBadge avatarKey size ring>` | one player |
| `<HeroPanel kicker tone>` | the result headline |
| `<Sticker tone tilt>` | small tilted badges |
| `<ErrorNote>` | inline validation |
| `<GameCharacter game size>` | your mascot |

### Phase screen anatomy

Every existing screen follows the same skeleton, and yours should too:

```tsx
<div className="flex flex-1 flex-col">
  {/* 1. status: what phase, whose turn, how long left */}
  <div className="mb-3 flex items-center justify-between">
    <div>
      <p className="label mb-0.5 text-accent">Round 2 of 4</p>
      <p className="font-display text-xl font-extrabold text-chalk">Your turn</p>
    </div>
    <Countdown />
  </div>

  {/* 2. the thing itself — canvas, cards, grid, spectrum */}

  {/* 3. who else is doing what */}
  <PlayerRow players={view.players} activeId={pub.current_player_id} doneIds={doneIds} />

  <Spacer />

  {/* 4. exactly one primary action, thumb-height, at the bottom */}
  <button className="btn-primary" disabled={!myTurn || busy} onClick={() => submit('done')}>
    {myTurn ? 'Done — next player' : 'Waiting…'}
  </button>
</div>
```

### Non-negotiables

- **Secrets sit behind `HoldToReveal`.** It is the only thing between a role
  and the person sitting next to you. Add `.no-select` so nothing is
  long-press-copyable.
- **Never blank the screen.** A waiting player gets a state, not emptiness:
  who is acting, how long left. `Play.tsx` covers reconnects and unknown
  phases; the rest is yours.
- **Everything works muted.** Narration is an enhancement — text on screen
  always carries the game (§14.6). If you add audio, follow Night Village:
  the server publishes `public.narration = { seq, lines: [{clips, text}] }`,
  one device plays it (`useLocalStorage('hearth.speaker.…')`, host by
  default), every device shows the text.
- **Respect `prefers-reduced-motion`** — use `.motion-safe-only` on anything
  that loops.
- **Thumb reach.** Primary action pinned to the bottom via `<Spacer/>`,
  min-height 3.4rem. Nothing important in the top corners.
- **`vibrate()` on turn changes**, not on every render. It is a nudge to look
  at your phone, not decoration.

---

## 11. Backend surface reference

### `GameCtx` — everything a game may touch

| Member | Notes |
|---|---|
| `ctx.round` | the row; `.state` is secret, plus `.phase`, `.day_number` |
| `ctx.settings` | the round's **snapshot**, not the group's live settings |
| `ctx.now` | server time. **Never `Date.now()`** — the tests drive a fake clock |
| `ctx.rps` | all round players, sorted by `turn_index` |
| `ctx.present()` | still in the group |
| `ctx.living()` / `livingIds()` | present **and** `is_alive` |
| `ctx.byRole(role)` | e.g. `ctx.byRole('impostor')[0]` |
| `ctx.rp(id)` / `player(id)` / `nickname(id)` / `hasLeft(id)` | lookups |
| `ctx.actionsIn(phase, kind?)` / `actionBy(phase, kind, playerId)` | reads |
| `ctx.putAction(playerId, kind, payload)` | upsert — replaces same-kind |
| `ctx.dropAction` / `clearPhaseActions(phase, kind?)` | for toggles and re-entry |
| `ctx.setPhase(phase, { seconds, pendingOn })` | the only way to move |
| `ctx.clearPending(playerId)` | "this player is done" |
| `ctx.endRound(result)` | terminal; writes history and stats |
| `ctx.takeContent(gameType)` | content bank + used-list + reset |
| `ctx.bumpStats(playerId, gameType, delta)` | in `applyStats` only |

### `setPhase` — the three shapes

```ts
// 1. waits for players, with a deadline (the common case)
ctx.setPhase('vote', { seconds: 60, pendingOn: ctx.livingIds() });

// 2. display-only: a beat everyone watches, nobody acts
ctx.setPhase('morning', { seconds: 8 });

// 3. terminal — ONLY 'result' may be untimed with nobody pending
ctx.setPhase('result');   // ⚠️ anywhere else, the round hangs forever
```

`expects_actions` is what separates 2 from 3: it records whether the phase was
*entered* with actors. Without it a display-only phase reads as "nothing
pending, therefore due" and fires instantly (see NOTES.md deviation #1).

### Errors

Throw `new HearthError(code)`. `Play.tsx` maps them to copy already:
`wrong_phase` → "Too late — the phase moved on.", `not_your_turn` → "Not your
turn.", plus `already_acted`, `invalid_target`, `not_a_member`. Anything else
shows "That didn't go through." Prefer an existing code over inventing one.

### Realtime

`RoundEvent` is deliberately **content-free**: `phase_changed` (phase name +
deadline), `player_acted` (player id), `round_ended`. Never add a payload — a
bug in a broadcast can then never leak a secret, and the 2s poll is the
correctness guarantee regardless (§9.2).

For sub-second liveness use `EphemeralEvent` (`src/types.ts`) — add a variant
if your game needs one. It never touches the server and is never authoritative.

---

## 12. Pitfalls — read this one twice

### Pitfall 1: the phase that cannot end
`setPhase('waiting')` with no `seconds` and no `pendingOn` hangs the round
forever — `isDue` returns false, so not even the `stuck_phase` guard fires.
Only `result` may be untimed and unpending.

### Pitfall 2: `advance` that makes no progress
If `phase:day_number:pending_on` is unchanged after `advance` and the round is
still due, the engine aborts with `stuck_phase`. Every path through `advance`
must call `setPhase` or `endRound`.

### Pitfall 3: action-kind collisions on a repeated phase
`actions` is unique on `(round_id, player_id, phase, kind)`. A phase entered
more than once — pass 2 of drawing, night 3 — collides. Two working patterns:
- **suffix the kind**: `stroke:{pass}` (Fake Artist). Order-preserving data
  goes in `state`, where rendering needs it anyway.
- **clear on re-entry**: `ctx.clearPhaseActions('night_wolves')` before
  `setPhase` (Night Village).

Pick one per phase and be consistent, including in `hasActed`.

### Pitfall 4: client state that outlives the turn
**This is a bug that shipped.** `DrawingCanvas` guards against a second stroke
with a `committed` ref. The `drawing` phase does not change between passes —
only `pass`/`turn` inside `public` do — so React never unmounted the
component, the ref was never reset, and from pass 2 onward nobody could draw
until they reloaded the page.

If a phase repeats, **any `useState`/`useRef` scoped to "this turn" needs an
explicit reset keyed on a turn identifier**:

```tsx
useEffect(() => {
  committed.current = false;
  setLive([]);
}, [turnKey]);            // turnKey = `${pub.pass}:${pub.turn}`
```

Mounting is not a reset. Phase change is not a reset. Only an explicit key is.

### Pitfall 5: trusting the device clock
Never `Date.now()` for game logic. The server publishes `server_time`; the
store keeps `offsetMs`; `<Countdown/>` and `secondsLeft()` use it. On the
server use `ctx.now` — the tests drive a fake clock, and real timestamps make
them nondeterministic.

### Pitfall 6: leaking through a field nobody renders
The view is JSON on the wire. `viewContains(view, secret)` in the test harness
is the mechanical check — run it at every phase, for the player who must not
know. "The UI doesn't show it" is not a defence.

### Pitfall 7: forgetting the second registry
`registerGame` lives in **both** `src/backend/mock/index.ts` and
`__tests__/harness.ts`. Miss the app one and the game fails at `startRound`;
miss the test one and the suite fails at `start()`.

### Pitfall 8: legacy groups have no settings for your game
A group created before your migration has a `settings` JSON with no `charades`
key, and groups live 100 days. In SQL the `coalesce` idiom handles it. In
TypeScript `ctx.settings.charades.round_seconds` throws. Read defensively:

```ts
const cfg = { ...DEFAULT_SETTINGS.charades, ...(ctx.settings.charades ?? {}) };
```

### Pitfall 9: the silent registry misses
`src/index.css` (wrong colour), `History.tsx` (wrong stats columns),
`check-sql-refs.mjs` (checks quietly disabled), the harness settings merge
(overrides ignored), and `updateGroupSettings`'s deep-merge branch. None fail
a build. Walk the ⚠️ rows in [§2](#2-the-complete-touch-list) before you open
a PR.

### Pitfall 10: min/max player counts in three places
`GameModule`, `ServerGame`, and `game_min_players`/`game_max_players` in SQL.
Nothing cross-checks them. Disagreement = the lobby offers a game the backend
refuses to start.

### Pitfall 11: editing a migration that has already been applied
**This one bit during Grid/Bid/Nerve.** §9 tells you to add your branches to
the eleven dispatchers in `0003_core.sql`. That is right for a fresh
`supabase db reset` — and a no-op for any database where `0003` has already
run, because `db push` applies migrations by version and never re-runs one.
The symptom is ugly: your game appears on the lobby card and then dies at
`start_round` with `round_not_found`, in production only.

Check before you push:

```bash
npx supabase migration list --linked
```

If `0003` shows a remote version, the dispatchers need a **forward
migration** as well — see `0016_dispatchers_nine_games.sql`, which re-declares
all eleven. Every dispatcher is `create or replace`, so applying it to a
database that already had the updated `0003` changes nothing. Keep the two
copies in step; `npm run check:sql` now fails if the *winning* definition of
any dispatcher stops routing a game in its `GAMES` list.

### Pitfall 12: mock/SQL drift
The vitest suites cover TypeScript only. Port after the mock settles, port
mechanically, and re-read both side by side whenever you change either.

`supabase/tests/smoke_games.sql` narrows the gap for the pure logic: it runs
the same expectations the TypeScript asserts against the deployed functions,
so scoring and resolution can be *shown* to agree rather than assumed to.
Paste it into the SQL editor after a push and add your own game's cases to
it. The round-scoped functions — setup, advance, action, the views — still
need a real round played through the app in supabase mode.

---

## 13. Player counts: supporting any number

"Any number of players" is a per-game decision, expressed in three ways.

**The hard bounds** — `minPlayers`/`maxPlayers`, enforced at `start_round`
(`too_few_players` / `too_many_players`) and rendered on the lobby card as
"Needs 6+" / "Max 12". The group cap itself is `GROUP_MAX_PLAYERS` in
`src/lib/constants.ts`; a game cannot exceed it.

**The soft advice** — `bestWith`, shown as a "Best with 8+" pill. Use it when
the game technically runs at 4 but is much better at 8, rather than raising
the minimum.

**Scaling the rules** — derive from `ctx.present().length` in `setup`, never
from a constant. Night Village is the worked example: wolf count scales with
the table, and the Seer and Doctor are settings-gated. Test **every** count
from min to max — off-by-one role arithmetic at exactly `minPlayers` or
exactly `maxPlayers` is the classic bug, and the existing suite tests 6
through 12 one at a time for that reason.

Turn order comes from `turn_index`, assigned in `setup` over
`shuffle(ctx.present())`. Absent players keep their index; skip them at turn
time via `ctx.hasLeft()` rather than renumbering — renumbering mid-round
invalidates every index already stored in `state`.

---

## 14. Definition of done

```bash
npm run check          # tsc + all tests + SQL grammar + SQL references
npm run dev            # then open 4-6 tabs; each tab is a separate player
```

- [ ] `npm run check` is clean
- [ ] Played end-to-end in 4+ tabs at **minPlayers** and at **maxPlayers**
- [ ] Every phase reached, including every timeout path (just wait)
- [ ] Force-reloaded mid-round: state and role come back identical
- [ ] A player left mid-round in each phase — the round continued or aborted
      cleanly, never stalled
- [ ] On the secret-holder's tab, at every phase before `result`:
      ```js
      JSON.stringify(window.__hearthView).toLowerCase().includes('thesecret')  // false
      ```
- [ ] Lobby card, settings screen, history line and stats columns all correct
- [ ] Your accent appears — if the UI is orange, `index.css` is missing
- [ ] Playable fully muted
- [ ] SQL pushed to a real Supabase project and one round played through it

The last box is the one people skip. The PL/pgSQL parses long before it runs.

---

## Further reading

- `README.md` — architecture at a glance, the secrecy invariant
- `NOTES.md` — deviations from the spec and why; read before changing anything structural
- `SUPABASE_SETUP.md` — pushing migrations, seeding content
- `src/backend/mock/games/dial.ts` — the smallest complete game; start here
- `src/backend/mock/games/nightVillage.ts` — the most complex: many phases, a day counter, narration
- `src/backend/mock/games/fakeArtist.ts` — turn passes, a live canvas, a content bank
