-- 091 · The song card (spec 11 #12; design pack G1): "the vibe" on a set - a title, an artist
-- and a cover that open the song in Spotify, Apple Music or YouTube Music. No audio ever plays
-- in the app, nothing is uploaded, and the four columns have sat on `sets` since 017 waiting for
-- a screen. What the database adds now:
--
-- 1. A song link is one of the three services, over https, and nothing else - the share page
--    draws it for strangers, so a set must never carry a link to just anywhere.
-- 2. A cover comes only from those services' picture hosts: a stranger's browser fetches it
--    straight from there, and an address on somebody's own server would be a tracking pixel on
--    every viewer of the set.
-- 3. The title and the artist are short, screened like a caption (no phone numbers or
--    addresses; the word list; the outside check), and a song is whole or absent.
-- 4. `shared_set` carries the song for the share page and the embed.
--
-- Replaced from their latest definitions (L31): sets_screen (068), sets_queue_check (071),
-- shared_set (090).

alter table public.sets add constraint sets_song_url_service
  check (song_url is null or song_url ~ '^https://(open\.spotify\.com|music\.apple\.com|music\.youtube\.com|www\.youtube\.com|youtube\.com|youtu\.be)/');
alter table public.sets add constraint sets_song_cover_host
  check (song_cover_url is null or song_cover_url ~ '^https://(i\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com|is[0-9]+-ssl\.mzstatic\.com|i[0-9]*\.ytimg\.com|img\.youtube\.com)/');
alter table public.sets add constraint sets_song_text_length
  check (char_length(coalesce(song_title, '')) <= 120 and char_length(coalesce(song_artist, '')) <= 120
         and char_length(coalesce(song_url, '')) <= 500 and char_length(coalesce(song_cover_url, '')) <= 500);
alter table public.sets add constraint sets_song_whole
  check (song_url is not null or (song_title is null and song_artist is null and song_cover_url is null));

-- The caption screen (068), plus the song's words.
create or replace function private.sets_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', ''); v text; ref text;
        song text := btrim(coalesce(new.song_title, '') || ' ' || coalesce(new.song_artist, ''));
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if song <> '' and (tg_op = 'INSERT' or song <> btrim(coalesce(old.song_title, '') || ' ' || coalesce(old.song_artist, '')))
     and public.text_verdict(song, 'caption') = 'refuse' then
    raise exception 'no phone numbers or addresses' using errcode = 'P0006';
  end if;
  if tg_op = 'UPDATE' and cap = coalesce(old.layout ->> 'caption', '') then return new; end if;
  v := public.text_verdict(cap, 'caption');
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

-- The outside text check (071), plus the song's words, queued as a caption of the set.
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
  return new;
end $$;

-- The share page and the embed carry the song (the latest shared_set, from 090, plus one field).
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
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name, 'label', p.label),
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
