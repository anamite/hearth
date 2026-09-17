-- ---------------------------------------------------------------
-- Hearth — Fake Artist on paper: no turn taps
-- Mirrors src/backend/mock/games/fakeArtist.ts.
--
-- Paper mode no longer walks the app through every drawing turn. After the
-- reveal it goes straight to the voting phase with the vote shut; the
-- screen names who starts (first_player_id) and everyone taps "Ready to
-- vote" when the group is done. Canvas mode is unchanged, and its turns
-- always carry the 45-second clock again.
-- ---------------------------------------------------------------

/** Paper mode: who starts drawing — the first player in turn order still here. */
create or replace function fake_artist_first_player(p_round_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select player_id from round_players
  where round_id = p_round_id and turn_index is not null
    and not hearth_has_left(player_id)
  order by turn_index
  limit 1
$$;

create or replace function fake_artist_enter_drawing(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_strokes int; v_drawer uuid; v_pass int; i int;
begin
  select count(*) into v_n from round_players
  where round_id = p_round_id and turn_index is not null;
  select coalesce((settings #>> '{fake_artist,strokes_per_player}')::int, 2)
  into v_strokes from rounds where id = p_round_id;

  for i in 0..(v_n * v_strokes + 1) loop
    select (state ->> 'pass')::int into v_pass from rounds where id = p_round_id;
    if v_pass >= v_strokes then
      perform fake_artist_enter_voting(p_round_id);
      return;
    end if;

    v_drawer := fake_artist_current_drawer(p_round_id);
    if v_drawer is not null and not hearth_has_left(v_drawer) then
      perform hearth_set_phase(p_round_id, 'drawing', 45, array[v_drawer]);
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
      -- Paper mode draws with no taps at all: the table goes round from the
      -- first player on its own, and the app waits at "Ready to vote".
      if coalesce((r.settings #>> '{fake_artist,canvas_mode}')::boolean, true) then
        perform fake_artist_enter_drawing(p_round_id);
      else
        perform fake_artist_enter_voting(p_round_id);
      end if;
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
        'ready_needed', fake_artist_ready_needed(p_round_id),
        'first_player_id', fake_artist_first_player(p_round_id),
        'passes_total', coalesce((r.settings #>> '{fake_artist,strokes_per_player}')::int, 2));

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

-- Internal helper stays ungranted, like everything else 0008 locked down.
revoke all on function fake_artist_first_player(uuid) from public, anon, authenticated;
