-- ---------------------------------------------------------------
-- Hearth — Season
-- Mirrors src/backend/mock/games/season.ts, function for function.
--
-- A trick-taking game a child already knows, played under a rule that
-- changes every two minutes. The phone is a weather system: it announces
-- the season, goes dark, and chimes when the weather turns.
-- ---------------------------------------------------------------

/** True while this season's rule belongs to one player only. */
create or replace function season_hidden(p_round_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select coalesce(r.state ->> 'secret_to', '') <> '' and r.phase <> 'result'
  from rounds r where r.id = p_round_id
$$;

create or replace function season_scoring_text(p_scoring text)
returns text language sql immutable as $$
  select case p_scoring
    when 'double' then 'Tricks this season are worth double.'
    when 'void' then 'Tricks this season are worth nothing at all.'
    else 'Tricks this season are worth one each.' end
$$;

-- ---------------------------------------------------------------
-- Phase transitions
-- ---------------------------------------------------------------

create or replace function season_finish(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_standings jsonb; v_best int;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(jsonb_agg(x order by x.score desc, x.tricks desc), '[]'::jsonb)
  into v_standings
  from (
    select rp.player_id::text as player_id,
           coalesce((r.state -> 'scores' ->> rp.player_id::text)::int, 0) as score,
           coalesce((r.state -> 'total_tricks' ->> rp.player_id::text)::int, 0) as tricks,
           (select count(*) from jsonb_array_elements(
              coalesce(r.state -> 'history', '[]'::jsonb)) h
            where h ->> 'secret_to' = rp.player_id::text)::int as secrets
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
    'seasons_played', coalesce((r.state ->> 'season')::int, 0),
    'history', coalesce(r.state -> 'history', '[]'::jsonb),
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false)));
end $$;

create or replace function season_begin(p_round_id uuid, p_season int)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; rec record; v_content jsonb; v_rule text; v_scoring text;
  v_present uuid[]; v_secret text; v_tricks jsonb := '{}'::jsonb; v_hide boolean;
begin
  select * into r from rounds where id = p_round_id;

  v_content := hearth_take_content(p_round_id, 'season');
  v_rule := v_content -> 'payload' ->> 'text';

  -- Weighted: most seasons score straight, a few are worth arguing about.
  v_scoring := (array['normal', 'normal', 'normal', 'normal', 'normal', 'normal',
                      'double', 'double', 'void'])[1 + floor(random() * 9)::int];

  v_present := hearth_present(p_round_id);
  -- Never the opening season — the table needs one honest one first.
  v_hide := coalesce((r.settings #>> '{season,secret_seasons}')::boolean, true)
            and p_season > 1
            and coalesce(array_length(v_present, 1), 0) >= 3
            and random() < 0.34;
  if v_hide then
    v_secret := v_present[1 + floor(random() * array_length(v_present, 1))::int]::text;
  end if;

  for rec in select player_id from round_players where round_id = p_round_id loop
    v_tricks := v_tricks || jsonb_build_object(rec.player_id::text, 0);
  end loop;

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'rule', v_rule,
    'content_id', v_content ->> 'content_id',
    'scoring', v_scoring,
    'secret_to', v_secret,
    'season', p_season,
    'trick', 0,
    'last_claim', null,
    'season_tricks', v_tricks,
    'bank_reset', (coalesce((v_content ->> 'bank_reset')::boolean, false)
                   or coalesce((r.state ->> 'bank_reset')::boolean, false))));

  perform hearth_set_phase(p_round_id, 'season', 45, v_present);
end $$;

