-- ---------------------------------------------------------------
-- Hearth — core RPCs and the phase engine (spec §7, §8)
--
-- Every mutating function:
--   1. resolves auth.uid() to a players row, or raises not_a_member
--   2. takes `select ... for update` on the round before reading state
--   3. validates the phase, or raises wrong_phase
--   4. is idempotent — a duplicate call returns current state
-- ---------------------------------------------------------------

-- ---------------------------------------------------------------
-- Errors (§7.1)
-- ---------------------------------------------------------------
create or replace function hearth_raise(p_code text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

-- ---------------------------------------------------------------
-- Realtime (§9.1). Content-free by design: a bug in a broadcast
-- payload can never leak a secret, because there is nothing in it.
-- ---------------------------------------------------------------
create or replace function hearth_broadcast(p_topic text, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, false);
exception when others then
  -- Realtime is a latency optimisation; the 2s poll is the correctness
  -- guarantee (§9.2). Never fail a game action because a broadcast failed.
  null;
end $$;

-- ---------------------------------------------------------------
-- Small helpers used by every game module
-- ---------------------------------------------------------------

/** Players still in the group and in this round. */
create or replace function hearth_present(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(rp.player_id order by rp.turn_index nulls last), '{}')
  from round_players rp
  join players p on p.id = rp.player_id
  where rp.round_id = p_round_id and not p.has_left
$$;

/** Present and still alive. */
create or replace function hearth_living(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(rp.player_id order by rp.turn_index nulls last), '{}')
  from round_players rp
  join players p on p.id = rp.player_id
  where rp.round_id = p_round_id and not p.has_left and rp.is_alive
$$;

create or replace function hearth_has_left(p_player_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select has_left from players where id = p_player_id), true)
$$;

/**
 * Enter a phase. A non-empty p_pending means the phase may also end early
 * once everyone listed has acted; p_seconds null means no clock at all.
 */
