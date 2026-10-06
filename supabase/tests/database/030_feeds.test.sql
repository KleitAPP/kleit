-- Tests for the feeds (migration 036; roadmap M6.2 "Done when": the following feed and the
-- featured feed fill correctly and exclude blocked and muted people).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

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
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('fe000000-0000-4000-8000-000000000001', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend public', 'published', 'public', 'feedfriendpub001', now() - interval '3 hours'),
  ('fe000000-0000-4000-8000-000000000002', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend followers-only', 'published', 'followers', 'feedfriendfol002', now() - interval '2 hours'),
  ('fe000000-0000-4000-8000-000000000003', 'fdfdfdfd-0000-4000-8000-000000000002', 'friend draft', 'draft', 'public', 'feedfrienddft003', null),
  ('fe000000-0000-4000-8000-000000000004', 'fdfdfdfd-0000-4000-8000-000000000003', 'noisy public', 'published', 'public', 'feednoisypub0004', now() - interval '1 hour'),
  ('fe000000-0000-4000-8000-000000000005', 'fdfdfdfd-0000-4000-8000-000000000004', 'enemy public', 'published', 'public', 'feedenemypub0005', now() - interval '1 hour'),
  ('fe000000-0000-4000-8000-000000000006', 'fdfdfdfd-0000-4000-8000-000000000005', 'star public', 'published', 'public', 'feedstarpub00006', now() - interval '5 days'),
  ('fe000000-0000-4000-8000-000000000007', 'fdfdfdfd-0000-4000-8000-0000000000001', 'viewer own', 'published', 'public', 'feedviewerown007', now());
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
select is((select count(*)::int from feed_featured()), 2, 'featured: the star''s and the friend''s public sets only');
select ok(not exists (select 1 from feed_featured() where owner_id = 'fdfdfdfd-0000-4000-8000-000000000003'), 'featured: muted left out');
select ok(not exists (select 1 from feed_featured() where owner_id = 'fdfdfdfd-0000-4000-8000-000000000004'), 'featured: nothing across a block');
select ok(not exists (select 1 from feed_featured() where visibility <> 'public' or owner_id = 'fdfdfdfd-0000-4000-8000-000000000001'), 'featured: only public sets, never your own');
select is((select id from feed_featured() limit 1), 'fe000000-0000-4000-8000-000000000006'::uuid, 'featured: this week''s most-loved set ranks first');

-- Nobody picks their own set.
select throws_ok($$ update sets set featured_at = now() where id = 'fe000000-0000-4000-8000-000000000007' $$, 'P0001', null, 'viewer: cannot stamp featured_at on their own set');

select * from finish();
rollback;
