-- Tests for migration 099: the brand mini editor's door lists one store's cleared, buyable
-- pieces and nothing else, one per picture, newest first, naming nobody; a guest may ask.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('b9b9b9b9-0000-4000-8000-000000000001', 'bp-owner@test.kleit'),
  ('b9b9b9b9-0000-4000-8000-000000000002', 'bp-other@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b9b9b9b9-0000-4000-8000-000000000001', 'bpowner', now(), 't'),
  ('b9b9b9b9-0000-4000-8000-000000000002', 'bpother', now(), 't');

-- Eleven pieces from one store, of which exactly two belong on its page.
insert into items (id, owner_id, kind, title, price_cents, price_currency, source_url, source_domain, image_hash, created_at) values
  -- A: cleared, picture h1, the older clip of that picture
  ('b9000000-0000-4000-8000-00000000000a', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp coat (older clip)', 12000, 'USD', 'https://brand.example/coat', 'brand.example', 'h1', now() - interval '2 days'),
  -- B: not cleared
  ('b9000000-0000-4000-8000-00000000000b', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp pending', 5000, 'USD', 'https://brand.example/pending', 'brand.example', 'h2', now()),
  -- C: cleared but deleted
  ('b9000000-0000-4000-8000-00000000000c', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp deleted', 5000, 'USD', 'https://brand.example/deleted', 'brand.example', 'h3', now()),
  -- D: cleared but taken down
  ('b9000000-0000-4000-8000-00000000000d', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp removed', 5000, 'USD', 'https://brand.example/removed', 'brand.example', 'h4', now()),
  -- E: cleared but its store page is gone
  ('b9000000-0000-4000-8000-00000000000e', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp dead link', 5000, 'USD', 'https://brand.example/gone', 'brand.example', 'h5', now()),
  -- F: cleared, picture h1 again, clipped by somebody else a day later: stands for A
  ('b9000000-0000-4000-8000-00000000000f', 'b9b9b9b9-0000-4000-8000-000000000002', 'product', 'bp coat (newer clip)', 11000, 'USD', 'https://brand.example/coat', 'brand.example', 'h1', now() - interval '1 day'),
  -- G: a person's own piece that happens to carry the domain
  ('b9000000-0000-4000-8000-000000000010', 'b9b9b9b9-0000-4000-8000-000000000001', 'own', 'bp own piece', null, null, null, 'brand.example', 'h6', now()),
  -- H: cleared but sold out
  ('b9000000-0000-4000-8000-000000000011', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp sold out', 5000, 'USD', 'https://brand.example/soldout', 'brand.example', 'h7', now()),
  -- I: cleared, another store
  ('b9000000-0000-4000-8000-000000000012', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp elsewhere', 5000, 'USD', 'https://other.example/x', 'other.example', 'h8', now()),
  -- J: cleared but nowhere to buy it
  ('b9000000-0000-4000-8000-000000000013', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp no source', 5000, 'USD', null, 'brand.example', 'h9', now()),
  -- K: cleared, no picture hash recorded, the oldest
  ('b9000000-0000-4000-8000-000000000014', 'b9b9b9b9-0000-4000-8000-000000000001', 'product', 'bp hat', 3000, 'EUR', 'https://brand.example/hat', 'brand.example', null, now() - interval '3 days');
update items set deleted_at = now() where id = 'b9000000-0000-4000-8000-00000000000c';
update items set takedown_state = 'removed' where id = 'b9000000-0000-4000-8000-00000000000d';
update items set dead_link_at = now() where id = 'b9000000-0000-4000-8000-00000000000e';
update items set sold_out = true where id = 'b9000000-0000-4000-8000-000000000011';
insert into item_flags (item_id, scan_state, scanned_at)
select id, 'clean', now() from items where owner_id in ('b9b9b9b9-0000-4000-8000-000000000001', 'b9b9b9b9-0000-4000-8000-000000000002')
   and id <> 'b9000000-0000-4000-8000-00000000000b';

create function pg_temp.ids(p_domain text) returns text[] language sql as $$
  select coalesce(array_agg(p ->> 'id' order by ord), '{}') from jsonb_array_elements(brand_pieces(p_domain) -> 'pieces') with ordinality as t(p, ord);
$$;

-- 1. Exactly the two that belong, newest first.
select is(jsonb_array_length(brand_pieces('brand.example') -> 'pieces'), 2, 'the store page lists two pieces');
select is(pg_temp.ids('brand.example'), array['b9000000-0000-4000-8000-00000000000f', 'b9000000-0000-4000-8000-000000000014'], 'the newer clip of the shared picture, then the hat: nothing pending, deleted, taken down, gone, sold out, own, unsourced or from another store');
select ok(not ('b9000000-0000-4000-8000-00000000000a' = any (pg_temp.ids('brand.example'))), 'the older clip of the same picture is folded into the newer one');

-- 2. The answer names no person.
select is((select array_agg(k order by k) from jsonb_object_keys(brand_pieces('brand.example') -> 'pieces' -> 0) k), array['id', 'price_cents', 'price_currency', 'title'], 'a piece carries its id, title and price and nothing about who clipped it');
select is(brand_pieces('brand.example') ->> 'domain', 'brand.example', 'the store is echoed back');

-- 3. The shape of the domain is checked; a store nobody clipped from is an empty page, not an error.
select is(brand_pieces('Brand.Example'), null, 'an upper-case spelling is nothing (the page lower-cases before it asks)');
select is(brand_pieces('brand'), null, 'a word with no dot is nothing');
select is(brand_pieces('-brand.example'), null, 'a hyphen first is nothing');
select is(brand_pieces('nobody.example') -> 'pieces', '[]'::jsonb, 'a store with no cleared pieces has an empty list');

-- 4. A guest may ask; the answer is the same.
set local role anon;
select is(jsonb_array_length(brand_pieces('brand.example') -> 'pieces'), 2, 'anon: the same two pieces');
reset role;
select ok(has_function_privilege('anon', 'public.brand_pieces(text)', 'execute') and has_function_privilege('authenticated', 'public.brand_pieces(text)', 'execute'), 'anon and authenticated may call the door');

-- 5. Deleting the newer clip brings the older one back: the picture is still on sale.
update items set deleted_at = now() where id = 'b9000000-0000-4000-8000-00000000000f';
select is(pg_temp.ids('brand.example'), array['b9000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-000000000014'], 'when the newer clip goes, the older clip of the picture stands for it');

select * from finish();
rollback;
