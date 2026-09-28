-- Tests for migration 012 — which bucket an item's picture lives in (roadmap M2.6).
-- The one that matters: an item can never claim its picture lives in a server-only bucket.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.act_as(text) to authenticated;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is(
  (select column_default from information_schema.columns
    where table_name = 'items' and column_name = 'image_bucket'),
  '''item-images''::image_bucket',
  'a clipped item still lands in item-images without anyone saying so');

select lives_ok($$ insert into items (id, owner_id, kind, image_bucket, image_id)
                   values ('bbbbbbbb-0000-4000-8000-000000000001',
                           '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos',
                           '11111111-1111-4111-8111-111111111111/jumper.webp') $$,
  'a photo of your own piece can say it lives in closet-photos');

select throws_ok($$ insert into items (owner_id, kind, image_bucket, image_id)
                    values ('11111111-1111-4111-8111-111111111111', 'own', 'evidence', 'x') $$,
  '22P02', null,
  'an item can NEVER claim its picture lives in the moderation evidence bucket');

select throws_ok($$ insert into items (owner_id, kind, image_bucket, image_id)
                    values ('11111111-1111-4111-8111-111111111111', 'own', 'id-verification', 'x') $$,
  '22P02', null,
  'nor in the identity bucket');

select throws_ok($$ update items set image_bucket = 'item-images'
                    where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'a picture cannot be moved to another bucket after the fact');

select lives_ok($$ update items set title = 'My jumper'
                   where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'the ordinary fields still change freely');

-- Migration 013: the server may write the columns the trigger calls server-only.
--
-- `reset role` alone is NOT enough, and getting that wrong is what made this test fail first
-- time: the JWT claims were set transaction-locally and survive the role change, so auth.uid()
-- still answered with the person's id and the trigger still saw a person. An edge function using
-- the secret key sends a token with no `sub` at all, so the claims have to go too. That is the
-- state being reproduced here.
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select lives_ok($$ update items set image_hash = 'abc123'
                   where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'the server CAN write the fingerprint the trigger calls server-only (migration 013)');
select is((select image_hash from items where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'abc123',
  'and the fingerprint is actually there afterwards - the write was not silently refused');

select * from finish();
rollback;
