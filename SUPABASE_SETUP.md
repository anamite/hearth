# Supabase setup

Everything here is deferred work — the app runs fully without it. Follow this
when you're ready to move off the local backend.

Roughly 20 minutes, most of it waiting for a project to provision.

---

## 1. Create the project

<https://supabase.com/dashboard> → New project. Any region. Postgres 15+.

Save the database password you set — you need it in step 3 and it cannot be
recovered later, only reset.

Then **Database → Extensions** and enable **`pg_cron`**. (`pgcrypto` is enabled
by migration `0001`, but `pg_cron` must be switched on in the dashboard first
or `0008` will fail.)

## 2. Fill in `.env.local`

From **Settings → API**:

```bash
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Cloudflare's official always-pass TEST keys — fine until launch.
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Leave `VITE_BACKEND=mock` until step 5 passes, so you can fall back instantly.

## 3. Push the schema

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Migrations run in order:

| File | What it does |
|---|---|
| `0001_schema.sql` | tables and indexes |
| `0002_rls.sql` | RLS — **denies all SELECT on `rounds`, `round_players`, `actions`** |
| `0003_core.sql` | phase engine, `get_my_view`, `advance_if_due`, `submit_action` |
| `0004_groups.sql` | create/join/lobby, bcrypt PINs, rate limits |
| `0005`–`0007` | the three games |
| `0008` | execute grants and the two `pg_cron` jobs |

They parse against the real Postgres grammar (`npm run check:sql`) but have
never been executed. If something fails, it will be a runtime PL/pgSQL problem
in one function, not a structural one — fix and re-push.

## 4. Seed the content

```bash
npm run seed:sql     # regenerates supabase/seed.sql from content/*.json
```

Then paste `supabase/seed.sql` into the SQL editor, or:

```bash
npx supabase db push --include-seed
```

323 rows: 222 Fake Artist words, 101 Dial pairs. Re-running is safe — rows are
matched on payload.

Verify:

```sql
select game_type, count(*) from content_items group by 1;
```

## 5. Anonymous sign-in

**Authentication → Providers → Anonymous sign-ins → enable.**

Without this, `signInAnonymously()` fails and nobody can do anything. It is the
single most likely thing to forget.

Now flip `VITE_BACKEND=supabase`, restart the dev server, and create a group.

## 6. Turnstile (before launch, not before testing)

The test keys above always pass, so skip this until you're going public.

1. Cloudflare dashboard → Turnstile → add a site → copy both keys.
2. `VITE_TURNSTILE_SITE_KEY=<site key>` in `.env.local`.
3. Deploy the verifier:

```bash
npx supabase secrets set TURNSTILE_SECRET_KEY=<secret key>
npx supabase functions deploy verify-turnstile
```

Until a real nonce exists in `turnstile_nonces`, `hearth_consume_nonce()`
accepts anything — that is deliberate, so local development isn't blocked on
bot protection. **The moment the first real nonce is inserted, enforcement
turns on automatically.** Confirm before launch:

```sql
select count(*) from turnstile_nonces;   -- must be > 0 in production
```

## 7. Hosting

Cloudflare Pages, connected to the repo:

- build command `npm run build`
- output directory `dist`
- environment variables: the three `VITE_*` values above

Add an SPA fallback so `/g/:code` deep links work — a `public/_redirects`
containing `/* /index.html 200`.

---

## Verifying the invariant on the real backend

This is the gate for the whole product (spec M1 criterion 3). With a round
running and devtools open on the **impostor's** device:

1. Network tab → the `advance_if_due` / `get_my_view` responses.
2. Search each response body for the word. It must not appear before the
   result phase.

Then confirm the tables really are sealed. In the SQL editor, as an
authenticated non-service role:

```sql
select * from rounds;          -- expect 0 rows
select * from round_players;   -- expect 0 rows
select * from actions;         -- expect 0 rows
```

Zero rows, not an error, is the correct result: RLS filters rather than
refuses. If any of these returns data, stop — a policy has been added that
should not exist, and all three games are cheatable.

---

## Rollback

`VITE_BACKEND=mock` in `.env.local` and restart. The local backend is
untouched by any of this and keeps working.
