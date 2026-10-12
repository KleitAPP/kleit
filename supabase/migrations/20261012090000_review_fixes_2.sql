-- 095 · The third review, 2026-10-12: migrations 073–094 read by someone who did not write them
-- (L32), seven findings, one batch (L34). Each function below is its latest version (L31) plus
-- the one change:
--  1. A profile is made through claim_profile only. The first policy ("owner creates own row",
--     001) let the app write the row by hand and skip every sign-up rule - the switch, banned
--     identities, the invite, the username rules, the 18+ record. claim_profile opens the server
--     door around its own insert; nobody else has one.
--  2. A challenge entry never arrives already picked (picked_at is 084's door, the admins').
--  3. By hand a member adds pieces of their own only. A store piece (kind, source, price, store)
--     is clipped by the server: a row written by hand pointed Buy and the price watch anywhere.
--     The same columns are the server's on the way out.
--  4. A set published on the way in follows the posting switch and is stamped by the server;
--     published_at is the server's on the way out too, because it orders every feed (a null or
--     a far-future stamp sat on top for ever).
--  5. Tags: a person is told once per set, once they can see it (a tag on a draft tells them
--     when it is published or opened up), never while banned; a tag on a published set they
--     cannot see is refused (P0011). Mentions tell only people who can see the set.
--  6. A claimed push is unstuck ten minutes after it was CLAIMED, not after it was made (quiet
--     hours hold a row for hours, so a live sender's claim was undone and the push sent twice);
--     three dead claims mark it failed instead of leaving it claimed for ever.
--  7. A song link is the song's own address only (YouTube's /redirect?q= fitted the old shape);
--     a pick needs a set that is still public; no table lets a member truncate it.
-- Replaced from their latest definitions: claim_profile (087), profiles_insert_guard (092),
-- items_member_guard (069), sets_insert_guard (079), sets_guard (080), set_tags_guard and
-- notify_tag (085), notify_mentions (084), claim_pushes and unstick_pushes (073),
-- pick_contest_entry (084), the "owner tags" policy (085), sets_song_url_service (091).

-- ---------------------------------------------------------------------------
-- 1. Profiles: one door.
-- ---------------------------------------------------------------------------
drop policy "profiles: owner creates own row" on public.profiles;

create or replace function private.profiles_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  raise exception 'a profile is made through claim_profile' using errcode = '42501';
end $$;

create or replace function public.claim_profile(p_username text, p_display_name text default '', p_terms_version text default 'v0.1', p_invite text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  fresh public.profiles;
  v_code text := upper(btrim(coalesce(p_invite, '')));
  v_beta boolean := public.beta_only();
  was text;
begin
  if me is null then
    raise exception 'claim_profile: sign in first' using errcode = '42501';
  end if;
  if coalesce((select s.value::text from public.app_settings s where s.key = 'signups_open'), 'true') <> 'true' then
    raise exception 'claim_profile: sign-ups are closed right now' using errcode = 'P0004';
  end if;
  if (select private.is_banned_identity(me)) then
    raise exception 'claim_profile: this account cannot be opened' using errcode = 'P0007';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = me) then
    raise exception 'claim_profile: this account already has a profile' using errcode = '23505';
  end if;
  if v_beta and v_code = '' then
    raise exception 'claim_profile: an invite is needed right now' using errcode = 'P0008';
  end if;
  if v_beta and not private.invite_is_live(v_code) then
    raise exception 'claim_profile: that invite is not valid' using errcode = 'P0009';
  end if;
  if not public.username_available(p_username) then
    raise exception 'claim_profile: that username is not available' using errcode = '23514';
  end if;
  -- The server door, open for this one insert only, then put back as it was.
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  insert into public.profiles (user_id, username, display_name, age_confirmed_at, terms_version)
  values (me, p_username, coalesce(left(p_display_name, 50), ''), now(), p_terms_version)
  returning * into fresh;
  perform set_config('kleit.server_write', was, true);
  insert into public.age_confirmations (user_id_hash, terms_version)
  values (encode(sha256(me::text::bytea), 'hex'), p_terms_version);
  if v_beta then
    update public.beta_invites set uses_left = uses_left - 1 where code = v_code;
    insert into public.beta_invite_uses (code, user_id) values (v_code, me);
  end if;
  return fresh;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A challenge entry arrives unpicked.
