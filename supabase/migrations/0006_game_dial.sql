-- ---------------------------------------------------------------
-- Hearth — Dial (spec §13)
-- Mirrors src/backend/mock/games/dial.ts.
-- ---------------------------------------------------------------

/** Spec §13.1 scoring band. */
create or replace function dial_score(p_target int, p_guess int)
returns int language sql immutable as $$
  select case
    when abs(p_target - p_guess) <= 3  then 4
    when abs(p_target - p_guess) <= 8  then 3
    when abs(p_target - p_guess) <= 15 then 2
    else 0 end
$$;

/** First present player at or after `p_from` in turn order. */
create or replace function dial_next_present(p_round_id uuid, p_from int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_n int; i int; v_id uuid;
begin
  select coalesce(array_agg(player_id order by turn_index), '{}') into v_ids
  from round_players where round_id = p_round_id and turn_index is not null;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return null; end if;

  for i in 0..(v_n - 1) loop
    v_id := v_ids[1 + ((p_from + i) % v_n)];
    if not hearth_has_left(v_id) then return v_id; end if;
  end loop;
  return null;
end $$;

create or replace function dial_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  perform hearth_end_round(p_round_id, jsonb_build_object(
    'total_score', coalesce((r.state ->> 'total_score')::int, 0),
    'max_possible', jsonb_array_length(coalesce(r.state -> 'history', '[]'::jsonb)) * 4,
    'rounds', coalesce(r.state -> 'history', '[]'::jsonb),
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false)));
end $$;

