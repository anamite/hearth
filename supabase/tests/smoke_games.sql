-- ---------------------------------------------------------------
-- Hearth — SQL smoke test for the ported game logic
--
-- NOT a migration. Paste it into the Supabase SQL editor (or run it
-- through psql) against a database the migrations have been pushed to.
-- It raises on the first mismatch and prints a count on success.
--
-- Why this exists: `npm run check` parses the migrations, but the SQL
-- grammar treats a PL/pgSQL body as an opaque string, and `db push`
-- only proves the bodies compile. These are the same expectations the
-- TypeScript suites assert, run against the real functions, so the two
-- implementations can be shown to agree rather than assumed to.
--
-- Covers the pure logic only. The round-scoped functions (setup,
-- advance, action, the views) need a live round, and are exercised by
-- playing one through the app in supabase mode.
-- ---------------------------------------------------------------

do $$
declare
  n int := 0;
  v_deck jsonb;
  i int;
begin
  -- Grid: line geometry --------------------------------------------
  if grid_line_cells(0) <> array[0,1,2,3,4]     then raise exception 'grid_line_cells(0)'; end if;
  if grid_line_cells(4) <> array[20,21,22,23,24] then raise exception 'grid_line_cells(4)'; end if;
  if grid_line_cells(5) <> array[0,5,10,15,20]  then raise exception 'grid_line_cells(5)'; end if;
  if grid_line_cells(9) <> array[4,9,14,19,24]  then raise exception 'grid_line_cells(9)'; end if;
  n := n + 4;

  -- Grid: longest non-decreasing run --------------------------------
  if grid_longest_run('[1,2,3,4,5]') <> 5 then raise exception 'run ascending'; end if;
  if grid_longest_run('[1,1,1,1,1]') <> 5 then raise exception 'run of equals'; end if;
  if grid_longest_run('[5,4,3,2,1]') <> 1 then raise exception 'run descending'; end if;
  if grid_longest_run('[3,1,2,9,4]') <> 3 then raise exception 'run 1,2,9'; end if;
  if grid_longest_run('[]')          <> 0 then raise exception 'run of nothing'; end if;
  n := n + 5;

  -- A hole breaks a run; it never bridges one.
  if grid_longest_run('[1,2,null,3,4]')             <> 2 then raise exception 'hole breaks'; end if;
  if grid_longest_run('[null,null,null,null,null]') <> 0 then raise exception 'all holes'; end if;
  if grid_longest_run('[null,1,2,3,null]')          <> 3 then raise exception 'holes at the ends'; end if;
  n := n + 3;

  -- Grid: the points band -------------------------------------------
  if grid_line_score('[5,9,3,8,2]') <> 1  then raise exception 'run of 2 pays 1'; end if;
  if grid_line_score('[1,2,3,1,1]') <> 3  then raise exception 'run of 3 pays 3'; end if;
  if grid_line_score('[1,2,3,4,1]') <> 6  then raise exception 'run of 4 pays 6'; end if;
  if grid_line_score('[1,2,3,4,5]') <> 10 then raise exception 'run of 5 pays 10'; end if;
  if grid_line_score('[5,4,3,2,1]') <> 0  then raise exception 'run of 1 pays nothing'; end if;
  n := n + 5;

  -- Grid: whole grids ------------------------------------------------
  -- Every row 1..5, every column a repeated value: the 100 ceiling.
  if (grid_score_cells('[1,2,3,4,5,1,2,3,4,5,1,2,3,4,5,1,2,3,4,5,1,2,3,4,5]') ->> 'total')::int <> 100
    then raise exception 'a perfect grid does not score 100'; end if;
  if (grid_score_cells(grid_empty_cells()) ->> 'total')::int <> 0
    then raise exception 'an empty grid does not score 0'; end if;
  if jsonb_array_length(grid_score_cells(grid_empty_cells()) -> 'lines') <> 10
    then raise exception 'not ten lines'; end if;
  if jsonb_array_length(grid_empty_cells()) <> 25
    then raise exception 'an empty grid is not 25 cells'; end if;
  if exists (select 1 from jsonb_array_elements(grid_empty_cells()) e where e <> 'null'::jsonb)
    then raise exception 'an empty grid is not all holes'; end if;
  n := n + 5;

  -- Grid: thirty cards, three of every number ------------------------
  v_deck := grid_build_deck();
  if jsonb_array_length(v_deck) <> 30 then raise exception 'the deck is not 30 cards'; end if;
  for i in 1..10 loop
    if (select count(*) from jsonb_array_elements(v_deck) e where (e #>> '{}')::int = i) <> 3
      then raise exception 'the deck does not hold three %', i; end if;
  end loop;
  n := n + 2;

  -- Grid: the tally counts what has been seen -------------------------
  if grid_tally('[5,5,3]') <> '[0,0,1,0,2,0,0,0,0,0]'::jsonb then raise exception 'tally'; end if;
  n := n + 1;

  -- Bid: resolution ----------------------------------------------------
  if bid_resolve(10, '{"a":15,"b":4,"c":1}') <> '{"winner_id":"a","cancelled":[]}'::jsonb
    then raise exception 'highest bid takes a reward'; end if;
  if bid_resolve(10, '{"a":15,"b":15,"c":4}') <> '{"winner_id":"c","cancelled":[15]}'::jsonb
    then raise exception 'tied high bids cancel'; end if;
  if bid_resolve(10, '{"a":15,"b":15,"c":9,"d":9,"e":2}')
     <> '{"winner_id":"e","cancelled":[15,9]}'::jsonb
    then raise exception 'the prize falls through twice'; end if;
  if bid_resolve(10, '{"a":7,"b":7,"c":3,"d":3}')
     <> '{"winner_id":null,"cancelled":[7,3]}'::jsonb
    then raise exception 'every value contested'; end if;
  n := n + 4;

  -- Negative prizes reverse it: the lowest bid is stuck with them.
  if bid_resolve(-5, '{"a":1,"b":8,"c":15}') <> '{"winner_id":"a","cancelled":[]}'::jsonb
    then raise exception 'lowest bid takes a penalty'; end if;
  if bid_resolve(-5, '{"a":1,"b":1,"c":8}') <> '{"winner_id":"c","cancelled":[1]}'::jsonb
    then raise exception 'tied low bids cancel'; end if;
  if bid_resolve(6, '{"a":3}') <> '{"winner_id":"a","cancelled":[]}'::jsonb
    then raise exception 'a single bidder'; end if;
  if bid_resolve(6, '{}') <> '{"winner_id":null,"cancelled":[]}'::jsonb
    then raise exception 'no bidders at all'; end if;
  n := n + 4;

  -- Bid: fifteen prizes, -5..-1 and +1..+10, one of each ---------------
  if jsonb_array_length(bid_build_prizes()) <> 15 then raise exception 'not fifteen prizes'; end if;
  if (select coalesce(jsonb_agg(e order by (e #>> '{}')::int), '[]'::jsonb)
      from jsonb_array_elements(bid_build_prizes()) e)
     <> '[-5,-4,-3,-2,-1,1,2,3,4,5,6,7,8,9,10]'::jsonb
    then raise exception 'the prize values are wrong'; end if;
  n := n + 2;

  raise notice 'OK — % assertions passed against the deployed functions.', n;
end $$;

-- The SQL editor does not surface NOTICE, so end on something visible:
-- this row appears only if every assertion above passed.
select 'all assertions passed' as smoke_test;
