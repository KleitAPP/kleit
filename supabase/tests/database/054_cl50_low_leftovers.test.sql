-- Tests for migration 072 (CL50: the second review's three low leftovers).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('eeeeeeee-2000-4000-8000-000000000001', 'cl50-a@test.kleit'),
  ('eeeeeeee-2000-4000-8000-000000000002', 'cl50-b@test.kleit'),
  ('eeeeeeee-2000-4000-8000-000000000003', 'cl50-c@test.kleit'),
  ('eeeeeeee-2000-4000-8000-000000000004', 'cl50-mod@test.kleit'),
  ('eeeeeeee-2000-4000-8000-000000000005', 'cl50-banned@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, dm_setting) values
  ('eeeeeeee-2000-4000-8000-000000000001', 'cl50a', now(), 't', 'everyone'),
  ('eeeeeeee-2000-4000-8000-000000000002', 'cl50b', now(), 't', 'everyone'),
  ('eeeeeeee-2000-4000-8000-000000000003', 'cl50c', now(), 't', 'everyone'),
  ('eeeeeeee-2000-4000-8000-000000000004', 'cl50mod', now(), 't', 'everyone'),
  ('eeeeeeee-2000-4000-8000-000000000005', 'cl50banned', now(), 't', 'everyone');
select set_config('kleit.server_write', '1', true);
update profiles set banned_at = now() where user_id = 'eeeeeeee-2000-4000-8000-000000000005';
select set_config('kleit.server_write', '', true);
insert into user_roles (user_id, role) values ('eeeeeeee-2000-4000-8000-000000000004', 'moderator');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. The closet bucket refuses a banned account's upload; an ordinary one still lands.
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000005');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('closet-photos', 'eeeeeeee-2000-4000-8000-000000000005/x.jpg') $$,
  '42501', null, 'banned: the closet bucket refuses the upload (no orphan file)');
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000001');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('closet-photos', 'eeeeeeee-2000-4000-8000-000000000001/x.jpg') $$,
  'member: an ordinary upload still lands');

-- 2. Messages follow their conversation.
select send_message('eeeeeeee-2000-4000-8000-000000000002', 'hello b');
select send_message('eeeeeeee-2000-4000-8000-000000000003', 'hello c');
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000002');
select is((select count(*)::int from messages where body = 'hello b'), 1, 'b: reads the message');
select leave_conversation((select id from conversations where user_a = least('eeeeeeee-2000-4000-8000-000000000001'::uuid, 'eeeeeeee-2000-4000-8000-000000000002'::uuid) and user_b = greatest('eeeeeeee-2000-4000-8000-000000000001'::uuid, 'eeeeeeee-2000-4000-8000-000000000002'::uuid)));
select is((select count(*)::int from messages where body = 'hello b'), 0, 'b: after leaving, the thread''s messages are unreadable by id');
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000001');
select is((select count(*)::int from messages where body = 'hello b'), 1, 'a: who did not leave still reads it');
select is((select count(*)::int from messages where body = 'hello c'), 1, 'a: reads the second thread before a block');
reset role;
insert into blocks (blocker_id, blocked_id) values ('eeeeeeee-2000-4000-8000-000000000003', 'eeeeeeee-2000-4000-8000-000000000001');
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000001');
select is((select count(*)::int from messages where body = 'hello c'), 0, 'a: after being blocked, the thread''s messages are unreadable');
reset role;
select is((select count(*)::int from messages where body = 'hello c'), 1, 'the row itself stays for evidence');

-- 3. A moderator cannot write the queue's own evidence row by hand.
select pg_temp.act_as('eeeeeeee-2000-4000-8000-000000000004');
select throws_ok($$ select log_private_view('dm_evidence', null, 'muting the queue') $$, '22023', null,
  'moderator: cannot write a dm_evidence row by hand');

select * from finish();
rollback;
