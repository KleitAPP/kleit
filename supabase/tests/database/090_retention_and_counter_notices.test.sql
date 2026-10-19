-- Tests for migration 115: the data map's periods kept by the night job and the file purge
-- list; a copyright takedown's strike, the counter-notice, its restore, and the purge hold.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(27);

insert into auth.users (id, email) values
  ('d2000000-0000-4000-8000-000000000001', 'rc-uploader@test.kleit'),
  ('d2000000-0000-4000-8000-000000000002', 'rc-other@test.kleit'),
  ('d2000000-0000-4000-8000-000000000003', 'rc-mod@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d2000000-0000-4000-8000-000000000001', 'rcuploader', now(), 't'),
  ('d2000000-0000-4000-8000-000000000002', 'rcother', now(), 't'),
  ('d2000000-0000-4000-8000-000000000003', 'rcmod', now(), 't');
insert into user_roles (user_id, role) values ('d2000000-0000-4000-8000-000000000003', 'moderator');

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

-- 1. The night job keeps the periods: what is past goes, what is not stays.
insert into age_confirmations (user_id_hash, terms_version, purge_after) values
  ('rc-hash-old', 't', now() - interval '1 day'),
  ('rc-hash-new', 't', now() + interval '300 days'),
  ('rc-hash-open', 't', null);
insert into reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, state, created_at, resolved_at) values
  ('K-RCOLD0001', 'd2000000-0000-4000-8000-000000000002', 'profile', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'spam', 'dismissed', now() - interval '3 years', now() - interval '3 years'),
  ('K-RCNEW0001', 'd2000000-0000-4000-8000-000000000002', 'profile', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'spam', 'dismissed', now() - interval '1 year', now() - interval '1 year');
insert into moderation_actions (moderator_id, target_type, target_id, action, created_at) values
  ('d2000000-0000-4000-8000-000000000003', 'profile', 'd2000000-0000-4000-8000-000000000001', 'dismiss', now() - interval '3 years'),
  ('d2000000-0000-4000-8000-000000000003', 'profile', 'd2000000-0000-4000-8000-000000000001', 'dismiss', now() - interval '1 month');
insert into contact_messages (request_ref, topic, name, email, message, state, created_at) values
  ('C-RCOLD001', 'question', 'rc', 'rc@example.com', 'old', 'answered', now() - interval '3 years'),
  ('C-RCOPEN01', 'question', 'rc', 'rc@example.com', 'still open', 'open', now() - interval '3 years');
insert into admin_audit_log (admin_id, what, reason, created_at) values
  ('d2000000-0000-4000-8000-000000000003', 'user_lookup', 'rc old', now() - interval '3 years');
select lives_ok($$ select private.nightly_cleanup() $$, 'the night job runs');
select is((select count(*) from age_confirmations where user_id_hash like 'rc-hash-%'), 2::bigint, 'the 18+ record past its year is gone; the newer one and the open account stay');
select is((select count(*) from reports where request_ref like 'K-RC%'), 1::bigint, 'a report resolved three years ago is gone; one year old stays');
select is((select count(*) from moderation_actions where target_id = 'd2000000-0000-4000-8000-000000000001' and action = 'dismiss'), 1::bigint, 'a moderation action three years old is gone');
select is((select count(*) from contact_messages where request_ref like 'C-RC%'), 1::bigint, 'an answered contact message three years old is gone; an open one stays');
select is((select count(*) from admin_audit_log where reason = 'rc old'), 0::bigint, 'an audit row three years old is gone');

-- 2. The files whose time is up, listed from storage's own table.
insert into storage.objects (bucket_id, name, created_at) values
  ('exports', 'd2000000-0000-4000-8000-000000000001/old.zip', now() - interval '8 days'),
  ('exports', 'd2000000-0000-4000-8000-000000000001/new.zip', now() - interval '1 day'),
  ('evidence', 'takedowns/rc-old-evidence', now() - interval '13 months'),
  ('evidence', 'takedowns/rc-new-evidence', now() - interval '1 month'),
  ('private-fonts', 'd2000000-0000-4000-8000-000000000001/mine.woff2', now() - interval '1 day'),
  ('private-fonts', 'd2000000-0000-4000-8000-0000000000ee/gone.woff2', now() - interval '1 day');
select is((select count(*) from claim_file_purges(100) f where f.name in ('d2000000-0000-4000-8000-000000000001/old.zip', 'takedowns/rc-old-evidence', 'd2000000-0000-4000-8000-0000000000ee/gone.woff2')), 3::bigint, 'the old export, the year-old evidence and the gone account''s font are listed');
select is((select count(*) from claim_file_purges(100) f where f.name in ('d2000000-0000-4000-8000-000000000001/new.zip', 'takedowns/rc-new-evidence', 'd2000000-0000-4000-8000-000000000001/mine.woff2')), 0::bigint, 'the fresh export, the fresh evidence and a live account''s font are not');

-- 3. A copyright takedown: the picture goes, its uploader gets a 90-day copyright strike, the
--    purge holds the picture for the counter-notice window; an intimate takedown's does not wait.
insert into items (id, owner_id, kind, title, image_bucket, image_id, image_hash) values
  ('d2000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000001', 'own', 'rc copied coat', 'closet-photos', 'd2000000-0000-4000-8000-000000000001/coat.jpg', 'rchash-coat-0001'),
  ('d2000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000001', 'own', 'rc intimate', 'closet-photos', 'd2000000-0000-4000-8000-000000000001/private.jpg', 'rchash-private-01');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('d2000000-0000-4000-8000-000000000011', 'clean', now()),
  ('d2000000-0000-4000-8000-000000000012', 'clean', now());
