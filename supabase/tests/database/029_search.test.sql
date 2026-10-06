-- Tests for search (migration 035; roadmap M6.1 "Done when": a private set never appears in
-- any search result, proven from a second account).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'searchowner@test.kleit'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'searcher@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'searchowner', now(), 't'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'searcher', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, layout) values
  ('82828282-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'Zebrafish brunch look', 'published', 'public', 'searchpublic0001', '{"version":1,"template":"","background":"#fff","caption":"with chunky loafers"}'),
  ('82828282-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-000000000001', 'Zebrafish secret look', 'published', 'only_me', 'searchonlyme0002', '{}'),
  ('82828282-0000-4000-8000-000000000003', 'b1b1b1b1-0000-4000-8000-000000000001', 'Zebrafish draft look', 'draft', 'public', 'searchdraft00003', '{}');
-- A cleared product, an uncleared one, and an own piece.
insert into items (id, owner_id, kind, title, store_name, source_domain, price_cents, price_currency, image_id) values
  ('81818181-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'product', 'Zebrafish chunky loafers', 'Shoeplace', 'shoeplace.example', 12000, 'USD', 'a.jpg'),
  ('81818181-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-000000000001', 'product', 'Zebrafish unscanned coat', 'Coatplace', 'coatplace.example', 30000, 'USD', 'b.jpg'),
  ('81818181-0000-4000-8000-000000000003', 'b1b1b1b1-0000-4000-8000-000000000001', 'own', 'Zebrafish my own scarf', null, null, null, null, 'c.jpg');
insert into item_flags (item_id, scan_state) values ('81818181-0000-4000-8000-000000000001', 'clean');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000002');
select is((select count(*)::int from search_sets('zebrafish')), 1, 'searcher: one set - the public published one');
select is((select title from search_sets('zebrafish')), 'Zebrafish brunch look', 'searcher: and it is that one (not the only-me set, not the draft)');
select is((select count(*)::int from search_sets('loafers')), 1, 'searcher: the caption is searched too');
select is((select count(*)::int from search_sets('zebra')), 1, 'searcher: a word prefix matches');
select is((select count(*)::int from search_items('zebrafish')), 1, 'searcher: one item - the cleared product (not the unscanned one, not the own piece)');
select is((select count(*)::int from search_items('zebrafish', 'shoeplace.example')), 1, 'searcher: the store filter keeps it');
select is((select count(*)::int from search_items('zebrafish', null, 5000)), 0, 'searcher: the price cap drops it');
select is((select count(*)::int from stores() where domain = 'shoeplace.example'), 1, 'searcher: the store appears with its cleared product');
select is((select count(*)::int from stores() where domain = 'coatplace.example'), 0, 'searcher: a store with only an uncleared clip does not');

select * from finish();
rollback;
