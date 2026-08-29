/**
 * Parses every migration with the real Postgres grammar (pg_query compiled
 * to WASM). Catches syntax errors without needing a running database.
 *
 *   node scripts/check-sql.mjs
 *
 * Statements are split and parsed one at a time: it pinpoints the failing
 * statement, and keeps the WASM parser off very large inputs.
 *
 * This validates SQL syntax only. It does NOT check that referenced tables
 * or functions exist — `supabase db push` is what proves that.
 */
import PgQueryModule from 'pg-query-emscripten';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Split on top-level semicolons, respecting single quotes, line and block
 * comments, and dollar-quoted bodies ($$ ... $$, $tag$ ... $tag$).
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let line = 1;
  let startLine = 1;

  const push = () => {
    if (buf.trim()) out.push({ sql: buf.trim(), line: startLine });
    buf = '';
    startLine = line;
  };

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === '\n') line++;

    // line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // block comment
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      line += sql.slice(i, stop).split('\n').length - 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      line += sql.slice(i, j).split('\n').length - 1;
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // dollar-quoted body
    const dollar = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      line += sql.slice(i, stop).split('\n').length - 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === ';') {
      buf += ch;
      push();
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  push();
  return out;
}

let pg = await new PgQueryModule();
let sinceRebuild = 0;

// The WASM instance destabilises after a few dozen parses (it traps on
// input it parses fine when fresh), so recycle it periodically.
const RECYCLE_EVERY = 25;

async function parseOne(sql) {
  if (sinceRebuild >= RECYCLE_EVERY) {
    pg = await new PgQueryModule();
    sinceRebuild = 0;
  }
  sinceRebuild++;
  try {
    const r = pg.parse(sql);
    return r.error ? { error: r.error.message } : { ok: true };
  } catch (err) {
    // Retry once on a fresh instance before believing it is a real error.
    pg = await new PgQueryModule();
    sinceRebuild = 1;
    try {
      const r = pg.parse(sql);
      return r.error ? { error: r.error.message } : { ok: true };
    } catch (err2) {
      return { error: `parser crashed twice: ${err2.message}` };
    }
  }
}

const dir = join(root, 'supabase/migrations');
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(dir, f)),
  join(root, 'supabase/seed.sql'),
];

let failures = 0;
let total = 0;

for (const path of files) {
  const name = path.split(/[/\\]/).pop();
  const sql = readFileSync(path, 'utf8');
  const statements = splitStatements(sql);
  let bad = 0;

  for (const st of statements) {
    const res = await parseOne(st.sql);
    if (!res.ok) {
      bad++;
      failures++;
      console.log(`FAIL ${name}:${st.line}`);
      console.log(`     ${res.error}`);
      console.log(`     ${st.sql.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  total += statements.length;
  if (bad === 0) {
    console.log(`ok   ${name.padEnd(34)} ${String(statements.length).padStart(4)} statements`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${files.length} files parse cleanly — ${total} statements.`
    : `\n${failures} statement(s) failed to parse.`,
);
process.exit(failures === 0 ? 0 : 1);
