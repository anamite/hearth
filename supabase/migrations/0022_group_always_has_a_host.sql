-- ---------------------------------------------------------------
-- Hearth — a group is never left without a host
-- Mirrors ensureHost in src/backend/mock/index.ts.
--
-- leave_group hands the badge to the earliest-joined player still here
-- (§19.4), but the last player out has nobody to hand it to. Rejoining then
-- left the group hostless: no settings, no starting a game. Joining now
-- promotes the longest-present player whenever no host is present.
--
-- join_group is re-declared, so it keeps `extensions` on its search path
-- for pgcrypto (see 0019).
-- ---------------------------------------------------------------

create or replace function hearth_ensure_host(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_next uuid;
begin
  if exists (select 1 from players
             where group_id = p_group_id and not has_left and is_host) then
    return;
  end if;
  select id into v_next from players
  where group_id = p_group_id and not has_left
  order by joined_at, id
  limit 1;
  if v_next is not null then
    update players set is_host = true where id = v_next;
  end if;
end $$;

create or replace function join_group(
  p_code text, p_pin text, p_nickname text, p_avatar_key text, p_turnstile_nonce text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_group groups%rowtype;
  v_player players%rowtype;
  v_count int;
  v_ip text;
  v_nickname text;
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
    perform hearth_ensure_host(v_group.id);
    update groups set last_active_at = now(), expires_at = now() + interval '100 days'
    where id = v_group.id;
    perform hearth_broadcast('group:' || v_group.id::text, 'group',
      jsonb_build_object('type', 'players_changed'));
    insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, true);
    return jsonb_build_object(
      'group_id', v_group.id, 'code', v_group.code,
      'display_name', v_group.display_name, 'player_id', v_player.id);
  end if;

  select count(*) into v_count from players where group_id = v_group.id and not has_left;
  if v_count >= 12 then perform hearth_raise('group_full'); end if;

  v_nickname := hearth_clean_nickname(p_nickname);
  if v_nickname is null then perform hearth_raise('bad_nickname'); end if;
  if not (p_avatar_key = any(hearth_avatar_keys())) then perform hearth_raise('invalid_target'); end if;

  begin
    insert into players (group_id, auth_uid, nickname, avatar_key)
    values (v_group.id, auth.uid(), v_nickname, p_avatar_key)
    returning * into v_player;
  exception when unique_violation then
    perform hearth_raise('nickname_taken');
  end;

  perform hearth_ensure_host(v_group.id);
  update groups set last_active_at = now(), expires_at = now() + interval '100 days'
  where id = v_group.id;
  insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, true);

  return jsonb_build_object(
    'group_id', v_group.id, 'code', v_group.code,
    'display_name', v_group.display_name, 'player_id', v_player.id);
end $$;

-- Internal helper stays ungranted, like everything else 0008 locked down.
revoke all on function hearth_ensure_host(uuid) from public, anon, authenticated;
