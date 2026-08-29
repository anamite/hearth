-- ---------------------------------------------------------------
-- Hearth — Night Village (spec §12)
-- Mirrors src/backend/mock/games/nightVillage.ts.
--
-- The mechanics are those of the public-domain game usually called Mafia.
-- The trademarked names MUST NOT appear anywhere (§23).
-- ---------------------------------------------------------------

/** Spec §12.3. */
create or replace function nv_wolves_for(p_count int)
returns int language sql immutable as $$
  select case when p_count <= 6 then 1 when p_count <= 9 then 2 else 3 end
$$;

create or replace function nv_role_label(p_role text)
returns text language sql immutable as $$
  select case p_role when 'wolf' then 'Wolf' when 'seer' then 'Seer'
                     when 'doctor' then 'Doctor' else 'Villager' end
$$;

create or replace function nv_article(p_word text)
returns text language sql immutable as $$
  select case when left(lower(p_word), 1) in ('a','e','i','o','u') then 'an' else 'a' end
$$;

create or replace function nv_name_clip(p_player_id uuid)
returns text language sql security definer set search_path = public as $$
  select 'names/' || lower(nickname) from players where id = p_player_id
$$;

/** Narration always ships clip keys AND on-screen text (§14.6). */
create or replace function nv_say(p_round_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  select coalesce((state #>> '{narration,seq}')::int, 0) + 1 into v_seq
  from rounds where id = p_round_id;
  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'narration', jsonb_build_object('seq', v_seq, 'lines', p_lines)));
end $$;

create or replace function nv_living_with_role(p_round_id uuid, p_role text)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(rp.player_id order by rp.turn_index), '{}')
  from round_players rp join players p on p.id = rp.player_id
  where rp.round_id = p_round_id and rp.role = p_role and rp.is_alive and not p.has_left
$$;

create or replace function nv_eliminate(p_round_id uuid, p_player_id uuid, p_cause text)
returns text language plpgsql security definer set search_path = public as $$
declare v_role text; v_day int;
begin
  select role into v_role from round_players
  where round_id = p_round_id and player_id = p_player_id and is_alive;
  if v_role is null then return null; end if;

  update round_players set is_alive = false
  where round_id = p_round_id and player_id = p_player_id;

  select day_number into v_day from rounds where id = p_round_id;
  update rounds set state = jsonb_set(state, '{eliminations}',
    coalesce(state -> 'eliminations', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'day', v_day, 'player_id', p_player_id, 'role', v_role, 'cause', p_cause)))
  where id = p_round_id;

  return v_role;
end $$;

/** Spec §12.8. */
create or replace function nv_check_win(p_round_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wolves int; v_others int;
begin
  select count(*) filter (where rp.role = 'wolf'),
         count(*) filter (where rp.role <> 'wolf')
  into v_wolves, v_others
  from round_players rp join players p on p.id = rp.player_id
  where rp.round_id = p_round_id and rp.is_alive and not p.has_left;

  if v_wolves = 0 then return 'village'; end if;
  if v_wolves >= v_others then return 'wolves'; end if;
  return null;
end $$;

create or replace function nv_end_game(p_round_id uuid, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
declare v_day int; v_state jsonb;
begin
  perform nv_say(p_round_id, jsonb_build_array(jsonb_build_object(
    'clips', jsonb_build_array(
      case when p_winner = 'village' then 'outcomes/village_wins' else 'outcomes/wolves_wins' end),
    'text', case when p_winner = 'village'
      then 'Every wolf has been driven out. The village survives.'
      else 'The wolves outnumber the village. The village falls.' end)));

  select day_number, state into v_day, v_state from rounds where id = p_round_id;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'winner', p_winner,
    'day_number', v_day,
    'eliminations', coalesce(v_state -> 'eliminations', '[]'::jsonb),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                'player_id', player_id, 'role', role, 'is_alive', is_alive)), '[]'::jsonb)
              from round_players where round_id = p_round_id)));
end $$;

-- ---------------------------------------------------------------
-- Phase entry
-- ---------------------------------------------------------------

