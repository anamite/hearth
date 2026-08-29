-- ---------------------------------------------------------------
-- Hearth — schema (spec §5)
--
-- Mirrors src/backend/mock/db.ts row-for-row. If you change one,
-- change the other.
-- ---------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- GROUPS
-- ---------------------------------------------------------------
create table if not exists groups (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,          -- 6 chars, §4.2
  display_name    text not null,                 -- cosmetic, e.g. 'Amber Fox'
  pin_hash        text not null,                 -- bcrypt via pgcrypto
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '100 days'
);
create index if not exists groups_expires_idx on groups (expires_at);

-- ---------------------------------------------------------------
-- PLAYERS
-- ---------------------------------------------------------------
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  auth_uid      uuid not null,
  nickname      text not null,                   -- from the fixed pool, §16.1
  avatar_key    text not null,
  is_host       boolean not null default false,
  is_ready      boolean not null default false,
  has_left      boolean not null default false,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (group_id, auth_uid),
  unique (group_id, nickname)
);
create index if not exists players_group_idx on players (group_id);

-- ---------------------------------------------------------------
-- CONTENT BANK
-- ---------------------------------------------------------------
create table if not exists content_items (
  id          uuid primary key default gen_random_uuid(),
  game_type   text not null,                     -- 'fake_artist' | 'dial'
  payload     jsonb not null,
  category    text,
  difficulty  smallint default 1,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists content_items_type_idx on content_items (game_type, active);

create table if not exists group_used_content (
  group_id    uuid not null references groups(id) on delete cascade,
  content_id  uuid not null references content_items(id) on delete cascade,
  round_id    uuid,
  used_at     timestamptz not null default now(),
  primary key (group_id, content_id)
);

-- ---------------------------------------------------------------
-- ROUNDS
-- ---------------------------------------------------------------
create table if not exists rounds (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups(id) on delete cascade,
  game_type      text not null,
  phase          text not null,
  phase_ends_at  timestamptz,
  pending_on     uuid[] not null default '{}',
  -- Not in the spec's DDL, but required by the phase engine: a display-only
  -- phase (morning, 8s, nobody to act) starts with an empty pending_on and
  -- would otherwise read as "nothing pending, therefore due" and fire
  -- instantly. See §8.1 and the note in src/backend/mock/db.ts.
  expects_actions boolean not null default false,
  state          jsonb not null default '{}'::jsonb,   -- SECRET
  day_number     smallint not null default 0,
  settings       jsonb not null default '{}'::jsonb,   -- snapshot at start
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  result         jsonb
);
create index if not exists rounds_group_idx on rounds (group_id, started_at desc);
-- One live round per group; also makes "find the active round" trivial.
create unique index if not exists rounds_one_active_per_group
  on rounds (group_id) where ended_at is null;

create table if not exists round_players (
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  role        text not null,
  private     jsonb not null default '{}'::jsonb,     -- SECRET, per-player
  is_alive    boolean not null default true,
  turn_index  smallint,
  primary key (round_id, player_id)
);

-- ---------------------------------------------------------------
-- ACTIONS (votes, strokes, night actions, dial sets)
-- ---------------------------------------------------------------
create table if not exists actions (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  phase       text not null,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  -- Idempotency guard (§4.4). Note that Fake Artist keys its strokes
  -- 'stroke:{pass}' so a player drawing twice does not collide here.
  unique (round_id, player_id, phase, kind)
);
create index if not exists actions_round_phase_idx on actions (round_id, phase);

-- ---------------------------------------------------------------
-- HISTORY & STATS
-- ---------------------------------------------------------------
create table if not exists games_history (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  round_id    uuid unique,
  game_type   text not null,
  result      jsonb not null,
  ended_at    timestamptz not null default now()
);
create index if not exists games_history_group_idx on games_history (group_id, ended_at desc);

create table if not exists player_stats (
  group_id       uuid not null references groups(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  game_type      text not null,
  games_played   int not null default 0,
  games_won      int not null default 0,
  times_hidden   int not null default 0,
  times_caught   int not null default 0,
  points         int not null default 0,
  primary key (group_id, player_id, game_type)
);

-- ---------------------------------------------------------------
-- ABUSE CONTROL (§18)
-- ---------------------------------------------------------------
create table if not exists join_attempts (
  id          bigserial primary key,
  ip_hash     text not null,
  code        text,
  succeeded   boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists join_attempts_ip_idx on join_attempts (ip_hash, created_at desc);
create index if not exists join_attempts_code_idx on join_attempts (code, created_at desc);

-- Short-lived nonces minted by the verify-turnstile Edge Function (§18.1).
create table if not exists turnstile_nonces (
  nonce       text primary key,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  expires_at  timestamptz not null default now() + interval '10 minutes'
);
create index if not exists turnstile_nonces_expiry_idx on turnstile_nonces (expires_at);
