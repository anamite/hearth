-- ---------------------------------------------------------------
-- Hearth — Grid
-- Mirrors src/backend/mock/games/grid.ts, function for function.
--
-- Thirty cards, three each of 1..10. Twenty-five are revealed, so five
-- are never seen: the composition of the deck is public, its tail is not.
-- ---------------------------------------------------------------

/** Twenty-five JSON nulls — one empty 5x5. */
create or replace function grid_empty_cells()
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(v), '[]'::jsonb)
  from (select null::int as v from generate_series(1, 25)) s
$$;

/** Three of every number, shuffled. */
create or replace function grid_build_deck()
returns jsonb language sql volatile as $$
  select coalesce(jsonb_agg(n order by random()), '[]'::jsonb)
  from (select g as n from generate_series(1, 10) g, generate_series(1, 3)) s
$$;

/** The cell indices of line `p_i`: 0-4 are the rows, 5-9 the columns. */
create or replace function grid_line_cells(p_i int)
returns int[] language sql immutable as $$
  select case when p_i < 5
    then array[p_i * 5, p_i * 5 + 1, p_i * 5 + 2, p_i * 5 + 3, p_i * 5 + 4]
    else array[p_i - 5, p_i + 0, p_i + 5, p_i + 10, p_i + 15] end
$$;

/** The five values of one line, in reading order. */
create or replace function grid_line_values(p_cells jsonb, p_i int)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(p_cells -> c order by ord), '[]'::jsonb)
  from unnest(grid_line_cells(p_i)) with ordinality as u(c, ord)
$$;

/**
 * Longest run of contiguous cells that never decreases, reading forwards.
 * A hole is not a number, so it breaks the run rather than spanning it.
 */
