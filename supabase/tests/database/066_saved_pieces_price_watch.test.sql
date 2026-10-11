-- Tests for migration 088: a save is of a cleared product only; the watch hands out saved
-- pieces with a store address that have not been read for a week; a lower reading tells each
-- saver once, a higher one is quiet, two "gone" readings mark the piece; the watch's columns
-- and doors are the server's.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(19);

insert into auth.users (id, email) values
  ('c7c7c7c7-0000-4000-8000-000000000001', 'pw-clipper@test.kleit'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'pw-saver-a@test.kleit'),
  ('c7c7c7c7-0000-4000-8000-000000000003', 'pw-saver-b@test.kleit'),
  ('c7c7c7c7-0000-4000-8000-000000000004', 'pw-nobody@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('c7c7c7c7-0000-4000-8000-000000000001', 'pwclipper', now(), 't'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'pwsavera', now(), 't'),
  ('c7c7c7c7-0000-4000-8000-000000000003', 'pwsaverb', now(), 't'),
  ('c7c7c7c7-0000-4000-8000-000000000004', 'pwnobody', now(), 't');
insert into items (id, owner_id, kind, title, price_cents, price_currency, source_url, source_domain, price_checked_at, price_check_fails, dead_link_at) values
  ('c7000000-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', 'product', 'pw coat', 5000, 'USD', 'https://example.com/pw-coat', 'example.com', null, 0, null),
  ('c7000000-0000-4000-8000-000000000002', 'c7c7c7c7-0000-4000-8000-000000000001', 'product', 'pw no address', 2000, 'USD', null, null, null, 0, null),
  ('c7000000-0000-4000-8000-000000000003', 'c7c7c7c7-0000-4000-8000-000000000001', 'product', 'pw read yesterday', 3000, 'USD', 'https://example.com/pw-fresh', 'example.com', now() - interval '1 day', 0, null),
  ('c7000000-0000-4000-8000-000000000004', 'c7c7c7c7-0000-4000-8000-000000000001', 'own', 'pw own photo', null, null, null, null, null, 0, null),
  ('c7000000-0000-4000-8000-000000000005', 'c7c7c7c7-0000-4000-8000-000000000001', 'product', 'pw dead', 1000, 'USD', 'https://example.com/pw-dead', 'example.com', now() - interval '30 days', 2, now()),
  ('c7000000-0000-4000-8000-000000000006', 'c7c7c7c7-0000-4000-8000-000000000001', 'product', 'pw refused five times', 1000, 'USD', 'https://example.com/pw-wall', 'example.com', now() - interval '30 days', 5, null);
-- A product is visible to a saver only once its picture is cleared.
insert into item_flags (item_id, scan_state) select id, 'clean' from items where id::text like 'c7000000-%' and kind = 'product';
insert into saved_items (user_id, item_id) values
  ('c7c7c7c7-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000002'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000003'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000005'),
  ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000006');

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

-- 1. Saving.
select pg_temp.act_as('c7c7c7c7-0000-4000-8000-000000000002');
select lives_ok($$ insert into saved_items (user_id, item_id) values ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001') $$, 'saver A: hearts a cleared product');
select throws_ok($$ insert into saved_items (user_id, item_id) values ('c7c7c7c7-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000004') $$, '42501', null, 'saver A: cannot heart somebody''s own photo');
select pg_temp.back();

-- 2. What the watch hands out: the saved coat with an address, never read; not the one with no
--    address, the one read yesterday, the dead one or the one refused five times.
create temp table pw_claimed as select * from claim_price_checks(50) where id::text like 'c7000000-%';
select is((select count(*)::int from pw_claimed), 1, 'server: one of the test''s pieces is due');
select is((select id from pw_claimed), 'c7000000-0000-4000-8000-000000000001'::uuid, 'server: it is the saved coat, and it is stamped as claimed');
select isnt((select price_checked_at from items where id = 'c7000000-0000-4000-8000-000000000001'), null, 'server: the claim stamps the check time');

-- 3. Readings.
select is(record_price_check('c7000000-0000-4000-8000-000000000001', 'ok', 4000, 'USD'), 2, 'server: a drop tells both savers');
select is((select price_cents from items where id = 'c7000000-0000-4000-8000-000000000001'), 4000, 'the price is the new one');
select is((select price_was_cents from items where id = 'c7000000-0000-4000-8000-000000000001'), 5000, 'and the old one is remembered');
select is((select count(*)::int from notifications where user_id = 'c7c7c7c7-0000-4000-8000-000000000002' and kind = 'price_drop' and ref_type = 'item' and ref_id = 'c7000000-0000-4000-8000-000000000001'), 1, 'saver A: told once, pointed at the piece');
select is((select count(*)::int from notifications where user_id = 'c7c7c7c7-0000-4000-8000-000000000004' and kind = 'price_drop'), 0, 'somebody who did not save it: not told');
select is(record_price_check('c7000000-0000-4000-8000-000000000001', 'ok', 4000, 'USD'), 0, 'server: the same price again tells nobody');
select is(record_price_check('c7000000-0000-4000-8000-000000000001', 'ok', 4500, 'USD'), 0, 'server: a rise tells nobody');
select is((select price_was_cents from items where id = 'c7000000-0000-4000-8000-000000000001'), null, 'and the remembered drop is cleared by the rise');
select record_price_check('c7000000-0000-4000-8000-000000000001', 'gone');
select is((select dead_link_at from items where id = 'c7000000-0000-4000-8000-000000000001'), null, 'server: one "gone" is not yet a dead link');
select record_price_check('c7000000-0000-4000-8000-000000000001', 'gone');
select isnt((select dead_link_at from items where id = 'c7000000-0000-4000-8000-000000000001'), null, 'server: two "gone" readings mark the piece');
select record_price_check('c7000000-0000-4000-8000-000000000003', 'blocked');
select is((select price_check_fails from items where id = 'c7000000-0000-4000-8000-000000000003'), 1, 'server: a refusal counts');
select record_price_check('c7000000-0000-4000-8000-000000000003', 'no-price');
select is((select price_check_fails from items where id = 'c7000000-0000-4000-8000-000000000003'), 0, 'server: a page that read fine clears the count');

-- 4. The doors and the columns are the server's.
select pg_temp.act_as('c7c7c7c7-0000-4000-8000-000000000002');
select throws_ok($$ select record_price_check('c7000000-0000-4000-8000-000000000001', 'ok', 1, 'USD') $$, '42501', null, 'saver A: cannot record a reading');
select throws_ok($$ select * from claim_price_checks(1) $$, '42501', null, 'saver A: cannot claim the list');
select pg_temp.act_as('c7c7c7c7-0000-4000-8000-000000000001');
select throws_ok($$ update items set dead_link_at = null where id = 'c7000000-0000-4000-8000-000000000001' $$, 'P0001', null, 'the clipper: cannot touch the watch''s columns on their own piece');

select * from finish();
rollback;
