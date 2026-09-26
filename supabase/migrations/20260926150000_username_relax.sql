-- Migration 007 — stop refusing real people (roadmap M1.7; the owner's decision, 2026-09-26).
--
-- Migrations 004-006 refused any username containing our own name, which also refused real
-- surnames: Kleitman, Kleiter, Kleitsch, and — once lookalike letters were folded — Kielty.
-- Telling Ms Kielty her own name "isn't one we can give out" is a worse outcome than someone
-- calling themselves @kleitfan.
--
-- The thing actually worth stopping is someone claiming to BE Kleit. So our name is refused when
-- it is the whole username, or when it is paired with a word that claims to speak for us. On its
-- own inside a longer name, it is just a name.
--
-- The lookalike folding from 005 and 006 stays: it costs real people nothing now that the rule is
-- this narrow, and it is what stops @k1eit and @adnnin. We are not extending it further.

create or replace function public.username_status(candidate text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with folded as (select private.fold_username(candidate) as f)
  select case
    when candidate is null or candidate !~ '^[a-z0-9._]{3,30}$' then 'shape'
    when candidate ~ '^[._]' or candidate ~ '[._]$' or candidate ~ '[._]{2}' then 'shape'
    -- Our name, on its own. ("kleit" folds to "kieit".)
    when (select f from folded) = 'kieit' then 'reserved'
    -- Our name, plus a word that claims to speak for us. The word is looked for in BOTH the
    -- folded form and the plainly-stripped one: folding maps l to i, which turns "official" into
    -- "officiai" and would have missed @kleit_official entirely. The folded form is what catches
    -- @k1eit.supp0rt; the plain form is what catches the ordinary spellings.
    when (select f from folded) like '%kieit%'
     and (
       (select f from folded) ~ '(officiai|support|team|app|hq|admin|heip|staff|service|care|verified|reai)'
       or translate(lower(candidate), '._', '') ~ '(official|support|team|app|hq|admin|help|staff|service|care|verified|real)'
     )
      then 'reserved'
    -- A reserved word, however it is punctuated or spelled with lookalike characters.
    when exists (
      select 1 from public.reserved_usernames r
      where private.fold_username(r.username) = (select f from folded)
    ) then 'reserved'
    when exists (select 1 from public.profiles p where p.username = candidate) then 'taken'
    else 'free'
  end;
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;

-- "kleitteam" was added to the reserved list in 005; it is covered by the rule above now, and
-- leaving it in would refuse a hypothetical real "Kleit Team" surname for no extra safety.
delete from public.reserved_usernames where username = 'kleitteam';
