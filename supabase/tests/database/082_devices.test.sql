-- Tests for migration 105 (spec 3.6 #6; CL66): where you're signed in. A start writes this
-- session's row and only this one; the list marks the device you are on and forgets sessions
-- Supabase has ended; signing out another device ends its session; your own is refused; nobody
-- can touch anyone else's.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('f6f6f6f6-0000-4000-8000-000000000001', 'dev-me@test.kleit'),
  ('f6f6f6f6-0000-4000-8000-000000000002', 'dev-other@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('f6f6f6f6-0000-4000-8000-000000000001', 'devme', now(), 't'),
  ('f6f6f6f6-0000-4000-8000-000000000002', 'devother', now(), 't');
-- Two live sessions for me (phone, laptop) and one for the other person.
insert into auth.sessions (id, user_id) values
  ('f6000000-0000-4000-8000-000000000011', 'f6f6f6f6-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-000000000012', 'f6f6f6f6-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-000000000021', 'f6f6f6f6-0000-4000-8000-000000000002');

create function pg_temp.act_as(uid text, sid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid)::text, true);
end $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1. The app cannot write the table by hand; touch_device writes this session's row.
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000011');
select throws_ok($$insert into user_devices (user_id, device_label) values ('f6f6f6f6-0000-4000-8000-000000000001', 'forged')$$, '42501', null, 'the app cannot insert a device row by hand');
select lives_ok($$select touch_device('iPhone · Safari')$$, 'touch_device from the phone');
select lives_ok($$select touch_device('iPhone · Safari')$$, 'and again on the next start');
select is((select count(*)::int from user_devices where user_id = 'f6f6f6f6-0000-4000-8000-000000000001'), 1, 'one row per session, however many starts');
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000012');
select touch_device('Mac · Chrome');
select is((select count(*)::int from user_devices where user_id = 'f6f6f6f6-0000-4000-8000-000000000001'), 2, 'a second session is a second row');

-- 2. The list: the device you are on first and marked; a session Supabase ended is gone.
select is((select device_label from my_devices() limit 1), 'Mac · Chrome', 'my_devices: the device you are on comes first');
select is((select this_one from my_devices() limit 1), true, 'and is marked as this one');
select is((select count(*)::int from my_devices()), 2, 'both live sessions listed');
select pg_temp.as_server();
delete from auth.sessions where id = 'f6000000-0000-4000-8000-000000000011';
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000012');
select is((select count(*)::int from my_devices()), 1, 'a session Supabase has ended drops off the list');

-- 3. Signing out another device ends its session; your own is refused; a stranger's is refused.
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000011');
select touch_device('iPhone · Safari');
select pg_temp.as_server();
insert into auth.sessions (id, user_id) values ('f6000000-0000-4000-8000-000000000011', 'f6f6f6f6-0000-4000-8000-000000000001');
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000012');
select throws_ok($$select sign_out_device((select id from user_devices where session_id = 'f6000000-0000-4000-8000-000000000012'))$$, 'P0001', null, 'your own device is refused: Sign out is for that');
select lives_ok($$select sign_out_device((select id from user_devices where session_id = 'f6000000-0000-4000-8000-000000000011'))$$, 'signing out the phone from the laptop');
select pg_temp.as_server();
select is((select count(*)::int from auth.sessions where id = 'f6000000-0000-4000-8000-000000000011'), 0, 'and the phone''s session is ended on the server');
select pg_temp.act_as('f6f6f6f6-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000021');
select throws_ok($$select sign_out_device((select id from user_devices where session_id = 'f6000000-0000-4000-8000-000000000012'))$$, '42501', null, 'a stranger cannot sign out your device (nor see its id)');

select * from finish();
rollback;
