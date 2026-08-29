-- ---------------------------------------------------------------
-- Hearth — Row Level Security (spec §6)
--
-- THE PRIMARY INVARIANT (§4.3):
--   RLS denies all direct SELECT on rounds, round_players and actions.
--   These hold the secret word, the impostor's identity, the wolf list,
--   the seer's results and the dial target. No client ever reads them.
--   Everything reaches a client through get_my_view() and nothing else.
--
-- If you ever add a permissive policy to those three tables, all three
-- games become trivially cheatable and the product has no value.
-- ---------------------------------------------------------------

alter table groups              enable row level security;
alter table players             enable row level security;
alter table content_items       enable row level security;
alter table group_used_content  enable row level security;
alter table rounds              enable row level security;
alter table round_players       enable row level security;
alter table actions             enable row level security;
alter table games_history       enable row level security;
alter table player_stats        enable row level security;
alter table join_attempts       enable row level security;
alter table turnstile_nonces    enable row level security;

-- Force RLS even for the table owner, so a mistake in a SECURITY DEFINER
-- function's search_path cannot quietly bypass these policies.
alter table rounds          force row level security;
alter table round_players   force row level security;
alter table actions         force row level security;
alter table content_items   force row level security;

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------

create or replace function my_player_id(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from players
  where group_id = p_group_id and auth_uid = auth.uid() and not has_left
  limit 1
$$;

create or replace function is_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where group_id = p_group_id and auth_uid = auth.uid()
  )
$$;

-- ---------------------------------------------------------------
-- Policies
--
-- Any table without a policy below denies everything by default, which
-- is exactly what rounds / round_players / actions / content_items /
-- group_used_content / join_attempts / turnstile_nonces want.
-- ---------------------------------------------------------------

drop policy if exists groups_select_members on groups;
create policy groups_select_members on groups
  for select using (is_member(id));

drop policy if exists players_select_members on players;
create policy players_select_members on players
  for select using (is_member(group_id));

drop policy if exists games_history_select_members on games_history;
create policy games_history_select_members on games_history
  for select using (is_member(group_id));

drop policy if exists player_stats_select_members on player_stats;
create policy player_stats_select_members on player_stats
  for select using (is_member(group_id));

-- No INSERT / UPDATE / DELETE policies anywhere: every write goes through
-- a SECURITY DEFINER function in 0003+.

-- ---------------------------------------------------------------
-- Views that omit sensitive columns (§6.1)
--
-- security_invoker so the querying user's policies still apply; the views
-- exist to drop columns (pin_hash, auth_uid), not to widen access.
-- ---------------------------------------------------------------

create or replace view v_group_public
with (security_invoker = true) as
  select id, code, display_name, settings, created_at, expires_at
  from groups;

create or replace view v_player_public
with (security_invoker = true) as
  select id, group_id, nickname, avatar_key, is_host, is_ready,
         has_left, joined_at, last_seen_at
  from players;

grant select on v_group_public, v_player_public to authenticated;

-- Realtime: lobby membership is public within a group, so Postgres Changes
-- on `players` is safe and simple (§9.1). `rounds` is never published —
-- phase changes are broadcast content-free instead.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table players;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
