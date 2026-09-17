-- ---------------------------------------------------------------
-- Hearth — players may type their own name
-- Mirrors cleanNickname in src/lib/text.ts and validateNickname in
-- src/backend/mock/index.ts.
--
-- The 24 pool names stay as quick picks (narration has a clip for each).
-- A typed name is trimmed, whitespace-collapsed, 2–15 characters, and free
-- of control or invisible formatting characters. A name that matches a pool
-- name in any case takes the pool's spelling. Names are unique within a
-- group regardless of case. Narration skips names it has no clip for.
--
-- A forward migration because 0004 has already been applied.
-- ---------------------------------------------------------------

/** The cleaned name, or null if it breaks the rules. */
create or replace function hearth_clean_nickname(p_nickname text)
returns text language plpgsql immutable set search_path = public as $$
declare v text; v_pool text;
begin
  v := trim(regexp_replace(normalize(coalesce(p_nickname, ''), NFC), '\s+', ' ', 'g'));
  if char_length(v) < 2 or char_length(v) > 15 then return null; end if;
  -- Zero-width joiner (U+200D) stays allowed: emoji sequences need it.
  if v ~ '[\x01-\x1F\x7F-\x9F­؜᠎​‌‎‏‪-‮⁠-⁤﻿￹-￻]' then
    return null;
  end if;
  select n into v_pool from unnest(hearth_nickname_pool()) as n where lower(n) = lower(v);
  return coalesce(v_pool, v);
end $$;

-- Case-insensitive uniqueness. Existing rows can only hold pool names, which
-- differ from each other in more than case, so this cannot fail on old data.
create unique index if not exists players_group_nickname_ci
  on players (group_id, lower(nickname));

create or replace function create_group(
  p_pin text, p_nickname text, p_avatar_key text, p_turnstile_nonce text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_group groups%rowtype;
  v_player_id uuid;
  v_code text;
  v_nickname text;
  i int;
begin
  if auth.uid() is null then perform hearth_raise('not_a_member'); end if;
  if p_pin !~ '^\d{4,6}$' then perform hearth_raise('bad_pin'); end if;
  v_nickname := hearth_clean_nickname(p_nickname);
  if v_nickname is null then perform hearth_raise('bad_nickname'); end if;
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
  values (v_group.id, auth.uid(), v_nickname, p_avatar_key, true, true)
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
    update groups set last_active_at = now(), expires_at = now() + interval '100 days'
    where id = v_group.id;
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

  update groups set last_active_at = now(), expires_at = now() + interval '100 days'
  where id = v_group.id;
  insert into join_attempts (ip_hash, code, succeeded) values (v_ip, v_group.code, true);

  return jsonb_build_object(
    'group_id', v_group.id, 'code', v_group.code,
    'display_name', v_group.display_name, 'player_id', v_player.id);
end $$;

create or replace function available_nicknames(p_code text)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_free text[];
begin
  select id into v_group from groups where upper(code) = upper(trim(p_code));
  if v_group is null then return hearth_nickname_pool(); end if;

  select coalesce(array_agg(n order by ord), '{}') into v_free
  from unnest(hearth_nickname_pool()) with ordinality as t(n, ord)
  where not exists (select 1 from players p
                    where p.group_id = v_group and lower(p.nickname) = lower(t.n));
  return v_free;
end $$;

-- Internal helper stays ungranted, like everything else 0008 locked down.
revoke all on function hearth_clean_nickname(text) from public, anon, authenticated;
