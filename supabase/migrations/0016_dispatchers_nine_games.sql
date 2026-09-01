-- ---------------------------------------------------------------
-- Hearth — dispatchers for all nine games
--
-- 0003_core.sql and 0012 have both already been applied to production,
-- so editing either in place reaches a fresh `db reset` and no existing
-- database. This migration re-declares the eleven dispatchers, now
-- covering fold, season and envelope.
--
-- Every function below is `create or replace`, so applying this to a
-- database that already ran the updated 0003 changes nothing.
--
-- KEEP IN STEP WITH 0003_core.sql. `npm run check:sql` fails if the
-- winning definition of any dispatcher stops covering a game.
-- ---------------------------------------------------------------

create or replace function game_setup(p_round_id uuid, p_game_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_setup(p_round_id);
    when 'night_village' then perform night_village_setup(p_round_id);
    when 'dial'          then perform dial_setup(p_round_id);
    when 'grid'          then perform grid_setup(p_round_id);
    when 'bid'           then perform bid_setup(p_round_id);
    when 'nerve'         then perform nerve_setup(p_round_id);
    when 'fold'          then perform fold_setup(p_round_id);
    when 'season'        then perform season_setup(p_round_id);
    when 'envelope'      then perform envelope_setup(p_round_id);
    else perform hearth_raise('round_not_found');
  end case;
end $$;

create or replace function game_public_view(p_round_id uuid, p_game_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_public_view(p_round_id);
    when 'night_village' then return night_village_public_view(p_round_id);
    when 'dial'          then return dial_public_view(p_round_id);
    when 'grid'          then return grid_public_view(p_round_id);
    when 'bid'           then return bid_public_view(p_round_id);
    when 'nerve'         then return nerve_public_view(p_round_id);
    when 'fold'          then return fold_public_view(p_round_id);
    when 'season'        then return season_public_view(p_round_id);
    when 'envelope'      then return envelope_public_view(p_round_id);
    else return '{}'::jsonb;
  end case;
end $$;

create or replace function game_private_view(p_round_id uuid, p_game_type text, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_private_view(p_round_id, p_player_id);
    when 'night_village' then return night_village_private_view(p_round_id, p_player_id);
    when 'dial'          then return dial_private_view(p_round_id, p_player_id);
    when 'grid'          then return grid_private_view(p_round_id, p_player_id);
    when 'bid'           then return bid_private_view(p_round_id, p_player_id);
    when 'nerve'         then return nerve_private_view(p_round_id, p_player_id);
    when 'fold'          then return fold_private_view(p_round_id, p_player_id);
    when 'season'        then return season_private_view(p_round_id, p_player_id);
    when 'envelope'      then return envelope_private_view(p_round_id, p_player_id);
    else return '{}'::jsonb;
  end case;
end $$;

create or replace function game_action(
  p_round_id uuid, p_game_type text, p_player_id uuid, p_kind text, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'night_village' then perform night_village_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'dial'          then perform dial_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'grid'          then perform grid_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'bid'           then perform bid_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'nerve'         then perform nerve_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'fold'          then perform fold_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'season'        then perform season_action(p_round_id, p_player_id, p_kind, p_payload);
    when 'envelope'      then perform envelope_action(p_round_id, p_player_id, p_kind, p_payload);
    else perform hearth_raise('wrong_phase');
  end case;
end $$;

create or replace function game_advance(p_round_id uuid, p_game_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_advance(p_round_id);
    when 'night_village' then perform night_village_advance(p_round_id);
    when 'dial'          then perform dial_advance(p_round_id);
    when 'grid'          then perform grid_advance(p_round_id);
    when 'bid'           then perform bid_advance(p_round_id);
    when 'nerve'         then perform nerve_advance(p_round_id);
    when 'fold'          then perform fold_advance(p_round_id);
    when 'season'        then perform season_advance(p_round_id);
    when 'envelope'      then perform envelope_advance(p_round_id);
    else null;
  end case;
end $$;

create or replace function game_apply_stats(p_round_id uuid, p_game_type text, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_result(p_round_id, p_result);
    when 'night_village' then perform night_village_result(p_round_id, p_result);
    when 'dial'          then perform dial_result(p_round_id, p_result);
    when 'grid'          then perform grid_result(p_round_id, p_result);
    when 'bid'           then perform bid_result(p_round_id, p_result);
    when 'nerve'         then perform nerve_result(p_round_id, p_result);
    when 'fold'          then perform fold_result(p_round_id, p_result);
    when 'season'        then perform season_result(p_round_id, p_result);
    when 'envelope'      then perform envelope_result(p_round_id, p_result);
    else null;
  end case;
end $$;

create or replace function game_on_player_left(p_round_id uuid, p_game_type text, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then perform fake_artist_on_left(p_round_id, p_player_id);
    when 'night_village' then perform night_village_on_left(p_round_id, p_player_id);
    when 'dial'          then perform dial_on_left(p_round_id, p_player_id);
    when 'grid'          then perform grid_on_left(p_round_id, p_player_id);
    when 'bid'           then perform bid_on_left(p_round_id, p_player_id);
    when 'nerve'         then perform nerve_on_left(p_round_id, p_player_id);
    when 'fold'          then perform fold_on_left(p_round_id, p_player_id);
    when 'season'        then perform season_on_left(p_round_id, p_player_id);
    when 'envelope'      then perform envelope_on_left(p_round_id, p_player_id);
    else null;
  end case;
end $$;

/** Has this player done what the current phase asks of them? */
create or replace function game_has_acted(p_round_id uuid, p_game_type text, p_player_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_has_acted(p_round_id, p_player_id);
    when 'night_village' then return night_village_has_acted(p_round_id, p_player_id);
    when 'dial'          then return dial_has_acted(p_round_id, p_player_id);
    when 'grid'          then return grid_has_acted(p_round_id, p_player_id);
    when 'bid'           then return bid_has_acted(p_round_id, p_player_id);
    when 'nerve'         then return nerve_has_acted(p_round_id, p_player_id);
    when 'fold'          then return fold_has_acted(p_round_id, p_player_id);
    when 'season'        then return season_has_acted(p_round_id, p_player_id);
    when 'envelope'      then return envelope_has_acted(p_round_id, p_player_id);
    else return true;
  end case;
end $$;

/** Is `p_viewer` entitled to see `p_subject`'s role right now? */
create or replace function game_role_visible(
  p_round_id uuid, p_game_type text, p_viewer uuid, p_subject uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  case p_game_type
    when 'fake_artist'   then return fake_artist_role_visible(p_round_id, p_viewer, p_subject);
    when 'night_village' then return night_village_role_visible(p_round_id, p_viewer, p_subject);
    when 'dial'          then return true;
    when 'grid'          then return true;
    when 'bid'           then return true;
    when 'nerve'         then return true;
    when 'fold'          then return true;
    when 'season'        then return season_role_visible(p_round_id, p_viewer, p_subject);
    when 'envelope'      then return envelope_role_visible(p_round_id, p_viewer, p_subject);
    else return false;
  end case;
end $$;

create or replace function game_min_players(p_game_type text)
returns int language sql immutable as $$
  select case p_game_type
    when 'fake_artist' then 4
    when 'night_village' then 6
    when 'dial' then 3
    when 'grid' then 1
    when 'bid' then 2
    when 'nerve' then 3
    when 'fold' then 2
    when 'season' then 3
    when 'envelope' then 4
    else 99 end
$$;

create or replace function game_max_players(p_game_type text)
returns int language sql immutable as $$
  select case p_game_type
    when 'fake_artist' then 10
    when 'night_village' then 12
    when 'dial' then 10
    when 'grid' then 12
    when 'bid' then 8
    when 'nerve' then 6
    when 'fold' then 8
    when 'season' then 6
    when 'envelope' then 8
    else 0 end
$$;
