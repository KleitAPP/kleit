-- Tests for migration 095 (the third review's seven fixes): a profile is made through
-- claim_profile only; an entry arrives unpicked; a store piece and its facts are the server's;
-- published_at is the server's stamp; tags and mentions tell people who can see the set, once;
-- a push is unstuck from its claim; the song link's shape, a pick's set, and truncate.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(43);

insert into auth.users (id, email) values
  ('f0f0f0f0-0000-4000-8000-000000000001', 'rf-owner@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000002', 'rf-friend@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000003', 'rf-stranger@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000004', 'rf-banned@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000005', 'rf-admin@test.kleit'),
  ('f0f0f0f0-0000-4000-8000-000000000006', 'rf-new@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, mention_setting) values
  ('f0f0f0f0-0000-4000-8000-000000000001', 'rfowner', now(), 't', 'everyone'),
  ('f0f0f0f0-0000-4000-8000-000000000002', 'rffriend', now(), 't', 'everyone'),
  ('f0f0f0f0-0000-4000-8000-000000000003', 'rfstranger', now(), 't', 'everyone'),
  ('f0f0f0f0-0000-4000-8000-000000000004', 'rfbanned', now(), 't', 'everyone'),
  ('f0f0f0f0-0000-4000-8000-000000000005', 'rfadmin', now(), 't', 'everyone');
insert into user_roles (user_id, role) values ('f0f0f0f0-0000-4000-8000-000000000005', 'admin');
-- The friend and the (soon) banned account follow the owner.
insert into follows (follower_id, followee_id) values
  ('f0f0f0f0-0000-4000-8000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001'),
  ('f0f0f0f0-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001');
select set_config('kleit.server_write', '1', true);
update profiles set banned_at = now() where user_id = 'f0f0f0f0-0000-4000-8000-000000000004';
select set_config('kleit.server_write', '', true);
-- A closed challenge with an entry whose set has since gone private (for the pick rule), and an
-- open one of our own (for the entry rule). The live week's own contest is left alone.
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('f0000000-0000-4000-8000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'rf went private', 'published', 'only_me', 'rfwentprivate001', now() - interval '2 days'),
  ('f0000000-0000-4000-8000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001', 'rf public', 'published', 'public', 'rfpublic00000001', now() - interval '1 day');
insert into contests (id, title, opens_at, closes_at) values
  ('f0000000-0000-4000-8000-000000000011', 'RF closed (ignore)', now() - interval '5 days', now() - interval '1 day'),
  ('f0000000-0000-4000-8000-000000000012', 'RF open (ignore)', now() - interval '1 hour', now() + interval '1 hour');
insert into contest_entries (contest_id, user_id, set_id) values
  ('f0000000-0000-4000-8000-000000000011', 'f0f0f0f0-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001');
-- The pushes: one made an hour ago (quiet hours held it), due now.
insert into push_queue (id, user_id, kind, ref_type, ref_id, due_at, created_at) overriding system value values
  (-95001, 'f0f0f0f0-0000-4000-8000-000000000001', 'comment', 'set', 'f0000000-0000-4000-8000-000000000002', now() - interval '1 minute', now() - interval '1 hour');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table rf_ids (name text primary key, id uuid);
grant all on rf_ids to authenticated;

-- 1. A profile is made through claim_profile only.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000006');
select throws_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version) values ('f0f0f0f0-0000-4000-8000-000000000006', 'rfnew', now(), 't') $$, '42501', null, 'new account: cannot write its own profile row by hand');
select lives_ok($$ select claim_profile('rfnew', 'New', 't') $$, 'new account: claim_profile still opens the door');
select is((select username from profiles where user_id = 'f0f0f0f0-0000-4000-8000-000000000006'), 'rfnew', 'and the profile is there');
select pg_temp.back();
select is(current_setting('kleit.server_write', true), '', 'the server door is shut again afterwards');

-- 2. An entry arrives unpicked.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$ insert into contest_entries (contest_id, user_id, set_id, picked_at) values ('f0000000-0000-4000-8000-000000000012', 'f0f0f0f0-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', now()) $$, '42501', null, 'owner: cannot enter already picked');
select lives_ok($$ insert into contest_entries (contest_id, user_id, set_id) values ('f0000000-0000-4000-8000-000000000012', 'f0f0f0f0-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002') $$, 'owner: enters');
select is((select picked_at from contest_entries where contest_id = 'f0000000-0000-4000-8000-000000000012' and user_id = 'f0f0f0f0-0000-4000-8000-000000000001'), null, 'and the entry is unpicked');

