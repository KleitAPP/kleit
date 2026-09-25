-- Tests for migration 004 — our own name in a username (roadmap M1.7). Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

-- The four names that really were free on the live site before this migration, and must not be.
select is(username_status('kleit_official'), 'reserved', 'brand: kleit_official is refused');
select is(username_status('kleitsupport'), 'reserved', 'brand: kleitsupport is refused');
select is(username_status('kleit.app'), 'reserved', 'brand: kleit.app is refused');
select is(username_status('officialkleit'), 'reserved', 'brand: officialkleit is refused');
-- Punctuation must not be a way round it.
select is(username_status('k.l.e.i.t'), 'reserved', 'brand: dots between the letters do not help');
select is(username_status('k_l_e_i_t_fan'), 'reserved', 'brand: underscores between the letters do not help');

-- Staff words stay exact-match only. That is the owner's decision, not an oversight.
select is(username_status('admin'), 'reserved', 'staff: admin on its own is still refused');
select is(username_status('admin.wears'), 'free', 'staff: admin.wears is allowed (a badge and reporting handle this)');

-- Ordinary names are unaffected.
select is(username_status('jaywears'), 'free', 'ordinary: a plain name is free');
select is(username_status('ab'), 'shape', 'shape: too short is a shape problem, not "taken"');
select is(username_status('jay..wears'), 'shape', 'shape: two punctuation marks in a row');

-- The yes/no answer and the reason can never disagree, because one is built from the other.
select ok(
  (select bool_and(username_available(n) = (username_status(n) = 'free'))
     from unnest(array['jaywears','admin','kleitfan','ab','jay..wears','admin.wears']) as n),
  'the yes/no answer always matches the reason');

select * from finish();
rollback;
