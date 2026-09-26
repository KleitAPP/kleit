-- Tests for migration 005 (roadmap M1.7; lesson L25). Every name below was accepted by the live
-- site on 2026-09-26 by an independent tester, and must not be. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

-- Staff words, punctuated round the exact-match list.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['a.dmin','ad.min','adm.in','a_dmin','ad_min','s.upport','supp.ort',
                       'st.aff','ro.ot','he.lp','mo.d','m.od']) as n),
  'staff words stay reserved however they are punctuated');

-- Our own name, spelled with lookalike characters.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['k1eit','kle1t','klelt','kl3it','k1eitapp','k1eit.team','k1eit.support',
                       'k1eit.official']) as n),
  'lookalike spellings of our own name are refused');

-- The names that were already refused must stay refused.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['kleit','kleitapp','kleit.app','kleitsupport','officialkleit','admin',
                       'support','verified','owner','ceo','founder']) as n),
  'everything migration 004 refused is still refused');

-- The owner's decision stands: a staff word with something else attached is allowed.
select is(username_status('admin.wears'), 'free', 'admin.wears is still allowed (the owner''s call)');
select is(username_status('moderator1'), 'free', 'moderator1 is still allowed');

-- Ordinary names are not caught by the folding.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['jaywears','ellie.fits','style.notes','kit.carson','lola5','sunflower']) as n),
  'ordinary names are unaffected by the folding');

-- Shape rules still come first, so a bad shape is never reported as "taken".
select is(username_status('ab'), 'shape', 'too short is still a shape problem');
select is(username_status('jay..wears'), 'shape', 'two punctuation marks in a row');
select is(username_status('.jay'), 'shape', 'cannot start with punctuation');

-- The yes/no answer and the reason can never disagree.
select ok(
  (select bool_and(username_available(n) = (username_status(n) = 'free'))
     from unnest(array['jaywears','a.dmin','k1eit','ab','admin.wears']) as n),
  'the yes/no answer always matches the reason');

select * from finish();
rollback;