-- 3. Pieces: by hand, your own only; the facts of a store piece are the server's.
select throws_ok($$ insert into items (owner_id, kind, title, source_url, source_domain) values ('f0f0f0f0-0000-4000-8000-000000000001', 'product', 'fake', 'https://evil.example/go', 'evil.example') $$, '42501', null, 'owner: cannot write a store piece by hand');
select throws_ok($$ insert into items (owner_id, kind, title, source_url) values ('f0f0f0f0-0000-4000-8000-000000000001', 'own', 'mine', 'https://evil.example/go') $$, '42501', null, 'owner: nor a piece of their own pointing somewhere');
select throws_ok($$ insert into items (owner_id, kind, title, price_cents, price_currency) values ('f0f0f0f0-0000-4000-8000-000000000001', 'own', 'mine', 1000, 'USD') $$, '42501', null, 'owner: nor one with a price');
select throws_ok($$ insert into items (owner_id, kind, title, store_name) values ('f0f0f0f0-0000-4000-8000-000000000001', 'own', 'mine', 'A Store') $$, '42501', null, 'owner: nor one from a store');
select lives_ok($$ insert into items (id, owner_id, kind, title) values ('f0000000-0000-4000-8000-000000000021', 'f0f0f0f0-0000-4000-8000-000000000001', 'own', 'my own jumper') $$, 'owner: a plain piece of their own is fine');
select pg_temp.back();
insert into items (id, owner_id, kind, title, price_cents, price_currency, store_name, source_url, source_domain) values
  ('f0000000-0000-4000-8000-000000000022', 'f0f0f0f0-0000-4000-8000-000000000001', 'product', 'a clipped coat', 12000, 'USD', 'Shop', 'https://shop.example.com/coat', 'shop.example.com');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
select lives_ok($$ update items set title = 'my coat' where id = 'f0000000-0000-4000-8000-000000000022' $$, 'owner: can still rename their clipped piece');
select throws_ok($$ update items set price_cents = 1 where id = 'f0000000-0000-4000-8000-000000000022' $$, '42501', null, 'owner: cannot change its price');
select throws_ok($$ update items set kind = 'own' where id = 'f0000000-0000-4000-8000-000000000022' $$, '42501', null, 'owner: cannot change what kind of piece it is');
select throws_ok($$ update items set store_name = 'Elsewhere' where id = 'f0000000-0000-4000-8000-000000000022' $$, '42501', null, 'owner: cannot change the store');
select throws_ok($$ update items set sold_out = true where id = 'f0000000-0000-4000-8000-000000000022' $$, '42501', null, 'owner: cannot mark it sold out (the watch does)');

-- 4. published_at is the server's stamp.
with x as (insert into sets (owner_id, title, status, visibility, published_at) values ('f0f0f0f0-0000-4000-8000-000000000001', 'rf stamped', 'published', 'public', '2099-01-01') returning id)
insert into rf_ids (name, id) select 'pub', id from x;
select ok((select abs(extract(epoch from (now() - published_at))) < 60 from sets where id = (select id from rf_ids where name = 'pub')), 'owner: a set published on the way in is stamped now, not 2099');
with x as (insert into sets (owner_id, title, status, visibility, published_at) values ('f0f0f0f0-0000-4000-8000-000000000001', 'rf draft', 'draft', 'public', '2099-01-01') returning id)
insert into rf_ids (name, id) select 'draft', id from x;
select is((select published_at from sets where id = (select id from rf_ids where name = 'draft')), null, 'owner: a draft carries no stamp whatever was given');
select throws_ok($$ update sets set published_at = '2099-01-01' where id = (select id from rf_ids where name = 'pub') $$, '42501', null, 'owner: cannot move the stamp afterwards');
select lives_ok($$ update sets set title = 'rf stamped still' where id = (select id from rf_ids where name = 'pub') $$, 'owner: everything else on the set is theirs');
select pg_temp.back();
update app_settings set value = 'false' where key = 'posting_open';
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$ insert into sets (owner_id, title, status, visibility) values ('f0f0f0f0-0000-4000-8000-000000000001', 'rf paused', 'published', 'public') $$, 'P0004', null, 'owner: publishing on the way in follows the posting switch');
select pg_temp.back();
update app_settings set value = 'true' where key = 'posting_open';

