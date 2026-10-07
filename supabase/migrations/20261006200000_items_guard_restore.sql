-- 047 · 🔴 Undo a regression from 045, found by the test run and the core loop within minutes:
-- 045 re-wrote `items_guard` from migration 011's text and lost migration 013's one line - the
-- server (no auth.uid(): an edge function with the secret key) must get through. For the length
-- of 045 being live, `ingest-image` could not store a fingerprint and no photo could clear.
-- The rule, all three doors: not a person (server), an admin, or the server door flag.
create or replace function private.items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin()) or current_setting('kleit.server_write', true) = '1' then
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

-- And moderators keep seeing a suspended profile (to lift the ban, to read the queue's names);
-- 045 hid it from them along with everyone else, which the moderation test caught.
drop policy "profiles: signed-in read" on public.profiles;
create policy "profiles: signed-in read" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_moderator())
    or (deactivated_at is null and banned_at is null and not (select private.blocked_either_way((select auth.uid()), user_id)))
  );
