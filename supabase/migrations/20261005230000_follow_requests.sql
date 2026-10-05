-- 026 · Follow requests (roadmap M5.1; spec 3.6, 10.1).
--
-- A public account is followed at once (migration 017's insert policy). A private account is
-- followed by request: the request is a row here, the owner approves or declines, and only an
-- approval writes the `follows` row - through a function that runs as the owner of the data,
-- because the insert policy on `follows` rightly refuses a direct insert on a private account.
-- Declining and cancelling are deletes; nobody is told of either (spec 10.1 #4 for removal).

create table public.follow_requests (
  requester_id uuid not null references auth.users (id) on delete cascade,
  target_id    uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (requester_id, target_id),
  constraint follow_requests_not_self check (requester_id <> target_id)
);
alter table public.follow_requests enable row level security;
revoke all on table public.follow_requests from anon;
revoke update, truncate on table public.follow_requests from authenticated;
create index follow_requests_target_idx on public.follow_requests (target_id);

-- Either side reads their own; nobody else.
create policy "follow_requests: both sides read" on public.follow_requests for select to authenticated
  using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));

-- The requester creates it: only towards a private, active account they do not already follow,
-- never across a block.
create policy "follow_requests: requester creates" on public.follow_requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and not (select private.blocked_either_way(requester_id, target_id))
    and not (select private.is_following(requester_id, target_id))
    and exists (select 1 from public.profiles p where p.user_id = target_id and p.is_private and p.deactivated_at is null)
  );

-- The requester cancels, or the target declines. Both are quiet.
create policy "follow_requests: either side deletes" on public.follow_requests for delete to authenticated
  using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));

-- Approve: only the target, only an existing request, and only then the follow row exists.
create or replace function public.approve_follow_request(p_requester uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'signed out' using errcode = '42501';
  end if;
  if not exists (select 1 from public.follow_requests r where r.requester_id = p_requester and r.target_id = me) then
    return false;
  end if;
  if (select private.blocked_either_way(p_requester, me)) then
    delete from public.follow_requests where requester_id = p_requester and target_id = me;
    return false;
  end if;
  insert into public.follows (follower_id, followee_id) values (p_requester, me)
    on conflict do nothing;
  delete from public.follow_requests where requester_id = p_requester and target_id = me;
  return true;
end $$;
revoke all on function public.approve_follow_request(uuid) from public;
grant execute on function public.approve_follow_request(uuid) to authenticated;

-- A block sweeps away any request AND any follow in either direction (spec 10.4 #2), quietly.
create or replace function private.block_clears_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follow_requests
   where (requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id);
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
drop trigger if exists blocks_clear_requests on public.blocks;
create trigger blocks_clear_requests after insert on public.blocks
  for each row execute function private.block_clears_requests();

-- Counts a profile shows: followers and following, through the row policy a viewer already has
-- (follows are readable by any signed-in person who is not blocked either way).
create or replace function public.follow_counts(p_user uuid)
returns table (followers bigint, following bigint) language sql stable set search_path = '' as $$
  select
    (select count(*) from public.follows f where f.followee_id = p_user),
    (select count(*) from public.follows f where f.follower_id = p_user);
$$;
revoke all on function public.follow_counts(uuid) from public;
grant execute on function public.follow_counts(uuid) to authenticated;
