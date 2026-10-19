-- Tests for migration 110: suggested people (who is suggested, in what order, and who never is);
-- the Inbox badge leaves out the kinds muted in the app; the contact form takes "recovery".
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

-- Me, and nine people: a stylist, a winner, a match, two who share nothing, and four matches
-- that must not be suggested (not suggestable, followed, muted, blocked, on a break).
insert into auth.users (id, email) values
  ('5e000000-0000-4000-8000-000000000001', 'sp-me@test.kleit'),
  ('5e000000-0000-4000-8000-000000000002', 'sp-stylist@test.kleit'),
  ('5e000000-0000-4000-8000-000000000003', 'sp-winner@test.kleit'),
  ('5e000000-0000-4000-8000-000000000004', 'sp-match@test.kleit'),
  ('5e000000-0000-4000-8000-000000000005', 'sp-stranger@test.kleit'),
  ('5e000000-0000-4000-8000-000000000006', 'sp-quiet@test.kleit'),
  ('5e000000-0000-4000-8000-000000000007', 'sp-followed@test.kleit'),
  ('5e000000-0000-4000-8000-000000000008', 'sp-muted@test.kleit'),
  ('5e000000-0000-4000-8000-000000000009', 'sp-blocked@test.kleit'),
  ('5e000000-0000-4000-8000-000000000010', 'sp-away@test.kleit'),
  ('5e000000-0000-4000-8000-000000000011', 'sp-admin@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('5e000000-0000-4000-8000-000000000001', 'spme', now(), 't'),
  ('5e000000-0000-4000-8000-000000000002', 'spstylist', now(), 't'),
  ('5e000000-0000-4000-8000-000000000003', 'spwinner', now(), 't'),
  ('5e000000-0000-4000-8000-000000000004', 'spmatch', now(), 't'),
  ('5e000000-0000-4000-8000-000000000005', 'spstranger', now(), 't'),
  ('5e000000-0000-4000-8000-000000000006', 'spquiet', now(), 't'),
  ('5e000000-0000-4000-8000-000000000007', 'spfollowed', now(), 't'),
  ('5e000000-0000-4000-8000-000000000008', 'spmuted', now(), 't'),
  ('5e000000-0000-4000-8000-000000000009', 'spblocked', now(), 't'),
  ('5e000000-0000-4000-8000-000000000010', 'spaway', now(), 't'),
  ('5e000000-0000-4000-8000-000000000011', 'spadmin', now(), 't');
update profiles set label = 'stylist' where user_id = '5e000000-0000-4000-8000-000000000002';
update profiles set suggestable = false where user_id = '5e000000-0000-4000-8000-000000000006';
update profiles set deactivated_at = now() where user_id = '5e000000-0000-4000-8000-000000000010';
insert into user_roles (user_id, role) values ('5e000000-0000-4000-8000-000000000011', 'admin');
-- My set: two tags and one store piece.
insert into items (id, owner_id, kind, title, source_url, source_domain) values
  ('5e000000-0000-4000-8000-000000000101', '5e000000-0000-4000-8000-000000000001', 'product', 'sp my boots', 'https://wombat.example/b', 'wombat.example'),
  ('5e000000-0000-4000-8000-000000000102', '5e000000-0000-4000-8000-000000000004', 'product', 'sp match boots', 'https://wombat.example/c', 'wombat.example');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('5e000000-0000-4000-8000-000000000101', 'clean', now()),
  ('5e000000-0000-4000-8000-000000000102', 'clean', now());
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, tags) values
  ('5e000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000001', 'sp mine', 'published', 'public', 'spmine0000000001', now(), '{autumn,boots}'),
  ('5e000000-0000-4000-8000-000000000202', '5e000000-0000-4000-8000-000000000003', 'sp winning', 'published', 'public', 'spwinning0000001', now(), '{}'),
  ('5e000000-0000-4000-8000-000000000204', '5e000000-0000-4000-8000-000000000004', 'sp matching', 'published', 'public', 'spmatching000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000205', '5e000000-0000-4000-8000-000000000005', 'sp strange', 'published', 'public', 'spstrange0000001', now(), '{summer}'),
  ('5e000000-0000-4000-8000-000000000206', '5e000000-0000-4000-8000-000000000006', 'sp quiet', 'published', 'public', 'spquiet000000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000207', '5e000000-0000-4000-8000-000000000007', 'sp followed', 'published', 'public', 'spfollowed000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000208', '5e000000-0000-4000-8000-000000000008', 'sp muted', 'published', 'public', 'spmuted000000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000209', '5e000000-0000-4000-8000-000000000009', 'sp blocked', 'published', 'public', 'spblocked0000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000210', '5e000000-0000-4000-8000-000000000010', 'sp away', 'published', 'public', 'spaway0000000001', now(), '{autumn}'),
  ('5e000000-0000-4000-8000-000000000211', '5e000000-0000-4000-8000-000000000004', 'sp match draft', 'draft', 'public', 'spmatchdraft0001', null, '{boots}');
