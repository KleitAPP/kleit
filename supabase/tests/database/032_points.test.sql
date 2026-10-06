-- Tests for points, badges and levels (migration 039; roadmap M6.5 "Done when": points are
-- written by the server only and can't be edited by a user).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('d0d0d0d0-0000-4000-8000-000000000001', 'maker@test.kleit'),
  ('d0d0d0d0-0000-4000-8000-000000000002', 'admirer@test.kleit'),
  ('d0d0d0d0-0000-4000-8000-000000000003', 'staff2@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d0d0d0d0-0000-4000-8000-000000000001', 'maker', now(), 't'),
  ('d0d0d0d0-0000-4000-8000-000000000002', 'admirer', now(), 't'),
  ('d0d0d0d0-0000-4000-8000-000000000003', 'staff2', now(), 't');
insert into user_roles (user_id, role) values ('d0d0d0d0-0000-4000-8000-000000000003', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('de000000-0000-4000-8000-000000000001', 'd0d0d0d0-0000-4000-8000-000000000001', 'maker draft', 'draft', 'public', 'pointsmakerdr001');
insert into contests (id, title, closes_at, created_by) values
  ('dc000000-0000-4000-8000-000000000001', 'Points week (ignore)', now() + interval '1 day', 'd0d0d0d0-0000-4000-8000-000000000003');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.points_of(uid uuid) returns integer language sql as $$ select points from profiles where user_id = uid $$;

-- Nobody writes their own points.
select pg_temp.act_as('d0d0d0d0-0000-4000-8000-000000000001');
select throws_ok($$ insert into points_ledger (user_id, points, reason, ref) values ('d0d0d0d0-0000-4000-8000-000000000001', 500, 'publish', 'x') $$, '42501', null, 'maker: cannot write the ledger');
select throws_ok($$ update profiles set points = 9999 where user_id = 'd0d0d0d0-0000-4000-8000-000000000001' $$, '42501', null, 'maker: cannot edit their points');
select throws_ok($$ insert into badges (user_id, badge) values ('d0d0d0d0-0000-4000-8000-000000000001', 'style_icon') $$, '42501', null, 'maker: cannot award themselves a badge');

-- Publishing: 10 points once, and the first-set badge.
update sets set status = 'published' where id = 'de000000-0000-4000-8000-000000000001';
select is(pg_temp.points_of('d0d0d0d0-0000-4000-8000-000000000001'), 10, 'maker: publishing a set earns 10');
update sets set status = 'draft' where id = 'de000000-0000-4000-8000-000000000001';
update sets set status = 'published' where id = 'de000000-0000-4000-8000-000000000001';
select is(pg_temp.points_of('d0d0d0d0-0000-4000-8000-000000000001'), 10, 'maker: unpublishing and publishing again earns nothing more');
select ok(exists (select 1 from badges where user_id = 'd0d0d0d0-0000-4000-8000-000000000001' and badge = 'first_set'), 'maker: wears the first-set badge');

-- A like from someone else: 2 points, once per person; your own like earns nothing.
insert into likes (user_id, set_id) values ('d0d0d0d0-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001');
select is(pg_temp.points_of('d0d0d0d0-0000-4000-8000-000000000001'), 10, 'maker: liking their own set earns nothing');
select pg_temp.act_as('d0d0d0d0-0000-4000-8000-000000000002');
insert into likes (user_id, set_id) values ('d0d0d0d0-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000001');
delete from likes where user_id = 'd0d0d0d0-0000-4000-8000-000000000002';
insert into likes (user_id, set_id) values ('d0d0d0d0-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000001');
insert into follows (follower_id, followee_id) values ('d0d0d0d0-0000-4000-8000-000000000002', 'd0d0d0d0-0000-4000-8000-000000000001');
select is(pg_temp.points_of('d0d0d0d0-0000-4000-8000-000000000001'), 13, 'maker: a like (2, once however often it is redone) and a follower (1)');
-- Found on the way (migration 040): the second like within an hour bundles the notification, and
-- that update used to be refused for a signed-in person - so the like itself was refused.
select pg_temp.act_as('d0d0d0d0-0000-4000-8000-000000000001');
select is((select bundled_count from notifications where user_id = 'd0d0d0d0-0000-4000-8000-000000000001' and kind = 'like'), 2, 'maker: the two likes bundled into one notification (a signed-in like could not bundle before 040)');
select pg_temp.act_as('d0d0d0d0-0000-4000-8000-000000000002');
select is((select count(*)::int from badges where user_id = 'd0d0d0d0-0000-4000-8000-000000000001'), 1, 'admirer: can see the maker''s badge on the profile');

-- Entering a contest: 5 and a badge.
select pg_temp.act_as('d0d0d0d0-0000-4000-8000-000000000001');
insert into contest_entries (contest_id, user_id, set_id) values ('dc000000-0000-4000-8000-000000000001', 'd0d0d0d0-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001');
select is((select points from my_points()), 18, 'maker: my_points says 18 after the contest entry');
select is((select level from my_points()), 1, 'maker: level 1 under 100 points');
select is((select badges from my_points()), '{first_set,first_contest}'::text[], 'maker: two badges, in the order they came');

select * from finish();
rollback;
