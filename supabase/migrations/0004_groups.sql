-- ---------------------------------------------------------------
-- Hearth — group and lobby RPCs (spec §7.2, §16, §18)
-- ---------------------------------------------------------------

/** Spec §16.1 — exactly 24 names; narration has a clip for each. */
create or replace function hearth_nickname_pool()
returns text[] language sql immutable as $$
  select array[
    'Baker','Miller','Fletcher','Mason','Cooper','Sawyer',
    'Fox','Wren','Pike','Crow','Hare','Moth',
    'Ash','Birch','Cove','Fern','Reed','Vale',
    'Ember','Frost','Dusk','Flint','Slate','Wick'
  ]
$$;

create or replace function hearth_avatar_keys()
returns text[] language sql immutable as $$
  select array['fox','owl','bear','frog','whale','cat','crow','deer','fish','moth']
$$;

/** Spec §4.2 — 31 characters, ambiguous 0/O/1/I/L excluded. */
create or replace function hearth_gen_code()
returns text language plpgsql volatile as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

create or replace function hearth_gen_display_name()
returns text language plpgsql volatile as $$
declare
  adjectives text[] := array[
    'Amber','Copper','Quiet','Hollow','Velvet','Crimson','Golden','Silver',
    'Restless','Midnight','Wandering','Gentle','Iron','Paper','Salt','Wild',
    'Distant','Bramble','Clover','Marble','Rusted','Drifting','Sunken','Bright'];
  nouns text[] := array[
    'Fox','Lantern','Harbour','Thicket','Compass','Sparrow','Kettle','Orchard',
    'Anchor','Meadow','Chapel','Ferry','Willow','Beacon','Cellar','Bellows',
    'Hollow','Bridge','Almanac','Cinder','Quarry','Tavern','Lighthouse','Kestrel'];
begin
  return adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
      || ' '
      || nouns[1 + floor(random() * array_length(nouns, 1))::int];
end $$;

