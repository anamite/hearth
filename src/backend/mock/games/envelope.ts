import { DEFAULT_SETTINGS, HearthError } from '@/types';
import type { EnvelopeSettings } from '@/types';
import { pick, shuffle } from '@/lib/random';
import type { GameCtx, ServerGame } from '../engine';

// ---------------------------------------------------------------
// Envelope — everybody wants something and nobody will say what.
//
// Eighty per cent of the playtime is people arguing across a table with
// the screen off. The app does the two things paper cannot: it keeps
// everyone's goal secret, and it is the impartial thing that ends an
// argument by buzzing.
// ---------------------------------------------------------------

export const EVENT_SECONDS = 16;
export const CLAIM_SECONDS = 120;

export interface EnvelopeEvent {
  id: string;
  title: string;
  text: string;
}

interface EventTemplate {
  id: string;
  title: string;
  text: string;
  /** Needs one named player, and possibly a second. */
  targets?: 1 | 2;
  /** Cuts the next trading session in half. */
  halves?: boolean;
  /** Publishes the named player's assignment to everyone. */
  opens?: boolean;
}

export const EVENT_BANK: EventTemplate[] = [
  {
    id: 'pass_left',
    title: 'Everybody shifts',
    text: 'Every player passes two cards to the player on their left. Right now, no negotiating.',
  },
  {
    id: 'pass_right',
    title: 'The other way',
    text: 'Every player passes two cards to the player on their right. Right now, no negotiating.',
  },
  {
    id: 'queens_double',
    title: 'Queens are loud',
    text: 'Queens count double from here on, for whatever anyone is quietly trying to do.',
  },
  {
    id: 'open_envelope',
    title: 'Open envelope',
    text: '{a} must show the table exactly what they were asked to do.',
    targets: 1,
    opens: true,
  },
  {
    id: 'blind_swap',
    title: 'Blind swap',
    text: '{a} and {b} each hand over one card, face down, without seeing what comes back.',
    targets: 2,
  },
  {
    id: 'silence',
    title: 'No talking',
    text: 'The next session is silent. Offers by pointing, nodding and glaring only.',
  },
  {
    id: 'deadline',
    title: 'Short fuse',
    text: 'The next session is half as long. Move.',
    halves: true,
  },
  {
    id: 'amnesty',
    title: 'Amnesty',
    text: 'Anyone who wants to may show the table one card. Nobody has to.',
  },
  {
    id: 'tax',
    title: 'The middle takes one',
    text: 'Everybody puts one card face down in the middle. It is out of the game for good.',
  },
  {
    id: 'gift',
    title: 'Forced generosity',
    text: '{a} must give one card to whoever asks for it first.',
    targets: 1,
  },
  {
    id: 'inheritance',
    title: 'Inheritance',
    text: '{a} takes one card of their choosing from {b}. {b} does not get to object.',
    targets: 2,
  },
];

export interface EnvelopeStanding {
  player_id: string;
  score: number;
  made: boolean;
  assignment: string;
  points: number;
}

/** Settings read defensively — groups predating this game have no key. */
function cfg(ctx: GameCtx): EnvelopeSettings {
  return { ...DEFAULT_SETTINGS.envelope, ...((ctx.settings as any).envelope ?? {}) };
}

function claimOf(ctx: GameCtx, playerId: string): boolean | null {
  const a = ctx.actionBy('reveal', 'claim', playerId);
  return a ? a.payload.made === true : null;
}

/** Assignments only ever become public when the game says so. */
function openAssignments(ctx: GameCtx): Record<string, { text: string; points: number }> {
  const s = ctx.round.state;
  const phase = ctx.round.phase;
  const all = phase === 'reveal' || phase === 'result';
  const opened = new Set((s.revealed ?? []) as string[]);
  const out: Record<string, { text: string; points: number }> = {};
  for (const rp of ctx.rps) {
    if (!all && !opened.has(rp.player_id)) continue;
    const priv = rp.private ?? {};
    if (!priv.text) continue;
    out[rp.player_id] = { text: priv.text as string, points: (priv.points as number) ?? 0 };
  }
  return out;
}