create or replace function grid_longest_run(p_vals jsonb)
returns int language plpgsql immutable as $$
declare e jsonb; v int; v_prev int; v_cur int := 0; v_best int := 0;
begin
  v_prev := null;
  for e in select * from jsonb_array_elements(coalesce(p_vals, '[]'::jsonb)) loop
    if e is null or e = 'null'::jsonb then
      v_cur := 0;
      v_prev := null;
    else
      v := (e #>> '{}')::int;
      if v_prev is not null and v >= v_prev then v_cur := v_cur + 1; else v_cur := 1; end if;
      v_prev := v;
      if v_cur > v_best then v_best := v_cur; end if;
    end if;
  end loop;
  return v_best;
end $$;

/** 2 -> 1, 3 -> 3, 4 -> 6, 5 -> 10, anything else -> nothing. */
create or replace function grid_line_score(p_vals jsonb)
returns int language sql immutable as $$
  select case grid_longest_run(p_vals)
    when 2 then 1 when 3 then 3 when 4 then 6 when 5 then 10 else 0 end
$$;

/** { lines: [10 scores], total } for one grid. */
create or replace function grid_score_cells(p_cells jsonb)
returns jsonb language plpgsql immutable as $$
declare i int; v_s int; v_lines jsonb := '[]'::jsonb; v_total int := 0;
begin
  for i in 0..9 loop
    v_s := grid_line_score(grid_line_values(p_cells, i));
    v_lines := v_lines || to_jsonb(v_s);
    v_total := v_total + v_s;
  end loop;
  return jsonb_build_object('lines', v_lines, 'total', v_total);
end $$;

create or replace function grid_cells(p_round_id uuid, p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(private -> 'cells', grid_empty_cells())
  from round_players where round_id = p_round_id and player_id = p_player_id
$$;

/** Everyone still here who has somewhere left to write. */
create or replace function grid_still_placing(p_round_id uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(rp.player_id order by rp.turn_index), '{}')
  from round_players rp
  where rp.round_id = p_round_id
    and not hearth_has_left(rp.player_id)
    and exists (
      select 1 from jsonb_array_elements(coalesce(rp.private -> 'cells', grid_empty_cells())) e
      where e = 'null'::jsonb)
$$;

/** Every grid in the round, keyed by player. */
create or replace function grid_all_grids(p_round_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_object_agg(rp.player_id::text,
                     coalesce(rp.private -> 'cells', grid_empty_cells())),
    '{}'::jsonb)
  from round_players rp where rp.round_id = p_round_id
$$;

/** How many of each number have been seen. Public — this is the tally. */
create or replace function grid_tally(p_drawn jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(c order by n), '[]'::jsonb)
  from (
    select g.n,
           (select count(*) from jsonb_array_elements(coalesce(p_drawn, '[]'::jsonb)) e
            where (e #>> '{}')::int = g.n) as c
    from generate_series(1, 10) g(n)) s
$$;

/** Everything up to and including the card on screen, and not one more. */
create or replace function grid_drawn(p_round_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
  from rounds r,
       jsonb_array_elements(coalesce(r.state -> 'deck', '[]'::jsonb)) with ordinality as u(e, ord)
  where r.id = p_round_id
    and ord <= least(coalesce((r.state ->> 'index')::int, 0) + 1, 25)
$$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function grid_enter_scoring(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rp record; v_scores jsonb := '{}'::jsonb;
begin
  for rp in select player_id, private from round_players where round_id = p_round_id loop
    v_scores := v_scores || jsonb_build_object(
      rp.player_id::text,
      grid_score_cells(coalesce(rp.private -> 'cells', grid_empty_cells())));
  end loop;

  perform hearth_patch_state(p_round_id,
    jsonb_build_object('scores', v_scores, 'line_index', 0));
  perform hearth_set_phase(p_round_id, 'scoring', 6, '{}'::uuid[]);
end $$;

create or replace function grid_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb; v_best int;
begin
  select * into r from rounds where id = p_round_id;

  -- Someone who walked out mid-round does not appear on the podium.
  select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) into v_standings
  from (
    select rp.player_id::text as player_id,
           coalesce((r.state -> 'scores' -> rp.player_id::text ->> 'total')::int, 0) as total,
           coalesce(r.state -> 'scores' -> rp.player_id::text -> 'lines', '[]'::jsonb) as lines
    from round_players rp
    where rp.round_id = p_round_id and not hearth_has_left(rp.player_id)) x;

  select coalesce(max((e ->> 'total')::int), 0) into v_best
  from jsonb_array_elements(v_standings) e;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'standings', v_standings,
    'winners', coalesce((select jsonb_agg(e -> 'player_id')
                         from jsonb_array_elements(v_standings) e
                         where (e ->> 'total')::int = v_best), '[]'::jsonb),
    'best_score', v_best,
    'max_score', 100,
    'grids', grid_all_grids(p_round_id)));
end $$;

create or replace function grid_begin_reveal(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_waiting uuid[]; v_index int; v_secs int;
begin
  select coalesce((state ->> 'index')::int, 0) into v_index from rounds where id = p_round_id;
  v_waiting := grid_still_placing(p_round_id);

  if coalesce(array_length(v_waiting, 1), 0) = 0 or v_index >= 25 then
    perform grid_enter_scoring(p_round_id);
    return;
  end if;

  select coalesce((settings #>> '{grid,reveal_seconds}')::int, 8) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'reveal', v_secs, v_waiting);
end $$;

create or replace function grid_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_id uuid; i int := 0;
begin
  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players
    set turn_index = i, role = 'player',
        private = jsonb_build_object('cells', grid_empty_cells())
    where round_id = p_round_id and player_id = v_id;
    i := i + 1;
  end loop;
  update round_players set turn_index = null
  where round_id = p_round_id and not (player_id = any(v_ids));

  -- The deck is SECRET; only the drawn prefix is ever published.
  update rounds set state = jsonb_build_object(
    'deck', grid_build_deck(), 'index', 0,
    'scores', '{}'::jsonb, 'line_index', 0)
  where id = p_round_id;

  perform grid_begin_reveal(p_round_id);
end $$;

create or replace function grid_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_next int;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'reveal' then
      -- §19.2 — there is no default placement. A card you did not place is
      -- a hole, and a hole breaks whatever run it sat in.
      v_next := coalesce((r.state ->> 'index')::int, 0) + 1;
      perform hearth_patch_state(p_round_id, jsonb_build_object('index', v_next));
      if v_next >= 25 then
        perform grid_enter_scoring(p_round_id);
      else
        perform grid_begin_reveal(p_round_id);
      end if;

    when 'scoring' then
      v_next := coalesce((r.state ->> 'line_index')::int, 0) + 1;
      perform hearth_patch_state(p_round_id, jsonb_build_object('line_index', v_next));
      if v_next >= 10 then
        perform grid_finish(p_round_id);
      else
        perform hearth_set_phase(p_round_id, 'scoring', 6, '{}'::uuid[]);
      end if;

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function grid_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_drawn jsonb; v_index int; v_base jsonb; v_tally boolean;
begin
  select * into r from rounds where id = p_round_id;
  v_index := coalesce((r.state ->> 'index')::int, 0);
  v_drawn := grid_drawn(p_round_id);
  v_tally := coalesce((r.settings #>> '{grid,show_tally}')::boolean, true);

  v_base := jsonb_build_object(
    'card_number', least(v_index + 1, 25),
    'cards_total', 25,
    'deck_size', 30,
    'max_score', 100,
    'show_tally', v_tally,
    'drawn', v_drawn,
    'tally', grid_tally(v_drawn));

  case r.phase
    when 'reveal' then
      return v_base || jsonb_build_object(
        'current_card', coalesce(r.state -> 'deck' -> v_index, 'null'::jsonb),
        'grids', null, 'scores', null, 'line_index', null);
    when 'scoring' then
      -- The grids become public exactly when the game is over.
      return v_base || jsonb_build_object(
        'current_card', null,
        'grids', grid_all_grids(p_round_id),
        'scores', coalesce(r.state -> 'scores', '{}'::jsonb),
        'line_index', coalesce((r.state ->> 'line_index')::int, 0),
        'line_count', 10);
    else
      return v_base || jsonb_build_object(
        'current_card', null,
        'grids', grid_all_grids(p_round_id),
        'scores', coalesce(r.state -> 'scores', '{}'::jsonb),
        'line_index', 10, 'line_count', 10);
  end case;
end $$;

create or replace function grid_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(private, '{}'::jsonb) from round_players
  where round_id = p_round_id and player_id = p_player_id
$$;

create or replace function grid_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_index int;
begin
  select * into r from rounds where id = p_round_id;
  if r.phase <> 'reveal' then return true; end if;

  -- A full grid has nothing left to ask of its owner.
  if not exists (
    select 1 from jsonb_array_elements(grid_cells(p_round_id, p_player_id)) e
    where e = 'null'::jsonb) then
    return true;
  end if;

  v_index := coalesce((r.state ->> 'index')::int, 0);
  return hearth_has_action(p_round_id, 'reveal', 'place:' || v_index, p_player_id);
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function grid_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_index int; v_cell int; v_cells jsonb;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'reveal' and p_kind = 'place' then
    v_index := coalesce((r.state ->> 'index')::int, 0);
    if hearth_has_action(p_round_id, 'reveal', 'place:' || v_index, p_player_id) then
      perform hearth_raise('already_acted');
    end if;

    v_cell := trunc(coalesce((p_payload ->> 'cell')::numeric, -1))::int;
    if v_cell < 0 or v_cell >= 25 then perform hearth_raise('invalid_target'); end if;

    v_cells := grid_cells(p_round_id, p_player_id);
    if v_cells -> v_cell <> 'null'::jsonb then perform hearth_raise('invalid_target'); end if;

    v_cells := jsonb_set(v_cells, array[v_cell::text],
                         coalesce(r.state -> 'deck' -> v_index, 'null'::jsonb));
    update round_players
    set private = coalesce(private, '{}'::jsonb) || jsonb_build_object('cells', v_cells)
    where round_id = p_round_id and player_id = p_player_id;

    -- The kind carries the card number: the phase repeats 25 times and
    -- actions are unique on (round, player, phase, kind).
    perform hearth_put_action(p_round_id, p_player_id, 'place:' || v_index,
      jsonb_build_object('cell', v_cell));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function grid_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hearth_clear_pending(p_round_id, p_player_id);
  if coalesce(array_length(hearth_present(p_round_id), 1), 0) = 0 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
  end if;
  -- Everyone else keeps writing. Nothing in this game waits on a
  -- particular person, so there is nothing else to repair.
end $$;

create or replace function grid_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    select case when coalesce(p_result -> 'winners', '[]'::jsonb) ? (e ->> 'player_id')
                then 1 else 0 end into v_won;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'grid',
      1, v_won, 0, 0, coalesce((e ->> 'total')::int, 0));
  end loop;
end $$;
