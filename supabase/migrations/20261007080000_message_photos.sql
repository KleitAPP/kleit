-- 059 · Photos in messages (CL35; spec 10.2 #7). A photo in a message is a piece of the sender's
-- own (an `items` row of kind 'own' in `closet-photos`, with no closet row, so it never shows in
-- their closet), screened by the same pipeline as every other upload. The message points at it.
-- The other person may read the file only while (a) a live message in a conversation they are
-- in points at it and (b) the scan has cleared it - the storage policy below asks both. The app
-- shows it blurred with "Tap to view" until tapped. Nothing else about reading messages changes.

alter table public.messages add column photo_item_id uuid references public.items (id) on delete set null;
create index messages_photo_idx on public.messages (photo_item_id) where photo_item_id is not null;
-- A photo may travel with no words.
alter table public.messages drop constraint messages_body_length;
alter table public.messages add constraint messages_body_length
  check (char_length(body) <= 2000 and (char_length(body) >= 1 or photo_item_id is not null));

-- The guard from 049 lets only a take-back through; the photo pointer joins the frozen columns.
create or replace function private.messages_guard()
returns trigger language plpgsql as $$
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.body <> old.body or new.sender_id <> old.sender_id or new.conversation_id <> old.conversation_id
     or new.created_at <> old.created_at or new.photo_item_id is distinct from old.photo_item_id
     or (old.deleted_at is not null and new.deleted_at is null) then
    raise exception 'only taking a message back is allowed' using errcode = '42501';
  end if;
  return new;
end $$;

-- May this person see this stored file as a message photo? Live message, their conversation,
-- scan cleared. Security definer because messages and items are not theirs to read directly.
create or replace function private.message_photo_viewable(p_object_name text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer is not null and exists (
    select 1
      from public.items i
      join public.messages m on m.photo_item_id = i.id
     where i.image_bucket = 'closet-photos'
       and i.image_id = p_object_name
       and i.deleted_at is null
       and i.takedown_state = 'none'
       and m.deleted_at is null
       and (select private.in_conversation(m.conversation_id, p_viewer))
       and (select private.image_cleared(i.id))
  );
$$;
revoke all on function private.message_photo_viewable(text, uuid) from public;
grant execute on function private.message_photo_viewable(text, uuid) to authenticated;

create policy "closet-photos: the other person reads a message photo" on storage.objects
  for select to authenticated
  using (bucket_id = 'closet-photos' and (select private.message_photo_viewable(name, (select auth.uid()))));

-- send_message grows a third argument. The old two-argument shape goes, so there is one
-- function and no overload to resolve; every caller passes the photo or nothing.
drop function public.send_message(uuid, text);
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
  -- A first message from a stranger is text only (spec 10.2 #5): no photo into a request.
  if p_photo is not null and (conv.id is null or conv.state = 'request') then
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
  update public.conversations set last_message_at = now() where id = conv.id;
  return msg_id;
end $$;
revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;
