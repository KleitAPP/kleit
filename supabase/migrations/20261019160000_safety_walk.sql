-- 113 · The safety walk (spec 13.1 #3 and #5, 13.2 #1, 13.4 #1, #2, #4 and #9), 2026-10-19.
-- Each function replaced here starts from its latest text (L31): moderate() and decide_appeal()
-- from 069 (20261007180000), moderation_queue() from 068 (20261007170000), feed_featured() from
-- 037, feature_set() from 085, pick_contest_entry() from 100, record_text_check() from 071,
-- push_enqueue() from 078, notify_appeal_decided() from 066. Nothing in 101–112 touched them.
--
-- 1. A photo the scanner sent for "review" waited forever: nothing listed it and nothing could
--    decide it, while the person was told "a person is looking at this one". scan_review_queue()
--    lists them for a moderator and scan_decide() clears or blocks one, logged, and tells the owner.
-- 2. A blocked photo said "you can appeal" with nowhere to do it. An appeal is now on a strike OR
--    on a photo of your own (one per photo, while it is blocked); overturning one clears the flag.
-- 3. An appeal is read by a different person than the one who struck or blocked (13.4 #4).
-- 4. A moderator's removal of a picture fingerprints it like a takedown does, so it cannot come
--    back under another account (13.1 #5), and takes identical copies with it.
-- 5. "Swimwear or underwear" is kept out of Featured and the challenge picks (13.1 #3): a stored
--    flag the scanner already wrote into the labels, read by the feed and refused by the picks.
-- 6. Messages are screened like comments (13.2 #1): the word list at the write and the outside
--    check five minutes later - never held, never refused (a private message is nobody's post),
--    but a flagged one files a report on the conversation with the last ten messages as evidence.
-- 7. An urgent report tells every moderator at once (13.4 #1: "phone alerts"), outside the daily
--    cap and the quiet hours, and the queue says when each report is due (24 h urgent, 72 h else).
-- 8. The queue carries a picture for a reported piece or profile photo, not only a set; the
--    moderator-only `mod-image` function signs it and logs the view (13.4 #2, #9).

-- ---------------------------------------------------------------------------
-- 1. PG-13 (13.1 #3): the flag as a column, so the feed can read it without parsing JSON.
-- ---------------------------------------------------------------------------
alter table public.item_flags add column keep_out_of_featured boolean
  generated always as (case when labels ->> 'keep_out_of_featured' = 'true' then true else false end) stored;
create index item_flags_pg13_idx on public.item_flags (item_id) where keep_out_of_featured;

-- True when no piece on the set was flagged "keep out of featured".
create or replace function private.set_is_pg13(p_set uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.set_items si join public.item_flags f on f.item_id = si.item_id
     where si.set_id = p_set and f.keep_out_of_featured
  );
$$;
revoke all on function private.set_is_pg13(uuid) from public;
grant execute on function private.set_is_pg13(uuid) to authenticated;

create or replace function public.feed_featured(p_offset integer default 0, p_limit integer default 20)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null and s.visibility = 'public'
     and s.preview_image_id is not null
     and s.owner_id <> (select auth.uid())
     and not private.is_muted((select auth.uid()), s.owner_id)
     and private.set_is_pg13(s.id)
   order by s.featured_at desc nulls last,
            ( (select count(*) from public.likes l where l.set_id = s.id and l.created_at > now() - interval '7 days')
            + (select count(*) from public.reactions r where r.set_id = s.id and r.created_at > now() - interval '7 days')
            + 2 * (select count(*) from public.comments c where c.set_id = s.id and c.deleted_at is null and c.created_at > now() - interval '7 days')
            ) desc,
            s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

create or replace function public.feature_set(p_set uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare was text; v_hit boolean;
begin
  perform private.require_admin();
  if p_on and not (select private.set_is_pg13(p_set)) then
    raise exception 'kept out of featured: a piece on it is swimwear or underwear' using errcode = 'P0001';
  end if;
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
  if p_on and not (select private.set_is_pg13(p_set)) then
    raise exception 'kept out of featured: a piece on it is swimwear or underwear' using errcode = 'P0001';
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
revoke all on function public.pick_contest_entry(uuid, uuid, boolean) from public;
grant execute on function public.pick_contest_entry(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. New kinds of notification: the owner of a reviewed photo hears the answer; every moderator
--    hears of an urgent report. Both in-app; the moderator's one is also a push outside the cap.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag',
                  'poll_results', 'contest_pick', 'price_drop', 'reply', 'photo_decided', 'mod_urgent'));

alter table public.moderation_actions drop constraint moderation_actions_action;
alter table public.moderation_actions add constraint moderation_actions_action
  check (action in ('dismiss', 'remove', 'strike', 'ban', 'unban', 'restore', 'overturn', 'uphold', 'scan_clean', 'scan_block'));

create or replace function private.push_enqueue() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_muted text[];
begin
  if coalesce((select s.value::text from public.app_settings s where s.key = 'push_open'), 'false') <> 'true' then return new; end if;
  -- Likes are in-app only (spec 12.1 #2); the strike, report, appeal and photo answers reach people in the app too.
  if new.kind in ('like', 'strike', 'report_resolved', 'appeal_decided', 'photo_decided') then return new; end if;
  select s.muted_kinds into v_muted from public.push_settings s where s.user_id = new.user_id and s.enabled;
  if not found then return new; end if;
  if new.kind = any (v_muted) then return new; end if;
  if (select private.is_hidden_account(new.user_id)) then return new; end if;
  if new.read_at is not null then return new; end if;
  -- A moderator's alert (spec 13.4 #1) goes now: outside the daily cap and the quiet hours, once per report.
  if new.kind = 'mod_urgent' then
    if tg_op = 'INSERT' then
      insert into public.push_queue (user_id, notification_id, kind, ref_type, ref_id, due_at)
      values (new.user_id, new.id, new.kind, new.ref_type, new.ref_id, now());
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.bundled_count <= old.bundled_count then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state in ('pending', 'claimed')) then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state = 'sent' and q.sent_at > now() - interval '1 hour') then return new; end if;
  end if;
  -- The daily limit: twenty a day to one person, counting what is waiting as well as what went.
  if (select count(*) from public.push_queue q
       where q.user_id = new.user_id and q.state in ('pending', 'claimed', 'sent') and q.created_at > now() - interval '24 hours') >= 20 then
    return new;
  end if;
  insert into public.push_queue (user_id, notification_id, kind, ref_type, ref_id, due_at)
  values (new.user_id, new.id, new.kind, new.ref_type, new.ref_id, private.push_due_at(new.user_id));
  return new;
end $$;

-- An urgent report, however it was filed (a person, the word list, the outside check, a message),
-- reaches every moderator and admin the moment its row exists.
create or replace function private.reports_alert_moderators() returns trigger language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.priority <> 'urgent' then return new; end if;
  for m in select distinct u.user_id from public.user_roles u loop
    perform private.notify(m.user_id, 'mod_urgent', null, 'report', new.id, false);
  end loop;
  return new;
end $$;
create trigger reports_alert_moderators after insert on public.reports
  for each row execute function private.reports_alert_moderators();

-- ---------------------------------------------------------------------------
-- 3. The scanner's "review" verdicts, listed and decided (13.1 #3, 13.4 #2).
-- ---------------------------------------------------------------------------
create or replace function public.scan_review_queue()
returns table (item_id uuid, owner_id uuid, owner_username text, title text, kind public.item_kind,
               because jsonb, created_at timestamptz, scanned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.owner_id, p.username, i.title, i.kind, f.labels -> 'because', i.created_at, f.scanned_at
    from public.item_flags f
    join public.items i on i.id = f.item_id
    left join public.profiles p on p.user_id = i.owner_id
   where (select private.is_moderator())
     and f.scan_state = 'review'
     and i.deleted_at is null and i.purged_at is null and i.takedown_state = 'none'
   order by f.scanned_at nulls first, i.created_at
   limit 100;
$$;
revoke all on function public.scan_review_queue() from public;
grant execute on function public.scan_review_queue() to authenticated;

-- Clear or block one. The owner is told either way; a block can be appealed (4 below).
create or replace function public.scan_decide(p_item uuid, p_outcome text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare f public.item_flags%rowtype; o uuid; was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('clean', 'blocked') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into f from public.item_flags where item_id = p_item for update;
  if f.item_id is null or f.scan_state <> 'review' then raise exception 'not_found' using errcode = 'P0002'; end if;
  select i.owner_id into o from public.items i where i.id = p_item;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.item_flags
     set scan_state = p_outcome::public.scan_state,
         labels = labels || jsonb_build_object('decided_by', 'moderator', 'decided_at', now()),
         updated_at = now()
   where item_id = p_item;
  perform set_config('kleit.server_write', was, true);
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'item', p_item, o, case when p_outcome = 'clean' then 'scan_clean' else 'scan_block' end, coalesce(p_note, ''));
  perform private.notify(o, 'photo_decided', null, 'item', p_item, false);
end $$;
revoke all on function public.scan_decide(uuid, text, text) from public;
grant execute on function public.scan_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. An appeal on a photo of your own (13.4 #4; spec 4.7 #3). The table's one strike becomes
--    "a strike or a photo", exactly one of the two.
-- ---------------------------------------------------------------------------
alter table public.appeals alter column strike_id drop not null;
alter table public.appeals add column item_id uuid references public.items (id) on delete cascade;
alter table public.appeals add constraint appeals_one_subject
  check ((strike_id is not null)::integer + (item_id is not null)::integer = 1);
create unique index appeals_item_idx on public.appeals (item_id) where item_id is not null;

drop policy "appeals: the struck person appeals once" on public.appeals;
-- One appeal per strike, by the person struck, while the strike is live; one per photo, by its
-- owner, while the scanner's (or a moderator's) block stands.
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open'
    and (
      (strike_id is not null and exists (select 1 from public.strikes s where s.id = strike_id and s.user_id = user_id and s.expires_at > now()))
      or
      (item_id is not null and exists (
         select 1 from public.items i join public.item_flags f on f.item_id = i.id
          where i.id = item_id and i.owner_id = user_id and i.deleted_at is null and i.takedown_state = 'none'
            and f.scan_state = 'blocked'
            and coalesce(f.labels ->> 'reason', '') not in ('too-large', 'animated')))
    )
  );

create or replace function private.notify_appeal_decided() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('upheld', 'overturned') and old.state = 'open' then
    if new.item_id is not null then
      perform private.notify(new.user_id, 'appeal_decided', null, 'item', new.item_id);
    else
      perform private.notify(new.user_id, 'appeal_decided', null, 'strike', new.strike_id);
    end if;
  end if;
  return new;
end $$;

create or replace function public.decide_appeal(p_appeal uuid, p_outcome text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appeals%rowtype; me uuid := auth.uid(); was text; live integer;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'overturned') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into a from public.appeals where id = p_appeal and state = 'open';
  if a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- A second review is by a second person (13.4 #4): not the moderator who struck, nor the one
  -- who blocked the photo.
  if a.strike_id is not null and exists (
       select 1 from public.strikes s join public.moderation_actions m on m.report_id = s.report_id and m.action = 'strike'
        where s.id = a.strike_id and m.moderator_id = me) then
    raise exception 'a different person reviews an appeal' using errcode = 'P0004';
  end if;
  if a.item_id is not null and exists (
       select 1 from public.moderation_actions m
        where m.target_type = 'item' and m.target_id = a.item_id and m.action = 'scan_block' and m.moderator_id = me) then
    raise exception 'a different person reviews an appeal' using errcode = 'P0004';
  end if;
  update public.appeals set state = p_outcome, decided_at = now(), decided_by = me, note = coalesce(p_note, '') where id = a.id;
  if p_outcome = 'overturned' and a.item_id is not null then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    update public.item_flags
       set scan_state = 'clean', labels = labels || jsonb_build_object('overturned_at', now()), updated_at = now()
     where item_id = a.item_id and scan_state = 'blocked';
    perform set_config('kleit.server_write', was, true);
  end if;
  if p_outcome = 'overturned' and a.strike_id is not null then
    update public.strikes set expires_at = now() where id = a.strike_id;
    select count(*) into live from public.strikes s where s.user_id = a.user_id and s.kind = 'community' and s.expires_at > now();
    -- Lifted only when the ban in force is the third strike's own: the latest ban row was the
    -- server's (no moderator), and no moderator has banned them since the last time they were unbanned.
    if live < 3
       and (select m.moderator_id is null and m.note = 'third strike' from public.moderation_actions m
             where m.target_user_id = a.user_id and m.action = 'ban' order by m.created_at desc limit 1)
       and not exists (select 1 from public.moderation_actions m
                        where m.target_user_id = a.user_id and m.action = 'ban' and m.moderator_id is not null
                          and m.created_at > coalesce((select max(u.created_at) from public.moderation_actions u
                                                        where u.target_user_id = a.user_id and u.action = 'unban'), '-infinity')) then
      was := coalesce(current_setting('kleit.server_write', true), '');
      perform set_config('kleit.server_write', '1', true);
      update public.profiles set banned_at = null where user_id = a.user_id;
      perform set_config('kleit.server_write', was, true);
      perform private.forget_banned_identity(a.user_id);
      insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
      values (me, 'profile', a.user_id, a.user_id, 'unban', 'appeal overturned a strike');
    end if;
  end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (me, case when a.item_id is not null then 'item' else 'strike' end, coalesce(a.item_id, a.strike_id), a.user_id,
          case when p_outcome = 'overturned' then 'overturn' else 'uphold' end, coalesce(p_note, ''));
end $$;
revoke all on function public.decide_appeal(uuid, text, text) from public;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. moderate(): a removed picture is fingerprinted and its identical copies go with it (13.1 #5).
-- ---------------------------------------------------------------------------
create or replace function public.moderate(p_report uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype; me uuid := auth.uid(); was text; h text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report for update;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.state not in ('open', 'reviewing') then raise exception 'already resolved' using errcode = 'P0002'; end if;
  if p_action not in ('dismiss', 'remove', 'strike', 'ban') then raise exception 'unknown action' using errcode = '22023'; end if;
  if p_action in ('strike', 'ban') and exists (select 1 from public.user_roles x where x.user_id = r.target_owner_id) then
    raise exception 'staff are not struck or banned from here' using errcode = 'P0001';
  end if;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  if p_action in ('remove', 'strike', 'ban') then
    if r.target_type = 'set' then
      update public.sets set takedown_state = 'removed' where id = r.target_id;
    elsif r.target_type = 'item' then
      -- Like a takedown (059): the fingerprint is listed so the picture cannot come back, and
      -- every stored copy with the same fingerprint goes too.
      select i.image_hash into h from public.items i where i.id = r.target_id;
      if h is not null then
        insert into public.removed_image_fingerprints (image_hash, reason) values (h, 'report:' || r.request_ref) on conflict do nothing;
        update public.items set takedown_state = 'removed' where image_hash = h and takedown_state <> 'removed';
      else
        update public.items set takedown_state = 'removed' where id = r.target_id;
      end if;
    elsif r.target_type = 'comment' then
      update public.comments set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    elsif r.target_type = 'group' then
      update public.groups set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    end if;
  end if;
  if p_action = 'dismiss' and r.target_type = 'comment' then
    update public.comments set held_at = null where id = r.target_id and held_at is not null;
  end if;
  if p_action = 'strike' and r.target_owner_id is not null then
    insert into public.strikes (user_id, reason, report_id) values (r.target_owner_id, coalesce(p_note, ''), r.id);
  end if;
  if p_action = 'ban' and r.target_owner_id is not null then
    update public.profiles set banned_at = coalesce(banned_at, now()) where user_id = r.target_owner_id;
    perform private.remember_banned_identity(r.target_owner_id, 'ban: report ' || r.request_ref);
  end if;
  update public.reports set state = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
                            resolution_note = coalesce(p_note, '')
   where id = r.id;
  perform set_config('kleit.server_write', was, true);
  insert into public.moderation_actions (moderator_id, report_id, target_type, target_id, target_user_id, action, note)
  values (me, r.id, r.target_type, r.target_id, r.target_owner_id, p_action, coalesce(p_note, ''));
end $$;
revoke all on function public.moderate(uuid, text, text) from public;
grant execute on function public.moderate(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The queue says when a report is due, and carries the picture of a reported piece or
--    profile photo (its item id; the moderator-only `mod-image` function signs it).
-- ---------------------------------------------------------------------------
drop function public.moderation_queue();
create or replace function public.moderation_queue()
returns table (id uuid, request_ref text, target_type text, target_id uuid, target_owner uuid, target_username text,
               reason text, note text, priority text, state text, created_at timestamptz, reports_on_target bigint,
               title text, body text, preview_image_id text, evidence jsonb, due_at timestamptz, picture_item_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (select private.is_moderator()) then return; end if;
  if exists (select 1 from public.reports r where r.state in ('open', 'reviewing') and r.evidence is not null)
     and not exists (select 1 from public.admin_audit_log l where l.admin_id = auth.uid() and l.what = 'dm_evidence' and l.created_at > now() - interval '1 hour') then
    insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), 'dm_evidence', null, 'opened the queue with message evidence in it');
  end if;
  return query
  select r.id, r.request_ref, r.target_type, r.target_id, r.target_owner_id, p.username,
         r.reason, r.note, r.priority, r.state, r.created_at,
         (select count(*) from public.reports x where x.target_type = r.target_type and x.target_id = r.target_id),
         case r.target_type when 'set' then (select s.title from public.sets s where s.id = r.target_id)
                            when 'item' then (select i.title from public.items i where i.id = r.target_id)
                            when 'group' then (select g.name from public.groups g where g.id = r.target_id)
                            else null end,
         case r.target_type when 'comment' then (select c.body from public.comments c where c.id = r.target_id) else null end,
         case r.target_type when 'set' then (select s.preview_image_id from public.sets s where s.id = r.target_id) else null end,
         r.evidence,
         r.created_at + case r.priority when 'urgent' then interval '24 hours' else interval '72 hours' end,
         case r.target_type when 'item' then r.target_id
                            when 'profile' then (select pp.avatar_item_id from public.profiles pp where pp.user_id = r.target_id)
                            else null end
    from public.reports r left join public.profiles p on p.user_id = r.target_owner_id
   where r.state in ('open', 'reviewing')
   order by case r.priority when 'urgent' then 0 else 1 end, r.created_at
   limit 200;
end $$;
revoke all on function public.moderation_queue() from public;
grant execute on function public.moderation_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Messages are screened (13.2 #1). Never held, never refused: a flagged message files a
--    report on the conversation, with the last ten messages as the evidence the queue shows.
-- ---------------------------------------------------------------------------
alter table public.text_checks drop constraint text_checks_kind;
alter table public.text_checks add constraint text_checks_kind check (kind in ('comment', 'caption', 'bio', 'message'));

create or replace function private.report_conversation(p_conversation uuid, p_sender uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare ev jsonb;
begin
  if p_sender is null then return; end if;
  if exists (select 1 from public.reports r where r.target_type = 'conversation' and r.target_id = p_conversation and r.state in ('open', 'reviewing')) then return; end if;
  if (select count(*) from public.reports r where r.reporter_id = p_sender and r.note like '%(message)%' and r.created_at > now() - interval '1 day') >= 5 then return; end if;
  select jsonb_agg(jsonb_build_object('sender', m.sender_id, 'body', m.body, 'at', m.created_at) order by m.created_at) into ev
    from (select * from public.messages m where m.conversation_id = p_conversation and m.deleted_at is null order by m.created_at desc limit 10) m;
  insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, evidence, priority)
  values ('K-' || upper(substr(private.new_share_code(), 1, 8)), p_sender, 'conversation', p_conversation, p_sender, p_reason, p_note, ev, 'urgent');
end $$;
revoke all on function private.report_conversation(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function private.messages_screen() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.text_verdict(new.body, 'message') = 'hold' then
    perform private.report_conversation(new.conversation_id, new.sender_id, 'self_harm', 'held by the word list (message)');
  end if;
  perform private.queue_text_check('message', new.id, new.sender_id, new.body);
  return new;
end $$;
create trigger messages_screen after insert on public.messages for each row execute function private.messages_screen();

create or replace function public.record_text_check(p_id bigint, p_state text, p_labels jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.text_checks%rowtype; was text; reports_today integer; v_reason text; v_conversation uuid;
begin
  if p_state not in ('ok', 'flagged', 'failed') then raise exception 'unknown state' using errcode = '22023'; end if;
  select * into c from public.text_checks where id = p_id;
  if c.id is null then return; end if;
  update public.text_checks set state = p_state, labels = p_labels, checked_at = case when p_state = 'failed' then null else now() end,
         updated_at = now()
   where id = p_id;
  if p_state = 'failed' then
    -- Five tries, then it is left for a person to notice in the log; the text stays as it is.
    if c.attempts >= 5 then update public.text_checks set state = 'failed' where id = p_id; else update public.text_checks set state = 'pending' where id = p_id; end if;
    return;
  end if;
  if p_state <> 'flagged' then return; end if;
  v_reason := case when p_labels ? 'self-harm' or p_labels ? 'self-harm/intent' or p_labels ? 'self-harm/instructions' then 'self_harm'
                   when p_labels ? 'sexual/minors' then 'underage'
                   when p_labels ? 'harassment' or p_labels ? 'harassment/threatening' then 'harassment'
                   when p_labels ? 'hate' or p_labels ? 'hate/threatening' then 'hate'
                   when p_labels ? 'sexual' then 'nudity'
                   else 'other' end;
  if c.kind = 'message' then
    select m.conversation_id into v_conversation from public.messages m where m.id = c.target_id;
    if v_conversation is not null then
      perform private.report_conversation(v_conversation, c.author_id, v_reason, 'message flagged by the moderation check (message)');
    end if;
    return;
  end if;
  select count(*) into reports_today from public.reports r
   where r.reporter_id = c.author_id and r.note like '%by the moderation check' and r.created_at > now() - interval '1 day';
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  if c.kind = 'comment' then
    update public.comments set held_at = coalesce(held_at, now()) where id = c.target_id and deleted_at is null;
  end if;
  perform set_config('kleit.server_write', was, true);
  if reports_today < 5 and c.author_id is not null and not exists (
       select 1 from public.reports r where r.target_type = case c.kind when 'comment' then 'comment' when 'caption' then 'set' else 'profile' end
                                         and r.target_id = c.target_id and r.state in ('open', 'reviewing')) then
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values ('K-' || upper(substr(private.new_share_code(), 1, 8)), c.author_id,
            case c.kind when 'comment' then 'comment' when 'caption' then 'set' else 'profile' end, c.target_id, c.author_id,
            v_reason, c.kind || ' flagged by the moderation check', 'urgent');
  end if;
end $$;
revoke all on function public.record_text_check(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_text_check(bigint, text, jsonb) to service_role;
