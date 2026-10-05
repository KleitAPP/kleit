-- Tests for blocking (migration 028 and what came before it; roadmap M5.5 "Done when": a
-- blocked account fails the actions in spec 10.4 #1 - here every one that exists so far:
-- find, view, follow, message, vote, save from (folders). Comments, tags, mentions, remix and
-- groups are checked when they are built.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('abababab-0000-4000-8000-000000000001', 'blocker@test.kleit'),
  ('abababab-0000-4000-8000-000000000002', 'blocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, dm_setting, created_at) values
  ('abababab-0000-4000-8000-000000000001', 'theblocker', now(), 't', 'everyone', now() - interval '30 days'),
  ('abababab-0000-4000-8000-000000000002', 'theblocked', now(), 't', 'everyone', now() - interval '30 days');
-- Before the block: they follow each other and talk.
insert into follows (follower_id, followee_id) values
  ('abababab-0000-4000-8000-000000000002', 'abababab-0000-4000-8000-000000000001'),
  ('abababab-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000002');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('94949494-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000001', 'public set', 'published', 'public', 'blockedpublic001');
insert into collections (id, owner_id, name, visibility) values
  ('93939393-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000001', 'Public folder', 'public');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('abababab-0000-4000-8000-000000000002');
select is((select count(*)::int from profiles where username = 'theblocker'), 1, 'before: the blocked person can find the blocker');
select is((select count(*)::int from sets where id = '94949494-0000-4000-8000-000000000001'), 1, 'before: and see their public set');
select lives_ok($$ select send_message('abababab-0000-4000-8000-000000000001', 'hey') $$, 'before: and message them');

-- The block.
select pg_temp.act_as('abababab-0000-4000-8000-000000000001');
insert into blocks (blocker_id, blocked_id) values ('abababab-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000002');
select is((select count(*)::int from blocked_people()), 1, 'blocker: the blocked list shows one person');
select is((select count(*)::int from profiles where username = 'theblocked'), 0, 'blocker: no longer sees the blocked person''s profile in lists');
select is((select private.is_following('abababab-0000-4000-8000-000000000002', 'abababab-0000-4000-8000-000000000001')), false, 'the follow towards the blocker is gone');
select is((select private.is_following('abababab-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000002')), false, 'and the follow the other way');

-- The blocked person, after.
select pg_temp.act_as('abababab-0000-4000-8000-000000000002');
select is((select count(*)::int from profiles where username = 'theblocker'), 0, 'blocked: cannot find the blocker');
select is((select count(*)::int from sets where id = '94949494-0000-4000-8000-000000000001'), 0, 'blocked: cannot view their public set');
select is((select count(*)::int from collections where id = '93939393-0000-4000-8000-000000000001'), 0, 'blocked: cannot see their public folder');
select throws_ok($$ insert into follows (follower_id, followee_id) values ('abababab-0000-4000-8000-000000000002', 'abababab-0000-4000-8000-000000000001') $$, '42501', null, 'blocked: cannot follow');
select throws_ok($$ select send_message('abababab-0000-4000-8000-000000000001', 'hey again') $$, 'P0001', null, 'blocked: cannot message (even inside the old conversation)');
select is((select count(*)::int from profiles where user_id = 'abababab-0000-4000-8000-000000000002'), 1, 'blocked: still sees their own profile');
select is((select count(*)::int from conversations), 0, 'blocked: the old conversation is gone from their inbox');

select * from finish();
rollback;
