-- ---------------------------------------------------------------
-- Hearth — Envelope
-- Mirrors src/backend/mock/games/envelope.ts, function for function.
--
-- Everybody wants something and nobody will say what. The app does the
-- two things paper cannot: it keeps everyone's goal secret, and it is
-- the impartial thing that ends an argument by buzzing.
-- ---------------------------------------------------------------

/** The public events, in the same order as EVENT_BANK in the mock. */
create or replace function envelope_event_bank()
returns jsonb language sql immutable as $$
  select '[
    {"id":"pass_left","title":"Everybody shifts",
     "text":"Every player passes two cards to the player on their left. Right now, no negotiating."},
    {"id":"pass_right","title":"The other way",
     "text":"Every player passes two cards to the player on their right. Right now, no negotiating."},
    {"id":"queens_double","title":"Queens are loud",
     "text":"Queens count double from here on, for whatever anyone is quietly trying to do."},
    {"id":"open_envelope","title":"Open envelope",
     "text":"{a} must show the table exactly what they were asked to do.",
     "targets":1,"opens":true},
    {"id":"blind_swap","title":"Blind swap",
     "text":"{a} and {b} each hand over one card, face down, without seeing what comes back.",
     "targets":2},
    {"id":"silence","title":"No talking",
     "text":"The next session is silent. Offers by pointing, nodding and glaring only."},
    {"id":"deadline","title":"Short fuse",
     "text":"The next session is half as long. Move.","halves":true},
    {"id":"amnesty","title":"Amnesty",
     "text":"Anyone who wants to may show the table one card. Nobody has to."},
    {"id":"tax","title":"The middle takes one",
     "text":"Everybody puts one card face down in the middle. It is out of the game for good."},
    {"id":"gift","title":"Forced generosity",
     "text":"{a} must give one card to whoever asks for it first.","targets":1},
    {"id":"inheritance","title":"Inheritance",
     "text":"{a} takes one card of their choosing from {b}. {b} does not get to object.",
     "targets":2}
  ]'::jsonb
$$;

