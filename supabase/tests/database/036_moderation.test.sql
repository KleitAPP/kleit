-- Tests for the review queue, strikes, appeals and bans (migration 045; roadmap M7.2 "Done
-- when": a test report reaches the queue; 3 strikes bans; an appeal gets a second review).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('b8b8b8b8-0000-4000-8000-000000000001', 'mod-reporter@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000002', 'mod-offender@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000003', 'mod-moderator@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000004', 'mod-viewer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b8b8b8b8-0000-4000-8000-000000000001', 'modreporter', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000002', 'modoffender', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000003', 'modmoderator', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000004', 'modviewer', now(), 't');
insert into user_roles (user_id, role) values ('b8b8b8b8-0000-4000-8000-000000000003', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000002', 'offending set one', 'published', 'public', 'modoffendpub0001', now()),
  ('b8000000-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000002', 'offending set two', 'published', 'public', 'modoffendpub0002', now()),
  ('b8000000-0000-4000-8000-000000000003', 'b8b8b8b8-0000-4000-8000-000000000002', 'offending set three', 'published', 'public', 'modoffendpub0003', now()),
  ('b8000000-0000-4000-8000-000000000004', 'b8b8b8b8-0000-4000-8000-000000000002', 'fine set', 'published', 'public', 'modoffendpub0004', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Three reports reach the queue.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000001');
select file_report('set', 'b8000000-0000-4000-8000-000000000001', 'hate');
select file_report('set', 'b8000000-0000-4000-8000-000000000002', 'harassment');
select file_report('set', 'b8000000-0000-4000-8000-000000000003', 'spam');
select throws_ok($$ select moderate((select id from reports where target_id = 'b8000000-0000-4000-8000-000000000001' limit 1), 'remove') $$, '42501', null, 'reporter: cannot moderate');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
select is((select count(*)::int from moderation_queue() where target_owner = 'b8b8b8b8-0000-4000-8000-000000000002'), 3, 'moderator: the three reports are in the queue');
select is((select title from moderation_queue() where target_id = 'b8000000-0000-4000-8000-000000000001'), 'offending set one', 'moderator: the queue shows what was reported');

-- Strike one: remove + strike. The set vanishes for a viewer; the offender keeps it.
select moderate((select id from reports where target_id = 'b8000000-0000-4000-8000-000000000001'), 'strike', 'hate in the caption');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000004');
select is((select count(*)::int from sets where id = 'b8000000-0000-4000-8000-000000000001'), 0, 'viewer: a removed set is gone');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000002');
select is((select count(*)::int from sets where id = 'b8000000-0000-4000-8000-000000000001'), 1, 'offender: still sees their own removed set');
select is((select count(*)::int from my_strikes()), 1, 'offender: sees one strike');
select throws_ok($$ insert into strikes (user_id) values ('b8b8b8b8-0000-4000-8000-000000000002') $$, '42501', null, 'offender: cannot write strikes');
select throws_ok($$ update profiles set banned_at = now() where user_id = 'b8b8b8b8-0000-4000-8000-000000000002' $$, '42501', null, 'offender: cannot touch banned_at');

-- Appeal: once, in a sentence; a second appeal of the same strike is refused.
insert into appeals (strike_id, user_id, body) values ((select id from my_strikes()), 'b8b8b8b8-0000-4000-8000-000000000002', 'That was a quote, not my words.');
select throws_ok($$ insert into appeals (strike_id, user_id, body) values ((select id from my_strikes()), 'b8b8b8b8-0000-4000-8000-000000000002', 'again') $$, '23505', null, 'offender: one appeal per strike');

-- Strikes two and three: the third bans by itself.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
select moderate((select id from reports where target_id = 'b8000000-0000-4000-8000-000000000002'), 'strike', 'harassment');
select is((select banned_at is null from profiles where user_id = 'b8b8b8b8-0000-4000-8000-000000000002'), true, 'two strikes: not banned');
select moderate((select id from reports where target_id = 'b8000000-0000-4000-8000-000000000003'), 'strike', 'spam');
select is((select banned_at is not null from profiles where user_id = 'b8b8b8b8-0000-4000-8000-000000000002'), true, 'three strikes: banned by the trigger');
select is((select count(*)::int from moderation_actions where target_user_id = 'b8b8b8b8-0000-4000-8000-000000000002' and action = 'ban'), 1, 'the ban is logged');

-- Banned: hidden from a viewer, their fine set too, and they can write nothing new.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000004');
select is((select count(*)::int from profiles where user_id = 'b8b8b8b8-0000-4000-8000-000000000002'), 0, 'viewer: a banned profile is gone');
select is((select count(*)::int from sets where id = 'b8000000-0000-4000-8000-000000000004'), 0, 'viewer: a banned person''s fine set is gone too');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000002');
select throws_ok($$ insert into sets (owner_id, title) values ('b8b8b8b8-0000-4000-8000-000000000002', 'from the grave') $$, '42501', null, 'banned: cannot make a set');

-- The appeal is overturned: that strike ends, two remain, and the third-strike ban lifts.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
select decide_appeal((select id from appeals where user_id = 'b8b8b8b8-0000-4000-8000-000000000002'), 'overturned', 'fair point');
select is((select banned_at is null from profiles where user_id = 'b8b8b8b8-0000-4000-8000-000000000002'), true, 'appeal overturned: the ban that came from the third strike is lifted');

select * from finish();
rollback;
