-- Tests for migration 024 — the two doors the adversarial pass found, now shut.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

insert into auth.users (id, email) values ('eeeeeeee-0000-4000-8000-000000000001', 'tightowner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'tightowner', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('95959595-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'open', 'published', 'public', 'tightcode0000001');

set role anon;
select throws_ok($$ select * from set_by_share_code('tightcode0000001') $$, '42501', null, 'anon: the raw row function is not callable');
select is(shared_set('tightcode0000001') -> 'owner' ->> 'username', 'tightowner', 'anon: the curated page still works (it uses the function internally)');
select is(shared_set('tightcode0000001') ? 'owner_id', false, 'anon: and carries no owner id');
select throws_ok($$ select count(*) from reserved_usernames $$, '42501', null, 'anon: the reserved list is not readable');
reset role;
set role authenticated;
select throws_ok($$ select * from set_by_share_code('tightcode0000001') $$, '42501', null, 'signed in: the raw row function is not callable either');
reset role;

select * from finish();
rollback;
