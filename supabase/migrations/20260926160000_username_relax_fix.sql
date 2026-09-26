-- Migration 008 — fix the rule migration 007 shipped (roadmap M1.7).
--
-- 007 refused our name when paired with a word that claims to speak for us, and looked for that
-- word in the FOLDED form. Folding maps l to i, so "official" becomes "officiai" and the check
-- missed @kleit_official and @officialkleit — the exact names it exists to refuse.
--
-- This is a new file rather than an edit to 007 because 007 had already run: Supabase applies a
-- migration once and skips it forever after, so editing an applied file changes the repository
-- and nothing else. The tests caught it; the run log did not.
create or replace function public.username_status(candidate text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with forms as (
    select private.fold_username(candidate) as folded,
           translate(lower(coalesce(candidate, '')), '._', '') as plain
  )
  select case
    when candidate is null or candidate !~ '^[a-z0-9._]{3,30}$' then 'shape'
    when candidate ~ '^[._]' or candidate ~ '[._]$' or candidate ~ '[._]{2}' then 'shape'
    -- Our name, on its own. ("kleit" folds to "kieit".)
    when (select folded from forms) = 'kieit' then 'reserved'
    -- Our name, plus a word that claims to speak for us. Looked for in both forms: the plain one
    -- catches ordinary spellings, the folded one catches @k1eit.supp0rt.
    when (select folded from forms) like '%kieit%'
     and (
       (select plain from forms) ~ '(official|support|team|app|hq|admin|help|staff|service|care|verified|real)'
       or (select folded from forms) ~ '(officiai|support|team|app|hq|admin|heip|staff|service|care|verified|reai)'
     )
      then 'reserved'
    -- A reserved word, however it is punctuated or spelled with lookalike characters.
    when exists (
      select 1 from public.reserved_usernames r
      where private.fold_username(r.username) = (select folded from forms)
    ) then 'reserved'
    when exists (select 1 from public.profiles p where p.username = candidate) then 'taken'
    else 'free'
  end;
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;
