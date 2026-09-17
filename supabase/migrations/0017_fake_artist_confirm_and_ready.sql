-- ---------------------------------------------------------------
-- Hearth — Fake Artist: confirm/redo a line, and "ready to vote"
-- Mirrors src/backend/mock/games/fakeArtist.ts.
--
-- Canvas mode: a finished line is held in state.pending_stroke for a
-- 5-second window. The drawer can redo it (the turn clock is restored, with
-- at least 10 seconds left) or confirm it early; otherwise it locks in when
-- the window closes.
--
-- Paper mode has no clocks: turns wait for "Done", the vote stays shut
-- (state.voting_open = false) until a strict majority taps "Ready to vote",
-- and the vote then waits for everyone still present.
--
-- A forward migration because 0005 has already been applied; every function
-- here is `create or replace`.
-- ---------------------------------------------------------------

/** Canvas mode: a line waiting out its redo window becomes part of the picture. */
create or replace function fake_artist_commit_pending(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update rounds set state = jsonb_set(
      state || jsonb_build_object('pending_stroke', null),
      '{strokes}',
      coalesce(state -> 'strokes', '[]'::jsonb) || jsonb_build_array(state -> 'pending_stroke'))
  where id = p_round_id
    and jsonb_typeof(state -> 'pending_stroke') = 'object';
end $$;

create or replace function fake_artist_ready_count(p_round_id uuid)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from actions a
  where a.round_id = p_round_id and a.phase = 'voting' and a.kind = 'ready_to_vote'
    and not hearth_has_left(a.player_id)
$$;

create or replace function fake_artist_ready_needed(p_round_id uuid)
returns int language sql security definer set search_path = public as $$
  select floor(coalesce(array_length(hearth_present(p_round_id), 1), 0) / 2.0)::int + 1
$$;

/** Paper mode: once a strict majority is ready, the vote opens for everyone. */
create or replace function fake_artist_open_vote_if_ready(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (state ->> 'voting_open')::boolean from rounds where id = p_round_id), true) then
    return;
  end if;
  if fake_artist_ready_count(p_round_id) >= fake_artist_ready_needed(p_round_id) then
    perform hearth_patch_state(p_round_id, jsonb_build_object('voting_open', true));
  end if;
end $$;

