-- 107: replies to comments (spec 12.1 #1 names "reply" among the things a person is told about;
-- CL68). A reply is a comment with a `parent_id`; one level only (a reply to a reply hangs off
-- the same parent - the thread stays readable on a phone). Everything a comment already is - who
-- may write one (may_comment), who reads it, the screening, the 15-minute edit, take back and
-- remove - holds for a reply unchanged, because it IS a comment. Two new rules:
--   the parent is on the same set, is itself a top-level comment, and still stands;
--   the author of the comment answered is told ("reply"), and the set's owner is still told
--   ("comment") unless they are that author, who then hears once.
-- A block between the replier and the parent's author is refused at the door, so nobody can
-- answer the comment of a person who blocked them.

alter table public.comments add column parent_id uuid references public.comments (id) on delete cascade;
-- The comment actually answered: the same as parent_id, except for an answer to a reply, where
-- parent_id is the thread's first comment and answers_id the reply. The app writes parent_id
-- only; the guard fills answers_id. It names who is told and who the screen says was answered.
alter table public.comments add column answers_id uuid references public.comments (id) on delete set null;
create index comments_parent_idx on public.comments (parent_id) where parent_id is not null;

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
  if (select private.blocked_either_way(new.author_id, parent.author_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.comments_reply_guard() from public;
create trigger comments_reply_guard before insert on public.comments for each row execute function private.comments_reply_guard();

-- The update guard, restated (L31; last written in 20261006030000) with one more line: a reply
-- never moves to another parent.
create or replace function private.comments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return new; end if;
  if new.set_id <> old.set_id or new.author_id <> old.author_id or new.created_at <> old.created_at
     or new.parent_id is distinct from old.parent_id or new.answers_id is distinct from old.answers_id then
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

-- The notification kind, and who is told.
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag',
                  'poll_results', 'contest_pick', 'price_drop', 'reply'));

create or replace function private.notify_comment() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select s.owner_id from public.sets s where s.id = new.set_id);
  parent_author uuid := case when new.answers_id is null then null
                             else (select c.author_id from public.comments c where c.id = new.answers_id) end;
begin
  if parent_author is not null then
    perform private.notify(parent_author, 'reply', new.author_id, 'set', new.set_id, false);
  end if;
  if owner is distinct from parent_author then
    perform private.notify(owner, 'comment', new.author_id, 'set', new.set_id, false);
  end if;
  return new;
end $$;