-- ---------------------------------------------------------------------------
create or replace function private.contest_entries_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.picked_at is not null then
    raise exception 'a pick is made by an admin through pick_contest_entry' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists contest_entries_insert_guard on public.contest_entries;
create trigger contest_entries_insert_guard before insert on public.contest_entries
  for each row execute function private.contest_entries_insert_guard();

-- ---------------------------------------------------------------------------
-- 3. Pieces: by hand, your own only; a store piece and its facts are the server's.
-- ---------------------------------------------------------------------------
create or replace function private.items_member_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin()) or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.takedown_state <> 'none' or new.purged_at is not null or new.image_hash is not null or new.deleted_at is not null then
      raise exception 'takedown_state, purged_at, image_hash and deleted_at are the server''s' using errcode = '42501';
    end if;
    if new.kind <> 'own' or new.source_url is not null or new.source_domain is not null
       or new.price_cents is not null or new.price_currency is not null or new.price_checked_at is not null
       or new.store_name is not null or new.sold_out then
      raise exception 'a store piece is clipped by the server; by hand you add pieces of your own' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and (
       new.kind is distinct from old.kind
       or new.price_cents is distinct from old.price_cents
       or new.price_currency is distinct from old.price_currency
       or new.price_checked_at is distinct from old.price_checked_at
       or new.store_name is distinct from old.store_name
       or new.source_domain is distinct from old.source_domain
       or new.sold_out is distinct from old.sold_out) then
    raise exception 'kind, price, store and source are set by the server only' using errcode = '42501';
  end if;
  if new.image_id is not null and (tg_op = 'INSERT' or new.image_id is distinct from old.image_id or new.image_bucket is distinct from old.image_bucket) then
    if new.image_bucket <> 'closet-photos' or not (select private.owns_storage_folder(new.image_id)) then
      raise exception 'a picture of your own lives in your own folder' using errcode = '42501';
    end if;
    -- One row per stored file: a second row on the same file would shield the first from the purge.
    if exists (select 1 from public.items o where o.id <> new.id and o.image_bucket = new.image_bucket and o.image_id = new.image_id) then
      raise exception 'that file already has a row' using errcode = '42501';
    end if;
  end if;
  -- Once a row has a file, a member never changes or clears the path (a change would orphan it).
  if tg_op = 'UPDATE' and old.image_id is not null and new.image_id is distinct from old.image_id then
    raise exception 'the picture of a piece is set once' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Sets: published_at is the server's stamp, on the way in and out.
-- ---------------------------------------------------------------------------
create or replace function private.sets_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.remixed_from_set_id is not null or new.remixed_from_label is not null
     or new.featured_at is not null or new.takedown_state <> 'none' then
    raise exception 'the remix credit, featured_at and takedown_state are set by the server only' using errcode = '42501';
  end if;
  if new.status = 'published' then
    if coalesce((select s.value::text from public.app_settings s where s.key = 'posting_open'), 'true') <> 'true' then
      raise exception 'posting is paused right now' using errcode = 'P0004';
    end if;
    new.published_at := now();
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

create or replace function private.sets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.takedown_state is distinct from old.takedown_state
     or new.share_code is distinct from old.share_code
     or new.featured_at is distinct from old.featured_at
     or new.remixed_from_set_id is distinct from old.remixed_from_set_id
     or new.remixed_from_label is distinct from old.remixed_from_label then
    raise exception 'owner_id, takedown_state, share_code, featured_at and the remix credit are set by the server only';
  end if;
  if new.published_at is distinct from old.published_at and not (new.status = 'published' and old.status = 'draft') then
    raise exception 'published_at is stamped by the server' using errcode = '42501';
  end if;
  if new.status = 'published' and old.status = 'draft' then
    if coalesce((select s.value::text from public.app_settings s where s.key = 'posting_open'), 'true') <> 'true' then
      raise exception 'posting is paused right now' using errcode = 'P0004';
    end if;
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tags and mentions tell people who can see the set, once.
-- ---------------------------------------------------------------------------
drop policy "set_tags: owner tags" on public.set_tags;
create policy "set_tags: owner tags" on public.set_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and (select private.owns_set(set_id))
    and user_id <> (select auth.uid())
    and not (select private.blocked_either_way((select auth.uid()), user_id))
    and exists (select 1 from public.profiles p
                 where p.user_id = set_tags.user_id and p.deactivated_at is null and p.banned_at is null
                   and p.mention_setting <> 'nobody')
    and (select count(*) from public.set_tags t where t.set_id = set_tags.set_id) < 10
  );

