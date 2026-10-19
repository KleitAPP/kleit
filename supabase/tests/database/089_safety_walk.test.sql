-- Tests for migration 113 (the safety walk, spec 13.1 #3/#5, 13.2 #1, 13.4 #1/#2/#4/#9).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(34);

insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-000000000001', 'sw-owner@test.kleit'),
  ('d1000000-0000-4000-8000-000000000002', 'sw-viewer@test.kleit'),
  ('d1000000-0000-4000-8000-000000000003', 'sw-mod-one@test.kleit'),
  ('d1000000-0000-4000-8000-000000000004', 'sw-mod-two@test.kleit'),
  ('d1000000-0000-4000-8000-000000000005', 'sw-admin@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d1000000-0000-4000-8000-000000000001', 'swowner', now(), 't'),
  ('d1000000-0000-4000-8000-000000000002', 'swviewer', now(), 't'),
  ('d1000000-0000-4000-8000-000000000003', 'swmodone', now(), 't'),
  ('d1000000-0000-4000-8000-000000000004', 'swmodtwo', now(), 't'),
  ('d1000000-0000-4000-8000-000000000005', 'swadmin', now(), 't');
insert into user_roles (user_id, role) values
  ('d1000000-0000-4000-8000-000000000003', 'moderator'),
  ('d1000000-0000-4000-8000-000000000004', 'moderator'),
  ('d1000000-0000-4000-8000-000000000005', 'admin');

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

-- The owner's pieces: a cleared swimsuit (kept out of featured), a cleared coat, a photo the
-- scanner sent for review, a blocked photo, a blocked photo with a copy under the viewer's name.
insert into items (id, owner_id, kind, title, image_bucket, image_id, image_hash) values
  ('d1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 'own', 'sw swimsuit', 'closet-photos', 'd1000000-0000-4000-8000-000000000001/swim.jpg', null),
  ('d1000000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000001', 'own', 'sw coat', 'closet-photos', 'd1000000-0000-4000-8000-000000000001/coat.jpg', null),
  ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000001', 'own', 'sw review photo', 'closet-photos', 'd1000000-0000-4000-8000-000000000001/review.jpg', null),
  ('d1000000-0000-4000-8000-000000000014', 'd1000000-0000-4000-8000-000000000001', 'own', 'sw blocked photo', 'closet-photos', 'd1000000-0000-4000-8000-000000000001/blocked.jpg', null),
  ('d1000000-0000-4000-8000-000000000015', 'd1000000-0000-4000-8000-000000000001', 'own', 'sw reported photo', 'closet-photos', 'd1000000-0000-4000-8000-000000000001/reported.jpg', 'swhash-reported-0001'),
  ('d1000000-0000-4000-8000-000000000016', 'd1000000-0000-4000-8000-000000000002', 'own', 'sw the copy', 'closet-photos', 'd1000000-0000-4000-8000-000000000002/copy.jpg', 'swhash-reported-0001');
insert into item_flags (item_id, scan_state, scanned_at, labels) values
  ('d1000000-0000-4000-8000-000000000011', 'clean', now(), '{"keep_out_of_featured": true, "because": ["Swimwear or Underwear"]}'),
  ('d1000000-0000-4000-8000-000000000012', 'clean', now(), '{"keep_out_of_featured": false}'),
  ('d1000000-0000-4000-8000-000000000013', 'review', now(), '{"because": ["Non-Explicit Nudity"]}'),
  ('d1000000-0000-4000-8000-000000000014', 'blocked', now(), '{"because": ["Explicit Nudity"]}'),
  ('d1000000-0000-4000-8000-000000000015', 'clean', now(), '{}'),
  ('d1000000-0000-4000-8000-000000000016', 'clean', now(), '{}');
insert into sets (id, owner_id, title, status, visibility, share_code, preview_image_id, published_at) values
  ('d1000000-0000-4000-8000-000000000021', 'd1000000-0000-4000-8000-000000000001', 'sw beach set', 'published', 'public', 'swbeachset000001', 'p1', now()),
  ('d1000000-0000-4000-8000-000000000022', 'd1000000-0000-4000-8000-000000000001', 'sw coat set', 'published', 'public', 'swcoatset0000001', 'p2', now());
insert into set_items (set_id, item_id) values
  ('d1000000-0000-4000-8000-000000000021', 'd1000000-0000-4000-8000-000000000011'),
  ('d1000000-0000-4000-8000-000000000022', 'd1000000-0000-4000-8000-000000000012'),
  ('d1000000-0000-4000-8000-000000000022', 'd1000000-0000-4000-8000-000000000015');

-- 1. PG-13: the column reads the scanner's label; the beach set is not PG-13, the coat set is.
select is((select keep_out_of_featured from item_flags where item_id = 'd1000000-0000-4000-8000-000000000011'), true, 'the swimsuit flag reads keep_out_of_featured');
select is((select private.set_is_pg13('d1000000-0000-4000-8000-000000000021')), false, 'a set with the swimsuit is not PG-13');
select is((select private.set_is_pg13('d1000000-0000-4000-8000-000000000022')), true, 'a set with the coat is');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
select is((select count(*) from feed_featured(0, 20) f where f.id = 'd1000000-0000-4000-8000-000000000021'), 0::bigint, 'viewer: Featured leaves the beach set out');
select is((select count(*) from feed_featured(0, 20) f where f.id = 'd1000000-0000-4000-8000-000000000022'), 1::bigint, 'viewer: and shows the coat set');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000005');
select throws_ok($$ select feature_set('d1000000-0000-4000-8000-000000000021', true) $$, 'P0001', null, 'admin: cannot feature the beach set');
select is((select feature_set('d1000000-0000-4000-8000-000000000022', true)), true, 'admin: features the coat set');

-- 2. The scanner's review verdict is listed for a moderator and decided; the owner is told.
select pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
select is((select count(*) from scan_review_queue()), 0::bigint, 'viewer: the scan review queue answers nothing');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000003');
select is((select count(*) from scan_review_queue() q where q.item_id = 'd1000000-0000-4000-8000-000000000013'), 1::bigint, 'moderator one: the review photo is in the scan queue');
select is((select q.owner_username from scan_review_queue() q where q.item_id = 'd1000000-0000-4000-8000-000000000013'), 'swowner', 'moderator one: with its owner');
select throws_ok($$ select scan_decide('d1000000-0000-4000-8000-000000000012', 'clean', '') $$, 'P0002', null, 'moderator one: a photo not in review cannot be decided');
select lives_ok($$ select scan_decide('d1000000-0000-4000-8000-000000000013', 'blocked', 'not clothing') $$, 'moderator one: blocks the review photo');
select pg_temp.as_server();
select is((select scan_state from item_flags where item_id = 'd1000000-0000-4000-8000-000000000013'), 'blocked'::scan_state, 'the flag is blocked');
select is((select count(*) from moderation_actions m where m.target_id = 'd1000000-0000-4000-8000-000000000013' and m.action = 'scan_block' and m.moderator_id = 'd1000000-0000-4000-8000-000000000003'), 1::bigint, 'the decision is logged');
select pg_temp.as_server();
select is((select count(*) from notifications n where n.user_id = 'd1000000-0000-4000-8000-000000000001' and n.kind = 'photo_decided' and n.ref_id = 'd1000000-0000-4000-8000-000000000013'), 1::bigint, 'the owner is told');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
select throws_ok($$ select scan_decide('d1000000-0000-4000-8000-000000000013', 'clean', '') $$, '42501', null, 'viewer: cannot decide a scan');

-- 3. The owner appeals the blocked photo, once; a clean one cannot be appealed; a stranger cannot.
select pg_temp.act_as('d1000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into appeals (item_id, user_id, body) values ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000001', 'it is a swimsuit on a hanger') $$, 'owner: appeals the blocked photo');
select throws_ok($$ insert into appeals (item_id, user_id, body) values ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000001', 'again') $$, '23505', null, 'owner: not twice');
select throws_ok($$ insert into appeals (item_id, user_id, body) values ('d1000000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000001', 'clean already') $$, '42501', null, 'owner: a photo that is not blocked cannot be appealed');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
select throws_ok($$ insert into appeals (item_id, user_id, body) values ('d1000000-0000-4000-8000-000000000014', 'd1000000-0000-4000-8000-000000000002', 'not mine') $$, '42501', null, 'viewer: cannot appeal somebody else''s photo');
-- The moderator who blocked it does not decide the appeal; the second one overturns it, and the photo clears.
select pg_temp.act_as('d1000000-0000-4000-8000-000000000003');
select throws_ok($$ select decide_appeal((select id from appeals where item_id = 'd1000000-0000-4000-8000-000000000013'), 'overturned', '') $$, 'P0004', null, 'moderator one: the person who blocked it does not review the appeal');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000004');
select lives_ok($$ select decide_appeal((select id from appeals where item_id = 'd1000000-0000-4000-8000-000000000013'), 'overturned', 'a hanger') $$, 'moderator two: overturns it');
select pg_temp.as_server();
select is((select scan_state from item_flags where item_id = 'd1000000-0000-4000-8000-000000000013'), 'clean'::scan_state, 'the photo is clean again');
select is((select count(*) from notifications n where n.user_id = 'd1000000-0000-4000-8000-000000000001' and n.kind = 'appeal_decided' and n.ref_type = 'item' and n.ref_id = 'd1000000-0000-4000-8000-000000000013'), 1::bigint, 'the owner is told of the appeal, pointing at the photo');

-- 4. A moderator's removal fingerprints the picture and takes the identical copy with it; the queue
--    carried the piece's own id for the picture and a due time a day out for an urgent report.
select pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
select is((select file_report('item', 'd1000000-0000-4000-8000-000000000015', 'intimate_image', 'sw test') ~ '^K-'), true, 'viewer: reports the owner''s photo as an intimate image');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000003');
select is((select q.picture_item_id from moderation_queue() q where q.target_id = 'd1000000-0000-4000-8000-000000000015'), 'd1000000-0000-4000-8000-000000000015'::uuid, 'moderator: the queue names the piece whose picture to show');
select is((select q.due_at - q.created_at from moderation_queue() q where q.target_id = 'd1000000-0000-4000-8000-000000000015'), interval '24 hours', 'moderator: an urgent report is due in a day');
select pg_temp.as_server();
select is((select count(*) from notifications n where n.kind = 'mod_urgent' and n.user_id in ('d1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000005')), 3::bigint, 'every moderator and admin was told of the urgent report');
select pg_temp.act_as('d1000000-0000-4000-8000-000000000003');
select lives_ok($$ select moderate((select r.id from reports r where r.target_id = 'd1000000-0000-4000-8000-000000000015' and r.state = 'open'), 'remove', 'sw test') $$, 'moderator: removes it');
select pg_temp.as_server();
select is((select count(*) from removed_image_fingerprints where image_hash = 'swhash-reported-0001'), 1::bigint, 'the fingerprint is listed');
select is((select takedown_state from items where id = 'd1000000-0000-4000-8000-000000000016'), 'removed'::takedown_state, 'and the identical copy under another name went with it');

-- 5. A message with a held phrase files one urgent report on the conversation with the evidence;
--    a second such message does not file another; every message is queued for the outside check.
select pg_temp.as_server();
insert into conversations (id, user_a, user_b) values ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');
-- One statement each: a row-level AFTER trigger runs once the whole statement is in, so three
-- rows in one insert would all be "so far" for the second one.
insert into messages (conversation_id, sender_id, body) values ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000001', 'hello there');
insert into messages (conversation_id, sender_id, body) values ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000002', 'any thinspo pics?');
insert into messages (conversation_id, sender_id, body) values ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000002', 'more thinspo please');
select is((select count(*) from reports r where r.target_type = 'conversation' and r.target_id = 'd1000000-0000-4000-8000-000000000031' and r.state = 'open' and r.priority = 'urgent' and r.target_owner_id = 'd1000000-0000-4000-8000-000000000002'), 1::bigint, 'one urgent report on the conversation, against the sender');
select is((select jsonb_array_length(r.evidence) from reports r where r.target_type = 'conversation' and r.target_id = 'd1000000-0000-4000-8000-000000000031' and r.state = 'open'), 2, 'with the messages so far as evidence');
select is((select count(*) from text_checks c join messages m on m.id = c.target_id where c.kind = 'message' and m.conversation_id = 'd1000000-0000-4000-8000-000000000031'), 3::bigint, 'and every message waits for the outside check');

select * from finish();
rollback;
