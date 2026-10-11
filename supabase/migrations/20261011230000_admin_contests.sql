-- 085 · Admin contests (design pack S101; spec 11 #3–#4; spec 4.7 #1.3). Until now the Monday
-- theme opened itself from a queue nobody could fill from the app. This gives admins one screen:
-- the queue of themes (add, reorder, drop), a contest opened or closed by hand, and judging.
-- "Badges and features only" (spec 11 #3): a pick puts the set on Home's Featured, gives its
-- owner the `contest_pick` badge and tells them; it never pays. Admins only; every act lands in
-- the audit log; the weekly timer (043) keeps running with nobody there.
--
-- Replaced from their latest definitions (L31): contest_board (038, the only one).

-- The audit log learns the two new acts, and 'private_view' - which log_private_view has allowed
-- since 072 while the constraint refused it (nothing wrote one; now it may).
alter table public.admin_audit_log drop constraint admin_audit_what;
alter table public.admin_audit_log add constraint admin_audit_what
  check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban', 'private_view', 'contest', 'feature'));

alter table public.badges drop constraint badges_badge_check;
alter table public.badges add constraint badges_badge_check
  check (badge in ('first_set', 'ten_sets', 'style_icon', 'first_contest', 'well_liked', 'followed', 'contest_pick'));

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag',
                  'poll_results', 'contest_pick'));

-- A pick is remembered on the entry, so the board can show it.
alter table public.contest_entries add column picked_at timestamptz;

create or replace function private.require_admin() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then raise exception 'admins only' using errcode = '42501'; end if;
end $$;
revoke all on function private.require_admin() from public;

create or replace function private.admin_note(p_what text, p_target uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), p_what, p_target, left(p_reason, 300));
$$;
revoke all on function private.admin_note(text, uuid, text) from public;

