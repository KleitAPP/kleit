-- Tests for direct messages (migration 027; roadmap M5.2 "Done when": a non-follower's first
-- message lands in Requests as text only).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-000000000001', 'dmowner@test.kleit'),
  ('ffffffff-0000-4000-8000-000000000002', 'dmfollower@test.kleit'),
  ('ffffffff-0000-4000-8000-000000000003', 'dmstranger@test.kleit'),
  ('ffffffff-0000-4000-8000-000000000004', 'dmnewbie@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, created_at) values
  ('ffffffff-0000-4000-8000-000000000001', 'dmowner',    now(), 't', now() - interval '30 days'),
  ('ffffffff-0000-4000-8000-000000000002', 'dmfollower', now(), 't', now() - interval '30 days'),
  ('ffffffff-0000-4000-8000-000000000003', 'dmstranger', now(), 't', now() - interval '30 days'),
  ('ffffffff-0000-4000-8000-000000000004', 'dmnewbie',   now(), 't', now());
-- dmfollower follows dmowner (so may message them under the default 'followers' setting);
-- dmowner follows nobody, so dmfollower's first message is a request.
insert into follows (follower_id, followee_id) values ('ffffffff-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-000000000001');
update profiles set dm_setting = 'everyone' where user_id = 'ffffffff-0000-4000-8000-000000000003';

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A stranger cannot message dmowner (setting: followers).
select pg_temp.act_as('ffffffff-0000-4000-8000-000000000003');
select throws_ok($$ select send_message('ffffffff-0000-4000-8000-000000000001', 'hello') $$, 'P0001', null, 'stranger: refused by the followers setting');
select throws_ok($$ insert into messages (conversation_id, sender_id, body) values (gen_random_uuid(), 'ffffffff-0000-4000-8000-000000000003', 'x') $$, '42501', null, 'stranger: cannot write a message row by hand');

-- A follower's first message lands as a request.
select pg_temp.act_as('ffffffff-0000-4000-8000-000000000002');
select lives_ok($$ select send_message('ffffffff-0000-4000-8000-000000000001', 'hi, love your sets') $$, 'follower: can send');
select is((select state from conversations where user_a = 'ffffffff-0000-4000-8000-000000000001' and user_b = 'ffffffff-0000-4000-8000-000000000002'), 'request', 'follower: the conversation is a request (dmowner does not follow back)');
select is((select count(*)::int from messages), 1, 'follower: sees their own message');

-- The owner sees it in requests; a bystander sees nothing.
select pg_temp.act_as('ffffffff-0000-4000-8000-000000000003');
select is((select count(*)::int from conversations), 0, 'stranger: sees no conversation of theirs');
select is((select count(*)::int from messages), 0, 'stranger: sees no message');
select pg_temp.act_as('ffffffff-0000-4000-8000-000000000001');
select is((select count(*)::int from conversations where state = 'request' and requested_by = 'ffffffff-0000-4000-8000-000000000002'), 1, 'owner: the request is there');
select is((select accept_message_request((select id from conversations limit 1))), true, 'owner: accepts it');
select is((select state from conversations limit 1), 'normal', 'owner: it is a normal conversation now');
-- The follower's own setting is 'followers' and dmowner does not follow them - but inside a
-- conversation both sides already have, a reply is always allowed.
select lives_ok($$ select send_message('ffffffff-0000-4000-8000-000000000002', 'thanks!') $$, 'owner: can reply');
select is((select count(*)::int from messages where sender_id = 'ffffffff-0000-4000-8000-000000000001'), 1, 'owner: the reply is in the conversation');

-- Taking a message back: only deleted_at, only the sender, never the body.
select throws_ok($$ update messages set body = 'edited' where sender_id = 'ffffffff-0000-4000-8000-000000000001' $$, '42501', null, 'owner: cannot edit the words');
update messages set deleted_at = now() where sender_id = 'ffffffff-0000-4000-8000-000000000001';
select is((select count(*)::int from messages where deleted_at is not null), 1, 'owner: can take their own message back');

-- A brand-new account cannot send a link.
select pg_temp.act_as('ffffffff-0000-4000-8000-000000000004');
select throws_ok($$ select send_message('ffffffff-0000-4000-8000-000000000003', 'look at https://example.com') $$, 'P0002', null, 'newbie: no links in the first 7 days');
select lives_ok($$ select send_message('ffffffff-0000-4000-8000-000000000003', 'hello there') $$, 'newbie: plain words are fine (the stranger accepts everyone)');

select * from finish();
rollback;
