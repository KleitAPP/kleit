-- 117 · The read-back of the spec walk's five batches (L35), 2026-10-19 afternoon. Each function
-- replaced here starts from its latest text (L31): decide_appeal, push_enqueue, report_conversation
-- and messages_screen from 113; photo_appealable and the appeals policy from 114;
-- file_counter_notice, counter_notice_queue, counter_notice_resolve, claim_purges and
-- nightly_cleanup from 115. What the reviewer found, in its order:
--  1. A restore on a counter-notice undid every removal of that picture - a nudity report's, an
--     intimate-image takedown's, a second claimant's - because the fingerprint list keeps one row
--     per picture. A restore now refuses unless this notice is the only ground the picture was
--     removed on, and refuses once the bytes are purged.
--  2. A re-upload the scanner blocked as "removed before" could be appealed and cleared by a
--     moderator who was never told why it was blocked. Not appealable; an overturn refuses a
--     picture whose fingerprint is on the never-again list; the appeal card says the reason.
--  3. nightly_cleanup's two-year `update reports set evidence = null` would have been refused by
--     reports_guard from the first night it had a row to touch (2028), failing the whole night job
--     every night after. Dropped: the two-year delete covers it.
--  4. A third copyright strike's ban never lifted when the counter-notice restored the picture.
--  5. The word list for messages was the comments' list ("starving", "purge", "calories" - everyday
--     words in a clothes app), each filing an URGENT report with ten messages of both people and
--     waking every moderator. Messages now use the short list of names for the pro-ED and self-harm
--     communities, their reports are normal priority (the outside check's self-harm and minors
--     labels stay urgent), and a moderator is woken at most once a quarter hour.
--  6. The 21-day purge hold was counted from the fingerprint, which a counter-notice filed late
--     outlived. The hold now follows the notice: while a counter-notice is open, and 21 days
--     after the takedown; a removal with no fingerprint is held the same way.
--  7. text_checks kept every message body for ever. Checked rows go at 30 days.
--  8. A copyright strike had two doors - the in-app appeal and the counter-notice - and the in-app
--     one ended it without restoring or telling anyone. One door: the counter-notice.
--  9. The counter-notice queue now carries the claimant (to forward it to) and the uploader.
-- 10. The restore date is kept (no restore before it); a counter-notice needs a takedown that
--     removed a picture, once per notice; notes are cut to the column's length.
-- 11. my_reports() no longer shows a person the report the word list or the outside check filed
--     in their name on their own message - which told a harasser the thread was being read.
-- 12. The 18+ records stamped 30 days before 115 are extended to the year.
-- 13. An item the app would offer to appeal is answered by photo_appeal_allowed().

-- ---------------------------------------------------------------------------
-- 2. Appeals: not on a "removed before" block; an overturn never republishes a listed picture.
-- ---------------------------------------------------------------------------
create or replace function private.photo_appealable(p_item uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i join public.item_flags f on f.item_id = i.id
     where i.id = p_item and i.owner_id = p_user and p_user is not null
       and i.deleted_at is null and i.takedown_state = 'none'
       and f.scan_state = 'blocked'
       and coalesce(f.labels ->> 'reason', '') not in ('too-large', 'animated', 'removed-before')
       and not exists (select 1 from public.removed_image_fingerprints r where r.image_hash = i.image_hash)
  );
$$;

-- The app's question before it offers the button (13): your own blocked photo that may be appealed.
create or replace function public.photo_appeal_allowed(p_item uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.photo_appealable(p_item, (select auth.uid()));
$$;
revoke all on function public.photo_appeal_allowed(uuid) from public;
grant execute on function public.photo_appeal_allowed(uuid) to authenticated;

-- 8. A copyright strike is answered by a counter-notice, not an in-app appeal.
drop policy "appeals: the struck person appeals once" on public.appeals;
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open' and note = '' and decided_at is null and decided_by is null
    and (
      (strike_id is not null and exists (
         select 1 from public.strikes s where s.id = appeals.strike_id and s.user_id = (select auth.uid()) and s.kind = 'community' and s.expires_at > now()))
      or
      (item_id is not null and (select private.photo_appealable(appeals.item_id, (select auth.uid()))))
    )
  );

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
  -- A picture on the never-again list (a takedown's or a report's removal) is never republished
  -- through an appeal (spec 13.1 #5), whatever the appeal says.
  if p_outcome = 'overturned' and a.item_id is not null and exists (
       select 1 from public.items i join public.removed_image_fingerprints r on r.image_hash = i.image_hash where i.id = a.item_id) then
    raise exception 'that picture was removed before and stays removed' using errcode = 'P0005';
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
          case when p_outcome = 'overturned' then 'overturn' else 'uphold' end, left(coalesce(p_note, ''), 500));
