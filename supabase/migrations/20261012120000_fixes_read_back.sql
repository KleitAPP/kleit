-- 098 · The read of the day's own fixes (2026-10-12; L32 again, this time of 095–097 and the
-- function changes): four small corrections, each function its latest text plus one change.
--  1. The share page's Buy matches the door: `buy-redirect` answers only for a cleared store
--     piece whose page is not gone, so `shared_set` says `buyable` only then (092's text).
--  2. The tag guard checked who may see the set before the policy checked whose set it was, so a
--     stranger could read from the error code whether some person follows some owner. The guard
--     now steps aside on a set that is not the tagger's own and lets the policy refuse (42501).
--  3. A tag remembers when its person was told (`set_tags.told_at`): the notification row was
--     the only memory, and the person can delete it - after which every visibility toggle told
--     them again.
--  4. `revoke truncate` (095) covered the tables that existed; the platform's default grant would
--     have given it back to every table created after. The default changes too.

-- 1.
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

-- 2.
create or replace function private.set_tags_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_setting text;
begin
  if tg_op = 'INSERT' then
    -- Not the tagger's own set: nothing is checked here, the policy refuses (42501), and the
    -- answer says nothing about who may see what.
    if (select auth.uid()) is not null and not (select private.owns_set(new.set_id)) then return new; end if;
    -- A blocked pair never tags (the policy's answer, given first so its code stays the same).
    if (select private.blocked_either_way(new.tagged_by, new.user_id)) then
      raise exception 'a blocked pair never tags' using errcode = '42501';
    end if;
    -- On a published set, only someone who can open it; a draft's tags wait for the publish.
    if exists (select 1 from public.sets s where s.id = new.set_id and s.status = 'published')
       and not (select public.can_view_set(new.set_id, new.user_id)) then
      raise exception 'they cannot see this set' using errcode = 'P0011';
    end if;
    select p.mention_setting into v_setting from public.profiles p where p.user_id = new.user_id;
    new.state := case
      when v_setting = 'everyone' then 'approved'
      when (select private.is_following(new.user_id, new.tagged_by)) then 'approved'
      else 'pending' end;
    -- When the person was told is the server's to write (098).
    if (select auth.uid()) is not null and current_setting('kleit.server_write', true) is distinct from '1' then
      new.told_at := null;
    end if;
    return new;
  end if;
  if new.set_id <> old.set_id or new.user_id <> old.user_id or new.tagged_by <> old.tagged_by then
    raise exception 'a tag is approved or removed, never moved' using errcode = '42501';
  end if;
  return new;
end $$;

-- 3.
alter table public.set_tags add column told_at timestamptz;
comment on column public.set_tags.told_at is 'When the tagged person was told of this tag (migration 098); null until the set is one they can see.';

create or replace function private.tell_tagged(p_set uuid, p_user uuid, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if exists (select 1 from public.set_tags t where t.set_id = p_set and t.user_id = p_user and t.told_at is not null) then return; end if;
  if not exists (select 1 from public.sets s where s.id = p_set and s.status = 'published') then return; end if;
  if not (select public.can_view_set(p_set, p_user)) then return; end if;
  if exists (select 1 from public.profiles p where p.user_id = p_user and (p.banned_at is not null or p.deactivated_at is not null)) then return; end if;
  -- The stamp is written through the server door: this runs inside the tagger's own request.
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.set_tags set told_at = now() where set_id = p_set and user_id = p_user;
  perform set_config('kleit.server_write', was, true);
  if exists (select 1 from public.notifications n where n.user_id = p_user and n.kind = 'tag' and n.ref_id = p_set) then return; end if;
  perform private.notify(p_user, 'tag', p_by, 'set', p_set, false);
end $$;

-- The guard that keeps a tag from moving also keeps its stamp the server's.
create or replace function private.set_tags_told_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and current_setting('kleit.server_write', true) is distinct from '1'
     and new.told_at is distinct from old.told_at then
    raise exception 'told_at is the server''s' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists set_tags_told_guard on public.set_tags;
create trigger set_tags_told_guard before update on public.set_tags for each row execute function private.set_tags_told_guard();

-- 4.
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
