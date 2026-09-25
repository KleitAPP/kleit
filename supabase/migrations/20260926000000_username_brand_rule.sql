-- Migration 004 — nobody may put our own name in a username (roadmap M1.7; owner's decision 2026-09-25).
--
-- Found by testing migration 003 on the live test site: the reserved list matched exact names only,
-- so @kleit_official, @kleitsupport, @kleit.app and @officialkleit were all free to take. Anyone
-- could have been the company. The exact-match list still covers staff-sounding words on their own
-- (@admin, @support); the owner's call is that @admin.wears is a problem for moderation and a
-- verified badge later, while @kleit_official is a problem right now.

-- Why a reason and not just yes/no: the sign-up screen used to answer every refusal with
-- "taken - try @admin.wears", which handed people the near-miss name. It cannot write better
-- wording without knowing WHY a name was refused.
create or replace function public.username_status(candidate text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when candidate is null or candidate !~ '^[a-z0-9._]{3,30}$' then 'shape'
    when candidate ~ '^[._]' or candidate ~ '[._]$' or candidate ~ '[._]{2}' then 'shape'
    -- Our own name, anywhere in the username, however it is spaced or punctuated.
    when translate(candidate, '._', '') like '%kleit%' then 'reserved'
    when exists (select 1 from public.reserved_usernames r where r.username = candidate) then 'reserved'
    when exists (select 1 from public.profiles p where p.username = candidate) then 'taken'
    else 'free'
  end;
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;

-- The yes/no answer now comes from the same one place, so the two can never drift apart.
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.username_status(candidate) = 'free';
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
