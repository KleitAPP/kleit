-- Tests for the feeds (migration 036; roadmap M6.2 "Done when": the following feed and the
-- featured feed fill correctly and exclude blocked and muted people).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

-- viewer follows "friend" and "noisy" (muted); "enemy" has blocked the viewer; "star" is a stranger.
insert into auth.users (id, email) values
  ('fdfdfdfd-0000-4000-8000-000000000001', 'viewer@test.kleit'),
  ('fdfdfdfd-0000-4000-8000-000000000002', 'friend@test.kleit'),
  ('fdfdfdfd-0000-4000-8000-000000000003', 'noisy@test.kleit'),
  ('fdfdfdfd-0000-4000-8000-000000000004', 'enemy@test.kleit'),
  ('fdfdfdfd-0000-4000-8000-000000000005', 'star@test.kleit'),
  ('fdfdfdfd-0000-4000-8000-000000000006', 'fan@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('fdfdfdfd-0000-4000-8000-000000000001', 'viewer', now(), 't'),
  ('fdfdfdfd-0000-4000-8000-000000000002', 'friend', now(), 't'),
  ('fdfdfdfd-0000-4000-8000-000000000003', 'noisy', now(), 't'),
  ('fdfdfdfd-0000-4000-8000-000000000004', 'enemy', now(), 't'),
  ('fdfdfdfd-0000-4000-8000-000000000005', 'star', now(), 't'),
  ('fdfdfdfd-0000-4000-8000-000000000006', 'fan', now(), 't');
insert into follows (follower_id, followee_id) values
  ('fdfdfdfd-0000-4000-8000-000000000001', 'fdfdfdfd-0000-4000-8000-000000000002'),
  ('fdfdfdfd-0000-4000-8000-000000000001', 'fdfdfdfd-0000-4000-8000-000000000003');
insert into mutes (muter_id, muted_id) values ('fdfdfdfd-0000-4000-8000-000000000001', 'fdfdfdfd-0000-4000-8000-000000000003');
insert into blocks (blocker_id, blocked_id) values ('fdfdfdfd-0000-4000-8000-000000000004', 'fdfdfdfd-0000-4000-8000-000000000001');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, preview_image_id) values
  ('fe000000-0000-4000-8000-000000000001', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend public', 'published', 'public', 'feedfriendpub001', now() - interval '3 hours', 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000002', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend followers-only', 'published', 'followers', 'feedfriendfol002', now() - interval '2 hours', 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000003', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend draft', 'draft', 'public', 'feedfrienddft003', null, 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000004', 'fdfdfdfd-0000-4000-8000-000000000003', 'noisy public', 'published', 'public', 'feednoisypub0004', now() - interval '1 hour', 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000005', 'fdfdfdfd-0000-4000-8000-000000000004', 'enemy public', 'published', 'public', 'feedenemypub0005', now() - interval '1 hour', 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000006', 'fdfdfdfd-0000-4000-8000-000000000005', 'star public', 'published', 'public', 'feedstarpub00006', now() - interval '5 days', 'p.jpg'),
  ('fe000000-0000-4000-8000-000000000007', 'fdfdfdfd-0000-4000-8000-000000000001', 'viewer own', 'published', 'public', 'feedviewerown007', now(), 'p.jpg');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('fe000000-0000-4000-8000-000000000008', 'fdfdfdfd-0000-4000-8000-000000000005', 'star no picture yet', 'published', 'public', 'feedstarnopic008', now());
-- The star's set is loved this week; the friend's older one is not.
insert into likes (user_id, set_id) values ('fdfdfdfd-0000-4000-8000-000000000006', 'fe000000-0000-4000-8000-000000000006');
insert into reactions (user_id, set_id, emoji) values ('fdfdfdfd-0000-4000-8000-000000000006', 'fe000000-0000-4000-8000-000000000006', '🔥');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select pg_temp.act_as('fdfdfdfd-0000-4000-8000-000000000001');

-- Following feed.
select is((select count(*)::int from feed_following()), 2, 'following: exactly the friend''s two visible sets');
select ok(exists (select 1 from feed_following() where id = 'fe000000-0000-4000-8000-000000000002'), 'following: a followers-only set shows to a follower');
select ok(not exists (select 1 from feed_following() where id = 'fe000000-0000-4000-8000-000000000003'), 'following: never a draft');
select ok(not exists (select 1 from feed_following() where owner_id = 'fdfdfdfd-0000-4000-8000-000000000003'), 'following: a muted person is left out, though followed');
select ok(not exists (select 1 from feed_following() where owner_id = 'fdfdfdfd-0000-4000-8000-000000000005'), 'following: a stranger is not in it');
select is((select id from feed_following() limit 1), 'fe000000-0000-4000-8000-000000000002'::uuid, 'following: newest first');
select is((select count(*)::int from feed_following(p_before => now() - interval '150 minutes')), 1, 'following: paging by time works');

-- Featured feed.
-- The live project has other people's public sets too, so every count here is scoped to this test's own people.
select is((select count(*)::int from feed_featured(0, 50) where owner_id::text like 'fdfdfdfd-%'), 2, 'featured: the star''s and the friend''s public sets only');
select ok(not exists (select 1 from feed_featured(0, 50) where owner_id = 'fdfdfdfd-0000-4000-8000-000000000003'), 'featured: muted left out');
select ok(not exists (select 1 from feed_featured(0, 50) where owner_id = 'fdfdfdfd-0000-4000-8000-000000000004'), 'featured: nothing across a block');
select ok(not exists (select 1 from feed_featured(0, 50) where visibility <> 'public' or owner_id = 'fdfdfdfd-0000-4000-8000-000000000001'), 'featured: only public sets, never your own');
select is((select id from (select id, row_number() over () as n from feed_featured(0, 50)) f where id::text like 'fe000000-%' order by n limit 1), 'fe000000-0000-4000-8000-000000000006'::uuid, 'featured: this week''s most-loved set ranks above the unloved one');

select ok(not exists (select 1 from feed_featured(0, 50) where id = 'fe000000-0000-4000-8000-000000000008'), 'featured: a set with no picture yet is not featured');

-- The counts for a page of cards (042): the star's set has one like, not the viewer's; a set the
-- viewer cannot open (the enemy's) counts nothing.
select is((select likes from set_social_many(array['fe000000-0000-4000-8000-000000000006'::uuid, 'fe000000-0000-4000-8000-000000000005'::uuid]) where set_id = 'fe000000-0000-4000-8000-000000000006'), 1::bigint, 'viewer: the star''s set shows one like, and it is not mine');
select is((select count(*)::int from set_social_many(array['fe000000-0000-4000-8000-000000000005'::uuid])), 0, 'viewer: a set across a block has no row at all');

-- Nobody picks their own set.
select throws_ok($$ update sets set featured_at = now() where id = 'fe000000-0000-4000-8000-000000000007' $$, 'P0001', null, 'viewer: cannot stamp featured_at on their own set');

select * from finish();
rollback;