create or replace function private.set_tags_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_setting text;
begin
  if tg_op = 'INSERT' then
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
    return new;
  end if;
  if new.set_id <> old.set_id or new.user_id <> old.user_id or new.tagged_by <> old.tagged_by then
    raise exception 'a tag is approved or removed, never moved' using errcode = '42501';
  end if;
  return new;
end $$;

-- Tell a tagged person once: when the set is published, they can see it, and they have not been
-- told of this set before (a tag taken off and put back is not news).
create or replace function private.tell_tagged(p_set uuid, p_user uuid, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.sets s where s.id = p_set and s.status = 'published') then return; end if;
  if not (select public.can_view_set(p_set, p_user)) then return; end if;
  if exists (select 1 from public.profiles p where p.user_id = p_user and (p.banned_at is not null or p.deactivated_at is not null)) then return; end if;
  if exists (select 1 from public.notifications n where n.user_id = p_user and n.kind = 'tag' and n.ref_id = p_set) then return; end if;
  perform private.notify(p_user, 'tag', p_by, 'set', p_set, false);
end $$;
revoke all on function private.tell_tagged(uuid, uuid, uuid) from public;

create or replace function private.notify_tag() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.tell_tagged(new.set_id, new.user_id, new.tagged_by);
  return new;
end $$;

-- A draft's tags are told when it is published; a set opened up later tells the people who can
-- now see it. tell_tagged keeps it to once each.
create or replace function private.sets_tell_tagged() returns trigger language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if new.status <> 'published' then return new; end if;
  for t in select g.user_id, g.tagged_by from public.set_tags g where g.set_id = new.id loop
    perform private.tell_tagged(new.id, t.user_id, t.tagged_by);
  end loop;
  return new;
end $$;
drop trigger if exists sets_tell_tagged on public.sets;
create trigger sets_tell_tagged after update of status, visibility on public.sets
  for each row execute function private.sets_tell_tagged();

create or replace function private.notify_mentions() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_name text; v_user uuid; v_setting text;
begin
  -- A comment the word list is holding is seen by its author and the moderators only: no @ tells.
  if new.held_at is not null then return new; end if;
  select s.owner_id into v_owner from public.sets s where s.id = new.set_id;
  foreach v_name in array private.mentioned_names(new.body) loop
    select p.user_id, p.mention_setting into v_user, v_setting
      from public.profiles p where lower(p.username) = v_name and p.deactivated_at is null and p.banned_at is null;
    if v_user is null or v_user = new.author_id or v_user = v_owner then continue; end if;
    if v_setting = 'nobody' then continue; end if;
    if v_setting = 'following' and not (select private.is_following(v_user, new.author_id)) then continue; end if;
    -- Only someone who can open the set: the Inbox points at it.
    if not (select public.can_view_set(new.set_id, v_user)) then continue; end if;
    -- notify() itself drops a pair that is blocked either way.
    perform private.notify(v_user, 'mention', new.author_id, 'set', new.set_id, false);
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Push: unstick from the claim, not the making.
-- ---------------------------------------------------------------------------
alter table public.push_queue add column claimed_at timestamptz;
comment on column public.push_queue.claimed_at is 'When the sender last claimed the row (migration 095); the unstick timer runs from here.';

create or replace function public.claim_pushes(p_limit integer default 100)
returns table (id bigint, user_id uuid, kind text, ref_type text, ref_id uuid, bundled_count integer, actor_username text, due_at timestamptz)
language sql security definer set search_path = '' as $$
  with picked as (
    select q.id from public.push_queue q
     where q.state = 'pending' and q.due_at <= now() and q.attempts < 3
     order by q.due_at limit greatest(1, least(p_limit, 500))
     for update skip locked
  ), claimed as (
    update public.push_queue q set state = 'claimed', attempts = q.attempts + 1, claimed_at = now()
      from picked where q.id = picked.id
    returning q.id, q.user_id, q.kind, q.ref_type, q.ref_id, q.notification_id, q.due_at
  )
  select c.id, c.user_id, c.kind, c.ref_type, c.ref_id,
         coalesce((select n.bundled_count from public.notifications n where n.id = c.notification_id), 1),
         (select p.username from public.profiles p where p.user_id = (select n.actor_id from public.notifications n where n.id = c.notification_id)),
         c.due_at
    from claimed c;
