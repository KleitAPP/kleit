-- 087 · The invite-only beta (design pack S111; spec 23.2 #1: "20 friends first, then 100–200
-- external testers, all invite-only"). One switch, `beta_only`, off until the owner flips it at
-- /mod/switches. While it is on, finishing sign-up needs a live invite code; everyone who already
-- has a profile is untouched. Admins mint codes (each with a label, a number of uses and an
-- expiry) and can switch one off; who used which code is kept, admin-readable. The codes are
-- made here, never typed by hand: eight letters and digits that cannot be misread.
--
-- Replaced from its latest definition (L31): claim_profile (063 = 20261007120000, the newest of three).

alter table public.app_settings drop constraint app_settings_known_key;
alter table public.app_settings add constraint app_settings_known_key check (key in (
  'min_app_version', 'maintenance_mode', 'signups_open', 'posting_open',
  'dms_open', 'comments_open', 'public_links_open', 'push_open', 'beta_only'));
insert into public.app_settings (key, value) values ('beta_only', 'false') on conflict (key) do nothing;

alter table public.admin_audit_log drop constraint admin_audit_what;
alter table public.admin_audit_log add constraint admin_audit_what
  check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban', 'private_view', 'contest', 'feature', 'invite'));

create table public.beta_invites (
  code text primary key constraint beta_invites_code_shape check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  label text not null default '' constraint beta_invites_label_length check (char_length(label) <= 80),
  uses_left integer not null default 1 constraint beta_invites_uses check (uses_left >= 0),
  expires_at timestamptz,
  disabled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.beta_invites is 'Invite codes for the private beta (S111): needed to finish sign-up while app_settings.beta_only is on.';
alter table public.beta_invites enable row level security;
revoke all on table public.beta_invites from anon;
revoke insert, delete, truncate on table public.beta_invites from authenticated;
create policy "beta_invites: admins read" on public.beta_invites for select to authenticated using ((select private.is_admin()));
create policy "beta_invites: admins change" on public.beta_invites for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create table public.beta_invite_uses (
  code text not null references public.beta_invites (code) on delete cascade,
  user_id uuid primary key references auth.users (id) on delete cascade,
  used_at timestamptz not null default now()
);
alter table public.beta_invite_uses enable row level security;
revoke all on table public.beta_invite_uses from anon;
revoke insert, update, delete, truncate on table public.beta_invite_uses from authenticated;
create policy "beta_invite_uses: admins read" on public.beta_invite_uses for select to authenticated using ((select private.is_admin()));

-- Is the door invite-only right now? Readable by anyone, like the switch itself.
create or replace function public.beta_only()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value::text from public.app_settings s where s.key = 'beta_only'), 'false') = 'true';
$$;
revoke all on function public.beta_only() from public;
grant execute on function public.beta_only() to anon, authenticated;

-- A code that would be accepted right now (nothing is spent). The screen asks this before
-- moving on, so a typo is caught where it was typed.
create or replace function private.invite_is_live(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.beta_invites i
     where i.code = upper(btrim(coalesce(p_code, ''))) and i.disabled_at is null and i.uses_left > 0
       and (i.expires_at is null or i.expires_at > now()));
$$;
revoke all on function private.invite_is_live(text) from public;

create or replace function public.check_beta_invite(p_code text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return private.invite_is_live(p_code);
end $$;
revoke all on function public.check_beta_invite(text) from public;
grant execute on function public.check_beta_invite(text) to authenticated;

-- Finishing sign-up: as 063 left it, plus the invite while the beta switch is on. A code is
-- spent only when the profile is actually written (same transaction), never on a refusal.
-- The three-argument version goes first: a second overload would leave PostgREST unable to
-- choose between them.
drop function public.claim_profile(text, text, text);
create function public.claim_profile(p_username text, p_display_name text default '', p_terms_version text default 'v0.1', p_invite text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  fresh public.profiles;
  v_code text := upper(btrim(coalesce(p_invite, '')));
  v_beta boolean := public.beta_only();
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
  insert into public.profiles (user_id, username, display_name, age_confirmed_at, terms_version)
  values (me, p_username, coalesce(left(p_display_name, 50), ''), now(), p_terms_version)
  returning * into fresh;
  insert into public.age_confirmations (user_id_hash, terms_version)
  values (encode(sha256(me::text::bytea), 'hex'), p_terms_version);
  if v_beta then
    update public.beta_invites set uses_left = uses_left - 1 where code = v_code;
    insert into public.beta_invite_uses (code, user_id) values (v_code, me);
  end if;
  return fresh;
end;
$$;
revoke all on function public.claim_profile(text, text, text, text) from public;
grant execute on function public.claim_profile(text, text, text, text) to authenticated;

-- Admins mint codes: a label (who they are for), how many codes, how many uses each, how many
-- days they last (0 = no expiry). The codes come back so the screen can hand them out.
create or replace function public.mint_beta_invites(p_label text, p_count integer, p_uses integer, p_days integer)
returns setof text language plpgsql security definer set search_path = '' as $$
declare i integer; v_code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform private.require_admin();
  if p_count is null or p_count < 1 or p_count > 50 then raise exception '1 to 50 codes at a time' using errcode = '22023'; end if;
  if p_uses is null or p_uses < 1 or p_uses > 500 then raise exception '1 to 500 uses' using errcode = '22023'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then raise exception '0 to 365 days' using errcode = '22023'; end if;
  for i in 1..p_count loop
    loop
      select string_agg(substr(alphabet, (get_byte(b, j) % 32) + 1, 1), '')
        into v_code from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as j;
      exit when not exists (select 1 from public.beta_invites x where x.code = v_code);
    end loop;
    insert into public.beta_invites (code, label, uses_left, expires_at, created_by)
    values (v_code, left(btrim(coalesce(p_label, '')), 80), p_uses, case when p_days = 0 then null else now() + make_interval(days => p_days) end, auth.uid());
    return next v_code;
  end loop;
  perform private.admin_note('invite', null, 'minted ' || p_count || ' code(s) "' || left(btrim(coalesce(p_label, '')), 80) || '", ' || p_uses || ' use(s) each');
  return;
end $$;
revoke all on function public.mint_beta_invites(text, integer, integer, integer) from public;
grant execute on function public.mint_beta_invites(text, integer, integer, integer) to authenticated;

-- A code is switched off, never deleted: who used it stays on record.
create or replace function public.disable_beta_invite(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.beta_invites set disabled_at = coalesce(disabled_at, now()) where code = upper(btrim(coalesce(p_code, '')));
  if not found then return false; end if;
  perform private.admin_note('invite', null, 'switched off ' || upper(btrim(p_code)));
  return true;
end $$;
revoke all on function public.disable_beta_invite(text) from public;
grant execute on function public.disable_beta_invite(text) to authenticated;

-- The admin's list: each code with how many times it was used and by whom (usernames).
create or replace function public.admin_beta_invites()
returns table (code text, label text, uses_left integer, expires_at timestamptz, disabled_at timestamptz, created_at timestamptz, used_by text[])
language sql stable security definer set search_path = '' as $$
  select i.code, i.label, i.uses_left, i.expires_at, i.disabled_at, i.created_at,
         coalesce((select array_agg(p.username order by u.used_at) from public.beta_invite_uses u join public.profiles p on p.user_id = u.user_id where u.code = i.code), '{}'::text[])
    from public.beta_invites i
   where (select private.is_admin())
   order by i.created_at desc
   limit 500;
$$;
revoke all on function public.admin_beta_invites() from public;
grant execute on function public.admin_beta_invites() to authenticated;
