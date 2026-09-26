-- Migration 009 — the rest of the names that read as the company (roadmap M1.7).
--
-- 008 refused our name next to one of twelve words. An independent test walked past it with
-- @kleitpassword, @kleitreset, @kleitlogin, @kleitsecurity, @kleitbilling, @kleitmail and two
-- dozen more. Those are the names a scam uses: "your Kleit password needs resetting, message
-- @kleitpassword". So the word list grows.
--
-- It grows in two parts on purpose, because the owner's instruction still stands - do not be a
-- username nazi. @kleitfan, @kleitman, @kleitmodel, @kleitcore and real surnames stay free.
--
--   ANYWHERE words are ones that only ever read as us speaking: security, password, billing.
--     Refused wherever they sit in the handle.
--   WRAPPER words are ordinary English that happens to wrap a company name: my, the, get, co,
--     mod, pay. Refused only when the handle is our name plus that word and nothing else, so
--     @kleitmodel and @kleitcore survive while @kleitmod and @mykleit do not.
--
-- Both are checked against the plain spelling and the folded one, so @k1eit.passw0rd is caught
-- too. Every "l" is written [li] because folding turns l into i.
--
-- New file, not an edit to 008: an applied migration is never re-run (lesson from 008 itself).
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
  ), words as (
    select
      -- Words that only ever read as the company itself, anywhere in the handle.
      '(officia[li]|support|team|app|hq|admin|he[li]p|staff|service|care|verified|rea[li]'
      || '|security|safety|trust|moderator|bi[li][li]ing|password|passcode|signin|signup'
      || '|[li]ogin|[li]ogon|reset|recovery|verify|notice|a[li]ert|update|bi[li][li]ed'
      || '|emai[li]|contact|press|he[li]pdesk|founder|refund|payment|invoice|b[li]ocked'
      || '|report|appea[li]|abuse)' as anywhere,
      -- Ordinary words that only impersonate when they are the whole of the rest of the handle.
      '(my|the|get|join|try|use|is|app|co|inc|corp|[li][li]c|[li]td|group|hq|team'
      || '|mod|mods|pay|pays|mai[li]|info|dotcom|com|net|org|store|shop|c[li]ub)' as wrapper
  )
  select case
    when candidate is null or candidate !~ '^[a-z0-9._]{3,30}$' then 'shape'
    when candidate ~ '^[._]' or candidate ~ '[._]$' or candidate ~ '[._]{2}' then 'shape'
    -- Our name, on its own. ("kleit" folds to "kieit".)
    when (select folded from forms) = 'kieit' then 'reserved'
    -- Our name, plus a word that claims to speak for us.
    when (select folded from forms) like '%kieit%'
     and (
       (select plain from forms) ~ (select anywhere from words)
       or (select folded from forms) ~ (select anywhere from words)
     )
      then 'reserved'
    -- Our name wrapped in one ordinary word and nothing else: @mykleit, @kleitco, @kleitmod.
    when (select folded from forms) like '%kieit%'
     and (
       (select folded from forms) ~ ('^' || (select wrapper from words) || 'kieit$')
       or (select folded from forms) ~ ('^kieit' || (select wrapper from words) || '$')
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
