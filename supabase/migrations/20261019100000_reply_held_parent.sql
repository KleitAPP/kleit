-- 109: the read-back of 107 (L35). A reply under a HELD comment was accepted by the guard: the
-- screen hides Reply on a held comment, but a direct insert made a reply nobody but the parent's
-- author could place - the reply itself was readable, its thread was not. Refused now. The whole
-- guard is restated from 107 (L31) with that one check added.
create or replace function private.comments_reply_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare parent public.comments%rowtype;
begin
  if new.parent_id is null then
    new.answers_id := null;
    return new;
  end if;
  new.answers_id := new.parent_id;
  select * into parent from public.comments c where c.id = new.parent_id;
  if not found or parent.set_id <> new.set_id then
    raise exception 'that comment is not on this set' using errcode = 'P0001';
  end if;
  if parent.parent_id is not null then
    -- One level: an answer to an answer joins the same thread.
    new.parent_id := parent.parent_id;
  end if;
  if parent.deleted_at is not null then
    raise exception 'that comment was removed' using errcode = 'P0001';
  end if;
  if parent.held_at is not null then
    -- A held comment is its author's alone until a moderator clears it; nothing hangs off it yet.
    raise exception 'that comment is waiting for a look' using errcode = 'P0001';
  end if;
  if (select private.blocked_either_way(new.author_id, parent.author_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
