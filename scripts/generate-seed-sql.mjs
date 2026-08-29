/**
 * Generates supabase/seed.sql from the same content/*.json the app bundles,
 * so the mock and the real database can never drift apart.
 *
 *   npm run seed:sql
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const jsonb = (o) => `${q(JSON.stringify(o))}::jsonb`;

const fakeArtist = read('content/fake_artist.json');
const dial = read('content/dial.json');

const rows = [
  ...fakeArtist.map((w) => ({
    game_type: 'fake_artist',
    payload: { text: w.text, description: w.description, aliases: w.aliases },
    category: w.category ?? null,
    difficulty: w.difficulty ?? 1,
  })),
  ...dial.map((d) => ({
    game_type: 'dial',
    payload: { left: d.left, right: d.right },
    category: d.category ?? null,
    difficulty: d.difficulty ?? 1,
  })),
];

const values = rows
  .map(
    (r) =>
      `  (${q(r.game_type)}, ${jsonb(r.payload)}, ${
        r.category === null ? 'null' : q(r.category)
      }, ${r.difficulty})`,
  )
  .join(',\n');

const sql = `-- ---------------------------------------------------------------
-- Hearth — content bank (spec §17)
--
-- GENERATED FILE. Do not edit by hand: change content/*.json and run
--   npm run seed:sql
--
-- ${fakeArtist.length} Fake Artist words, ${dial.length} Dial spectrum pairs.
-- Safe to re-run: existing rows are matched on their payload.
-- ---------------------------------------------------------------

insert into content_items (game_type, payload, category, difficulty)
select v.game_type, v.payload, v.category, v.difficulty
from (values
${values}
) as v(game_type, payload, category, difficulty)
where not exists (
  select 1 from content_items c
  where c.game_type = v.game_type and c.payload = v.payload
);
`;

writeFileSync(join(root, 'supabase/seed.sql'), sql);
console.log(
  `wrote supabase/seed.sql — ${rows.length} rows ` +
    `(${fakeArtist.length} fake_artist, ${dial.length} dial)`,
);
