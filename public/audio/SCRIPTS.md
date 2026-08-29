# Narration scripts

Record every line below and save it at the path shown. All clips: mono,
64 kbps MP3. The whole set lands under ~3 MB (spec §14.3).

`manifest.json` already lists every expected file — drop the MP3s in and
they start playing. Until then the game runs silently on the on-screen text,
which is the required fallback (§14.6), not a stopgap.

## Voice direction

Flat, unhurried, close-mic'd. Think "reading a bedtime story to adults",
not "movie trailer". Name clips especially must be **neutral in pitch and
have no trailing inflection**, because they are spliced between sentence
fragments (§14.5).

## Names — 24 clips, 1 each

`names/<lowercase>.mp3` for each of:
Baker, Miller, Fletcher, Mason, Cooper, Sawyer, Fox, Wren, Pike, Crow,
Hare, Moth, Ash, Birch, Cove, Fern, Reed, Vale, Ember, Frost, Dusk,
Flint, Slate, Wick

Say the name alone, flat, no full stop in the delivery.

## Phase cues — 8 cues × 4 variants = 32 clips

`cues/<key>_1.mp3` … `_4.mp3`

**night_falls**
1. Night falls over the village.
2. The village goes dark.
3. Another night begins.
4. The lamps go out, one by one.

**wolves_wake**
1. The wolves wake, and choose.
2. The wolves are awake.
3. Something is moving in the dark.
4. The wolves open their eyes.

**wolves_sleep**
1. The wolves sleep.
2. The wolves settle.
3. Whatever it was, it is still now.
4. The dark goes quiet again.

**seer_wake**
1. The seer wakes, and looks.
2. The seer opens their eyes.
3. Someone is watching carefully tonight.
4. The seer looks for the truth.

**seer_sleep**
1. The seer sleeps.
2. The seer closes their eyes.
3. What was seen stays hidden.
4. The seer rests.

**doctor_wake**
1. The doctor wakes, and protects.
2. The doctor is awake.
3. Someone keeps watch tonight.
4. The doctor chooses who to guard.

**doctor_sleep**
1. The doctor sleeps.
2. The doctor closes the door.
3. The watch is set.
4. The doctor rests.

**morning_comes**
1. Morning comes over the village.
2. The sun comes up.
3. Morning. The village stirs.
4. Light returns to the village.

## Outcomes — 7 outcomes × 3 variants = 21 clips

`outcomes/<key>_1.mp3` … `_3.mp3`

These are written to read **after a name clip**, so each begins mid-sentence.

**died** (after a name)
1. …did not survive the night.
2. …is gone.
3. …was found at dawn.

**survived** (stands alone)
1. Everybody survived the night.
2. No one was lost.
3. The village wakes up whole.

**voted_out** (after a name)
1. …has been voted out.
2. …is cast out of the village.
3. …will not be staying.

**no_majority** (stands alone)
1. The village cannot agree. Nobody is voted out.
2. No decision. Everyone stays.
3. The vote splits. Nobody leaves.

**village_wins** (stands alone)
1. Every wolf has been driven out. The village survives.
2. The village is safe.
3. It is over. The village wins.

**wolves_wins** (stands alone)
1. The wolves outnumber the village. The village falls.
2. There is no one left to stop them.
3. It is over. The wolves win.

**left** (after a name) — a player closed the app mid-game
1. …has left the village.
2. …is no longer with us.
3. …has gone.

## Note on the count

Spec §14.3 budgets 5 outcomes; this build uses 7, adding `no_majority`
(a common and currently silent result) and `left` (a disconnect, which
otherwise reads as an unexplained death). 77 clips in total.
