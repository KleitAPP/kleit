-- Tests for migration 006 (roadmap M1.7; lesson L25). Every name in the first two blocks was
-- accepted by the live site after migration 005, found by an independent re-test. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

-- The two characters migration 005 missed.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['kle17','k1ei7','kle1t','k1e17','4dmin','4dm1n','5t4ff','r007','supp0r7',
                       '1eg4l','4buse']) as n),
  'folding now covers 4/a and 7/t as well');

-- Pairs of letters that draw one letter's shape.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['adrnin','rnod','rnoderator','rnod.erator','aclmin','a.clmin','ovvner']) as n),
  'rn, cl and vv no longer defeat the fold');

-- Everything earlier migrations refused stays refused.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['kleit','k1eit','klelt','kl3it','kleitapp','officialkleit','a.dmin',
                       'supp.ort','st.aff','verified','owner','ceo','founder']) as n),
  'nothing that was refused before has slipped back through');

-- Ordinary names must not be caught by a wider fold. These are the ones most at risk.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['jaywears','ellie.fits','kit.carson','lola5','oslo','milk','clean',
                       'corner','iris','ollie','silas','emilio','eloise','olive','kilt']) as n),
  'ordinary names are still free under the wider fold');

-- The owner's decision of 2026-09-25 stands: staff words are refused on their own only.
select is(username_status('admin.wears'), 'free', 'admin.wears is still allowed (the owner''s call)');
select is(username_status('admin1'), 'free', 'an affix on a staff word is still allowed (the owner''s call)');

-- Shape rules still come first.
select is(username_status('ab'), 'shape', 'too short is still a shape problem');

-- The yes/no answer and the reason can never disagree.
select ok(
  (select bool_and(username_available(n) = (username_status(n) = 'free'))
     from unnest(array['jaywears','kle17','adrnin','ab','admin.wears']) as n),
  'the yes/no answer always matches the reason');

select * from finish();
rollback;
