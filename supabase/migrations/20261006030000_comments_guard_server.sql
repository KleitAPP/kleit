-- 030 · The comments guard lets the server through (fix to 029 as a new file, L25).
-- 029's trigger refused every change to a comment's set, author or time - including the
-- server's own (moderation at M7, and the test that ages a row). Not a person: not its business.
create or replace function private.comments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return new; end if;
  if new.set_id <> old.set_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if old.deleted_at is not null and (new.deleted_at is null or new.body <> old.body) then
    raise exception 'a removed comment stays removed' using errcode = '42501';
  end if;
  if new.body <> old.body then
    if me <> old.author_id then raise exception 'only the author edits' using errcode = '42501'; end if;
    if old.created_at < now() - interval '15 minutes' then raise exception 'edit window closed' using errcode = '42501'; end if;
    new.edited_at := now();
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := me;
  end if;
  return new;
end $$;
