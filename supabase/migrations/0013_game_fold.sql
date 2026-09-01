-- ---------------------------------------------------------------
-- Hearth — Fold
-- Mirrors src/backend/mock/games/fold.ts, function for function.
--
-- Blackjack turned into a group standoff. The app owns the running
-- total, the target that moves every round, and the modifier that
-- keeps round six from being round one again.
-- ---------------------------------------------------------------

/** Everyone still in this round, in seat order. */
create or replace function fold_in_ids(p_round_id uuid)
returns text[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(u.e #>> '{}' order by u.ord), '{}')
  from rounds r,
       jsonb_array_elements(coalesce(r.state -> 'order', '[]'::jsonb))
         with ordinality as u(e, ord)
  where r.id = p_round_id
    and coalesce(r.state -> 'status' ->> (u.e #>> '{}'), '') = 'in'
$$;

/** Seat-ordered ids with one particular status, as a jsonb array. */
create or replace function fold_status_ids(p_round_id uuid, p_status text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(u.e order by u.ord), '[]'::jsonb)
  from rounds r,
       jsonb_array_elements(coalesce(r.state -> 'order', '[]'::jsonb))
         with ordinality as u(e, ord)
  where r.id = p_round_id
    and coalesce(r.state -> 'status' ->> (u.e #>> '{}'), '') = p_status
$$;

/** Whoever is on turn, or null when the round is not asking anyone. */
create or replace function fold_active(p_round_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select case
           when r.phase <> 'turn' then null
           else (r.state -> 'order' ->> coalesce((r.state ->> 'turn')::int, 0))::uuid
         end
  from rounds r where r.id = p_round_id
$$;

/**
 * The next player owed a turn, starting at p_start inclusive. Anyone who
 * has left, or who has no cards left to play, folds on the way past — a
 * phase must never wait on somebody who cannot act (§19.2).
 */
create or replace function fold_pick_from(p_round_id uuid, p_start int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_n int; v_i int; v_step int; v_pid text; v_status jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_n := coalesce(jsonb_array_length(coalesce(r.state -> 'order', '[]'::jsonb)), 0);
  if v_n = 0 then return null; end if;
  v_status := coalesce(r.state -> 'status', '{}'::jsonb);

  for v_step in 0 .. v_n - 1 loop
    v_i := (p_start + v_step) % v_n;
    v_pid := r.state -> 'order' ->> v_i;
    if coalesce(v_status ->> v_pid, '') <> 'in' then continue; end if;
    if hearth_has_left(v_pid::uuid) then
      v_status := v_status || jsonb_build_object(v_pid, 'folded');
      continue;
    end if;
    if coalesce((r.state -> 'hand' ->> v_pid)::int, 0) <= 0 then
      v_status := v_status || jsonb_build_object(v_pid, 'folded');
      continue;
    end if;
    perform hearth_patch_state(p_round_id,
      jsonb_build_object('status', v_status, 'turn', v_i));
    return v_pid::uuid;
  end loop;

  perform hearth_patch_state(p_round_id, jsonb_build_object('status', v_status));
  return null;
end $$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function fold_enter_tally(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_in text[]; v_surv text; v_gained int;
  v_scores jsonb; v_record jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_in := fold_in_ids(p_round_id);
  if coalesce(array_length(v_in, 1), 0) = 1 then v_surv := v_in[1]; end if;

  v_gained := case when v_surv is null then 0
                   else coalesce((r.state -> 'hand' ->> v_surv)::int, 0) end;
  v_scores := coalesce(r.state -> 'scores', '{}'::jsonb);
  if v_surv is not null and v_gained > 0 then
    v_scores := v_scores || jsonb_build_object(
      v_surv, coalesce((v_scores ->> v_surv)::int, 0) + v_gained);
  end if;

  v_record := jsonb_build_object(
    'round', coalesce((r.state ->> 'round')::int, 0),
    'target', coalesce((r.state ->> 'target')::int, 0),
    'modifier', coalesce(r.state ->> 'modifier', 'none'),
    'total', coalesce((r.state ->> 'total')::int, 0),
    'survivor_id', case when v_surv is null then 'null'::jsonb else to_jsonb(v_surv) end,
    'gained', v_gained,
    'exact_id', coalesce(r.state -> 'exact_id', 'null'::jsonb),
    'busted', fold_status_ids(p_round_id, 'busted'),
    'folded', fold_status_ids(p_round_id, 'folded'),
    'log', coalesce(r.state -> 'log', '[]'::jsonb));

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'scores', v_scores,
    'last', v_record,
    'history', coalesce(r.state -> 'history', '[]'::jsonb) || jsonb_build_array(v_record)));
  perform hearth_set_phase(p_round_id, 'tally', 10, '{}'::uuid[]);
end $$;

create or replace function fold_continue(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_next uuid; v_n int; v_turn int; v_secs int;
begin
  if coalesce(array_length(fold_in_ids(p_round_id), 1), 0) <= 1 then
    perform fold_enter_tally(p_round_id);
    return;
  end if;

  select * into r from rounds where id = p_round_id;
  v_n := greatest(coalesce(jsonb_array_length(coalesce(r.state -> 'order', '[]'::jsonb)), 0), 1);
  v_turn := (coalesce((r.state ->> 'turn')::int, 0) + 1) % v_n;
  v_next := fold_pick_from(p_round_id, v_turn);

  if v_next is null or coalesce(array_length(fold_in_ids(p_round_id), 1), 0) <= 1 then
    perform fold_enter_tally(p_round_id);
    return;
  end if;

  select coalesce((settings #>> '{fold,turn_seconds}')::int, 20) into v_secs
  from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'turn', v_secs, array[v_next]);
end $$;

create or replace function fold_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb; v_best int;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(x order by x.score desc, x.cards desc), '[]'::jsonb)
  into v_standings
  from (
    select rp.player_id::text as player_id,
           coalesce((r.state -> 'scores' ->> rp.player_id::text)::int, 0) as score,
           coalesce((r.state -> 'cards' ->> rp.player_id::text)::int, 0) as cards
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
    'rounds_played', coalesce((r.state ->> 'round')::int, 0),
    'history', coalesce(r.state -> 'history', '[]'::jsonb)));
end $$;

/** A fresh round: new target, new modifier, everyone back to strength. */
create or replace function fold_begin_round(p_round_id uuid, p_round int)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; rec record; v_target int; v_mod text; v_on boolean;
  v_hand jsonb := '{}'::jsonb; v_status jsonb := '{}'::jsonb; v_n int;
begin
  select * into r from rounds where id = p_round_id;
  v_on := coalesce((r.settings #>> '{fold,modifiers}')::boolean, true);

  v_target := (array[15, 18, 20, 21, 24, 26, 28, 30, 34, 40])[1 + floor(random() * 10)::int];
  -- Weighted so a plain round is still the commonest one.
  v_mod := case when v_on then
    (array['none', 'none', 'none', 'none',
           'double_first', 'hearts_negative', 'blind', 'exact_bonus'])[1 + floor(random() * 8)::int]
    else 'none' end;

  for rec in select player_id from round_players where round_id = p_round_id loop
    v_hand := v_hand || jsonb_build_object(
      rec.player_id::text,
      coalesce((r.state -> 'cards' ->> rec.player_id::text)::int, 0));
    v_status := v_status || jsonb_build_object(rec.player_id::text,
      case
        when hearth_has_left(rec.player_id) then 'folded'
        when coalesce((r.state -> 'cards' ->> rec.player_id::text)::int, 0) <= 0 then 'out'
        else 'in'
      end);
  end loop;

  v_n := greatest(coalesce(jsonb_array_length(coalesce(r.state -> 'order', '[]'::jsonb)), 0), 1);
  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'round', p_round, 'target', v_target, 'modifier', v_mod,
    'total', 0, 'log', '[]'::jsonb, 'first_card', false,
    'blind_lifted', false, 'exact_id', null,
    'hand', v_hand, 'status', v_status,
    -- The lead moves one seat every round so nobody is permanently first.
    'start', (p_round - 1) % v_n));

  -- Nobody left holding cards — the game is simply over.
  if coalesce(array_length(fold_in_ids(p_round_id), 1), 0) < 2 then
    perform fold_finish(p_round_id);
    return;
  end if;

  perform hearth_set_phase(p_round_id, 'deal', 60, hearth_present(p_round_id));
end $$;

create or replace function fold_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_ids uuid[]; v_id uuid; i int := 0; v_size int;
  v_order jsonb := '[]'::jsonb; v_cards jsonb := '{}'::jsonb; v_scores jsonb := '{}'::jsonb;
  v_rounds int;
begin
  select * into r from rounds where id = p_round_id;
  v_size := greatest(coalesce((r.settings #>> '{fold,hand_size}')::int, 5), 1);
  v_rounds := greatest(coalesce((r.settings #>> '{fold,rounds_per_game}')::int, 6), 1);

  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players set turn_index = i, role = 'player', private = '{}'::jsonb
    where round_id = p_round_id and player_id = v_id;
    v_order := v_order || to_jsonb(v_id::text);
    v_cards := v_cards || jsonb_build_object(v_id::text, v_size);
    v_scores := v_scores || jsonb_build_object(v_id::text, 0);
    i := i + 1;
  end loop;

  for v_id in select player_id from round_players where round_id = p_round_id loop
    if not (v_id = any(v_ids)) then
      update round_players set turn_index = null, role = 'player', private = '{}'::jsonb
      where round_id = p_round_id and player_id = v_id;
      v_cards := v_cards || jsonb_build_object(v_id::text, 0);
      v_scores := v_scores || jsonb_build_object(v_id::text, 0);
    end if;
  end loop;

  update rounds set state = jsonb_build_object(
    'order', v_order, 'rounds', v_rounds, 'round', 0, 'turn', 0, 'start', 0,
    'target', 0, 'modifier', 'none', 'total', 0, 'log', '[]'::jsonb,
    'first_card', false, 'blind_lifted', false, 'exact_id', null,
    'status', '{}'::jsonb, 'hand', '{}'::jsonb,
    'cards', v_cards, 'scores', v_scores,
    'history', '[]'::jsonb, 'last', null)
  where id = p_round_id;

  perform fold_begin_round(p_round_id, 1);
end $$;

create or replace function fold_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_first uuid; v_pid uuid; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'deal' then
      v_first := fold_pick_from(p_round_id, coalesce((r.state ->> 'start')::int, 0));
      if v_first is null or coalesce(array_length(fold_in_ids(p_round_id), 1), 0) <= 1 then
        perform fold_enter_tally(p_round_id);
        return;
      end if;
      select coalesce((settings #>> '{fold,turn_seconds}')::int, 20) into v_secs
      from rounds where id = p_round_id;
      perform hearth_set_phase(p_round_id, 'turn', v_secs, array[v_first]);

    when 'turn' then
      -- §19.2 — a player who says nothing folds. Safe, and the same
      -- default whether they are thinking or gone.
      v_pid := fold_active(p_round_id);
      if v_pid is not null then
        perform hearth_patch_state(p_round_id, jsonb_build_object(
          'status', coalesce(r.state -> 'status', '{}'::jsonb)
                    || jsonb_build_object(v_pid::text, 'folded'),
          'blind_lifted', true));
      end if;
      perform fold_continue(p_round_id);

    when 'tally' then
      if coalesce((r.state ->> 'round')::int, 0) >= coalesce((r.state ->> 'rounds')::int, 0) then
        perform fold_finish(p_round_id);
      else
        perform fold_begin_round(p_round_id, coalesce((r.state ->> 'round')::int, 0) + 1);
      end if;

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function fold_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_blind boolean; v_base jsonb; v_log jsonb; v_mod text;
begin
  select * into r from rounds where id = p_round_id;
  v_mod := coalesce(r.state ->> 'modifier', 'none');
  v_blind := v_mod = 'blind'
             and not coalesce((r.state ->> 'blind_lifted')::boolean, false)
             and r.phase <> 'tally';

  v_base := jsonb_build_object(
    'round_number', coalesce((r.state ->> 'round')::int, 0),
    'rounds_total', coalesce((r.state ->> 'rounds')::int, 0),
    'target', coalesce((r.state ->> 'target')::int, 0),
    'modifier', v_mod,
    'modifier_text', case v_mod
      when 'double_first' then 'The first card played counts double.'
      when 'hearts_negative' then 'Hearts subtract instead of adding.'
      when 'blind' then 'The total is hidden until somebody folds or busts.'
      when 'exact_bonus' then 'Land exactly on the target and take two points.'
      else 'Straight round. Nothing bent.' end,
    'order', coalesce(r.state -> 'order', '[]'::jsonb),
    'status', coalesce(r.state -> 'status', '{}'::jsonb),
    'hand', coalesce(r.state -> 'hand', '{}'::jsonb),
    'cards', coalesce(r.state -> 'cards', '{}'::jsonb),
    'scores', coalesce(r.state -> 'scores', '{}'::jsonb),
    'card_min', 1, 'card_max', 11,
    'blind', v_blind);

  case r.phase
    when 'deal' then
      return v_base || jsonb_build_object(
        'total', 0, 'log', '[]'::jsonb, 'current_player_id', null,
        'last', coalesce(r.state -> 'last', 'null'::jsonb));

    when 'turn' then
      -- Under `blind` the total is nobody's to know — and neither are the
      -- card values, which add straight back up to it.
      if v_blind then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'player_id', u.e -> 'player_id', 'value', null, 'total', null,
                 'hearts', false, 'doubled', false) order by u.ord), '[]'::jsonb)
        into v_log
        from jsonb_array_elements(coalesce(r.state -> 'log', '[]'::jsonb))
             with ordinality as u(e, ord);
      else
        v_log := coalesce(r.state -> 'log', '[]'::jsonb);
      end if;

      return v_base || jsonb_build_object(
        'total', case when v_blind then null
                      else to_jsonb(coalesce((r.state ->> 'total')::int, 0)) end,
        'log', v_log,
        'current_player_id', case when fold_active(p_round_id) is null then null
                                  else to_jsonb(fold_active(p_round_id)::text) end,
        'last', null);

    else
      return v_base || jsonb_build_object(
        'total', coalesce((r.state ->> 'total')::int, 0),
        'log', coalesce(r.state -> 'log', '[]'::jsonb),
        'current_player_id', null,
        'last', coalesce(r.state -> 'last', 'null'::jsonb));
  end case;
end $$;

/**
 * Fold hides a number from everyone or from nobody; there is no
 * per-player secret to hand out.
 */
create or replace function fold_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return '{}'::jsonb;
end $$;

create or replace function fold_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  select phase into v_phase from rounds where id = p_round_id;
  if v_phase = 'deal' then
    return hearth_has_action(p_round_id, 'deal', 'ready', p_player_id);
  end if;
  if v_phase = 'turn' then
    return fold_active(p_round_id) is distinct from p_player_id;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function fold_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_raw int; v_value int; v_hearts boolean; v_doubled boolean;
  v_total int; v_target int; v_hand int; v_status jsonb; v_scores jsonb; v_patch jsonb;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'deal' and p_kind = 'ready' then
    perform hearth_put_action(p_round_id, p_player_id, 'ready', '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'turn' and p_kind in ('play', 'fold') then
    if fold_active(p_round_id) is distinct from p_player_id then
      perform hearth_raise('not_your_turn');
    end if;
    v_status := coalesce(r.state -> 'status', '{}'::jsonb);

    if p_kind = 'fold' then
      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'status', v_status || jsonb_build_object(p_player_id::text, 'folded'),
        'blind_lifted', true));
      perform fold_continue(p_round_id);
      return;
    end if;

    v_raw := trunc(coalesce((p_payload ->> 'value')::numeric, 0))::int;
    if v_raw < 1 or v_raw > 11 then perform hearth_raise('invalid_target'); end if;
    v_hand := coalesce((r.state -> 'hand' ->> p_player_id::text)::int, 0);
    if v_hand <= 0 then perform hearth_raise('invalid_target'); end if;

    v_hearts := coalesce(r.state ->> 'modifier', 'none') = 'hearts_negative'
                and coalesce((p_payload ->> 'hearts')::boolean, false);
    v_doubled := coalesce(r.state ->> 'modifier', 'none') = 'double_first'
                 and not coalesce((r.state ->> 'first_card')::boolean, false);

    v_value := v_raw;
    if v_doubled then v_value := v_value * 2; end if;
    if v_hearts then v_value := -v_value; end if;

    v_target := coalesce((r.state ->> 'target')::int, 0);
    v_total := coalesce((r.state ->> 'total')::int, 0) + v_value;

    v_patch := jsonb_build_object(
      'first_card', true,
      'total', v_total,
      'hand', coalesce(r.state -> 'hand', '{}'::jsonb)
              || jsonb_build_object(p_player_id::text, v_hand - 1),
      'log', coalesce(r.state -> 'log', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('player_id', p_player_id::text, 'value', v_value,
                           'total', v_total, 'hearts', v_hearts, 'doubled', v_doubled)));

    if v_total > v_target then
      -- Bust: out of the round, and one card gone for good.
      v_patch := v_patch || jsonb_build_object(
        'status', v_status || jsonb_build_object(p_player_id::text, 'busted'),
        'cards', coalesce(r.state -> 'cards', '{}'::jsonb) || jsonb_build_object(
          p_player_id::text,
          greatest(coalesce((r.state -> 'cards' ->> p_player_id::text)::int, 0) - 1, 0)),
        'blind_lifted', true);
    elsif v_total = v_target and coalesce(r.state ->> 'modifier', 'none') = 'exact_bonus' then
      v_scores := coalesce(r.state -> 'scores', '{}'::jsonb);
      v_patch := v_patch || jsonb_build_object(
        'exact_id', p_player_id::text,
        'scores', v_scores || jsonb_build_object(
          p_player_id::text, coalesce((v_scores ->> p_player_id::text)::int, 0) + 2));
    end if;

    perform hearth_patch_state(p_round_id, v_patch);
    perform fold_continue(p_round_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function fold_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_was_active boolean;
begin
  perform hearth_clear_pending(p_round_id, p_player_id);
  select * into r from rounds where id = p_round_id;
  v_was_active := fold_active(p_round_id) is not distinct from p_player_id;

  if coalesce(r.state -> 'status' ->> p_player_id::text, '') = 'in' then
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'status', coalesce(r.state -> 'status', '{}'::jsonb)
                || jsonb_build_object(p_player_id::text, 'folded')));
  end if;

  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 2 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;

  -- Their turn cannot be waited on any longer.
  if r.phase = 'turn' and v_was_active then
    perform fold_continue(p_round_id);
  end if;
end $$;

create or replace function fold_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    select case when coalesce(p_result -> 'winners', '[]'::jsonb) ? (e ->> 'player_id')
                then 1 else 0 end into v_won;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'fold',
      1, v_won, 0, 0, coalesce((e ->> 'score')::int, 0));
  end loop;
end $$;
