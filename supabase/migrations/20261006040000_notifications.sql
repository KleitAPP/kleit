-- 031 · In-app notifications (roadmap M5.6, the in-app half; spec 11 #1; technical pack §1.7
-- row 42: owner reads and marks read; the server writes).
--
-- Every row is written by a trigger on the thing that happened - a vote, a comment, a like, a
-- follow, a follow request, a message request - as the data's owner, never by the app. A vote
-- bundles: the same poll's votes within an hour land on one row with a count (spec: "one push,
-- bundles at 12" is the push half, which waits for the phone apps and OneSignal). Nothing here
-- names a guest voter: a vote row carries no actor.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint notifications_kind check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message')),
  actor_id uuid references auth.users (id) on delete cascade,
  ref_type text constraint notifications_ref_type check (ref_type in ('set', 'poll', 'conversation', 'profile')),
  ref_id uuid,
  bundled_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon;
revoke insert, truncate on table public.notifications from authenticated;
create index notifications_user_idx on public.notifications (user_id, updated_at desc);

create policy "notifications: owner reads" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: owner marks read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: owner clears" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
-- Only read_at may change by hand.
create or replace function private.notifications_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.user_id <> old.user_id or new.kind <> old.kind or new.actor_id is distinct from old.actor_id
     or new.ref_id is distinct from old.ref_id or new.bundled_count <> old.bundled_count or new.created_at <> old.created_at) then
    raise exception 'only marking as read is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications
  for each row execute function private.notifications_guard();

-- One writer. Bundles when asked: the same kind, ref and recipient within an hour becomes a count.
create or replace function private.notify(p_user uuid, p_kind text, p_actor uuid, p_ref_type text, p_ref uuid, p_bundle boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and (select private.blocked_either_way(p_user, p_actor)) then return; end if;
  if p_bundle then
    select n.id into existing from public.notifications n
     where n.user_id = p_user and n.kind = p_kind and n.ref_id is not distinct from p_ref
       and n.read_at is null and n.updated_at > now() - interval '1 hour'
     order by n.updated_at desc limit 1;
    if existing is not null then
      update public.notifications set bundled_count = bundled_count + 1, updated_at = now() where id = existing;
      return;
    end if;
  end if;
  insert into public.notifications (user_id, kind, actor_id, ref_type, ref_id)
  values (p_user, p_kind, p_actor, p_ref_type, p_ref);
end $$;
revoke all on function private.notify(uuid, text, uuid, text, uuid, boolean) from public;

-- The triggers.
create or replace function private.notify_vote() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select p.owner_id from public.polls p where p.id = new.poll_id), 'vote', null, 'poll', new.poll_id, true);
  return new;
end $$;
create trigger votes_notify after insert on public.votes for each row execute function private.notify_vote();

create or replace function private.notify_comment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select s.owner_id from public.sets s where s.id = new.set_id), 'comment', new.author_id, 'set', new.set_id, false);
  return new;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function private.notify_comment();

create or replace function private.notify_like() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select s.owner_id from public.sets s where s.id = new.set_id), 'like', new.user_id, 'set', new.set_id, true);
  return new;
end $$;
create trigger likes_notify after insert on public.likes for each row execute function private.notify_like();

create or replace function private.notify_follow() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.followee_id, 'follow', new.follower_id, 'profile', new.follower_id, false);
  return new;
end $$;
create trigger follows_notify after insert on public.follows for each row execute function private.notify_follow();

create or replace function private.notify_follow_request() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.target_id, 'follow_request', new.requester_id, 'profile', new.requester_id, false);
  return new;
end $$;
create trigger follow_requests_notify after insert on public.follow_requests for each row execute function private.notify_follow_request();

-- A message: the other member is told once per conversation until they read it (bundled);
-- a request is its own kind so the Inbox can say so.
create or replace function private.notify_message() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  recipient uuid;
begin
  select * into c from public.conversations where id = new.conversation_id;
  recipient := case when c.user_a = new.sender_id then c.user_b else c.user_a end;
  perform private.notify(recipient,
    case when c.state = 'request' and c.requested_by = new.sender_id then 'message_request' else 'message' end,
    new.sender_id, 'conversation', new.conversation_id, true);
  return new;
end $$;
create trigger messages_notify after insert on public.messages for each row execute function private.notify_message();

-- Unread count for the tab's badge.
create or replace function public.unread_notifications()
returns bigint language sql stable set search_path = '' as $$
  select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null;
$$;
revoke all on function public.unread_notifications() from public;
grant execute on function public.unread_notifications() to authenticated;
