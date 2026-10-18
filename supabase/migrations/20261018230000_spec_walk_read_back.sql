-- The read-back of the spec walk (L35), 2026-10-18 - a separate reviewer read 103 and the app
-- changes with "what would the tests not catch?" and found these, all shut here:
--
--   1. 103's "no link into a request" also refused the RECIPIENT'S reply - the very message that
--      accepts the request. Only a message the requester sends into a request is a request now.
--   2. The set's alt text was never screened and 103 made it public (og:image:alt); the
--      description got the caption's refuse rule but not its hold-and-report, nor the outside text
--      check. One function screens caption, description and alt text the same way, and one queues
--      all three for the outside check.
--   3. "Edited" read `updated_at`, which moves on every row write (a preview drawn, a tag, a
--      feature, a setting), and not at all when a Quick set's pieces change. `sets.edited_at` is the
--      server's: stamped when a published set's layout, title, description or pieces change.
--   4. A poll closed only when its set left Public or Link; a Followers set switched to Only me, or
--      a set put back to draft, kept its poll open. Every narrowing closes it now.
--   5. The description was saved and shown nowhere; `shared_set` carries it for the share page.
--
-- L31: sets_screen and sets_queue_check from 20261012050000_song_card.sql; send_message and
-- shared_set from 20261018190000_spec_walk_social.sql.

-- 1. The recipient's reply is not "into a request".
create or replace function public.send_message(p_to uuid, p_body text, p_photo uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid;
  conv public.conversations%rowtype;
  new_account boolean;
  into_request boolean;
  msg_id uuid;
  body text := coalesce(btrim(p_body), '');
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  if (select p.deactivated_at is not null from public.profiles p where p.user_id = me) then raise exception 'refused' using errcode = 'P0001'; end if;
  if p_to is null or p_to = me then raise exception 'refused' using errcode = 'P0001'; end if;
  if char_length(body) > 2000 or (char_length(body) < 1 and p_photo is null) then raise exception 'refused' using errcode = 'P0001'; end if;
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
  if conv.state = 'request' and conv.requested_by = me
     and ((conv.user_a = p_to and conv.left_a is not null) or (conv.user_b = p_to and conv.left_b is not null)) then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  -- Into a request (spec 10.2 #5): the requester's own messages while the other person has not
  -- answered - the first one, or more of them. The recipient's reply accepts the request and is
  -- an ordinary message. Text only: no photo and no link, whatever the account's age.
  into_request := (conv.id is null and not (select private.is_following(p_to, me)))
                  or (conv.state = 'request' and conv.requested_by = me);
  if p_photo is not null and into_request then
    raise exception 'refused' using errcode = 'P0001';
  end if;

  new_account := (select p.created_at > now() - interval '7 days' from public.profiles p where p.user_id = me);
  if (new_account or into_request) and body ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|me|ly|gg)(/|\s|$))' then
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
  update public.conversations set last_message_at = now(), left_a = null, left_b = null where id = conv.id;
  return msg_id;
end $$;
revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

-- 2. Caption, description and alt text: one rule. (103's description-only trigger goes.)
drop trigger if exists sets_screen_description on public.sets;
drop function if exists private.sets_screen_description();

create or replace function private.sets_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', ''); v text; ref text;
        song text := btrim(coalesce(new.song_title, '') || ' ' || coalesce(new.song_artist, ''));
        words text; old_words text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if song <> '' and (tg_op = 'INSERT' or song <> btrim(coalesce(old.song_title, '') || ' ' || coalesce(old.song_artist, '')))
     and public.text_verdict(song, 'caption') = 'refuse' then
    raise exception 'no phone numbers or addresses' using errcode = 'P0006';
  end if;
  -- The caption, the description and the alt text are the set's public words; screened alike.
  words := cap || E'\n' || coalesce(new.description, '') || E'\n' || coalesce(new.alt_text, '');
  old_words := case when tg_op = 'UPDATE'
    then coalesce(old.layout ->> 'caption', '') || E'\n' || coalesce(old.description, '') || E'\n' || coalesce(old.alt_text, '')
    else null end;
  if tg_op = 'UPDATE' and words = old_words then return new; end if;
  v := public.text_verdict(words, 'caption');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' and not exists (
       select 1 from public.reports r where r.target_type = 'set' and r.target_id = new.id and r.state in ('open', 'reviewing'))
     and (select count(*) from public.reports r where r.reporter_id = new.owner_id and r.note like '%held by the word list' and r.created_at > now() - interval '1 day') < 5 then
    ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values (ref, new.owner_id, 'set', new.id, new.owner_id, 'self_harm', 'caption held by the word list', 'urgent');
  end if;
  return new;
end $$;

create or replace function private.sets_queue_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', '');
        song text := btrim(coalesce(new.song_title, '') || ' ' || coalesce(new.song_artist, ''));
