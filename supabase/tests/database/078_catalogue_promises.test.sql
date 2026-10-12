-- Tests for migration 102: a colour is one of sixteen words and the store search can ask for
-- one; the price watch records "sold out" and "back"; the soft caps on sets and closet pieces
-- refuse the one past the cap (and never the server); a clipper earns a point when somebody
-- else's published set carries their clip, once per set and piece.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

insert into auth.users (id, email) values
  ('cb000000-0000-4000-8000-000000000001', 'cp-clipper@test.kleit'),
  ('cb000000-0000-4000-8000-000000000002', 'cp-maker@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('cb000000-0000-4000-8000-000000000001', 'cpclipper', now(), 't'),
  ('cb000000-0000-4000-8000-000000000002', 'cpmaker', now(), 't');
-- The clipper's two cleared store pieces and the maker's own cleared clip.
insert into items (id, owner_id, kind, title, store_name, source_domain, price_cents, price_currency, source_url) values
  ('cb000000-0000-4000-8000-000000000011', 'cb000000-0000-4000-8000-000000000001', 'product', 'Wombat blue coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/coat'),
  ('cb000000-0000-4000-8000-000000000012', 'cb000000-0000-4000-8000-000000000001', 'product', 'Wombat red coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/coat-2'),
  ('cb000000-0000-4000-8000-000000000013', 'cb000000-0000-4000-8000-000000000002', 'product', 'Wombat maker belt', 'Wombat', 'wombat.example', 2000, 'USD', 'https://wombat.example/belt');
-- The maker's own pieces, for the closet cap.
insert into items (id, owner_id, kind, title) values
  ('cb000000-0000-4000-8000-000000000021', 'cb000000-0000-4000-8000-000000000002', 'own', 'cp own one'),
  ('cb000000-0000-4000-8000-000000000022', 'cb000000-0000-4000-8000-000000000002', 'own', 'cp own two');
insert into item_flags (item_id, scan_state, scanned_at) select id, 'clean', now() from items where id::text like 'cb000000-%';

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

-- 1. A colour is one of sixteen words, named by the owner; the search can ask for one.
select pg_temp.act_as('cb000000-0000-4000-8000-000000000001');
select lives_ok($$ update items set color_name = 'blue' where id = 'cb000000-0000-4000-8000-000000000011' $$, 'clipper: names their clip blue');
select lives_ok($$ update items set color_name = 'red' where id = 'cb000000-0000-4000-8000-000000000012' $$, 'clipper: names the other red');
select throws_ok($$ update items set color_name = 'ultramarine' where id = 'cb000000-0000-4000-8000-000000000011' $$, '23514', null, 'clipper: a word that is not one of the sixteen is refused');
select lives_ok($$ update items set color_name = null where id = 'cb000000-0000-4000-8000-000000000012' $$, 'clipper: a colour can be taken off');
update items set color_name = 'red' where id = 'cb000000-0000-4000-8000-000000000012';
select is((select count(*)::int from search_items('wombat')), 3, 'search: no colour asked, every Wombat piece');
select is((select count(*)::int from search_items('wombat', null, null, 40, 'blue')), 1, 'search: blue finds the blue coat');
select is((select id from search_items('wombat', null, null, 40, 'blue')), 'cb000000-0000-4000-8000-000000000011'::uuid, 'search: and it is that one');
select is((select count(*)::int from search_items('', null, null, 40, 'red') where id::text like 'cb000000-%'), 1, 'search: red with no words finds the red coat');
select is((select count(*)::int from search_items('wombat', null, null, 40, 'green')), 0, 'search: a colour nobody named finds nothing');
select is((select count(*)::int from pg_proc where proname = 'search_items' and pronamespace = 'public'::regnamespace), 1, 'search: one search_items, not two for PostgREST to choose between');
select pg_temp.back();

-- 2. Sold out, from the watch: a reading sets it either way; no reading leaves it; a gone page says nothing about stock.
select is((select sold_out from items where id = 'cb000000-0000-4000-8000-000000000011'), false, 'server: a fresh clip is not sold out');
select record_price_check('cb000000-0000-4000-8000-000000000011', 'ok', 9000, 'USD', true);
select is((select sold_out from items where id = 'cb000000-0000-4000-8000-000000000011'), true, 'server: the page said sold out, so it is');
select record_price_check('cb000000-0000-4000-8000-000000000011', 'ok', 9000, 'USD', null);
select is((select sold_out from items where id = 'cb000000-0000-4000-8000-000000000011'), true, 'server: a page that did not say leaves it');
select record_price_check('cb000000-0000-4000-8000-000000000011', 'no-price', null, null, false);
select is((select sold_out from items where id = 'cb000000-0000-4000-8000-000000000011'), false, 'server: back in stock, even with no price read');
select record_price_check('cb000000-0000-4000-8000-000000000011', 'gone', null, null, true);
select is((select sold_out from items where id = 'cb000000-0000-4000-8000-000000000011'), false, 'server: a gone page is not a sold-out reading');
select is((select count(*)::int from pg_proc where proname = 'record_price_check' and pronamespace = 'public'::regnamespace), 1, 'server: one record_price_check');

-- 3. The soft caps, lowered for the test: the one past the cap is refused with its own code; the server is not capped.
select pg_temp.act_as('cb000000-0000-4000-8000-000000000002');
select set_config('kleit.sets_cap', '2', true);
select lives_ok($$ insert into sets (owner_id, title, status, visibility) values ('cb000000-0000-4000-8000-000000000002', 'cp set one', 'draft', 'only_me') $$, 'maker: the first set');
select lives_ok($$ insert into sets (owner_id, title, status, visibility) values ('cb000000-0000-4000-8000-000000000002', 'cp set two', 'draft', 'only_me') $$, 'maker: the second, at the cap');
select throws_ok($$ insert into sets (owner_id, title, status, visibility) values ('cb000000-0000-4000-8000-000000000002', 'cp set three', 'draft', 'only_me') $$, 'P0012', null, 'maker: the one past the cap is refused');
select set_config('kleit.closet_cap', '1', true);
select lives_ok($$ insert into closet_items (user_id, item_id) values ('cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000021') $$, 'maker: the first closet piece');
select throws_ok($$ insert into closet_items (user_id, item_id) values ('cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000022') $$, 'P0013', null, 'maker: the one past the closet cap is refused');
select pg_temp.back();
select set_config('kleit.sets_cap', '2', true);
select lives_ok($$ insert into sets (id, owner_id, title, status, visibility, share_code) values ('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000002', 'cp set by server', 'draft', 'public', 'cpbyserver000001') $$, 'server: not capped');

-- 4. The clipper's point: the maker publishes a set with the clipper's coat and their own belt on it.
insert into set_items (set_id, item_id, position) values
  ('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000011', '{"slot": 0}'),
  ('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000013', '{"slot": 1}');
update sets set status = 'published', published_at = now() where id = 'cb000000-0000-4000-8000-000000000031';
select is((select points from profiles where user_id = 'cb000000-0000-4000-8000-000000000001'), 1, 'clipper: one point when somebody else publishes a set with their clip');
select is((select points from profiles where user_id = 'cb000000-0000-4000-8000-000000000002'), 10, 'maker: the publish points, and nothing for their own clip on their own set');
update sets set status = 'draft' where id = 'cb000000-0000-4000-8000-000000000031';
update sets set status = 'published' where id = 'cb000000-0000-4000-8000-000000000031';
select is((select points from profiles where user_id = 'cb000000-0000-4000-8000-000000000001'), 1, 'clipper: publishing the same set again earns nothing more');

select * from finish();
rollback;
