-- Tests for migration 007 (roadmap M1.7; the owner's decision 2026-09-26). Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

-- Real people get their own names back. Kleitman is a real surname; so is Kielty.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['kleitman','kleiter','kleitsch','kielty','kielty.fits','kleitman.wears',
                       'kleitfan','lovekleit','kleitlover','kleitish']) as n),
  'a real name that happens to contain ours is free');

-- Claiming to BE Kleit is still refused.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['kleit','kleitapp','kleit.app','kleitsupport','kleit_official',
                       'officialkleit','kleithq','kleit.team','kleithelp','kleitcare']) as n),
  'our name plus a word that speaks for us is still refused');

-- Lookalike spellings of those are still refused: the folding from 005 and 006 still applies.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['k1eit','kle17','klelt','k1ei7','k1eit.support','k1eitapp']) as n),
  'lookalike spellings of the refused forms are still refused');

-- Staff words on their own are unchanged.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['admin','a.dmin','adrnin','support','verified','owner','4dmin']) as n),
  'staff words on their own are still refused');

-- Ordinary names unaffected.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['jaywears','ellie.fits','kit.carson','lola5','admin.wears','oslo','iris']) as n),
  'ordinary names are still free');

select is(username_status('ab'), 'shape', 'shape rules still come first');

select * from finish();
rollback;
