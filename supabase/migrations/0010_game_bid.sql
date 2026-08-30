-- ---------------------------------------------------------------
-- Hearth — Bid
-- Mirrors src/backend/mock/games/bid.ts, function for function.
--
-- Fifteen slips, fifteen prizes. Tied high bids cancel: both players
-- still burn the slip, and the prize falls through to the next value.
-- ---------------------------------------------------------------

/** -5..-1 and +1..+10 — five penalties among ten rewards, shuffled. */
create or replace function bid_build_prizes()
returns jsonb language sql volatile as $$
  select coalesce(jsonb_agg(v order by random()), '[]'::jsonb)
  from (
    select g as v from generate_series(1, 10) g
    union all
    select -g from generate_series(1, 5) g) s(v)
$$;

create or replace function bid_remaining(p_round_id uuid, p_player_id uuid)
returns int[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(g.n order by g.n), '{}')
  from rounds r, generate_series(1, 15) g(n)
  where r.id = p_round_id
    and not (coalesce(r.state -> 'spent' -> p_player_id::text, '[]'::jsonb) @> to_jsonb(g.n))
$$;

/** The slip this player has face down for the prize on the table. */
create or replace function bid_current(p_round_id uuid, p_player_id uuid)
returns int language sql security definer set search_path = public as $$
  select (hearth_action_payload(
            p_round_id, 'bid',
            'bid:' || coalesce((r.state ->> 'index')::int, 0),
            p_player_id) ->> 'slip')::int
  from rounds r where r.id = p_round_id
$$;

/**
 * The whole game in one function.
 *
 * A positive prize goes to the highest bid, a negative one to the lowest.
 * Any value two or more players played is struck out entirely and the
 * prize falls through. If every value is contested it goes nowhere.
 */
create or replace function bid_resolve(p_prize int, p_bids jsonb)
returns jsonb language plpgsql immutable as $$
declare rec record; v_cancelled jsonb := '[]'::jsonb;
begin
  for rec in
    select s.slip, count(*) as n, min(s.pid) as who
    from (select key as pid, (value #>> '{}')::int as slip
          from jsonb_each(coalesce(p_bids, '{}'::jsonb))) s
    group by s.slip
    order by case when p_prize < 0 then s.slip else -s.slip end
  loop
    if rec.n = 1 then
      return jsonb_build_object('winner_id', rec.who, 'cancelled', v_cancelled);
    end if;
    v_cancelled := v_cancelled || to_jsonb(rec.slip);
  end loop;
  return jsonb_build_object('winner_id', null, 'cancelled', v_cancelled);
end $$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function bid_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb; v_best int;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(x order by x.score desc), '[]'::jsonb) into v_standings
  from (
    select rp.player_id::text as player_id,
           coalesce((r.state -> 'scores' ->> rp.player_id::text)::int, 0) as score,
           coalesce(r.state -> 'won' -> rp.player_id::text, '[]'::jsonb) as prizes
    from round_players rp
    where rp.round_id = p_round_id and not hearth_has_left(rp.player_id)) x;

  select coalesce(max((e ->> 'score')::int), 0) into v_best
  from jsonb_array_elements(v_standings) e;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'standings', v_standings,
    'winners', coalesce((select jsonb_agg(e -> 'player_id')
                         from jsonb_array_elements(v_standings) e
                         where (e ->> 'score')::int = v_best), '[]'::jsonb),
    'best_score', v_best,
    'history', coalesce(r.state -> 'history', '[]'::jsonb)));
end $$;