function startTrade(ctx: GameCtx, session: number): void {
  const s = ctx.round.state;
  const c = cfg(ctx);
  const seconds = s.half_next ? Math.max(30, Math.round(c.session_seconds / 2)) : c.session_seconds;
  s.session = session;
  s.half_next = false;
  s.event = null;
  ctx.setPhase('trade', {
    seconds,
    pendingOn: ctx.present().map((r) => r.player_id),
  });
}

function enterEvent(ctx: GameCtx): void {
  const s = ctx.round.state;
  const used = new Set((s.events_used ?? []) as string[]);
  const pool = EVENT_BANK.filter((e) => !used.has(e.id));
  const template = pick(pool.length ? pool : EVENT_BANK);

  const present = shuffle(ctx.present().map((r) => r.player_id));
  const a = present[0] ?? null;
  const b = present[1] ?? null;

  let text = template.text;
  if (template.targets && a) text = text.split('{a}').join(ctx.nickname(a));
  if (template.targets === 2 && b) text = text.split('{b}').join(ctx.nickname(b));

  s.events_used = [...used, template.id];
  s.event = { id: template.id, title: template.title, text } as EnvelopeEvent;
  if (template.halves) s.half_next = true;
  if (template.opens && a) s.revealed = [...new Set([...(s.revealed ?? []), a])];

  ctx.setPhase('event', { seconds: EVENT_SECONDS });
}

function enterReveal(ctx: GameCtx): void {
  ctx.setPhase('reveal', {
    seconds: CLAIM_SECONDS,
    pendingOn: ctx.present().map((r) => r.player_id),
  });
}

