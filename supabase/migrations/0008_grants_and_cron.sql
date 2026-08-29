-- ---------------------------------------------------------------
-- Hearth — grants and scheduled jobs (spec §7, §18.3)
-- ---------------------------------------------------------------

-- ---------------------------------------------------------------
-- Execute grants
--
-- Default posture: revoke everything from public, then grant back only
-- the functions a client is meant to call. Internal helpers (hearth_*,
-- {game}_*, nv_*, dial_*) stay ungranted — a client calling one directly
-- must not be able to sidestep the phase checks in submit_action.
-- ---------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function create_group(text, text, text, text)            to authenticated;
grant execute on function join_group(text, text, text, text, text)        to authenticated;
grant execute on function peek_group(text)                                to authenticated, anon;
grant execute on function available_nicknames(text)                       to authenticated, anon;
grant execute on function get_lobby(text)                                 to authenticated;
grant execute on function leave_group(uuid)                               to authenticated;
grant execute on function set_ready(uuid, boolean)                        to authenticated;
grant execute on function update_group_settings(uuid, jsonb)              to authenticated;
grant execute on function heartbeat(uuid)                                 to authenticated;
grant execute on function start_round(uuid, text)                         to authenticated;
grant execute on function get_my_view(uuid)                               to authenticated;
grant execute on function advance_if_due(uuid)                            to authenticated;
grant execute on function submit_action(uuid, text, jsonb)                to authenticated;
grant execute on function abort_round(uuid)                               to authenticated;
grant execute on function get_history(uuid, int)                          to authenticated;
grant execute on function get_stats(uuid)                                 to authenticated;
grant execute on function get_best_score(uuid, text)                      to authenticated;

-- Used by RLS policies, so it must be callable by the querying role.
grant execute on function my_player_id(uuid) to authenticated;
grant execute on function is_member(uuid)    to authenticated;

-- ---------------------------------------------------------------
-- Scheduled jobs (§18.3)
--
-- Requires the pg_cron extension: enable it in
-- Dashboard → Database → Extensions before running this migration.
-- ---------------------------------------------------------------

create extension if not exists pg_cron;

/** Nightly purge of expired groups; cascades remove everything below. */
create or replace function hearth_purge_expired()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from groups where expires_at < now();
  delete from join_attempts where created_at < now() - interval '24 hours';
  delete from turnstile_nonces where expires_at < now() - interval '1 hour';
end $$;

/**
 * Safety net for rounds where every player has disconnected: advance any
 * live round whose clock has expired, and abort anything ancient.
 */
create or replace function hearth_tick_rounds()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id from rounds
    where ended_at is null and started_at < now() - interval '3 hours'
  loop
    perform hearth_end_round(r.id,
      jsonb_build_object('aborted', 'stale', 'reason', 'stale'));
    perform hearth_finalise(r.id);
  end loop;

  for r in
    select id from rounds
    where ended_at is null and phase_ends_at is not null and phase_ends_at < now()
  loop
    perform hearth_run_advance(r.id);
    if exists (select 1 from rounds where id = r.id and ended_at is not null) then
      perform hearth_finalise(r.id);
    end if;
  end loop;
end $$;

do $$
begin
  perform cron.unschedule('hearth-purge-expired');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('hearth-tick-rounds');
exception when others then null;
end $$;

select cron.schedule('hearth-purge-expired', '17 3 * * *', $$ select hearth_purge_expired() $$);
select cron.schedule('hearth-tick-rounds',   '*/1 * * * *', $$ select hearth_tick_rounds() $$);
