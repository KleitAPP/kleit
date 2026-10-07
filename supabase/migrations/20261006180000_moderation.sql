-- 045 · Review queue, strikes, appeals, bans (roadmap M7.2; spec 13.4 #1–#5; technical pack
-- rows 46–48). Moderators work a report through ONE door, `moderate()`: dismiss it, remove what
-- was reported, remove it with a community strike, or ban. Three active community strikes ban
-- by themselves; a ban hides the account and its sets from everyone but its owner and refuses
-- every new write. A strike can be appealed once, in one sentence; a moderator decides, and
-- the outcome is logged. Every action is a row in `moderation_actions`, never edited.

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references auth.users (id) on delete set null,
  report_id uuid references public.reports (id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  target_user_id uuid references auth.users (id) on delete set null,
  action text not null constraint moderation_actions_action check (action in ('dismiss', 'remove', 'strike', 'ban', 'unban', 'restore', 'overturn', 'uphold')),
  note text not null default '' constraint moderation_actions_note_length check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
alter table public.moderation_actions enable row level security;
revoke all on table public.moderation_actions from anon;
revoke insert, update, delete, truncate on table public.moderation_actions from authenticated;
create policy "moderation_actions: moderators read" on public.moderation_actions for select to authenticated
  using ((select private.is_moderator()));
create index moderation_actions_user_idx on public.moderation_actions (target_user_id, created_at desc);

create table public.strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'community' constraint strikes_kind check (kind in ('community', 'copyright')),
  reason text not null default '' constraint strikes_reason_length check (char_length(reason) <= 500),
  report_id uuid references public.reports (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 months'
);
alter table public.strikes enable row level security;
revoke all on table public.strikes from anon;
revoke insert, update, delete, truncate on table public.strikes from authenticated;
create policy "strikes: owner and moderators read" on public.strikes for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_moderator()));
create index strikes_user_idx on public.strikes (user_id, expires_at);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  strike_id uuid not null unique references public.strikes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null constraint appeals_body_length check (char_length(body) between 1 and 1000),
  state text not null default 'open' constraint appeals_state check (state in ('open', 'upheld', 'overturned')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  note text not null default '' constraint appeals_note_length check (char_length(note) <= 500)
);
alter table public.appeals enable row level security;
revoke all on table public.appeals from anon;
revoke update, delete, truncate on table public.appeals from authenticated;
create policy "appeals: owner and moderators read" on public.appeals for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_moderator()));
-- One appeal per strike, by the person struck, while the strike is live.
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open'
    and exists (select 1 from public.strikes s where s.id = strike_id and s.user_id = user_id and s.expires_at > now())
  );

alter table public.profiles add column banned_at timestamptz;

-- A banned account is hidden from everyone but its owner, and its sets with it.
drop policy "profiles: signed-in read" on public.profiles;
create policy "profiles: signed-in read" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (deactivated_at is null and banned_at is null and not (select private.blocked_either_way((select auth.uid()), user_id)))
  );
create or replace function private.is_banned(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = p_user and p.banned_at is not null);
$$;
revoke all on function private.is_banned(uuid) from public;
grant execute on function private.is_banned(uuid) to authenticated, anon;

create or replace function public.can_view_set(p_set_id uuid, p_viewer uuid, p_code text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sets s
    where s.id = p_set_id
      and s.takedown_state = 'none'
      and (
        s.owner_id = p_viewer
        or (
          s.status = 'published'
          and s.deleted_at is null
          and not (select private.is_banned(s.owner_id))
          and not (select private.blocked_either_way(p_viewer, s.owner_id))
          and (
            s.visibility = 'public'
            or (s.visibility = 'link' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'public' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'followers' and (select private.is_following(p_viewer, s.owner_id)))
            or (s.visibility = 'friends' and (select private.are_friends(p_viewer, s.owner_id)))
          )
        )
      )
  );
$$;

-- A banned person writes nothing new: sets, comments, likes, follows, entries, reports.
create or replace function private.refuse_if_banned()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (select private.is_banned(auth.uid())) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sets_banned before insert on public.sets for each row execute function private.refuse_if_banned();
create trigger comments_banned before insert on public.comments for each row execute function private.refuse_if_banned();
create trigger likes_banned before insert on public.likes for each row execute function private.refuse_if_banned();
create trigger follows_banned before insert on public.follows for each row execute function private.refuse_if_banned();
create trigger contest_entries_banned before insert on public.contest_entries for each row execute function private.refuse_if_banned();
create trigger messages_banned before insert on public.messages for each row execute function private.refuse_if_banned();