create or replace function hearth_set_phase(
  p_round_id uuid, p_phase text, p_seconds int, p_pending uuid[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_pending uuid[];
begin
  select coalesce(array_agg(x), '{}') into v_pending
  from unnest(coalesce(p_pending, '{}'::uuid[])) as x
  where not hearth_has_left(x);

  update rounds set
    phase = p_phase,
    pending_on = v_pending,
    expects_actions = (coalesce(array_length(p_pending, 1), 0) > 0),
    phase_ends_at = case when p_seconds is null then null
                         else now() + make_interval(secs => p_seconds) end
  where id = p_round_id;
end $$;

create or replace function hearth_clear_pending(p_round_id uuid, p_player_id uuid)
returns void language sql security definer set search_path = public as $$
  update rounds set pending_on = array_remove(pending_on, p_player_id)
  where id = p_round_id
$$;

create or replace function hearth_end_round(p_round_id uuid, p_result jsonb)
returns void language sql security definer set search_path = public as $$
  update rounds set
    phase = 'result', pending_on = '{}', expects_actions = false,
    phase_ends_at = null, ended_at = now(), result = p_result
  where id = p_round_id
$$;

/** Record an action, replacing any prior one of the same kind (§19.6). */
create or replace function hearth_put_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  select phase into v_phase from rounds where id = p_round_id;
  insert into actions (round_id, player_id, phase, kind, payload)
  values (p_round_id, p_player_id, v_phase, p_kind, coalesce(p_payload, '{}'::jsonb))
  on conflict (round_id, player_id, phase, kind)
  do update set payload = excluded.payload, created_at = now();
end $$;

create or replace function hearth_drop_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_phase text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  v_phase := coalesce(p_phase, (select phase from rounds where id = p_round_id));
  delete from actions
  where round_id = p_round_id and player_id = p_player_id
    and phase = v_phase and kind = p_kind;
end $$;

create or replace function hearth_clear_phase_actions(
  p_round_id uuid, p_phase text, p_kind text default null
) returns void language sql security definer set search_path = public as $$
  delete from actions
  where round_id = p_round_id and phase = p_phase
    and (p_kind is null or kind = p_kind)
$$;

create or replace function hearth_action_payload(
  p_round_id uuid, p_phase text, p_kind text, p_player_id uuid
) returns jsonb language sql security definer set search_path = public as $$
  select payload from actions
  where round_id = p_round_id and phase = p_phase
    and kind = p_kind and player_id = p_player_id
$$;

create or replace function hearth_has_action(
  p_round_id uuid, p_phase text, p_kind text, p_player_id uuid
) returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from actions
    where round_id = p_round_id and phase = p_phase
      and kind = p_kind and player_id = p_player_id
  )
$$;

/**
 * Pick an unused content item for this group, resetting the used list once
 * if everything has been seen (§11.3 step 1, §19.5). Returns
 * { content_id, payload, bank_reset }.
 */
create or replace function hearth_take_content(p_round_id uuid, p_game_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_item  content_items%rowtype;
  v_reset boolean := false;
begin
  select group_id into v_group from rounds where id = p_round_id;

  select ci.* into v_item from content_items ci
  where ci.game_type = p_game_type and ci.active
    and not exists (
      select 1 from group_used_content g
      where g.group_id = v_group and g.content_id = ci.id
    )
  order by random() limit 1;

  if not found then
    -- Either the group has seen everything, or the bank is empty.
    if not exists (select 1 from content_items where game_type = p_game_type and active) then
      perform hearth_raise('content_exhausted');
    end if;
    delete from group_used_content g
    using content_items ci
    where g.group_id = v_group and g.content_id = ci.id and ci.game_type = p_game_type;
    v_reset := true;

    select ci.* into v_item from content_items ci
    where ci.game_type = p_game_type and ci.active
    order by random() limit 1;
    if not found then perform hearth_raise('content_exhausted'); end if;
  end if;

  insert into group_used_content (group_id, content_id, round_id)
  values (v_group, v_item.id, p_round_id)
  on conflict do nothing;

  return jsonb_build_object(
    'content_id', v_item.id, 'payload', v_item.payload, 'bank_reset', v_reset
  );
end $$;

create or replace function hearth_bump_stats(
  p_round_id uuid, p_player_id uuid, p_game_type text,
  p_played int default 0, p_won int default 0, p_hidden int default 0,
  p_caught int default 0, p_points int default 0
) returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from rounds where id = p_round_id;
  insert into player_stats as s
    (group_id, player_id, game_type, games_played, games_won, times_hidden, times_caught, points)
  values (v_group, p_player_id, p_game_type, p_played, p_won, p_hidden, p_caught, p_points)
  on conflict (group_id, player_id, game_type) do update set
    games_played = s.games_played + excluded.games_played,
    games_won    = s.games_won    + excluded.games_won,
    times_hidden = s.times_hidden + excluded.times_hidden,
    times_caught = s.times_caught + excluded.times_caught,
    points       = s.points       + excluded.points;
end $$;

-- ---------------------------------------------------------------
-- Dispatchers (§10.1)
--
-- Adding a fourth game means: five new {game}_* functions, one branch in
-- each of the dispatchers below, one frontend module folder, and one line
-- in the frontend manifest. Nothing else.
-- ---------------------------------------------------------------

create or replace function game_setup(p_round_id uuid, p_game_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_setup(p_round_id);
    when 'night_village' then perform night_village_setup(p_round_id);
    when 'dial'          then perform dial_setup(p_round_id);
    when 'grid'          then perform grid_setup(p_round_id);
    when 'bid'           then perform bid_setup(p_round_id);
    when 'nerve'         then perform nerve_setup(p_round_id);
    else perform hearth_raise('round_not_found');
  end case;
end $$;

create or replace function game_public_view(p_round_id uuid, p_game_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_public_view(p_round_id);
    when 'night_village' then return night_village_public_view(p_round_id);
    when 'dial'          then return dial_public_view(p_round_id);
    when 'grid'          then return grid_public_view(p_round_id);
    when 'bid'           then return bid_public_view(p_round_id);
    when 'nerve'         then return nerve_public_view(p_round_id);
    else return '{}'::jsonb;
  end case;
end $$;

create or replace function game_private_view(p_round_id uuid, p_game_type text, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_private_view(p_round_id, p_player_id);
    when 'night_village' then return night_village_private_view(p_round_id, p_player_id);
    when 'dial'          then return dial_private_view(p_round_id, p_player_id);
    when 'grid'          then return grid_private_view(p_round_id, p_player_id);
    when 'bid'           then return bid_private_view(p_round_id, p_player_id);
    when 'nerve'         then return nerve_private_view(p_round_id, p_player_id);
    else return '{}'::jsonb;
  end case;
end $$;

create or replace function game_action(
  p_round_id uuid, p_game_type text, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'night_village' then perform night_village_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'dial'          then perform dial_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'grid'          then perform grid_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'bid'           then perform bid_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'nerve'         then perform nerve_action(p_round_id, p_player_id, p_kind, p_payload);
    else perform hearth_raise('wrong_phase');
  end case;
end $$;

create or replace function game_advance(p_round_id uuid, p_game_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_advance(p_round_id);
    when 'night_village' then perform night_village_advance(p_round_id);
    when 'dial'          then perform dial_advance(p_round_id);
    when 'grid'          then perform grid_advance(p_round_id);
    when 'bid'           then perform bid_advance(p_round_id);
    when 'nerve'         then perform nerve_advance(p_round_id);
    else null;
  end case;
end $$;

create or replace function game_apply_stats(p_round_id uuid, p_game_type text, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_result(p_round_id, p_result);
    when 'night_village' then perform night_village_result(p_round_id, p_result);
    when 'dial'          then perform dial_result(p_round_id, p_result);
    when 'grid'          then perform grid_result(p_round_id, p_result);
    when 'bid'           then perform bid_result(p_round_id, p_result);
    when 'nerve'         then perform nerve_result(p_round_id, p_result);
    else null;
  end case;
end $$;

create or replace function game_on_player_left(p_round_id uuid, p_game_type text, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_on_left(p_round_id, p_player_id);
    when 'night_village' then perform night_village_on_left(p_round_id, p_player_id);
    when 'dial'          then perform dial_on_left(p_round_id, p_player_id);
    when 'grid'          then perform grid_on_left(p_round_id, p_player_id);
    when 'bid'           then perform bid_on_left(p_round_id, p_player_id);
    when 'nerve'         then perform nerve_on_left(p_round_id, p_player_id);
    else null;
  end case;
end $$;

/** Has this player done what the current phase asks of them? */
create or replace function game_has_acted(p_round_id uuid, p_game_type text, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_has_acted(p_round_id, p_player_id);
    when 'night_village' then return night_village_has_acted(p_round_id, p_player_id);
    when 'dial'          then return dial_has_acted(p_round_id, p_player_id);
    when 'grid'          then return grid_has_acted(p_round_id, p_player_id);
    when 'bid'           then return bid_has_acted(p_round_id, p_player_id);
    when 'nerve'         then return nerve_has_acted(p_round_id, p_player_id);
    else return true;
  end case;
end $$;

/** Is `p_viewer` entitled to see `p_subject`'s role right now? */
create or replace function game_role_visible(
  p_round_id uuid, p_game_type text, p_viewer uuid, p_subject uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_role_visible(p_round_id, p_viewer, p_subject);
    when 'night_village' then return night_village_role_visible(p_round_id, p_viewer, p_subject);
    when 'dial'          then return true;
    when 'grid'          then return true;
    when 'bid'           then return true;
    when 'nerve'         then return true;
    else return false;
  end case;
end $$;

create or replace function game_min_players(p_game_type text)
returns int language sql immutable as $$
  select case p_game_type
    when 'fake_artist' then 4
    when 'night_village' then 6
    when 'dial' then 3
    when 'grid' then 1
    when 'bid' then 2
    when 'nerve' then 3
    else 99 end
$$;

create or replace function game_max_players(p_game_type text)
returns int language sql immutable as $$
  select case p_game_type
    when 'fake_artist' then 10
    when 'night_village' then 12
    when 'dial' then 10
    when 'grid' then 12
    when 'bid' then 8
    when 'nerve' then 6
    else 0 end
$$;

-- ---------------------------------------------------------------
-- The phase engine (§8)
-- ---------------------------------------------------------------

/**
 * A phase is due when its clock has run out, or when it was waiting on
 * actions and everyone still present has acted (§8.1).
 */
create or replace function hearth_is_due(p_round_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_waiting int;
begin
  select * into r from rounds where id = p_round_id;
  if not found or r.ended_at is not null then return false; end if;
  if r.phase_ends_at is not null and now() >= r.phase_ends_at then return true; end if;
  if not r.expects_actions then return false; end if;

  select count(*) into v_waiting
  from unnest(r.pending_on) as x
  where not hearth_has_left(x);
  return v_waiting = 0;
end $$;

/** Runs transitions until the round settles. */
create or replace function hearth_run_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_before text;
  v_after  text;
  i int;
begin
  for i in 1..64 loop
    if not hearth_is_due(p_round_id) then return; end if;

    select * into r from rounds where id = p_round_id;
    v_before := r.phase || ':' || r.day_number || ':' || array_to_string(r.pending_on, ',');

    perform game_advance(p_round_id, r.game_type);

    select * into r from rounds where id = p_round_id;
    if r.ended_at is not null then return; end if;

    v_after := r.phase || ':' || r.day_number || ':' || array_to_string(r.pending_on, ',');
    if v_before = v_after and hearth_is_due(p_round_id) then
      -- A phase that cannot make progress would hang the round (§19.2).
      perform hearth_end_round(p_round_id,
        jsonb_build_object('aborted', 'stuck_phase', 'reason', 'stuck_phase'));
      return;
    end if;
  end loop;
end $$;

/** Writes history and stats exactly once, after a round ends. */
create or replace function hearth_finalise(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  if r.result is null then return; end if;
  if exists (select 1 from games_history where round_id = r.id) then return; end if;

  insert into games_history (group_id, round_id, game_type, result, ended_at)
  values (r.group_id, r.id, r.game_type, r.result, coalesce(r.ended_at, now()))
  on conflict (round_id) do nothing;

  if coalesce(r.result ->> 'aborted', '') = '' then
    perform game_apply_stats(p_round_id, r.game_type, r.result);
  end if;

  perform hearth_broadcast('round:' || r.id::text, 'round_ended', '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------
-- get_my_view — THE ONLY WAY A CLIENT READS ROUND STATE (§4.3, §7.3)
-- ---------------------------------------------------------------
create or replace function get_my_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        rounds%rowtype;
  v_me     uuid;
  v_rp     round_players%rowtype;
  v_players jsonb;
begin
  select * into r from rounds where id = p_round_id;
  if not found then perform hearth_raise('round_not_found'); end if;

  v_me := my_player_id(r.group_id);
  if v_me is null then
    -- A player who left can still watch their own finished round.
    select id into v_me from players
    where group_id = r.group_id and auth_uid = auth.uid();
    if v_me is null then perform hearth_raise('not_a_member'); end if;
  end if;

  select * into v_rp from round_players where round_id = r.id and player_id = v_me;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id',  rp.player_id,
      'nickname',   p.nickname,
      'avatar_key', p.avatar_key,
      'is_alive',   rp.is_alive,
      'has_left',   p.has_left,
      'is_host',    p.is_host,
      'turn_index', rp.turn_index,
      'has_acted',  game_has_acted(r.id, r.game_type, rp.player_id),
      -- null unless this viewer is entitled to see it right now
      'role', case when game_role_visible(r.id, r.game_type, v_me, rp.player_id)
                   then rp.role else null end
    ) order by rp.turn_index nulls last, p.joined_at
  ), '[]'::jsonb) into v_players
  from round_players rp
  join players p on p.id = rp.player_id
  where rp.round_id = r.id;

  return jsonb_build_object(
    'round_id',      r.id,
    'group_id',      r.group_id,
    'game_type',     r.game_type,
    'phase',         r.phase,
    'phase_ends_at', r.phase_ends_at,
    -- Clients compute countdowns from this, never the device clock (§8.2).
    'server_time',   now(),
    'day_number',    r.day_number,
    'pending_on',    (select coalesce(jsonb_agg(x), '[]'::jsonb)
                      from unnest(r.pending_on) as x where not hearth_has_left(x)),
    'players',       v_players,
    'public',        game_public_view(r.id, r.game_type),
    'me', jsonb_build_object(
      'player_id', v_me,
      'role',      v_rp.role,
      'is_alive',  coalesce(v_rp.is_alive, false),
      'private',   coalesce(game_private_view(r.id, r.game_type, v_me), '{}'::jsonb)
    ),
    'result',   r.result,
    'settings', r.settings
  );
end $$;

-- ---------------------------------------------------------------
-- advance_if_due / submit_action (§7.3)
-- ---------------------------------------------------------------

create or replace function advance_if_due(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_before text;
begin
  -- Serialises all mutations on this round (§8.3). Several clients calling
  -- this at once is normal: the first advances, the rest see the new phase.
  select * into r from rounds where id = p_round_id for update;
  if not found then perform hearth_raise('round_not_found'); end if;
  if my_player_id(r.group_id) is null
     and not exists (select 1 from players where group_id = r.group_id and auth_uid = auth.uid())
  then perform hearth_raise('not_a_member'); end if;

  v_before := r.phase;

  if hearth_is_due(p_round_id) then
    perform hearth_run_advance(p_round_id);
    select * into r from rounds where id = p_round_id;

    if r.phase is distinct from v_before then
      perform hearth_broadcast('round:' || r.id::text, 'phase_changed',
        jsonb_build_object('phase', r.phase, 'phase_ends_at', r.phase_ends_at));
    end if;
    if r.ended_at is not null then perform hearth_finalise(p_round_id); end if;
  end if;

  return get_my_view(p_round_id);
end $$;

create or replace function submit_action(p_round_id uuid, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_me uuid; v_before text;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then perform hearth_raise('round_not_found'); end if;
  if r.ended_at is not null then perform hearth_raise('wrong_phase'); end if;

  v_me := my_player_id(r.group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  if not exists (select 1 from round_players where round_id = r.id and player_id = v_me) then
    perform hearth_raise('not_a_member');
  end if;

  v_before := r.phase;
  perform game_action(p_round_id, r.game_type, v_me, p_kind, coalesce(p_payload, '{}'::jsonb));

  -- An action can complete the phase; don't make everyone wait for the poll.
  if hearth_is_due(p_round_id) then perform hearth_run_advance(p_round_id); end if;

  select * into r from rounds where id = p_round_id;
  perform hearth_broadcast('round:' || r.id::text, 'player_acted',
    jsonb_build_object('player_id', v_me));
  if r.phase is distinct from v_before then
    perform hearth_broadcast('round:' || r.id::text, 'phase_changed',
      jsonb_build_object('phase', r.phase, 'phase_ends_at', r.phase_ends_at));
  end if;
  if r.ended_at is not null then perform hearth_finalise(p_round_id); end if;

  return get_my_view(p_round_id);
end $$;

create or replace function abort_round(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_me uuid;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found or r.ended_at is not null then return; end if;

  v_me := my_player_id(r.group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  if not (select is_host from players where id = v_me) then perform hearth_raise('not_host'); end if;

  perform hearth_end_round(p_round_id,
    jsonb_build_object('aborted', 'host_aborted', 'reason', 'host_aborted'));
  perform hearth_finalise(p_round_id);
end $$;

-- ---------------------------------------------------------------
-- Round lifecycle
-- ---------------------------------------------------------------

create or replace function start_round(p_group_id uuid, p_game_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid; v_round uuid; v_count int; v_settings jsonb; v_existing uuid;
begin
  v_me := my_player_id(p_group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  if not (select is_host from players where id = v_me) then perform hearth_raise('not_host'); end if;

  select id into v_existing from rounds
  where group_id = p_group_id and ended_at is null limit 1;
  if v_existing is not null then return v_existing; end if;   -- idempotent

  select count(*) into v_count from players
  where group_id = p_group_id and not has_left;
  if v_count < game_min_players(p_game_type) then perform hearth_raise('too_few_players'); end if;
  if v_count > game_max_players(p_game_type) then perform hearth_raise('too_many_players'); end if;

  select settings into v_settings from groups where id = p_group_id;

  insert into rounds (group_id, game_type, phase, settings)
  values (p_group_id, p_game_type, 'setup', coalesce(v_settings, '{}'::jsonb))
  returning id into v_round;

  insert into round_players (round_id, player_id, role)
  select v_round, id, 'unassigned' from players
  where group_id = p_group_id and not has_left;

  perform game_setup(v_round, p_game_type);

  update players set is_ready = false where group_id = p_group_id;
  update groups set last_active_at = now(), expires_at = now() + interval '100 days'
  where id = p_group_id;

  perform hearth_broadcast('group:' || p_group_id::text, 'group',
    jsonb_build_object('type', 'round_started', 'round_id', v_round));
  return v_round;
end $$;
