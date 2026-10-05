-- Tests for mute (migration 034): yours alone, and the muted person is not told and not hidden.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);
insert into auth.users (id, email) values
  ('b0b0b0b0-0000-4000-8000-000000000001', 'muter@test.kleit'),
  ('b0b0b0b0-0000-4000-8000-000000000002', 'muted@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b0b0b0b0-0000-4000-8000-000000000001', 'muter', now(), 't'),
  ('b0b0b0b0-0000-4000-8000-000000000002', 'muted', now(), 't');
create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select pg_temp.act_as('b0b0b0b0-0000-4000-8000-000000000001');
insert into mutes (muter_id, muted_id) values ('b0b0b0b0-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000002');
select throws_ok($$ insert into mutes (muter_id, muted_id) values ('b0b0b0b0-0000-4000-8000-000000000002', 'b0b0b0b0-0000-4000-8000-000000000001') $$, '42501', null, 'muter: cannot mute in someone else''s name');
select is((select count(*)::int from muted_people()), 1, 'muter: the list shows one');
select is((select count(*)::int from profiles where username = 'muted'), 1, 'muter: still sees the muted person''s profile (mute is quiet, not a block)');
select pg_temp.act_as('b0b0b0b0-0000-4000-8000-000000000002');
select is((select count(*)::int from mutes), 0, 'muted: cannot see that they were muted');
select is((select count(*)::int from notifications where user_id = 'b0b0b0b0-0000-4000-8000-000000000002'), 0, 'muted: was not told');
select * from finish();
rollback;
