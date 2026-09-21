-- Migration 001 — people (roadmap M1.4; technical pack §1.1, §3 rows 1–6, 60, 61, §6A).
-- Every table: RLS switched on IN THIS FILE, with its policies, never later (spec 15.2 #3).
-- Each policy compares the row to the signed-in user's own id (security plan #4).
-- Tables nobody but our server code may touch have RLS on and NO policy, and their
-- privileges are revoked from the public API roles as a second lock.
-- "Server" below = edge functions using the secret key, which bypasses RLS by design.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. user_roles — who is staff. Users can never write here (security plan #5).
--    Permissions row 3: read server + admins; create/change/delete server only.
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'moderator');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
revoke all on table public.user_roles from anon;
revoke insert, update, delete, truncate on table public.user_roles from authenticated;

-- Security definer so a policy can ask "is the CALLER an admin?" without the caller being
-- able to read user_roles. It only ever checks auth.uid() — never an argument — so it
-- cannot be used to probe anyone else's role (security plan #8).
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create policy "user_roles: admins read" on public.user_roles
  for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 1. profiles — one row per user, the public-facing part (spec 2.5 #1, 3.3, 3.6).
--    No birthday. No phone number (that is private_contact).
--    Permissions row 1: read anyone signed in (signed-out only the creator card, via a
--    function at M1.9); create the owner once; change the owner; delete server.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    constraint profiles_username_format check (username ~ '^[a-z0-9._]{3,30}$'),
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 50),
  avatar_url text,
  bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 160),
  is_private boolean not null default false,
  findable_by_email boolean not null default false,
  findable_by_phone boolean not null default false,
  suggestable boolean not null default true,
  style_vibes text[] not null default '{}',
  age_confirmed_at timestamptz not null,
  terms_version text not null,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
