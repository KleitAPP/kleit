-- Tests for the switches and the admin tools (migration 048; roadmap M7.3 "Done when": flipping
-- signups_open off actually stops sign-ups; every admin view of private data is logged with a
-- reason).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('c9c9c9c9-0000-4000-8000-000000000001', 'sw-newcomer@test.kleit'),
  ('c9c9c9c9-0000-4000-8000-000000000002', 'sw-maker@test.kleit'),
  ('c9c9c9c9-0000-4000-8000-000000000003', 'sw-admin@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('c9c9c9c9-0000-4000-8000-000000000002', 'swmaker', now(), 't'),
  ('c9c9c9c9-0000-4000-8000-000000000003', 'swadmin', now(), 't');
insert into user_roles (user_id, role) values ('c9c9c9c9-0000-4000-8000-000000000003', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('c9000000-0000-4000-8000-000000000001', 'c9c9c9c9-0000-4000-8000-000000000002', 'draft to publish', 'draft', 'public', 'switchesdraft001');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Sign-ups closed: no profile can be claimed; open again: it can.
update app_settings set value = 'false' where key = 'signups_open';
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000001');
select throws_ok($$ select claim_profile('swnewcomer', 'New', 'v0.1') $$, 'P0004', null, 'newcomer: sign-ups closed - refused by the database, whatever the app does');
reset role; select set_config('request.jwt.claims', '', true);
update app_settings set value = 'true' where key = 'signups_open';
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000001');
select lives_ok($$ select claim_profile('swnewcomer', 'New', 'v0.1') $$, 'newcomer: sign-ups open - the profile is claimed');

-- Posting paused: a draft cannot be published; a draft can still be saved.
reset role; select set_config('request.jwt.claims', '', true);
update app_settings set value = 'false' where key = 'posting_open';
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000002');
select throws_ok($$ update sets set status = 'published' where id = 'c9000000-0000-4000-8000-000000000001' $$, 'P0004', null, 'maker: posting paused - publish refused');
select lives_ok($$ update sets set title = 'still a draft' where id = 'c9000000-0000-4000-8000-000000000001' $$, 'maker: posting paused - a draft still saves');
reset role; select set_config('request.jwt.claims', '', true);
update app_settings set value = 'true' where key = 'posting_open';

-- Admin tools: a reason is required and logged; the maker cannot use them.
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000002');
select throws_ok($$ select * from admin_user_lookup('swadmin', 'curious') $$, '42501', null, 'maker: cannot look people up');
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000003');
select throws_ok($$ select * from admin_user_lookup('swmaker', '') $$, '22023', null, 'admin: a lookup without a reason is refused');
select is((select username from admin_user_lookup('swmaker', 'report K-TEST follow-up')), 'swmaker', 'admin: the lookup finds the person');
select is((select count(*)::int from admin_audit_log where what = 'user_lookup' and target_id = 'c9c9c9c9-0000-4000-8000-000000000002'), 1, 'admin: the lookup is in the audit log with its reason');
select set_suspended('c9c9c9c9-0000-4000-8000-000000000002', true, 'test suspension (ignore)');
select is((select banned_at is not null from profiles where user_id = 'c9c9c9c9-0000-4000-8000-000000000002'), true, 'admin: suspended by hand');
select set_suspended('c9c9c9c9-0000-4000-8000-000000000002', false, 'test lift (ignore)');
select is((select count(*)::int from admin_audit_log where what in ('ban', 'unban') and target_id = 'c9c9c9c9-0000-4000-8000-000000000002'), 2, 'admin: both the suspension and the lift are logged');

select * from finish();
rollback;
