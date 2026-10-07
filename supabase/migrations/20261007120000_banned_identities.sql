-- 063 · A banned person does not come back (spec 13.4 #5). `blocked_identities` has existed
-- since 001 and nothing ever wrote to it. Now a ban records one-way hashes of the account's
-- email and of each sign-in identity (Google's subject id, say), and `claim_profile` refuses
-- a new account whose email or identity hashes to a listed one (P0007 - the username screen
-- says the account cannot be opened, and nothing more). Hashes only: the table never holds an
-- address. Both functions are their latest versions (062 and 048) plus the one call each (L31).

create or replace function private.identity_hashes(p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array_cat(
    array[(select encode(sha256(lower(u.email)::bytea), 'hex') from auth.users u where u.id = p_user and u.email is not null)],
    coalesce((select array_agg(encode(sha256((i.provider || ':' || i.provider_id)::bytea), 'hex'))
                from auth.identities i where i.user_id = p_user and i.provider <> 'email'), '{}')
  ), null);
$$;
revoke all on function private.identity_hashes(uuid) from public, anon, authenticated;

create or replace function private.remember_banned_identity(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  foreach h in array coalesce(private.identity_hashes(p_user), '{}') loop
    insert into public.blocked_identities (email_hash, provider_id_hash, reason)
    values (case when h = (select encode(sha256(lower(u.email)::bytea), 'hex') from auth.users u where u.id = p_user) then h end,
            case when h <> coalesce((select encode(sha256(lower(u.email)::bytea), 'hex') from auth.users u where u.id = p_user), '') then h end,
            p_reason);
  end loop;
end $$;
revoke all on function private.remember_banned_identity(uuid, text) from public, anon, authenticated;

create or replace function private.is_banned_identity(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocked_identities b
     where (b.expires_at is null or b.expires_at > now())
       and (b.email_hash = any (private.identity_hashes(p_user)) or b.provider_id_hash = any (private.identity_hashes(p_user)))
  );
$$;
revoke all on function private.is_banned_identity(uuid) from public, anon, authenticated;

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
  if (select private.is_banned_identity(me)) then
    raise exception 'claim_profile: this account cannot be opened' using errcode = 'P0007';
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