$$;

create or replace function private.unstick_pushes() returns integer language sql security definer set search_path = '' as $$
  with back as (
    update public.push_queue
       set state = case when attempts < 3 then 'pending' else 'failed' end
     where state = 'claimed' and coalesce(claimed_at, created_at) < now() - interval '10 minutes'
    returning 1
  ) select count(*)::int from back;
$$;

-- ---------------------------------------------------------------------------
-- 7. Three small ones.
-- ---------------------------------------------------------------------------
-- A song link is the song's own address: the same shape the reader (song-page.ts) keeps to, so
-- a link that passes the reader fits here and nothing else does. A link that no longer fits
-- (none was expected) is taken off rather than left to fail the constraint.
update public.sets
   set song_url = null, song_title = null, song_artist = null, song_cover_url = null
 where song_url is not null
   and song_url !~ '^https://(open\.spotify\.com/(intl-[a-z]+(-[a-z]+)?/)?(track|album|playlist|episode|show|artist)/[A-Za-z0-9]{8,40}|music\.apple\.com/[a-z]{2}/(album|song|playlist|music-video|artist)/[A-Za-z0-9._%-]*/?[A-Za-z0-9.-]+(\?i=[0-9]+)?|(www|music)\.youtube\.com/watch\?v=[A-Za-z0-9_-]{6,20})$';
alter table public.sets drop constraint sets_song_url_service;
alter table public.sets add constraint sets_song_url_service
  check (song_url is null or song_url ~ '^https://(open\.spotify\.com/(intl-[a-z]+(-[a-z]+)?/)?(track|album|playlist|episode|show|artist)/[A-Za-z0-9]{8,40}|music\.apple\.com/[a-z]{2}/(album|song|playlist|music-video|artist)/[A-Za-z0-9._%-]*/?[A-Za-z0-9.-]+(\?i=[0-9]+)?|(www|music)\.youtube\.com/watch\?v=[A-Za-z0-9_-]{6,20})$');

-- A pick needs a set that is still public (it goes on Home's Featured).
create or replace function public.pick_contest_entry(p_contest uuid, p_set uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e public.contest_entries%rowtype; was text;
begin
  perform private.require_admin();
  if exists (select 1 from public.contests c where c.id = p_contest and now() < c.closes_at) then
    raise exception 'judge once it has closed' using errcode = 'P0001';
  end if;
  select * into e from public.contest_entries x where x.contest_id = p_contest and x.set_id = p_set;
  if e.set_id is null then return false; end if;
  if p_on and not exists (
       select 1 from public.sets s
       where s.id = p_set and s.status = 'published' and s.visibility = 'public'
         and s.deleted_at is null and s.takedown_state = 'none') then
    raise exception 'that set is no longer public' using errcode = 'P0002';
  end if;
  update public.contest_entries set picked_at = case when p_on then coalesce(picked_at, now()) else null end
   where contest_id = p_contest and set_id = p_set;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.sets set featured_at = case when p_on then coalesce(featured_at, now()) else null end where id = p_set;
  perform set_config('kleit.server_write', was, true);
  if p_on then
    perform private.badge(e.user_id, 'contest_pick');
    if e.picked_at is null then perform private.notify(e.user_id, 'contest_pick', null, 'contest', p_contest, false); end if;
  elsif not exists (select 1 from public.contest_entries x where x.user_id = e.user_id and x.picked_at is not null) then
    delete from public.badges b where b.user_id = e.user_id and b.badge = 'contest_pick';
  end if;
  perform private.admin_note('contest', p_contest, case when p_on then 'picked ' else 'unpicked ' end || p_set::text);
  return true;
end $$;

-- Row Level Security never covers TRUNCATE, and the platform's default grant includes it.
revoke truncate on all tables in schema public from anon, authenticated;
