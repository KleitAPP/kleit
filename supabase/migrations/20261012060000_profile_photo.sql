-- 092 · The profile photo (spec 3.5 "username, display name, profile photo, bio"; design pack S12;
-- spec 13.1 #1 "every uploaded image stays hidden until scanned"). The `avatars` bucket from 011
-- was public and writable by its owner, with nothing screening what went in - which no screen
-- used, and which spec 13.1 forbids. So a profile photo is now what every other photo on Kleit
-- is: an `items` row of kind `own` in the person's own `closet-photos` folder (under
-- `<me>/avatar/`), screened by `ingest-image`, with no closet row. The profile points at it
-- (`avatar_item_id`, set only through `set_profile_photo()`), and the picture is served by the
-- same gate as every other picture (`item-image` → `piece_is_shareable`): a cleared photo that
-- is somebody's current profile photo, on an account that is not hidden. Unscanned stays
-- invisible; a replaced or removed photo goes into the bin and the nightly purge takes the file.
--
-- `avatar_url` is kept but is the server's now, shaped to our own public bucket: a member could
-- otherwise point every feed card at an address of their own (a tracking pixel). The bucket's
-- own-folder writes go; nothing used them.
--
-- Replaced from their latest definitions (L31): profiles_points_guard and profiles_insert_guard
-- (090), piece_is_shareable (023).

alter table public.profiles add column avatar_item_id uuid references public.items (id) on delete set null;
alter table public.profiles add constraint profiles_avatar_url_shape
  check (avatar_url is null or avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/');
create index profiles_avatar_item_idx on public.profiles (avatar_item_id) where avatar_item_id is not null;

create or replace function private.profiles_points_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.points is distinct from old.points or new.banned_at is distinct from old.banned_at
     or new.label is distinct from old.label
     or new.avatar_url is distinct from old.avatar_url
     or new.avatar_item_id is distinct from old.avatar_item_id then
    raise exception 'points, bans, labels and the profile photo are written by the server only' using errcode = '42501';
  end if;
  if old.deactivated_at is not null and new.deactivated_at is null
     and exists (select 1 from public.account_deletions d where d.user_id = old.user_id and d.state = 'pending') then
    raise exception 'deletion pending: undo it first' using errcode = 'P0005';
  end if;
  return new;
end $$;

create or replace function private.profiles_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.points <> 0 or new.banned_at is not null or new.label <> 'none'
     or new.avatar_url is not null or new.avatar_item_id is not null then
    raise exception 'points, bans, labels and the profile photo are written by the server only' using errcode = '42501';
  end if;
  return new;
end $$;

-- The door. A photo of your own, in your own avatar folder, not deleted or taken down; null takes
-- the photo off. The one it replaces goes into the bin (30 days, then the purge takes the file).
create or replace function public.set_profile_photo(p_item uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v_old uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_item is not null and not exists (
       select 1 from public.items i
       where i.id = p_item and i.owner_id = me and i.kind = 'own' and i.image_bucket = 'closet-photos'
         and i.image_id like me::text || '/avatar/%' and i.deleted_at is null and i.takedown_state = 'none') then
    raise exception 'not a profile photo of yours' using errcode = 'P0010';
  end if;
  select p.avatar_item_id into v_old from public.profiles p where p.user_id = me;
  if v_old is not distinct from p_item then return true; end if;
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set avatar_item_id = p_item where user_id = me;
  if v_old is not null then
    update public.items set deleted_at = now() where id = v_old and owner_id = me and deleted_at is null;
  end if;
  perform set_config('kleit.server_write', '0', true);
  return true;
end $$;
revoke all on function public.set_profile_photo(uuid) from public, anon;
grant execute on function public.set_profile_photo(uuid) to authenticated;

-- The gate (023), plus: a cleared photo that is somebody's current profile photo, on an account
-- that is not hidden, is for everyone - that is what a profile photo is.
create or replace function public.piece_is_shareable(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id and i.deleted_at is null and i.takedown_state = 'none'
      and (select private.image_cleared(i.id))
      and (
        i.kind = 'product'
        or exists (
          select 1 from public.profiles p
          where p.avatar_item_id = i.id and p.user_id = i.owner_id
            and p.banned_at is null and p.deactivated_at is null
        )
        or ((select private.closet_says_shareable(i.id)) and (
          exists (
            select 1 from public.set_items si join public.sets s on s.id = si.set_id
            where si.item_id = i.id and s.status = 'published' and s.deleted_at is null
              and s.takedown_state = 'none' and s.visibility in ('public', 'link')
          )
          or exists (
            select 1 from public.set_items si
            join public.poll_options o on o.set_id = si.set_id
            join public.polls p on p.id = o.poll_id
            where si.item_id = i.id and p.deleted_at is null and p.takedown_state = 'none'
          )
        ))
      )
  );
$$;

-- The share page names the creator and shows their photo (design pack §9 #2): the item id, which
-- the page turns into the gate's address like every other picture (the latest shared_set, 091).
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
        'buyable', i.kind = 'product' and i.source_url is not null,
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

-- The bucket: reads stay public for whatever is there (nothing is), writes are the server's.
drop policy if exists "avatars: own folder writes" on storage.objects;
drop policy if exists "avatars: own folder updates" on storage.objects;
drop policy if exists "avatars: own folder deletes" on storage.objects;
