-- Migration 013 — the server-only columns must be writable BY THE SERVER (roadmap M2.5, M2.6).
--
-- 🔴 A bug found by putting a real photo through the live pipeline. Migration 010's trigger says
-- source_url, image_hash, takedown_state, owner_id and image_bucket are "set by the server only",
-- and then refused the server. It let through admins - `private.is_admin()` looks up the caller in
-- `user_roles` by `auth.uid()` - and an edge function using the secret key has no `auth.uid()` at
-- all. It is not a user. So it failed that test like everybody else.
--
-- The effect was quiet and nasty: `ingest-image` wrote the fingerprint, the trigger refused it,
-- the function did not check the error, and it reported a clean scan while `items.image_hash`
-- stayed null. A removed image could have come back, because the thing that recognises it was
-- never recorded.
--
-- The rule the trigger was always meant to express: a person may not change these columns. The
-- server may. `auth.uid() is null` is exactly "this is not a person" - no JWT, no user, which is
-- only true for the service key.
create or replace function private.items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Not a person: an edge function holding the secret key. These columns are its job.
  if (select auth.uid()) is null then
    return new;
  end if;
  if (select private.is_admin()) then
    return new;
  end if;
  if new.source_url is distinct from old.source_url
     or new.image_hash is distinct from old.image_hash
     or new.takedown_state is distinct from old.takedown_state
     or new.owner_id is distinct from old.owner_id
     or new.image_bucket is distinct from old.image_bucket then
    raise exception 'source_url, image_hash, takedown_state, owner_id and image_bucket are set by the server only';
  end if;
  return new;
end;
$$;
