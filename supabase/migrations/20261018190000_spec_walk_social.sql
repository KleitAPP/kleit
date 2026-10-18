-- Spec walk, part 2 (2026-10-18): lines of sections 3.6, 7.1, 7.4 and 10 that no waypoint carried.
--
--   1. 7.1 #2  — an account-wide default for who sees a new set (`profiles.default_visibility`).
--   2. 7.4 #2  — an account-wide default for who may remix a new set (`profiles.remix_default`).
--      Both are the owner's own columns; the app writes them into every new set it makes, and the
--      set's own value stays the one that counts (the per-set switches already exist).
--   3. 3.6 #8, 10.4 #2 — the comments of a person on a break (or banned, or deleting) and of a
--      person the set's owner has blocked are hidden from everyone but their author and a
--      moderator. The old read rule hid a blocked pair's comments only from each other.
--   4. 10.2 #5 — a message request is text only: no photo (already) and NO LINK, whatever the
--      sender's account age. The 7-day rule for new accounts stays on top.
--   5. 7.1 #8  — when a set stops being visible (deleted, taken down, or set to Followers, Friends
--      or Only me), every open poll that offers it closes at once. (Its preview picture is taken
--      down by `set-preview`, which the app asks after every visibility change - 023, 097.)
--   7. 13.2 #4 — a set's description (new on the send screen) is screened like its caption: a
--      phone number or a street address is refused with P0006, which the screen already explains.
--   6. 7.1 #6, #12 — `shared_set` says when the set was last changed (`updated_at`) so the share page
--      can show "Edited" when it changed after it was first published, and carries the set's
--      alt text for the preview picture's description (og:image:alt).
--
-- L31: send_message is rebuilt from its latest text (20261007180000_second_review.sql), shared_set
-- from 20261012120000_fixes_read_back.sql, the comments policy from 20261007110000_text_screening.sql.

-- 1, 2. Account-wide defaults.
alter table public.profiles add column default_visibility public.set_visibility not null default 'public';
comment on column public.profiles.default_visibility is 'Who sees a new set of mine unless I say otherwise (spec 7.1 #2). The set''s own visibility is what counts once it exists.';
alter table public.profiles add column remix_default public.remix_mode not null default 'anyone';
comment on column public.profiles.remix_default is 'Who may remix a new set of mine unless I say otherwise (spec 7.4 #2). The set''s own remix_mode is what counts.';

-- 3. Comments: hidden accounts and the owner's blocks.
drop policy "comments: viewers read" on public.comments;
create policy "comments: viewers read" on public.comments for select to authenticated
  using (
    (select public.can_view_set(set_id, (select auth.uid())))
    and not (select private.blocked_either_way((select auth.uid()), author_id))
    and (
      (select private.set_owner(set_id)) = (select auth.uid())
      or exists (select 1 from public.sets s where s.id = set_id and s.comments_setting <> 'off')
    )
    and (held_at is null or author_id = (select auth.uid()) or (select private.is_moderator()))
    -- The author's own comments stay theirs to see; a moderator sees everything; everyone else
    -- sees nothing from an account on a break, banned or deleting (3.6 #8), nor from a person
    -- the set's owner has blocked (10.4 #2).
    and (
      author_id = (select auth.uid())
      or (select private.is_moderator())
      or (
        not (select private.is_hidden_account(author_id))
        and not (select private.blocked_either_way((select private.set_owner(set_id)), author_id))
      )
    )
  );

-- 4. No link into a message request.
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
  -- On a break, or waiting for deletion: nothing new leaves this account (the app signs them out; the door agrees).
  if (select p.deactivated_at is not null from public.profiles p where p.user_id = me) then raise exception 'refused' using errcode = 'P0001'; end if;
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
  -- A request the other person has left is declined: it does not come back by writing again.
  if conv.state = 'request' and conv.requested_by = me
     and ((conv.user_a = p_to and conv.left_a is not null) or (conv.user_b = p_to and conv.left_b is not null)) then
    raise exception 'refused' using errcode = 'P0001';
  end if;
  -- A first message from a stranger is text only (spec 10.2 #5): no photo and no link into a
  -- request - an existing one, or the one this message would open (the recipient does not follow back).
  into_request := (conv.id is null and not (select private.is_following(p_to, me))) or conv.state = 'request';
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
  -- A new message brings the thread back for someone who had left it (066).
  update public.conversations set last_message_at = now(), left_a = null, left_b = null where id = conv.id;
  return msg_id;
end $$;
revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

-- 5. A set that stops being visible closes the polls that offer it.
create or replace function private.sets_close_polls() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.deleted_at is not null and old.deleted_at is null)
     or (new.takedown_state <> 'none' and old.takedown_state = 'none')
     or (new.visibility not in ('public', 'link') and old.visibility in ('public', 'link')) then
    update public.polls p set closed_at = now()
     where p.closed_at is null
       and exists (select 1 from public.poll_options o where o.poll_id = p.id and o.set_id = new.id);
  end if;
  return new;
end $$;
revoke all on function private.sets_close_polls() from public;
create trigger sets_close_polls after update of deleted_at, takedown_state, visibility on public.sets
  for each row execute function private.sets_close_polls();

-- 6. The share page learns when the set last changed.
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
    'layout', s.layout,
    'visibility', s.visibility,
    'published_at', s.published_at,
    'updated_at', s.updated_at,
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

-- 7. The description is screened like the caption (the same P0006 the screens already know).
create or replace function private.sets_screen_description() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if coalesce(new.description, '') <> '' and (tg_op = 'INSERT' or new.description is distinct from old.description)
     and public.text_verdict(new.description, 'caption') = 'refuse' then
    raise exception 'no phone numbers or addresses' using errcode = 'P0006';
  end if;
  return new;
end $$;
revoke all on function private.sets_screen_description() from public;
create trigger sets_screen_description before insert or update of description on public.sets
  for each row execute function private.sets_screen_description();
