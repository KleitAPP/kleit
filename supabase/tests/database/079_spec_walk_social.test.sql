-- Tests for migration 103 (the spec walk, part 2): account-wide defaults for who sees and who may
-- remix a new set; the comments of a blocked or hidden account hidden from everyone but their
-- author and a moderator; no link into a message request whatever the account's age; a poll
-- closes when a set it offers stops being visible; shared_set carries updated_at.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

-- Four people: the owner, a commenter, a viewer, and an old account that will message the owner.
insert into auth.users (id, email, created_at) values
  ('d3d3d3d3-0000-4000-8000-000000000001', 'sw-owner@test.kleit', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000002', 'sw-commenter@test.kleit', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000003', 'sw-viewer@test.kleit', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000004', 'sw-sender@test.kleit', now() - interval '60 days');
insert into profiles (user_id, username, age_confirmed_at, terms_version, created_at) values
  ('d3d3d3d3-0000-4000-8000-000000000001', 'swowner', now(), 't', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000002', 'swcommenter', now(), 't', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000003', 'swviewer', now(), 't', now() - interval '60 days'),
  ('d3d3d3d3-0000-4000-8000-000000000004', 'swsender', now(), 't', now() - interval '60 days');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1, 2. The defaults exist, start where the spec says, and are the owner's to change.
select is((select default_visibility::text from profiles where user_id = 'd3d3d3d3-0000-4000-8000-000000000001'), 'public', 'a new account''s default for new sets is Public (7.1 #3)');
select is((select remix_default::text from profiles where user_id = 'd3d3d3d3-0000-4000-8000-000000000001'), 'anyone', 'and anyone may remix, until they say otherwise');
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000001');
update profiles set default_visibility = 'friends', remix_default = 'followers' where user_id = 'd3d3d3d3-0000-4000-8000-000000000001';
select is((select default_visibility::text || '/' || remix_default::text from profiles where user_id = 'd3d3d3d3-0000-4000-8000-000000000001'), 'friends/followers', 'the owner changes both defaults in their own row');
select pg_temp.as_server();

-- 3. Comments: a published public set with one comment by the commenter.
insert into sets (id, owner_id, title, status, visibility, layout) values
  ('d3000000-0000-4000-8000-000000000001', 'd3d3d3d3-0000-4000-8000-000000000001', 'Spec walk set', 'published', 'public', '{"version":1,"template":"","background":"#ffffff","caption":""}');
insert into comments (id, set_id, author_id, body) values
  ('d3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000001', 'd3d3d3d3-0000-4000-8000-000000000002', 'lovely coat');

select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000003');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 1, 'viewer: the comment shows');
select pg_temp.as_server();
insert into blocks (blocker_id, blocked_id) values ('d3d3d3d3-0000-4000-8000-000000000001', 'd3d3d3d3-0000-4000-8000-000000000002');
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000003');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 0, 'viewer: once the set''s owner blocks the commenter, the comment is gone for everyone (10.4 #2)');
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000002');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 0, 'commenter: a blocked person cannot open the set at all, so sees nothing (10.4 #1)');
select pg_temp.as_server();
delete from blocks where blocker_id = 'd3d3d3d3-0000-4000-8000-000000000001';
update profiles set deactivated_at = now() where user_id = 'd3d3d3d3-0000-4000-8000-000000000002';
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000003');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 0, 'viewer: a commenter on a break takes their comments with them (3.6 #8)');
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000002');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 1, 'commenter: their own comment is still theirs to see');
select pg_temp.as_server();
update profiles set deactivated_at = null where user_id = 'd3d3d3d3-0000-4000-8000-000000000002';
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000003');
select is((select count(*)::int from comments where set_id = 'd3000000-0000-4000-8000-000000000001'), 1, 'viewer: back from the break, the comment is back');
select pg_temp.as_server();

-- 4. No link into a message request. The sender follows the owner (so the owner's "followers"
-- setting lets them write), the owner does not follow back (so it is a request).
insert into follows (follower_id, followee_id) values ('d3d3d3d3-0000-4000-8000-000000000004', 'd3d3d3d3-0000-4000-8000-000000000001');
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000004');
select throws_ok(
  $$select send_message('d3d3d3d3-0000-4000-8000-000000000001', 'see https://example.com/deal')$$,
  'P0002', null, 'sender (an old account): a link into a message request is refused (10.2 #5)');
select lives_ok(
  $$select send_message('d3d3d3d3-0000-4000-8000-000000000001', 'hello there')$$,
  'sender: plain words into a request are fine');
select pg_temp.as_server();
insert into follows (follower_id, followee_id) values ('d3d3d3d3-0000-4000-8000-000000000001', 'd3d3d3d3-0000-4000-8000-000000000004');
update conversations set state = 'normal' where user_a = least('d3d3d3d3-0000-4000-8000-000000000001'::uuid, 'd3d3d3d3-0000-4000-8000-000000000004'::uuid);
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000004');
select lives_ok(
  $$select send_message('d3d3d3d3-0000-4000-8000-000000000001', 'see https://example.com/deal')$$,
  'sender: once the owner follows back and the thread is a conversation, a link is fine (the account is old)');
select pg_temp.as_server();

-- 5. A poll closes when a set it offers stops being visible.
insert into sets (id, owner_id, title, status, visibility, layout) values
  ('d3000000-0000-4000-8000-000000000002', 'd3d3d3d3-0000-4000-8000-000000000001', 'Spec walk set 2', 'published', 'public', '{"version":1,"template":"","background":"#ffffff","caption":""}');
insert into polls (id, owner_id, question) values ('d3000000-0000-4000-8000-000000000021', 'd3d3d3d3-0000-4000-8000-000000000001', 'which?');
insert into poll_options (poll_id, set_id, sort_order) values
  ('d3000000-0000-4000-8000-000000000021', 'd3000000-0000-4000-8000-000000000001', 0),
  ('d3000000-0000-4000-8000-000000000021', 'd3000000-0000-4000-8000-000000000002', 1);
update sets set visibility = 'only_me' where id = 'd3000000-0000-4000-8000-000000000002';
select isnt((select closed_at from polls where id = 'd3000000-0000-4000-8000-000000000021'), null, 'a set switched to Only me closes the open poll that offered it (7.1 #8)');

-- 7. The description is screened like a caption.
select pg_temp.act_as('d3d3d3d3-0000-4000-8000-000000000001');
select throws_ok(
  $$update sets set description = 'text me on 555-123-4567' where id = 'd3000000-0000-4000-8000-000000000001'$$,
  'P0006', null, 'owner: a phone number in the description is refused like one in the caption (13.2 #4)');
select pg_temp.as_server();

-- 6. shared_set carries updated_at.
select ok((select (shared_set((select share_code from sets where id = 'd3000000-0000-4000-8000-000000000001'))) ? 'updated_at'), 'shared_set says when the set last changed, for the share page''s Edited line (7.1 #6)');

select * from finish();
rollback;
