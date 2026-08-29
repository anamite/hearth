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
const OURS = /^(hearth_|game_|fake_artist_|night_village_|dial_|nv_|my_player_id|is_member)/;

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
const GAMES = ['fake_artist', 'night_village', 'dial'];
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
for (const g of ['fake_artist', 'night_village']) {
  if (!defined.has(`${g}_role_visible`)) {
    problems.push(`game module ${g} is missing ${g}_role_visible()`);
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