create or replace function nv_enter_night_wolves(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_secs int;
begin
  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'night_kill_target', null, 'night_protect_target', null, 'locked_wolf_target', null));
  perform hearth_clear_phase_actions(p_round_id, 'night_wolves');
  perform nv_say(p_round_id, jsonb_build_array(
    jsonb_build_object('clips', jsonb_build_array('cues/night_falls'),
                       'text', 'Night falls over the village.'),
    jsonb_build_object('clips', jsonb_build_array('cues/wolves_wake'),
                       'text', 'The wolves wake, and choose.')));
  select coalesce((settings #>> '{night_village,night_action_seconds}')::int, 45)
  into v_secs from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'night_wolves', v_secs,
    nv_living_with_role(p_round_id, 'wolf'));
end $$;

create or replace function nv_enter_morning(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_target uuid; v_protect uuid; v_role text;
  v_reveal boolean; v_nick text; v_word text;
begin
  select * into r from rounds where id = p_round_id;
  v_target  := nullif(r.state ->> 'night_kill_target', '')::uuid;
  v_protect := nullif(r.state ->> 'night_protect_target', '')::uuid;
  v_reveal  := coalesce((r.settings #>> '{night_village,reveal_role_on_death}')::boolean, true);

  -- §12.6: no target, or the doctor guessed right, and nobody dies.
  if v_target is not null and v_target is distinct from v_protect then
    v_role := nv_eliminate(p_round_id, v_target, 'wolves');
  end if;

  if v_role is not null then
    select nickname into v_nick from players where id = v_target;
    v_word := nv_role_label(v_role);
    perform nv_say(p_round_id, jsonb_build_array(
      jsonb_build_object('clips', jsonb_build_array('cues/morning_comes'),
                         'text', 'Morning comes over the village.'),
      jsonb_build_object('clips', jsonb_build_array(nv_name_clip(v_target), 'outcomes/died'),
        'text', case when v_reveal
          then v_nick || ' did not survive the night. ' || v_nick || ' was '
               || nv_article(v_word) || ' ' || v_word || '.'
          else v_nick || ' did not survive the night.' end)));
    perform hearth_patch_state(p_round_id, jsonb_build_object('morning_summary',
      jsonb_build_object('died_id', v_target,
                         'died_role', case when v_reveal then v_role else null end,
                         'saved', false)));
  else
    perform nv_say(p_round_id, jsonb_build_array(
      jsonb_build_object('clips', jsonb_build_array('cues/morning_comes'),
                         'text', 'Morning comes over the village.'),
      jsonb_build_object('clips', jsonb_build_array('outcomes/survived'),
                         'text', 'Everybody survived the night.')));
    perform hearth_patch_state(p_round_id, jsonb_build_object('morning_summary',
      jsonb_build_object('died_id', null, 'died_role', null,
                         'saved', (v_target is not null and v_target = v_protect))));
  end if;

  -- The doctor is never told whether the save landed (§12.7).
  update round_players set private = private || jsonb_build_object(
    'protected_last_night', v_protect)
  where round_id = p_round_id and role = 'doctor';

  perform hearth_set_phase(p_round_id, 'morning', 8, '{}'::uuid[]);
end $$;

/** Skips absent or dead roles without disturbing neighbouring durations (§12.5). */
create or replace function nv_enter_after_seer(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_doctor uuid[]; v_secs int;
begin
  v_doctor := nv_living_with_role(p_round_id, 'doctor');
  if coalesce(array_length(v_doctor, 1), 0) = 0 then
    perform nv_enter_morning(p_round_id);
    return;
  end if;
  perform hearth_clear_phase_actions(p_round_id, 'night_doctor');
  perform nv_say(p_round_id, jsonb_build_array(
    jsonb_build_object('clips', jsonb_build_array('cues/seer_sleep'), 'text', 'The seer sleeps.'),
    jsonb_build_object('clips', jsonb_build_array('cues/doctor_wake'),
                       'text', 'The doctor wakes, and protects.')));
  select coalesce((settings #>> '{night_village,night_action_seconds}')::int, 45)
  into v_secs from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'night_doctor', v_secs, v_doctor);
end $$;

create or replace function nv_enter_after_wolves(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_seer uuid[]; v_secs int;
begin
  v_seer := nv_living_with_role(p_round_id, 'seer');
  if coalesce(array_length(v_seer, 1), 0) = 0 then
    perform nv_enter_after_seer(p_round_id);
    return;
  end if;
  perform hearth_clear_phase_actions(p_round_id, 'night_seer');
  perform nv_say(p_round_id, jsonb_build_array(
    jsonb_build_object('clips', jsonb_build_array('cues/wolves_sleep'), 'text', 'The wolves sleep.'),
    jsonb_build_object('clips', jsonb_build_array('cues/seer_wake'),
                       'text', 'The seer wakes, and looks.')));
  select coalesce((settings #>> '{night_village,night_action_seconds}')::int, 45)
  into v_secs from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'night_seer', v_secs, v_seer);
end $$;

create or replace function nv_enter_day_discuss(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_secs int;
begin
  update rounds set day_number = day_number + 1 where id = p_round_id;
  perform hearth_clear_phase_actions(p_round_id, 'day_discuss');
  select coalesce((settings #>> '{night_village,discussion_seconds}')::int, 240)
  into v_secs from rounds where id = p_round_id;
  perform hearth_set_phase(p_round_id, 'day_discuss', v_secs, '{}'::uuid[]);
end $$;

create or replace function nv_enter_day_vote(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hearth_clear_phase_actions(p_round_id, 'day_vote');
  perform hearth_set_phase(p_round_id, 'day_vote', 60, hearth_living(p_round_id));
end $$;

/**
 * Spec §12.7 — a player is eliminated on strictly more than half of the
 * LIVING, with abstentions counting toward that total but toward no target.
 */
create or replace function nv_enter_evening(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l int; v_votes jsonb; v_out uuid; v_role text; v_reveal boolean; v_nick text; v_word text;
begin
  v_l := coalesce(array_length(hearth_living(p_round_id), 1), 0);
  select coalesce((settings #>> '{night_village,reveal_role_on_death}')::boolean, true)
  into v_reveal from rounds where id = p_round_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'voter_id', player_id, 'target_id', payload ->> 'target_id')), '[]'::jsonb)
  into v_votes from actions
  where round_id = p_round_id and phase = 'day_vote' and kind = 'day_vote';

  select (payload ->> 'target_id')::uuid into v_out
  from actions
  where round_id = p_round_id and phase = 'day_vote' and kind = 'day_vote'
    and payload ->> 'target_id' is not null
  group by payload ->> 'target_id'
  having count(*) > v_l / 2.0
  limit 1;

  if v_out is not null then v_role := nv_eliminate(p_round_id, v_out, 'vote'); end if;

  perform hearth_patch_state(p_round_id, jsonb_build_object('day_result',
    jsonb_build_object('votes', v_votes, 'eliminated_id', v_out,
      'eliminated_role', case when v_reveal then v_role else null end)));

  if v_role is not null then
    select nickname into v_nick from players where id = v_out;
    v_word := nv_role_label(v_role);
    perform nv_say(p_round_id, jsonb_build_array(jsonb_build_object(
      'clips', jsonb_build_array(nv_name_clip(v_out), 'outcomes/voted_out'),
      'text', case when v_reveal
        then 'The village votes out ' || v_nick || '. ' || v_nick || ' was '
             || nv_article(v_word) || ' ' || v_word || '.'
        else 'The village votes out ' || v_nick || '.' end)));
  else
    perform nv_say(p_round_id, jsonb_build_array(jsonb_build_object(
      'clips', jsonb_build_array('outcomes/no_majority'),
      'text', 'The village cannot agree. Nobody is voted out.')));
  end if;

  perform hearth_set_phase(p_round_id, 'evening', 8, '{}'::uuid[]);
end $$;

-- ---------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------

create or replace function night_village_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_n int; v_roles text[] := '{}'; v_wolves uuid[] := '{}';
  v_seer boolean; v_doctor boolean; i int; v_id uuid; v_role text;
begin
  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;
  v_n := coalesce(array_length(v_ids, 1), 0);

  select coalesce((settings #>> '{night_village,include_seer}')::boolean, true),
         coalesce((settings #>> '{night_village,include_doctor}')::boolean, true)
  into v_seer, v_doctor from rounds where id = p_round_id;

  for i in 1..nv_wolves_for(v_n) loop v_roles := v_roles || 'wolf'; end loop;
  if v_seer   then v_roles := v_roles || 'seer';   end if;
  if v_doctor then v_roles := v_roles || 'doctor'; end if;
  -- A disabled special role becomes an extra villager (§12.3).
  while coalesce(array_length(v_roles, 1), 0) < v_n loop
    v_roles := v_roles || 'villager';
  end loop;

  for i in 1..v_n loop
    if v_roles[i] = 'wolf' then v_wolves := v_wolves || v_ids[i]; end if;
  end loop;

  for i in 1..v_n loop
    v_id := v_ids[i];
    v_role := v_roles[i];
    update round_players set
      turn_index = i - 1, is_alive = true, role = v_role,
      private = case v_role
        when 'wolf' then jsonb_build_object('fellow_wolves',
          (select coalesce(jsonb_agg(w), '[]'::jsonb) from unnest(v_wolves) w where w <> v_id))
        when 'seer' then jsonb_build_object('checks', '[]'::jsonb)
        when 'doctor' then jsonb_build_object('protected_last_night', null, 'self_protects_used', 0)
        else '{}'::jsonb end
    where round_id = p_round_id and player_id = v_id;
  end loop;

  update round_players set turn_index = null, is_alive = false
  where round_id = p_round_id and not (player_id = any(v_ids));

  update rounds set day_number = 0, state = jsonb_build_object(
    'night_kill_target', null, 'night_protect_target', null,
    'eliminations', '[]'::jsonb,
    'narration', jsonb_build_object('seq', 0, 'lines', '[]'::jsonb))
  where id = p_round_id;

  perform hearth_set_phase(p_round_id, 'reveal', 180, hearth_present(p_round_id));
end $$;

-- ---------------------------------------------------------------
-- Advance
-- ---------------------------------------------------------------

create or replace function night_village_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_target uuid; v_win text; v_votes uuid[];
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'reveal' then
      perform nv_enter_night_wolves(p_round_id);

    when 'night_wolves' then
      v_target := nullif(r.state ->> 'locked_wolf_target', '')::uuid;
      if v_target is null then
        -- §19.2 — random among targets that got at least one vote, else nobody.
        select coalesce(array_agg((payload ->> 'target_id')::uuid), '{}') into v_votes
        from actions where round_id = p_round_id and phase = 'night_wolves'
          and kind = 'wolf_vote' and payload ->> 'target_id' is not null;
        if coalesce(array_length(v_votes, 1), 0) > 0 then
          v_target := v_votes[1 + floor(random() * array_length(v_votes, 1))::int];
        end if;
      end if;
      perform hearth_patch_state(p_round_id,
        jsonb_build_object('night_kill_target', v_target));
      perform nv_enter_after_wolves(p_round_id);

    when 'night_seer'   then perform nv_enter_after_seer(p_round_id);
    when 'night_doctor' then perform nv_enter_morning(p_round_id);

    when 'morning' then
      v_win := nv_check_win(p_round_id);
      if v_win is not null then perform nv_end_game(p_round_id, v_win);
      else perform nv_enter_day_discuss(p_round_id); end if;

    when 'day_discuss' then perform nv_enter_day_vote(p_round_id);
    when 'day_vote'    then perform nv_enter_evening(p_round_id);

    when 'evening' then
      v_win := nv_check_win(p_round_id);
      if v_win is not null then perform nv_end_game(p_round_id, v_win);
      else perform nv_enter_night_wolves(p_round_id); end if;

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function night_village_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_base jsonb; v_skips int; v_living int;
begin
  select * into r from rounds where id = p_round_id;
  v_living := coalesce(array_length(hearth_living(p_round_id), 1), 0);
  v_base := jsonb_build_object(
    'narration', coalesce(r.state -> 'narration',
                          jsonb_build_object('seq', 0, 'lines', '[]'::jsonb)),
    'eliminations', coalesce(r.state -> 'eliminations', '[]'::jsonb),
    'day_number', r.day_number,
    'living_count', v_living);

  case r.phase
    -- Nothing about who is acting or what they chose (§12.12 screen 2).
    when 'night_wolves' then return v_base || jsonb_build_object('acting_role', 'wolves');
    when 'night_seer'   then return v_base || jsonb_build_object('acting_role', 'seer');
    when 'night_doctor' then return v_base || jsonb_build_object('acting_role', 'doctor');

    when 'morning' then
      return v_base || jsonb_build_object('morning', r.state -> 'morning_summary');

    when 'day_discuss' then
      select count(distinct player_id) into v_skips from actions
      where round_id = p_round_id and phase = 'day_discuss' and kind = 'skip_discussion';
      return v_base || jsonb_build_object(
        'skip_votes', v_skips, 'skip_needed', floor(v_living / 2.0)::int + 1);

    when 'day_vote' then
      return v_base || jsonb_build_object(
        'votes_cast', (select count(distinct player_id) from actions
                       where round_id = p_round_id and phase = 'day_vote' and kind = 'day_vote'),
        'votes_needed', v_living);

    when 'evening' then
      return v_base || jsonb_build_object('day_result', r.state -> 'day_result');

    when 'result' then
      return v_base || jsonb_build_object(
        'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                    'player_id', player_id, 'role', role, 'is_alive', is_alive)), '[]'::jsonb)
                  from round_players where round_id = p_round_id),
        'winner', r.result ->> 'winner');

    else return v_base;
  end case;
end $$;

create or replace function night_village_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_priv jsonb; v_role text; v_phase text;
begin
  select coalesce(rp.private, '{}'::jsonb), rp.role, r.phase
  into v_priv, v_role, v_phase
  from round_players rp join rounds r on r.id = rp.round_id
  where rp.round_id = p_round_id and rp.player_id = p_player_id;

  -- Wolves converge without speaking (§12.7) — but only wolves see this.
  if v_role = 'wolf' and v_phase = 'night_wolves' then
    v_priv := v_priv || jsonb_build_object('wolf_votes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'wolf_id', player_id, 'target_id', payload ->> 'target_id'))
      from actions where round_id = p_round_id and phase = 'night_wolves' and kind = 'wolf_vote'
    ), '[]'::jsonb));
  end if;

  return coalesce(v_priv, '{}'::jsonb);
end $$;

create or replace function night_village_role_visible(
  p_round_id uuid, p_viewer uuid, p_subject uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_viewer_alive boolean; v_viewer_left boolean; v_subject_alive boolean;
begin
  select * into r from rounds where id = p_round_id;
  if r.phase = 'result' then return true; end if;

  select rp.is_alive, p.has_left into v_viewer_alive, v_viewer_left
  from round_players rp join players p on p.id = rp.player_id
  where rp.round_id = p_round_id and rp.player_id = p_viewer;

  -- Ghost view (§12.9): the dead watch with full information.
  if coalesce(not v_viewer_alive, false) or coalesce(v_viewer_left, false) then return true; end if;

  select is_alive into v_subject_alive from round_players
  where round_id = p_round_id and player_id = p_subject;
  if not coalesce(v_subject_alive, true)
     and coalesce((r.settings #>> '{night_village,reveal_role_on_death}')::boolean, true)
  then return true; end if;

  return false;
end $$;

create or replace function night_village_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  select phase into v_phase from rounds where id = p_round_id;
  case v_phase
    when 'reveal'       then return hearth_has_action(p_round_id, 'reveal', 'revealed', p_player_id);
    when 'night_wolves' then return hearth_has_action(p_round_id, 'night_wolves', 'wolf_vote', p_player_id);
    when 'night_seer'   then return hearth_has_action(p_round_id, 'night_seer', 'seer_check', p_player_id);
    when 'night_doctor' then return hearth_has_action(p_round_id, 'night_doctor', 'doctor_protect', p_player_id);
    when 'day_vote'     then return hearth_has_action(p_round_id, 'day_vote', 'day_vote', p_player_id);
    else return true;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Actions (§12.11)
-- ---------------------------------------------------------------

create or replace function night_village_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_role text; v_alive boolean; v_target uuid; v_priv jsonb;
  v_wolves uuid[]; v_all_voted boolean; v_distinct int; v_is_wolf boolean;
  v_mode text; v_used int; v_skips int; v_living int;
begin
  select * into r from rounds where id = p_round_id;
  select role, is_alive, coalesce(private, '{}'::jsonb)
  into v_role, v_alive, v_priv
  from round_players where round_id = p_round_id and player_id = p_player_id;
  v_target := nullif(p_payload ->> 'target_id', '')::uuid;

  if r.phase = 'reveal' and p_kind = 'revealed' then
    perform hearth_put_action(p_round_id, p_player_id, 'revealed', '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  -- The dead act never (§12.9).
  if not coalesce(v_alive, false) then perform hearth_raise('wrong_phase'); end if;

  -- wolves ------------------------------------------------------
  if r.phase = 'night_wolves' and p_kind = 'wolf_vote' then
    if v_role <> 'wolf' then perform hearth_raise('not_your_turn'); end if;
    if v_target is null or v_target = p_player_id
       or not exists (select 1 from round_players rp join players p on p.id = rp.player_id
                      where rp.round_id = p_round_id and rp.player_id = v_target
                        and rp.is_alive and not p.has_left)
    then perform hearth_raise('invalid_target'); end if;

    perform hearth_put_action(p_round_id, p_player_id, 'wolf_vote',
      jsonb_build_object('target_id', v_target));

    -- The phase ends only on unanimity (§12.7), not on "everyone clicked".
    v_wolves := nv_living_with_role(p_round_id, 'wolf');
    select count(*) = coalesce(array_length(v_wolves, 1), 0),
           count(distinct payload ->> 'target_id')
    into v_all_voted, v_distinct
    from actions where round_id = p_round_id and phase = 'night_wolves' and kind = 'wolf_vote'
      and player_id = any(v_wolves);

    if v_all_voted and v_distinct = 1 then
      perform hearth_patch_state(p_round_id,
        jsonb_build_object('locked_wolf_target', v_target));
      update rounds set pending_on = '{}' where id = p_round_id;
    end if;
    return;
  end if;

  -- seer --------------------------------------------------------
  if r.phase = 'night_seer' and p_kind = 'seer_check' then
    if v_role <> 'seer' then perform hearth_raise('not_your_turn'); end if;
    if v_target is null or v_target = p_player_id
       or not exists (select 1 from round_players rp join players p on p.id = rp.player_id
                      where rp.round_id = p_round_id and rp.player_id = v_target
                        and rp.is_alive and not p.has_left)
    then perform hearth_raise('invalid_target'); end if;

    -- Cannot re-check somebody already checked (§12.7).
    if exists (select 1 from jsonb_array_elements(coalesce(v_priv -> 'checks', '[]'::jsonb)) c
               where (c ->> 'target_id')::uuid = v_target)
    then perform hearth_raise('invalid_target'); end if;

    select role = 'wolf' into v_is_wolf from round_players
    where round_id = p_round_id and player_id = v_target;

    -- Computed here and delivered only into the seer's own private view.
    update round_players set private = jsonb_set(
      coalesce(private, '{}'::jsonb), '{checks}',
      coalesce(private -> 'checks', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'day', r.day_number, 'target_id', v_target, 'is_wolf', v_is_wolf)))
    where round_id = p_round_id and player_id = p_player_id;

    perform hearth_put_action(p_round_id, p_player_id, 'seer_check',
      jsonb_build_object('target_id', v_target));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  -- doctor ------------------------------------------------------
  if r.phase = 'night_doctor' and p_kind = 'doctor_protect' then
    if v_role <> 'doctor' then perform hearth_raise('not_your_turn'); end if;
    v_mode := coalesce(r.settings #>> '{night_village,doctor_self_protect}', 'once');
    v_used := coalesce((v_priv ->> 'self_protects_used')::int, 0);

    if v_target = p_player_id then
      if v_mode = 'never' or (v_mode = 'once' and v_used >= 1) then
        perform hearth_raise('invalid_target');
      end if;
    end if;
    if v_target is null
       or not exists (select 1 from round_players rp join players p on p.id = rp.player_id
                      where rp.round_id = p_round_id and rp.player_id = v_target
                        and rp.is_alive and not p.has_left)
    then perform hearth_raise('invalid_target'); end if;

    -- Never the same player two nights running (§12.7).
    if nullif(v_priv ->> 'protected_last_night', '')::uuid = v_target then
      perform hearth_raise('invalid_target');
    end if;

    if v_target = p_player_id then
      update round_players set private = private
        || jsonb_build_object('self_protects_used', v_used + 1)
      where round_id = p_round_id and player_id = p_player_id;
    end if;

    perform hearth_patch_state(p_round_id,
      jsonb_build_object('night_protect_target', v_target));
    perform hearth_put_action(p_round_id, p_player_id, 'doctor_protect',
      jsonb_build_object('target_id', v_target));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  -- day ---------------------------------------------------------
  if r.phase = 'day_discuss' and p_kind = 'skip_discussion' then
    if hearth_has_action(p_round_id, 'day_discuss', 'skip_discussion', p_player_id) then
      perform hearth_drop_action(p_round_id, p_player_id, 'skip_discussion');
      return;
    end if;
    perform hearth_put_action(p_round_id, p_player_id, 'skip_discussion', '{}'::jsonb);

    select count(distinct player_id) into v_skips from actions
    where round_id = p_round_id and phase = 'day_discuss' and kind = 'skip_discussion';
    v_living := coalesce(array_length(hearth_living(p_round_id), 1), 0);
    if v_skips > v_living / 2.0 then perform nv_enter_day_vote(p_round_id); end if;
    return;
  end if;

  if r.phase = 'day_vote' and p_kind = 'day_vote' then
    if v_target is not null
       and not exists (select 1 from round_players rp join players p on p.id = rp.player_id
                       where rp.round_id = p_round_id and rp.player_id = v_target
                         and rp.is_alive and not p.has_left)
    then perform hearth_raise('invalid_target'); end if;

    perform hearth_put_action(p_round_id, p_player_id, 'day_vote',
      jsonb_build_object('target_id', v_target));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function night_village_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_nick text; v_win text;
begin
  perform hearth_clear_pending(p_round_id, p_player_id);
  select role into v_role from round_players
  where round_id = p_round_id and player_id = p_player_id and is_alive;
  if v_role is null then return; end if;

  -- §19.3 — treated as eliminated, with a neutral announcement.
  perform nv_eliminate(p_round_id, p_player_id, 'left');
  select nickname into v_nick from players where id = p_player_id;
  perform nv_say(p_round_id, jsonb_build_array(jsonb_build_object(
    'clips', jsonb_build_array(nv_name_clip(p_player_id), 'outcomes/left'),
    'text', v_nick || ' has left the village.')));

  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 4 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;

  v_win := nv_check_win(p_round_id);
  if v_win is not null then perform nv_end_game(p_round_id, v_win); end if;
end $$;

create or replace function night_village_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rp record; v_winner text; v_is_wolf boolean; v_won boolean; v_caught boolean;
begin
  v_winner := p_result ->> 'winner';
  for rp in select player_id, role, is_alive from round_players where round_id = p_round_id loop
    v_is_wolf := rp.role = 'wolf';
    v_won := (v_winner = 'wolves') = v_is_wolf;
    v_caught := v_is_wolf and exists (
      select 1 from jsonb_array_elements(coalesce(p_result -> 'eliminations', '[]'::jsonb)) e
      where (e ->> 'player_id')::uuid = rp.player_id and e ->> 'cause' = 'vote');

    perform hearth_bump_stats(p_round_id, rp.player_id, 'night_village',
      1,
      case when v_won then 1 else 0 end,
      case when v_is_wolf then 1 else 0 end,
      case when v_caught then 1 else 0 end,
      -- points doubles as the survival count, surfaced as a survival rate (§20.2)
      case when rp.is_alive then 1 else 0 end);
  end loop;
end $$;