-- ---------------------------------------------------------------
-- Turnstile nonces (§18.1)
--
-- The Edge Function verifies the token with Cloudflare and inserts a
-- nonce; these functions consume it exactly once.
-- ---------------------------------------------------------------
create or replace function hearth_consume_nonce(p_nonce text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  -- Bot protection is a launch requirement, not a local-dev one. Leave the
  -- table empty during development and every nonce is accepted.
  if not exists (select 1 from turnstile_nonces limit 1) then return; end if;

  update turnstile_nonces set used_at = now()
  where nonce = p_nonce and used_at is null and expires_at > now()
  returning true into v_ok;

  if not coalesce(v_ok, false) then perform hearth_raise('rate_limited'); end if;
end $$;

-- ---------------------------------------------------------------
-- Rate limiting (§18.2)
-- ---------------------------------------------------------------
create or replace function hearth_check_rate(p_ip_hash text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ip int; v_code int;
begin
  select count(*) into v_ip from join_attempts
  where ip_hash = p_ip_hash and not succeeded and created_at > now() - interval '10 minutes';
  if v_ip > 10 then perform hearth_raise('rate_limited'); end if;

  if p_code is not null then
    select count(*) into v_code from join_attempts
    where code = upper(p_code) and not succeeded and created_at > now() - interval '10 minutes';
    if v_code > 20 then perform hearth_raise('rate_limited'); end if;
  end if;
end $$;

/** Never stores a raw IP (§18.2). */
create or replace function hearth_ip_hash()
returns text language plpgsql stable as $$
declare v_ip text;
begin
  begin
    v_ip := coalesce(
      current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip',
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for',
      'unknown');
  exception when others then
    v_ip := 'unknown';
  end;
  return encode(digest(v_ip || ':hearth-join-salt', 'sha256'), 'hex');
end $$;

-- ---------------------------------------------------------------
-- create_group / join_group
-- ---------------------------------------------------------------

create or replace function create_group(
  p_pin text, p_nickname text, p_avatar_key text, p_turnstile_nonce text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_group groups%rowtype;
  v_player_id uuid;
  v_code text;
  i int;
begin
  if auth.uid() is null then perform hearth_raise('not_a_member'); end if;
  if p_pin !~ '^\d{4,6}$' then perform hearth_raise('bad_pin'); end if;
  if not (p_nickname = any(hearth_nickname_pool())) then perform hearth_raise('nickname_taken'); end if;
  if not (p_avatar_key = any(hearth_avatar_keys())) then perform hearth_raise('invalid_target'); end if;

  perform hearth_consume_nonce(p_turnstile_nonce);

  for i in 1..100 loop
    v_code := hearth_gen_code();
    exit when not exists (select 1 from groups where code = v_code);
    v_code := null;
  end loop;
  if v_code is null then perform hearth_raise('group_not_found'); end if;

  insert into groups (code, display_name, pin_hash, settings)
  values (v_code, hearth_gen_display_name(),
          crypt(p_pin, gen_salt('bf')),          -- never plaintext (§4.2)
          hearth_default_settings())
  returning * into v_group;

  insert into players (group_id, auth_uid, nickname, avatar_key, is_host, is_ready)
  values (v_group.id, auth.uid(), p_nickname, p_avatar_key, true, true)
  returning id into v_player_id;

  return jsonb_build_object(
    'group_id', v_group.id, 'code', v_group.code,
    'display_name', v_group.display_name, 'player_id', v_player_id);
end $$;

create or replace function join_group(
  p_code text, p_pin text, p_nickname text, p_avatar_key text, p_turnstile_nonce text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_group groups%rowtype;
  v_player players%rowtype;
  v_count int;
  v_ip text;
begin
  if auth.uid() is null then perform hearth_raise('not_a_member'); end if;
  v_ip := hearth_ip_hash();
  perform hearth_check_rate(v_ip, p_code);
  perform hearth_consume_nonce(p_turnstile_nonce);

  select * into v_group from groups where upper(code) = upper(trim(p_code));
  if not found then
    insert into join_attempts (ip_hash, code, succeeded) values (v_ip, upper(trim(p_code)), false);
    perform hearth_raise('group_not_found');
  end if;

  if v_group.pin_hash <> crypt(p_pin, v_group.pin_hash) then
    insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, false);
    perform hearth_raise('bad_pin');
  end if;

  -- Rejoin path: same device coming back (§7.2).
  select * into v_player from players
  where group_id = v_group.id and auth_uid = auth.uid();
  if found then
    update players set has_left = false, last_seen_at = now() where id = v_player.id;
    update groups set last_active_at = now(), expires_at = now() + interval '100 days'
    where id = v_group.id;
    insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, true);
    return jsonb_build_object(
      'group_id', v_group.id, 'code', v_group.code,
      'display_name', v_group.display_name, 'player_id', v_player.id);
  end if;

  select count(*) into v_count from players where group_id = v_group.id and not has_left;
  if v_count >= 12 then perform hearth_raise('group_full'); end if;

  if not (p_nickname = any(hearth_nickname_pool())) then perform hearth_raise('nickname_taken'); end if;
  if not (p_avatar_key = any(hearth_avatar_keys())) then perform hearth_raise('invalid_target'); end if;

  begin
    insert into players (group_id, auth_uid, nickname, avatar_key)
    values (v_group.id, auth.uid(), p_nickname, p_avatar_key)
    returning * into v_player;
  exception when unique_violation then
    perform hearth_raise('nickname_taken');
  end;

  update groups set last_active_at = now(), expires_at = now() + interval '100 days'
  where id = v_group.id;
  insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, true);

  return jsonb_build_object(
    'group_id', v_group.id, 'code', v_group.code,
    'display_name', v_group.display_name, 'player_id', v_player.id);
end $$;

-- ---------------------------------------------------------------
-- Lobby reads
-- ---------------------------------------------------------------

create or replace function peek_group(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_group groups%rowtype; v_count int;
begin
  select * into v_group from groups where upper(code) = upper(trim(p_code));
  if not found then return null; end if;
  select count(*) into v_count from players where group_id = v_group.id and not has_left;
  -- Deliberately no pin information of any kind.
  return jsonb_build_object('display_name', v_group.display_name, 'player_count', v_count);
end $$;

create or replace function available_nicknames(p_code text)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_free text[];
begin
  select id into v_group from groups where upper(code) = upper(trim(p_code));
  if v_group is null then return hearth_nickname_pool(); end if;

  select coalesce(array_agg(n order by ord), '{}') into v_free
  from unnest(hearth_nickname_pool()) with ordinality as t(n, ord)
  where not exists (select 1 from players p where p.group_id = v_group and p.nickname = t.n);
  return v_free;
end $$;

create or replace function get_lobby(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_group groups%rowtype; v_me players%rowtype; v_round rounds%rowtype; v_players jsonb;
begin
  select * into v_group from groups where upper(code) = upper(trim(p_code));
  if not found then perform hearth_raise('group_not_found'); end if;

  select * into v_me from players where group_id = v_group.id and auth_uid = auth.uid();
  if not found then perform hearth_raise('not_a_member'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id, 'group_id', p.group_id, 'nickname', p.nickname,
    'avatar_key', p.avatar_key, 'is_host', p.is_host, 'is_ready', p.is_ready,
    'has_left', p.has_left, 'joined_at', p.joined_at, 'last_seen_at', p.last_seen_at
  ) order by p.joined_at), '[]'::jsonb) into v_players
  from players p where p.group_id = v_group.id;

  select * into v_round from rounds where group_id = v_group.id and ended_at is null limit 1;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id, 'code', v_group.code, 'display_name', v_group.display_name,
      'settings', v_group.settings, 'created_at', v_group.created_at,
      'expires_at', v_group.expires_at),
    'players', v_players,
    'me', jsonb_build_object(
      'player_id', v_me.id, 'group_id', v_me.group_id, 'nickname', v_me.nickname,
      'avatar_key', v_me.avatar_key, 'is_host', v_me.is_host, 'is_ready', v_me.is_ready,
      'has_left', v_me.has_left, 'joined_at', v_me.joined_at, 'last_seen_at', v_me.last_seen_at),
    'active_round', case when v_round.id is null then null
      else jsonb_build_object('round_id', v_round.id, 'game_type', v_round.game_type) end
  );
