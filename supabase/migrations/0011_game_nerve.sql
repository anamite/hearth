-- ---------------------------------------------------------------
-- Hearth — Nerve
-- Mirrors src/backend/mock/games/nerve.ts, function for function.
--
-- The scraps themselves are the one thing this server never sees. It
-- tracks how many are on the table and what was claimed out loud; whether
-- a scrap is a dot or the X is reported by whoever turned it over, in
-- front of everybody, exactly as it works on a real table.
-- ---------------------------------------------------------------

create or replace function nerve_order(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg((e #>> '{}')::uuid order by ord), '{}')
  from rounds r,
       jsonb_array_elements(coalesce(r.state -> 'order', '[]'::jsonb)) with ordinality as u(e, ord)
  where r.id = p_round_id
$$;

create or replace function nerve_held(p_round_id uuid, p_player_id uuid)
returns int language sql security definer set search_path = public as $$
  select coalesce((state -> 'held' ->> p_player_id::text)::int, 0)
  from rounds where id = p_round_id
$$;

create or replace function nerve_pile(p_round_id uuid, p_player_id uuid)
returns int language sql security definer set search_path = public as $$
  select coalesce((state -> 'pile' ->> p_player_id::text)::int, 0)
  from rounds where id = p_round_id
$$;

create or replace function nerve_flipped(p_round_id uuid, p_player_id uuid)
returns int language sql security definer set search_path = public as $$
  select coalesce((state -> 'flipped' ->> p_player_id::text)::int, 0)
  from rounds where id = p_round_id
$$;

/** Still here, still holding scraps. */
create or replace function nerve_in_play(p_round_id uuid, p_player_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select not hearth_has_left(p_player_id) and nerve_held(p_round_id, p_player_id) > 0
$$;

create or replace function nerve_players_in_play(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(x order by ord), '{}')
  from unnest(nerve_order(p_round_id)) with ordinality as u(x, ord)
  where nerve_in_play(p_round_id, x)
$$;

/** Everyone who has not yet passed out of the bidding. */
create or replace function nerve_contenders(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(u.x order by u.ord), '{}')
  from rounds r, unnest(nerve_players_in_play(p_round_id)) with ordinality as u(x, ord)
  where r.id = p_round_id
    and not (coalesce(r.state -> 'passed', '[]'::jsonb) @> to_jsonb(u.x::text))
$$;

/** Scraps face down right now — the ceiling on any bid. */
create or replace function nerve_table_total(p_round_id uuid)
returns int language sql security definer set search_path = public as $$
  select coalesce(sum(nerve_pile(p_round_id, x))::int, 0)
  from unnest(nerve_players_in_play(p_round_id)) as x
$$;

create or replace function nerve_bid_amount(p_round_id uuid)
returns int language sql security definer set search_path = public as $$
  select case when state -> 'bid' is null or state -> 'bid' = 'null'::jsonb then null
              else (state -> 'bid' ->> 'amount')::int end
  from rounds where id = p_round_id
$$;

create or replace function nerve_bid_player(p_round_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select case when state -> 'bid' is null or state -> 'bid' = 'null'::jsonb then null
              else (state -> 'bid' ->> 'player_id')::uuid end
  from rounds where id = p_round_id
$$;

/** Next contender after `p_from` in seating order. */
create or replace function nerve_next_contender(p_round_id uuid, p_from uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_pool uuid[]; v_n int; v_start int; i int; v_id uuid;
begin
  v_pool := nerve_contenders(p_round_id);
  if coalesce(array_length(v_pool, 1), 0) = 0 then return null; end if;

  v_ids := nerve_order(p_round_id);
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return v_pool[1]; end if;

  v_start := coalesce(array_position(v_ids, p_from), 0); -- 1-based, 0 when absent
  for i in 1..v_n loop
    v_id := v_ids[1 + ((v_start - 1 + i + v_n) % v_n)];
    if v_id = any(v_pool) then return v_id; end if;
  end loop;
  return v_pool[1];
end $$;

create or replace function nerve_wins_needed(p_round_id uuid)
returns int language sql security definer set search_path = public as $$
  select coalesce((settings #>> '{nerve,wins_needed}')::int, 2) from rounds where id = p_round_id
$$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function nerve_finish(p_round_id uuid, p_winner uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(x order by x.wins desc, x.scraps desc), '[]'::jsonb) into v_standings
  from (
    select u.x::text as player_id,
           coalesce((r.state -> 'wins' ->> u.x::text)::int, 0) as wins,
           nerve_held(p_round_id, u.x) as scraps
    from unnest(nerve_order(p_round_id)) as u(x)
    where not hearth_has_left(u.x)) x;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'winner_id', case when p_winner is null then 'null'::jsonb else to_jsonb(p_winner::text) end,
    'reason', p_reason,
    'wins_needed', nerve_wins_needed(p_round_id),
    'standings', v_standings,
    'history', coalesce(r.state -> 'history', '[]'::jsonb)));
end $$;

create or replace function nerve_begin_round(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_playing uuid[]; v_id uuid; v_secs int; v_starter uuid;
  v_pile jsonb := '{}'::jsonb; v_flipped jsonb := '{}'::jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_playing := nerve_players_in_play(p_round_id);

  if coalesce(array_length(v_playing, 1), 0) < 2 then
    perform nerve_finish(p_round_id, v_playing[1], 'last_standing');
    return;
  end if;

  foreach v_id in array v_playing loop
    v_pile := v_pile || jsonb_build_object(v_id::text, 0);
    v_flipped := v_flipped || jsonb_build_object(v_id::text, 0);
  end loop;

  v_starter := (r.state ->> 'starter')::uuid;
  if v_starter is null or not (v_starter = any(v_playing)) then v_starter := v_playing[1]; end if;

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'pile', v_pile, 'flipped', v_flipped, 'passed', '[]'::jsonb,
    'bid', null, 'challenger', null, 'flips_done', 0, 'turn', null,
    'starter', v_starter::text));

  select coalesce((settings #>> '{nerve,place_seconds}')::int, 30) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'place', v_secs, v_playing);
end $$;

create or replace function nerve_enter_round_end(p_round_id uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_challenger uuid; v_bid int; v_record jsonb;
  v_wins jsonb; v_held jsonb; v_starter uuid;
begin
  select * into r from rounds where id = p_round_id;
  v_challenger := (r.state ->> 'challenger')::uuid;
  v_bid := coalesce(nerve_bid_amount(p_round_id), 0);

  v_wins := coalesce(r.state -> 'wins', '{}'::jsonb);
  v_held := coalesce(r.state -> 'held', '{}'::jsonb);

  if p_outcome = 'made' and v_challenger is not null then
    v_wins := v_wins || jsonb_build_object(
      v_challenger::text, coalesce((v_wins ->> v_challenger::text)::int, 0) + 1);
  end if;
  if p_outcome in ('hit_x', 'no_flip') and v_challenger is not null then
    -- One scrap gone for good. Which one is the table's business, not ours.
    v_held := v_held || jsonb_build_object(
      v_challenger::text,
      greatest(0, coalesce((v_held ->> v_challenger::text)::int, 0) - 1));
  end if;

  v_record := jsonb_build_object(
    'round_no', coalesce((r.state ->> 'round_no')::int, 1),
    'challenger_id', case when v_challenger is null then 'null'::jsonb
                          else to_jsonb(v_challenger::text) end,
    'bid', v_bid,
    'flips_done', coalesce((r.state ->> 'flips_done')::int, 0),
    'outcome', p_outcome);

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'wins', v_wins, 'held', v_held,
    'last', v_record,
    'history', coalesce(r.state -> 'history', '[]'::jsonb) || jsonb_build_array(v_record)));

  -- Whoever took the challenge starts the next round.
  if v_challenger is not null and nerve_in_play(p_round_id, v_challenger) then
    v_starter := v_challenger;
  else
    v_starter := coalesce(
      nerve_next_contender(p_round_id, (r.state ->> 'starter')::uuid),
      (nerve_players_in_play(p_round_id))[1],
      (r.state ->> 'starter')::uuid);
  end if;
  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'starter', case when v_starter is null then 'null'::jsonb else to_jsonb(v_starter::text) end));

  perform hearth_set_phase(p_round_id, 'round_end', 8, '{}'::uuid[]);
end $$;

create or replace function nerve_begin_turns(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_pool uuid[]; v_turn uuid; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  v_pool := nerve_contenders(p_round_id);
  if coalesce(array_length(v_pool, 1), 0) = 0 then
    perform nerve_enter_round_end(p_round_id, 'abandoned');
    return;
  end if;

  v_turn := (r.state ->> 'starter')::uuid;
  if v_turn is null or not (v_turn = any(v_pool)) then v_turn := v_pool[1]; end if;

  perform hearth_patch_state(p_round_id, jsonb_build_object('turn', v_turn::text));
  select coalesce((settings #>> '{nerve,turn_seconds}')::int, 45) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'turn', v_secs, array[v_turn]);
end $$;

/** After any turn action: either the challenge is settled, or play moves on. */
create or replace function nerve_after_turn(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_pool uuid[]; v_bidder uuid; v_turn uuid; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  v_bidder := nerve_bid_player(p_round_id);
  v_pool := nerve_contenders(p_round_id);
  select coalesce((settings #>> '{nerve,turn_seconds}')::int, 45) into v_secs
  from rounds where id = p_round_id;

  -- The high bidder walked out from under their own claim.
  if v_bidder is not null and not nerve_in_play(p_round_id, v_bidder) then
    perform nerve_enter_round_end(p_round_id, 'abandoned');
    return;
  end if;

  if v_bidder is not null and coalesce(array_length(v_pool, 1), 0) <= 1 then
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'challenger', v_bidder::text, 'flips_done', 0));
    perform hearth_set_phase(p_round_id, 'flip', v_secs, array[v_bidder]);
    return;
  end if;

  if coalesce(array_length(v_pool, 1), 0) = 0 then
    perform nerve_enter_round_end(p_round_id, 'abandoned');
    return;
  end if;

  v_turn := nerve_next_contender(p_round_id, (r.state ->> 'turn')::uuid);
  if v_turn is null then
    perform nerve_enter_round_end(p_round_id, 'abandoned');
    return;
  end if;
  perform hearth_patch_state(p_round_id, jsonb_build_object('turn', v_turn::text));
  perform hearth_set_phase(p_round_id, 'turn', v_secs, array[v_turn]);
end $$;

create or replace function nerve_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_id uuid; i int := 0;
  v_order jsonb := '[]'::jsonb; v_held jsonb := '{}'::jsonb; v_wins jsonb := '{}'::jsonb;
begin
  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players set turn_index = i, role = 'player', private = '{}'::jsonb
    where round_id = p_round_id and player_id = v_id;
    v_order := v_order || jsonb_build_array(v_id::text);
    i := i + 1;
  end loop;
  update round_players set turn_index = null
  where round_id = p_round_id and not (player_id = any(v_ids));

  for v_id in select player_id from round_players where round_id = p_round_id loop
    v_held := v_held || jsonb_build_object(v_id::text, 4);
    v_wins := v_wins || jsonb_build_object(v_id::text, 0);
  end loop;

  update rounds set state = jsonb_build_object(
    'order', v_order, 'held', v_held, 'wins', v_wins,
    'pile', '{}'::jsonb, 'flipped', '{}'::jsonb, 'passed', '[]'::jsonb,
    'bid', null, 'turn', null, 'challenger', null, 'flips_done', 0,
    'round_no', 1, 'starter', v_ids[1]::text,
    'history', '[]'::jsonb, 'last', null)
  where id = p_round_id;

  perform nerve_begin_round(p_round_id);
end $$;

create or replace function nerve_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_id uuid; v_me uuid; v_bid int; v_bidder uuid;
  v_pile jsonb; v_passed jsonb; v_floor int; v_champion uuid; v_playing uuid[];
begin
  select * into r from rounds where id = p_round_id;

  case r.phase
    when 'place' then
      -- §19.2 — a scrap goes down for anyone who did not place one.
      v_pile := coalesce(r.state -> 'pile', '{}'::jsonb);
      foreach v_id in array nerve_players_in_play(p_round_id) loop
        if coalesce((v_pile ->> v_id::text)::int, 0) = 0 then
          v_pile := v_pile || jsonb_build_object(v_id::text, 1);
        end if;
      end loop;
      perform hearth_patch_state(p_round_id, jsonb_build_object('pile', v_pile));
      perform nerve_begin_turns(p_round_id);

    when 'turn' then
      v_me := (r.state ->> 'turn')::uuid;
      if v_me is null then perform nerve_begin_turns(p_round_id); return; end if;

      v_bid := nerve_bid_amount(p_round_id);
      v_bidder := nerve_bid_player(p_round_id);
      v_passed := coalesce(r.state -> 'passed', '[]'::jsonb);

      if v_bid is not null and v_bidder is distinct from v_me then
        if not (v_passed @> to_jsonb(v_me::text)) then
          perform hearth_patch_state(p_round_id, jsonb_build_object(
            'passed', v_passed || jsonb_build_array(v_me::text)));
        end if;
      elsif v_bid is null
            and nerve_pile(p_round_id, v_me) < nerve_held(p_round_id, v_me) then
        perform hearth_patch_state(p_round_id, jsonb_build_object(
          'pile', coalesce(r.state -> 'pile', '{}'::jsonb)
                  || jsonb_build_object(v_me::text, nerve_pile(p_round_id, v_me) + 1)));
      else
        -- Nothing left to place and no claim to hide behind: the clock
        -- makes the smallest legal claim on their behalf.
        v_floor := coalesce(v_bid, 0) + 1;
        if v_floor <= nerve_table_total(p_round_id) then
          perform hearth_patch_state(p_round_id, jsonb_build_object(
            'bid', jsonb_build_object('player_id', v_me::text, 'amount', v_floor)));
        elsif not (v_passed @> to_jsonb(v_me::text)) then
          perform hearth_patch_state(p_round_id, jsonb_build_object(
            'passed', v_passed || jsonb_build_array(v_me::text)));
        end if;
      end if;
      perform nerve_after_turn(p_round_id);

    when 'flip' then
      -- Did not flip in time — treated exactly like turning over an X.
      perform nerve_enter_round_end(p_round_id, 'no_flip');

    when 'round_end' then
      select u.x into v_champion
      from unnest(nerve_order(p_round_id)) as u(x)
      where coalesce((r.state -> 'wins' ->> u.x::text)::int, 0) >= nerve_wins_needed(p_round_id)
      limit 1;

      if v_champion is not null then
        perform nerve_finish(p_round_id, v_champion, 'wins');
        return;
      end if;

      v_playing := nerve_players_in_play(p_round_id);
      if coalesce(array_length(v_playing, 1), 0) < 2 then
        perform nerve_finish(p_round_id, v_playing[1], 'last_standing');
        return;
      end if;

      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'round_no', coalesce((r.state ->> 'round_no')::int, 1) + 1));
      perform nerve_begin_round(p_round_id);

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function nerve_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_base jsonb;
begin
  select * into r from rounds where id = p_round_id;

  -- All of it is public: this game's only hidden information is on paper
  -- and in people's faces.
  v_base := jsonb_build_object(
    'round_no', coalesce((r.state ->> 'round_no')::int, 1),
    'wins_needed', nerve_wins_needed(p_round_id),
    'scraps_per_player', 4,
    'order', coalesce(r.state -> 'order', '[]'::jsonb),
    'held', coalesce(r.state -> 'held', '{}'::jsonb),
    'wins', coalesce(r.state -> 'wins', '{}'::jsonb),
    'pile', coalesce(r.state -> 'pile', '{}'::jsonb),
    'flipped', coalesce(r.state -> 'flipped', '{}'::jsonb),
    'passed', coalesce(r.state -> 'passed', '[]'::jsonb),
    'bid', r.state -> 'bid',
    'table_total', nerve_table_total(p_round_id),
    'turn', r.state -> 'turn',
    'challenger', r.state -> 'challenger',
    'flips_done', coalesce((r.state ->> 'flips_done')::int, 0),
    'history', coalesce(r.state -> 'history', '[]'::jsonb),
    'last', r.state -> 'last');

  if r.phase = 'place' then
    return v_base || jsonb_build_object('turn', null, 'challenger', null);
  end if;
  return v_base;
end $$;

create or replace function nerve_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language sql immutable as $$
  select '{}'::jsonb -- by design: the server holds no secret of yours
$$;

create or replace function nerve_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'place' then
      return not nerve_in_play(p_round_id, p_player_id)
             or nerve_pile(p_round_id, p_player_id) > 0;
    when 'turn' then
      return p_player_id is distinct from (r.state ->> 'turn')::uuid;
    when 'flip' then
      return p_player_id is distinct from (r.state ->> 'challenger')::uuid;
    else return true;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function nerve_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_amount int; v_floor int; v_passed jsonb;
  v_target uuid; v_done int;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'place' and p_kind = 'place' then
    if not nerve_in_play(p_round_id, p_player_id) then perform hearth_raise('not_your_turn'); end if;
    if nerve_pile(p_round_id, p_player_id) > 0 then perform hearth_raise('already_acted'); end if;
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'pile', coalesce(r.state -> 'pile', '{}'::jsonb)
              || jsonb_build_object(p_player_id::text, 1)));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'turn' then
    if p_player_id is distinct from (r.state ->> 'turn')::uuid then
      perform hearth_raise('not_your_turn');
    end if;

    if p_kind = 'place' then
      -- Once a number has been said out loud, no more scraps go down.
      if nerve_bid_amount(p_round_id) is not null then perform hearth_raise('wrong_phase'); end if;
      if nerve_pile(p_round_id, p_player_id) >= nerve_held(p_round_id, p_player_id) then
        perform hearth_raise('invalid_target');
      end if;
      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'pile', coalesce(r.state -> 'pile', '{}'::jsonb)
                || jsonb_build_object(p_player_id::text,
                                      nerve_pile(p_round_id, p_player_id) + 1)));
      perform nerve_after_turn(p_round_id);
      return;
    end if;

    if p_kind = 'bid' then
      v_amount := trunc(coalesce((p_payload ->> 'amount')::numeric, 0))::int;
      v_floor := coalesce(nerve_bid_amount(p_round_id), 0) + 1;
      if v_amount < v_floor or v_amount > nerve_table_total(p_round_id) then
        perform hearth_raise('invalid_target');
      end if;

      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_passed
      from jsonb_array_elements(coalesce(r.state -> 'passed', '[]'::jsonb)) e
      where e <> to_jsonb(p_player_id::text);

      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'bid', jsonb_build_object('player_id', p_player_id::text, 'amount', v_amount),
        'passed', v_passed));
      perform nerve_after_turn(p_round_id);
      return;
    end if;

    if p_kind = 'pass' then
      -- There is nothing to pass on until somebody has claimed a number.
      if nerve_bid_amount(p_round_id) is null then perform hearth_raise('wrong_phase'); end if;
      if nerve_bid_player(p_round_id) = p_player_id then perform hearth_raise('invalid_target'); end if;
      v_passed := coalesce(r.state -> 'passed', '[]'::jsonb);
      if not (v_passed @> to_jsonb(p_player_id::text)) then
        perform hearth_patch_state(p_round_id, jsonb_build_object(
          'passed', v_passed || jsonb_build_array(p_player_id::text)));
      end if;
      perform nerve_after_turn(p_round_id);
      return;
    end if;
  end if;

  if r.phase = 'flip' and p_kind = 'flip' then
    if p_player_id is distinct from (r.state ->> 'challenger')::uuid then
      perform hearth_raise('not_your_turn');
    end if;

    begin
      v_target := (p_payload ->> 'target_id')::uuid;
    exception when others then
      perform hearth_raise('invalid_target');
    end;
    if v_target is null
       or not exists (select 1 from round_players
                      where round_id = p_round_id and player_id = v_target) then
      perform hearth_raise('invalid_target');
    end if;
    if nerve_flipped(p_round_id, v_target) >= nerve_pile(p_round_id, v_target) then
      perform hearth_raise('invalid_target');
    end if;
    -- Your own stack first, top down — no cherry-picking other people
    -- while your own X is still buried.
    if nerve_flipped(p_round_id, p_player_id) < nerve_pile(p_round_id, p_player_id)
       and v_target is distinct from p_player_id then
      perform hearth_raise('invalid_target');
    end if;

    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'flipped', coalesce(r.state -> 'flipped', '{}'::jsonb)
                 || jsonb_build_object(v_target::text,
                                       nerve_flipped(p_round_id, v_target) + 1)));

    if coalesce((p_payload ->> 'hit')::boolean, false) then
      perform nerve_enter_round_end(p_round_id, 'hit_x');
      return;
    end if;

    v_done := coalesce((r.state ->> 'flips_done')::int, 0) + 1;
    perform hearth_patch_state(p_round_id, jsonb_build_object('flips_done', v_done));
    if v_done >= coalesce(nerve_bid_amount(p_round_id), 0) then
      perform nerve_enter_round_end(p_round_id, 'made');
      return;
    end if;

    -- Still going: the same player keeps the phase, with a fresh clock.
    perform hearth_set_phase(p_round_id, 'flip',
      coalesce((r.settings #>> '{nerve,turn_seconds}')::int, 45), array[p_player_id]);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function nerve_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_passed jsonb; v_was_challenger boolean; v_was_bidder boolean;
begin
  perform hearth_clear_pending(p_round_id, p_player_id);

  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 3 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;

  select * into r from rounds where id = p_round_id;
  if r.phase = 'result' or r.ended_at is not null then return; end if;

  v_was_challenger := (r.state ->> 'challenger')::uuid is not distinct from p_player_id;
  v_was_bidder := nerve_bid_player(p_round_id) is not distinct from p_player_id;

  -- Their scraps leave the table with them.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_passed
  from jsonb_array_elements(coalesce(r.state -> 'passed', '[]'::jsonb)) e
  where e <> to_jsonb(p_player_id::text);

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'pile', coalesce(r.state -> 'pile', '{}'::jsonb) || jsonb_build_object(p_player_id::text, 0),
    'flipped', coalesce(r.state -> 'flipped', '{}'::jsonb) || jsonb_build_object(p_player_id::text, 0),
    'passed', v_passed));

  if v_was_challenger or v_was_bidder then
    -- The claim on the table belonged to them: void the round rather than
    -- hand somebody else a challenge they never took.
    perform hearth_patch_state(p_round_id,
      jsonb_build_object('challenger', null, 'bid', null));
    perform nerve_enter_round_end(p_round_id, 'abandoned');
    return;
  end if;

  if r.phase = 'turn' and (r.state ->> 'turn')::uuid is not distinct from p_player_id then
    perform nerve_after_turn(p_round_id);
    return;
  end if;
  -- In `place`, the engine ends the phase once everyone still here has placed.
end $$;

create or replace function nerve_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    v_won := case when (p_result ->> 'winner_id') is not distinct from (e ->> 'player_id')
                  then 1 else 0 end;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'nerve',
      1, v_won, 0, 0, coalesce((e ->> 'wins')::int, 0));
  end loop;
end $$;