insert into takedown_requests (id, request_ref, kind, name, email, urls, work, statements, signature) values
  ('d2000000-0000-4000-8000-000000000021', 'T-RCCOPY01', 'copyright', 'A. Photographer', 'a@example.com', '{https://kleit-test.example/item/x}', 'my photo', true, 'A. Photographer'),
  ('d2000000-0000-4000-8000-000000000022', 'T-RCINTIM1', 'intimate', 'B. Person', 'b@example.com', '{https://kleit-test.example/item/y}', '', false, '');
select pg_temp.act_as('d2000000-0000-4000-8000-000000000003');
select is((select takedown_resolve('d2000000-0000-4000-8000-000000000021', 'removed', 'valid notice', 'd2000000-0000-4000-8000-000000000011')), 1, 'moderator: the copyright takedown removes the picture');
select is((select takedown_resolve('d2000000-0000-4000-8000-000000000022', 'removed', 'valid', 'd2000000-0000-4000-8000-000000000012')), 1, 'moderator: the intimate takedown removes its picture');
select pg_temp.as_server();
select is((select count(*) from strikes s where s.user_id = 'd2000000-0000-4000-8000-000000000001' and s.kind = 'copyright' and s.expires_at between now() + interval '89 days' and now() + interval '91 days'), 1::bigint, 'the uploader has one copyright strike for 90 days');
select is((select item_id from takedown_requests where id = 'd2000000-0000-4000-8000-000000000021'), 'd2000000-0000-4000-8000-000000000011'::uuid, 'the takedown remembers the picture it removed');
select is((select count(*) from claim_purges(100) p where p.id = 'd2000000-0000-4000-8000-000000000011'), 0::bigint, 'the purge holds the copyright takedown''s picture');
select is((select count(*) from claim_purges(100) p where p.id = 'd2000000-0000-4000-8000-000000000012'), 1::bigint, 'and lists the intimate takedown''s at once');

-- 4. The counter-notice: only on a copyright takedown that removed something; once while open;
--    listed for a moderator; restored, the picture and the strike come back; the sender can check.
select throws_ok($$ select file_counter_notice('T-RCINTIM1', 'U. Uploader', 'u@example.com', '1 Main St, Town, ST 00000', '', 'mine', true, true, 'U. Uploader', 'h') $$, 'P0002', null, 'no counter-notice on an intimate takedown');
select throws_ok($$ select file_counter_notice('T-RCCOPY01', 'U. Uploader', 'u@example.com', '1 Main St, Town, ST 00000', '', 'mine', false, true, 'U. Uploader', 'h') $$, '22023', null, 'the statements are required');
select is((select file_counter_notice('T-RCCOPY01', 'U. Uploader', 'u@example.com', '1 Main St, Town, ST 00000', '', 'it is my own photo', true, true, 'U. Uploader', 'h') ~ '^C-'), true, 'server: files the counter-notice and gets a C- reference');
select throws_ok($$ select file_counter_notice('T-RCCOPY01', 'U. Uploader', 'u@example.com', '1 Main St, Town, ST 00000', '', 'again', true, true, 'U. Uploader', 'h') $$, 'P0001', null, 'not a second one while the first is open');
select is((select state from counter_notice_status((select request_ref from counter_notices where takedown_id = 'd2000000-0000-4000-8000-000000000021'))), 'open', 'the sender can check it by reference');
select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
select is((select count(*) from counter_notice_queue()), 0::bigint, 'other: sees no counter-notices');
select pg_temp.act_as('d2000000-0000-4000-8000-000000000003');
select is((select q.takedown_ref from counter_notice_queue() q limit 1), 'T-RCCOPY01', 'moderator: the counter-notice is listed with its takedown');
select throws_ok($$ select counter_notice_resolve((select id from counter_notices where takedown_id = 'd2000000-0000-4000-8000-000000000021'), 'restored', 'too soon') $$, 'P0006', null, 'moderator: cannot restore before the notice''s date');
select pg_temp.as_server();
update counter_notices set restore_after = now() - interval '1 hour' where takedown_id = 'd2000000-0000-4000-8000-000000000021';
select pg_temp.act_as('d2000000-0000-4000-8000-000000000003');
select is((select counter_notice_resolve((select id from counter_notices where takedown_id = 'd2000000-0000-4000-8000-000000000021'), 'restored', 'no suit filed')), 1, 'moderator: restores the picture once the date has passed');
select pg_temp.as_server();
select is((select takedown_state from items where id = 'd2000000-0000-4000-8000-000000000011'), 'none'::takedown_state, 'the picture is back');
select is((select count(*) from removed_image_fingerprints where image_hash = 'rchash-coat-0001'), 0::bigint, 'its fingerprint is forgotten');
select is((select count(*) from strikes s where s.user_id = 'd2000000-0000-4000-8000-000000000001' and s.kind = 'copyright' and s.expires_at > now()), 0::bigint, 'and the copyright strike has ended');
select is((select state from counter_notices where takedown_id = 'd2000000-0000-4000-8000-000000000021'), 'restored', 'the counter-notice reads restored');

select * from finish();
rollback;
