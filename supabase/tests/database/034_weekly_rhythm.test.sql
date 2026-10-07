-- Tests for the weekly rhythm (migration 043; CL39): the next theme opens only when nothing is
-- open, once; a closed contest tells its entrants once; the queue is the admins' alone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('f0f0f0f0-0000-4000-8000-000000000001', 'weekly-entrant@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000002', 'weekly-staff@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('f0f0f0f0-0000-4000-8000-000000000001', 'weeklyentrant', now(), 't'),
  ('f0f0f0f0-0000-4000-8000-000000000002', 'weeklystaff', now(), 't');
insert into user_roles (user_id, role) values ('f0f0f0f0-0000-4000-8000-000000000002', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('fc000000-0000-4000-8000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'weekly entry', 'published', 'public', 'weeklyentrypub01', now());
-- A contest that closed an hour ago with one entry, not yet announced.
insert into contests (id, title, opens_at, closes_at) values
  ('fc000000-0000-4000-8000-000000000011', 'Closed week (ignore)', now() - interval '8 days', now() - interval '1 hour');
insert into contest_entries (contest_id, user_id, set_id) values
  ('fc000000-0000-4000-8000-000000000011', 'f0f0f0f0-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001');
-- Make sure nothing else is open and the queue is this test's: close the live one for the
-- length of the transaction and put one theme in front.
update contests set closes_at = now() - interval '1 minute' where closes_at > now();
insert into contest_themes (id, title, theme, position) values ('fc000000-0000-4000-8000-000000000021', 'Test theme (ignore)', 'x', -1);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The queue is the admins'.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
select is((select count(*)::int from contest_themes), 0, 'entrant: cannot see the theme queue');
select throws_ok($$ insert into contest_themes (title, position) values ('mine', 99) $$, '42501', null, 'entrant: cannot queue a theme');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000002');
select ok((select count(*) from contest_themes) >= 1, 'staff: sees the queue');

-- Opening: the first unused theme becomes this week's contest; a second run opens nothing.
reset role;
select set_config('request.jwt.claims', '', true);
select isnt((select private.open_weekly_contest()), null, 'monday: a contest opened from the queue');
select is((select title from contests where now() >= opens_at and now() < closes_at), 'Test theme (ignore)', 'monday: it is the front of the queue');
select is((select private.open_weekly_contest()), null, 'monday again: nothing opens while one is open');
select is((select used_at is not null from contest_themes where id = 'fc000000-0000-4000-8000-000000000021'), true, 'the theme is marked used');

-- Announcing: the closed contest tells its entrant once.
select private.announce_closed_contests();
select private.announce_closed_contests();
select is((select count(*)::int from notifications where user_id = 'f0f0f0f0-0000-4000-8000-000000000001' and kind = 'contest_results' and ref_id = 'fc000000-0000-4000-8000-000000000011'), 1, 'entrant: told once that the results are in, however often the job runs');

select * from finish();
rollback;