revoke delete, truncate on table public.profiles from authenticated;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- A deactivated account is hidden from everyone but its owner (spec 3.6 #8).
create policy "profiles: signed-in read" on public.profiles
  for select to authenticated
  using (deactivated_at is null or user_id = (select auth.uid()));

create policy "profiles: owner creates own row" on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles: owner updates own row" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The owner may edit their profile, but not rewrite when they confirmed 18+ or when the
-- row was made. (terms_version may change: re-accepting new Terms, spec 3.3 #1.4.)
create or replace function private.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id
     or new.created_at <> old.created_at
     or new.age_confirmed_at < old.age_confirmed_at then
    raise exception 'profiles: user_id, created_at and age_confirmed_at cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

-- ---------------------------------------------------------------------------
-- 2. private_contact — what nobody else may see (spec 3.5, security plan #10).
--    Permissions row 2: read owner + server; create/change server (after the Twilio
--    check, M1.11); delete owner or server.
-- ---------------------------------------------------------------------------
create table public.private_contact (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_e164 text
    constraint private_contact_e164_us check (phone_e164 is null or phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  phone_hash text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.private_contact enable row level security;
revoke all on table public.private_contact from anon;
revoke insert, update, truncate on table public.private_contact from authenticated;

create trigger private_contact_touch before update on public.private_contact
  for each row execute function private.touch_updated_at();

create policy "private_contact: owner reads" on public.private_contact
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "private_contact: owner deletes" on public.private_contact
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. user_devices — "Where you're signed in" (spec 3.6 #6).
--    Permissions row 4: read owner; create/change server; delete owner (sign out), server.
-- ---------------------------------------------------------------------------
create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid,
  device_label text not null default '',
  city text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index user_devices_user_id_idx on public.user_devices (user_id);
alter table public.user_devices enable row level security;
revoke all on table public.user_devices from anon;
revoke insert, update, truncate on table public.user_devices from authenticated;

create policy "user_devices: owner reads" on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_devices: owner deletes (sign out)" on public.user_devices
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. account_deletions — the 7-day grace period (spec 3.7).
--    Permissions row 5: read owner; create owner via the delete-account function (M1.12);
--    change/delete server.
-- ---------------------------------------------------------------------------
create type public.deletion_state as enum ('pending', 'cancelled', 'completed');

create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state public.deletion_state not null default 'pending',
  requested_at timestamptz not null default now(),
  final_at timestamptz not null default (now() + interval '7 days'),
  cancelled_at timestamptz
);
alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from anon;
revoke insert, update, delete, truncate on table public.account_deletions from authenticated;

create policy "account_deletions: owner reads" on public.account_deletions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 60. username_history — max 2 username changes per 14 days; the old name is held
--     14 days for its owner only; no redirect (spec 3.6 #5).
--     Permissions row 60: read owner + server; create server only; change nobody; delete server.
--     Rows are written by the trigger below, never by the app.
-- ---------------------------------------------------------------------------
create table public.username_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  old_username text not null,
  changed_at timestamptz not null default now(),
  held_until timestamptz not null default (now() + interval '14 days')
);
create index username_history_user_idx on public.username_history (user_id, changed_at desc);
create index username_history_held_idx on public.username_history (old_username, held_until);
alter table public.username_history enable row level security;
revoke all on table public.username_history from anon;
revoke insert, update, delete, truncate on table public.username_history from authenticated;

create policy "username_history: owner reads" on public.username_history
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Enforced in the database, not the screen (security plan #6): a third change inside
-- 14 days is refused, and a name someone else gave up in the last 14 days is refused.
create or replace function private.profiles_username_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    if (select count(*) from public.username_history h
        where h.user_id = old.user_id and h.changed_at > now() - interval '14 days') >= 2 then
      raise exception 'username: at most 2 changes every 14 days' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.username_history h
               where h.old_username = new.username and h.held_until > now()
                 and h.user_id <> old.user_id) then
      raise exception 'username: that name is being held for 14 days' using errcode = 'P0001';
    end if;
    insert into public.username_history (user_id, old_username)
      values (old.user_id, old.username);
  end if;
  return new;
end;
$$;
revoke all on function private.profiles_username_rules() from public;
create trigger profiles_username_rules before update of username on public.profiles
  for each row execute function private.profiles_username_rules();

-- A new account may not take a name that is still being held for someone else.
create or replace function private.profiles_username_hold_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.username_history h
             where h.old_username = new.username and h.held_until > now()
               and h.user_id <> new.user_id) then
    raise exception 'username: that name is being held for 14 days' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.profiles_username_hold_on_insert() from public;
create trigger profiles_username_hold_on_insert before insert on public.profiles
  for each row execute function private.profiles_username_hold_on_insert();

-- ---------------------------------------------------------------------------
-- 61. age_confirmations — the 18+ record, kept 1 year AFTER the account is deleted
--     (spec 3.7 #13), so it cannot live on profiles. Server only.
-- ---------------------------------------------------------------------------
create table public.age_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id_hash text not null,
  terms_version text not null,
  confirmed_at timestamptz not null default now(),
  purge_after timestamptz
);
create index age_confirmations_hash_idx on public.age_confirmations (user_id_hash);
alter table public.age_confirmations enable row level security;
revoke all on table public.age_confirmations from anon, authenticated;
-- No policy: only server code (secret key) reads or writes this table.

-- ---------------------------------------------------------------------------
-- 6. blocked_identities — stops banned people coming back (spec 13.4 #5). Server only.
-- ---------------------------------------------------------------------------
create table public.blocked_identities (
  id uuid primary key default gen_random_uuid(),
  email_hash text,
  device_id_hash text,
  provider_id_hash text,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint blocked_identities_has_identity
    check (email_hash is not null or device_id_hash is not null or provider_id_hash is not null)
);
alter table public.blocked_identities enable row level security;
revoke all on table public.blocked_identities from anon, authenticated;
-- No policy: only server code (secret key) reads or writes this table.
