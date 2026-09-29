-- Tests for collections (migration 017 rows 16–17; roadmap M3.8 "Done when": a private
-- collection is invisible to a second account, and an entry never shows a set its viewer
-- could not see on its own).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-000000000001', 'colowner@test.kleit'),
  ('cccccccc-0000-4000-8000-000000000002', 'colstranger@test.kleit'),
  ('cccccccc-0000-4000-8000-000000000003', 'colblocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('cccccccc-0000-4000-8000-000000000001', 'colowner', now(), 't'),
  ('cccccccc-0000-4000-8000-000000000002', 'colstranger', now(), 't'),
  ('cccccccc-0000-4000-8000-000000000003', 'colblocked', now(), 't');
insert into blocks (blocker_id, blocked_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('99999999-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'public set',  'published', 'public',  'colsetpub0000001'),
  ('99999999-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'only me set', 'published', 'only_me', 'colsetme00000002');
insert into collections (id, owner_id, name, visibility) values
  ('98989898-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Private folder', 'only_me'),
  ('98989898-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'Public folder',  'public');
insert into collection_entries (collection_id, set_id) values
  ('98989898-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001'),
  ('98989898-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001'),
  ('98989898-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000002');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000001');
select is((select count(*)::int from collections where owner_id = 'cccccccc-0000-4000-8000-000000000001'), 2, 'owner: sees both folders');
select is((select count(*)::int from collection_entries where collection_id = '98989898-0000-4000-8000-000000000002'), 2, 'owner: sees every entry, including the only-me set');
select throws_ok($$ insert into collection_entries (collection_id, set_id) values ('98989898-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001') $$,
  '23505', null, 'owner: the same set cannot go in twice');

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000002');
select is((select count(*)::int from collections where id = '98989898-0000-4000-8000-000000000001'), 0, 'stranger: the private folder is invisible');
select is((select count(*)::int from collections where id = '98989898-0000-4000-8000-000000000002'), 1, 'stranger: the public folder is visible');
select is((select count(*)::int from collection_entries where collection_id = '98989898-0000-4000-8000-000000000001'), 0, 'stranger: nor its entries');
select is((select count(*)::int from collection_entries where collection_id = '98989898-0000-4000-8000-000000000002'), 1, 'stranger: in the public folder, only the set they could see anyway');
select throws_ok($$ insert into collection_entries (collection_id, set_id) values ('98989898-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001') $$,
  '42501', null, 'stranger: cannot add to someone else''s folder');
update collections set name = 'hijacked' where id = '98989898-0000-4000-8000-000000000002';
select is((select name from collections where id = '98989898-0000-4000-8000-000000000002'), 'Public folder', 'stranger: cannot rename it (the update touched no row)');
delete from collection_entries where collection_id = '98989898-0000-4000-8000-000000000002';
select is((select count(*)::int from collection_entries where collection_id = '98989898-0000-4000-8000-000000000002'), 1, 'stranger: cannot empty it (the delete touched no row)');
select lives_ok($$ insert into collections (owner_id, name) values ('cccccccc-0000-4000-8000-000000000002', 'my own') $$, 'stranger: can make their own');

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000003');
select is((select count(*)::int from collections where id = '98989898-0000-4000-8000-000000000002'), 0, 'blocked: even the public folder is invisible');

select * from finish();
rollback;
