-- Migration 005 — the reserved list must fold too (roadmap M1.7; lesson L25).
--
-- Migration 004 taught the BRAND check to ignore dots and underscores and left the reserved-word
-- list matching exactly. An independent test of the live site on 2026-09-26 walked straight
-- through the gap: @a.dmin, @supp.ort, @st.aff, @ro.ot and @mo.d were all free to take, and read
-- as staff to any normal person. That is lesson L23 again, applied to only half the rule.
--
-- It also found the other half: @k1eit, @kle1t, @klelt and @kl3it are indistinguishable from our
-- own name at the size a username is actually read, and they use only allowed characters, so the
-- shape rule never touched them.

-- One folded form for comparing names, never for storing them.
--   step 1: drop the separators, so a.dmin and ad_min are both admin
--   step 2: map the characters that look alike in a username - 1, l and i; 0 and o; 3 and e;
--           5 and s - onto one of each, so k1eit, klelt, kle1t and kl3it all become the same word
-- After folding, "kleit" itself becomes "kieit", which is what the brand check looks for.
create or replace function private.fold_username(candidate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(translate(lower(coalesce(candidate, '')), '._', ''), '1035l', 'ioesi');
$$;

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
    -- "kleit" folds to "kieit", and so does every lookalike spelling of it.
    when private.fold_username(candidate) like '%kieit%' then 'reserved'
    -- A reserved word stays reserved however it is punctuated or spelled: a.dmin is admin.
    when exists (
      select 1 from public.reserved_usernames r
      where private.fold_username(r.username) = private.fold_username(candidate)
    ) then 'reserved'
    when exists (select 1 from public.profiles p where p.username = candidate) then 'taken'
    else 'free'
  end;
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;

-- Names the test found free and high-value for pretending to be us or to be staff.
insert into public.reserved_usernames (username) values
  ('verified'), ('owner'), ('ceo'), ('founder'), ('abuse'), ('press'), ('postmaster'),
  ('helpdesk'), ('moderators'), ('supportteam'), ('kleitteam'), ('trust'), ('safety')
on conflict (username) do nothing;
