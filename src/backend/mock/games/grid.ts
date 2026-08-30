import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { GridSettings } from '@/types';
import { shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Grid — everyone fills the same 5x5 square from one shared deck.
//
// Thirty cards, three each of 1..10. Twenty-five are revealed, so five
// are never seen: the deck composition is public but its tail is not,
// which is the whole bet a player makes on every placement.
// ---------------------------------------------------------------

export const GRID_SIDE = 5;
export const GRID_CELLS = GRID_SIDE * GRID_SIDE; // 25
export const DECK_SIZE = 30;
export const REVEALS = GRID_CELLS; // 25 of the 30 cards
export const LINE_COUNT = GRID_SIDE * 2; // 5 rows + 5 columns
/** Seconds spent on each line during the end-of-game walkthrough. */
export const LINE_SECONDS = 6;

/** Points for the longest non-decreasing run in one line. */
export const RUN_POINTS: Record<number, number> = { 2: 1, 3: 3, 4: 6, 5: 10 };
export const MAX_SCORE = LINE_COUNT * RUN_POINTS[GRID_SIDE]; // 100

export interface GridStanding {
  player_id: string;
  total: number;
  lines: number[];
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): GridSettings {
  return { ...DEFAULT_SETTINGS.grid, ...((ctx.settings as any).grid ?? {}) };
}

/** Three of every number, shuffled. */
export function buildDeck(): number[] {
  const deck: number[] = [];
  for (let n = 1; n <= 10; n++) for (let c = 0; c < 3; c++) deck.push(n);
  return shuffle(deck);
}

/**
 * Longest run of contiguous cells that never decreases, reading forwards.
 * A hole is not a number, so it breaks the run rather than spanning it.
 */
export function longestRun(values: (number | null)[]): number {
  let best = 0;
  let cur = 0;
  let prev: number | null = null;
  for (const v of values) {
    if (v == null) {
      cur = 0;
      prev = null;
      continue;
    }
    cur = prev != null && v >= prev ? cur + 1 : 1;
    prev = v;
    if (cur > best) best = cur;
  }
  return best;
}

export function lineScore(values: (number | null)[]): number {
  return RUN_POINTS[longestRun(values)] ?? 0;
}

/** The cell indices of line `i`: 0-4 are the rows, 5-9 the columns. */
export function lineCells(i: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < GRID_SIDE; k++) {
    out.push(i < GRID_SIDE ? i * GRID_SIDE + k : k * GRID_SIDE + (i - GRID_SIDE));
  }
  return out;
}

export function scoreGrid(cells: (number | null)[]): { lines: number[]; total: number } {
  const lines: number[] = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    lines.push(lineScore(lineCells(i).map((c) => cells[c] ?? null)));
  }
  return { lines, total: lines.reduce((a, b) => a + b, 0) };
}

function cellsOf(ctx: GameCtx, playerId: string): (number | null)[] {
  const rp = ctx.rp(playerId);
  const cells = (rp?.private as any)?.cells;
  return Array.isArray(cells) ? cells : new Array(GRID_CELLS).fill(null);
}

/** Everyone still here who has somewhere left to write. */
function stillPlacing(ctx: GameCtx): string[] {
  return ctx
    .present()
    .filter((rp) => cellsOf(ctx, rp.player_id).some((c) => c == null))
    .map((rp) => rp.player_id);
}

/** How many of each number have been seen. Public — this is the tally. */
function tallyOf(drawn: number[]): number[] {
  const t = new Array(11).fill(0);
  for (const n of drawn) t[n] += 1;
  return t.slice(1); // entry 0 counts the number 1
}

function beginReveal(ctx: GameCtx): void {
  const s = ctx.round.state;
  const waiting = stillPlacing(ctx);
  if (waiting.length === 0 || s.index >= REVEALS) return enterScoring(ctx);

  ctx.setPhase('reveal', { seconds: cfg(ctx).reveal_seconds, pendingOn: waiting });
}

function enterScoring(ctx: GameCtx): void {
  const s = ctx.round.state;
  const scores: Record<string, { lines: number[]; total: number }> = {};
  for (const rp of ctx.rps) scores[rp.player_id] = scoreGrid(cellsOf(ctx, rp.player_id));

  s.scores = scores;
  s.line_index = 0;
  ctx.setPhase('scoring', { seconds: LINE_SECONDS });
}

