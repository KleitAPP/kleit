-- 118 · CL72's leftovers that are the database's (2026-10-19, evening): review time limits
-- (spec 13.4 #2), a decoration asset of our own pulled and fingerprinted (13.3 #6), and a store
-- subdomain matched to its network (16.1 #9). Replaces: affiliate_for() from 116 and
-- shared_set() from 104 (each from its latest text - L31).
--
-- 1. Review time limits (13.4 #2, "reviewer protection ... review time limits"). A sitting is
--    the chain of a moderator's decisions with no gap longer than fifteen minutes; once a sitting
--    is two hours old, the next decision is refused (P0009, "take a break") until fifteen minutes
--    have passed since the last one - at which point the chain is broken and a new sitting
--    starts. Every decision ends in a row in moderation_actions, so the check is one BEFORE
--    INSERT trigger there rather than a line in each of the five deciding functions; rows the
--    server writes in its own name (moderator_id null) and server-side writes (kleit.server_write)
--    are not a person's sitting. review_sitting() tells the screen where the person stands.
-- 2. A Kleit decoration pulled (13.3 #6): an admin names the catalogue id, the asset's
--    fingerprints and why; the ids go in pulled_library_assets (read by the drawer, the share
--    page and the chat picture, which all skip them), the fingerprints into
--    removed_image_fingerprints like any removed picture's (so it cannot come back as a photo),
--    and every set that placed it loses its cached chat picture until its next save. The files
--    themselves leave the site at the next deploy; this is the switch that works within minutes.
-- 3. affiliate_for('shop.zara.com') finds the row for 'zara.com': the longest listed domain
--    that is the host or one of its parents, in one query (buy-redirect asked once per parent).

-- ---------------------------------------------------------------------------
-- 1. Review time limits
-- ---------------------------------------------------------------------------
create index moderation_actions_moderator_idx on public.moderation_actions (moderator_id, created_at desc);

-- The sitting one person is in at a moment: the chain of their decisions ending within fifteen
-- minutes of it, with no gap longer than fifteen minutes. No row when they are not in one.
create or replace function private.review_sitting(p_who uuid, p_at timestamptz)
returns table (started_at timestamptz, latest_at timestamptz, decisions bigint)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select m.created_at
      from public.moderation_actions m
     where m.moderator_id = p_who and m.created_at <= p_at and m.created_at > p_at - interval '12 hours'
  ), gaps as (
    select created_at, created_at - lag(created_at) over (order by created_at) as gap from mine
  ), numbered as (
    select created_at,
           sum(case when gap is null or gap > interval '15 minutes' then 1 else 0 end) over (order by created_at) as sitting
      from gaps
  )
  select min(created_at), max(created_at), count(*)
    from numbered
   where sitting = (select max(sitting) from numbered)
  having max(created_at) > p_at - interval '15 minutes';
$$;
revoke all on function private.review_sitting(uuid, timestamptz) from public;

create or replace function private.moderation_actions_rest_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if new.moderator_id is null or coalesce(current_setting('kleit.server_write', true), '') = '1' then return new; end if;
  select * into s from private.review_sitting(new.moderator_id, new.created_at);
  if s.started_at is not null and new.created_at - s.started_at >= interval '2 hours' then
    raise exception 'take a break: reviewing since %', to_char(s.started_at at time zone 'UTC', 'HH24:MI') using errcode = 'P0009';
  end if;
  return new;
end $$;
create trigger moderation_actions_rested before insert on public.moderation_actions
  for each row execute function private.moderation_actions_rest_check();

-- Where the signed-in moderator stands: the sitting, and when the queue opens again if it is
-- closed to them. No row when they are not in a sitting.
create or replace function public.review_sitting()
returns table (started_at timestamptz, latest_at timestamptz, decisions bigint, break_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.started_at, s.latest_at, s.decisions,
         case when now() - s.started_at >= interval '2 hours' then s.latest_at + interval '15 minutes' end
    from private.review_sitting(auth.uid(), now()) s
   where (select private.is_moderator());
$$;
revoke all on function public.review_sitting() from public;
grant execute on function public.review_sitting() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A decoration of our own, pulled
-- ---------------------------------------------------------------------------
create table public.pulled_library_assets (
  asset_id text primary key constraint pulled_asset_shape check (asset_id ~ '^[A-Za-z0-9_.-]{1,120}$'),
  reason text not null constraint pulled_asset_reason_length check (char_length(reason) between 1 and 300),
  pulled_by uuid references auth.users (id) on delete set null,
  pulled_at timestamptz not null default now()
);
alter table public.pulled_library_assets enable row level security;
revoke insert, update, delete, truncate on table public.pulled_library_assets from anon, authenticated;
-- Our own catalogue ids, which ship inside the app: public information about pictures, not people.
create policy "pulled_library_assets: anyone reads" on public.pulled_library_assets for select to anon, authenticated using (true);

alter table public.admin_audit_log drop constraint admin_audit_what;
alter table public.admin_audit_log add constraint admin_audit_what
  check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban', 'private_view', 'contest', 'feature', 'invite', 'label', 'network', 'library'));

-- The ids the drawer, the share page and the chat picture skip.
create or replace function public.pulled_library_assets()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.asset_id order by a.asset_id), '{}') from public.pulled_library_assets a;
$$;
revoke all on function public.pulled_library_assets() from public;
grant execute on function public.pulled_library_assets() to anon, authenticated;

-- Pull one: listed, fingerprinted, logged; the sets that placed it lose their cached chat
-- picture (drawn again on their next save, without it). Returns how many sets that was.
create or replace function public.pull_library_asset(p_asset text, p_hashes text[], p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare h text; n integer; was text;
begin
  perform private.require_admin();
  if p_asset is null or p_asset !~ '^[A-Za-z0-9_.-]{1,120}$' then raise exception 'unknown asset' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  insert into public.pulled_library_assets (asset_id, reason, pulled_by)
  values (p_asset, left(btrim(p_reason), 300), auth.uid())
  on conflict (asset_id) do update set reason = excluded.reason, pulled_by = excluded.pulled_by, pulled_at = now();
  foreach h in array coalesce(p_hashes, '{}') loop
    if h ~ '^[0-9a-f]{16}$' then
      insert into public.removed_image_fingerprints (image_hash, reason) values (h, 'library:' || p_asset) on conflict do nothing;
    end if;
  end loop;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.sets s set preview_image_id = null
   where s.preview_image_id is not null
     and (s.layout ->> 'backgroundAsset' = p_asset
          or exists (select 1 from jsonb_each(coalesce(s.layout -> 'decor', '{}'::jsonb)) d where d.value ->> 'asset' = p_asset));
  get diagnostics n = row_count;
  perform set_config('kleit.server_write', was, true);
  perform private.admin_note('library', null, 'pulled ' || p_asset || ': ' || left(btrim(p_reason), 200));
  return n;
end $$;
revoke all on function public.pull_library_asset(text, text[], text) from public;
grant execute on function public.pull_library_asset(text, text[], text) to authenticated;

-- Put one back (a wrong id, a claim that fell through): the listing and its fingerprints go.
create or replace function public.restore_library_asset(p_asset text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from public.pulled_library_assets where asset_id = p_asset;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.removed_image_fingerprints where reason = 'library:' || p_asset;
  perform private.admin_note('library', null, 'put back ' || p_asset);
end $$;
revoke all on function public.restore_library_asset(text) from public;
grant execute on function public.restore_library_asset(text) to authenticated;

-- The share page's one read carries the pulled ids, so the Worker and the chat picture skip
-- them without a second question. Everything else is 104's text.
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
                                'photo', case when (select public.piece_is_shareable(p.avatar_item_id)) then p.avatar_item_id end,
                                'set_count', (select count(*) from public.sets o
                                              where o.owner_id = p.user_id and o.status = 'published' and o.visibility = 'public'
                                                and o.deleted_at is null and o.takedown_state = 'none')),
    'song', case when s.song_url is not null then jsonb_build_object(
              'url', s.song_url, 'title', s.song_title, 'artist', s.song_artist, 'cover', s.song_cover_url) end,
    'pulled', (select coalesce(jsonb_agg(a.asset_id order by a.asset_id), '[]'::jsonb) from public.pulled_library_assets a),
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

-- ---------------------------------------------------------------------------
-- 3. A store's subdomain finds the store's network
-- ---------------------------------------------------------------------------
create or replace function public.affiliate_for(p_domain text)
returns table (network text, link_template text)
language sql stable security definer set search_path = '' as $$
  with host as (
    select case when lower(p_domain) like 'www.%' then substr(lower(p_domain), 5) else lower(p_domain) end as h
  )
  select n.network, n.link_template
    from public.affiliate_networks n, host
   where n.enabled and (host.h = n.domain or host.h like '%.' || n.domain)
   order by length(n.domain) desc
   limit 1;
$$;
revoke all on function public.affiliate_for(text) from public, anon, authenticated;
grant execute on function public.affiliate_for(text) to service_role;