/** Spec §13.3 per-sub-round setup. */
create or replace function dial_begin_subround(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_n int; v_idx int; v_content jsonb; v_payload jsonb;
  v_clue uuid; v_holder uuid; v_target int; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  v_idx := coalesce((r.state ->> 'round_index')::int, 0);

  if v_idx >= coalesce((r.state ->> 'total_rounds')::int, 0) then
    perform dial_finish(p_round_id);
    return;
  end if;

  select count(*) into v_n from round_players
  where round_id = p_round_id and turn_index is not null;
  if v_n = 0 then perform dial_finish(p_round_id); return; end if;

  v_content := hearth_take_content(p_round_id, 'dial');
  v_payload := v_content -> 'payload';

  v_clue   := dial_next_present(p_round_id, v_idx % v_n);
  v_holder := dial_next_present(p_round_id, (v_idx + 1) % v_n);
  if v_clue is null or v_holder is null then perform dial_finish(p_round_id); return; end if;
  if v_holder = v_clue then
    v_holder := coalesce(dial_next_present(p_round_id, (v_idx + 2) % v_n), v_holder);
  end if;

  -- Kept away from the extremes, where the game is trivial (§13.3).
  v_target := 4 + floor(random() * 93)::int;

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'clue_giver_id', v_clue, 'dial_holder_id', v_holder,
    'spectrum', jsonb_build_object('left', v_payload ->> 'left', 'right', v_payload ->> 'right'),
    'target', v_target, 'clue', null, 'guess', null, 'points', null, 'locked', false,
    'bank_reset', ((v_content ->> 'bank_reset')::boolean
                   or coalesce((r.state ->> 'bank_reset')::boolean, false))));

  -- The target reaches exactly one device (§13.3, M3 acceptance criterion 2).
  update round_players set private = '{}'::jsonb where round_id = p_round_id;
  update round_players set private = jsonb_build_object(
    'target', v_target,
    'spectrum', jsonb_build_object('left', v_payload ->> 'left', 'right', v_payload ->> 'right'))
  where round_id = p_round_id and player_id = v_clue;

  perform hearth_clear_phase_actions(p_round_id, 'clue');
  perform hearth_clear_phase_actions(p_round_id, 'guess');

  select coalesce((settings #>> '{dial,clue_seconds}')::int, 60) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'clue', v_secs, array[v_clue]);
end $$;

create or replace function dial_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_id uuid; i int := 0; v_rounds int;
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

  -- rounds_per_game null (or 0) means "one round per player" (§5.1).
  select nullif(coalesce((settings #>> '{dial,rounds_per_game}')::int, 0), 0)
  into v_rounds from rounds where id = p_round_id;

  update rounds set state = jsonb_build_object(
    'round_index', 0,
    'total_rounds', coalesce(v_rounds, coalesce(array_length(v_ids, 1), 0)),
    'total_score', 0, 'history', '[]'::jsonb)
  where id = p_round_id;

  perform dial_begin_subround(p_round_id);
end $$;

create or replace function dial_enter_reveal(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_guess int; v_points int; v_skip boolean;
begin
  select * into r from rounds where id = p_round_id;
  v_guess := coalesce((r.state ->> 'guess')::int, 50);
  v_skip := coalesce((r.state ->> 'skip_score')::boolean, false);
  v_points := case when v_skip then 0
                   else dial_score((r.state ->> 'target')::int, v_guess) end;

  update rounds set state = state
    || jsonb_build_object(
         'guess', v_guess, 'points', v_points,
         'total_score', coalesce((state ->> 'total_score')::int, 0) + v_points,
         'skip_score', false)
    || jsonb_build_object('history',
         coalesce(state -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'clue_giver_id', state ->> 'clue_giver_id',
           'spectrum', state -> 'spectrum',
           'clue', coalesce(state ->> 'clue', ''),
           'target', (state ->> 'target')::int,
           'guess', v_guess, 'points', v_points, 'skipped', v_skip)))
  where id = p_round_id;

  perform hearth_set_phase(p_round_id, 'reveal', 10, '{}'::uuid[]);
end $$;

create or replace function dial_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_secs int; v_idx int;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'clue' then
      -- §19.2 — empty clue on timeout.
      if r.state -> 'clue' is null or r.state ->> 'clue' is null then
        perform hearth_patch_state(p_round_id, jsonb_build_object('clue', ''));
      end if;
      select coalesce((settings #>> '{dial,discussion_seconds}')::int, 120)
      into v_secs from rounds where id = p_round_id;
      perform hearth_set_phase(p_round_id, 'guess', v_secs,
        array[(r.state ->> 'dial_holder_id')::uuid]);

    when 'guess' then
      perform hearth_patch_state(p_round_id, jsonb_build_object('locked', false));
      perform dial_enter_reveal(p_round_id);

    when 'reveal' then
      v_idx := coalesce((r.state ->> 'round_index')::int, 0) + 1;
      perform hearth_patch_state(p_round_id, jsonb_build_object('round_index', v_idx));
      if v_idx >= coalesce((r.state ->> 'total_rounds')::int, 0) then
        perform dial_finish(p_round_id);
      else
        perform dial_begin_subround(p_round_id);
      end if;

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function dial_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_base jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_base := jsonb_build_object(
    'round_index', coalesce((r.state ->> 'round_index')::int, 0),
    'total_rounds', coalesce((r.state ->> 'total_rounds')::int, 0),
    'total_score', coalesce((r.state ->> 'total_score')::int, 0),
    'spectrum', r.state -> 'spectrum',
    'clue_giver_id', r.state ->> 'clue_giver_id',
    'dial_holder_id', r.state ->> 'dial_holder_id',
    'history', coalesce(r.state -> 'history', '[]'::jsonb));

  case r.phase
    -- No clue and no target: everyone else is simply waiting.
    when 'clue' then
      return v_base || jsonb_build_object('clue', null, 'target', null, 'guess', null);
    -- The clue becomes public the moment it is submitted (§13.5).
    when 'guess' then
      return v_base || jsonb_build_object(
        'clue', coalesce(r.state ->> 'clue', ''), 'target', null,
        'guess', r.state -> 'guess');
    when 'reveal' then
      return v_base || jsonb_build_object(
        'clue', coalesce(r.state ->> 'clue', ''),
        'target', r.state -> 'target', 'guess', r.state -> 'guess',
        'points', r.state -> 'points');
    when 'result' then
      return v_base || jsonb_build_object('clue', null, 'target', null, 'guess', null);
    else return v_base;
  end case;
end $$;

create or replace function dial_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(private, '{}'::jsonb) from round_players
  where round_id = p_round_id and player_id = p_player_id
$$;

create or replace function dial_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'clue' then
      return p_player_id <> (r.state ->> 'clue_giver_id')::uuid
             or r.state ->> 'clue' is not null;
    when 'guess' then
      return p_player_id <> (r.state ->> 'dial_holder_id')::uuid
             or coalesce((r.state ->> 'locked')::boolean, false);
    else return true;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Actions (§13.5)
-- ---------------------------------------------------------------

create or replace function dial_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_clue text; v_pos int;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'clue' and p_kind = 'clue_given' then
    if p_player_id <> (r.state ->> 'clue_giver_id')::uuid then
      perform hearth_raise('not_your_turn');
    end if;
    v_clue := trim(left(coalesce(p_payload ->> 'clue', ''), 80));
    perform hearth_patch_state(p_round_id, jsonb_build_object('clue', v_clue));
    perform hearth_put_action(p_round_id, p_player_id, 'clue_given',
      jsonb_build_object('clue', v_clue));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'guess' and p_kind = 'dial_set' then
    if p_player_id <> (r.state ->> 'dial_holder_id')::uuid then
      perform hearth_raise('not_your_turn');
    end if;
    v_pos := round(coalesce((p_payload ->> 'position')::numeric, -1))::int;
    if v_pos < 0 or v_pos > 100 then perform hearth_raise('invalid_target'); end if;

    perform hearth_patch_state(p_round_id, jsonb_build_object('guess', v_pos));
    perform hearth_put_action(p_round_id, p_player_id, 'dial_set',
      jsonb_build_object('position', v_pos,
                         'locked', coalesce((p_payload ->> 'locked')::boolean, false)));
    if coalesce((p_payload ->> 'locked')::boolean, false) then
      perform hearth_patch_state(p_round_id, jsonb_build_object('locked', true));
      perform hearth_clear_pending(p_round_id, p_player_id);
    end if;
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats (§19.3, §13.8)
-- ---------------------------------------------------------------

create or replace function dial_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_idx int; v_replacement uuid; v_turn int;
begin
  select * into r from rounds where id = p_round_id;
  perform hearth_clear_pending(p_round_id, p_player_id);

  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 3 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;

  -- A lost clue-giver forfeits the sub-round.
  if p_player_id = (r.state ->> 'clue_giver_id')::uuid and r.phase <> 'reveal' then
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'skip_score', true, 'clue', coalesce(r.state ->> 'clue', ''), 'guess', 50));
    perform dial_enter_reveal(p_round_id);
    return;
  end if;

  -- A lost dial-holder is replaced by the next player in turn order.
  if p_player_id = (r.state ->> 'dial_holder_id')::uuid then
    select turn_index into v_turn from round_players
    where round_id = p_round_id and player_id = p_player_id;
    v_replacement := dial_next_present(p_round_id, coalesce(v_turn, 0) + 1);
    if v_replacement is not null
       and v_replacement <> (r.state ->> 'clue_giver_id')::uuid then
      perform hearth_patch_state(p_round_id,
        jsonb_build_object('dial_holder_id', v_replacement));
      if r.phase = 'guess' then
        update rounds set pending_on = array[v_replacement] where id = p_round_id;
      end if;
    end if;
  end if;
end $$;

create or replace function dial_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rp record; v_total int;
begin
  -- Cooperative (§13.8): no wins recorded, the score is the shared trophy.
  v_total := coalesce((p_result ->> 'total_score')::int, 0);
  for rp in select player_id from round_players where round_id = p_round_id loop
    perform hearth_bump_stats(p_round_id, rp.player_id, 'dial', 1, 0, 0, 0, v_total);
  end loop;
end $$;
