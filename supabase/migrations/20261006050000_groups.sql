-- 032 · Groups (roadmap M5.3; spec 10.3; technical pack §1.6 rows 32–34).
--
-- A group has a page of sets and talk. Invites must be accepted; leaving is quiet; the creator
-- is an admin and may add admins; admins remove members and posts (spec 10.3 #2–#3). Groups are
-- not chat rooms (#4). A public group can be joined by anyone signed in; a private one by invite.
-- Nobody can be invited across a block (spec 10.4 #1 "group-add").

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  name text not null constraint groups_name_length check (char_length(name) between 1 and 60),
  description text not null default '' constraint groups_description_length check (char_length(description) <= 300),
  visibility text not null default 'public' constraint groups_visibility check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.groups enable row level security;
revoke all on table public.groups from anon;
revoke delete, truncate on table public.groups from authenticated;

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' constraint group_members_role check (role in ('admin', 'member')),
  state text not null default 'invited' constraint group_members_state check (state in ('invited', 'joined')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;
revoke all on table public.group_members from anon;
revoke truncate on table public.group_members from authenticated;
create index group_members_user_idx on public.group_members (user_id);

create table public.group_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid references public.sets (id) on delete set null,
  body text not null default '' constraint group_posts_body_length check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint group_posts_something check (set_id is not null or char_length(body) > 0)
);
alter table public.group_posts enable row level security;
revoke all on table public.group_posts from anon;
revoke delete, truncate on table public.group_posts from authenticated;
create index group_posts_group_idx on public.group_posts (group_id, created_at desc);

-- Helpers, as the data's owner (the policies below would otherwise recurse into themselves).
create or replace function private.group_state(p_group uuid, p_who uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.state from public.group_members m where m.group_id = p_group and m.user_id = p_who;
$$;
create or replace function private.is_group_admin(p_group uuid, p_who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                  where m.group_id = p_group and m.user_id = p_who and m.role = 'admin' and m.state = 'joined');
$$;
create or replace function private.group_is_public(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.visibility = 'public' and g.deleted_at is null);
$$;
revoke all on function private.group_state(uuid, uuid), private.is_group_admin(uuid, uuid), private.group_is_public(uuid) from public;
grant execute on function private.group_state(uuid, uuid), private.is_group_admin(uuid, uuid), private.group_is_public(uuid) to authenticated;

-- groups: public ones to anyone signed in; private ones to their members and the invited.
create policy "groups: public or member reads" on public.groups for select to authenticated
  using (
    deleted_at is null
    and (visibility = 'public' or (select private.group_state(id, (select auth.uid()))) is not null)
  );
create policy "groups: creator makes" on public.groups for insert to authenticated
  with check (creator_id = (select auth.uid()));
create policy "groups: admins change" on public.groups for update to authenticated
  using ((select private.is_group_admin(id, (select auth.uid()))))
  with check ((select private.is_group_admin(id, (select auth.uid()))));
-- The creator's own admin row, written with the group.
create or replace function private.groups_creator_joins()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, user_id, role, state) values (new.id, new.creator_id, 'admin', 'joined');
  return new;
end $$;
create trigger groups_creator_joins after insert on public.groups
  for each row execute function private.groups_creator_joins();
-- creator_id never changes by hand.
create or replace function private.groups_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.creator_id <> old.creator_id then
    raise exception 'the creator is fixed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger groups_guard before update on public.groups for each row execute function private.groups_guard();

-- group_members: joined members see the list; the invited person sees their own invitation;
-- public groups show their members to anyone signed in.
create policy "group_members: members and the invited read" on public.group_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.group_state(group_id, (select auth.uid()))) = 'joined'
    or (select private.group_is_public(group_id))
  );
-- Join a public group yourself (joined, member), or an admin invites (invited), never across a block.
create policy "group_members: join or invite" on public.group_members for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and role = 'member' and state = 'joined' and (select private.group_is_public(group_id)))
    or (
      (select private.is_group_admin(group_id, (select auth.uid())))
      and state = 'invited' and role = 'member'
      and invited_by = (select auth.uid())
      and not (select private.blocked_either_way((select auth.uid()), user_id))
    )
  );
-- The invited person accepts (own row: invited → joined); admins change roles.
create policy "group_members: accept or admin changes" on public.group_members for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_group_admin(group_id, (select auth.uid()))))
  with check (user_id = (select auth.uid()) or (select private.is_group_admin(group_id, (select auth.uid()))));
create or replace function private.group_members_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return new; end if;
  if new.group_id <> old.group_id or new.user_id <> old.user_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not (select private.is_group_admin(new.group_id, me)) then
    -- A plain member may only accept their own invitation.
    if new.role <> old.role or old.state <> 'invited' or new.state <> 'joined' then
      raise exception 'only accepting an invitation is allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger group_members_guard before update on public.group_members
  for each row execute function private.group_members_guard();
-- Leave quietly (own row), decline an invitation (own row), or an admin removes.
create policy "group_members: leave or admin removes" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_group_admin(group_id, (select auth.uid()))));

-- group_posts: joined members read (public groups: anyone signed in); joined members write
-- their own, with a set they can see; author or admin takes down.
create policy "group_posts: members read" on public.group_posts for select to authenticated
  using (
    (select private.group_state(group_id, (select auth.uid()))) = 'joined'
    or (select private.group_is_public(group_id))
  );
create policy "group_posts: members write" on public.group_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select private.group_state(group_id, author_id)) = 'joined'
    and (set_id is null or (select public.can_view_set(set_id, author_id)))
  );
create policy "group_posts: author or admin takes down" on public.group_posts for update to authenticated
  using (author_id = (select auth.uid()) or (select private.is_group_admin(group_id, (select auth.uid()))))
  with check (author_id = (select auth.uid()) or (select private.is_group_admin(group_id, (select auth.uid()))));
create or replace function private.group_posts_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.body <> old.body or new.set_id is distinct from old.set_id
     or new.author_id <> old.author_id or new.group_id <> old.group_id or (old.deleted_at is not null and new.deleted_at is null)) then
    raise exception 'only taking a post down is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger group_posts_guard before update on public.group_posts for each row execute function private.group_posts_guard();

-- An invitation is a notification.
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite'));
alter table public.notifications drop constraint notifications_ref_type;
alter table public.notifications add constraint notifications_ref_type
  check (ref_type in ('set', 'poll', 'conversation', 'profile', 'group'));
create or replace function private.notify_group_invite() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'invited' then
    perform private.notify(new.user_id, 'group_invite', new.invited_by, 'group', new.group_id, false);
  end if;
  return new;
end $$;
create trigger group_members_notify after insert on public.group_members for each row execute function private.notify_group_invite();