insert into set_items (set_id, item_id, position) values
  ('5e000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000101', '{"slot": 0}'),
  ('5e000000-0000-4000-8000-000000000204', '5e000000-0000-4000-8000-000000000102', '{"slot": 0}');
-- The winner: a closed challenge, an entry an admin picked.
insert into contests (id, title, opens_at, closes_at, created_by) values
  ('5e000000-0000-4000-8000-000000000301', 'sp week (ignore)', now() - interval '8 days', now() - interval '1 day', '5e000000-0000-4000-8000-000000000011');
insert into contest_entries (contest_id, user_id, set_id, created_at, picked_at) values
  ('5e000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000202', now() - interval '5 days', now());
-- The four who must stay out: followed, muted, blocked (by them), on a break (above).
insert into follows (follower_id, followee_id) values ('5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000007');
insert into mutes (muter_id, muted_id) values ('5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000008');
insert into blocks (blocker_id, blocked_id) values ('5e000000-0000-4000-8000-000000000009', '5e000000-0000-4000-8000-000000000001');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1. Who is suggested to me, and in what order.
select pg_temp.act_as('5e000000-0000-4000-8000-000000000001');
create temp table sp_mine as select row_number() over () as n, * from suggested_people(30) where username like 'sp%';
select is((select count(*)::int from sp_mine), 3, 'me: three people are suggested - the stylist, the winner and the match');
select is((select username from sp_mine where n = 1), 'spstylist', 'me: the stylist comes first');
select is((select why from sp_mine where n = 1), 'label', 'me: and the reason is the label');
select is((select username from sp_mine where n = 2), 'spwinner', 'me: the challenge winner second');
select is((select why from sp_mine where n = 2), 'winner', 'me: with their reason');
select is((select username from sp_mine where n = 3), 'spmatch', 'me: the person who shares a tag and a store third');
select is((select why from sp_mine where n = 3), 'match', 'me: as a style match');
select is((select count(*)::int from sp_mine where username in ('spstranger', 'spquiet', 'spfollowed', 'spmuted', 'spblocked', 'spaway', 'spme')), 0,
  'me: never somebody who shares nothing, who turned suggestions off, whom I follow or muted, who blocked me, who is away - or myself');
select is((select count(*)::int from suggested_people(1) where username like 'sp%'), 1, 'me: the limit holds');
-- A match that is only in a draft is no match: drafts are nobody's to see.
select pg_temp.act_as('5e000000-0000-4000-8000-000000000005');
select is((select count(*)::int from suggested_people(30) where username = 'spmatch'), 0, 'stranger: a tag shared only through a draft suggests nobody');
select is((select count(*)::int from suggested_people(30) where username in ('spstylist', 'spwinner')), 2, 'stranger: the stylist and the winner are suggested to everyone');
select pg_temp.anon();
select throws_ok($$ select * from suggested_people(5) $$, '42501', null, 'signed out: refused');
select pg_temp.back();

-- 2. The badge leaves out the kinds muted in the app; the row is the person's to write.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('5e000000-0000-4000-8000-000000000001', 'follow', '5e000000-0000-4000-8000-000000000002', 'profile', '5e000000-0000-4000-8000-000000000002'),
  ('5e000000-0000-4000-8000-000000000001', 'like', '5e000000-0000-4000-8000-000000000003', 'set', '5e000000-0000-4000-8000-000000000201');
select pg_temp.act_as('5e000000-0000-4000-8000-000000000001');
select is(unread_notifications(), 2::bigint, 'me: two unread before anything is muted');
select lives_ok($$ insert into push_settings (user_id, muted_in_app) values ('5e000000-0000-4000-8000-000000000001', '{like}') $$, 'me: writes my own settings row with a kind muted in the app');
select is(unread_notifications(), 1::bigint, 'me: the muted kind no longer counts');
select is((select marketing_email from push_settings where user_id = '5e000000-0000-4000-8000-000000000001'), false, 'me: marketing is off until I say otherwise');
select lives_ok($$ update push_settings set muted_in_app = '{}', marketing_email = true where user_id = '5e000000-0000-4000-8000-000000000001' $$, 'me: and both can be changed');
select is(unread_notifications(), 2::bigint, 'me: unmuted, both count again');
select throws_ok($$ insert into push_settings (user_id, muted_in_app) values ('5e000000-0000-4000-8000-000000000002', '{like}') $$, '42501', null, 'me: cannot write somebody else''s row');
select pg_temp.back();

-- 3. The contact form's sixth topic.
select lives_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-SPTEST01', 'recovery', 'sp', 'sp@example.com', 'I cannot sign in') $$, 'server: the recovery topic is accepted');
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-SPTEST02', 'ransom', 'sp', 'sp@example.com', 'x') $$, '23514', null, 'server: an unknown topic is still refused');

select * from finish();
rollback;