/** Bank what the season was worth, then turn the weather over. */
create or replace function season_end_season(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; rec record; v_mult int; v_won int;
  v_points jsonb := '{}'::jsonb; v_scores jsonb; v_totals jsonb; v_record jsonb;
begin
  select * into r from rounds where id = p_round_id;
  v_mult := case coalesce(r.state ->> 'scoring', 'normal')
              when 'double' then 2 when 'void' then 0 else 1 end;
  v_scores := coalesce(r.state -> 'scores', '{}'::jsonb);
  v_totals := coalesce(r.state -> 'total_tricks', '{}'::jsonb);

  for rec in select player_id from round_players where round_id = p_round_id loop
    v_won := coalesce((r.state -> 'season_tricks' ->> rec.player_id::text)::int, 0);
    v_points := v_points || jsonb_build_object(rec.player_id::text, v_won * v_mult);
    v_scores := v_scores || jsonb_build_object(rec.player_id::text,
      coalesce((v_scores ->> rec.player_id::text)::int, 0) + v_won * v_mult);
    v_totals := v_totals || jsonb_build_object(rec.player_id::text,
      coalesce((v_totals ->> rec.player_id::text)::int, 0) + v_won);
  end loop;

  v_record := jsonb_build_object(
    'season', coalesce((r.state ->> 'season')::int, 0),
    'rule', coalesce(r.state ->> 'rule', ''),
    'scoring', coalesce(r.state ->> 'scoring', 'normal'),
    'secret_to', coalesce(r.state -> 'secret_to', 'null'::jsonb),
    'tricks', coalesce(r.state -> 'season_tricks', '{}'::jsonb),
    'points', v_points);

  perform hearth_patch_state(p_round_id, jsonb_build_object(
    'scores', v_scores, 'total_tricks', v_totals,
    'history', coalesce(r.state -> 'history', '[]'::jsonb) || jsonb_build_array(v_record)));

  if coalesce((r.state ->> 'season')::int, 0) >= coalesce((r.state ->> 'seasons')::int, 0) then
    perform season_finish(p_round_id);
  else
    perform season_begin(p_round_id, coalesce((r.state ->> 'season')::int, 0) + 1);
  end if;
end $$;

create or replace function season_next_trick(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  if coalesce((r.state ->> 'trick')::int, 0) >= coalesce((r.state ->> 'tricks')::int, 0) then
    perform season_end_season(p_round_id);
    return;
  end if;
  v_secs := coalesce((r.settings #>> '{season,trick_seconds}')::int, 180);
  perform hearth_set_phase(p_round_id, 'trick', v_secs, '{}'::uuid[]);
end $$;

create or replace function season_setup(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_ids uuid[]; v_id uuid; i int := 0;
  v_order jsonb := '[]'::jsonb; v_scores jsonb := '{}'::jsonb; v_totals jsonb := '{}'::jsonb;
begin
  select * into r from rounds where id = p_round_id;

  select coalesce(array_agg(x order by random()), '{}') into v_ids
  from unnest(hearth_present(p_round_id)) as x;

  foreach v_id in array v_ids loop
    update round_players set turn_index = i, role = 'player', private = '{}'::jsonb
    where round_id = p_round_id and player_id = v_id;
    v_order := v_order || to_jsonb(v_id::text);
    i := i + 1;
  end loop;
  update round_players set turn_index = null, role = 'player', private = '{}'::jsonb
  where round_id = p_round_id and not (player_id = any(v_ids));

  for v_id in select player_id from round_players where round_id = p_round_id loop
    v_scores := v_scores || jsonb_build_object(v_id::text, 0);
    v_totals := v_totals || jsonb_build_object(v_id::text, 0);
  end loop;

  update rounds set state = jsonb_build_object(
    'order', v_order,
    'seasons', greatest(coalesce((r.settings #>> '{season,seasons_per_game}')::int, 5), 1),
    'tricks', greatest(coalesce((r.settings #>> '{season,tricks_per_season}')::int, 4), 1),
    'season', 0, 'trick', 0, 'rule', '', 'content_id', null,
    'scoring', 'normal', 'secret_to', null,
    'season_tricks', '{}'::jsonb, 'total_tricks', v_totals, 'scores', v_scores,
    'history', '[]'::jsonb, 'last_claim', null, 'bank_reset', false)
  where id = p_round_id;

  perform season_begin(p_round_id, 1);
end $$;

create or replace function season_advance(p_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_secs int;
begin
  select * into r from rounds where id = p_round_id;
  case r.phase
    when 'season' then
      v_secs := coalesce((r.settings #>> '{season,trick_seconds}')::int, 180);
      perform hearth_set_phase(p_round_id, 'trick', v_secs, '{}'::uuid[]);

    when 'trick' then
      -- §19.2 — nobody claimed it in three minutes, so the trick goes to
      -- nobody and the season carries on regardless.
      perform hearth_patch_state(p_round_id, jsonb_build_object(
        'trick', coalesce((r.state ->> 'trick')::int, 0) + 1,
        'last_claim', null));
      perform season_next_trick(p_round_id);

    else null;
  end case;
end $$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------

create or replace function season_public_view(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype; v_hidden boolean;
begin
  select * into r from rounds where id = p_round_id;
  v_hidden := season_hidden(p_round_id);

  return jsonb_build_object(
    'season_number', coalesce((r.state ->> 'season')::int, 0),
    'seasons_total', coalesce((r.state ->> 'seasons')::int, 0),
    'trick_number', least(coalesce((r.state ->> 'trick')::int, 0) + 1,
                          greatest(coalesce((r.state ->> 'tricks')::int, 1), 1)),
    'tricks_total', coalesce((r.state ->> 'tricks')::int, 0),
    -- A hidden season's rule goes out through the private view and
    -- nowhere else. Not a masked field — an absent one.
    'rule', case when v_hidden then null else to_jsonb(coalesce(r.state ->> 'rule', '')) end,
    'scoring', case when v_hidden then null
                    else to_jsonb(coalesce(r.state ->> 'scoring', 'normal')) end,
    'scoring_text', case when v_hidden then null
                         else to_jsonb(season_scoring_text(
                                coalesce(r.state ->> 'scoring', 'normal'))) end,
    'secret', v_hidden,
    'secret_to', case when v_hidden then coalesce(r.state -> 'secret_to', 'null'::jsonb)
                      else null end,
    'season_tricks', coalesce(r.state -> 'season_tricks', '{}'::jsonb),
    'total_tricks', coalesce(r.state -> 'total_tricks', '{}'::jsonb),
    'scores', coalesce(r.state -> 'scores', '{}'::jsonb),
    -- Past seasons are common knowledge, hidden ones included.
    'history', coalesce(r.state -> 'history', '[]'::jsonb),
    'last_claim', coalesce(r.state -> 'last_claim', 'null'::jsonb),
    'bank_reset', coalesce((r.state ->> 'bank_reset')::boolean, false));
end $$;

create or replace function season_private_view(p_round_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  if not season_hidden(p_round_id) then return '{}'::jsonb; end if;
  if coalesce(r.state ->> 'secret_to', '') <> p_player_id::text then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'rule', coalesce(r.state ->> 'rule', ''),
    'scoring', coalesce(r.state ->> 'scoring', 'normal'),
    'scoring_text', season_scoring_text(coalesce(r.state ->> 'scoring', 'normal')));
end $$;

create or replace function season_has_acted(p_round_id uuid, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id;
  if r.phase <> 'season' then return true; end if;
  return hearth_has_action(p_round_id, 'season',
    'ready:' || coalesce((r.state ->> 'season')::int, 0), p_player_id);
end $$;

/** Season hides a rule, never a person. */
create or replace function season_role_visible(
  p_round_id uuid, p_viewer uuid, p_subject uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  return true;
end $$;

-- ---------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------

create or replace function season_action(
  p_round_id uuid, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  r rounds%rowtype; v_winner text; v_trick int; v_last jsonb; v_secs int;
begin
  select * into r from rounds where id = p_round_id;

  if r.phase = 'season' and p_kind = 'ready' then
    -- The phase name repeats every season, so the kind carries the season
    -- number — otherwise season 2's tap collides with season 1's.
    perform hearth_put_action(p_round_id, p_player_id,
      'ready:' || coalesce((r.state ->> 'season')::int, 0), '{}'::jsonb);
    perform hearth_clear_pending(p_round_id, p_player_id);
    return;
  end if;

  if r.phase = 'trick' and p_kind = 'took' then
    v_winner := coalesce(p_payload ->> 'player_id', p_player_id::text);
    if not exists (select 1 from round_players
                   where round_id = p_round_id and player_id::text = v_winner)
       or hearth_has_left(v_winner::uuid) then
      perform hearth_raise('invalid_target');
    end if;

    v_trick := coalesce((r.state ->> 'trick')::int, 0);
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'season_tricks', coalesce(r.state -> 'season_tricks', '{}'::jsonb)
        || jsonb_build_object(v_winner,
             coalesce((r.state -> 'season_tricks' ->> v_winner)::int, 0) + 1),
      'last_claim', jsonb_build_object(
        'player_id', v_winner, 'trick', v_trick,
        'season', coalesce((r.state ->> 'season')::int, 0),
        'by', p_player_id::text),
      'trick', v_trick + 1));
    perform season_next_trick(p_round_id);
    return;
  end if;

  if r.phase = 'trick' and p_kind = 'undo' then
    v_last := r.state -> 'last_claim';
    -- One step back, and only within this season — the tap that ends a
    -- season is banked before anyone could regret it.
    if v_last is null or v_last = 'null'::jsonb
       or coalesce((v_last ->> 'season')::int, -1) <> coalesce((r.state ->> 'season')::int, 0)
       or coalesce((r.state ->> 'trick')::int, 0) <> coalesce((v_last ->> 'trick')::int, -1) + 1
    then
      perform hearth_raise('wrong_phase');
    end if;

    v_winner := v_last ->> 'player_id';
    perform hearth_patch_state(p_round_id, jsonb_build_object(
      'season_tricks', coalesce(r.state -> 'season_tricks', '{}'::jsonb)
        || jsonb_build_object(v_winner,
             greatest(coalesce((r.state -> 'season_tricks' ->> v_winner)::int, 0) - 1, 0)),
      'trick', coalesce((v_last ->> 'trick')::int, 0),
      'last_claim', null));

    v_secs := coalesce((r.settings #>> '{season,trick_seconds}')::int, 180);
    perform hearth_set_phase(p_round_id, 'trick', v_secs, '{}'::uuid[]);
    return;
  end if;

  perform hearth_raise('wrong_phase');
end $$;

-- ---------------------------------------------------------------
-- Leaving and stats
-- ---------------------------------------------------------------

create or replace function season_on_left(p_round_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rounds%rowtype;
begin
  perform hearth_clear_pending(p_round_id, p_player_id);

  if coalesce(array_length(hearth_present(p_round_id), 1), 0) < 3 then
    perform hearth_end_round(p_round_id,
      jsonb_build_object('aborted', 'too_few_players', 'reason', 'too_few_players'));
    return;
  end if;

  -- A secret nobody holds is just a rule nobody can follow: publish it.
  select * into r from rounds where id = p_round_id;
  if coalesce(r.state ->> 'secret_to', '') = p_player_id::text then
    perform hearth_patch_state(p_round_id, jsonb_build_object('secret_to', null));
  end if;
end $$;

create or replace function season_result(p_round_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_won int;
begin
  for e in select * from jsonb_array_elements(coalesce(p_result -> 'standings', '[]'::jsonb)) loop
    select case when coalesce(p_result -> 'winners', '[]'::jsonb) ? (e ->> 'player_id')
                then 1 else 0 end into v_won;
    perform hearth_bump_stats(p_round_id, (e ->> 'player_id')::uuid, 'season',
      1, v_won, coalesce((e ->> 'secrets')::int, 0), 0, coalesce((e ->> 'score')::int, 0));
  end loop;
end $$;
