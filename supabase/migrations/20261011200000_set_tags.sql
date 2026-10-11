-- 082 · Tagging people in a set (spec 7.4 #2–#4). The set's owner names up to ten people; each
-- one is told. A tag from someone the person follows shows at once; from anyone else it waits
-- for their approval (#3) - and "No one" in the same setting as mentions refuses it outright.
-- The tagged person can take themselves off any set at any time ("Remove me from this set"),
-- and the owner can take a tag off. A blocked pair never tags.
create table public.set_tags (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tagged_by uuid not null references auth.users (id) on delete cascade,
  state text not null default 'pending' constraint set_tags_state check (state in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  unique (set_id, user_id)
);
comment on table public.set_tags is 'People tagged in a set (spec 7.4): pending until the tagged person approves, unless they follow the tagger.';
alter table public.set_tags enable row level security;
revoke all on table public.set_tags from anon;
create index set_tags_user_idx on public.set_tags (user_id);

-- Read: the tagged person and the owner see every tag on the set; others see approved tags on
-- a set they can view.
create policy "set_tags: tagged, owner, or viewers of approved" on public.set_tags for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.owns_set(set_id))
    or (state = 'approved' and (select public.can_view_set(set_id, (select auth.uid()))))
  );
-- Create: the owner, on their own set, for a person who allows it and is not blocked either way.
create policy "set_tags: owner tags" on public.set_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and (select private.owns_set(set_id))
    and user_id <> (select auth.uid())
    and not (select private.blocked_either_way((select auth.uid()), user_id))
    and exists (select 1 from public.profiles p where p.user_id = set_tags.user_id and p.deactivated_at is null and p.mention_setting <> 'nobody')
    and (select count(*) from public.set_tags t where t.set_id = set_tags.set_id) < 10
  );
-- Approve: the tagged person, pending → approved only.
create policy "set_tags: tagged approves" on public.set_tags for update to authenticated
  using (user_id = (select auth.uid()) and state = 'pending')
  with check (user_id = (select auth.uid()) and state = 'approved');
-- Remove: the tagged person ("Remove me from this set") or the owner.
create policy "set_tags: tagged or owner removes" on public.set_tags for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.owns_set(set_id)));

-- The state at creation is the server's call: approved when the tagged person follows the
-- tagger (spec 7.4 #3) or lets everyone tag them; pending otherwise. The columns that name
-- people never change.
create or replace function private.set_tags_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_setting text;
begin
  if tg_op = 'INSERT' then
    select p.mention_setting into v_setting from public.profiles p where p.user_id = new.user_id;
    new.state := case
      when v_setting = 'everyone' then 'approved'
      when (select private.is_following(new.user_id, new.tagged_by)) then 'approved'
      else 'pending' end;
    return new;
  end if;
  if new.set_id <> old.set_id or new.user_id <> old.user_id or new.tagged_by <> old.tagged_by then
    raise exception 'a tag is approved or removed, never moved' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger set_tags_guard before insert or update on public.set_tags for each row execute function private.set_tags_guard();
create trigger set_tags_banned before insert on public.set_tags for each row execute function private.refuse_if_banned();

-- The tagged person is told (kind `tag`; the Inbox opens the set).
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag'));
create or replace function private.notify_tag() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.user_id, 'tag', new.tagged_by, 'set', new.set_id, false);
  return new;
end $$;
create trigger set_tags_notify after insert on public.set_tags for each row execute function private.notify_tag();

-- The people on a set, for the set page: approved tags (and the owner's and your own pending).
create or replace function public.set_people(p_set_id uuid)
returns table (user_id uuid, username text, state text)
language sql stable security invoker set search_path = '' as $$
  select t.user_id, p.username, t.state
  from public.set_tags t join public.profiles p on p.user_id = t.user_id
  where t.set_id = p_set_id
  order by t.created_at;
$$;
revoke all on function public.set_people(uuid) from public, anon;
grant execute on function public.set_people(uuid) to authenticated;