end $$;

-- ---------------------------------------------------------------
-- Lobby writes
-- ---------------------------------------------------------------

create or replace function set_ready(p_group_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := my_player_id(p_group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  update players set is_ready = p_ready where id = v_me;
end $$;

create or replace function heartbeat(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := my_player_id(p_group_id);
  if v_me is null then return; end if;
  update players set last_seen_at = now() where id = v_me;
  -- An active group never expires (§18.3).
  update groups set last_active_at = now(), expires_at = now() + interval '100 days'
  where id = p_group_id;
end $$;

create or replace function update_group_settings(p_group_id uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := my_player_id(p_group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  if not (select is_host from players where id = v_me) then perform hearth_raise('not_host'); end if;
  if exists (select 1 from rounds where group_id = p_group_id and ended_at is null) then
    perform hearth_raise('round_active');
  end if;

  update groups set settings = settings || coalesce(p_settings, '{}'::jsonb)
  where id = p_group_id;

  perform hearth_broadcast('group:' || p_group_id::text, 'group',
    jsonb_build_object('type', 'settings_changed'));
end $$;

create or replace function leave_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me players%rowtype; v_next uuid; r rounds%rowtype;
begin
  select * into v_me from players where group_id = p_group_id and auth_uid = auth.uid();
  if not found then perform hearth_raise('not_a_member'); end if;

  update players set has_left = true, is_ready = false where id = v_me.id;

  -- §19.4 — the earliest-joined remaining player is promoted.
  if v_me.is_host then
    update players set is_host = false where id = v_me.id;
    select id into v_next from players
    where group_id = p_group_id and not has_left
    order by joined_at limit 1;
    if v_next is not null then update players set is_host = true where id = v_next; end if;
  end if;

  select * into r from rounds where group_id = p_group_id and ended_at is null for update;
  if found then
    perform hearth_clear_pending(r.id, v_me.id);
    perform game_on_player_left(r.id, r.game_type, v_me.id);
    if not exists (select 1 from rounds where id = r.id and ended_at is not null) then
      perform hearth_run_advance(r.id);
    end if;
    select * into r from rounds where id = r.id;
    if r.ended_at is not null then
      perform hearth_finalise(r.id);
    else
      perform hearth_broadcast('round:' || r.id::text, 'phase_changed',
        jsonb_build_object('phase', r.phase, 'phase_ends_at', r.phase_ends_at));
    end if;
  end if;

  perform hearth_broadcast('group:' || p_group_id::text, 'group',
    jsonb_build_object('type', 'players_changed'));
end $$;

-- ---------------------------------------------------------------
-- History and stats (§20)
-- ---------------------------------------------------------------

create or replace function get_history(p_group_id uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if my_player_id(p_group_id) is null then perform hearth_raise('not_a_member'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'round_id', h.round_id, 'game_type', h.game_type,
      'result', h.result, 'ended_at', h.ended_at) order by h.ended_at desc)
    from (
      select * from games_history
      where group_id = p_group_id order by ended_at desc limit p_limit
    ) h
  ), '[]'::jsonb);
end $$;

create or replace function get_stats(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if my_player_id(p_group_id) is null then perform hearth_raise('not_a_member'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'player_id', s.player_id, 'nickname', p.nickname, 'avatar_key', p.avatar_key,
      'game_type', s.game_type, 'games_played', s.games_played, 'games_won', s.games_won,
      'times_hidden', s.times_hidden, 'times_caught', s.times_caught, 'points', s.points))
    from player_stats s join players p on p.id = s.player_id
    where s.group_id = p_group_id
  ), '[]'::jsonb);
end $$;

create or replace function get_best_score(p_group_id uuid, p_game_type text)
returns int language plpgsql security definer set search_path = public as $$
begin
  if my_player_id(p_group_id) is null then perform hearth_raise('not_a_member'); end if;
  return (select max((result ->> 'total_score')::int) from games_history
          where group_id = p_group_id and game_type = p_game_type
            and result ? 'total_score');
end $$;

-- ---------------------------------------------------------------
-- Default settings (§5.1)
-- ---------------------------------------------------------------
create or replace function hearth_default_settings()
returns jsonb language sql immutable as $$
  select '{
    "fake_artist": {
      "strokes_per_player": 2, "canvas_mode": true, "vote_delay_seconds": 60,
      "allow_reroll": true, "impostor_guess_seconds": 15
    },
    "night_village": {
      "discussion_seconds": 240, "include_seer": true, "include_doctor": true,
      "doctor_self_protect": "once", "reveal_role_on_death": true,
      "night_action_seconds": 45
    },
    "dial": { "rounds_per_game": null, "clue_seconds": 60, "discussion_seconds": 120 }
  }'::jsonb
$$;
