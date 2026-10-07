-- 061 · A block ends the photo too. `message_photo_viewable` (059) asked "a live message in a
-- conversation you are in, scan cleared" - but a block hides the conversation without deleting
-- it, so a blocked person who had kept the file's path could still sign a read of it. Now the
-- function also asks that nobody has blocked the other (the latest version, 059, plus one line).
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
       and not (select private.blocked_either_way(p_viewer, m.sender_id))
       and (select private.image_cleared(i.id))
  );
$$;
