-- 039 · Points, badges, levels (roadmap M6.5; spec 11 #5): written by the server only. Nothing
-- here can be inserted, changed or removed by a person - every row comes from a trigger that
-- fires on something they did (publishing a set, entering a contest) or something done to them
-- (a like, a new follower). Each reward is keyed once, so a like given, taken back and given
-- again earns nothing twice. Non-cash only (spec 11 #11).

create table public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points between 1 and 1000),
  reason text not null check (reason in ('publish', 'like_received', 'follower', 'contest_entry')),
  ref text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref)
);
alter table public.points_ledger enable row level security;
revoke all on table public.points_ledger from anon;
revoke insert, update, delete, truncate on table public.points_ledger from authenticated;
create policy "points_ledger: owner reads" on public.points_ledger for select to authenticated
  using (user_id = (select auth.uid()));
create index points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

create table public.badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge text not null check (badge in ('first_set', 'ten_sets', 'style_icon', 'first_contest', 'well_liked', 'followed')),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge)
);
alter table public.badges enable row level security;
revoke all on table public.badges from anon;
revoke insert, update, delete, truncate on table public.badges from authenticated;
-- Badges are worn on the profile, so anyone signed in may read them (not across a block).
create policy "badges: signed-in read" on public.badges for select to authenticated
  using (not (select private.blocked_either_way((select auth.uid()), user_id)));

alter table public.profiles add column points integer not null default 0;

-- Levels are a plain function of points, so nobody stores one.
create or replace function public.level_of(p_points integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_points >= 10000 then 5 when p_points >= 2000 then 4 when p_points >= 500 then 3 when p_points >= 100 then 2 else 1 end;
$$;
grant execute on function public.level_of(integer) to authenticated, anon;

-- The one door: adds points once per key and keeps profiles.points in step. Server-side only.
create or replace function private.award(p_user uuid, p_points integer, p_reason text, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if p_user is null then return; end if;
  insert into public.points_ledger (user_id, points, reason, ref) values (p_user, p_points, p_reason, p_ref)
  on conflict do nothing;
  if found then
    -- Open the server door for this one update only, then put it back as it was.
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    update public.profiles set points = points + p_points where user_id = p_user;
    perform set_config('kleit.server_write', was, true);
  end if;
end $$;
revoke all on function private.award(uuid, integer, text, text) from public;

create or replace function private.badge(p_user uuid, p_badge text)
returns void language sql security definer set search_path = '' as $$
  insert into public.badges (user_id, badge) values (p_user, p_badge) on conflict do nothing;
$$;
revoke all on function private.badge(uuid, text) from public;

-- Nobody edits their own points column: the profile guard from 001 lets the owner change their
-- profile, so this trigger refuses a change to `points` from anyone but the server.
create or replace function private.profiles_points_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.points is distinct from old.points
     and (select auth.uid()) is not null
     and current_setting('kleit.server_write', true) is distinct from '1' then
    raise exception 'points are written by the server only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_points_guard before update on public.profiles
  for each row execute function private.profiles_points_guard();

-- Publishing a set: 10 points once per set; the first, tenth and 125th published set earn badges.
create or replace function private.points_on_publish() returns trigger language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if new.status = 'published' and old.status = 'draft' then
    perform private.award(new.owner_id, 10, 'publish', new.id::text);
    select count(*) into n from public.sets s where s.owner_id = new.owner_id and s.status = 'published' and s.deleted_at is null;
    if n >= 1 then perform private.badge(new.owner_id, 'first_set'); end if;
    if n >= 10 then perform private.badge(new.owner_id, 'ten_sets'); end if;
    if n >= 125 then perform private.badge(new.owner_id, 'style_icon'); end if;
  end if;
  return new;
end $$;
create trigger sets_points after update on public.sets for each row execute function private.points_on_publish();

-- A like on your set: 2 points, once per person per set; 100 likes earns a badge.
create or replace function private.points_on_like() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner uuid; n integer;
begin
  select s.owner_id into owner from public.sets s where s.id = new.set_id;
  if owner is null or owner = new.user_id then return new; end if;
  perform private.award(owner, 2, 'like_received', new.set_id::text || ':' || new.user_id::text);
  select count(*) into n from public.points_ledger l where l.user_id = owner and l.reason = 'like_received';
  if n >= 100 then perform private.badge(owner, 'well_liked'); end if;
  return new;
end $$;
create trigger likes_points after insert on public.likes for each row execute function private.points_on_like();

-- A new follower: 1 point, once per person; 10 followers earns a badge.
create or replace function private.points_on_follow() returns trigger language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.award(new.followee_id, 1, 'follower', new.follower_id::text);
  select count(*) into n from public.points_ledger l where l.user_id = new.followee_id and l.reason = 'follower';
  if n >= 10 then perform private.badge(new.followee_id, 'followed'); end if;
  return new;
end $$;
create trigger follows_points after insert on public.follows for each row execute function private.points_on_follow();

-- Entering a contest: 5 points once per contest, and a badge the first time.
create or replace function private.points_on_entry() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.award(new.user_id, 5, 'contest_entry', new.contest_id::text);
  perform private.badge(new.user_id, 'first_contest');
  return new;
end $$;
create trigger contest_entries_points after insert on public.contest_entries for each row execute function private.points_on_entry();

-- Your own page: points, level and badges in one call.
create or replace function public.my_points()
returns table (points integer, level integer, badges text[])
language sql stable security invoker set search_path = '' as $$
  select p.points, public.level_of(p.points),
         coalesce((select array_agg(b.badge order by b.awarded_at) from public.badges b where b.user_id = p.user_id), '{}')
    from public.profiles p where p.user_id = (select auth.uid());
$$;
revoke all on function public.my_points() from public;
grant execute on function public.my_points() to authenticated;
