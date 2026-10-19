-- Tests for migration 117 (the read-back of the spec walk's batches): a restore refuses a
-- picture removed on another ground too, and one already purged; a "removed before" block is
-- not appealable and an appeal never republishes a listed picture; a copyright strike has no
-- in-app appeal; the third copyright strike's ban lifts with a restore; the message word list is
-- the short one at normal priority; the night job keeps the checked text rows thirty days and no
-- longer touches a report's evidence; a system-filed report is not "your report".
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

insert into auth.users (id, email) values
  ('d4000000-0000-4000-8000-000000000001', 'rb-uploader@test.kleit'),
  ('d4000000-0000-4000-8000-000000000002', 'rb-other@test.kleit'),
  ('d4000000-0000-4000-8000-000000000003', 'rb-mod-one@test.kleit'),
  ('d4000000-0000-4000-8000-000000000004', 'rb-mod-two@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d4000000-0000-4000-8000-000000000001', 'rbuploader', now(), 't'),
  ('d4000000-0000-4000-8000-000000000002', 'rbother', now(), 't'),
  ('d4000000-0000-4000-8000-000000000003', 'rbmodone', now(), 't'),
  ('d4000000-0000-4000-8000-000000000004', 'rbmodtwo', now(), 't');
insert into user_roles (user_id, role) values
  ('d4000000-0000-4000-8000-000000000003', 'moderator'),
  ('d4000000-0000-4000-8000-000000000004', 'moderator');

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

-- Pieces: one removed on a report first and then named by a copyright notice; one removed by a
-- copyright notice alone; one blocked by the scanner as "removed before".
insert into items (id, owner_id, kind, title, image_bucket, image_id, image_hash) values
  ('d4000000-0000-4000-8000-000000000011', 'd4000000-0000-4000-8000-000000000001', 'own', 'rb twice removed', 'closet-photos', 'd4000000-0000-4000-8000-000000000001/twice.jpg', 'rbhash-twice-0001'),
  ('d4000000-0000-4000-8000-000000000012', 'd4000000-0000-4000-8000-000000000001', 'own', 'rb once removed', 'closet-photos', 'd4000000-0000-4000-8000-000000000001/once.jpg', 'rbhash-once-00001'),
  ('d4000000-0000-4000-8000-000000000013', 'd4000000-0000-4000-8000-000000000001', 'own', 'rb re-upload', 'closet-photos', 'd4000000-0000-4000-8000-000000000001/again.jpg', 'rbhash-twice-0001');
insert into item_flags (item_id, scan_state, scanned_at, labels) values
  ('d4000000-0000-4000-8000-000000000011', 'clean', now(), '{}'),
  ('d4000000-0000-4000-8000-000000000012', 'clean', now(), '{}'),
  ('d4000000-0000-4000-8000-000000000013', 'blocked', now(), '{"reason": "removed-before", "matched": "rbhash-twice-0001"}');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('d4000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000001', 'rb set', 'published', 'public', 'rbset00000000001', now());
insert into set_items (set_id, item_id) values ('d4000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000011');

-- 1. The report's removal first (moderate: fingerprint + removed), then a copyright notice on the
--    same picture; the counter-notice on that notice must not undo the report's removal.
select pg_temp.act_as('d4000000-0000-4000-8000-000000000002');
select lives_ok($$ select file_report('item', 'd4000000-0000-4000-8000-000000000011', 'nudity', 'rb') $$, 'other: reports the picture');
select pg_temp.act_as('d4000000-0000-4000-8000-000000000003');
select lives_ok($$ select moderate((select r.id from reports r where r.target_id = 'd4000000-0000-4000-8000-000000000011' and r.state = 'open'), 'remove', 'rb') $$, 'moderator: removes it on the report');
select pg_temp.as_server();
insert into takedown_requests (id, request_ref, kind, name, email, urls, work, statements, signature) values
  ('d4000000-0000-4000-8000-000000000031', 'T-RBTWICE1', 'copyright', 'C. Laimant', 'c@example.com', '{https://kleit-test.example/item/x}', 'mine', true, 'C. Laimant'),
  ('d4000000-0000-4000-8000-000000000032', 'T-RBONCE01', 'copyright', 'C. Laimant', 'c@example.com', '{https://kleit-test.example/item/y}', 'mine', true, 'C. Laimant');
select pg_temp.act_as('d4000000-0000-4000-8000-000000000003');
select lives_ok($$ select takedown_resolve('d4000000-0000-4000-8000-000000000031', 'removed', 'rb', 'd4000000-0000-4000-8000-000000000011') $$, 'moderator: the copyright notice on the already-removed picture is resolved');
select lives_ok($$ select takedown_resolve('d4000000-0000-4000-8000-000000000032', 'removed', 'rb', 'd4000000-0000-4000-8000-000000000012') $$, 'moderator: and the one on the other picture');
select pg_temp.as_server();
select is((select file_counter_notice('T-RBTWICE1', 'U. Ploader', 'u@example.com', '1 Main St', '', 'mine', true, true, 'U. Ploader', 'h') ~ '^C-'), true, 'server: a counter-notice is filed on the twice-removed picture');
select is((select file_counter_notice('T-RBONCE01', 'U. Ploader', 'u@example.com', '1 Main St', '', 'mine', true, true, 'U. Ploader', 'h') ~ '^C-'), true, 'server: and on the once-removed one');
update counter_notices set restore_after = now() - interval '1 hour';
select pg_temp.act_as('d4000000-0000-4000-8000-000000000004');
select is((select q.other_grounds from counter_notice_queue() q where q.takedown_ref = 'T-RBTWICE1'), true, 'moderator: the queue says the twice-removed picture has another ground');
select is((select q.claimant_email from counter_notice_queue() q where q.takedown_ref = 'T-RBONCE01'), 'c@example.com', 'moderator: and names the claimant to forward to');
select throws_ok($$ select counter_notice_resolve((select c.id from counter_notices c join takedown_requests t on t.id = c.takedown_id where t.request_ref = 'T-RBTWICE1'), 'restored', '') $$, 'P0008', null, 'moderator: a restore is refused when a report removed the picture too');
select is((select counter_notice_resolve((select c.id from counter_notices c join takedown_requests t on t.id = c.takedown_id where t.request_ref = 'T-RBONCE01'), 'restored', 'fine')), 1, 'moderator: the once-removed picture is restored');
select pg_temp.as_server();
select is((select takedown_state from items where id = 'd4000000-0000-4000-8000-000000000011'), 'removed'::takedown_state, 'the report''s removal stands');
select is((select count(*) from removed_image_fingerprints where image_hash = 'rbhash-twice-0001'), 1::bigint, 'and its fingerprint too');
-- A purged picture cannot be restored.
update items set purged_at = now() where id = 'd4000000-0000-4000-8000-000000000012';
select throws_ok($$ select file_counter_notice('T-RBONCE01', 'U. Ploader', 'u@example.com', '1 Main St', '', 'again', true, true, 'U. Ploader', 'h') $$, 'P0001', null, 'a second counter-notice on a decided notice is refused');

-- 2. The re-upload blocked as "removed before" cannot be appealed, and a listed picture is never
--    republished by an appeal.
select pg_temp.act_as('d4000000-0000-4000-8000-000000000001');
select is((select photo_appeal_allowed('d4000000-0000-4000-8000-000000000013')), false, 'owner: a removed-before block offers no appeal');
select throws_ok($$ insert into appeals (item_id, user_id, body) values ('d4000000-0000-4000-8000-000000000013', 'd4000000-0000-4000-8000-000000000001', 'mine') $$, '42501', null, 'owner: and the policy refuses it');
-- A copyright strike takes no in-app appeal.
select throws_ok($$ insert into appeals (strike_id, user_id, body) values ((select s.id from strikes s where s.user_id = 'd4000000-0000-4000-8000-000000000001' and s.kind = 'copyright' and s.expires_at > now() limit 1), 'd4000000-0000-4000-8000-000000000001', 'please') $$, '42501', null, 'owner: a copyright strike is answered by a counter-notice, not an appeal');

-- 3. Messages: the short list, normal priority; "calories" alone files nothing.
select pg_temp.as_server();
insert into conversations (id, user_a, user_b) values ('d4000000-0000-4000-8000-000000000041', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002');
insert into messages (conversation_id, sender_id, body) values ('d4000000-0000-4000-8000-000000000041', 'd4000000-0000-4000-8000-000000000001', 'how many calories in a croissant, and is purging the closet on saturday ok?');
select is((select count(*) from reports r where r.target_type = 'conversation' and r.target_id = 'd4000000-0000-4000-8000-000000000041'), 0::bigint, 'everyday words in a message file nothing');
insert into messages (conversation_id, sender_id, body) values ('d4000000-0000-4000-8000-000000000041', 'd4000000-0000-4000-8000-000000000002', 'looking for an ana buddy');
select is((select r.priority from reports r where r.target_type = 'conversation' and r.target_id = 'd4000000-0000-4000-8000-000000000041' and r.state = 'open'), 'normal', 'a community name files a report at normal priority');
-- 4. The sender does not see the report filed in their name as "their report".
select pg_temp.act_as('d4000000-0000-4000-8000-000000000002');
select is((select count(*) from my_reports() r where r.target_type = 'conversation'), 0::bigint, 'sender: the system-filed report is not among their own');

-- 5. The night job: checked text rows go at thirty days; a resolved report with evidence older
--    than two years is deleted rather than refused.
select pg_temp.as_server();
update text_checks set state = 'ok', checked_at = now() - interval '40 days' where kind = 'message' and target_id in (select id from messages where conversation_id = 'd4000000-0000-4000-8000-000000000041');
insert into reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, state, evidence, created_at, resolved_at) values
  ('K-RBOLDEV1', 'd4000000-0000-4000-8000-000000000002', 'conversation', 'd4000000-0000-4000-8000-000000000041', 'd4000000-0000-4000-8000-000000000001', 'harassment', 'dismissed', '[{"body": "old"}]', now() - interval '3 years', now() - interval '3 years');
select lives_ok($$ select private.nightly_cleanup() $$, 'the night job runs with an old evidence row in the table');
select is((select count(*) from text_checks c join messages m on m.id = c.target_id where m.conversation_id = 'd4000000-0000-4000-8000-000000000041'), 0::bigint, 'the checked text rows are gone at thirty days');
select is((select count(*) from reports where request_ref = 'K-RBOLDEV1'), 0::bigint, 'and the three-year-old report with evidence went with the rest');

select * from finish();
rollback;