-- 1. The queue. Add to the back; move one step; drop one that has not run.
create or replace function public.queue_contest_theme(p_title text, p_theme text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_admin();
  insert into public.contest_themes (title, theme, position)
  values (btrim(p_title), btrim(coalesce(p_theme, '')), coalesce((select max(t.position) from public.contest_themes t), 0) + 1)
  returning id into v_id;
  perform private.admin_note('contest', v_id, 'queued "' || btrim(p_title) || '"');
  return v_id;
end $$;
revoke all on function public.queue_contest_theme(text, text) from public;
grant execute on function public.queue_contest_theme(text, text) to authenticated;

create or replace function public.drop_contest_theme(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  perform private.require_admin();
  delete from public.contest_themes where id = p_id and used_at is null returning title into v_title;
  if v_title is null then return false; end if;
  perform private.admin_note('contest', p_id, 'dropped "' || v_title || '" from the queue');
  return true;
end $$;
revoke all on function public.drop_contest_theme(uuid) from public;
grant execute on function public.drop_contest_theme(uuid) to authenticated;

-- Swaps positions with the neighbour in the given direction among the themes still waiting.
create or replace function public.move_contest_theme(p_id uuid, p_direction text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me public.contest_themes%rowtype; other public.contest_themes%rowtype;
begin
  perform private.require_admin();
  select * into me from public.contest_themes t where t.id = p_id and t.used_at is null;
  if me.id is null then return false; end if;
  if p_direction = 'up' then
    select * into other from public.contest_themes t where t.used_at is null and t.position < me.position order by t.position desc limit 1;
  elsif p_direction = 'down' then
    select * into other from public.contest_themes t where t.used_at is null and t.position > me.position order by t.position asc limit 1;
  else
    raise exception 'up or down' using errcode = '22023';
  end if;
  if other.id is null then return false; end if;
  update public.contest_themes set position = other.position where id = me.id;
  update public.contest_themes set position = me.position where id = other.id;
  return true;
end $$;
revoke all on function public.move_contest_theme(uuid, text) from public;
grant execute on function public.move_contest_theme(uuid, text) to authenticated;

-- 2. By hand: open the next theme now (nothing happens while one is open, as on a Monday);
--    start one with its own words and length; close the open one early and tell the entrants.
create or replace function public.open_contest_now()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_admin();
  v_id := private.open_weekly_contest();
  if v_id is not null then perform private.admin_note('contest', v_id, 'opened the next theme by hand'); end if;
  return v_id;
end $$;
revoke all on function public.open_contest_now() from public;
grant execute on function public.open_contest_now() to authenticated;

create or replace function public.start_contest(p_title text, p_theme text, p_days integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_admin();
  if p_days is null or p_days < 1 or p_days > 30 then raise exception 'between 1 and 30 days' using errcode = '22023'; end if;
  if exists (select 1 from public.contests c where now() >= c.opens_at and now() < c.closes_at) then
    raise exception 'one challenge at a time' using errcode = 'P0001';
  end if;
  insert into public.contests (title, theme, opens_at, closes_at, created_by)
  values (btrim(p_title), btrim(coalesce(p_theme, '')), now(), now() + make_interval(days => p_days), auth.uid())
  returning id into v_id;
  perform private.admin_note('contest', v_id, 'started "' || btrim(p_title) || '" for ' || p_days || ' days');
  return v_id;
end $$;
revoke all on function public.start_contest(text, text, integer) from public;
grant execute on function public.start_contest(text, text, integer) to authenticated;

create or replace function public.close_contest_now(p_contest uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.contests set closes_at = now() where id = p_contest and now() >= opens_at and now() < closes_at;
  if not found then return false; end if;
  perform private.announce_closed_contests();
  perform private.admin_note('contest', p_contest, 'closed early');
  return true;
end $$;
revoke all on function public.close_contest_now(uuid) from public;
grant execute on function public.close_contest_now(uuid) to authenticated;

-- 3. Judging: a pick on a closed challenge. The set goes on Home's Featured (the server's own
--    column, spec 4.7 #1.3), the entrant gets the badge and is told. Taking a pick back clears
--    the feature and the badge (the badge stays if another pick of theirs stands).
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
revoke all on function public.pick_contest_entry(uuid, uuid, boolean) from public;
grant execute on function public.pick_contest_entry(uuid, uuid, boolean) to authenticated;

-- An editor's pick outside a challenge (S90): any public published set onto Home's Featured, or off it.
create or replace function public.feature_set(p_set uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare was text; v_hit boolean;
begin
  perform private.require_admin();
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.sets set featured_at = case when p_on then coalesce(featured_at, now()) else null end
   where id = p_set and status = 'published' and visibility = 'public' and deleted_at is null and takedown_state = 'none';
  v_hit := found;
  perform set_config('kleit.server_write', was, true);
  if not v_hit then return false; end if;
  perform private.admin_note('feature', p_set, case when p_on then 'featured' else 'unfeatured' end);
  return true;
end $$;
revoke all on function public.feature_set(uuid, boolean) from public;
grant execute on function public.feature_set(uuid, boolean) to authenticated;

-- 4. Reading. The admin's list of every challenge with its counts; the board now says who was picked.
create or replace function public.admin_contests()
returns table (id uuid, title text, theme text, opens_at timestamptz, closes_at timestamptz, entries bigint, picks bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.theme, c.opens_at, c.closes_at,
         (select count(*) from public.contest_entries e where e.contest_id = c.id),
         (select count(*) from public.contest_entries e where e.contest_id = c.id and e.picked_at is not null)
    from public.contests c
   where (select private.is_admin())
   order by c.closes_at desc
   limit 100;
$$;
revoke all on function public.admin_contests() from public;
grant execute on function public.admin_contests() to authenticated;

drop function public.contest_board(uuid);
create function public.contest_board(p_contest uuid)
returns table (set_id uuid, user_id uuid, username text, title text, preview_image_id text, likes bigint, entered_at timestamptz, picked_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select e.set_id, e.user_id, p.username, s.title, s.preview_image_id,
         (select count(*) from public.likes l where l.set_id = e.set_id and l.created_at >= c.opens_at) as likes,
         e.created_at, e.picked_at
    from public.contest_entries e
    join public.contests c on c.id = e.contest_id
    join public.sets s on s.id = e.set_id
    join public.profiles p on p.user_id = e.user_id
   where e.contest_id = p_contest
   order by e.picked_at desc nulls last, likes desc, e.created_at asc
   limit 200;
$$;
revoke all on function public.contest_board(uuid) from public;
grant execute on function public.contest_board(uuid) to authenticated;
