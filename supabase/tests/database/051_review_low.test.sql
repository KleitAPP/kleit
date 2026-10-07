-- Tests for migration 068: a suspension reaches a photo upload and a poll; a deleting sender
-- cannot message; an appeal cannot carry moderator columns; the word list files at most five
-- reports a day per author; opening a queue with evidence is logged once an hour.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('edededed-0000-4000-8000-000000000001', 'rl-banned@test.kleit'),
  ('edededed-0000-4000-8000-000000000002', 'rl-friend@test.kleit'),
  ('edededed-0000-4000-8000-000000000003', 'rl-moderator@test.kleit'),
  ('edededed-0000-4000-8000-000000000004', 'rl-talker@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, banned_at) values
  ('edededed-0000-4000-8000-000000000001', 'rlbanned', now(), 't', now()),
  ('edededed-0000-4000-8000-000000000002', 'rlfriend', now(), 't', null),
  ('edededed-0000-4000-8000-000000000003', 'rlmoderator', now(), 't', null),
  ('edededed-0000-4000-8000-000000000004', 'rltalker', now(), 't', null);
insert into user_roles (user_id, role) values ('edededed-0000-4000-8000-000000000003', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ed000000-0000-4000-8000-000000000001', 'edededed-0000-4000-8000-000000000002', 'friend set', 'published', 'public', 'reviewlow0000001', now());
insert into strikes (id, user_id, reason) values ('ed000000-0000-4000-8000-000000000011', 'edededed-0000-4000-8000-000000000004', 'x');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- (a)
select pg_temp.act_as('edededed-0000-4000-8000-000000000001');
select throws_ok($$ insert into items (owner_id, kind, title) values ('edededed-0000-4000-8000-000000000001', 'own', 'x') $$, '42501', null, 'banned: cannot add a piece');
select throws_ok($$ insert into polls (owner_id, question) values ('edededed-0000-4000-8000-000000000001', 'x?') $$, '42501', null, 'banned: cannot make a poll');
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set deactivated_at = now() where user_id = 'edededed-0000-4000-8000-000000000004';
select pg_temp.act_as('edededed-0000-4000-8000-000000000004');
select throws_ok($$ select send_message('edededed-0000-4000-8000-000000000002', 'hi') $$, 'P0001', null, 'deactivated: cannot message');
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set deactivated_at = null where user_id = 'edededed-0000-4000-8000-000000000004';

-- (b)
select pg_temp.act_as('edededed-0000-4000-8000-000000000004');
select throws_ok($$ insert into appeals (strike_id, user_id, body, note) values ('ed000000-0000-4000-8000-000000000011', 'edededed-0000-4000-8000-000000000004', 'please', 'looks fine') $$, '42501', null, 'struck: cannot write the moderator''s note on their own appeal');

-- (c) Six risky comments: six held, five reported.
select pg_temp.act_as('edededed-0000-4000-8000-000000000004');
insert into comments (set_id, author_id, body) select 'ed000000-0000-4000-8000-000000000001', 'edededed-0000-4000-8000-000000000004', 'thinspo ' || g from generate_series(1, 6) g;
select is((select count(*)::int from comments where author_id = 'edededed-0000-4000-8000-000000000004' and held_at is not null), 6, 'talker: all six are held');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from reports where reporter_id = 'edededed-0000-4000-8000-000000000004' and note = 'held by the word list'), 5, 'server: five reports, not six');

-- (d) A conversation report carries evidence; opening the queue then is logged once.
insert into follows (follower_id, followee_id) values
  ('edededed-0000-4000-8000-000000000004', 'edededed-0000-4000-8000-000000000002'),
  ('edededed-0000-4000-8000-000000000002', 'edededed-0000-4000-8000-000000000004');
select pg_temp.act_as('edededed-0000-4000-8000-000000000004');
select lives_ok($$ select send_message('edededed-0000-4000-8000-000000000002', 'hello there') $$, 'talker: messages the friend');
select pg_temp.act_as('edededed-0000-4000-8000-000000000002');
select lives_ok($$ select file_report('conversation', (select id from conversations where user_a = least('edededed-0000-4000-8000-000000000002'::uuid, 'edededed-0000-4000-8000-000000000004'::uuid)), 'harassment', 'x') $$, 'friend: reports the conversation');
select pg_temp.act_as('edededed-0000-4000-8000-000000000003');
select ok((select count(*) from moderation_queue()) >= 6, 'moderator: reads the queue');
select ok((select count(*) from moderation_queue()) >= 6, 'moderator: reads it again');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from admin_audit_log where admin_id = 'edededed-0000-4000-8000-000000000003' and what = 'dm_evidence'), 1, 'server: the evidence view is logged once for the hour');

select * from finish();
rollback;
