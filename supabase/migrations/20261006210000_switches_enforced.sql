-- 048 · The emergency switches bite (roadmap M7.3 "Done when": flipping signups_open off actually
-- stops sign-ups), the admin audit log for views of private data (spec 13.4 #9), suspend/lift
-- by hand, and the admin's user lookup. The switches were read by the app only; now the
-- database refuses too, so a client that ignores the app cannot ignore the switch.

-- signups_open: no new profile while it is off.
create or replace function public.claim_profile(p_username text, p_display_name text default '', p_terms_version text default 'v0.1')
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  fresh public.profiles;
begin
  if me is null then
    raise exception 'claim_profile: sign in first' using errcode = '42501';
  end if;
  if coalesce((select s.value::text from public.app_settings s where s.key = 'signups_open'), 'true') <> 'true' then
    raise exception 'claim_profile: sign-ups are closed right now' using errcode = 'P0004';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = me) then
    raise exception 'claim_profile: this account already has a profile' using errcode = '23505';
  end if;
  if not public.username_available(p_username) then
    raise exception 'claim_profile: that username is not available' using errcode = '23514';
  end if;
  insert into public.profiles (user_id, username, display_name, age_confirmed_at, terms_version)
  values (me, p_username, coalesce(left(p_display_name, 50), ''), now(), p_terms_version)
  returning * into fresh;
  insert into public.age_confirmations (user_id_hash, terms_version)
  values (encode(sha256(me::text::bytea), 'hex'), p_terms_version);
  return fresh;
end;
$$;

-- posting_open: nothing new is published while it is off (drafts may still be saved).
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
     or new.featured_at is distinct from old.featured_at then
    raise exception 'owner_id, takedown_state, share_code and featured_at are set by the server only';
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

-- Every admin view of private data is logged with a reason (spec 13.4 #9).
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users (id) on delete cascade,
  what text not null constraint admin_audit_what check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban')),
  target_id uuid,
  reason text not null default '' constraint admin_audit_reason_length check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon;
revoke insert, update, delete, truncate on table public.admin_audit_log from authenticated;
create policy "admin_audit_log: admins read" on public.admin_audit_log for select to authenticated using ((select private.is_admin()));

create or replace function public.log_private_view(p_what text, p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), p_what, p_target, btrim(p_reason));
end $$;
revoke all on function public.log_private_view(text, uuid, text) from public;
grant execute on function public.log_private_view(text, uuid, text) to authenticated;

-- Suspend or lift by hand (S100), logged.
create or replace function public.set_suspended(p_user uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'not yourself' using errcode = 'P0001'; end if;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set banned_at = case when p_on then coalesce(banned_at, now()) else null end where user_id = p_user;
  perform set_config('kleit.server_write', was, true);
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'profile', p_user, p_user, case when p_on then 'ban' else 'unban' end, btrim(p_reason));
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), case when p_on then 'ban' else 'unban' end, p_user, btrim(p_reason));
end $$;
revoke all on function public.set_suspended(uuid, boolean, text) from public;
grant execute on function public.set_suspended(uuid, boolean, text) to authenticated;

-- The user lookup (S100): one person, their state, strikes and the reports about them. Logged.
create or replace function public.admin_user_lookup(p_username text, p_reason text)
returns table (user_id uuid, username text, display_name text, created_at timestamptz, banned_at timestamptz, deactivated_at timestamptz,
               is_private boolean, points integer, live_strikes bigint, reports_about bigint, sets_published bigint, actions jsonb)
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select p.user_id into u from public.profiles p where lower(p.username) = lower(btrim(p_username));
  if u is null then return; end if;
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), 'user_lookup', u, btrim(p_reason));
  return query
  select p.user_id, p.username, p.display_name, p.created_at, p.banned_at, p.deactivated_at, p.is_private, p.points,
         (select count(*) from public.strikes s where s.user_id = u and s.expires_at > now()),
         (select count(*) from public.reports r where r.target_owner_id = u),
         (select count(*) from public.sets s where s.owner_id = u and s.status = 'published' and s.deleted_at is null),
         coalesce((select jsonb_agg(jsonb_build_object('action', m.action, 'note', m.note, 'at', m.created_at) order by m.created_at desc)
                     from (select * from public.moderation_actions m where m.target_user_id = u order by m.created_at desc limit 20) m), '[]'::jsonb)
    from public.profiles p where p.user_id = u;
end $$;
revoke all on function public.admin_user_lookup(text, text) from public;
grant execute on function public.admin_user_lookup(text, text) to authenticated;
