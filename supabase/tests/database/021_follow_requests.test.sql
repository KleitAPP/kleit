-- Tests for follow requests (migration 026; roadmap M5.1 "Done when": a private account's
-- follow request must be approved before any set is visible).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'privateperson@test.kleit'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'asker@test.kleit'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'bystander@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, is_private) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'privateperson', now(), 't', true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'asker', now(), 't', false),
  ('eeeeeeee-0000-4000-8000-000000000003', 'bystander', now(), 't', false);
-- A followers-only set of the private person's.
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('95959595-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'for followers', 'published', 'followers', 'followersonly001');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The asker cannot simply follow a private account, and cannot see the followers-only set.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000002');
select throws_ok($$ insert into follows (follower_id, followee_id) values ('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  '42501', null, 'asker: a private account cannot be followed directly');
select is((select count(*)::int from sets where id = '95959595-0000-4000-8000-000000000001'), 0, 'asker: the followers-only set is invisible before approval');
select lives_ok($$ insert into follow_requests (requester_id, target_id) values ('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  'asker: can ask to follow');
select throws_ok($$ insert into follow_requests (requester_id, target_id) values ('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000003') $$,
  '42501', null, 'asker: cannot "request" a public account (just follow it)');
select throws_ok($$ insert into follow_requests (requester_id, target_id) values ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  '42501', null, 'asker: cannot file a request in someone else''s name');
select is((select approve_follow_request('eeeeeeee-0000-4000-8000-000000000002')), false, 'asker: cannot approve their own request (it is not addressed to them)');

-- A bystander sees nothing of it.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000003');
select is((select count(*)::int from follow_requests), 0, 'bystander: sees no request');
select is((select approve_follow_request('eeeeeeee-0000-4000-8000-000000000002')), false, 'bystander: cannot approve a request addressed to someone else');

-- The private person sees it and approves it.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000001');
select is((select count(*)::int from follow_requests where target_id = 'eeeeeeee-0000-4000-8000-000000000001'), 1, 'private person: sees the request');
select is((select approve_follow_request('eeeeeeee-0000-4000-8000-000000000002')), true, 'private person: approves it');
select is((select count(*)::int from follow_requests), 0, 'private person: the request is gone');
select is((select private.is_following('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001')), true, 'the follow now exists');

-- Now the asker sees the followers-only set.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000002');
select is((select count(*)::int from sets where id = '95959595-0000-4000-8000-000000000001'), 1, 'asker: the followers-only set is visible after approval');

-- A block from the private person removes the follow, quietly.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000001');
insert into blocks (blocker_id, blocked_id) values ('eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002');
select is((select private.is_following('eeeeeeee-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001')), false, 'a block removes the follow');

select * from finish();
rollback;
