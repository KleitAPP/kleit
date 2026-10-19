-- Tests for CL65 (spec 7.1 #1, #13): a piece goes into a folder like a set does - anyone's
-- cleared product into your own folder; and an entry never shows a piece its viewer could not
-- see on its own (the owner's private closet piece in a public folder stays the owner's).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('e5e5e5e5-0000-4000-8000-000000000001', 'cp-owner@test.kleit'),
  ('e5e5e5e5-0000-4000-8000-000000000002', 'cp-viewer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e5e5e5e5-0000-4000-8000-000000000001', 'cpowner', now(), 't'),
  ('e5e5e5e5-0000-4000-8000-000000000002', 'cpviewer', now(), 't');

-- The owner's two pieces: a product the scan cleared, and a photo of their own closet piece.
insert into items (id, owner_id, kind, title) values
  ('e5000000-0000-4000-8000-000000000001', 'e5e5e5e5-0000-4000-8000-000000000001', 'product', 'Wool coat'),
  ('e5000000-0000-4000-8000-000000000002', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'My jumper');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('e5000000-0000-4000-8000-000000000001', 'clean', now());

insert into collections (id, owner_id, name, visibility) values
  ('e5000000-0000-4000-8000-000000000011', 'e5e5e5e5-0000-4000-8000-000000000001', 'Owner public folder', 'public'),
  ('e5000000-0000-4000-8000-000000000012', 'e5e5e5e5-0000-4000-8000-000000000002', 'Viewer folder', 'only_me');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. The owner puts both pieces in their public folder.
select pg_temp.act_as('e5e5e5e5-0000-4000-8000-000000000001');
select lives_ok($$insert into collection_entries (collection_id, item_id) values ('e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000001')$$, 'owner: a product goes in a folder');
select lives_ok($$insert into collection_entries (collection_id, item_id) values ('e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000002')$$, 'owner: so does a closet piece of their own');
select throws_ok($$insert into collection_entries (collection_id, item_id) values ('e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000001')$$, '23505', null, 'owner: the same piece cannot go in twice');
select throws_ok($$insert into collection_entries (collection_id) values ('e5000000-0000-4000-8000-000000000011')$$, '23514', null, 'an entry is a set or a piece, never neither');

-- 2. The viewer sees the public folder's product, not the private closet piece.
select pg_temp.act_as('e5e5e5e5-0000-4000-8000-000000000002');
select is((select count(*)::int from collection_entries where collection_id = 'e5000000-0000-4000-8000-000000000011'), 1, 'viewer: in the public folder, only the piece they could see anyway');
select is((select item_id from collection_entries where collection_id = 'e5000000-0000-4000-8000-000000000011'), 'e5000000-0000-4000-8000-000000000001', 'viewer: and it is the cleared product');

-- 3. The viewer saves the owner's product into a folder of their own (spec 7.1 #1).
select lives_ok($$insert into collection_entries (collection_id, item_id) values ('e5000000-0000-4000-8000-000000000012', 'e5000000-0000-4000-8000-000000000001')$$, 'viewer: anyone''s cleared product goes into your own folder');
select throws_ok($$insert into collection_entries (collection_id, item_id) values ('e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000001')$$, '42501', null, 'viewer: but never into someone else''s folder');

select * from finish();
rollback;
