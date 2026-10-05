-- Tests for in-app notifications (migration 031; roadmap M5.6 in-app half): written only by
-- triggers, read only by their owner, votes bundled, nothing across a block.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('adadadad-0000-4000-8000-000000000001', 'notified@test.kleit'),
  ('adadadad-0000-4000-8000-000000000002', 'actor@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, dm_setting) values
  ('adadadad-0000-4000-8000-000000000001', 'notified', now(), 't', 'everyone'),
  ('adadadad-0000-4000-8000-000000000002', 'actor', now(), 't', 'everyone');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('90909090-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000001', 'noticed set', 'published', 'public', 'notifypublic0001');
insert into polls (id, owner_id, question) values ('89898989-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000001', 'which?');
insert into poll_options (id, poll_id, set_id, label, sort_order) values ('88888888-0000-4000-8000-000000000001', '89898989-0000-4000-8000-000000000001', '90909090-0000-4000-8000-000000000001', 'A', 0);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The actor likes, comments, follows and messages; three guests vote.
select pg_temp.act_as('adadadad-0000-4000-8000-000000000002');
insert into likes (user_id, set_id) values ('adadadad-0000-4000-8000-000000000002', '90909090-0000-4000-8000-000000000001');
insert into comments (set_id, author_id, body) values ('90909090-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000002', 'nice');
insert into follows (follower_id, followee_id) values ('adadadad-0000-4000-8000-000000000002', 'adadadad-0000-4000-8000-000000000001');
select send_message('adadadad-0000-4000-8000-000000000001', 'hello');
select throws_ok($$ insert into notifications (user_id, kind) values ('adadadad-0000-4000-8000-000000000001', 'like') $$, '42501', null, 'actor: cannot write a notification by hand');
select is((select count(*)::int from notifications), 0, 'actor: sees none of the other person''s notifications');

reset role;
select set_config('request.jwt.claims', '', true);
insert into votes (poll_id, option_id, device_hash) values
  ('89898989-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', 'd1'),
  ('89898989-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', 'd2'),
  ('89898989-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', 'd3');

select pg_temp.act_as('adadadad-0000-4000-8000-000000000001');
select is((select count(*)::int from notifications), 5, 'owner: five rows - like, comment, follow, message request, and one bundled vote row');
select is((select bundled_count from notifications where kind = 'vote'), 3, 'owner: the three votes are one row with a count of 3');
select is((select actor_id from notifications where kind = 'vote'), null, 'owner: a vote names nobody');
select is((select kind from notifications where ref_type = 'conversation'), 'message_request', 'owner: the first message from a non-follower is a message request');
select is((select unread_notifications()), 5::bigint, 'owner: five unread');
update notifications set read_at = now() where kind = 'like';
select is((select unread_notifications()), 4::bigint, 'owner: marking one read works');
select throws_ok($$ update notifications set kind = 'follow' where kind = 'comment' $$, '42501', null, 'owner: cannot rewrite a notification');

-- Across a block nothing arrives.
insert into blocks (blocker_id, blocked_id) values ('adadadad-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000002');
reset role;
select set_config('request.jwt.claims', '', true);
insert into likes (user_id, set_id) values ('adadadad-0000-4000-8000-000000000002', '90909090-0000-4000-8000-000000000001') on conflict do nothing;
delete from likes where user_id = 'adadadad-0000-4000-8000-000000000002';
insert into likes (user_id, set_id) values ('adadadad-0000-4000-8000-000000000002', '90909090-0000-4000-8000-000000000001');
select pg_temp.act_as('adadadad-0000-4000-8000-000000000001');
select is((select count(*)::int from notifications where kind = 'like' and bundled_count = 1), 1, 'owner: a like from a blocked person neither adds a row nor bundles');

select * from finish();
rollback;
