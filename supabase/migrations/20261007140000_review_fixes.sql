-- 065 · The review's doors, shut (an independent read of migrations 044–064, 2026-10-07). Every
-- function below is its latest version in the repo plus the one change named (L31).
--
-- 1. A member could INSERT an items row pointing at ANYONE's stored file (the insert policy only
--    checked owner_id), mark it taken down, and the nightly purge would delete the victim's live
--    picture - or send it through a message. Now a member's items row may only name a file in
--    their own closet-photos folder, and starts clean: not taken down, not purged, no hash, not
--    deleted; a deletion a member sets is stamped now(), never backdated.
-- 2. claim_purges never purges a file another live row still points at, and keeps evidence only
--    for a moderation removal of a living account (a deleted account's own photos go with none).
-- 3. moderate() refuses a report already resolved (one report was two strikes), and strike/ban
--    on staff; reports_guard freezes target_owner_id and priority (a moderator could repoint a
--    report at anyone).
-- 4. A ban from set_suspended, the third strike, or a self-deletion while banned is remembered
--    in blocked_identities; an unban or an overturned third strike forgets it.
-- 5. A banned account cannot file reports; a report on a piece needs the piece to be visible.
-- 6. An edited comment is held like a new one; a caption held at insert is reported too.

-- 1. Items a member writes.
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
  end if;
  if new.image_id is not null and (tg_op = 'INSERT' or new.image_id is distinct from old.image_id or new.image_bucket is distinct from old.image_bucket) then
    if new.image_bucket <> 'closet-photos' or not (select private.owns_storage_folder(new.image_id)) then
      raise exception 'a picture of your own lives in your own folder' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists items_member_guard on public.items;
create trigger items_member_guard before insert or update on public.items
  for each row execute function private.items_member_guard();

-- 2. What may be purged, and what is kept first.
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
   order by i.takedown_state = 'removed' desc, coalesce(i.deleted_at, i.updated_at)
   limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;
revoke all on function public.claim_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_purges(integer) to service_role;

-- 3. Reports: the person a report is about, and its priority, are frozen too.
create or replace function private.reports_guard()
returns trigger language plpgsql as $$
begin
  if new.reporter_id is distinct from old.reporter_id or new.target_type <> old.target_type or new.target_id <> old.target_id
     or new.reason <> old.reason or new.note <> old.note or new.evidence is distinct from old.evidence
     or new.request_ref <> old.request_ref or new.created_at <> old.created_at
     or new.target_owner_id is distinct from old.target_owner_id or new.priority <> old.priority then
    raise exception 'a report is only ever resolved, never rewritten' using errcode = '42501';
  end if;
  if new.state in ('actioned', 'dismissed') and old.state not in ('actioned', 'dismissed') then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  end if;
  return new;
end $$;

-- 4. Forgetting a ban's identity rows (an unban).
create or replace function private.forget_banned_identity(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.blocked_identities b
   where b.reason like 'ban:%'
     and (b.email_hash = any (private.identity_hashes(p_user)) or b.provider_id_hash = any (private.identity_hashes(p_user)));
$$;
revoke all on function private.forget_banned_identity(uuid) from public, anon, authenticated;

create or replace function public.moderate(p_report uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype; me uuid := auth.uid(); was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report;
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
      update public.items set takedown_state = 'removed' where id = r.target_id;
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

create or replace function public.decide_appeal(p_appeal uuid, p_outcome text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appeals%rowtype; me uuid := auth.uid(); was text; live integer;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'overturned') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into a from public.appeals where id = p_appeal and state = 'open';
  if a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.appeals set state = p_outcome, decided_at = now(), decided_by = me, note = coalesce(p_note, '') where id = a.id;
  if p_outcome = 'overturned' then
    update public.strikes set expires_at = now() where id = a.strike_id;
    select count(*) into live from public.strikes s where s.user_id = a.user_id and s.kind = 'community' and s.expires_at > now();
    -- Only a ban that the third strike itself produced is lifted - and only if nothing banned
    -- them since (the latest ban row must be the third-strike one).
    if live < 3 and (select m.note from public.moderation_actions m where m.target_user_id = a.user_id and m.action = 'ban' order by m.created_at desc limit 1) = 'third strike' then
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
  values (me, 'strike', a.strike_id, a.user_id, case when p_outcome = 'overturned' then 'overturn' else 'uphold' end, coalesce(p_note, ''));
end $$;
revoke all on function public.decide_appeal(uuid, text, text) from public;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

create or replace function public.set_suspended(p_user uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'not yourself' using errcode = 'P0001'; end if;
  if p_on and exists (select 1 from public.user_roles x where x.user_id = p_user) then raise exception 'staff are not suspended from here' using errcode = 'P0001'; end if;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set banned_at = case when p_on then coalesce(banned_at, now()) else null end where user_id = p_user;
  perform set_config('kleit.server_write', was, true);
  if p_on then perform private.remember_banned_identity(p_user, 'ban: ' || btrim(p_reason)); else perform private.forget_banned_identity(p_user); end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'profile', p_user, p_user, case when p_on then 'ban' else 'unban' end, btrim(p_reason));
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), case when p_on then 'ban' else 'unban' end, p_user, btrim(p_reason));
end $$;
revoke all on function public.set_suspended(uuid, boolean, text) from public;
grant execute on function public.set_suspended(uuid, boolean, text) to authenticated;

create or replace function private.strikes_ban_at_three()
returns trigger language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if new.kind = 'community'
     and (select count(*) from public.strikes s where s.user_id = new.user_id and s.kind = 'community' and s.expires_at > now()) >= 3 then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    update public.profiles set banned_at = coalesce(banned_at, now()) where user_id = new.user_id;
    perform set_config('kleit.server_write', was, true);
    perform private.remember_banned_identity(new.user_id, 'ban: third strike');
    insert into public.moderation_actions (moderator_id, report_id, target_type, target_id, target_user_id, action, note)
    values (null, new.report_id, 'profile', new.user_id, new.user_id, 'ban', 'third strike');
  end if;
  return new;
end $$;

create or replace function public.file_report(p_type text, p_id uuid, p_reason text, p_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  owner uuid;
  ev jsonb;
  ref text;
  existing text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if (select private.is_banned(me)) then raise exception 'suspended' using errcode = '42501'; end if;
  if (select count(*) from public.reports r where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many' using errcode = 'P0003';
  end if;
  -- What is it, whose is it, and may this person see it at all?
  if p_type = 'set' then
    select s.owner_id into owner from public.sets s where s.id = p_id and (select public.can_view_set(s.id, me));
  elsif p_type = 'item' then
    -- Only a piece this person could see: their own, a cleared product, or a piece on a set they may view.
    select i.owner_id into owner from public.items i
     where i.id = p_id
       and (i.owner_id = me
            or (i.kind = 'product' and (select private.image_cleared(i.id)))
            or exists (select 1 from public.set_items si where si.item_id = i.id and (select public.can_view_set(si.set_id, me))));
  elsif p_type = 'comment' then
    select c.author_id into owner from public.comments c where c.id = p_id and (select public.can_view_set(c.set_id, me));
  elsif p_type = 'profile' then
    select p.user_id into owner from public.profiles p where p.user_id = p_id;
  elsif p_type = 'conversation' then
    select case when c.user_a = me then c.user_b else c.user_a end into owner
      from public.conversations c where c.id = p_id and me in (c.user_a, c.user_b);
    if owner is not null then
      select jsonb_agg(jsonb_build_object('sender', m.sender_id, 'body', m.body, 'at', m.created_at) order by m.created_at)
        into ev
        from (select * from public.messages m where m.conversation_id = p_id and m.deleted_at is null order by m.created_at desc limit 10) m;
    end if;
  elsif p_type = 'group' then
    select g.creator_id into owner from public.groups g where g.id = p_id;
  else
    raise exception 'unknown target' using errcode = '22023';
  end if;
  if owner is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if owner = me then raise exception 'own' using errcode = 'P0001'; end if;
  -- The same person reporting the same thing twice gets the same reference back.
  select r.request_ref into existing from public.reports r
   where r.reporter_id = me and r.target_type = p_type and r.target_id = p_id and r.state in ('open', 'reviewing');
  if existing is not null then return existing; end if;
  ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
  insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, evidence, priority)
  values (ref, me, p_type, p_id, owner, p_reason, coalesce(btrim(p_note), ''), ev,
          case when p_reason in ('underage', 'intimate_image', 'self_harm') then 'urgent' else 'normal' end);
  return ref;
end $$;
revoke all on function public.file_report(text, uuid, text, text) from public;
grant execute on function public.file_report(text, uuid, text, text) to authenticated;

create or replace function public.request_account_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); was text; final timestamptz;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- A banned account may delete itself, but the ban is remembered first (spec 13.4 #5).
  if (select private.is_banned(me)) then perform private.remember_banned_identity(me, 'ban: deleted while banned'); end if;
  insert into public.account_deletions (user_id, state, requested_at, final_at, cancelled_at)
  values (me, 'pending', now(), now() + interval '7 days', null)
  on conflict (user_id) do update set state = 'pending', requested_at = now(), final_at = now() + interval '7 days', cancelled_at = null
    where public.account_deletions.state <> 'pending';
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set deactivated_at = coalesce(deactivated_at, now()) where user_id = me;
  perform set_config('kleit.server_write', was, true);
  select final_at into final from public.account_deletions where user_id = me;
  return final;
end $$;
revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function private.finalize_account_deletions()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n integer := 0;
begin
  perform set_config('kleit.server_write', '1', true);
  for d in select user_id from public.account_deletions where state = 'pending' and final_at <= now() loop
    -- Remixes of their sets stay, credited to a deleted account (spec 3.7 #8).
    update public.sets set remixed_from_set_id = null, remixed_from_label = 'Remixed from a deleted account'
     where remixed_from_set_id in (select id from public.sets where owner_id = d.user_id);
    -- Their own photos go; clipped store pieces stay with no owner (the FK sets null on cascade).
    -- Their own photos go tonight with no evidence copy (claim_purges: deleted 30 days ago, not taken down).
    update public.items set deleted_at = now() - interval '31 days' where owner_id = d.user_id and kind = 'own' and takedown_state = 'none';
    -- Their messages read "unavailable" (the FK sets the sender null; mark them too).
    update public.messages set deleted_at = coalesce(deleted_at, now()) where sender_id = d.user_id;
    -- The 18+ record forgets when to purge: 30 more days (spec 3.7 #4).
    update public.age_confirmations set purge_after = now() + interval '30 days' where user_id_hash = encode(sha256(d.user_id::text::bytea), 'hex') and purge_after is null;
    update public.account_deletions set state = 'completed' where user_id = d.user_id;
    delete from auth.users where id = d.user_id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function private.comments_screen_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.body <> old.body then
    v := public.text_verdict(new.body, 'comment');
    if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
    if v = 'hold' and new.held_at is null then
      new.held_at := now();
      if not exists (select 1 from public.reports r where r.target_type = 'comment' and r.target_id = new.id and r.state in ('open', 'reviewing')) then
        insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
        values ('K-' || upper(substr(private.new_share_code(), 1, 8)), new.author_id, 'comment', new.id, new.author_id, 'self_harm', 'held by the word list', 'urgent');
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function private.sets_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', ''); v text; ref text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' and cap = coalesce(old.layout ->> 'caption', '') then return new; end if;
  v := public.text_verdict(cap, 'caption');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' and not exists (
       select 1 from public.reports r where r.target_type = 'set' and r.target_id = new.id and r.state in ('open', 'reviewing')) then
    ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values (ref, new.owner_id, 'set', new.id, new.owner_id, 'self_harm', 'caption held by the word list', 'urgent');
  end if;
  return new;
end $$;
