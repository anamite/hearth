-- ---------------------------------------------------------------
-- Hearth — Fake Artist (spec §11)
-- Mirrors src/backend/mock/games/fakeArtist.ts.
-- ---------------------------------------------------------------

/** Spec §11.2 — lowercase, strip punctuation, collapse whitespace. */
create or replace function hearth_normalise(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(
           regexp_replace(lower(coalesce(t, '')), '[^[:alnum:][:space:]]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

/** Merge keys into rounds.state. */
create or replace function hearth_patch_state(p_round_id uuid, p_patch jsonb)
returns void language sql security definer set search_path = public as $$
  update rounds set state = state || p_patch where id = p_round_id
$$;

-- ---------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------

/**
 * Spec §11.3 step 3 — recent impostors are less likely, and anyone who was
 * impostor in BOTH previous rounds is barred unless that leaves under 3
 * eligible. Ordering is (started_at desc, id desc): two rounds can share a
 * timestamp, and an arbitrary order there would silently defeat the rule.
 */
create or replace function fake_artist_pick_impostor(p_round_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_recent uuid[];
  v_barred uuid;
  v_candidates uuid[];
  v_eligible uuid[];
  v_total numeric := 0;
  v_r numeric;
  v_acc numeric := 0;
  v_id uuid;
begin
  select group_id into v_group from rounds where id = p_round_id;
  v_candidates := hearth_present(p_round_id);

  select coalesce(array_agg(imp order by ord), '{}') into v_recent
  from (
    select (select rp.player_id from round_players rp
            where rp.round_id = r.id and rp.role = 'impostor' limit 1) as imp,
           row_number() over (order by r.started_at desc, r.id desc) as ord
    from rounds r
    where r.group_id = v_group and r.game_type = 'fake_artist'
      and r.id <> p_round_id and r.ended_at is not null
    order by r.started_at desc, r.id desc
    limit 6
  ) t where t.imp is not null;

  if array_length(v_recent, 1) >= 2 and v_recent[1] = v_recent[2] then
    v_barred := v_recent[1];
  end if;

  select coalesce(array_agg(c), '{}') into v_eligible
  from unnest(v_candidates) as c
  where v_barred is null or c <> v_barred;

  if coalesce(array_length(v_eligible, 1), 0) < 3 then
    v_eligible := v_candidates;
  end if;

  -- Cumulative-weight sampling with weight 1 / (1 + recent impostor count).
  select sum(1.0 / (1 + (select count(*) from unnest(v_recent) x where x = c)))
  into v_total from unnest(v_eligible) as c;

  v_r := random() * v_total;
  foreach v_id in array v_eligible loop
    v_acc := v_acc + 1.0 / (1 + (select count(*) from unnest(v_recent) x where x = v_id));
    if v_acc >= v_r then return v_id; end if;
  end loop;
  return v_eligible[array_length(v_eligible, 1)];
end $$;

/** Steps 1–6 of §11.3. Shared by first setup and by reroll. */
create or replace function fake_artist_deal(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_content jsonb;
  v_payload jsonb;
  v_impostor uuid;
  v_ids uuid[];
  v_id uuid;
  i int := 0;
begin
  v_content := hearth_take_content(p_round_id, 'fake_artist');
  v_payload := v_content -> 'payload';
  v_impostor := fake_artist_pick_impostor(p_round_id);

  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players set
      turn_index = i,
      role = case when v_id = v_impostor then 'impostor' else 'artist' end,
      private = case when v_id = v_impostor then '{}'::jsonb
                     else jsonb_build_object(
                       'word', v_payload ->> 'text',
                       'description', v_payload ->> 'description',
                       'image_url', v_payload ->> 'image_url') end
    where round_id = p_round_id and player_id = v_id;
    i := i + 1;
  end loop;

  -- Anyone not present keeps no turn index and takes no part.
  update round_players set turn_index = null
  where round_id = p_round_id and not (player_id = any(v_ids));

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'content_id', v_content ->> 'content_id',
    'word',       v_payload ->> 'text',
    'description',v_payload ->> 'description',
    'aliases',    coalesce(v_payload -> 'aliases',
                           to_jsonb(array[lower(v_payload ->> 'text')])),
    'pass', 0, 'turn', 0, 'strokes', '[]'::jsonb,
    'bank_reset', ((v_content ->> 'bank_reset')::boolean
                   or coalesce((select (state ->> 'bank_reset')::boolean
                                from rounds where id = p_round_id), false))
  ));
end $$;

create or replace function fake_artist_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform fake_artist_deal(p_round_id);
  perform hearth_patch_state(p_round_id, jsonb_build_object('reroll_count', 0));
  -- reveal carries a generous safety timer so it can never stall (§19.2).
  perform hearth_set_phase(p_round_id, 'reveal', 180, hearth_present(p_round_id));
end $$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function fake_artist_current_drawer(p_round_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select rp.player_id from round_players rp, rounds r
  where r.id = p_round_id and rp.round_id = p_round_id
    and rp.turn_index = (r.state ->> 'turn')::int
$$;

create or replace function fake_artist_step_turn(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_n int; v_turn int; v_pass int;
begin
  select count(*) into v_n from round_players
  where round_id = p_round_id and turn_index is not null;
  select (state ->> 'turn')::int, (state ->> 'pass')::int into v_turn, v_pass
  from rounds where id = p_round_id;

  v_turn := v_turn + 1;
  if v_turn >= v_n then v_turn := 0; v_pass := v_pass + 1; end if;
  perform hearth_patch_state(p_round_id,
    jsonb_build_object('turn', v_turn, 'pass', v_pass));
end $$;

create or replace function fake_artist_enter_voting(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_unlock timestamptz; v_ends timestamptz;
begin
  select * into r from rounds where id = p_round_id;
  -- §11.4 — a paper-mode round can otherwise reach the vote in seconds.
  v_unlock := greatest(now(), r.started_at
    + make_interval(secs => coalesce((r.settings #>> '{fake_artist,vote_delay_seconds}')::int, 60)));
  v_ends := v_unlock + interval '90 seconds';

  perform hearth_patch_state(p_round_id, jsonb_build_object('vote_unlock_at', v_unlock));
  perform hearth_set_phase(p_round_id, 'voting', null, hearth_living(p_round_id));
  update rounds set phase_ends_at = v_ends where id = p_round_id;
end $$;

/** Enters the turn described by state.pass/state.turn, skipping absences. */
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
      return;
    end if;
    perform fake_artist_step_turn(p_round_id);
  end loop;

  perform fake_artist_enter_voting(p_round_id);
end $$;

/**
 * Tally. A player is accused on strictly more than half of the votes cast;
 * ties therefore favour the Impostor, which is the intended rule (§11.4).
 */
create or replace function fake_artist_finish_vote(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_votes jsonb; v_n int; v_accused uuid; v_impostor uuid; v_guess_secs int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'voter_id', player_id, 'target_id', payload ->> 'target_id')), '[]'::jsonb),
         count(*)
  into v_votes, v_n
  from actions
  where round_id = p_round_id and phase = 'voting' and kind = 'vote'
    and payload ->> 'target_id' is not null;

  select (payload ->> 'target_id')::uuid into v_accused
  from actions
  where round_id = p_round_id and phase = 'voting' and kind = 'vote'
    and payload ->> 'target_id' is not null
  group by payload ->> 'target_id'
  having count(*) > v_n / 2.0
  limit 1;

  select player_id into v_impostor from round_players
  where round_id = p_round_id and role = 'impostor';

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'votes', v_votes, 'accused_id', v_accused));

  if v_accused is not null and v_accused = v_impostor then
    select coalesce((settings #>> '{fake_artist,impostor_guess_seconds}')::int, 15)
    into v_guess_secs from rounds where id = p_round_id;
    perform hearth_patch_state(p_round_id, jsonb_build_object('caught', true));
    perform hearth_set_phase(p_round_id, 'guess', v_guess_secs, array[v_impostor]);
    return;
  end if;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'winner', 'impostor',
    'reason', case when v_accused is null then 'impostor_escaped' else 'wrong_accusation' end,
    'word', (select state ->> 'word' from rounds where id = p_round_id),
    'impostor_id', v_impostor, 'accused_id', v_accused,
    'votes', v_votes, 'guess', null, 'caught', false,
    'bank_reset', coalesce((select (state ->> 'bank_reset')::boolean
                            from rounds where id = p_round_id), false)));
end $$;

create or replace function fake_artist_finish_guess(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_impostor uuid; v_guess text; v_correct boolean; r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  select player_id into v_impostor from round_players
  where round_id = p_round_id and role = 'impostor';

  v_guess := coalesce(
    (select payload ->> 'text' from actions
     where round_id = p_round_id and phase = 'guess'
       and kind = 'word_guess' and player_id = v_impostor), '');

  v_correct := exists (
    select 1 from jsonb_array_elements_text(coalesce(r.state -> 'aliases', '[]'::jsonb)) a
    where hearth_normalise(a) = hearth_normalise(v_guess)
  ) and hearth_normalise(v_guess) <> '';

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'winner', case when v_correct then 'impostor' else 'artists' end,
    'reason', case when v_correct then 'impostor_guessed_word' else 'impostor_caught' end,
    'word', r.state ->> 'word',
    'impostor_id', v_impostor,
    'accused_id', r.state ->> 'accused_id',
    'votes', coalesce(r.state -> 'votes', '[]'::jsonb),
    'guess', v_guess, 'caught', true,
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false)));
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
      perform fake_artist_step_turn(p_round_id);   -- a timed-out turn records no stroke
      perform fake_artist_enter_drawing(p_round_id);
    when 'voting' then
      perform fake_artist_finish_vote(p_round_id);
    when 'guess' then
      perform fake_artist_finish_guess(p_round_id);
    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

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
        'strokes', v_strokes);

    when 'voting' then
      -- Individual votes are deliberately absent until the phase ends (§11.8).
      return jsonb_build_object(
        'strokes', v_strokes, 'canvas_mode', v_canvas,
        'votes_cast', (select count(distinct player_id) from actions
                       where round_id = p_round_id and phase = 'voting' and kind = 'vote'),
        'votes_needed', coalesce(array_length(hearth_living(p_round_id), 1), 0),
        'vote_unlock_at', r.state ->> 'vote_unlock_at');

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

create or replace function fake_artist_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  -- The Impostor's row simply has no word in it; there is nothing to strip.
  select coalesce(private, '{}'::jsonb) from round_players
  where round_id = p_round_id and player_id = p_player_id
$$;

create or replace function fake_artist_role_visible(p_round_id uuid, p_viewer uuid, p_subject uuid)
returns boolean language sql security definer set search_path = public as $$
  select (select phase from rounds where id = p_round_id) = 'result'
$$;

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
      return hearth_has_action(p_round_id, 'voting', 'vote', p_player_id);
    when 'guess' then
      return hearth_has_action(p_round_id, 'guess', 'word_guess', p_player_id);
    else return true;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Actions (§11.7)
-- ---------------------------------------------------------------

create or replace function fake_artist_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype;
  v_role text; v_pass int; v_requests int; v_present int; v_count int;
  v_drawer uuid; v_target uuid; v_points jsonb; v_color text; v_unlock timestamptz;
begin
  select * into r from rounds where id = p_round_id;
  select role into v_role from round_players
  where round_id = p_round_id and player_id = p_player_id;
  v_pass := coalesce((r.state ->> 'pass')::int, 0);

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
      if not coalesce((r.settings #>> '{fake_artist,canvas_mode}')::boolean, true) then
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

      update rounds set state = jsonb_set(state, '{strokes}',
        coalesce(state -> 'strokes', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'player_id', p_player_id, 'pass', v_pass, 'points', v_points,
          'color', v_color,
          'width', least(0.05, greatest(0.002,
                     coalesce((p_payload ->> 'width')::numeric, 0.008))))))
      where id = p_round_id;

      perform hearth_clear_pending(p_round_id, p_player_id);
      return;
    end if;

    if p_kind = 'pass_turn' then
      perform hearth_put_action(p_round_id, p_player_id, 'pass_turn:' || v_pass, '{}'::jsonb);
      perform hearth_clear_pending(p_round_id, p_player_id);
      return;
    end if;
  end if;

  -- voting ------------------------------------------------------
  if r.phase = 'voting' and p_kind = 'vote' then
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

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

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
  end if;
  -- Their remaining turns are skipped by fake_artist_enter_drawing.
end $$;

create or replace function fake_artist_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rp record; v_winner text; v_caught boolean; v_won boolean;
begin
  v_winner := p_result ->> 'winner';
  v_caught := coalesce((p_result ->> 'caught')::boolean, false);

  for rp in select player_id, role from round_players where round_id = p_round_id loop
    v_won := (v_winner = 'impostor' and rp.role = 'impostor')
          or (v_winner = 'artists' and rp.role <> 'impostor');
    perform hearth_bump_stats(p_round_id, rp.player_id, 'fake_artist',
      1,
      case when v_won then 1 else 0 end,
      case when rp.role = 'impostor' then 1 else 0 end,
      case when rp.role = 'impostor' and v_caught then 1 else 0 end,
      0);
  end loop;
end $$;