/** What this player claimed at the scoring table: true, false or null. */
create or replace function envelope_claim(p_round_id uuid, p_player_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select (hearth_action_payload(p_round_id, 'reveal', 'claim', p_player_id) ->> 'made')::boolean
$$;

/** Assignments only ever become public when the game says so. */
create or replace function envelope_open_assignments(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; rec record; v_all boolean; v_out jsonb := '{}'::jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_all := r.phase in ('reveal', 'result');

  for rec in
    select rp.player_id, rp.private from round_players rp where rp.round_id = p_round_id
  loop
    if not v_all
       and not (coalesce(r.state -> 'revealed', '[]'::jsonb) ? rec.player_id::text) then
      continue;
    end if;
    if coalesce(rec.private ->> 'text', '') = '' then continue; end if;
    v_out := v_out || jsonb_build_object(rec.player_id::text, jsonb_build_object(
      'text', rec.private ->> 'text',
      'points', coalesce((rec.private ->> 'points')::int, 0)));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function envelope_start_trade(p_round_id uuid, p_session int)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  v_secs := coalesce((r.settings #>> '{envelope,session_seconds}')::int, 240);
  if coalesce((r.state ->> 'half_next')::boolean, false) then
    v_secs := greatest(30, round(v_secs / 2.0)::int);
  end if;

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'session', p_session, 'half_next', false, 'event', null));
  perform hearth_set_phase(p_round_id, 'trade', v_secs, hearth_present(p_round_id));
end $$;

create or replace function envelope_enter_event(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_pool jsonb; v_template jsonb; v_text text;
  v_present uuid[]; v_a uuid; v_b uuid; v_patch jsonb;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_pool
  from jsonb_array_elements(envelope_event_bank()) e
  where not (coalesce(r.state -> 'events_used', '[]'::jsonb) ? (e ->> 'id'));
  if jsonb_array_length(v_pool) = 0 then v_pool := envelope_event_bank(); end if;

  v_template := v_pool -> floor(random() * jsonb_array_length(v_pool))::int;

  select coalesce(array_agg(x order by random()), '{}') into v_present
  from unnest(hearth_present(p_round_id)) as x;
  v_a := v_present[1];
  v_b := v_present[2];

  v_text := v_template ->> 'text';
  if (v_template ? 'targets') and v_a is not null then
    v_text := replace(v_text, '{a}', (select nickname from players where id = v_a));
  end if;
  if coalesce((v_template ->> 'targets')::int, 0) = 2 and v_b is not null then
    v_text := replace(v_text, '{b}', (select nickname from players where id = v_b));
  end if;

  v_patch := jsonb_build_object(
    'events_used', coalesce(r.state -> 'events_used', '[]'::jsonb)
                   || jsonb_build_array(v_template ->> 'id'),
    'event', jsonb_build_object(
      'id', v_template ->> 'id', 'title', v_template ->> 'title', 'text', v_text));

  if coalesce((v_template ->> 'halves')::boolean, false) then
    v_patch := v_patch || jsonb_build_object('half_next', true);
  end if;
  if coalesce((v_template ->> 'opens')::boolean, false) and v_a is not null then
    v_patch := v_patch || jsonb_build_object('revealed',
      case when coalesce(r.state -> 'revealed', '[]'::jsonb) ? v_a::text
           then coalesce(r.state -> 'revealed', '[]'::jsonb)
           else coalesce(r.state -> 'revealed', '[]'::jsonb) || jsonb_build_array(v_a::text)
      end);
  end if;

  perform hearth_patch_state(p_round_id, v_patch);
  perform hearth_set_phase(p_round_id, 'event', 16, '{}'::uuid[]);
end $$;

create or replace function envelope_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb; v_best int;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(x order by x.score desc), '[]'::jsonb) into v_standings
  from (
    select rp.player_id::text as player_id,
           -- §19.2 — silence at the scoring table reads as "didn't manage it".
           coalesce(envelope_claim(p_round_id, rp.player_id), false) as made,
           case when coalesce(envelope_claim(p_round_id, rp.player_id), false)
                then coalesce((rp.private ->> 'points')::int, 0) else 0 end as score,
           coalesce(rp.private ->> 'text', '') as assignment,
           coalesce((rp.private ->> 'points')::int, 0) as points
    from round_players rp
    where rp.round_id = p_round_id and not hearth_has_left(rp.player_id)) x;

  select coalesce(max((e ->> 'score')::int), 0) into v_best
  from jsonb_array_elements(v_standings) e;

  perform hearth_end_round(p_round_id, jsonb_build_object(
    'standings', v_standings,
    'winners', case when v_best > 0 then
                 coalesce((select jsonb_agg(e -> 'player_id')
                           from jsonb_array_elements(v_standings) e
                           where (e ->> 'score')::int = v_best), '[]'::jsonb)
               else '[]'::jsonb end,
    'best_score', v_best,
    'events', coalesce(r.state -> 'events', '[]'::jsonb),
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false)));
end $$;

create or replace function envelope_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_ids uuid[]; v_id uuid; i int := 0; v_reset boolean := false;
  v_order jsonb := '[]'::jsonb; v_content jsonb; v_text text;
  v_others uuid[]; v_first uuid; v_second uuid; v_secs int;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  update round_players set turn_index = null, role = 'player', private = '{}'::jsonb
  where round_id = p_round_id;

  foreach v_id in array v_ids loop
    v_content := hearth_take_content(p_round_id, 'envelope');
    if coalesce((v_content ->> 'bank_reset')::boolean, false) then v_reset := true; end if;

    -- {left} and {right} resolve to two other players by name, so an
    -- assignment reads the same wherever anybody happens to be sitting.
    select coalesce(array_agg(x order by random()), '{}') into v_others
    from unnest(v_ids) as x where x <> v_id;
    v_first := v_others[1];
    v_second := coalesce(v_others[2], v_others[1]);

    v_text := v_content -> 'payload' ->> 'text';
    if v_first is not null then
      v_text := replace(v_text, '{left}', (select nickname from players where id = v_first));
    end if;
    if v_second is not null then
      v_text := replace(v_text, '{right}', (select nickname from players where id = v_second));
    end if;

    update round_players set
      turn_index = i,
      private = jsonb_build_object(
        'text', v_text,
        'points', coalesce((v_content -> 'payload' ->> 'points')::int, 3))
    where round_id = p_round_id and player_id = v_id;

    v_order := v_order || to_jsonb(v_id::text);
    i := i + 1;
  end loop;

  update rounds set state = jsonb_build_object(
    'order', v_order,
    'sessions', greatest(coalesce((r.settings #>> '{envelope,sessions}')::int, 3), 1),
    'session', 0, 'event', null, 'events', '[]'::jsonb, 'events_used', '[]'::jsonb,
    'revealed', '[]'::jsonb, 'half_next', false, 'bank_reset', v_reset)
  where id = p_round_id;

  v_secs := coalesce((r.settings #>> '{envelope,brief_seconds}')::int, 60);
  perform hearth_set_phase(p_round_id, 'brief', v_secs, hearth_present(p_round_id));
end $$;

create or replace function envelope_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'brief' then
      perform envelope_start_trade(p_round_id, 1);

    when 'trade' then
      if coalesce((r.state ->> 'session')::int, 1) >= coalesce((r.state ->> 'sessions')::int, 1)
      then
        perform hearth_set_phase(p_round_id, 'reveal', 120, hearth_present(p_round_id));
      else
        perform envelope_enter_event(p_round_id);
      end if;

    when 'event' then
      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'events', coalesce(r.state -> 'events', '[]'::jsonb)
                  || jsonb_build_array(coalesce(r.state -> 'event', 'null'::jsonb))));
      perform envelope_start_trade(p_round_id, coalesce((r.state ->> 'session')::int, 1) + 1);

    when 'reveal' then
      perform envelope_finish(p_round_id);

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function envelope_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; rec record; v_claims jsonb := '{}'::jsonb; v_c boolean;
begin
  select * into r from rounds where id = p_round_id;

  for rec in select player_id from round_players where round_id = p_round_id loop
    v_c := envelope_claim(p_round_id, rec.player_id);
    v_claims := v_claims || jsonb_build_object(rec.player_id::text,
      case when v_c is null then 'null'::jsonb else to_jsonb(v_c) end);
  end loop;

  return jsonb_build_object(
    'session_number', coalesce((r.state ->> 'session')::int, 0),
    'sessions_total', coalesce((r.state ->> 'sessions')::int, 0),
    'event', case when r.phase = 'event' then coalesce(r.state -> 'event', 'null'::jsonb)
                  else null end,
    'events', coalesce(r.state -> 'events', '[]'::jsonb),
    -- Empty until an event opens somebody's envelope, or until scoring.
    'assignments', envelope_open_assignments(p_round_id),
    'revealed', coalesce(r.state -> 'revealed', '[]'::jsonb),
    'claims', v_claims,
    'half_next', coalesce((r.state ->> 'half_next')::boolean, false),
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false));
end $$;

/**
 * The absence of a secret is meaningful: a player with no assignment gets
 * nothing, not a null-shaped one.
 */
create or replace function envelope_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(private, '{}'::jsonb) from round_players
  where round_id = p_round_id and player_id = p_player_id
$$;

create or replace function envelope_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'brief' then
      return hearth_has_action(p_round_id, 'brief', 'ready', p_player_id);
    when 'trade' then
      return hearth_has_action(p_round_id, 'trade',
        'done:' || coalesce((r.state ->> 'session')::int, 0), p_player_id);
    when 'reveal' then
      return envelope_claim(p_round_id, p_player_id) is not null;
    else
      return true;
  end case;
end $$;

/** Envelope hides goals, not people. */
create or replace function envelope_role_visible(
  p_round_id uuid, p_viewer uuid, p_subject uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  return true;
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function envelope_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'brief' and p_kind = 'ready' then
    perform hearth_put_action(p_round_id, p_player_id, 'ready', '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'trade' and p_kind = 'done' then
    -- The trade phase repeats every session, so the kind carries the
    -- session number or session 2 collides with session 1.
    perform hearth_put_action(p_round_id, p_player_id,
      'done:' || coalesce((r.state ->> 'session')::int, 0), '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'reveal' and p_kind = 'claim' then
    perform hearth_put_action(p_round_id, p_player_id, 'claim',
      jsonb_build_object('made', coalesce((p_payload ->> 'made')::boolean, false)));
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function envelope_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hearth_clear_pending(p_round_id, p_player_id);
  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 4 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
  end if;
  -- Otherwise the table simply has one fewer person to lie to. Their
  -- cards are on the table and everyone can see them.
end $$;

create or replace function envelope_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int; v_made int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    select case when coalesce(p_result -> 'winners', '[]'::jsonb) ? (e ->> 'player_id')
                then 1 else 0 end into v_won;
    v_made := case when coalesce((e ->> 'made')::boolean, false) then 1 else 0 end;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'envelope',
      1, v_won, v_made, 0, coalesce((e ->> 'score')::int, 0));
  end loop;
end $$;