create or replace function fake_artist_enter_voting(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_unlock timestamptz; v_ends timestamptz;
begin
  perform fake_artist_commit_pending(p_round_id);
  select * into r from rounds where id = p_round_id;

  if not coalesce((r.settings #>> '{fake_artist,canvas_mode}')::boolean, true) then
    perform hearth_patch_state(p_round_id,
      jsonb_build_object('vote_unlock_at', null, 'voting_open', false));
    perform hearth_set_phase(p_round_id, 'voting', null, hearth_living(p_round_id));
    return;
  end if;

  -- §11.4 — the talk-first delay still applies to canvas rounds.
  v_unlock := greatest(now(), r.started_at
    + make_interval(secs => coalesce((r.settings #>> '{fake_artist,vote_delay_seconds}')::int, 60)));
  v_ends := v_unlock + interval '90 seconds';

  perform hearth_patch_state(p_round_id,
    jsonb_build_object('vote_unlock_at', v_unlock, 'voting_open', true));
  perform hearth_set_phase(p_round_id, 'voting', null, hearth_living(p_round_id));
  update rounds set phase_ends_at = v_ends where id = p_round_id;
end $$;

/** Enters the turn described by state.pass/state.turn, skipping absences. */
create or replace function fake_artist_enter_drawing(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_strokes int; v_drawer uuid; v_pass int; v_canvas boolean; i int;
begin
  select count(*) into v_n from round_players
  where round_id = p_round_id and turn_index is not null;
  select coalesce((settings #>> '{fake_artist,strokes_per_player}')::int, 2),
         coalesce((settings #>> '{fake_artist,canvas_mode}')::boolean, true)
  into v_strokes, v_canvas from rounds where id = p_round_id;

  for i in 0..(v_n * v_strokes + 1) loop
    select (state ->> 'pass')::int into v_pass from rounds where id = p_round_id;
    if v_pass >= v_strokes then
      perform fake_artist_enter_voting(p_round_id);
      return;
    end if;

    v_drawer := fake_artist_current_drawer(p_round_id);
    if v_drawer is not null and not hearth_has_left(v_drawer) then
      -- Paper mode has no turn clock: the drawer taps Done.
      perform hearth_set_phase(p_round_id, 'drawing',
        case when v_canvas then 45 else null end, array[v_drawer]);
      update rounds set state = state || jsonb_build_object(
          'turn_ends_at', phase_ends_at, 'pending_stroke', null, 'attempt', 0)
      where id = p_round_id;
      return;
    end if;
    perform fake_artist_step_turn(p_round_id);
  end loop;

  perform fake_artist_enter_voting(p_round_id);
end $$;

create or replace function fake_artist_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'reveal' then
      -- §19.2 — anyone who never tapped is auto-revealed.
      perform hearth_patch_state(p_round_id, jsonb_build_object('pass', 0, 'turn', 0));
      perform fake_artist_enter_drawing(p_round_id);
    when 'drawing' then
      perform fake_artist_commit_pending(p_round_id); -- an unconfirmed line is final
      perform fake_artist_step_turn(p_round_id);      -- a timed-out turn records no stroke
      perform fake_artist_enter_drawing(p_round_id);
    when 'voting' then
      perform fake_artist_finish_vote(p_round_id);
    when 'guess' then
      perform fake_artist_finish_guess(p_round_id);
    else null;
  end case;
end $$;

create or replace function fake_artist_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_strokes jsonb; v_canvas boolean; v_requests int; v_present int;
begin
  select * into r from rounds where id = p_round_id;
  v_strokes := coalesce(r.state -> 'strokes', '[]'::jsonb);
  v_canvas := coalesce((r.settings #>> '{fake_artist,canvas_mode}')::boolean, true);

  case r.phase
    when 'reveal' then
      select count(distinct player_id) into v_requests from actions
      where round_id = p_round_id and phase = 'reveal' and kind = 'reroll_request';
      v_present := coalesce(array_length(hearth_present(p_round_id), 1), 0);
      return jsonb_build_object(
        'reroll_count', coalesce((r.state ->> 'reroll_count')::int, 0),
        'reroll_requests', v_requests,
        'reroll_needed', floor(v_present / 2.0)::int + 1,
        'reroll_allowed',
          coalesce((r.settings #>> '{fake_artist,allow_reroll}')::boolean, true)
          and coalesce((r.state ->> 'reroll_count')::int, 0) < 3,
        'canvas_mode', v_canvas);

    when 'drawing' then
      return jsonb_build_object(
        'pass', (r.state ->> 'pass')::int,
        'turn', (r.state ->> 'turn')::int,
        'passes_total', coalesce((r.settings #>> '{fake_artist,strokes_per_player}')::int, 2),
        'current_player_id', fake_artist_current_drawer(p_round_id),
        'canvas_mode', v_canvas,
        'strokes', v_strokes,
        'pending_stroke', coalesce(r.state -> 'pending_stroke', 'null'::jsonb),
        'attempt', coalesce((r.state ->> 'attempt')::int, 0),
        'confirm_seconds', 5);

    when 'voting' then
      -- Individual votes are deliberately absent until the phase ends (§11.8).
      return jsonb_build_object(
        'strokes', v_strokes, 'canvas_mode', v_canvas,
        'votes_cast', (select count(distinct player_id) from actions
                       where round_id = p_round_id and phase = 'voting' and kind = 'vote'),
        'votes_needed', coalesce(array_length(hearth_living(p_round_id), 1), 0),
        'vote_unlock_at', r.state ->> 'vote_unlock_at',
        'voting_open', coalesce((r.state ->> 'voting_open')::boolean, true),
        'ready_count', fake_artist_ready_count(p_round_id),
        'ready_needed', fake_artist_ready_needed(p_round_id));

    when 'guess' then
      return jsonb_build_object(
        'strokes', v_strokes, 'canvas_mode', v_canvas,
        'accused_id', r.state ->> 'accused_id',
        'votes', coalesce(r.state -> 'votes', '[]'::jsonb));

    when 'result' then
      return jsonb_build_object(
        'strokes', v_strokes, 'canvas_mode', v_canvas,
        'word', r.state ->> 'word',
        'description', r.state ->> 'description',
        'impostor_id', (select player_id from round_players
                        where round_id = p_round_id and role = 'impostor'),
        'accused_id', r.state ->> 'accused_id',
        'votes', coalesce(r.state -> 'votes', '[]'::jsonb),
        'guess', r.result ->> 'guess',
        'winner', r.result ->> 'winner');

    else return '{}'::jsonb;
  end case;
end $$;

create or replace function fake_artist_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_pass int;
begin
  select * into r from rounds where id = p_round_id;
  v_pass := coalesce((r.state ->> 'pass')::int, 0);
  case r.phase
    when 'reveal' then
      return hearth_has_action(p_round_id, 'reveal', 'revealed', p_player_id);
    when 'drawing' then
      return hearth_has_action(p_round_id, 'drawing', 'stroke:' || v_pass, p_player_id)
          or hearth_has_action(p_round_id, 'drawing', 'pass_turn:' || v_pass, p_player_id);
    when 'voting' then
      -- Before a paper-mode vote opens, "acted" means "ready to vote".
      if coalesce((r.state ->> 'voting_open')::boolean, true) then
        return hearth_has_action(p_round_id, 'voting', 'vote', p_player_id);
      end if;
      return hearth_has_action(p_round_id, 'voting', 'ready_to_vote', p_player_id);
    when 'guess' then
      return hearth_has_action(p_round_id, 'guess', 'word_guess', p_player_id);
    else return true;
  end case;
end $$;

create or replace function fake_artist_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_role text; v_pass int; v_requests int; v_present int; v_count int;
  v_drawer uuid; v_target uuid; v_points jsonb; v_color text; v_unlock timestamptz;
  v_has_pending boolean; v_turn_ends timestamptz;
begin
  select * into r from rounds where id = p_round_id;
  select role into v_role from round_players
  where round_id = p_round_id and player_id = p_player_id;
  v_pass := coalesce((r.state ->> 'pass')::int, 0);
  v_has_pending := jsonb_typeof(r.state -> 'pending_stroke') = 'object';

  -- reveal ------------------------------------------------------
  if r.phase = 'reveal' and p_kind = 'revealed' then
    perform hearth_put_action(p_round_id, p_player_id, 'revealed', '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'reveal' and p_kind = 'reroll_request' then
    if not coalesce((r.settings #>> '{fake_artist,allow_reroll}')::boolean, true)
       or coalesce((r.state ->> 'reroll_count')::int, 0) >= 3 then
      perform hearth_raise('wrong_phase');
    end if;

    -- Toggle: sending again withdraws the request (§11.7).
    if hearth_has_action(p_round_id, 'reveal', 'reroll_request', p_player_id) then
      perform hearth_drop_action(p_round_id, p_player_id, 'reroll_request');
      return;
    end if;
    perform hearth_put_action(p_round_id, p_player_id, 'reroll_request', '{}'::jsonb);

    select count(distinct player_id) into v_requests from actions
    where round_id = p_round_id and phase = 'reveal' and kind = 'reroll_request';
    v_present := coalesce(array_length(hearth_present(p_round_id), 1), 0);

    if v_requests > v_present / 2.0 then
      -- §11.5 — new word AND new impostor; the old word stays used.
      v_count := coalesce((r.state ->> 'reroll_count')::int, 0) + 1;
      perform fake_artist_deal(p_round_id);
      perform hearth_patch_state(p_round_id, jsonb_build_object('reroll_count', v_count));
      perform hearth_clear_phase_actions(p_round_id, 'reveal');
      perform hearth_set_phase(p_round_id, 'reveal', 180, hearth_present(p_round_id));
    end if;
    return;
  end if;

  -- drawing -----------------------------------------------------
  if r.phase = 'drawing' then
    v_drawer := fake_artist_current_drawer(p_round_id);
    if v_drawer is null or v_drawer <> p_player_id then perform hearth_raise('not_your_turn'); end if;

    if p_kind = 'stroke' then
      if not coalesce((r.settings #>> '{fake_artist,canvas_mode}')::boolean, true)
         or v_has_pending then
        perform hearth_raise('wrong_phase');
      end if;
      -- Clamp to the normalised space and cap the length server-side (§11.6).
      select coalesce(jsonb_agg(jsonb_build_array(
               least(1, greatest(0, (pt -> 0)::numeric)),
               least(1, greatest(0, (pt -> 1)::numeric)))), '[]'::jsonb)
      into v_points
      from (select value as pt from jsonb_array_elements(coalesce(p_payload -> 'points', '[]'::jsonb))
            limit 400) t;

      if jsonb_array_length(v_points) < 2 then perform hearth_raise('invalid_target'); end if;

      select case avatar_key
        when 'fox' then '#E8743B' when 'owl' then '#7C5CBF' when 'bear' then '#8B5E3C'
        when 'frog' then '#4CA64C' when 'whale' then '#2E7DAF' when 'cat' then '#D4A017'
        when 'crow' then '#3A3A3A' when 'deer' then '#B8654F' when 'fish' then '#2FA8A0'
        when 'moth' then '#B45D9E' else '#8B8798' end
      into v_color from players where id = p_player_id;

      -- Keyed per pass so the (round, player, phase, kind) unique constraint
      -- still guards duplicates without colliding on the second pass.
      perform hearth_put_action(p_round_id, p_player_id, 'stroke:' || v_pass,
        jsonb_build_object('count', jsonb_array_length(v_points)));

      -- Held back for a short redo window; the turn stays pending on the
      -- drawer, so the clock (or a confirm) is what moves it on.
      update rounds set
        state = state || jsonb_build_object('pending_stroke', jsonb_build_object(
          'player_id', p_player_id, 'pass', v_pass, 'points', v_points,
          'color', v_color,
          'width', least(0.05, greatest(0.002,
                     coalesce((p_payload ->> 'width')::numeric, 0.008))))),
        phase_ends_at = now() + interval '5 seconds'
      where id = p_round_id;
      return;
    end if;

    if p_kind = 'confirm_stroke' then
      if not v_has_pending then perform hearth_raise('wrong_phase'); end if;
      perform hearth_clear_pending(p_round_id, p_player_id);   -- advance commits it
      return;
    end if;

    if p_kind = 'redo_stroke' then
      if not v_has_pending then perform hearth_raise('wrong_phase'); end if;
      perform hearth_drop_action(p_round_id, p_player_id, 'stroke:' || v_pass);
      v_turn_ends := (r.state ->> 'turn_ends_at')::timestamptz;
      update rounds set
        state = state || jsonb_build_object(
          'pending_stroke', null,
          'attempt', coalesce((state ->> 'attempt')::int, 0) + 1),
        phase_ends_at = greatest(coalesce(v_turn_ends, now()), now() + interval '10 seconds')
      where id = p_round_id;
      return;
    end if;

    if p_kind = 'pass_turn' then
      if v_has_pending then perform hearth_raise('wrong_phase'); end if;
      perform hearth_put_action(p_round_id, p_player_id, 'pass_turn:' || v_pass, '{}'::jsonb);
      perform hearth_clear_pending(p_round_id, p_player_id);
      return;
    end if;
  end if;

  -- voting ------------------------------------------------------
  if r.phase = 'voting' and p_kind = 'ready_to_vote' then
    if coalesce((r.state ->> 'voting_open')::boolean, true) then
      perform hearth_raise('wrong_phase');
    end if;
    -- Toggle, like a reroll request: tapping again takes it back.
    if hearth_has_action(p_round_id, 'voting', 'ready_to_vote', p_player_id) then
      perform hearth_drop_action(p_round_id, p_player_id, 'ready_to_vote');
      return;
    end if;
    perform hearth_put_action(p_round_id, p_player_id, 'ready_to_vote', '{}'::jsonb);
    perform fake_artist_open_vote_if_ready(p_round_id);
    return;
  end if;

  if r.phase = 'voting' and p_kind = 'vote' then
    if not coalesce((r.state ->> 'voting_open')::boolean, true) then
      perform hearth_raise('wrong_phase');
    end if;
    v_unlock := (r.state ->> 'vote_unlock_at')::timestamptz;
    if v_unlock is not null and now() < v_unlock then perform hearth_raise('wrong_phase'); end if;

    v_target := (p_payload ->> 'target_id')::uuid;
    if not exists (select 1 from round_players
                   where round_id = p_round_id and player_id = v_target and is_alive) then
      perform hearth_raise('invalid_target');
    end if;
    perform hearth_put_action(p_round_id, p_player_id, 'vote',
      jsonb_build_object('target_id', v_target));   -- overwritable
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  -- guess -------------------------------------------------------
  if r.phase = 'guess' and p_kind = 'word_guess' then
    if v_role <> 'impostor' then perform hearth_raise('not_your_turn'); end if;
    perform hearth_put_action(p_round_id, p_player_id, 'word_guess',
      jsonb_build_object('text', coalesce(p_payload ->> 'text', '')));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

create or replace function fake_artist_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from round_players
  where round_id = p_round_id and player_id = p_player_id;
  perform hearth_clear_pending(p_round_id, p_player_id);

  if v_role = 'impostor' then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'impostor_left', 'reason', 'impostor_left'));
    return;
  end if;
  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 4 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;
  -- Their remaining turns are skipped by fake_artist_enter_drawing.
  -- One fewer player can also be what tips a paper-mode ready majority.
  if (select phase from rounds where id = p_round_id) = 'voting' then
    perform fake_artist_open_vote_if_ready(p_round_id);
  end if;
end $$;

-- Internal helpers stay ungranted, like everything else 0008 locked down.
revoke all on function fake_artist_commit_pending(uuid) from public, anon, authenticated;
revoke all on function fake_artist_ready_count(uuid) from public, anon, authenticated;
revoke all on function fake_artist_ready_needed(uuid) from public, anon, authenticated;
revoke all on function fake_artist_open_vote_if_ready(uuid) from public, anon, authenticated;