create or replace function bid_begin_bid(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_index int; v_secs int; v_waiting uuid[];
begin
  select coalesce((state ->> 'index')::int, 0) into v_index from rounds where id = p_round_id;
  if v_index >= 15 then perform bid_finish(p_round_id); return; end if;

  select coalesce(array_agg(rp.player_id order by rp.turn_index), '{}') into v_waiting
  from round_players rp
  where rp.round_id = p_round_id
    and not hearth_has_left(rp.player_id)
    and coalesce(array_length(bid_remaining(p_round_id, rp.player_id), 1), 0) > 0;

  if coalesce(array_length(v_waiting, 1), 0) = 0 then perform bid_finish(p_round_id); return; end if;

  select coalesce((settings #>> '{bid,bid_seconds}')::int, 30) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'bid', v_secs, v_waiting);
end $$;

create or replace function bid_enter_reveal(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; rec record; v_index int; v_prize int; v_secs int;
  v_bids jsonb := '{}'::jsonb; v_rem int[]; v_chosen int;
  v_res jsonb; v_winner text; v_spent jsonb; v_scores jsonb; v_won jsonb;
  v_new jsonb; v_record jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_index := coalesce((r.state ->> 'index')::int, 0);
  v_prize := (r.state -> 'prizes' ->> v_index)::int;

  -- §19.2 — a player who never chose plays their lowest remaining slip.
  -- Uniform in both directions, so it is a rule players can plan around.
  for rec in
    select rp.player_id from round_players rp
    where rp.round_id = p_round_id and not hearth_has_left(rp.player_id)
    order by rp.turn_index
  loop
    v_rem := bid_remaining(p_round_id, rec.player_id);
    if coalesce(array_length(v_rem, 1), 0) = 0 then continue; end if;
    v_chosen := bid_current(p_round_id, rec.player_id);
    if v_chosen is null or not (v_chosen = any(v_rem)) then v_chosen := v_rem[1]; end if;
    v_bids := v_bids || jsonb_build_object(rec.player_id::text, v_chosen);
  end loop;

  v_res := bid_resolve(v_prize, v_bids);
  v_winner := v_res ->> 'winner_id';

  -- Every slip played is burned, won or lost.
  v_spent := coalesce(r.state -> 'spent', '{}'::jsonb);
  for rec in select key as pid, (value #>> '{}')::int as slip from jsonb_each(v_bids) loop
    select coalesce(jsonb_agg(u.x order by u.x), '[]'::jsonb) into v_new
    from (
      select (e #>> '{}')::int as x
      from jsonb_array_elements(coalesce(v_spent -> rec.pid, '[]'::jsonb)) e
      union all
      select rec.slip) u(x);
    v_spent := v_spent || jsonb_build_object(rec.pid, v_new);
  end loop;

  v_scores := coalesce(r.state -> 'scores', '{}'::jsonb);
  v_won := coalesce(r.state -> 'won', '{}'::jsonb);
  if v_winner is not null then
    v_scores := v_scores || jsonb_build_object(
      v_winner, coalesce((v_scores ->> v_winner)::int, 0) + v_prize);
    v_won := v_won || jsonb_build_object(
      v_winner, coalesce(v_won -> v_winner, '[]'::jsonb) || to_jsonb(v_prize));
  end if;

  v_record := jsonb_build_object(
    'prize', v_prize, 'bids', v_bids,
    'winner_id', v_res -> 'winner_id', 'cancelled', v_res -> 'cancelled');

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'spent', v_spent, 'scores', v_scores, 'won', v_won,
    'last', v_record,
    'history', coalesce(r.state -> 'history', '[]'::jsonb) || jsonb_build_array(v_record)));

  select coalesce((settings #>> '{bid,reveal_seconds}')::int, 8) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'reveal', v_secs, '{}'::uuid[]);
end $$;

create or replace function bid_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_id uuid; i int := 0;
  v_spent jsonb := '{}'::jsonb; v_scores jsonb := '{}'::jsonb; v_won jsonb := '{}'::jsonb;
begin
  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players set turn_index = i, role = 'player', private = '{}'::jsonb
    where round_id = p_round_id and player_id = v_id;
    i := i + 1;
  end loop;
  update round_players set turn_index = null
  where round_id = p_round_id and not (player_id = any(v_ids));

  for v_id in select player_id from round_players where round_id = p_round_id loop
    v_spent := v_spent || jsonb_build_object(v_id::text, '[]'::jsonb);
    v_scores := v_scores || jsonb_build_object(v_id::text, 0);
    v_won := v_won || jsonb_build_object(v_id::text, '[]'::jsonb);
  end loop;

  -- The prize order is SECRET past the current index.
  update rounds set state = jsonb_build_object(
    'prizes', bid_build_prizes(), 'index', 0,
    'spent', v_spent, 'scores', v_scores, 'won', v_won,
    'history', '[]'::jsonb, 'last', null)
  where id = p_round_id;

  perform bid_begin_bid(p_round_id);
end $$;

create or replace function bid_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_next int;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'bid' then
      perform bid_enter_reveal(p_round_id);

    when 'reveal' then
      v_next := coalesce((r.state ->> 'index')::int, 0) + 1;
      perform hearth_patch_state(p_round_id, jsonb_build_object('index', v_next));
      if v_next >= 15 then
        perform bid_finish(p_round_id);
      else
        perform bid_begin_bid(p_round_id);
      end if;

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function bid_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_index int; v_base jsonb; v_left jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_index := coalesce((r.state ->> 'index')::int, 0);

  -- Which prizes are still to come, as a set: the values are known from
  -- the start, their order is not.
  select coalesce(jsonb_agg(e order by (e #>> '{}')::int), '[]'::jsonb) into v_left
  from jsonb_array_elements(coalesce(r.state -> 'prizes', '[]'::jsonb))
       with ordinality as u(e, ord)
  where ord > v_index + 1;

  v_base := jsonb_build_object(
    'prize_number', least(v_index + 1, 15),
    'prize_count', 15,
    'slip_min', 1,
    'slip_max', 15,
    -- The public burn table.
    'spent', coalesce(r.state -> 'spent', '{}'::jsonb),
    'scores', coalesce(r.state -> 'scores', '{}'::jsonb),
    'won', coalesce(r.state -> 'won', '{}'::jsonb),
    'history', coalesce(r.state -> 'history', '[]'::jsonb),
    'prizes_left', v_left);

  case r.phase
    -- Nobody's chosen slip travels anywhere until the reveal.
    when 'bid' then
      return v_base || jsonb_build_object(
        'prize', coalesce(r.state -> 'prizes' -> v_index, 'null'::jsonb),
        'bids', null, 'last', null);
    when 'reveal' then
      return v_base || jsonb_build_object(
        'prize', coalesce(r.state -> 'prizes' -> v_index, 'null'::jsonb),
        'bids', coalesce(r.state -> 'last' -> 'bids', '{}'::jsonb),
        'last', r.state -> 'last');
    else
      return v_base || jsonb_build_object('prize', null, 'bids', null, 'last', null);
  end case;
end $$;

create or replace function bid_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phase text; v_slip int;
begin
  select phase into v_phase from rounds where id = p_round_id;
  if v_phase = 'bid' then v_slip := bid_current(p_round_id, p_player_id); end if;
  return jsonb_build_object(
    'slip', case when v_slip is null then 'null'::jsonb else to_jsonb(v_slip) end,
    'remaining', to_jsonb(bid_remaining(p_round_id, p_player_id)));
end $$;

create or replace function bid_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  select phase into v_phase from rounds where id = p_round_id;
  if v_phase <> 'bid' then return true; end if;
  if coalesce(array_length(bid_remaining(p_round_id, p_player_id), 1), 0) = 0 then
    return true;
  end if;
  return bid_current(p_round_id, p_player_id) is not null;
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function bid_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_slip int; v_index int;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'bid' and p_kind = 'bid' then
    v_slip := trunc(coalesce((p_payload ->> 'slip')::numeric, 0))::int;
    if v_slip < 1 or v_slip > 15 then perform hearth_raise('invalid_target'); end if;
    if not (v_slip = any(bid_remaining(p_round_id, p_player_id))) then
      perform hearth_raise('invalid_target'); -- already burned
    end if;

    -- Re-bidding before the reveal is deliberate: hearth_put_action
    -- replaces, so changing your mind is free until the countdown.
    v_index := coalesce((r.state ->> 'index')::int, 0);
    perform hearth_put_action(p_round_id, p_player_id, 'bid:' || v_index,
      jsonb_build_object('slip', v_slip));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function bid_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hearth_clear_pending(p_round_id, p_player_id);
  -- Two is the floor: with one player left there is nobody to read.
  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 2 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
  end if;
  -- Otherwise they simply stop bidding. Their burned slips stay on the
  -- public table, because the others counted on that information.
end $$;

create or replace function bid_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    select case when coalesce(p_result -> 'winners', '[]'::jsonb) ? (e ->> 'player_id')
                then 1 else 0 end into v_won;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'bid',
      1, v_won, 0, 0, coalesce((e ->> 'score')::int, 0));
  end loop;
end $$;
