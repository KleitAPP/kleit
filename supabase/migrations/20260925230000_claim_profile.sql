-- Migration 003 — claiming a username (roadmap M1.7; spec 3.3, 3.6, 3.7 #13; technical pack §3 row 1).
--
-- Why this is a function and not an insert from the app: finishing sign-up has to write TWO rows,
-- and the app is allowed to write only one of them. `age_confirmations` is server-only (no policy,
-- revoked from anon and authenticated) because spec 3.7 #13 keeps the 18+ record for a year AFTER
-- the account is deleted. It also must not be the app that decides when someone confirmed being 18,
-- or the record is worth nothing. So both rows are written here, together, by the database.

-- The names nobody may take: anything that could impersonate Kleit, anything that would collide
-- with a route on our own domain, and the usual pretending-to-be-staff words (spec 3.6 #5).
create table public.reserved_usernames (
  username text primary key
);
alter table public.reserved_usernames enable row level security;
revoke insert, update, delete, truncate on table public.reserved_usernames from anon, authenticated;
-- Anyone signing up may read it, so the app can say "that one is taken" before they press Next.
create policy "reserved_usernames: anyone reads" on public.reserved_usernames
  for select to anon, authenticated using (true);

insert into public.reserved_usernames (username) values
  ('kleit'), ('kleitapp'), ('kleit_app'), ('team'), ('support'), ('help'), ('admin'), ('admins'),
  ('administrator'), ('moderator'), ('mod'), ('staff'), ('official'), ('security'), ('privacy'),
  ('legal'), ('terms'), ('billing'), ('payments'), ('root'), ('system'), ('info'), ('contact'),
  ('about'), ('settings'), ('login'), ('signin'), ('signup'), ('join'), ('welcome'), ('home'),
  ('search'), ('create'), ('inbox'), ('you'), ('explore'), ('featured'), ('contests'), ('groups'),
  ('api'), ('www'), ('mail'), ('ftp'), ('cdn'), ('assets'), ('static'), ('s'), ('u'), ('me'),
  ('null'), ('undefined'), ('anonymous'), ('deleted'), ('everyone'), ('all');

-- ---------------------------------------------------------------------------
-- Is this username free to take? Used by the app while someone is typing, and again inside
-- claim_profile, because a check in the app is a courtesy and never a rule.
-- ---------------------------------------------------------------------------
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select candidate ~ '^[a-z0-9._]{3,30}$'
     and candidate !~ '^[._]'
     and candidate !~ '[._]$'
     and candidate !~ '[._]{2}'
     and not exists (select 1 from public.reserved_usernames r where r.username = candidate)
     and not exists (select 1 from public.profiles p where p.username = candidate);
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Finish sign-up: take the username, write the profile, and file the 18+ record.
-- Runs as the database owner so it can write the server-only table, but it only ever acts on
-- auth.uid() — it takes no user id argument, so one account can never create another's profile.
-- ---------------------------------------------------------------------------
create or replace function public.claim_profile(
  p_username text,
  p_display_name text default '',
  p_terms_version text default 'v0.1'
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  fresh public.profiles;
begin
  if me is null then
    raise exception 'claim_profile: sign in first' using errcode = '42501';
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

  -- The 18+ record is kept apart from the profile and holds no user id, only a one-way hash of
  -- it, so that after the account is deleted the record still proves someone confirmed being 18
  -- without still naming them. purge_after is set when the account is deleted (M1.12).
  insert into public.age_confirmations (user_id_hash, terms_version)
  values (encode(sha256(me::text::bytea), 'hex'), p_terms_version);

  return fresh;
end;
$$;
revoke all on function public.claim_profile(text, text, text) from public;
grant execute on function public.claim_profile(text, text, text) to authenticated;
