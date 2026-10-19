-- Tests for migration 118: a moderator's sitting ends at two hours and reopens after a
-- fifteen-minute gap; a pulled decoration is listed, fingerprinted, logged and gone from the
-- share page's read; a store's subdomain finds the store's network.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

insert into auth.users (id, email) values
  ('d5000000-0000-4000-8000-000000000001', 'rl-mod@test.kleit'),
  ('d5000000-0000-4000-8000-000000000002', 'rl-reporter@test.kleit'),
  ('d5000000-0000-4000-8000-000000000003', 'rl-admin@test.kleit'),
  ('d5000000-0000-4000-8000-000000000004', 'rl-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d5000000-0000-4000-8000-000000000001', 'rlmod', now(), 't'),
  ('d5000000-0000-4000-8000-000000000002', 'rlreporter', now(), 't'),
  ('d5000000-0000-4000-8000-000000000003', 'rladmin', now(), 't'),
  ('d5000000-0000-4000-8000-000000000004', 'rlowner', now(), 't');
insert into user_roles (user_id, role) values
  ('d5000000-0000-4000-8000-000000000001', 'moderator'),
  ('d5000000-0000-4000-8000-000000000003', 'admin');

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

-- Three reports to decide, from a second account.
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('d5000000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000004', 'rl set one', 'published', 'public', 'rlset00000000001', now()),
  ('d5000000-0000-4000-8000-000000000012', 'd5000000-0000-4000-8000-000000000004', 'rl set two', 'published', 'public', 'rlset00000000002', now()),
  ('d5000000-0000-4000-8000-000000000013', 'd5000000-0000-4000-8000-000000000004', 'rl set three', 'published', 'public', 'rlset00000000003', now());
select pg_temp.act_as('d5000000-0000-4000-8000-000000000002');
select lives_ok($$ select file_report('set', 'd5000000-0000-4000-8000-000000000011', 'spam', 'one') $$, 'reporter: reports set one');
select lives_ok($$ select file_report('set', 'd5000000-0000-4000-8000-000000000012', 'spam', 'two') $$, 'reporter: reports set two');
select lives_ok($$ select file_report('set', 'd5000000-0000-4000-8000-000000000013', 'spam', 'three') $$, 'reporter: reports set three');

-- 1. Fresh, the moderator is in no sitting; one decision starts one.
select pg_temp.act_as('d5000000-0000-4000-8000-000000000001');
select is((select count(*) from review_sitting()), 0::bigint, 'moderator: no sitting before the first decision');
select lives_ok($$ select moderate((select r.id from reports r where r.target_id = 'd5000000-0000-4000-8000-000000000011' and r.state = 'open'), 'dismiss', 'rl') $$, 'moderator: the first decision of the day');
select is((select decisions from review_sitting()), 1::bigint, 'moderator: and is in a sitting of one');
select is((select break_until from review_sitting()), null, 'moderator: with no break due');

