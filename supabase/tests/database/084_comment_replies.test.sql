-- Tests for migration 107 (spec 12.1 #1; CL68): replies. A reply is a comment with a parent on
-- the same set; one level deep; not under a removed comment; never across a block with the
-- parent's author; the parent's author is told "reply" and the set's owner "comment" - once each.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('b8b8b8b8-0000-4000-8000-000000000001', 'rp-owner@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000002', 'rp-first@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000003', 'rp-second@test.kleit'),
  ('b8b8b8b8-0000-4000-8000-000000000004', 'rp-blocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b8b8b8b8-0000-4000-8000-000000000001', 'rpowner', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000002', 'rpfirst', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000003', 'rpsecond', now(), 't'),
  ('b8b8b8b8-0000-4000-8000-000000000004', 'rpblocked', now(), 't');
insert into blocks (blocker_id, blocked_id) values ('b8b8b8b8-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000004');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000001', 'replies set', 'published', 'public', 'repliesset000001'),
  ('b8000000-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000001', 'other set', 'published', 'public', 'repliesset000002');

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

-- 1. A comment, then a reply to it from a second person.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000002');
insert into comments (id, set_id, author_id, body) values ('b8000000-0000-4000-8000-000000000011', 'b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000002', 'where is the coat from?');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
select lives_ok($$insert into comments (id, set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000012', 'b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000003', 'looks like Everlane', 'b8000000-0000-4000-8000-000000000011')$$, 'a reply to a comment on the set');
select throws_ok($$insert into comments (set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000003', 'wrong set', 'b8000000-0000-4000-8000-000000000011')$$, 'P0001', null, 'a reply must sit on the parent''s set');
select throws_ok($$insert into comments (set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000003', 'no parent', 'b8000000-0000-4000-8000-0000000000ff')$$, 'P0001', null, 'a reply to a comment that does not exist is refused');

-- 2. One level: an answer to the reply hangs off the original comment.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000002');
insert into comments (id, set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000013', 'b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000002', 'thanks!', 'b8000000-0000-4000-8000-000000000012');
select is((select parent_id from comments where id = 'b8000000-0000-4000-8000-000000000013'), 'b8000000-0000-4000-8000-000000000011', 'an answer to a reply joins the original thread');
select is((select answers_id from comments where id = 'b8000000-0000-4000-8000-000000000013'), 'b8000000-0000-4000-8000-000000000012', 'and remembers which reply it answered');
select throws_ok($$update comments set parent_id = null where id = 'b8000000-0000-4000-8000-000000000013'$$, '42501', null, 'a reply never moves');

-- 3. Who is told: the parent's author hears "reply", the owner "comment"; the replier hears nothing.
select pg_temp.as_server();
select is((select count(*)::int from notifications where user_id = 'b8b8b8b8-0000-4000-8000-000000000002' and kind = 'reply' and actor_id = 'b8b8b8b8-0000-4000-8000-000000000003'), 1, 'the first commenter is told of the reply');
select is((select count(*)::int from notifications where user_id = 'b8b8b8b8-0000-4000-8000-000000000001' and kind = 'comment'), 3, 'the owner is told of each comment and reply (three so far)');
select is((select count(*)::int from notifications where user_id = 'b8b8b8b8-0000-4000-8000-000000000003' and kind = 'reply'), 1, 'the replier is told of the answer to their reply');
-- The owner answering their own thread is told once, not twice.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000001');
insert into comments (id, set_id, author_id, body) values ('b8000000-0000-4000-8000-000000000021', 'b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000001', 'from my closet');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
insert into comments (set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000003', 'lucky', 'b8000000-0000-4000-8000-000000000021');
select pg_temp.as_server();
select is((select count(*)::int from notifications where user_id = 'b8b8b8b8-0000-4000-8000-000000000001' and actor_id = 'b8b8b8b8-0000-4000-8000-000000000003' and kind = 'reply'), 1, 'a reply to the owner''s own comment tells the owner as a reply');
select is((select count(*)::int from notifications where user_id = 'b8b8b8b8-0000-4000-8000-000000000001' and actor_id = 'b8b8b8b8-0000-4000-8000-000000000003' and kind = 'comment'), 1, 'and not a second time as a comment (the one "comment" from them is the earlier reply)');

-- 4. Not under a removed comment; never across a block with the parent's author.
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000002');
update comments set deleted_at = now() where id = 'b8000000-0000-4000-8000-000000000011';
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000003');
select throws_ok($$insert into comments (set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000003', 'too late', 'b8000000-0000-4000-8000-000000000011')$$, 'P0001', null, 'no reply under a comment that was taken back');
select pg_temp.act_as('b8b8b8b8-0000-4000-8000-000000000004');
select throws_ok($$insert into comments (set_id, author_id, body, parent_id) values ('b8000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000004', 'hey', 'b8000000-0000-4000-8000-000000000013')$$, '42501', null, 'a person the parent''s author blocked cannot reply to them');

select * from finish();
rollback;