begin
  if cap <> '' and (tg_op = 'INSERT' or cap <> coalesce(old.layout ->> 'caption', '')) then
    perform private.queue_text_check('caption', new.id, new.owner_id, cap);
  end if;
  if song <> '' and (tg_op = 'INSERT' or song <> btrim(coalesce(old.song_title, '') || ' ' || coalesce(old.song_artist, ''))) then
    perform private.queue_text_check('caption', new.id, new.owner_id, song);
  end if;
  if coalesce(new.description, '') <> '' and (tg_op = 'INSERT' or new.description is distinct from old.description) then
    perform private.queue_text_check('caption', new.id, new.owner_id, new.description);
  end if;
  if coalesce(new.alt_text, '') <> '' and (tg_op = 'INSERT' or new.alt_text is distinct from old.alt_text) then
    perform private.queue_text_check('caption', new.id, new.owner_id, new.alt_text);
  end if;
  return new;
end $$;

-- 3. edited_at: the server's, stamped by what a viewer would call an edit.
alter table public.sets add column edited_at timestamptz;
comment on column public.sets.edited_at is 'When a published set''s layout, title, description or pieces last changed - the share page''s "Edited" (spec 7.1 #6). The server''s: a member write to it is refused.';

create or replace function private.sets_stamp_edited() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and current_setting('kleit.server_write', true) is distinct from '1'
     and new.edited_at is distinct from old.edited_at then
    raise exception 'edited_at is stamped by the server' using errcode = '42501';
  end if;
  if old.status = 'published' and new.status = 'published'
     and (new.layout is distinct from old.layout or new.title is distinct from old.title
          or new.description is distinct from old.description) then
    new.edited_at := now();
  end if;
  return new;
end $$;
revoke all on function private.sets_stamp_edited() from public;
create trigger sets_stamp_edited before update on public.sets
  for each row execute function private.sets_stamp_edited();

create or replace function private.set_items_stamp_edited() returns trigger language plpgsql security definer set search_path = '' as $$
declare sid uuid := coalesce(new.set_id, old.set_id); was text;
begin
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.sets s set edited_at = now() where s.id = sid and s.status = 'published';
  perform set_config('kleit.server_write', was, true);
  return coalesce(new, old);
end $$;
revoke all on function private.set_items_stamp_edited() from public;
create trigger set_items_stamp_edited after insert or update or delete on public.set_items
  for each row execute function private.set_items_stamp_edited();

-- 4. Every narrowing closes the poll.
create or replace function private.sets_close_polls() returns trigger language plpgsql security definer set search_path = '' as $$
declare rank_old int; rank_new int;
begin
  rank_old := case old.visibility when 'public' then 5 when 'link' then 4 when 'followers' then 3 when 'friends' then 2 else 1 end;
  rank_new := case new.visibility when 'public' then 5 when 'link' then 4 when 'followers' then 3 when 'friends' then 2 else 1 end;
  if (new.deleted_at is not null and old.deleted_at is null)
     or (new.takedown_state <> 'none' and old.takedown_state = 'none')
     or (new.status <> 'published' and old.status = 'published')
     or rank_new < rank_old then
    update public.polls p set closed_at = now()
     where p.closed_at is null
       and exists (select 1 from public.poll_options o where o.poll_id = p.id and o.set_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists sets_close_polls on public.sets;
create trigger sets_close_polls after update of deleted_at, takedown_state, visibility, status on public.sets
  for each row execute function private.sets_close_polls();

-- 5. shared_set: edited_at instead of updated_at, and the description.
create or replace function public.shared_set(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'caption', coalesce(s.layout ->> 'caption', ''),
    'description', coalesce(s.description, ''),
    'layout', s.layout,
    'visibility', s.visibility,
    'published_at', s.published_at,
    'edited_at', s.edited_at,
    'alt_text', s.alt_text,
    'preview', s.preview_image_id,
    'remixed_from', s.remixed_from_label,
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name, 'label', p.label,
                                'photo', case when (select public.piece_is_shareable(p.avatar_item_id)) then p.avatar_item_id end),
    'song', case when s.song_url is not null then jsonb_build_object(
              'url', s.song_url, 'title', s.song_title, 'artist', s.song_artist, 'cover', s.song_cover_url) end,
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'row', si.id,
        'slot', (si.position ->> 'slot')::int,
        'position', case when si.position ? 'x' then si.position end,
        'kind', i.kind,
        'title', i.title,
        'color_name', i.color_name,
        'price_cents', case when i.kind = 'product' then i.price_cents end,
        'price_currency', case when i.kind = 'product' then i.price_currency end,
        'store_name', case when i.kind = 'product' then coalesce(i.store_name, i.source_domain) end,
        'source_domain', case when i.kind = 'product' then i.source_domain end,
        'buyable', i.kind = 'product' and i.source_url is not null and i.dead_link_at is null
                   and (select private.image_cleared(i.id)),
        'pictured', (select private.image_cleared(i.id))
                    and (i.kind = 'product' or (select private.closet_says_shareable(i.id)))
      ) order by (si.position ->> 'slot')::int, si.created_at)
      from public.set_items si
      join public.items i on i.id = si.item_id
      where si.set_id = s.id and i.deleted_at is null and i.takedown_state = 'none'
    ), '[]'::jsonb)
  )
  from public.set_by_share_code(p_code) s
  join public.profiles p on p.user_id = s.owner_id
  limit 1;
$$;
