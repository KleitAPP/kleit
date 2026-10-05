-- 027 · Direct messages, text only (roadmap M5.2; spec 10.2; technical pack §1.5 rows 29–31).
--
-- One-to-one only (spec 10.2 #2). A conversation is between two people, kept once (user_a < user_b).
-- Every message goes through `send_message()`, which is where the rules live: your DM setting,
-- blocks, the first message from someone you do not follow back landing in Requests (state
-- 'request'), no links for a new account's first 7 days, and plain limits. Nothing writes to
-- these tables directly from the app - the policies allow reads and the two small owner actions.
-- Photos in messages are a later waypoint (they go through the image pipeline and the blur).

alter table public.profiles
  add column dm_setting text not null default 'followers'
    constraint profiles_dm_setting check (dm_setting in ('everyone', 'followers', 'following', 'nobody'));

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  state text not null default 'normal' constraint conversations_state check (state in ('normal', 'request')),
  -- Who opened it (the person whose first message landed in the other's Requests, when state is 'request').
  requested_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_ordered check (user_a < user_b),
  unique (user_a, user_b)
);
alter table public.conversations enable row level security;
revoke all on table public.conversations from anon;
revoke insert, update, truncate on table public.conversations from authenticated;
create index conversations_b_idx on public.conversations (user_b);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null constraint messages_body_length check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.messages enable row level security;
revoke all on table public.messages from anon;
revoke insert, delete, truncate on table public.messages from authenticated;
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create or replace function private.in_conversation(c uuid, who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select who is not null and exists (
    select 1 from public.conversations x where x.id = c and (x.user_a = who or x.user_b = who)
  );
$$;
revoke all on function private.in_conversation(uuid, uuid) from public;
grant execute on function private.in_conversation(uuid, uuid) to authenticated;

-- The two members read; a member may leave or decline (delete) a conversation; nobody inserts
-- or changes one by hand.
create policy "conversations: members read" on public.conversations for select to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));
create policy "conversations: a member deletes" on public.conversations for delete to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

-- Messages: the two members read; the sender may soft-delete their own (the body becomes
-- "Message unavailable" in the app; the row stays for a report, spec 10.2 #8).
create policy "messages: members read" on public.messages for select to authenticated
  using ((select private.in_conversation(conversation_id, (select auth.uid()))));
create policy "messages: sender takes back" on public.messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));
-- Only deleted_at may change on an update, and only one way.
create or replace function private.messages_guard()
returns trigger language plpgsql as $$
begin
  if new.body <> old.body or new.sender_id <> old.sender_id or new.conversation_id <> old.conversation_id
     or new.created_at <> old.created_at or (old.deleted_at is not null and new.deleted_at is null) then
    raise exception 'only taking a message back is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger messages_guard before update on public.messages
  for each row execute function private.messages_guard();

-- Who may message whom, by the recipient's own setting (spec 10.2 #3–#4).
create or replace function private.may_message(sender uuid, recipient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case (select p.dm_setting from public.profiles p where p.user_id = recipient and p.deactivated_at is null)
    when 'everyone'  then true
    when 'followers' then (select private.is_following(sender, recipient))
    when 'following' then (select private.is_following(recipient, sender))
    else false
  end
  and not (select private.blocked_either_way(sender, recipient));
$$;
revoke all on function private.may_message(uuid, uuid) from public;
grant execute on function private.may_message(uuid, uuid) to authenticated;

-- send_message: the one door. Returns the message id.
--   refused      the recipient's setting or a block says no, or DMs are switched off
--   no_links_yet a link in a message from an account under 7 days old (spec 10.2 #6)
--   too_many     over the plain limits (new accounts: 20 new conversations a day; anyone: 120 messages an hour)
create or replace function public.send_message(p_to uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid;
  conv public.conversations%rowtype;
  new_account boolean;
  msg_id uuid;
  body text := btrim(p_body);
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'refused' using errcode = 'P0001'; end if;
  if char_length(body) < 1 or char_length(body) > 2000 then raise exception 'refused' using errcode = 'P0001'; end if;
  if coalesce((select s.value::text from public.app_settings s where s.key = 'dms_open'), 'true') <> 'true' then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  a := least(me, p_to); b := greatest(me, p_to);
  select * into conv from public.conversations c where c.user_a = a and c.user_b = b;
  -- Inside a conversation both sides already have, a reply is always allowed (a block is not a
  -- setting: it ends the conversation). Opening one, or writing into a request, follows the
  -- recipient's setting.
  if (select private.blocked_either_way(me, p_to)) then raise exception 'refused' using errcode = 'P0001'; end if;
  if (conv.id is null or (conv.state = 'request' and conv.requested_by = me))
     and not (select private.may_message(me, p_to)) then
    raise exception 'refused' using errcode = 'P0001';
  end if;

  new_account := (select p.created_at > now() - interval '7 days' from public.profiles p where p.user_id = me);
  if new_account and body ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|me|ly|gg)(/|\s|$))' then
    raise exception 'no_links_yet' using errcode = 'P0002';
  end if;
  if (select count(*) from public.messages m where m.sender_id = me and m.created_at > now() - interval '1 hour') >= 120 then
    raise exception 'too_many' using errcode = 'P0003';
  end if;

  if conv.id is null then
    if new_account and (select count(*) from public.conversations c
                         where c.requested_by = me and c.created_at > now() - interval '1 day') >= 20 then
      raise exception 'too_many' using errcode = 'P0003';
    end if;
    -- A first message from someone the recipient does not follow back lands in their Requests.
    insert into public.conversations (user_a, user_b, state, requested_by)
    values (a, b, case when (select private.is_following(p_to, me)) then 'normal' else 'request' end, me)
    returning * into conv;
  elsif conv.state = 'request' and conv.requested_by <> me then
    -- The recipient answering is the acceptance.
    update public.conversations set state = 'normal' where id = conv.id;
  end if;

  insert into public.messages (conversation_id, sender_id, body) values (conv.id, me, body) returning id into msg_id;
  update public.conversations set last_message_at = now() where id = conv.id;
  return msg_id;
end $$;
revoke all on function public.send_message(uuid, text) from public;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Accept a request without replying (the Accept button). Declining is deleting the conversation.
create or replace function public.accept_message_request(p_conversation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  update public.conversations
     set state = 'normal'
   where id = p_conversation and state = 'request' and requested_by <> me and (user_a = me or user_b = me);
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.accept_message_request(uuid) from public;
grant execute on function public.accept_message_request(uuid) to authenticated;

-- Live updates in the open conversation (spec 10.2 #1): the row policy still decides who sees what.
alter publication supabase_realtime add table public.messages;
