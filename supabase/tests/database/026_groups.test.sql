-- Tests for groups (migration 032; roadmap M5.3 "Done when": a group invite must be accepted;
-- leaving is quiet; admins remove members and posts).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('aeaeaeae-0000-4000-8000-000000000001', 'groupadmin@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000002', 'invitee@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000003', 'outsider@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('aeaeaeae-0000-4000-8000-000000000001', 'groupadmin', now(), 't'),
  ('aeaeaeae-0000-4000-8000-000000000002', 'invitee', now(), 't'),
  ('aeaeaeae-0000-4000-8000-000000000003', 'outsider', now(), 't');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The admin makes a private group; they are its admin at once.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
insert into groups (id, creator_id, name, visibility) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000001', 'Secret stylists', 'private');
select is((select role || '/' || state from group_members where group_id = '87878787-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000001'), 'admin/joined', 'creator: is a joined admin');
select throws_ok($$ insert into groups (creator_id, name) values ('aeaeaeae-0000-4000-8000-000000000002', 'forged') $$, '42501', null, 'creator: cannot make a group in someone else''s name');

-- An outsider cannot see a private group, join it, or post in it.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000003');
select is((select count(*)::int from groups where id = '87878787-0000-4000-8000-000000000001'), 0, 'outsider: cannot see the private group');
select throws_ok($$ insert into group_members (group_id, user_id, role, state) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000003', 'member', 'joined') $$, '42501', null, 'outsider: cannot join a private group');
select throws_ok($$ insert into group_members (group_id, user_id, role, state) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000003', 'admin', 'joined') $$, '42501', null, 'outsider: cannot make themselves admin');
select throws_ok($$ insert into group_posts (group_id, author_id, body) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000003', 'hi') $$, '42501', null, 'outsider: cannot post');

-- The admin invites; the invitee must accept before they are a member.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
insert into group_members (group_id, user_id, role, state, invited_by) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000002', 'member', 'invited', 'aeaeaeae-0000-4000-8000-000000000001');
select throws_ok($$ insert into group_members (group_id, user_id, role, state, invited_by) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000003', 'member', 'joined', 'aeaeaeae-0000-4000-8000-000000000001') $$, '42501', null, 'admin: cannot add someone as joined - an invite must be accepted');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000002');
select is((select count(*)::int from groups where id = '87878787-0000-4000-8000-000000000001'), 1, 'invitee: can see the group they were invited to');
select throws_ok($$ insert into group_posts (group_id, author_id, body) values ('87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000002', 'hi') $$, '42501', null, 'invitee: cannot post before accepting');
select throws_ok($$ update group_members set role = 'admin', state = 'joined' where group_id = '87878787-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000002' $$, '42501', null, 'invitee: cannot accept as an admin');
update group_members set state = 'joined' where group_id = '87878787-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000002';
select is((select state from group_members where group_id = '87878787-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000002'), 'joined', 'invitee: accepted');
select lives_ok($$ insert into group_posts (id, group_id, author_id, body) values ('86868686-0000-4000-8000-000000000001', '87878787-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000002', 'hello all') $$, 'member: can post');
select is((select count(*)::int from notifications where kind = 'group_invite'), 1, 'invitee: was notified of the invitation');

-- The admin removes the post; the member leaves quietly.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
update group_posts set deleted_at = now() where id = '86868686-0000-4000-8000-000000000001';
select is((select deleted_at is not null from group_posts where id = '86868686-0000-4000-8000-000000000001'), true, 'admin: removed the post');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000002');
delete from group_members where group_id = '87878787-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000002';
select is((select count(*)::int from groups where id = '87878787-0000-4000-8000-000000000001'), 0, 'member: after leaving, the private group is gone from their view');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
select is((select count(*)::int from notifications where user_id = 'aeaeaeae-0000-4000-8000-000000000001'), 0, 'admin: was not told (leaving is quiet)');

select * from finish();
rollback;
