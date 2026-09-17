-- ---------------------------------------------------------------
-- Hearth — the host can remove a player from the lobby
-- Mirrors removePlayer in src/backend/mock/index.ts.
--
-- Between rounds only. Removal is the same as the player tapping Leave:
-- the row stays with has_left = true, so the code and PIN let them straight
-- back in through join_group's rejoin path. Their open lobby sees
-- me.has_left and sends them to the join screen.
-- ---------------------------------------------------------------

create or replace function remove_player(p_group_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := my_player_id(p_group_id);
  if v_me is null then perform hearth_raise('not_a_member'); end if;
  if not (select is_host from players where id = v_me) then perform hearth_raise('not_host'); end if;
  if exists (select 1 from rounds where group_id = p_group_id and ended_at is null) then
    perform hearth_raise('round_active');
  end if;
  if p_player_id = v_me
     or not exists (select 1 from players where id = p_player_id and group_id = p_group_id) then
    perform hearth_raise('invalid_target');
  end if;

  update players set has_left = true, is_ready = false where id = p_player_id;

  perform hearth_broadcast('group:' || p_group_id::text, 'group',
    jsonb_build_object('type', 'players_changed'));
end $$;

revoke all on function remove_player(uuid, uuid) from public, anon;
grant execute on function remove_player(uuid, uuid) to authenticated;
