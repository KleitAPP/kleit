-- Tests for migration 059: a photo in a message is the sender's own screened picture; the other
-- person may read the file only while a live message in their conversation points at it and
-- the scan has cleared it; nobody else ever can; a first message to a stranger carries none.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('e7e7e7e7-0000-4000-8000-000000000001', 'mp-sender@test.kleit'),
  ('e7e7e7e7-0000-4000-8000-000000000002', 'mp-friend@test.kleit'),
  ('e7e7e7e7-0000-4000-8000-000000000003', 'mp-stranger@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e7e7e7e7-0000-4000-8000-000000000001', 'mpsender', now(), 't'),
  ('e7e7e7e7-0000-4000-8000-000000000002', 'mpfriend', now(), 't'),
  ('e7e7e7e7-0000-4000-8000-000000000003', 'mpstranger', now(), 't');
-- Sender and friend follow each other, so a message between them is never a request.
insert into follows (follower_id, followee_id) values
  ('e7e7e7e7-0000-4000-8000-000000000001', 'e7e7e7e7-0000-4000-8000-000000000002'),
  ('e7e7e7e7-0000-4000-8000-000000000002', 'e7e7e7e7-0000-4000-8000-000000000001');
-- The sender's pictures: one cleared, one still being checked, one product (not theirs to send).
insert into items (id, owner_id, kind, title, image_id, image_bucket) values
  ('e7000000-0000-4000-8000-000000000001', 'e7e7e7e7-0000-4000-8000-000000000001', 'own', 'clean photo', 'e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg', 'closet-photos'),
  ('e7000000-0000-4000-8000-000000000002', 'e7e7e7e7-0000-4000-8000-000000000001', 'own', 'unchecked photo', 'e7e7e7e7-0000-4000-8000-000000000001/messages/pending.jpg', 'closet-photos'),
  ('e7000000-0000-4000-8000-000000000003', 'e7e7e7e7-0000-4000-8000-000000000001', 'product', 'a product', 'e7e7e7e7-0000-4000-8000-000000000001/p.jpg', 'item-images');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('e7000000-0000-4000-8000-000000000001', 'clean', now()),
  ('e7000000-0000-4000-8000-000000000002', 'pending', null);
insert into storage.objects (bucket_id, name) values
  ('closet-photos', 'e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg'),
  ('closet-photos', 'e7e7e7e7-0000-4000-8000-000000000001/messages/pending.jpg');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
-- The parameter is p_name on purpose: in a SQL function a bare `name` resolves to the column,
-- and `o.name = name` is then always true (the first version of this test passed for that reason).
create function pg_temp.can_see(p_name text) returns boolean language sql as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'closet-photos' and o.name = p_name)
$$;

-- Before any message: the friend sees none of the sender's files.
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000002');
select ok(not pg_temp.can_see('e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg'), 'friend: cannot read the file before it is sent');

-- Sending.
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000001');
select throws_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000002', '', 'e7000000-0000-4000-8000-000000000003') $$, 'P0001', null, 'sender: a product picture cannot go in a message');
select throws_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000002', '', 'e7000000-0000-4000-8000-000000000099') $$, 'P0001', null, 'sender: a made-up picture is refused');
select throws_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000002', '') $$, 'P0001', null, 'sender: no words and no photo is nothing to send');
select lives_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000002', '', 'e7000000-0000-4000-8000-000000000001') $$, 'sender: a photo with no words goes');
select lives_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000002', 'and this one', 'e7000000-0000-4000-8000-000000000002') $$, 'sender: a photo still being checked goes too (it shows once cleared)');
select throws_ok($$ select send_message('e7e7e7e7-0000-4000-8000-000000000003', 'hi', 'e7000000-0000-4000-8000-000000000001') $$, 'P0001', null, 'sender: a first message to a stranger cannot carry a photo');

-- Reading.
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000002');
select is((select count(*)::int from messages where photo_item_id is not null and sender_id = 'e7e7e7e7-0000-4000-8000-000000000001'), 2, 'friend: sees both photo messages');
select ok(pg_temp.can_see('e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg'), 'friend: can read the cleared photo''s file');
select ok(not pg_temp.can_see('e7e7e7e7-0000-4000-8000-000000000001/messages/pending.jpg'), 'friend: cannot read the file of a photo still being checked');
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000003');
select ok(not pg_temp.can_see('e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg'), 'stranger: cannot read it');

-- Taking the message back takes the file with it.
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000001');
update messages set deleted_at = now() where photo_item_id = 'e7000000-0000-4000-8000-000000000001';
select pg_temp.act_as('e7e7e7e7-0000-4000-8000-000000000002');
select ok(not pg_temp.can_see('e7e7e7e7-0000-4000-8000-000000000001/messages/clean.jpg'), 'friend: once the message is taken back, the file is gone for them too');

select * from finish();
rollback;