end $$;
revoke all on function public.decide_appeal(uuid, text, text) from public;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

-- The appeal card says why the photo was blocked (the scanner's labels), for the second person.
create or replace function public.appeal_photo_reasons(p_items uuid[])
returns table (item_id uuid, reason text, because jsonb)
language sql stable security definer set search_path = '' as $$
  select f.item_id, f.labels ->> 'reason', f.labels -> 'because'
    from public.item_flags f
   where (select private.is_moderator()) and f.item_id = any (p_items);
$$;
revoke all on function public.appeal_photo_reasons(uuid[]) from public;
grant execute on function public.appeal_photo_reasons(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Messages: the short list, normal priority, and a moderator woken once a quarter hour.
-- ---------------------------------------------------------------------------
-- The names of the pro-eating-disorder and self-harm communities and the plain words for ending
-- a life: a message that carries one is worth a person's look. The everyday words of the
-- comments' list ("calories", "purge", "starving") are not, in a private message between two
-- people who chose each other.
create or replace function private.held_phrases_messages()
returns text[] language sql immutable set search_path = '' as $$
  select array['thinspo', 'thinspiration', 'pro ana', 'proana', 'pro mia', 'promia', 'meanspo', 'bonespo',
               'ana buddy', 'ana tips', 'ana diet', 'mia tips', 'ed tips', 'self harm', 'self-harm', 'cutting scars',
               'kill myself', 'suicide', 'end my life', 'want to die'];
$$;
revoke all on function private.held_phrases_messages() from public, anon, authenticated;

create or replace function private.report_conversation(p_conversation uuid, p_sender uuid, p_reason text, p_note text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
declare ev jsonb;
begin
  if p_sender is null then return; end if;
  if exists (select 1 from public.reports r where r.target_type = 'conversation' and r.target_id = p_conversation and r.state in ('open', 'reviewing')) then return; end if;
  if (select count(*) from public.reports r where r.reporter_id = p_sender and r.note like '%(message)%' and r.created_at > now() - interval '1 day') >= 5 then return; end if;
  select jsonb_agg(jsonb_build_object('sender', m.sender_id, 'body', m.body, 'at', m.created_at) order by m.created_at) into ev
    from (select * from public.messages m where m.conversation_id = p_conversation and m.deleted_at is null order by m.created_at desc limit 10) m;
  insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, evidence, priority)
  values ('K-' || upper(substr(private.new_share_code(), 1, 8)), p_sender, 'conversation', p_conversation, p_sender, p_reason, p_note, ev,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end);
end $$;
revoke all on function private.report_conversation(uuid, uuid, text, text, text) from public, anon, authenticated;
drop function if exists private.report_conversation(uuid, uuid, text, text);

create or replace function private.messages_screen() returns trigger language plpgsql security definer set search_path = '' as $$
declare t text := lower(coalesce(new.body, '')); ph text;
begin
  if t <> '' then
    foreach ph in array private.held_phrases_messages() loop
      if t ~ ('\m' || regexp_replace(ph, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\M') then
        perform private.report_conversation(new.conversation_id, new.sender_id, 'self_harm', 'held by the word list (message)', 'normal');
        exit;
      end if;
    end loop;
  end if;
  perform private.queue_text_check('message', new.id, new.sender_id, new.body);
  return new;
end $$;

-- The outside check's self-harm and minors labels on a message stay urgent (record_text_check,
-- 113, calls report_conversation with four arguments and so gets 'normal' now); this keeps the
-- two kinds that must wake somebody at 'urgent'.
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
      perform private.report_conversation(v_conversation, c.author_id, v_reason, 'message flagged by the moderation check (message)',
                                          case when v_reason in ('self_harm', 'underage') then 'urgent' else 'normal' end);
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
  -- A moderator's alert (spec 13.4 #1) goes now, outside the daily cap and the quiet hours - and
  -- at most once a quarter hour: a burst of urgent reports is one buzz, not twenty.
  if new.kind = 'mod_urgent' then
    if tg_op = 'INSERT' and not exists (
         select 1 from public.push_queue q
          where q.user_id = new.user_id and q.kind = 'mod_urgent' and q.created_at > now() - interval '15 minutes') then
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

-- 11. A report the system filed in a person's name on their own message is not "their report".
create or replace function public.my_reports()
returns table (request_ref text, target_type text, reason text, state text, created_at timestamptz, resolved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.request_ref, r.target_type, r.reason, r.state, r.created_at, r.resolved_at
    from public.reports r
   where r.reporter_id = (select auth.uid())
     and r.target_owner_id is distinct from (select auth.uid())
   order by r.created_at desc limit 100;
$$;
revoke all on function public.my_reports() from public;
grant execute on function public.my_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 1, 4, 6, 9, 10. The counter-notice, made safe.
-- ---------------------------------------------------------------------------
create or replace function public.file_counter_notice(p_takedown_ref text, p_name text, p_email text, p_address text, p_phone text,
                                                      p_details text, p_statements boolean, p_consent boolean, p_signature text, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.takedown_requests%rowtype; ref text;
begin
  select * into t from public.takedown_requests where request_ref = upper(btrim(p_takedown_ref));
  if t.id is null or t.kind <> 'copyright' or t.state <> 'removed' or t.item_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- One counter-notice per notice: an open one, or one already decided, closes the door.
  if exists (select 1 from public.counter_notices c where c.takedown_id = t.id) then raise exception 'already_open' using errcode = 'P0001'; end if;
  if not p_statements or not p_consent then raise exception 'incomplete' using errcode = '22023'; end if;
  ref := 'C-' || upper(substr(private.new_share_code(), 1, 8));
  insert into public.counter_notices (request_ref, takedown_id, name, email, address, phone, details, statements, consent, signature, ip_hash)
  values (ref, t.id, btrim(p_name), lower(btrim(p_email)), btrim(p_address), coalesce(btrim(p_phone), ''), coalesce(btrim(p_details), ''), true, true, btrim(p_signature), p_ip_hash);
  return ref;
end $$;
revoke all on function public.file_counter_notice(text, text, text, text, text, text, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.file_counter_notice(text, text, text, text, text, text, boolean, boolean, text, text) to service_role;

-- The queue carries the claimant (the notice is forwarded to them by email, CL43) and the uploader.
drop function public.counter_notice_queue();
create or replace function public.counter_notice_queue()
returns table (id uuid, request_ref text, takedown_ref text, takedown_id uuid, item_id uuid, name text, email text, address text, phone text,
               details text, signature text, created_at timestamptz, restore_after timestamptz,
               claimant_name text, claimant_email text, uploader_username text, other_grounds boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.request_ref, t.request_ref, t.id, t.item_id, c.name, c.email, c.address, c.phone, c.details, c.signature, c.created_at, c.restore_after,
         t.name, t.email, p.username,
         -- True when the picture was also removed on another ground (a report, another notice):
         -- a restore will refuse, and the moderator should know before clicking.
         exists (select 1 from public.items i left join public.removed_image_fingerprints r on r.image_hash = i.image_hash
                  where i.id = t.item_id
                    and (coalesce(r.reason, 'takedown:copyright:' || t.request_ref) <> 'takedown:copyright:' || t.request_ref
                         or exists (select 1 from public.moderation_actions m where m.target_type = 'item' and m.target_id = i.id and m.action in ('remove', 'strike', 'ban'))
                         or exists (select 1 from public.takedown_requests o where o.id <> t.id and o.state = 'removed' and o.item_id = i.id)))
    from public.counter_notices c
    join public.takedown_requests t on t.id = c.takedown_id
    left join public.items i on i.id = t.item_id
    left join public.profiles p on p.user_id = i.owner_id
   where (select private.is_moderator()) and c.state = 'open'
   order by c.created_at;
$$;
revoke all on function public.counter_notice_queue() from public;
grant execute on function public.counter_notice_queue() to authenticated;

create or replace function public.counter_notice_resolve(p_id uuid, p_outcome text, p_note text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.counter_notices%rowtype; t public.takedown_requests%rowtype; h text; was text; n integer := 0; owner uuid; purged boolean;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('restored', 'withheld') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into c from public.counter_notices where id = p_id and state = 'open' for update;
  if c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into t from public.takedown_requests where id = c.takedown_id;
  if p_outcome = 'restored' then
    if now() < c.restore_after then
      raise exception 'not before %', to_char(c.restore_after, 'YYYY-MM-DD') using errcode = 'P0006';
    end if;
    select i.image_hash, i.owner_id, i.purged_at is not null into h, owner, purged from public.items i where i.id = t.item_id;
    if purged then raise exception 'already purged' using errcode = 'P0007'; end if;
    -- Only when this notice is the sole ground the picture was removed on (1): the fingerprint
    -- row - one per picture - must be this takedown's, and no report's removal or other notice
    -- may name the picture.
    if (h is not null and exists (select 1 from public.removed_image_fingerprints r where r.image_hash = h and r.reason <> 'takedown:copyright:' || t.request_ref))
       or exists (select 1 from public.moderation_actions m where m.target_type = 'item' and m.target_id = t.item_id and m.action in ('remove', 'strike', 'ban'))
       or exists (select 1 from public.takedown_requests o where o.id <> t.id and o.state = 'removed' and o.item_id = t.item_id) then
      raise exception 'removed on another ground too' using errcode = 'P0008';
    end if;
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    if h is not null then
      delete from public.removed_image_fingerprints where image_hash = h and reason = 'takedown:copyright:' || t.request_ref;
      update public.items set takedown_state = 'none' where image_hash = h and takedown_state = 'removed' and purged_at is null;
      get diagnostics n = row_count;
    else
      update public.items set takedown_state = 'none' where id = t.item_id and takedown_state = 'removed' and purged_at is null;
      get diagnostics n = row_count;
    end if;
    perform set_config('kleit.server_write', was, true);
    update public.strikes set expires_at = now()
     where kind = 'copyright' and expires_at > now() and reason like 'Copyright takedown ' || t.request_ref || '%';
    -- 4. A ban the third copyright strike itself produced lifts with it - the same rule as an
    -- overturned community strike (069): the latest ban row was the server's, no moderator since.
    if owner is not null
       and (select count(*) from public.strikes s where s.user_id = owner and s.kind = 'copyright' and s.expires_at > now()) < 3
       and (select m.moderator_id is null and m.note = 'third copyright strike' from public.moderation_actions m
             where m.target_user_id = owner and m.action = 'ban' order by m.created_at desc limit 1)
       and not exists (select 1 from public.moderation_actions m
                        where m.target_user_id = owner and m.action = 'ban' and m.moderator_id is not null
                          and m.created_at > coalesce((select max(u.created_at) from public.moderation_actions u
                                                        where u.target_user_id = owner and u.action = 'unban'), '-infinity')) then
      perform set_config('kleit.server_write', '1', true);
      update public.profiles set banned_at = null where user_id = owner;
      perform set_config('kleit.server_write', was, true);
      perform private.forget_banned_identity(owner);
      insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
      values (auth.uid(), 'profile', owner, owner, 'unban', 'counter-notice restored the third copyright strike''s picture');
    end if;
  end if;
  update public.counter_notices set state = p_outcome, resolved_at = now(), resolved_by = auth.uid(), note = left(coalesce(p_note, ''), 500) where id = c.id;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'takedown', t.id, owner, case when p_outcome = 'restored' then 'restore' else 'dismiss' end,
          left('counter-notice ' || c.request_ref || ': ' || coalesce(p_note, '') || case when n > 0 then format(' (%s picture(s) restored)', n) else '' end, 500));
  return n;
end $$;
revoke all on function public.counter_notice_resolve(uuid, text, text) from public;
grant execute on function public.counter_notice_resolve(uuid, text, text) to authenticated;

-- 6. The purge hold follows the notice, not the fingerprint: 21 days after a copyright takedown
--    removed the picture, and for as long as a counter-notice on it is open.
create or replace function public.claim_purges(p_limit integer default 20)
returns table (id uuid, image_bucket public.image_bucket, image_id text, keep_evidence boolean)
language sql security definer set search_path = '' as $$
  select i.id, i.image_bucket, i.image_id,
         (i.takedown_state = 'removed' and i.owner_id is not null) as keep_evidence
    from public.items i
   where i.image_id is not null
     and i.purged_at is null
     and (i.takedown_state = 'removed'
          or (i.deleted_at is not null and i.deleted_at < now() - interval '30 days'))
     and not exists (
       select 1 from public.items o
        where o.id <> i.id and o.image_bucket = i.image_bucket and o.image_id = i.image_id
          and o.purged_at is null and o.takedown_state = 'none' and o.deleted_at is null)
     and not (i.takedown_state = 'removed' and exists (
       select 1 from public.takedown_requests t
        where t.kind = 'copyright' and t.state = 'removed' and t.item_id is not null
          and (t.item_id = i.id or (i.image_hash is not null and i.image_hash = (select x.image_hash from public.items x where x.id = t.item_id)))
          and (t.resolved_at > now() - interval '21 days'
               or exists (select 1 from public.counter_notices c where c.takedown_id = t.id and c.state = 'open'))))
   order by i.takedown_state = 'removed' desc, coalesce(i.deleted_at, i.updated_at)
   limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;
revoke all on function public.claim_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_purges(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3, 7, 12. The night job: no evidence update (reports_guard refuses it; the two-year delete
--           covers it), checked text rows at 30 days, and the old 18+ stamps extended.
-- ---------------------------------------------------------------------------
update public.age_confirmations set purge_after = purge_after - interval '30 days' + interval '1 year'
 where purge_after is not null and purge_after < now() + interval '31 days';

create or replace function private.nightly_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_sets int; n_votes_ip int; n_votes_dev int; n_clicks int; n_notes int; n_msgs int; n_acc int;
        n_age int; n_reports int; n_actions int; n_strikes int; n_takedowns int; n_counters int; n_contact int; n_audit int; n_texts int;
begin
  perform set_config('kleit.server_write', '1', true);
  n_acc := private.finalize_account_deletions();
  delete from public.sets where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n_sets = row_count;
  update public.votes set ip_hash = null where ip_hash is not null and created_at < now() - interval '30 days';
  get diagnostics n_votes_ip = row_count;
  update public.votes set device_hash = 'expired:' || id::text where device_hash not like 'expired:%' and created_at < now() - interval '90 days';
  get diagnostics n_votes_dev = row_count;
  insert into public.click_totals (item_id, day, network, clicks)
    select item_id, created_at::date, network, count(*) from public.clicks where created_at < now() - interval '90 days'
    group by item_id, created_at::date, network
  on conflict (item_id, day, network) do update set clicks = public.click_totals.clicks + excluded.clicks;
  delete from public.clicks where created_at < now() - interval '90 days';
  get diagnostics n_clicks = row_count;
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics n_notes = row_count;
  update public.messages set body = ' ' where deleted_at is not null and deleted_at < now() - interval '30 days' and body <> ' ';
  get diagnostics n_msgs = row_count;
  -- The outside check's copies of comments, captions, bios and messages: thirty days once checked.
  delete from public.text_checks where state <> 'pending' and checked_at is not null and checked_at < now() - interval '30 days';
  get diagnostics n_texts = row_count;
  -- The data map (14.2): the 18+ record a year after deletion; reports and moderation records two years.
  delete from public.age_confirmations where purge_after is not null and purge_after < now();
  get diagnostics n_age = row_count;
  delete from public.reports where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_reports = row_count;
  delete from public.moderation_actions where created_at < now() - interval '2 years';
  get diagnostics n_actions = row_count;
  delete from public.strikes where created_at < now() - interval '2 years';
  get diagnostics n_strikes = row_count;
  delete from public.counter_notices where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_counters = row_count;
  delete from public.takedown_requests where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_takedowns = row_count;
  delete from public.contact_messages where state <> 'open' and created_at < now() - interval '2 years';
  get diagnostics n_contact = row_count;
  delete from public.admin_audit_log where created_at < now() - interval '2 years';
  get diagnostics n_audit = row_count;
  return jsonb_build_object('accounts', n_acc, 'sets', n_sets, 'votes_ip', n_votes_ip, 'votes_device', n_votes_dev, 'clicks', n_clicks,
                            'notifications', n_notes, 'messages', n_msgs, 'text_checks', n_texts, 'age_records', n_age, 'reports', n_reports,
                            'actions', n_actions, 'strikes', n_strikes, 'counter_notices', n_counters, 'takedowns', n_takedowns,
                            'contact', n_contact, 'audit', n_audit);
end $$;
