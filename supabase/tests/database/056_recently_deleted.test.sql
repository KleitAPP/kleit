-- Tests for migration 074 (Recently deleted, S26): a set in the bin can be destroyed by its owner
-- and nobody else; a closet piece leaves, comes back, or goes for good through the four
-- functions, and the two rows it lives in always agree.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

insert into auth.users (id, email) values
  ('cdcdcdcd-0000-4000-8000-000000000001', 'bin-owner@test.kleit'),
  ('cdcdcdcd-0000-4000-8000-000000000002', 'bin-other@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('cdcdcdcd-0000-4000-8000-000000000001', 'binowner', now(), 't'),
  ('cdcdcdcd-0000-4000-8000-000000000002', 'binother', now(), 't');
insert into sets (id, owner_id, title, status, share_code, deleted_at) values
  ('cd000000-0000-4000-8000-000000000001', 'cdcdcdcd-0000-4000-8000-000000000001', 'in the bin', 'published', 'binsetinbin00001', now() - interval '2 days'),
  ('cd000000-0000-4000-8000-000000000002', 'cdcdcdcd-0000-4000-8000-000000000001', 'live', 'published', 'binsetlive000002', null),
  ('cd000000-0000-4000-8000-000000000003', 'cdcdcdcd-0000-4000-8000-000000000001', 'to restore', 'published', 'binsetrestore003', now() - interval '2 days');
insert into items (id, owner_id, kind, title, image_id, image_bucket) values
  ('cd000000-0000-4000-8000-000000000011', 'cdcdcdcd-0000-4000-8000-000000000001', 'own', 'used piece', 'cdcdcdcd-0000-4000-8000-000000000001/used.jpg', 'closet-photos'),
  ('cd000000-0000-4000-8000-000000000012', 'cdcdcdcd-0000-4000-8000-000000000001', 'own', 'spare piece', 'cdcdcdcd-0000-4000-8000-000000000001/spare.jpg', 'closet-photos');
insert into closet_items (user_id, item_id, shareable) values
  ('cdcdcdcd-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000011', true),
  ('cdcdcdcd-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000012', false);
insert into set_items (set_id, item_id, position) values
  ('cd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', '{"slot": 0}'),
  ('cd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000011', '{"slot": 0}');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- ---------------- closet pieces, as the owner ----------------
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select is(closet_item_uses('cd000000-0000-4000-8000-000000000011'), 1, 'owner: the used piece is counted in one live set (the set in the bin does not count)');
select is(closet_item_uses('cd000000-0000-4000-8000-000000000012'), 0, 'owner: the spare piece is in no set');

-- Keep it in sets: only the closet row changes.
select is(delete_closet_item('cd000000-0000-4000-8000-000000000011', true), 0, 'owner: deleting and keeping it in sets takes it off no set');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select deleted_at is not null from closet_items where item_id = 'cd000000-0000-4000-8000-000000000011'), 'kept: the closet row is in the bin');
select ok((select deleted_at is null from items where id = 'cd000000-0000-4000-8000-000000000011'), 'kept: the item row is untouched, so its sets look the same to everyone');
select is((select count(*)::int from set_items where item_id = 'cd000000-0000-4000-8000-000000000011'), 2, 'kept: the piece is still on its sets');
select ok(private.closet_says_shareable('cd000000-0000-4000-8000-000000000011'), 'kept: leaving the closet did not change the sharing flag''s answer');

-- Restore, then delete again taking it off the sets.
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select lives_ok($$ select restore_closet_item('cd000000-0000-4000-8000-000000000011') $$, 'owner: restores the kept piece');
select is(delete_closet_item('cd000000-0000-4000-8000-000000000011', false), 2, 'owner: deleting and removing it from sets takes it off both of their own sets');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select deleted_at is not null from items where id = 'cd000000-0000-4000-8000-000000000011'), 'removed: the item row is marked deleted, hidden from everyone');
select is((select count(*)::int from set_items where item_id = 'cd000000-0000-4000-8000-000000000011'), 0, 'removed: no set holds it any more');

-- Restore brings the item row back; the set slots stay gone.
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select restore_closet_item('cd000000-0000-4000-8000-000000000011');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select deleted_at is null from items where id = 'cd000000-0000-4000-8000-000000000011') and (select deleted_at is null from closet_items where item_id = 'cd000000-0000-4000-8000-000000000011'), 'restored: both rows are live again');

-- Delete now.
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select throws_ok($$ select erase_closet_item('cd000000-0000-4000-8000-000000000011') $$, 'P0002', null, 'owner: Delete now needs the piece to be in the bin first');
select delete_closet_item('cd000000-0000-4000-8000-000000000011', true);
select lives_ok($$ select erase_closet_item('cd000000-0000-4000-8000-000000000011') $$, 'owner: Delete now from the bin');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select count(*) = 0 from closet_items where item_id = 'cd000000-0000-4000-8000-000000000011') and (select deleted_at is not null from items where id = 'cd000000-0000-4000-8000-000000000011'), 'erased: out of the bin, and the item row is marked deleted for the purge');

-- The 30-day window.
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select delete_closet_item('cd000000-0000-4000-8000-000000000012', false);
reset role;
select set_config('request.jwt.claims', '', true);
update closet_items set deleted_at = now() - interval '31 days' where item_id = 'cd000000-0000-4000-8000-000000000012';
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
select throws_ok($$ select restore_closet_item('cd000000-0000-4000-8000-000000000012') $$, 'P0002', null, 'owner: a piece deleted 31 days ago cannot be restored');

-- ---------------- someone else ----------------
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000002');
select throws_ok($$ select delete_closet_item('cd000000-0000-4000-8000-000000000011', true) $$, 'P0002', null, 'other: cannot touch a piece that is not in their closet');
delete from sets where id = 'cd000000-0000-4000-8000-000000000001';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from sets where id = 'cd000000-0000-4000-8000-000000000001'), 1, 'other: cannot empty someone else''s bin');

-- ---------------- sets, as the owner ----------------
select pg_temp.act_as('cdcdcdcd-0000-4000-8000-000000000001');
delete from sets where id = 'cd000000-0000-4000-8000-000000000002';
delete from sets where id = 'cd000000-0000-4000-8000-000000000001';
update sets set deleted_at = null where id = 'cd000000-0000-4000-8000-000000000003';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from sets where id = 'cd000000-0000-4000-8000-000000000002'), 1, 'owner: a live set cannot be destroyed - it has to go through the bin');
select is((select count(*)::int from sets where id = 'cd000000-0000-4000-8000-000000000001'), 0, 'owner: Delete now on a set in the bin destroys it');
select ok((select deleted_at is null from sets where id = 'cd000000-0000-4000-8000-000000000003'), 'owner: Restore brings a set back from the bin');

select * from finish();
rollback;
