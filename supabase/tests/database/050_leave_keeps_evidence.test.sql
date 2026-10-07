-- Tests for migration 066: leaving a conversation hides it for the leaver only; the messages
-- stay for a report; a new message brings it back; nobody can delete a thread any more.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('ecececec-0000-4000-8000-000000000001', 'lv-one@test.kleit'),
  ('ecececec-0000-4000-8000-000000000002', 'lv-two@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('ecececec-0000-4000-8000-000000000001', 'lvone', now(), 't'),
  ('ecececec-0000-4000-8000-000000000002', 'lvtwo', now(), 't');
insert into follows (follower_id, followee_id) values
  ('ecececec-0000-4000-8000-000000000001', 'ecececec-0000-4000-8000-000000000002'),
  ('ecececec-0000-4000-8000-000000000002', 'ecececec-0000-4000-8000-000000000001');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('ecececec-0000-4000-8000-000000000001');
select lives_ok($$ select send_message('ecececec-0000-4000-8000-000000000002', 'you are awful') $$, 'one: writes');
select pg_temp.act_as('ecececec-0000-4000-8000-000000000002');
select is((select count(*)::int from conversations where user_a = 'ecececec-0000-4000-8000-000000000001'), 1, 'two: sees the thread');
select throws_ok($$ delete from conversations where user_a = 'ecececec-0000-4000-8000-000000000001' $$, '42501', null, 'two: cannot delete the thread');
select lives_ok($$ select leave_conversation((select id from conversations where user_a = 'ecececec-0000-4000-8000-000000000001')) $$, 'two: leaves');
select is((select count(*)::int from conversations where user_a = 'ecececec-0000-4000-8000-000000000001'), 0, 'two: no longer sees it');
select pg_temp.act_as('ecececec-0000-4000-8000-000000000001');
select is((select count(*)::int from conversations where user_a = 'ecececec-0000-4000-8000-000000000001'), 1, 'one: still sees it, with the messages');
select lives_ok($$ select send_message('ecececec-0000-4000-8000-000000000002', 'sorry') $$, 'one: writes again');
select pg_temp.act_as('ecececec-0000-4000-8000-000000000002');
select is((select count(*)::int from conversations where user_a = 'ecececec-0000-4000-8000-000000000001'), 1, 'two: the thread is back, with everything in it to report');

select * from finish();
rollback;
