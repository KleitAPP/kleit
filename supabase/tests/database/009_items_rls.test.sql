-- RLS tests for migration 010 — items and the closet (roadmap M2.2; technical pack §7 #1).
-- For each table: (a) the owner can read their own row, (b) a second account cannot,
-- (c) a signed-out visitor cannot, (d) RLS is on (000_rls_audit). A failure blocks the waypoint.
-- Everything runs inside a transaction and is rolled back: no test data is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(26);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit'),
  ('22222222-2222-4222-8222-222222222222', 'stranger@test.kleit');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', uid, true);
  end if;
end $$;
grant execute on function pg_temp.act_as(text) to anon, authenticated;

-- Server-side seeds: what an edge function with the secret key does.
insert into removed_image_fingerprints (image_hash, reason) values ('hash-gone', 'takedown');
insert into optout_sites (domain, source) values ('example.com', 'form');

-- ---------------- items: creating and owning ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
-- Since 095 a store piece is written by the server (clip-url) only: by hand a person adds
-- pieces of their own. The seed below is what clip-url does, with the secret key.
select throws_ok($$ insert into items (id, owner_id, kind, title, source_url, source_domain)
                    values ('aaaaaaaa-0000-4000-8000-000000000001',
                            '11111111-1111-4111-8111-111111111111', 'product', 'A coat',
                            'https://shop.example.com/coat', 'shop.example.com') $$,
  '42501', null, 'items: a store piece is never written by hand (095)');
reset role;
-- act_as leaves the claims behind: cleared, so this insert is the server's (no auth.uid()).
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
insert into items (id, owner_id, kind, title, source_url, source_domain)
  values ('aaaaaaaa-0000-4000-8000-000000000001',
          '11111111-1111-4111-8111-111111111111', 'product', 'A coat',
          'https://shop.example.com/coat', 'shop.example.com');
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ insert into items (owner_id, kind, title)
                    values ('22222222-2222-4222-8222-222222222222', 'product', 'not mine') $$,
  '42501', null, 'items: nobody can create an item owned by someone else');

-- The scan gate. The item exists and is a product, but no scan has cleared it yet.
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
  'items: an unscanned product is invisible to everyone but its owner (spec 13.1, 16)');

reset role;
insert into item_flags (item_id, scan_state, scanned_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'clean', now());

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 1,
  'items: once the scan says clean, a signed-in person can see the product');

reset role;
update item_flags set scan_state = 'blocked' where item_id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
  'items: a blocked scan takes the product back out of sight');
reset role;
update item_flags set scan_state = 'clean' where item_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- A cleared item that its owner soft-deleted, or that is under takedown, is out of sight too.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
update items set deleted_at = now() where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
  'items: a soft-deleted item is out of the catalog');
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
update items set deleted_at = null where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- A person's own (non-product) piece stays private until sets exist to share it on.
select lives_ok($$ insert into items (id, owner_id, kind, title)
                   values ('aaaaaaaa-0000-4000-8000-000000000002',
                           '11111111-1111-4111-8111-111111111111', 'own', 'my jumper') $$,
  'items: a person can add a piece of their own');
reset role;
insert into item_flags (item_id, scan_state, scanned_at)
  values ('aaaaaaaa-0000-4000-8000-000000000002', 'clean', now());
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000002'), 0,
  'items: someone else''s own piece is not in the catalog even when it is cleared');

select pg_temp.act_as(null);
select throws_ok($$ select count(*) from items $$,
  '42501', null, 'items: a signed-out visitor is refused the items table outright');

-- ---------------- items: the three server-only columns ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok($$ update items set title = 'A better coat'
                   where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'items: the owner can change their own item''s title');
select throws_ok($$ update items set source_url = 'https://elsewhere.example.com/'
                    where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'P0001', null, 'items: not even the owner can rewrite where the picture came from');
select throws_ok($$ update items set takedown_state = 'requested'
                    where id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'P0001', null, 'items: nobody can set their own takedown state');
select throws_ok($$ update items set owner_id = '22222222-2222-4222-8222-222222222222'
                    where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'P0001', null, 'items: an item cannot be handed to another account');
delete from items where id = 'aaaaaaaa-0000-4000-8000-000000000002';
select is((select count(*)::int from items where id = 'aaaaaaaa-0000-4000-8000-000000000002'), 1,
  'items: nothing can be destroyed - deleting is setting deleted_at (decision 103)');

-- ---------------- closet_items ----------------
select lives_ok($$ insert into closet_items (user_id, item_id)
                   values ('11111111-1111-4111-8111-111111111111',
                           'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'closet_items: the owner can put a piece in their closet');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from closet_items), 0,
  'closet_items: a second account cannot read your closet by any route');
select pg_temp.act_as(null);
select throws_ok($$ select count(*) from closet_items $$,
  '42501', null, 'closet_items: a signed-out visitor is refused the table outright');

-- ---------------- saved_items and drawer_items ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok($$ insert into saved_items (user_id, item_id)
                   values ('11111111-1111-4111-8111-111111111111',
                           'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'saved_items: the owner can heart an item');
select lives_ok($$ insert into drawer_items (user_id, item_id, origin)
                   values ('11111111-1111-4111-8111-111111111111',
                           'aaaaaaaa-0000-4000-8000-000000000001', 'clipped') $$,
  'drawer_items: a clipped piece lands in the drawer');
select throws_ok($$ insert into drawer_items (user_id, item_id, origin)
                    values ('11111111-1111-4111-8111-111111111111',
                            'aaaaaaaa-0000-4000-8000-000000000002', 'pickup') $$,
  '23514', null, 'drawer_items: a pickup must say which set it came from (decision 103)');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from saved_items) + (select count(*)::int from drawer_items), 0,
  'saved_items and drawer_items: a second account reads neither');

-- ---------------- server-only and public-read tables ----------------
select throws_ok($$ select count(*) from removed_image_fingerprints $$,
  '42501', null, 'removed_image_fingerprints: nobody signed in may read the block list');
select is((select count(*)::int from optout_sites), 1,
  'optout_sites: anyone signed in can read the do-not-clip list (permissions row 12)');
select throws_ok($$ insert into optout_sites (domain, source) values ('mine.example', 'form') $$,
  '42501', null, 'optout_sites: only the server may add to it');
select is((select count(*)::int from item_flags), 0,
  'item_flags: an ordinary account cannot read the screening results');

select pg_temp.act_as(null);
select throws_ok($$ select count(*) from removed_image_fingerprints $$,
  '42501', null, 'removed_image_fingerprints: a signed-out visitor is refused too');

select * from finish();
rollback;
