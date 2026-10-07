-- 066 · Leaving a conversation no longer deletes it (the review's #3). "Leave" deleted the row
-- and every message with it - so the person being harassed could lose the evidence before they
-- reported, and a blocked member could delete a thread the block was meant to keep. Now leaving
-- marks the thread left for that member only; the rows stay for a report (spec 10.2 #8); a new
-- message from the other person brings it back. send_message is its latest version (060) plus
-- that one line.

alter table public.conversations add column left_a timestamptz, add column left_b timestamptz;
drop policy "conversations: a member deletes" on public.conversations;

drop policy "conversations: members read" on public.conversations;
create policy "conversations: members read" on public.conversations for select to authenticated
  using (
    (user_a = (select auth.uid()) or user_b = (select auth.uid()))
    and not (select private.blocked_either_way(user_a, user_b))
    and (case when user_a = (select auth.uid()) then left_a is null else left_b is null end)
  );

create or replace function public.leave_conversation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.conversations
     set left_a = case when user_a = me then now() else left_a end,
         left_b = case when user_b = me then now() else left_b end
   where id = p_id and (user_a = me or user_b = me);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;

create or replace function public.send_message(p_to uuid, p_body text, p_photo uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid;
  conv public.conversations%rowtype;
  new_account boolean;
  msg_id uuid;
  body text := coalesce(btrim(p_body), '');
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'refused' using errcode = 'P0001'; end if;
  if char_length(body) > 2000 or (char_length(body) < 1 and p_photo is null) then raise exception 'refused' using errcode = 'P0001'; end if;
  -- The photo must be the sender's own stored picture, not taken down, not deleted.
  if p_photo is not null and not exists (
       select 1 from public.items i where i.id = p_photo and i.owner_id = me and i.kind = 'own'
          and i.image_id is not null and i.image_bucket = 'closet-photos'
          and i.deleted_at is null and i.takedown_state = 'none') then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  if coalesce((select s.value::text from public.app_settings s where s.key = 'dms_open'), 'true') <> 'true' then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  a := least(me, p_to); b := greatest(me, p_to);
  select * into conv from public.conversations c where c.user_a = a and c.user_b = b;
  if (select private.blocked_either_way(me, p_to)) then raise exception 'refused' using errcode = 'P0001'; end if;
  if (conv.id is null or (conv.state = 'request' and conv.requested_by = me))
     and not (select private.may_message(me, p_to)) then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  -- A first message from a stranger is text only (spec 10.2 #5): no photo into a request -
  -- an existing one, or the one this message would open (the recipient does not follow back).
  if p_photo is not null
     and ((conv.id is null and not (select private.is_following(p_to, me))) or conv.state = 'request') then
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
    insert into public.conversations (user_a, user_b, state, requested_by)
    values (a, b, case when (select private.is_following(p_to, me)) then 'normal' else 'request' end, me)
    returning * into conv;
  elsif conv.state = 'request' and conv.requested_by <> me then
    update public.conversations set state = 'normal' where id = conv.id;
  end if;

  insert into public.messages (conversation_id, sender_id, body, photo_item_id) values (conv.id, me, body, p_photo) returning id into msg_id;
  -- A new message brings the thread back for someone who had left it (066).
  update public.conversations set last_message_at = now(), left_a = null, left_b = null where id = conv.id;
  return msg_id;
end $$;
revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;
