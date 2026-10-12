-- Tests for migration 101: a store search answers live pieces only - the caller's own deleted or
-- taken-down clip, readable to them as their own row, no longer comes back from it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

insert into auth.users (id, email) values ('c1c1c1c1-0000-4000-8000-000000000001', 'live-only@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values ('c1c1c1c1-0000-4000-8000-000000000001', 'liveonly', now(), 't');
insert into items (id, owner_id, kind, title, store_name, source_domain, price_cents, price_currency, source_url) values
  ('c1000000-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001', 'product', 'Quokka live jacket', 'Quokka', 'quokka.example', 9000, 'USD', 'https://quokka.example/1'),
  ('c1000000-0000-4000-8000-000000000002', 'c1c1c1c1-0000-4000-8000-000000000001', 'product', 'Quokka deleted jacket', 'Quokka', 'quokka.example', 9000, 'USD', 'https://quokka.example/2'),
  ('c1000000-0000-4000-8000-000000000003', 'c1c1c1c1-0000-4000-8000-000000000001', 'product', 'Quokka removed jacket', 'Quokka', 'quokka.example', 9000, 'USD', 'https://quokka.example/3'),
  ('c1000000-0000-4000-8000-000000000004', 'c1c1c1c1-0000-4000-8000-000000000001', 'product', 'Quokka gone-page jacket', 'Quokka', 'quokka.example', 9000, 'USD', 'https://quokka.example/4');
insert into item_flags (item_id, scan_state, scanned_at) select id, 'clean', now() from items where owner_id = 'c1c1c1c1-0000-4000-8000-000000000001';
update items set deleted_at = now() where id = 'c1000000-0000-4000-8000-000000000002';
update items set takedown_state = 'removed' where id = 'c1000000-0000-4000-8000-000000000003';
update items set dead_link_at = now() where id = 'c1000000-0000-4000-8000-000000000004';

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('c1c1c1c1-0000-4000-8000-000000000001');
select is((select count(*)::int from search_items('quokka')), 2, 'owner: the store search answers the live piece and the gone-page one, not the deleted or the taken-down');
select is((select count(*)::int from search_items('quokka') where id = 'c1000000-0000-4000-8000-000000000002'), 0, 'owner: their own deleted clip is not a search result');
select is((select count(*)::int from search_items('quokka') where id = 'c1000000-0000-4000-8000-000000000003'), 0, 'owner: their own taken-down clip is not either');
select is((select count(*)::int from search_items('', 'quokka.example')), 2, 'owner: the store page (an empty search with the store) says the same');

select * from finish();
rollback;
