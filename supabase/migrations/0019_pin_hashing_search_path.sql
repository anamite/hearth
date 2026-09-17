-- ---------------------------------------------------------------
-- Hearth — let create_group / join_group find pgcrypto
--
-- On Supabase, pgcrypto is installed in the `extensions` schema, so
-- `crypt` and `gen_salt` are not visible to a function pinned to
-- `search_path = public`. 0018 re-declared both functions with that
-- search path, and creating a group failed with
-- "function gen_salt(unknown) does not exist".
--
-- Adding `extensions` fixes it whether pgcrypto lives there or in public;
-- a schema that does not exist is simply skipped. Any future redefinition
-- of these two functions must keep this search path.
-- ---------------------------------------------------------------

alter function create_group(text, text, text, text)
  set search_path = public, extensions;

alter function join_group(text, text, text, text, text)
  set search_path = public, extensions;