-- 5. Tags tell once, once the person can see the set; mentions tell people who can see it.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
insert into set_tags (set_id, user_id, tagged_by) values ((select id from rf_ids where name = 'draft'), 'f0f0f0f0-0000-4000-8000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f0f0f0f0-0000-4000-8000-000000000002'), 0, 'a tag on a draft tells nobody yet');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
update sets set status = 'published' where id = (select id from rf_ids where name = 'draft');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f0f0f0f0-0000-4000-8000-000000000002'), 1, 'publishing the set tells the tagged friend');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
delete from set_tags where set_id = (select id from rf_ids where name = 'draft') and user_id = 'f0f0f0f0-0000-4000-8000-000000000002';
insert into set_tags (set_id, user_id, tagged_by) values ((select id from rf_ids where name = 'draft'), 'f0f0f0f0-0000-4000-8000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f0f0f0f0-0000-4000-8000-000000000002'), 1, 'a tag taken off and put back is not news');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
update sets set visibility = 'followers' where id = (select id from rf_ids where name = 'pub');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ((select id from rf_ids where name = 'pub'), 'f0f0f0f0-0000-4000-8000-000000000003', 'f0f0f0f0-0000-4000-8000-000000000001') $$, 'P0011', null, 'owner: cannot tag someone who cannot see the published set');
select lives_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ((select id from rf_ids where name = 'pub'), 'f0f0f0f0-0000-4000-8000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001') $$, 'owner: can tag the follower who can');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ((select id from rf_ids where name = 'pub'), 'f0f0f0f0-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001') $$, '42501', null, 'owner: cannot tag a banned account');
insert into comments (set_id, author_id, body) values ((select id from rf_ids where name = 'pub'), 'f0f0f0f0-0000-4000-8000-000000000001', 'for @rfstranger and @rffriend');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'f0f0f0f0-0000-4000-8000-000000000003'), 0, 'a mention on a set the person cannot see tells them nothing');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'f0f0f0f0-0000-4000-8000-000000000002'), 1, 'the follower who can see it is told');
-- Opening the set up tells the people who can now see it, once.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
update sets set visibility = 'public' where id = (select id from rf_ids where name = 'pub');
update sets set visibility = 'public' where id = (select id from rf_ids where name = 'pub');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f0f0f0f0-0000-4000-8000-000000000002' and ref_id = (select id from rf_ids where name = 'pub')), 1, 'opening a set up tells a tagged person once');

-- 6. A push is unstuck ten minutes after its claim, not after it was made.
create temp table rf_batch as select * from claim_pushes(500);
select is((select state from push_queue where id = -95001), 'claimed', 'server: the hour-old push is claimed');
select isnt((select claimed_at from push_queue where id = -95001), null, 'and the claim is timed');
select private.unstick_pushes();
select is((select state from push_queue where id = -95001), 'claimed', 'a fresh claim on an old row is left alone');
update push_queue set claimed_at = now() - interval '11 minutes' where id = -95001;
select private.unstick_pushes();
select is((select state from push_queue where id = -95001), 'pending', 'a claim gone quiet for ten minutes goes back to pending');
update push_queue set state = 'claimed', attempts = 3, claimed_at = now() - interval '11 minutes' where id = -95001;
select private.unstick_pushes();
select is((select state from push_queue where id = -95001), 'failed', 'three dead claims mark it failed');

-- 7. The song link's shape, a pick's set, and truncate.
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$ update sets set song_url = 'https://www.youtube.com/redirect?q=https://evil.example', song_title = 'x' where id = (select id from rf_ids where name = 'pub') $$, '23514', null, 'owner: a YouTube redirect is not a song link');
select throws_ok($$ update sets set song_url = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=evil', song_title = 'x' where id = (select id from rf_ids where name = 'pub') $$, '23514', null, 'owner: a song link carries no query');
select lives_ok($$ update sets set song_url = 'https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC', song_title = 'Blinding Lights' where id = (select id from rf_ids where name = 'pub') $$, 'owner: a Spotify track is a song link');
select lives_ok($$ update sets set song_url = 'https://music.apple.com/us/album/after-hours/1499378108?i=1499378615' where id = (select id from rf_ids where name = 'pub') $$, 'owner: an Apple Music song is a song link');
select lives_ok($$ update sets set song_url = 'https://music.youtube.com/watch?v=dQw4w9WgXcQ' where id = (select id from rf_ids where name = 'pub') $$, 'owner: a YouTube Music watch link is a song link');
select pg_temp.act_as('f0f0f0f0-0000-4000-8000-000000000005');
select throws_ok($$ select pick_contest_entry('f0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000001', true) $$, 'P0002', null, 'admin: cannot pick an entry whose set went private');
select pg_temp.back();
select is((select count(*)::int from pg_tables t where t.schemaname = 'public'
             and (has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE')
                  or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE'))),
  0, 'no table lets a member truncate it');

select * from finish();
rollback;