function finish(ctx: GameCtx): void {
  const s = ctx.round.state;
  const standings: EnvelopeStanding[] = ctx
    .present()
    .map((rp) => {
      const priv = ctx.rp(rp.player_id)?.private ?? {};
      // §19.2 — silence at the scoring table reads as "didn't manage it".
      const made = claimOf(ctx, rp.player_id) === true;
      const points = (priv.points as number) ?? 0;
      return {
        player_id: rp.player_id,
        score: made ? points : 0,
        made,
        assignment: (priv.text as string) ?? '',
        points,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = standings.length ? standings[0].score : 0;
  ctx.endRound({
    standings,
    winners: standings.filter((x) => x.score === best && best > 0).map((x) => x.player_id),
    best_score: best,
    events: s.events ?? [],
    bank_reset: !!s.bank_reset,
  });
}

export const envelopeServer: ServerGame = {
  id: 'envelope',
  minPlayers: 4,
  maxPlayers: 8,

  setup(ctx) {
    const c = cfg(ctx);
    const order = shuffle(ctx.present().map((r) => r.player_id));
    let bankReset = false;

    for (const rp of ctx.rps) {
      const i = order.indexOf(rp.player_id);
      rp.turn_index = i >= 0 ? i : null;
      rp.role = 'player';
      rp.private = {};
    }

    for (const pid of order) {
      const taken = ctx.takeContent('envelope');
      if (!taken) throw new HearthError('content_exhausted');
      if (taken.bankReset) bankReset = true;

      // {left} and {right} resolve to two other players by name, so an
      // assignment reads the same wherever anybody happens to be sitting.
      const others = shuffle(order.filter((x) => x !== pid));
      const first = others[0];
      const second = others[1] ?? others[0];
      let text = String(taken.item.payload.text ?? '');
      if (first) text = text.split('{left}').join(ctx.nickname(first));
      if (second) text = text.split('{right}').join(ctx.nickname(second));

      const rp = ctx.rp(pid)!;
      rp.private = { text, points: (taken.item.payload.points as number) ?? 3 };
    }

    ctx.round.state = {
      order,
      sessions: Math.max(1, c.sessions),
      session: 0,
      event: null as EnvelopeEvent | null,
      events: [] as EnvelopeEvent[],
      events_used: [] as string[],
      revealed: [] as string[],
      half_next: false,
      bank_reset: bankReset,
    };

    ctx.setPhase('brief', {
      seconds: c.brief_seconds,
      pendingOn: ctx.present().map((r) => r.player_id),
    });
  },

  publicView(ctx) {
    const s = ctx.round.state;
    return {
      session_number: s.session ?? 0,
      sessions_total: s.sessions ?? 0,
      event: ctx.round.phase === 'event' ? s.event ?? null : null,
      events: s.events ?? [],
      // Empty until an event opens someone's envelope, or until scoring.
      assignments: openAssignments(ctx),
      revealed: s.revealed ?? [],
      claims: Object.fromEntries(
        ctx.rps.map((rp) => [rp.player_id, claimOf(ctx, rp.player_id)]),
      ),
      half_next: !!s.half_next,
      bank_reset: !!s.bank_reset,
    };
  },

  privateView(_ctx, rp) {
    // The absence of a secret is meaningful: a player who somehow has no
    // assignment gets nothing, not a null-shaped one.
    return rp.private ?? {};
  },

  roleVisibleTo() {
    return true; // Envelope hides goals, not people.
  },

  hasActed(ctx, rp) {
    switch (ctx.round.phase) {
      case 'brief':
        return ctx.actionBy('brief', 'ready', rp.player_id) != null;
      case 'trade':
        return ctx.actionBy('trade', `done:${ctx.round.state.session}`, rp.player_id) != null;
      case 'reveal':
        return claimOf(ctx, rp.player_id) != null;
      default:
        return true;
    }
  },

  action(ctx, rp, kind, payload) {
    const s = ctx.round.state;

    if (ctx.round.phase === 'brief' && kind === 'ready') {
      ctx.putAction(rp.player_id, 'ready', {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (ctx.round.phase === 'trade' && kind === 'done') {
      // The trade phase repeats every session, so the kind carries the
      // session number or session 2 collides with session 1.
      ctx.putAction(rp.player_id, `done:${s.session}`, {});
      ctx.clearPending(rp.player_id);
      return;
    }

    if (ctx.round.phase === 'reveal' && kind === 'claim') {
      const made = payload.made === true;
      ctx.putAction(rp.player_id, 'claim', { made });
      ctx.clearPending(rp.player_id);
      return;
    }

    throw new HearthError('wrong_phase');
  },

  advance(ctx) {
    const s = ctx.round.state;
    switch (ctx.round.phase) {
      case 'brief':
        startTrade(ctx, 1);
        return;
      case 'trade':
        if ((s.session ?? 1) >= (s.sessions ?? 1)) enterReveal(ctx);
        else enterEvent(ctx);
        return;
      case 'event':
        s.events = [...(s.events ?? []), s.event];
        startTrade(ctx, (s.session ?? 1) + 1);
        return;
      case 'reveal':
        finish(ctx);
        return;
      default:
        return;
    }
  },

  onPlayerLeft(ctx, playerId) {
    ctx.clearPending(playerId);
    if (ctx.present().length < this.minPlayers) {
      ctx.endRound({ aborted: 'too_few_players', reason: 'too_few_players' });
      return;
    }
    // Otherwise the table simply has one fewer person to lie to. Their
    // cards are on the table and everyone can see them.
  },

  applyStats(ctx, result) {
    const winners = new Set(((result as any).winners ?? []) as string[]);
    const standings = ((result as any).standings ?? []) as EnvelopeStanding[];
    for (const st of standings) {
      ctx.bumpStats(st.player_id, 'envelope', {
        games_played: 1,
        games_won: winners.has(st.player_id) ? 1 : 0,
        times_hidden: st.made ? 1 : 0,
        points: st.score,
      });
    }
  },
};
