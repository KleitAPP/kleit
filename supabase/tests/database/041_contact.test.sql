-- Tests for contact messages (migration 053; roadmap M7.5 "Done when": anyone can write in with
-- no account, only moderators can read what came in, and answering is logged).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('e3e3e3e3-0000-4000-8000-000000000001', 'ct-member@test.kleit'),
  ('e3e3e3e3-0000-4000-8000-000000000002', 'ct-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e3e3e3e3-0000-4000-8000-000000000001', 'ctmember', now(), 't'),
  ('e3e3e3e3-0000-4000-8000-000000000002', 'ctmoderator', now(), 't');
insert into user_roles (user_id, role) values ('e3e3e3e3-0000-4000-8000-000000000002', 'moderator');
-- The rows the function writes: one from a stranger, one from a signed-in member.
insert into contact_messages (id, request_ref, topic, name, email, message, user_id) values
  ('e3000000-0000-4000-8000-000000000011', 'C-TESTONE', 'question', 'A. Stranger', 'stranger@example.com', 'How do I share a set?', null),
  ('e3000000-0000-4000-8000-000000000012', 'C-TESTTWO', 'bug', 'ctmember', 'ct-member@test.kleit', 'The canvas jumps on my phone.', 'e3e3e3e3-0000-4000-8000-000000000001');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The shape.
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-BAD1', 'question', 'x', 'not-an-email', 'hi') $$, '23514', null, 'server: a bad email is refused');
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-BAD2', 'spam', 'x', 'a@example.com', 'hi') $$, '23514', null, 'server: an unknown topic is refused');
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-BAD3', 'other', 'x', 'a@example.com', '') $$, '23514', null, 'server: an empty message is refused');

-- Nobody but a moderator reads, and nobody signed in writes.
select pg_temp.act_as('e3e3e3e3-0000-4000-8000-000000000001');
select is((select count(*)::int from contact_messages), 0, 'member: cannot read the inbox - not even their own message');
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-MINE', 'other', 'me', 'me@example.com', 'direct') $$, '42501', null, 'member: cannot write straight into the table (the function is the door)');
select throws_ok($$ select contact_resolve('e3000000-0000-4000-8000-000000000011', 'answered', 'x') $$, '42501', null, 'member: cannot mark anything answered');

-- A moderator reads and answers; the act is logged; answering twice is refused.
select pg_temp.act_as('e3e3e3e3-0000-4000-8000-000000000002');
select is((select count(*)::int from contact_messages where id in ('e3000000-0000-4000-8000-000000000011', 'e3000000-0000-4000-8000-000000000012')), 2, 'moderator: sees both messages');
select lives_ok($$ select contact_resolve('e3000000-0000-4000-8000-000000000011', 'answered', 'replied by email') $$, 'moderator: marks the stranger''s message answered');
select ok(exists (select 1 from moderation_actions where target_type = 'contact' and target_id = 'e3000000-0000-4000-8000-000000000011' and moderator_id = 'e3e3e3e3-0000-4000-8000-000000000002'), 'moderator: the answer is logged');
select throws_ok($$ select contact_resolve('e3000000-0000-4000-8000-000000000011', 'closed', 'again') $$, 'P0002', null, 'moderator: cannot resolve the same message twice');

select * from finish();
rollback;