function grids(ctx: GameCtx): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const rp of ctx.rps) out[rp.player_id] = cellsOf(ctx, rp.player_id);
  return out;
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  const scores = (s.scores ?? {}) as Record<string, { lines: number[]; total: number }>;

  // Someone who walked out mid-round does not appear on the podium.
  const standings: GridStanding[] = ctx
    .present()
    .map((rp) => ({
      player_id: rp.player_id,
      total: scores[rp.player_id]?.total ?? 0,
      lines: scores[rp.player_id]?.lines ?? [],
    }))
    .sort((a, b) => b.total - a.total);

  const best = standings.length ? standings[0].total : 0;
  ctx.endRound({
    standings,
    winners: standings.filter((x) => x.total === best).map((x) => x.player_id),
    best_score: best,
    max_score: MAX_SCORE,
    grids: grids(ctx),
  });
}

export const gridServer: ServerGame = {
  id: 'grid',
  // One player is a legitimate solo puzzle; the ceiling is the group cap.
  minPlayers: 1,
  maxPlayers: 12,

  setup(ctx) {
    const order = shuffle(ctx.present().map((r) => r.player_id));
    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = { cells: new Array(GRID_CELLS).fill(null) };
    }

    ctx.round.state = {
      deck: buildDeck(), // SECRET — only the drawn prefix is ever published
      index: 0,
      scores: {},
      line_index: 0,
    };
    beginReveal(ctx);
  },

  publicView(ctx) {
    const s = ctx.round.state;
    const deck: number[] = s.deck ?? [];
    const index: number = s.index ?? 0;
    // Everything up to and including the card on screen, and not one more.
    const drawn = deck.slice(0, Math.min(index + 1, REVEALS));

    const base = {
      card_number: Math.min(index + 1, REVEALS),
      cards_total: REVEALS,
      deck_size: DECK_SIZE,
      max_score: MAX_SCORE,
      show_tally: cfg(ctx).show_tally,
      drawn,
      tally: tallyOf(drawn),
    };

    switch (ctx.round.phase) {
      case 'reveal':
        return {
          ...base,
          current_card: deck[index] ?? null,
          grids: null,
          scores: null,
          line_index: null,
        };
      case 'scoring':
        return {
          ...base,
          current_card: null,
          // The grids become public exactly when the game is over.
          grids: grids(ctx),
          scores: s.scores ?? {},
          line_index: s.line_index ?? 0,
          line_count: LINE_COUNT,
        };
      default:
        return {
          ...base,
          current_card: null,
          grids: grids(ctx),
          scores: s.scores ?? {},
          line_index: LINE_COUNT,
          line_count: LINE_COUNT,
        };
    }
  },

  privateView(_ctx, rp) {
    return rp.private ?? {};
  },

  roleVisibleTo() {
    return true; // Grid has no hidden roles.
  },

  hasActed(ctx, rp) {
    if (ctx.round.phase !== 'reveal') return true;
    const s = ctx.round.state;
    if (!cellsOf(ctx, rp.player_id).some((c) => c == null)) return true;
    return !!ctx.actionBy('reveal', `place:${s.index}`, rp.player_id);
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'reveal' && kind === 'place') {
      if (ctx.actionBy('reveal', `place:${s.index}`, rp.player_id)) {
        throw new HearthError('already_acted');
      }
      const cell = Math.trunc(Number(payload.cell));
      if (!Number.isFinite(cell) || cell < 0 || cell >= GRID_CELLS) {
        throw new HearthError('invalid_target');
      }
      const cells = cellsOf(ctx, rp.player_id).slice();
      if (cells[cell] != null) throw new HearthError('invalid_target');

      cells[cell] = s.deck[s.index];
      rp.private = { ...(rp.private ?? {}), cells };
      // The kind carries the card number: the phase repeats 25 times and
      // actions are unique on (round, player, phase, kind).
      ctx.putAction(rp.player_id, `place:${s.index}`, { cell });
      ctx.clearPending(rp.player_id);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'reveal':
        // §19.2 — there is no default placement. A card you did not place
        // is a hole, and a hole breaks whatever run it sat in.
        s.index += 1;
        if (s.index >= REVEALS) enterScoring(ctx);
        else beginReveal(ctx);
        return;
      case 'scoring':
        s.line_index += 1;
        if (s.line_index >= LINE_COUNT) finish(ctx);
        else ctx.setPhase('scoring', { seconds: LINE_SECONDS });
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    if (ctx.present().length === 0) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
    }
    // Everyone else keeps writing. Nothing in this game waits on a
    // particular person, so there is nothing else to repair.
  },

  applyStats(ctx, result) {
    const winners = new Set(((result as any).winners ?? []) as string[]);
    const standings = ((result as any).standings ?? []) as GridStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'grid', {
        games_played: 1,
        games_won: winners.has(st.player_id) ? 1 : 0,
        points: st.total,
      });
    }
  },
};
