-- 068 · The review's low findings (CL47–CL49). (a) A suspension reaches every table a member
-- can insert into, not six of them: items (and so photo uploads), polls and their options,
-- groups and group posts, asks and answers, folders, templates, reactions, follow requests,
-- set_items; and a deactivated or deleting sender cannot message (send_message is its latest
-- version, 066, plus one line). (b) An appeal is written by its author with only the author's
-- columns. (c) The word list files at most five urgent reports per author per day; the rest of
-- that author's held comments are held but not reported again that day. (d) Reading the queue
-- with DM evidence in it is logged in admin_audit_log, once per moderator per hour.

-- (a)
create trigger items_banned before insert on public.items for each row execute function private.refuse_if_banned();
create trigger polls_banned before insert on public.polls for each row execute function private.refuse_if_banned();
create trigger poll_options_banned before insert on public.poll_options for each row execute function private.refuse_if_banned();
create trigger groups_banned before insert on public.groups for each row execute function private.refuse_if_banned();
create trigger group_posts_banned before insert on public.group_posts for each row execute function private.refuse_if_banned();
create trigger ask_posts_banned before insert on public.ask_posts for each row execute function private.refuse_if_banned();
create trigger ask_answers_banned before insert on public.ask_answers for each row execute function private.refuse_if_banned();
create trigger collections_banned before insert on public.collections for each row execute function private.refuse_if_banned();
create trigger templates_banned before insert on public.templates for each row execute function private.refuse_if_banned();
create trigger reactions_banned before insert on public.reactions for each row execute function private.refuse_if_banned();
create trigger follow_requests_banned before insert on public.follow_requests for each row execute function private.refuse_if_banned();
create trigger set_items_banned before insert on public.set_items for each row execute function private.refuse_if_banned();

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

-- (b)
drop policy "appeals: the struck person appeals once" on public.appeals;
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open' and note = '' and decided_at is null and decided_by is null
    and exists (select 1 from public.strikes s where s.id = strike_id and s.user_id = user_id and s.expires_at > now())
  );

-- (c) The comments screen (latest: 062) with the daily cap.
create or replace function private.comments_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text; ref text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  v := public.text_verdict(new.body, 'comment');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' then
    new.held_at := now();
    if (select count(*) from public.reports r where r.reporter_id = new.author_id and r.note = 'held by the word list' and r.created_at > now() - interval '1 day') < 5 then
      ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
      insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
      values (ref, new.author_id, 'comment', new.id, new.author_id, 'self_harm', 'held by the word list', 'urgent');
    end if;
  end if;
  return new;
end $$;

-- (d) The queue (latest: 045) logs a view that carried message evidence.
create or replace function public.moderation_queue()
returns table (id uuid, request_ref text, target_type text, target_id uuid, target_owner uuid, target_username text,
               reason text, note text, priority text, state text, created_at timestamptz, reports_on_target bigint,
               title text, body text, preview_image_id text, evidence jsonb)
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
         r.evidence
    from public.reports r left join public.profiles p on p.user_id = r.target_owner_id
   where r.state in ('open', 'reviewing')
   order by case r.priority when 'urgent' then 0 else 1 end, r.created_at
   limit 200;
end $$;
revoke all on function public.moderation_queue() from public;
grant execute on function public.moderation_queue() to authenticated;
