-- Tests for contests (migration 038; roadmap M6.4 "Done when": a challenge opens, accepts
-- entries, and closes on time with badges only).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('c0c0c0c0-0000-4000-8000-000000000001', 'staff@test.kleit'),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'entrant@test.kleit'),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'rival@test.kleit'),
  ('c0c0c0c0-0000-4000-8000-000000000004', 'fan@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('c0c0c0c0-0000-4000-8000-000000000001', 'staff', now(), 't'),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'entrant', now(), 't'),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'rival', now(), 't'),
  ('c0c0c0c0-0000-4000-8000-000000000004', 'fan', now(), 't');
insert into user_roles (user_id, role) values ('c0c0c0c0-0000-4000-8000-000000000001', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ce000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'entrant public', 'published', 'public', 'contestentpub001', now()),
  ('ce000000-0000-4000-8000-000000000002', 'c0c0c0c0-0000-4000-8000-000000000002', 'entrant draft', 'draft', 'public', 'contestentdft002', null),
  ('ce000000-0000-4000-8000-000000000003', 'c0c0c0c0-0000-4000-8000-000000000002', 'entrant only me', 'published', 'only_me', 'contestentome003', now()),
  ('ce000000-0000-4000-8000-000000000004', 'c0c0c0c0-0000-4000-8000-000000000003', 'rival public', 'published', 'public', 'contestrivpub004', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Opening one: staff only.
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000002');
select throws_ok($$ insert into contests (id, title, closes_at, created_by) values ('cc000000-0000-4000-8000-000000000009', 'mine', now() + interval '1 day', 'c0c0c0c0-0000-4000-8000-000000000002') $$, '42501', null, 'entrant: cannot open a contest');
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000001');
select lives_ok($$ insert into contests (id, title, theme, closes_at, created_by) values ('cc000000-0000-4000-8000-000000000001', 'Test week (ignore)', 'layers', now() + interval '1 day', 'c0c0c0c0-0000-4000-8000-000000000001') $$, 'staff: opens a contest');
insert into contests (id, title, opens_at, closes_at, created_by) values ('cc000000-0000-4000-8000-000000000002', 'Closed week (ignore)', now() - interval '8 days', now() - interval '1 day', 'c0c0c0c0-0000-4000-8000-000000000001');

-- Entering: your own public published set, while open, once.
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000002');
select is((select count(*)::int from contests where id::text like 'cc000000-%'), 2, 'entrant: sees both contests');
select lives_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001') $$, 'entrant: enters with a public set');
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003') $$, '23505', null, 'entrant: one entry per contest');
delete from contest_entries where contest_id = 'cc000000-0000-4000-8000-000000000001' and user_id = 'c0c0c0c0-0000-4000-8000-000000000002';
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002') $$, '42501', null, 'entrant: a draft cannot be entered');
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003') $$, '42501', null, 'entrant: an only-me set cannot be entered');
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004') $$, '42501', null, 'entrant: someone else''s set cannot be entered');
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000002', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001') $$, '42501', null, 'entrant: a closed contest takes no entry');
insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001');
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000003');
insert into contest_entries (contest_id, user_id, set_id) values ('cc000000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000004');

-- The board: likes since the contest opened decide the order.
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000004');
insert into likes (user_id, set_id) values ('c0c0c0c0-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000004');
select is((select count(*)::int from contest_board('cc000000-0000-4000-8000-000000000001')), 2, 'fan: the board lists both entries');
select is((select set_id from contest_board('cc000000-0000-4000-8000-000000000001') limit 1), 'ce000000-0000-4000-8000-000000000004'::uuid, 'fan: the liked entry leads');

-- Across a block, an entry is not shown.
reset role;
select set_config('request.jwt.claims', '', true);
insert into blocks (blocker_id, blocked_id) values ('c0c0c0c0-0000-4000-8000-000000000003', 'c0c0c0c0-0000-4000-8000-000000000004');
select pg_temp.act_as('c0c0c0c0-0000-4000-8000-000000000004');
select is((select count(*)::int from contest_board('cc000000-0000-4000-8000-000000000001')), 1, 'fan (blocked by the rival): the rival''s entry is gone from the board');

select * from finish();
rollback;
