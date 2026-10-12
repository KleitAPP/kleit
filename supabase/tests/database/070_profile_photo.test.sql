-- Tests for migration 092: a profile photo is the person's own screened photo in their avatar
-- folder, pointed at through one door; the picture gate opens it to everyone once cleared and
-- shuts it when the account is hidden or the photo replaced; the columns are the server's.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a3a3a3a3-0000-4000-8000-000000000001', 'pp-a@test.kleit'),
  ('a3a3a3a3-0000-4000-8000-000000000002', 'pp-b@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('a3a3a3a3-0000-4000-8000-000000000001', 'ppa', now(), 't'),
  ('a3a3a3a3-0000-4000-8000-000000000002', 'ppb', now(), 't');
insert into items (id, owner_id, kind, title, image_bucket, image_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a3a3a3a3-0000-4000-8000-000000000001', 'own', 'pp photo one', 'closet-photos', 'a3a3a3a3-0000-4000-8000-000000000001/avatar/one.jpg'),
  ('a3000000-0000-4000-8000-000000000002', 'a3a3a3a3-0000-4000-8000-000000000001', 'own', 'pp photo two', 'closet-photos', 'a3a3a3a3-0000-4000-8000-000000000001/avatar/two.jpg'),
  ('a3000000-0000-4000-8000-000000000003', 'a3a3a3a3-0000-4000-8000-000000000001', 'own', 'pp closet piece', 'closet-photos', 'a3a3a3a3-0000-4000-8000-000000000001/pieces/three.jpg'),
  ('a3000000-0000-4000-8000-000000000004', 'a3a3a3a3-0000-4000-8000-000000000002', 'own', 'pp b photo', 'closet-photos', 'a3a3a3a3-0000-4000-8000-000000000002/avatar/four.jpg');
-- One is cleared, two is still being checked.
insert into item_flags (item_id, scan_state) values ('a3000000-0000-4000-8000-000000000001', 'clean');

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

-- 1. The columns are the server's; the door checks whose photo it is and where it sits.
select pg_temp.act_as('a3a3a3a3-0000-4000-8000-000000000001');
select throws_ok($$ update profiles set avatar_item_id = 'a3000000-0000-4000-8000-000000000001' where user_id = 'a3a3a3a3-0000-4000-8000-000000000001' $$, '42501', null, 'a: cannot point the profile at a photo by hand');
select throws_ok($$ update profiles set avatar_url = 'https://evil.example/pixel.gif' where user_id = 'a3a3a3a3-0000-4000-8000-000000000001' $$, '42501', null, 'a: cannot set a picture address by hand');
select throws_ok($$ select set_profile_photo('a3000000-0000-4000-8000-000000000004') $$, 'P0010', null, 'a: not somebody else''s photo');
select throws_ok($$ select set_profile_photo('a3000000-0000-4000-8000-000000000003') $$, 'P0010', null, 'a: not a closet piece - the avatar folder only');
select pg_temp.back();
select is(piece_is_shareable('a3000000-0000-4000-8000-000000000001'), false, 'before: a cleared photo in the avatar folder is nobody''s to see');
select pg_temp.act_as('a3a3a3a3-0000-4000-8000-000000000001');

-- 2. Through the door: cleared means everyone sees it; still checking means nobody does.
select is(set_profile_photo('a3000000-0000-4000-8000-000000000001'), true, 'a: the cleared photo becomes the profile photo');
select is((select avatar_item_id from profiles where user_id = 'a3a3a3a3-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001'::uuid, 'and the profile points at it');
select pg_temp.back();
select is(piece_is_shareable('a3000000-0000-4000-8000-000000000001'), true, 'the gate opens it to everyone');
select pg_temp.act_as('a3a3a3a3-0000-4000-8000-000000000001');
select is(set_profile_photo('a3000000-0000-4000-8000-000000000002'), true, 'a: replaces it with one still being checked');
select pg_temp.back();
select is(piece_is_shareable('a3000000-0000-4000-8000-000000000002'), false, 'unscanned stays invisible');
select isnt((select deleted_at from items where id = 'a3000000-0000-4000-8000-000000000001'), null, 'the replaced photo went into the bin');
select is(piece_is_shareable('a3000000-0000-4000-8000-000000000001'), false, 'and is nobody''s to see any more');

-- 3. A hidden account hides its photo; taking it off works.
insert into item_flags (item_id, scan_state) values ('a3000000-0000-4000-8000-000000000002', 'clean');
update profiles set deactivated_at = now() where user_id = 'a3a3a3a3-0000-4000-8000-000000000001';
select is(piece_is_shareable('a3000000-0000-4000-8000-000000000002'), false, 'on a break: the photo is hidden with the account');
update profiles set deactivated_at = null where user_id = 'a3a3a3a3-0000-4000-8000-000000000001';
select pg_temp.act_as('a3a3a3a3-0000-4000-8000-000000000001');
select is(set_profile_photo(null), true, 'a: takes the photo off');

select * from finish();
rollback;