-- The items guard honours the same server door as the sets guard (a moderator removing a piece).
create or replace function private.items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select private.is_admin()) or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.source_url is distinct from old.source_url
     or new.image_hash is distinct from old.image_hash
     or new.takedown_state is distinct from old.takedown_state
     or new.owner_id is distinct from old.owner_id
     or new.image_bucket is distinct from old.image_bucket then
    raise exception 'source_url, image_hash, takedown_state, owner_id and image_bucket are set by the server only';
  end if;
  return new;
end;
$$;

-- Three live community strikes ban by themselves (spec 13.4 #3).
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
    insert into public.moderation_actions (moderator_id, report_id, target_type, target_id, target_user_id, action, note)
    values (null, new.report_id, 'profile', new.user_id, new.user_id, 'ban', 'third strike');
  end if;
  return new;
end $$;
create trigger strikes_ban_at_three after insert on public.strikes for each row execute function private.strikes_ban_at_three();

-- Nobody edits banned_at by hand (the profile guard from 039's shape).
create or replace function private.profiles_points_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.points is distinct from old.points or new.banned_at is distinct from old.banned_at)
     and (select auth.uid()) is not null
     and current_setting('kleit.server_write', true) is distinct from '1' then
    raise exception 'points and bans are written by the server only' using errcode = '42501';
  end if;
  return new;
end $$;

-- The door. A moderator acts on a report: dismiss · remove · strike (remove + strike) · ban.
create or replace function public.moderate(p_report uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype; me uuid := auth.uid(); was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action not in ('dismiss', 'remove', 'strike', 'ban') then raise exception 'unknown action' using errcode = '22023'; end if;
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
  if p_action = 'strike' and r.target_owner_id is not null then
    insert into public.strikes (user_id, reason, report_id) values (r.target_owner_id, coalesce(p_note, ''), r.id);
  end if;
  if p_action = 'ban' and r.target_owner_id is not null then
    update public.profiles set banned_at = coalesce(banned_at, now()) where user_id = r.target_owner_id;
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

-- Deciding an appeal: overturned ends the strike now (and lifts a third-strike ban if no three
-- strikes remain); upheld leaves it. Both are logged.
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
    if live < 3 and exists (select 1 from public.moderation_actions m where m.target_user_id = a.user_id and m.action = 'ban' and m.note = 'third strike') then
      was := coalesce(current_setting('kleit.server_write', true), '');
      perform set_config('kleit.server_write', '1', true);
      update public.profiles set banned_at = null where user_id = a.user_id;
      perform set_config('kleit.server_write', was, true);
      insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
      values (me, 'profile', a.user_id, a.user_id, 'unban', 'appeal overturned a strike');
    end if;
  end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (me, 'strike', a.strike_id, a.user_id, case when p_outcome = 'overturned' then 'overturn' else 'uphold' end, coalesce(p_note, ''));
end $$;
revoke all on function public.decide_appeal(uuid, text, text) from public;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

-- The queue, for moderators: open and reviewing reports, urgent first, with what was reported.
create or replace function public.moderation_queue()
returns table (id uuid, request_ref text, target_type text, target_id uuid, target_owner uuid, target_username text,
               reason text, note text, priority text, state text, created_at timestamptz, reports_on_target bigint,
               title text, body text, preview_image_id text, evidence jsonb)
language sql stable security definer set search_path = '' as $$
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
   where (select private.is_moderator()) and r.state in ('open', 'reviewing')
   order by case r.priority when 'urgent' then 0 else 1 end, r.created_at
   limit 200;
$$;
revoke all on function public.moderation_queue() from public;
grant execute on function public.moderation_queue() to authenticated;

-- Your strikes, with the appeal if any (the strike notice, S98).
create or replace function public.my_strikes()
returns table (id uuid, kind text, reason text, created_at timestamptz, expires_at timestamptz, appeal_state text, appeal_note text)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.kind, s.reason, s.created_at, s.expires_at, a.state, a.note
    from public.strikes s left join public.appeals a on a.strike_id = s.id
   where s.user_id = (select auth.uid())
   order by s.created_at desc;
$$;
revoke all on function public.my_strikes() from public;
grant execute on function public.my_strikes() to authenticated;
