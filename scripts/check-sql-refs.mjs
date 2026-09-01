/**
 * Static consistency check across the migrations.
 *
 * The Postgres SQL grammar treats a PL/pgSQL body as an opaque string, so
 * `node scripts/check-sql.mjs` cannot see inside it. This pass does what it
 * can without a live database: every Hearth function called from anywhere
 * must actually be defined somewhere, and every GRANT must name a real
 * function with a matching argument count.
 *
 * It catches the likely failure mode — a typo or a renamed function — and
 * makes no claim beyond that. Only `supabase db push` proves the bodies run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase/migrations');

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const sources = files.map((f) => ({ name: f, sql: readFileSync(join(dir, f), 'utf8') }));
const all = sources.map((s) => s.sql).join('\n');

/** Only our own namespaces; built-ins and Postgres functions are ignored. */
const OURS = /^(hearth_|game_|fake_artist_|night_village_|dial_|nv_|grid_|bid_|nerve_|fold_|season_|envelope_|my_player_id|is_member)/;

// --- definitions -------------------------------------------------
const defined = new Map(); // name -> arg count
const defRe = /create\s+or\s+replace\s+function\s+([a-z0-9_]+)\s*\(([^)]*)\)/gi;
for (const m of all.matchAll(defRe)) {
  const name = m[1].toLowerCase();
  const args = m[2].trim() ? m[2].split(',').length : 0;
  defined.set(name, args);
}

// --- calls -------------------------------------------------------
const problems = [];
const callRe = /\b([a-z0-9_]+)\s*\(/gi;

for (const { name: file, sql } of sources) {
  const lines = sql.split('\n');
  lines.forEach((line, i) => {
    // Skip the definition line itself and comments.
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) return;
    if (/create\s+or\s+replace\s+function/i.test(line)) return;

    for (const m of line.matchAll(callRe)) {
      const fn = m[1].toLowerCase();
      if (!OURS.test(fn)) continue;
      if (defined.has(fn)) continue;
      problems.push(`${file}:${i + 1}  calls undefined function ${fn}()`);
    }
  });
}

// --- grants ------------------------------------------------------
const grantRe = /grant\s+execute\s+on\s+function\s+([a-z0-9_]+)\s*\(([^)]*)\)/gi;
for (const m of all.matchAll(grantRe)) {
  const name = m[1].toLowerCase();
  const args = m[2].trim() ? m[2].split(',').length : 0;
  if (!defined.has(name)) {
    problems.push(`grant names undefined function ${name}()`);
  } else if (defined.get(name) !== args) {
    problems.push(
      `grant on ${name}() has ${args} args but the function declares ${defined.get(name)}`,
    );
  }
}

// --- the dispatchers must cover every game (§10.1) ---------------
const GAMES = [
  'fake_artist', 'night_village', 'dial', 'grid', 'bid', 'nerve',
  'fold', 'season', 'envelope',
];
const REQUIRED = [
  '_setup', '_public_view', '_private_view', '_action',
  '_advance', '_result', '_has_acted', '_on_left',
];
for (const g of GAMES) {
  for (const suffix of REQUIRED) {
    const fn = g + suffix;
    if (!defined.has(fn)) problems.push(`game module ${g} is missing ${fn}()`);
  }
}
// role_visible has a default for cooperative games
for (const g of ['fake_artist', 'night_village', 'season', 'envelope']) {
  if (!defined.has(`${g}_role_visible`)) {
    problems.push(`game module ${g} is missing ${g}_role_visible()`);
  }
}

/**
 * Every dispatcher must actually route every game — checked against the
 * LAST definition of each, because a later migration can replace an
 * earlier one. Editing an already-applied migration in place looks right
 * locally and silently never reaches a deployed database, so what counts
 * is the definition that wins after all migrations have run.
 */
const DISPATCHERS = [
  'game_setup', 'game_public_view', 'game_private_view', 'game_action',
  'game_advance', 'game_apply_stats', 'game_on_player_left', 'game_has_acted',
  'game_role_visible', 'game_min_players', 'game_max_players',
];
for (const fn of DISPATCHERS) {
  const defRe = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn}\\s*\\(`, 'gi');
  const starts = [...all.matchAll(defRe)].map((m) => m.index);
  if (starts.length === 0) {
    problems.push(`dispatcher ${fn}() is not defined anywhere`);
    continue;
  }
  const last = starts[starts.length - 1];
  const end = all.indexOf('$$;', last);
  const body = all.slice(last, end < 0 ? undefined : end);
  for (const g of GAMES) {
    if (!body.includes(`'${g}'`)) {
      problems.push(`the winning definition of ${fn}() does not route '${g}'`);
    }
  }
}

// --- report ------------------------------------------------------
if (problems.length === 0) {
  console.log(`ok   ${defined.size} functions defined, all references resolve.`);
  process.exit(0);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(`\n${problems.length} problem(s).`);
process.exit(1);
