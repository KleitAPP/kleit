-- 029 · Comments, likes, reactions (roadmap M5.4; spec 11 #1; gap C10; technical pack §1.5).
--
-- Who may comment is the set's own setting (everyone / people the owner follows / off), with a
-- default on the profile for new sets. "Off" hides the comments; it does not delete them (C10).
-- A comment can be edited by its author for 15 minutes, taken back by its author any time,
-- and removed by the set's owner (both are a timestamp - the row stays for a report). Likes
-- and reactions are one row per person per set; a reaction is one of six.

alter table public.profiles
  add column comments_default text not null default 'everyone'
    constraint profiles_comments_default check (comments_default in ('everyone', 'following', 'off'));
alter table public.sets
  add column comments_setting text not null default 'everyone'
    constraint sets_comments_setting check (comments_setting in ('everyone', 'following', 'off'));

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null constraint comments_body_length check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  -- Who took it down: the author ("taken back") or the set's owner ("removed"); null while it stands.
  deleted_by uuid references auth.users (id) on delete set null
);
alter table public.comments enable row level security;
revoke all on table public.comments from anon;
revoke delete, truncate on table public.comments from authenticated;
create index comments_set_idx on public.comments (set_id, created_at);

create table public.likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, set_id)
);
alter table public.likes enable row level security;
revoke all on table public.likes from anon;
revoke update, truncate on table public.likes from authenticated;
create index likes_set_idx on public.likes (set_id);

create table public.reactions (
  user_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  emoji text not null constraint reactions_known check (emoji in ('🔥', '😍', '👏', '😂', '🤔', '💯')),
  created_at timestamptz not null default now(),
  primary key (user_id, set_id)
);
alter table public.reactions enable row level security;
revoke all on table public.reactions from anon;
revoke truncate on table public.reactions from authenticated;
create index reactions_set_idx on public.reactions (set_id);

-- May this person comment on this set? Viewer of the set, not blocked by the owner, and the
-- set's setting allows them. Runs as the data's owner so it can read the owner id.
create or replace function private.may_comment(p_set uuid, p_who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_who is not null
     and coalesce((select s.value::text from public.app_settings s where s.key = 'comments_open'), 'true') = 'true'
     and (select public.can_view_set(p_set, p_who))
     and exists (
       select 1 from public.sets s
        where s.id = p_set
          and not (select private.blocked_either_way(s.owner_id, p_who))
          and (
            s.owner_id = p_who
            or s.comments_setting = 'everyone'
            or (s.comments_setting = 'following' and (select private.is_following(s.owner_id, p_who)))
          )
     );
$$;
revoke all on function private.may_comment(uuid, uuid) from public;
grant execute on function private.may_comment(uuid, uuid) to authenticated;

create or replace function private.set_owner(p_set uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.owner_id from public.sets s where s.id = p_set;
$$;
revoke all on function private.set_owner(uuid) from public;
grant execute on function private.set_owner(uuid) to authenticated;

-- Comments: readable by anyone who can see the set, while the setting is not "off" (the owner
-- always sees their own set's comments), never across a block with the author.
create policy "comments: viewers read" on public.comments for select to authenticated
  using (
    (select public.can_view_set(set_id, (select auth.uid())))
    and not (select private.blocked_either_way((select auth.uid()), author_id))
    and (
      (select private.set_owner(set_id)) = (select auth.uid())
      or exists (select 1 from public.sets s where s.id = set_id and s.comments_setting <> 'off')
    )
  );
create policy "comments: allowed people write" on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.may_comment(set_id, author_id)));
-- The author edits (15 minutes) or takes back; the set's owner removes. The trigger below keeps
-- each to what they may change.
create policy "comments: author or set owner change" on public.comments for update to authenticated
  using (author_id = (select auth.uid()) or (select private.set_owner(set_id)) = (select auth.uid()))
  with check (author_id = (select auth.uid()) or (select private.set_owner(set_id)) = (select auth.uid()));

create or replace function private.comments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
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
create trigger comments_guard before update on public.comments
  for each row execute function private.comments_guard();

-- Likes and reactions: seen by anyone who can see the set (as counts); your own to add and take away.
create policy "likes: viewers read" on public.likes for select to authenticated
  using ((select public.can_view_set(set_id, (select auth.uid()))));
create policy "likes: own" on public.likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.can_view_set(set_id, user_id))
    and not (select private.blocked_either_way((select private.set_owner(set_id)), user_id))
  );
create policy "likes: own away" on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "reactions: viewers read" on public.reactions for select to authenticated
  using ((select public.can_view_set(set_id, (select auth.uid()))));
create policy "reactions: own" on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.can_view_set(set_id, user_id))
    and not (select private.blocked_either_way((select private.set_owner(set_id)), user_id))
  );
create policy "reactions: own change" on public.reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reactions: own away" on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- The numbers a set page shows, in one call.
create or replace function public.set_social(p_set uuid)
returns table (likes bigint, comments bigint, reactions jsonb, my_like boolean, my_reaction text)
language sql stable set search_path = '' as $$
  select
    (select count(*) from public.likes l where l.set_id = p_set),
    (select count(*) from public.comments c where c.set_id = p_set and c.deleted_at is null),
    (select coalesce(jsonb_object_agg(r.emoji, r.n), '{}'::jsonb)
       from (select emoji, count(*) as n from public.reactions where set_id = p_set group by emoji) r),
    exists (select 1 from public.likes l where l.set_id = p_set and l.user_id = auth.uid()),
    (select r.emoji from public.reactions r where r.set_id = p_set and r.user_id = auth.uid());
$$;
revoke all on function public.set_social(uuid) from public;
grant execute on function public.set_social(uuid) to authenticated;