-- 2. Two hours of decisions, five minutes apart (the server's rows, as a record of the sitting):
--    the chain starts two hours ago, so the next decision is refused with the time it started.
select pg_temp.as_server();
insert into moderation_actions (moderator_id, target_type, target_id, action, note, created_at)
select 'd5000000-0000-4000-8000-000000000001', 'set', 'd5000000-0000-4000-8000-000000000011', 'dismiss', 'rl sitting', now() - (n * interval '5 minutes')
  from generate_series(1, 24) n;
select pg_temp.act_as('d5000000-0000-4000-8000-000000000001');
select is((select decisions from review_sitting()), 25::bigint, 'moderator: the sitting counts every decision in the chain');
select ok((select break_until from review_sitting()) between now() + interval '14 minutes' and now() + interval '16 minutes', 'moderator: a break is due, fifteen minutes from the last decision');
select throws_ok($$ select moderate((select r.id from reports r where r.target_id = 'd5000000-0000-4000-8000-000000000012' and r.state = 'open'), 'dismiss', 'rl') $$, 'P0009', null, 'moderator: the next decision is refused');
select pg_temp.as_server();
select is((select state from reports r where r.target_id = 'd5000000-0000-4000-8000-000000000012'), 'open', 'and the report is untouched');

-- 3. A sixteen-minute gap after the last decision breaks the chain: the queue is open again.
update moderation_actions set created_at = created_at - interval '16 minutes' where note = 'rl sitting' or note = 'rl';
select pg_temp.act_as('d5000000-0000-4000-8000-000000000001');
select is((select count(*) from review_sitting()), 0::bigint, 'moderator: after a break, no sitting');
select lives_ok($$ select moderate((select r.id from reports r where r.target_id = 'd5000000-0000-4000-8000-000000000012' and r.state = 'open'), 'dismiss', 'rl again') $$, 'moderator: and decides again');
select is((select decisions from review_sitting()), 1::bigint, 'moderator: in a new sitting of one');

-- 4. The server's own rows (no moderator) are never a sitting, nor refused.
select pg_temp.as_server();
select lives_ok($$ insert into moderation_actions (moderator_id, target_type, target_id, action, note) values (null, 'set', 'd5000000-0000-4000-8000-000000000011', 'dismiss', 'rl server') $$, 'server: writes a row of its own freely');

-- 5. A pulled decoration: admins only; listed for anyone; fingerprinted; the chat picture of a
--    set that placed it is cleared; the share page's read names it; put back, all of it goes.
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, preview_image_id, layout) values
  ('d5000000-0000-4000-8000-000000000021', 'd5000000-0000-4000-8000-000000000004', 'rl decorated', 'published', 'public', 'rlset00000000021', now(), 'd5000000-0000-4000-8000-000000000021/1.jpg',
   '{"version": 2, "mode": "creative", "canvas": {"w": 1080, "h": 1080}, "background": "#ffffff", "caption": "", "order": ["d1"], "decor": {"d1": {"id": "d1", "itemId": "", "kind": "asset", "asset": "drawn-rl-bow", "x": 0, "y": 0, "w": 100, "h": 100, "rotation": 0, "flipX": false, "flipY": false, "opacity": 1, "hidden": false, "locked": false, "crop": null}}}'),
  ('d5000000-0000-4000-8000-000000000022', 'd5000000-0000-4000-8000-000000000004', 'rl plain', 'published', 'public', 'rlset00000000022', now(), 'd5000000-0000-4000-8000-000000000022/1.jpg',
   '{"version": 2, "mode": "creative", "canvas": {"w": 1080, "h": 1080}, "background": "#ffffff", "caption": "", "order": [], "decor": {}}');
select pg_temp.act_as('d5000000-0000-4000-8000-000000000001');
select throws_ok($$ select pull_library_asset('drawn-rl-bow', '{0123456789abcdef}', 'a claim') $$, '42501', null, 'moderator: cannot pull a decoration');
select pg_temp.act_as('d5000000-0000-4000-8000-000000000003');
select throws_ok($$ select pull_library_asset('drawn-rl-bow', '{0123456789abcdef}', '  ') $$, '22023', null, 'admin: a reason is required');
select is((select pull_library_asset('drawn-rl-bow', '{0123456789abcdef,fedcba9876543210,nothex}', 'a claim on the drawing')), 1, 'admin: pulls it; one set had placed it');
select pg_temp.as_server();
select is((select preview_image_id from sets where id = 'd5000000-0000-4000-8000-000000000021'), null, 'that set''s chat picture is cleared');
select is((select preview_image_id from sets where id = 'd5000000-0000-4000-8000-000000000022'), 'd5000000-0000-4000-8000-000000000022/1.jpg', 'a set without it keeps its picture');
select is((select count(*) from removed_image_fingerprints where reason = 'library:drawn-rl-bow'), 2::bigint, 'the two well-formed fingerprints are listed; the malformed one is not');
select is((select count(*) from admin_audit_log where what = 'library' and reason like 'pulled drawn-rl-bow%'), 1::bigint, 'the pull is logged');
select is((select shared_set('rlset00000000021') -> 'pulled'), '["drawn-rl-bow"]'::jsonb, 'the share page''s read names the pulled id');
select pg_temp.act_as('d5000000-0000-4000-8000-000000000002');
select is((select pulled_library_assets()), '{drawn-rl-bow}'::text[], 'anyone: reads the list the drawer skips');
select pg_temp.act_as('d5000000-0000-4000-8000-000000000003');
select lives_ok($$ select restore_library_asset('drawn-rl-bow') $$, 'admin: puts it back');
select throws_ok($$ select restore_library_asset('drawn-rl-bow') $$, 'P0002', null, 'admin: not twice');
select pg_temp.as_server();
select is((select count(*) from removed_image_fingerprints where reason = 'library:drawn-rl-bow'), 0::bigint, 'and its fingerprints are forgotten');

-- 6. A store's subdomain finds the store's network; a look-alike domain does not.
insert into affiliate_networks (domain, network, link_template) values ('wombat.example', 'skimlinks', 'https://go.skimresources.com/?id=1&url={url}');
select is((select network from affiliate_for('shop.wombat.example')), 'skimlinks', 'server: shop.wombat.example finds wombat.example');
select is((select count(*) from affiliate_for('notwombat.example')), 0::bigint, 'server: notwombat.example does not');

select * from finish();
rollback;
