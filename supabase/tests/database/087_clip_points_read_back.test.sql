-- Tests for migration 111: a clipper's point comes only for a live, cleared clip, and at most
-- twenty a day to one clipper.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

insert into auth.users (id, email) values
  ('c9000000-0000-4000-8000-000000000001', 'cp2-clipper@test.kleit'),
  ('c9000000-0000-4000-8000-000000000002', 'cp2-maker@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('c9000000-0000-4000-8000-000000000001', 'cp2clipper', now(), 't'),
  ('c9000000-0000-4000-8000-000000000002', 'cp2maker', now(), 't');
-- Four clips of the clipper's: live and cleared, deleted, taken down, still being checked.
insert into items (id, owner_id, kind, title, store_name, source_domain, price_cents, price_currency, source_url) values
  ('c9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'product', 'cp2 live coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/1'),
  ('c9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'product', 'cp2 deleted coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/2'),
  ('c9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'product', 'cp2 removed coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/3'),
  ('c9000000-0000-4000-8000-000000000014', 'c9000000-0000-4000-8000-000000000001', 'product', 'cp2 pending coat', 'Wombat', 'wombat.example', 9000, 'USD', 'https://wombat.example/4');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('c9000000-0000-4000-8000-000000000011', 'clean', now()),
  ('c9000000-0000-4000-8000-000000000012', 'clean', now()),
  ('c9000000-0000-4000-8000-000000000013', 'clean', now()),
  ('c9000000-0000-4000-8000-000000000014', 'pending', null);
update items set deleted_at = now() where id = 'c9000000-0000-4000-8000-000000000012';
update items set takedown_state = 'removed' where id = 'c9000000-0000-4000-8000-000000000013';
-- The maker's draft with all four on it (rows written by the server; the policies are 100's business).
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000002', 'cp2 set', 'draft', 'public', 'cp2set0000000001');
insert into set_items (set_id, item_id, position) values
  ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000011', '{"slot": 0}'),
  ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000012', '{"slot": 1}'),
  ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000013', '{"slot": 2}'),
  ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000014', '{"slot": 3}');

update sets set status = 'published', published_at = now() where id = 'c9000000-0000-4000-8000-000000000031';
select is((select points from profiles where user_id = 'c9000000-0000-4000-8000-000000000001'), 1, 'clipper: one point - the live, cleared coat; nothing for the deleted, taken-down or pending ones');
select is((select count(*)::int from points_ledger where user_id = 'c9000000-0000-4000-8000-000000000001' and reason = 'clip_used'), 1, 'clipper: one ledger row');

-- The daily cap: nineteen more rows today (as the ledger would hold them), then two more sets.
insert into points_ledger (user_id, points, reason, ref)
  select 'c9000000-0000-4000-8000-000000000001', 1, 'clip_used', 'cp2-earlier-' || g from generate_series(1, 19) g;
update profiles set points = points + 19 where user_id = 'c9000000-0000-4000-8000-000000000001';
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('c9000000-0000-4000-8000-000000000032', 'c9000000-0000-4000-8000-000000000002', 'cp2 set two', 'draft', 'public', 'cp2set0000000002'),
  ('c9000000-0000-4000-8000-000000000033', 'c9000000-0000-4000-8000-000000000002', 'cp2 set three', 'draft', 'public', 'cp2set0000000003');
insert into set_items (set_id, item_id, position) values
  ('c9000000-0000-4000-8000-000000000032', 'c9000000-0000-4000-8000-000000000011', '{"slot": 0}'),
  ('c9000000-0000-4000-8000-000000000033', 'c9000000-0000-4000-8000-000000000011', '{"slot": 0}');
update sets set status = 'published', published_at = now() where id = 'c9000000-0000-4000-8000-000000000032';
select is((select count(*)::int from points_ledger where user_id = 'c9000000-0000-4000-8000-000000000001' and reason = 'clip_used'), 20, 'clipper: the twentieth of the day is given');
update sets set status = 'published', published_at = now() where id = 'c9000000-0000-4000-8000-000000000033';
select is((select count(*)::int from points_ledger where user_id = 'c9000000-0000-4000-8000-000000000001' and reason = 'clip_used'), 20, 'clipper: the twenty-first is not');
select is((select points from profiles where user_id = 'c9000000-0000-4000-8000-000000000002'), 30, 'maker: their own publish points are untouched by the cap');

select * from finish();
rollback;
