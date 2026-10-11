-- Tests for migration 085 (S101, admin contests): the queue is the admins' to add to, reorder
-- and drop; a contest opens or closes by hand, one at a time; a pick on a closed challenge
-- features the set, gives the badge and tells the entrant once; a member is refused everywhere.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(32);

insert into auth.users (id, email) values
  ('adad0000-0000-4000-8000-000000000001', 'ac-staff@test.kleit'),
  ('adad0000-0000-4000-8000-000000000002', 'ac-member@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('adad0000-0000-4000-8000-000000000001', 'acstaff', now(), 't'),
  ('adad0000-0000-4000-8000-000000000002', 'acmember', now(), 't');
insert into user_roles (user_id, role) values ('adad0000-0000-4000-8000-000000000001', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ad000000-0000-4000-8000-000000000001', 'adad0000-0000-4000-8000-000000000002', 'ac public set', 'published', 'public', 'acpublicset00001', now()),
  ('ad000000-0000-4000-8000-000000000002', 'adad0000-0000-4000-8000-000000000002', 'ac draft set', 'draft', 'public', 'acdraftset000001', null);
-- Nothing else open for the length of the transaction (the live project has its own week).
update contests set closes_at = now() - interval '1 minute' where closes_at > now();
update contest_themes set used_at = now() where used_at is null;

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- The ids the functions hand back, kept where both roles can write them.
create temp table ac_ids (name text primary key, id uuid);
grant all on ac_ids to authenticated;

-- 1. The queue is the admins'.
select pg_temp.act_as('adad0000-0000-4000-8000-000000000002');
select throws_ok($$ select queue_contest_theme('Mine', 'x') $$, '42501', null, 'member: cannot queue a theme');
select throws_ok($$ select feature_set('ad000000-0000-4000-8000-000000000001', true) $$, '42501', null, 'member: cannot feature a set');
select throws_ok($$ select close_contest_now('ad000000-0000-4000-8000-000000000001') $$, '42501', null, 'member: cannot close a contest');
select is((select count(*)::int from admin_contests()), 0, 'member: the admin list is empty');

select pg_temp.act_as('adad0000-0000-4000-8000-000000000001');
insert into ac_ids values ('t1', queue_contest_theme('AC theme one (ignore)', 'first'));
insert into ac_ids values ('t2', queue_contest_theme('AC theme two (ignore)', 'second'));
select ok((select position from contest_themes where id = (select id from ac_ids where name = 't2'))
        > (select position from contest_themes where id = (select id from ac_ids where name = 't1')), 'admin: a new theme joins the back of the queue');
select is(move_contest_theme((select id from ac_ids where name = 't2'), 'up'), true, 'admin: a theme moves up');
select ok((select position from contest_themes where id = (select id from ac_ids where name = 't2'))
        < (select position from contest_themes where id = (select id from ac_ids where name = 't1')), 'admin: and is now in front');
select is(move_contest_theme((select id from ac_ids where name = 't2'), 'up'), false, 'admin: the front cannot move further up');
select is(drop_contest_theme((select id from ac_ids where name = 't1')), true, 'admin: a waiting theme is dropped');
select is(drop_contest_theme((select id from ac_ids where name = 't1')), false, 'admin: dropping it again does nothing');

-- 2. By hand: one at a time; closing early tells the entrants at once.
insert into ac_ids values ('c1', start_contest('AC hand contest (ignore)', 'by hand', 3));
select ok((select count(*) from contests where id = (select id from ac_ids where name = 'c1') and now() >= opens_at and now() < closes_at) = 1, 'admin: a contest started by hand is open');
select throws_ok($$ select start_contest('AC second (ignore)', '', 3) $$, 'P0001', null, 'admin: not a second one while the first is open');
select is(open_contest_now(), null, 'admin: the queue does not open either while one is open');
select pg_temp.back();
insert into contest_entries (contest_id, user_id, set_id) values ((select id from ac_ids where name = 'c1'), 'adad0000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000001');
-- now() is the transaction's start for the whole test, so a contest opened here cannot close
-- "later" within it: pretend it opened yesterday before closing it by hand.
update contests set opens_at = now() - interval '1 day' where id = (select id from ac_ids where name = 'c1');
select pg_temp.act_as('adad0000-0000-4000-8000-000000000001');
select throws_ok($$ select pick_contest_entry((select id from ac_ids where name = 'c1'), 'ad000000-0000-4000-8000-000000000001', true) $$, 'P0001', null, 'admin: no picking while it is open');
select is(close_contest_now((select id from ac_ids where name = 'c1')), true, 'admin: closed early');
select is(close_contest_now((select id from ac_ids where name = 'c1')), false, 'admin: closing it again does nothing');
select pg_temp.back();
select is((select count(*)::int from notifications where user_id = 'adad0000-0000-4000-8000-000000000002' and kind = 'contest_results' and ref_id = (select id from ac_ids where name = 'c1')), 1, 'the entrant is told the results are in, at once');

-- 3. Judging: the pick features, badges and tells; taking it back undoes the first two.
select pg_temp.act_as('adad0000-0000-4000-8000-000000000001');
select is(pick_contest_entry((select id from ac_ids where name = 'c1'), 'ad000000-0000-4000-8000-000000000001', true), true, 'admin: picked');
select is(pick_contest_entry((select id from ac_ids where name = 'c1'), 'ad000000-0000-4000-8000-000000000001', true), true, 'admin: picked again (idempotent)');
select is(pick_contest_entry((select id from ac_ids where name = 'c1'), 'ad000000-0000-4000-8000-000000000002', true), false, 'admin: a set that did not enter cannot be picked');
select pg_temp.back();
select isnt((select featured_at from sets where id = 'ad000000-0000-4000-8000-000000000001'), null, 'the picked set is on Featured');
select is((select count(*)::int from badges where user_id = 'adad0000-0000-4000-8000-000000000002' and badge = 'contest_pick'), 1, 'the entrant has the badge');
select is((select count(*)::int from notifications where user_id = 'adad0000-0000-4000-8000-000000000002' and kind = 'contest_pick'), 1, 'the entrant is told once');
select pg_temp.act_as('adad0000-0000-4000-8000-000000000002');
select is((select picked_at is not null from contest_board((select id from ac_ids where name = 'c1')) where set_id = 'ad000000-0000-4000-8000-000000000001'), true, 'the board shows the pick');
select pg_temp.act_as('adad0000-0000-4000-8000-000000000001');
select is(pick_contest_entry((select id from ac_ids where name = 'c1'), 'ad000000-0000-4000-8000-000000000001', false), true, 'admin: pick taken back');
select pg_temp.back();
select is((select featured_at from sets where id = 'ad000000-0000-4000-8000-000000000001'), null, 'the set is off Featured again');
select is((select count(*)::int from badges where user_id = 'adad0000-0000-4000-8000-000000000002' and badge = 'contest_pick'), 0, 'the badge is gone with the last pick');

-- 4. An editor's pick outside a challenge; the list; the queue opens once nothing is open; the log.
select pg_temp.act_as('adad0000-0000-4000-8000-000000000001');
select is(feature_set('ad000000-0000-4000-8000-000000000002', true), false, 'admin: a draft cannot be featured');
select is(feature_set('ad000000-0000-4000-8000-000000000001', true), true, 'admin: a public published set can');
select is((select entries from admin_contests() where id = (select id from ac_ids where name = 'c1')), 1::bigint, 'admin: the list counts the entries');
select isnt(open_contest_now(), null, 'admin: with nothing open, the next theme opens by hand');
select is((select count(*)::int from admin_audit_log where admin_id = 'adad0000-0000-4000-8000-000000000001' and what in ('contest', 'feature')), 10, 'every act is in the audit log');

select * from finish();
rollback;
