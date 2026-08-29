# Implementation notes

Decisions, deviations from `hearth-spec.md`, and things left open. Read this
before changing anything structural.

---

## Deviations from the spec

### 1. `rounds.expects_actions` — a new column

Spec §8.1 says a phase ends when `pending_on` empties **or** the clock expires.
Taken literally, a display-only phase breaks: `morning` has an 8-second timer
and nobody to act, so it starts with an empty `pending_on` and reads as
"nothing pending, therefore due" — firing instantly and skipping the
announcement.

`expects_actions` records whether the phase was *entered* expecting actions:

- entered with actors → due when they've all acted, or the clock runs out
- entered with none → due only when the clock runs out
- neither actors nor clock → never auto-due (only `result`)

### 2. Stroke actions are keyed `stroke:{pass}`

Spec §5 puts a unique constraint on `(round_id, player_id, phase, kind)`, and
§11 has each player drawing twice in the `drawing` phase. Those collide: the
second stroke would violate the constraint.

Strokes are recorded as `stroke:0`, `stroke:1`, … (same for `pass_turn`), which
keeps the constraint doing its real job — per-turn idempotency — without
blocking the second pass. Ordered stroke data lives in `rounds.state.strokes`,
since rendering needs order anyway.

### 3. Reveal phases carry a 180-second safety timer

Spec §11.4 and §12.5 give `reveal` no duration, but §19.2 requires a timeout
default for it, and §19.2 also states *"a phase MUST NEVER stall waiting for a
player who has gone."* Those are contradictory without a clock. Reveal gets a
generous one; in practice everyone taps within seconds.

### 4. Fake Artist's vote delay gates the action, not the phase

Spec §11.4: *"Voting unlocks at `max(drawing_complete, started_at +
vote_delay_seconds)`."* Implemented as: the round enters `voting` immediately,
`public.vote_unlock_at` is published, the UI shows a countdown, and the server
rejects a `vote` submitted before that time. The phase timer is extended so
there is always a full 90 seconds of actual voting after unlock.

### 5. Dial's live dial is persisted, not purely broadcast

Spec §13.5 says a timed-out `guess` should use "the dial's last-broadcast
position". Broadcasts are ephemeral and never reach the server, so the server
could not honour that. Instead the dial-holder's drags upsert a `dial_set`
action (overwritable), and locking in is the same action with `locked: true`.
Timeout then naturally uses the last real position, falling back to 50.

The ephemeral broadcast still drives the live animation for everyone else.

### 6. Two extra narration outcomes

Spec §14.3 budgets 5 outcome clips. There are 7: `no_majority` (a common day
result that would otherwise be silent) and `left` (a disconnect, which
otherwise reads as an unexplained death). 77 clips total rather than ~71.

### 7. `is_host` added to the round view

Needed so a device can tell whether it is the default narration speaker
(§14.6) without a second lobby fetch. It is public lobby information already.

---

## The local backend

`VITE_BACKEND=mock` (the default) runs a complete backend in the browser.

- **Identity is per-tab.** `sessionStorage`, not `localStorage` — that is what
  makes each tab a separate player, so one laptop hosts a five-player game.
  It survives reload (so mid-round reload testing works) but not tab close.
  The real backend persists identity in `localStorage` as §4.1 requires;
  nothing outside `mock/db.ts` depends on the difference.
- **Writes are compare-and-swap.** `localStorage` has no transactions. The
  first version did read-modify-write and silently lost writes when several
  tabs acted at once — with five tabs revealing simultaneously, four reveals
  vanished. `tx()` now re-reads, verifies the stored string is unchanged, and
  retries if not. This is the stand-in for `select ... for update` (§8.3).
- **Broadcasts are buffered per transaction** so a retried attempt cannot emit
  an event for work that was rolled back.
- **The PIN hash is not a security boundary** and says so in the code: the mock
  database lives in the player's own browser. The real one uses bcrypt.

The mock and the SQL are two implementations of one spec. They are structured
to mirror each other function-for-function so a change to one is mechanical to
port. **They can drift.** The tests only cover the TypeScript side.

---

## What is verified, and how

**69 tests** over the three game modules, driving whole games against an
in-memory database with a controllable clock.

Covered: the secrecy invariant (40 randomised rounds plus a fixed-word round
checked at every phase), role distribution at every player count 6–12, all win
conditions, tie-favours-impostor, abstention arithmetic, seer/doctor
restrictions, wolf consensus, every timeout default, reroll thresholds and the
cap, impostor rotation over 20 rounds, content bank behaviour, mid-round
departures for all three games, and stats.

**Verified live in the browser**, five tabs on one machine:

- five players join with only a code and a PIN
- exactly one impostor; every other device has the word
- the impostor's received payload contains no trace of it, at any phase
- force-reload mid-round restores the identical state and role
- a phase whose clock expires advances rather than stalling
- hold-to-reveal shows the word only while held
- a canvas stroke commits, simplifies (31 raw points → 17), keeps normalised
  coordinates, takes the drawer's avatar colour, ends the turn on lift, and
  appears on every other device

**Not verified:** the PL/pgSQL. It parses against the real Postgres grammar and
every function reference resolves, but the SQL grammar treats a function body
as an opaque string — no Postgres has executed these. Assume an hour of
debugging on first push.

---

## Open decisions (spec §22)

Resolved as recommended, except where noted:

1. **Fake Artist minimum: 4.** Enforced.
2. **Impostor's final guess: typed.** Graded against the alias list.
3. **Dial scoring: purely cooperative.** No `games_won`; the shared total goes
   into `player_stats.points` for every participant.
4. **Dead players see all roles immediately.** Ghost view.
5. **Zustand.** One store for the round view, one hook for the lobby.

`player_stats.points` does double duty in Night Village: it accumulates
survivals, which the stats screen renders as a survival rate. It is the shared
score in Dial and unused in Fake Artist. Worth splitting if a fourth game
needs another counter.

---

## Trademark (spec §23)

Clean: no "Werewolf", "Wavelength", or "A Fake Artist Goes to New York"
anywhere in the product, code identifiers, or content. All 222 words, 101
spectrum pairs, narration scripts, avatars and icons are original.

**"Fake Artist" as a two-word title is still lower-risk-but-not-zero** and §23
recommends replacing it before public launch. *One Line Lie* is the suggested
alternative. Changing it touches `src/games/fakeArtist/index.ts` (the `name`
field) and nothing else user-facing — the `game_type` identifier
`fake_artist` can stay as it is internal.

The product name **Hearth** is still a placeholder pending your domain and
trademark check.
