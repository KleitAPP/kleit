-- Tests for migration 017 — the visibility grid, walked cell by cell (roadmap M3.1 "Done when").
-- Six kinds of set (public, link, followers, friends, only_me, and a draft) × five viewers
-- (signed out, stranger, follower, friend, owner), then the blocked row, then the things that
-- hang off a set: pieces follow the parent, the public count never leaks, the link can be reset,
-- and versions are the server's.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(63);

-- Five people.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@test.kleit'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'stranger@test.kleit'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'follower@test.kleit'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'friend@test.kleit'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'blocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'gridowner', now(), 't'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'gridstranger', now(), 't'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'gridfollower', now(), 't'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'gridfriend', now(), 't'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'gridblocked', now(), 't');

-- Relationships: the follower follows the owner; the friend and the owner follow each other;
-- the owner has blocked "blocked" (who, for good measure, follows the owner).
insert into follows (follower_id, followee_id) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into blocks (blocker_id, blocked_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005');

-- Six sets, one per row of the grid.
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('55555555-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'public',    'published', 'public',    'codepublic000001'),
  ('55555555-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'link',      'published', 'link',      'codelink00000002'),
  ('55555555-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'followers', 'published', 'followers', 'codefollow000003'),
  ('55555555-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'friends',   'published', 'friends',   'codefriend000004'),
  ('55555555-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'only_me',   'published', 'only_me',   'codeonlyme000005'),
  ('55555555-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'draft',     'draft',     'public',    'codedraft0000006');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.sees(set_title text) returns boolean language sql as $$
  select exists (select 1 from sets where title = set_title);
$$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Signed out: the function with no viewer. Only public, and only through the code path for link.
-- ---------------------------------------------------------------------------
select ok(can_view_set('55555555-0000-4000-8000-000000000001', null), 'signed out · public: yes');
select ok(not can_view_set('55555555-0000-4000-8000-000000000002', null), 'signed out · link, no code: no');
select ok(can_view_set('55555555-0000-4000-8000-000000000002', null, 'codelink00000002'), 'signed out · link WITH the code: yes');
select ok(not can_view_set('55555555-0000-4000-8000-000000000002', null, 'wrongcode0000000'), 'signed out · link with the wrong code: no');
select ok(not can_view_set('55555555-0000-4000-8000-000000000003', null), 'signed out · followers: no');
select ok(not can_view_set('55555555-0000-4000-8000-000000000004', null), 'signed out · friends: no');
select ok(not can_view_set('55555555-0000-4000-8000-000000000005', null), 'signed out · only_me: no');
select ok(not can_view_set('55555555-0000-4000-8000-000000000006', null), 'signed out · draft: no, even though it is public');

-- ---------------------------------------------------------------------------
-- Stranger.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select ok(pg_temp.sees('public'), 'stranger · public: yes');
select ok(not pg_temp.sees('link'), 'stranger · link, no code: no');
select ok(can_view_set('55555555-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'codelink00000002'), 'stranger · link with the code: yes');
select ok(not pg_temp.sees('followers'), 'stranger · followers: no');
select ok(not pg_temp.sees('friends'), 'stranger · friends: no');
select ok(not pg_temp.sees('only_me'), 'stranger · only_me: no');
select ok(not pg_temp.sees('draft'), 'stranger · draft: no');
select is((select count(*) from set_by_share_code('codelink00000002')), 1::bigint, 'stranger · set_by_share_code opens a link set');
select is((select count(*) from set_by_share_code('codeonlyme000005')), 0::bigint, 'stranger · set_by_share_code never opens an only_me set, code or not');
select is((select count(*) from set_by_share_code('codedraft0000006')), 0::bigint, 'stranger · set_by_share_code never opens a draft');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Follower.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000003');
select ok(pg_temp.sees('public'), 'follower · public: yes');
select ok(not pg_temp.sees('link'), 'follower · link, no code: no');
select ok(pg_temp.sees('followers'), 'follower · followers: yes');
select ok(not pg_temp.sees('friends'), 'follower · friends: no (the owner does not follow back)');
select ok(not pg_temp.sees('only_me'), 'follower · only_me: no');
select ok(not pg_temp.sees('draft'), 'follower · draft: no');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Friend (mutual).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000004');
select ok(pg_temp.sees('public'), 'friend · public: yes');
select ok(not pg_temp.sees('link'), 'friend · link, no code: no');
select ok(pg_temp.sees('followers'), 'friend · followers: yes');
select ok(pg_temp.sees('friends'), 'friend · friends: yes');
select ok(not pg_temp.sees('only_me'), 'friend · only_me: no');
select ok(not pg_temp.sees('draft'), 'friend · draft: no');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Owner.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');
select ok(pg_temp.sees('public') and pg_temp.sees('link') and pg_temp.sees('followers') and pg_temp.sees('friends') and pg_temp.sees('only_me') and pg_temp.sees('draft'),
  'owner · all six: yes');
-- Counted among this file's own sets: the live database has real public sets too, and a real
-- public set is visible to everyone here by design.
select is((select count(*) from sets where id::text like '55555555-%'), 6::bigint, 'owner · sees exactly their six and nothing else');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Blocked, either way. This person follows the owner, and is blocked by them.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000005');
select ok(not pg_temp.sees('public'), 'blocked · public: no');
select ok(not pg_temp.sees('followers'), 'blocked · followers: no, although they follow');
select ok(not can_view_set('55555555-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000005', 'codelink00000002'), 'blocked · link, even with the code: no');
select is((select count(*) from set_by_share_code('codepublic000001')), 0::bigint, 'blocked · set_by_share_code: nothing');
select is((select count(*) from blocks), 0::bigint, 'blocked · cannot see that they are blocked');
select pg_temp.back();
-- And the other direction: if the stranger blocks the owner, the owner's public set is gone for them.
insert into blocks (blocker_id, blocked_id) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select ok(not pg_temp.sees('public'), 'a person who blocks the owner no longer sees the owner''s public set');
select pg_temp.back();
delete from blocks where blocker_id = 'aaaaaaaa-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Pieces follow the parent set (row 14), and the public count never leaks (G2).
-- ---------------------------------------------------------------------------
insert into items (id, owner_id, kind, title, image_bucket, image_id) values
  ('66666666-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'product', 'a cleared product', 'item-images', 'p.jpg');
insert into item_flags (item_id, scan_state, scanned_at) values ('66666666-0000-4000-8000-000000000001', 'clean', now());
insert into set_items (set_id, item_id) values
  ('55555555-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001'),
  ('55555555-0000-4000-8000-000000000005', '66666666-0000-4000-8000-000000000001'),
  ('55555555-0000-4000-8000-000000000006', '66666666-0000-4000-8000-000000000001');

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select is((select count(*) from set_items where set_id::text like '55555555-%'), 1::bigint, 'stranger · sees the piece on the public set only');
select is((select set_count from public_item_stats where item_id = '66666666-0000-4000-8000-000000000001'), 1,
  'public_item_stats counts the public set and NOT the only_me or draft ones');
select throws_ok($$ insert into set_items (set_id, item_id) values ('55555555-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001') $$,
  '42501', null, 'stranger · cannot put a piece on somebody else''s set');
select pg_temp.back();

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');
select is((select count(*) from set_items where set_id::text like '55555555-%'), 3::bigint, 'owner · sees all three placements');
select pg_temp.back();

-- A shareable own piece is visible to the set's viewers; a non-shareable one is not (row 7).
insert into items (id, owner_id, kind, title, image_bucket, image_id) values
  ('66666666-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'own', 'my shareable jumper', 'closet-photos', 'j.jpg'),
  ('66666666-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'own', 'my private jumper', 'closet-photos', 'k.jpg');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('66666666-0000-4000-8000-000000000002', 'clean', now()), ('66666666-0000-4000-8000-000000000003', 'clean', now());
insert into closet_items (user_id, item_id, shareable) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000002', true),
  ('aaaaaaaa-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000003', false);
insert into set_items (set_id, item_id) values
  ('55555555-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000002'),
  ('55555555-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000003');
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select ok(exists (select 1 from items where title = 'my shareable jumper'), 'stranger · sees a shareable own piece on a public set');
select ok(not exists (select 1 from items where title = 'my private jumper'), 'stranger · does NOT see a non-shareable own piece, even on a public set');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Reset share link: the old link dies (S49).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');
select isnt((select reset_share_code('55555555-0000-4000-8000-000000000002')), 'codelink00000002', 'owner · reset gives a new code');
select is((select count(*) from set_by_share_code('codelink00000002')), 0::bigint, 'the old link no longer opens anything');
select throws_ok($$ update sets set share_code = 'mine' where id = '55555555-0000-4000-8000-000000000002' $$,
  'P0001', null, 'owner · cannot pick their own share code by hand');
select throws_ok($$ update sets set owner_id = 'aaaaaaaa-0000-4000-8000-000000000002' where id = '55555555-0000-4000-8000-000000000002' $$,
  'P0001', null, 'owner · cannot hand a set to somebody else');
select pg_temp.back();
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ select reset_share_code('55555555-0000-4000-8000-000000000001') $$, '42501', null,
  'stranger · cannot reset somebody else''s link');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Publishing stamps the time once; versions are the server's; autosave trims to 20.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');
update sets set status = 'published' where id = '55555555-0000-4000-8000-000000000006';
select isnt((select published_at from sets where id = '55555555-0000-4000-8000-000000000006'), null, 'publishing stamps published_at');
select throws_ok($$ insert into set_versions (set_id, layout) values ('55555555-0000-4000-8000-000000000001', '{}') $$,
  '42501', null, 'owner · cannot write a version by hand');
select is((select save_set_layout('55555555-0000-4000-8000-000000000001', '{"v":1}')), 2, 'save_set_layout bumps the layout version');
do $$ begin for i in 2..25 loop perform save_set_layout('55555555-0000-4000-8000-000000000001', json_build_object('v', i)::jsonb); end loop; end $$;
select is((select count(*) from set_versions where set_id = '55555555-0000-4000-8000-000000000001'), 20::bigint, 'autosave keeps the last 20 versions');
select is((select layout from sets where id = '55555555-0000-4000-8000-000000000001'), '{"v": 25}'::jsonb, 'and the set holds the latest');
select pg_temp.back();
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ select save_set_layout('55555555-0000-4000-8000-000000000001', '{"stolen":true}') $$, '42501', null,
  'stranger · cannot save onto somebody else''s set');
select is((select count(*) from set_versions), 0::bigint, 'stranger · sees no versions of anything');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Follows: no following a private account (requests come at M5), no following through a block.
-- ---------------------------------------------------------------------------
update profiles set is_private = true where user_id = 'aaaaaaaa-0000-4000-8000-000000000004';
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select throws_ok($$ insert into follows (follower_id, followee_id) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004') $$,
  '42501', null, 'stranger · cannot follow a private account outright');
select lives_ok($$ insert into follows (follower_id, followee_id) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  'stranger · can follow an ordinary account');
select pg_temp.back();
insert into blocks (blocker_id, blocked_id) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000005');
select throws_ok($$ insert into follows (follower_id, followee_id) values ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '42501', null, 'a blocked person cannot follow the one who blocked them');
select pg_temp.back();

-- A person makes a set and gets its id back in the same statement (migration 020). This is how
-- the app inserts (PostgREST's return=representation), and it is what the live site broke on.
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select lives_ok($$ insert into sets (owner_id, status) values ('aaaaaaaa-0000-4000-8000-000000000002', 'draft') returning id $$,
  'stranger · can make a draft of their own and read its id back at once');
select lives_ok($$ insert into collections (owner_id, name) values ('aaaaaaaa-0000-4000-8000-000000000002', 'mine') returning id $$,
  'stranger · can make a collection of their own and read its id back at once');
select pg_temp.back();

-- Templates: ours are readable by anyone signed in.
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');
select is((select count(*) from templates where owner_id is null), 4::bigint, 'the four shipped templates are readable');
select pg_temp.back();

-- Every new table has RLS on.
select is((select count(*) from pg_tables t where t.schemaname = 'public'
            and t.tablename in ('sets','set_items','set_versions','collections','collection_entries','templates','follows','blocks')
            and not t.rowsecurity), 0::bigint, 'all eight new tables have RLS on');

select * from finish();
rollback;
