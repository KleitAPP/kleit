-- Migration 006 — finish the folding (roadmap M1.7; lesson L25).
--
-- Migration 005 folded 1/l/i, 0/o, 3/e and 5/s, and an independent re-test walked through the
-- two characters it missed: @kle17 and @k1ei7 were still free, and so were @4dmin, @5t4ff and
-- @r007. It also found a class 005 never considered — pairs of letters that draw the same shape
-- as one letter: @adrnin (rn), @aclmin (cl) and @ovvner (vv) are indistinguishable from @admin
-- and @owner in a proportional font.
--
-- Affixes (@admin1, @theadmin) stay free on purpose: the owner's decision of 2026-09-25 is that
-- staff words are refused on their own, and that pretending to be staff is what reporting and a
-- verified badge are for. Our own name is the one that is refused anywhere in a username.

create or replace function private.fold_username(candidate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
           -- 3. characters that draw the same shape: 1/l/i, 0/o, 3/e, 5/s, 4/a, 7/t
           replace(replace(replace(
             -- 2. pairs of letters that draw one letter's shape
             translate(lower(coalesce(candidate, '')), '._', ''),
             'rn', 'm'), 'cl', 'd'), 'vv', 'w'),
           '10354l7', 'ioesait');
$$;
