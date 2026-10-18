-- Tests for migration 104 (the spec walk's read-back): the recipient's reply to a request may
-- carry a link; alt text and description are screened and queued like the caption; edited_at is
-- the server's and moves on real edits only; every narrowing of a set closes its polls;
-- shared_set carries the description and edited_at.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email, created_at) values
  ('d4d4d4d4-0000-4000-8000-000000000001', 'rb-owner@test.kleit', now() - interval '60 days'),
  ('d4d4d4d4-0000-4000-8000-000000000002', 'rb-sender@test.kleit', now() - interval '60 days');
insert into profiles (user_id, username, age_confirmed_at, terms_version, created_at) values
  ('d4d4d4d4-0000-4000-8000-000000000001', 'rbowner', now(), 't', now() - interval '60 days'),
  ('d4d4d4d4-0000-4000-8000-000000000002', 'rbsender', now(), 't', now() - interval '60 days');

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

-- 1. The sender follows the owner and writes a request; the owner's reply may carry a link.
insert into follows (follower_id, followee_id) values ('d4d4d4d4-0000-4000-8000-000000000002', 'd4d4d4d4-0000-4000-8000-000000000001');
select pg_temp.act_as('d4d4d4d4-0000-4000-8000-000000000002');
select lives_ok($$select send_message('d4d4d4d4-0000-4000-8000-000000000001', 'hi, may I ask about the coat?')$$, 'sender: a plain request');
select throws_ok($$select send_message('d4d4d4d4-0000-4000-8000-000000000001', 'and https://example.com')$$, 'P0002', null, 'sender: a second message into the same request still may not carry a link');
select pg_temp.act_as('d4d4d4d4-0000-4000-8000-000000000001');
select lives_ok($$select send_message('d4d4d4d4-0000-4000-8000-000000000002', 'sure - it is https://example.com/coat')$$, 'owner: the reply that accepts the request may carry a link (it is not into a request)');
select pg_temp.as_server();
select is((select state from conversations where user_a = least('d4d4d4d4-0000-4000-8000-000000000001'::uuid, 'd4d4d4d4-0000-4000-8000-000000000002'::uuid)), 'normal', 'and the thread is a conversation now');

-- 2. Alt text and description are screened like the caption.
insert into sets (id, owner_id, title, status, visibility, published_at, layout) values
  ('d4000000-0000-4000-8000-000000000001', 'd4d4d4d4-0000-4000-8000-000000000001', 'Read-back set', 'published', 'public', now() - interval '1 day', '{"version":1,"template":"","background":"#ffffff","caption":""}');
select pg_temp.act_as('d4d4d4d4-0000-4000-8000-000000000001');
select throws_ok($$update sets set alt_text = 'call 555-123-4567 for this look' where id = 'd4000000-0000-4000-8000-000000000001'$$, 'P0006', null, 'owner: a phone number in the alt text is refused (13.2 #4)');
select lives_ok($$update sets set description = 'A long coat over a short dress' where id = 'd4000000-0000-4000-8000-000000000001'$$, 'owner: an ordinary description saves');
select pg_temp.as_server();
select is((select count(*)::int from text_checks where target_id = 'd4000000-0000-4000-8000-000000000001' and body = 'A long coat over a short dress'), 1, 'and it is queued for the outside text check like a caption');

-- 3. edited_at: stamped by a title change on a published set, by a piece added, never by the member's hand.
select pg_temp.act_as('d4d4d4d4-0000-4000-8000-000000000001');
update sets set title = 'Read-back set, renamed' where id = 'd4000000-0000-4000-8000-000000000001';
select pg_temp.as_server();
select isnt((select edited_at from sets where id = 'd4000000-0000-4000-8000-000000000001'), null, 'a title change on a published set stamps edited_at (7.1 #6)');
select pg_temp.act_as('d4d4d4d4-0000-4000-8000-000000000001');
select throws_ok($$update sets set edited_at = '2020-01-01' where id = 'd4000000-0000-4000-8000-000000000001'$$, '42501', null, 'owner: edited_at is the server''s');
select pg_temp.as_server();

-- 4. A Followers set switched to Only me closes its poll.
insert into sets (id, owner_id, title, status, visibility, published_at, layout) values
  ('d4000000-0000-4000-8000-000000000002', 'd4d4d4d4-0000-4000-8000-000000000001', 'Read-back followers set', 'published', 'followers', now() - interval '1 day', '{"version":1,"template":"","background":"#ffffff","caption":""}');
insert into polls (id, owner_id, question) values ('d4000000-0000-4000-8000-000000000021', 'd4d4d4d4-0000-4000-8000-000000000001', 'which?');
insert into poll_options (poll_id, set_id, sort_order) values
  ('d4000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000001', 0),
  ('d4000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000002', 1);
update sets set visibility = 'only_me' where id = 'd4000000-0000-4000-8000-000000000002';
select isnt((select closed_at from polls where id = 'd4000000-0000-4000-8000-000000000021'), null, 'a Followers set switched to Only me closes the poll that offered it');
select is((select edited_at from sets where id = 'd4000000-0000-4000-8000-000000000002'), null, 'a visibility change is not an edit: edited_at stays empty');

-- 5. shared_set carries the description and edited_at.
select is((select shared_set((select share_code from sets where id = 'd4000000-0000-4000-8000-000000000001')) ->> 'description'), 'A long coat over a short dress', 'shared_set carries the description');
select ok((select shared_set((select share_code from sets where id = 'd4000000-0000-4000-8000-000000000001')) ? 'edited_at'), 'shared_set carries edited_at');

select * from finish();
rollback;
