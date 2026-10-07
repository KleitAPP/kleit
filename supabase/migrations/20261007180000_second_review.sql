-- 069 · The second review (of 065–068), 2026-10-07. Each function is its latest version plus
-- the one change: (1) one items row per stored file, and a member never changes a row's file
-- path - a second row on the same file shielded the first from the purge; (2) a resolved report
-- cannot be reopened by a table update; moderate() locks the row it acts on; (3) an overturned
-- third strike lifts only the third strike's own ban, never a moderator's; (4) the five-a-day
-- cap on word-list reports covers edits and captions too; (5) the appeals policy compared a
-- column with itself - an appeal must be on the appellant's own strike; (6) a message request
-- the other person has left does not come back by writing again.

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

create or replace function private.reports_guard()
returns trigger language plpgsql as $$
begin
  if new.reporter_id is distinct from old.reporter_id or new.target_type <> old.target_type or new.target_id <> old.target_id
     or new.reason <> old.reason or new.note <> old.note or new.evidence is distinct from old.evidence
     or new.request_ref <> old.request_ref or new.created_at <> old.created_at
     or new.target_owner_id is distinct from old.target_owner_id or new.priority <> old.priority then
    raise exception 'a report is only ever resolved, never rewritten' using errcode = '42501';
  end if;
  if old.state in ('actioned', 'dismissed') and new.state not in ('actioned', 'dismissed') then
    raise exception 'a resolved report stays resolved' using errcode = '42501';
  end if;
  if new.state in ('actioned', 'dismissed') and old.state not in ('actioned', 'dismissed') then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  end if;
  return new;
end $$;

create or replace function public.moderate(p_report uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype; me uuid := auth.uid(); was text;
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
  values (me, 'strike', a.strike_id, a.user_id, case when p_outcome = 'overturned' then 'overturn' else 'uphold' end, coalesce(p_note, ''));
end $$;
revoke all on function public.decide_appeal(uuid, text, text) from public;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

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
      if not exists (select 1 from public.reports r where r.target_type = 'comment' and r.target_id = new.id and r.state in ('open', 'reviewing'))
         and (select count(*) from public.reports r where r.reporter_id = new.author_id and r.note like '%held by the word list' and r.created_at > now() - interval '1 day') < 5 then
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
       select 1 from public.reports r where r.target_type = 'set' and r.target_id = new.id and r.state in ('open', 'reviewing'))
     and (select count(*) from public.reports r where r.reporter_id = new.owner_id and r.note like '%held by the word list' and r.created_at > now() - interval '1 day') < 5 then
    ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values (ref, new.owner_id, 'set', new.id, new.owner_id, 'self_harm', 'caption held by the word list', 'urgent');
  end if;
  return new;
end $$;

create or replace function private.comments_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text; ref text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  v := public.text_verdict(new.body, 'comment');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' then
    new.held_at := now();
    if (select count(*) from public.reports r where r.reporter_id = new.author_id and r.note like '%held by the word list' and r.created_at > now() - interval '1 day') < 5 then
      ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
      insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
      values (ref, new.author_id, 'comment', new.id, new.author_id, 'self_harm', 'held by the word list', 'urgent');
    end if;
  end if;
  return new;
end $$;

create or replace function public.send_message(p_to uuid, p_body text, p_photo uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid;
  conv public.conversations%rowtype;
  new_account boolean;
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
  -- A first message from a stranger is text only (spec 10.2 #5): no photo into a request -
  -- an existing one, or the one this message would open (the recipient does not follow back).
  if p_photo is not null
     and ((conv.id is null and not (select private.is_following(p_to, me))) or conv.state = 'request') then
    raise exception 'refused' using errcode = 'P0001';
  end if;

  new_account := (select p.created_at > now() - interval '7 days' from public.profiles p where p.user_id = me);
  if new_account and body ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|me|ly|gg)(/|\s|$))' then
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

drop policy "appeals: the struck person appeals once" on public.appeals;
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open' and note = '' and decided_at is null and decided_by is null
    and exists (select 1 from public.strikes s where s.id = strike_id and s.user_id = (select auth.uid()) and s.expires_at > now())
  );
