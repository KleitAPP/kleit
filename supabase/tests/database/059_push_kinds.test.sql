-- Tests for migration 078: a like never pushes; a kind the person turned off never pushes; the
-- twenty-a-day limit holds; and a new kind is on until it is turned off.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into auth.users (id, email) values
  ('acacacac-0000-4000-8000-000000000001', 'kinds-owner@test.kleit'),
  ('acacacac-0000-4000-8000-000000000002', 'kinds-fan@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('acacacac-0000-4000-8000-000000000001', 'kindsowner', now(), 't'),
  ('acacacac-0000-4000-8000-000000000002', 'kindsfan', now(), 't');
update app_settings set value = 'true' where key = 'push_open';
insert into push_settings (user_id, enabled, timezone, muted_kinds) values
  ('acacacac-0000-4000-8000-000000000001', true, 'UTC', '{vote}');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A like is in-app only.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('acacacac-0000-4000-8000-000000000001', 'like', 'acacacac-0000-4000-8000-000000000002', 'set', gen_random_uuid());
select is((select count(*)::int from push_queue where user_id = 'acacacac-0000-4000-8000-000000000001'), 0, 'a like never becomes a push');

-- A kind the person turned off.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('acacacac-0000-4000-8000-000000000001', 'vote', 'acacacac-0000-4000-8000-000000000002', 'poll', gen_random_uuid());
select is((select count(*)::int from push_queue where user_id = 'acacacac-0000-4000-8000-000000000001'), 0, 'a kind turned off never becomes a push');

-- A kind left on does.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('acacacac-0000-4000-8000-000000000001', 'follow', 'acacacac-0000-4000-8000-000000000002', 'profile', 'acacacac-0000-4000-8000-000000000002');
select is((select count(*)::int from push_queue where user_id = 'acacacac-0000-4000-8000-000000000001' and kind = 'follow'), 1, 'a kind left on becomes a push');

-- The person turns a kind off themselves, and only their own row.
select pg_temp.act_as('acacacac-0000-4000-8000-000000000001');
select lives_ok($$ update push_settings set muted_kinds = '{vote,comment}' where user_id = 'acacacac-0000-4000-8000-000000000001' $$, 'owner: chooses which kinds reach the phone');
reset role; select set_config('request.jwt.claims', '', true);
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('acacacac-0000-4000-8000-000000000001', 'comment', 'acacacac-0000-4000-8000-000000000002', 'set', gen_random_uuid());
select is((select count(*)::int from push_queue where user_id = 'acacacac-0000-4000-8000-000000000001' and kind = 'comment'), 0, 'the newly turned-off kind stays quiet');

-- Twenty a day: nineteen more messages queue, the twenty-first does not.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id)
select 'acacacac-0000-4000-8000-000000000001', 'message', 'acacacac-0000-4000-8000-000000000002', 'conversation', gen_random_uuid()
from generate_series(1, 25);
select is((select count(*)::int from push_queue where user_id = 'acacacac-0000-4000-8000-000000000001'), 20, 'twenty pushes a day to one person, and no more');

select * from finish();
rollback;
